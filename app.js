/**
 * JSON Diff — app.js
 * CodeMirror 5 (UMD) + deep N-way diff
 */

// ─── Config ───────────────────────────────────────────────────────────────────
const SUPABASE_URL = '__SUPABASE_URL__';
const SUPABASE_KEY = '__SUPABASE_ANON_KEY__';

// ─── State ────────────────────────────────────────────────────────────────────
const panels = [];
let supabase     = null;
let diffVisible  = false;
let colWidthPct  = 50;

// ─── Supabase ─────────────────────────────────────────────────────────────────
async function initSupabase() {
  if (SUPABASE_URL === '__SUPABASE_URL__') return null;
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

// ─── Editor panel ─────────────────────────────────────────────────────────────
function createPanel(initialContent, initialName) {
  initialContent = initialContent || '{\n  \n}';
  initialName    = initialName    || '';
  const id = Math.random().toString(36).slice(2, 8);

  const card = document.createElement('div');
  card.className  = 'editor-card';
  card.dataset.id = id;
  card.style.flex     = '0 0 ' + colWidthPct + '%';
  card.style.minWidth = '280px';

  card.innerHTML =
    '<div class="editor-card-header">' +
      '<input class="editor-name" type="text" placeholder="Nazwa JSON-a…" />' +
      '<span class="editor-status status-ok">JSON ok</span>' +
      '<button class="btn-remove" title="Usuń">×</button>' +
    '</div>' +
    '<textarea class="editor-ta"></textarea>';

  const nameEl   = card.querySelector('.editor-name');
  const statusEl = card.querySelector('.editor-status');
  const removeBtn= card.querySelector('.btn-remove');
  const ta       = card.querySelector('.editor-ta');

  nameEl.value = initialName;

  const cm = CodeMirror.fromTextArea(ta, {
    mode: { name: 'javascript', json: true },
    theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'material' : 'default',
    lineNumbers: true,
    matchBrackets: true,
    foldGutter: true,
    gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
    lineWrapping: false,
    tabSize: 2,
    extraKeys: { 'Ctrl-Q': function(cm) { cm.foldCode(cm.getCursor()); } },
  });

  cm.setSize('100%', '260px');

  cm.setValue(initialContent);

  cm.on('change', function() {
    validateCm(cm, statusEl);
    if (diffVisible) renderDiff();
  });

  nameEl.addEventListener('input', function() {
    if (diffVisible) renderDiff();
  });

  validateCm(cm, statusEl);

  removeBtn.addEventListener('click', function() {
    card.remove();
    var i = panels.findIndex(function(p) { return p.id === id; });
    if (i !== -1) panels.splice(i, 1);
    if (diffVisible) renderDiff();
  });

  document.getElementById('editors-grid').appendChild(card);
  panels.push({ id: id, nameEl: nameEl, cm: cm });
  return id;
}

function validateCm(cm, statusEl) {
  try {
    var t = cm.getValue().trim();
    if (t) JSON.parse(t);
    statusEl.textContent = 'JSON ok';
    statusEl.className   = 'editor-status status-ok';
  } catch(e) {
    statusEl.textContent = 'błąd JSON';
    statusEl.className   = 'editor-status status-err';
  }
}

// ─── Deep N-way diff ──────────────────────────────────────────────────────────

function collectPaths(val, prefix) {
  prefix = prefix || '';
  var out = new Map();

  if (val === null || typeof val !== 'object') {
    out.set(prefix, JSON.stringify(val));
    return out;
  }

  if (Array.isArray(val)) {
    if (val.length === 0) {
      out.set(prefix, '[]');
    } else {
      val.forEach(function(item, i) {
        var next = prefix ? prefix + '[' + i + ']' : '[' + i + ']';
        collectPaths(item, next).forEach(function(v, k) { out.set(k, v); });
      });
    }
    return out;
  }

  var keys = Object.keys(val);
  if (keys.length === 0) {
    out.set(prefix, '{}');
    return out;
  }
  keys.forEach(function(k) {
    var next = prefix ? prefix + '.' + k : k;
    collectPaths(val[k], next).forEach(function(v, kk) { out.set(kk, v); });
  });
  return out;
}

function diffPaths(parsedArr) {
  var maps = parsedArr.map(function(p) { return collectPaths(p); });
  var allPaths = new Set();
  maps.forEach(function(m) { m.forEach(function(_, k) { allPaths.add(k); }); });

  var diffSet = new Set();
  allPaths.forEach(function(path) {
    var vals = maps.map(function(m) { return m.get(path); });
    var first = vals[0];
    if (vals.some(function(v) { return v !== first; })) diffSet.add(path);
  });
  return diffSet;
}

// ─── Annotated pretty-print ───────────────────────────────────────────────────
// Returns [{ text, diffPaths: Set }] — one entry per line
function annotateLines(val) {
  var lines   = JSON.stringify(val, null, 2).split('\n');
  var result  = [];

  // Stack-based path tracker
  var pathStack = [];   // current key segments
  var typeStack = [];   // 'obj' | 'arr'
  var idxStack  = [];   // current array index

  lines.forEach(function(line) {
    var trimmed = line.trim();
    var paths   = new Set();

    // ── detect key ──
    var keyMatch = trimmed.match(/^"([^"\\]*)"\s*:/);
    if (keyMatch) {
      pathStack.push(keyMatch[1]);
    }

    // ── build path ──
    function buildPath() {
      var p = '';
      pathStack.forEach(function(seg) {
        if (/^\[\d+\]$/.test(seg)) p += seg;
        else p = p ? p + '.' + seg : seg;
      });
      return p;
    }

    var curPath = buildPath();
    if (curPath) {
      paths.add(curPath);
      // add parent paths
      var tmp = curPath;
      while (tmp.includes('.') || /\[\d+\]/.test(tmp)) {
        tmp = tmp.replace(/(\.[^.[]+|\[\d+\])$/, '');
        if (tmp) paths.add(tmp);
      }
    }

    // ── structural tokens ──
    var isOpenObj = /\{,?$/.test(trimmed) && !keyMatch;
    var isOpenArr = /\[,?$/.test(trimmed);
    var isCloseObj = /^\}/.test(trimmed);
    var isCloseArr = /^\]/.test(trimmed);

    // open after key
    if (keyMatch && /\{,?$/.test(trimmed)) {
      typeStack.push('obj'); idxStack.push(0);
    } else if (keyMatch && /\[,?$/.test(trimmed)) {
      typeStack.push('arr'); idxStack.push(0);
    } else if (!keyMatch && /^\{/.test(trimmed)) {
      typeStack.push('obj'); idxStack.push(0);
    } else if (!keyMatch && /^\[/.test(trimmed) && !isCloseArr) {
      typeStack.push('arr'); idxStack.push(0);
    }

    if (isCloseObj || isCloseArr) {
      typeStack.pop(); idxStack.pop();
      if (pathStack.length) pathStack.pop();
      // advance array index if parent is array
      if (typeStack.length && typeStack[typeStack.length - 1] === 'arr') {
        idxStack[idxStack.length - 1]++;
        pathStack[pathStack.length - 1] = '[' + idxStack[idxStack.length - 1] + ']';
      }
    } else if (keyMatch) {
      // leaf value: pop key after recording
      var isLeaf = !/[\{\[]$/.test(trimmed);
      if (isLeaf) {
        pathStack.pop();
        if (typeStack.length && typeStack[typeStack.length - 1] === 'arr') {
          idxStack[idxStack.length - 1]++;
          if (pathStack.length) pathStack[pathStack.length - 1] = '[' + idxStack[idxStack.length - 1] + ']';
        }
      }
    } else if (!isCloseObj && !isCloseArr && typeStack.length && typeStack[typeStack.length - 1] === 'arr') {
      // array element (no key)
      var isLeafArr = !/[\{\[]$/.test(trimmed);
      if (isLeafArr && trimmed !== '') {
        idxStack[idxStack.length - 1]++;
        if (pathStack.length) pathStack[pathStack.length - 1] = '[' + idxStack[idxStack.length - 1] + ']';
      }
    }

    result.push({ text: line, linePaths: paths });
  });

  return result;
}

// ─── Diff render ──────────────────────────────────────────────────────────────
function renderDiff() {
  var container = document.getElementById('diff-columns');
  container.innerHTML = '';

  var parsed = panels.map(function(p) {
    try { return JSON.parse(p.cm.getValue()); } catch(e) { return null; }
  });

  var validParsed = parsed.filter(function(p) { return p !== null; });
  var diffSet = validParsed.length >= 2 ? diffPaths(validParsed) : new Set();

  var onlyDiff = document.getElementById('chk-only-diff').checked;

  var statsEl = document.getElementById('diff-stats');
  var errCount = parsed.filter(function(p) { return p === null; }).length;
  statsEl.textContent = diffSet.size + ' różnych ścieżek' +
    (errCount ? ' · ' + errCount + ' panel(i) z błędem JSON' : '');

  panels.forEach(function(panel, pi) {
    var col = document.createElement('div');
    col.className   = 'diff-col';
    col.style.flex      = '0 0 ' + colWidthPct + '%';
    col.style.minWidth  = '220px';

    var header = document.createElement('div');
    header.className   = 'diff-col-header';
    header.textContent = panel.nameEl.value || ('JSON ' + (pi + 1));
    col.appendChild(header);

    var body = document.createElement('div');
    body.className     = 'diff-body';
    body.dataset.colIdx = String(pi);

    var p = parsed[pi];
    if (p === null) {
      var err = document.createElement('div');
      err.style.cssText = 'padding:12px;color:var(--rem-text);font-family:var(--font-sans);font-size:12px';
      err.textContent = 'Błąd parsowania JSON';
      body.appendChild(err);
    } else {
      var annotated = annotateLines(p);
      var lineNum = 1;

      annotated.forEach(function(item) {
        var isDiff = false;
        item.linePaths.forEach(function(path) {
          if (diffSet.has(path)) isDiff = true;
        });

        if (onlyDiff && !isDiff) { lineNum++; return; }

        var row = document.createElement('div');
        row.className = 'diff-line ' + (isDiff ? 'line-changed' : 'line-same');

        if (isDiff) {
          var diffHere = [];
          item.linePaths.forEach(function(path) {
            if (diffSet.has(path)) diffHere.push(path);
          });
          row.title = diffHere.join('\n');
        }

        var numEl = document.createElement('div');
        numEl.className   = 'line-num';
        numEl.textContent = String(lineNum++);

        var contentEl = document.createElement('div');
        contentEl.className   = 'line-content';
        contentEl.textContent = item.text;

        row.appendChild(numEl);
        row.appendChild(contentEl);
        body.appendChild(row);
      });
    }

    col.appendChild(body);
    container.appendChild(col);
  });

  setupSyncScroll();
}

function setupSyncScroll() {
  var bodies = document.querySelectorAll('.diff-body');
  var syncing = false;
  bodies.forEach(function(b) {
    b.addEventListener('scroll', function() {
      if (syncing) return;
      syncing = true;
      bodies.forEach(function(other) {
        if (other !== b) { other.scrollTop = b.scrollTop; other.scrollLeft = b.scrollLeft; }
      });
      syncing = false;
    });
  });
}

// ─── Width ────────────────────────────────────────────────────────────────────
function applyWidth(pct) {
  colWidthPct = pct;
  document.querySelectorAll('.editor-card').forEach(function(el) {
    el.style.flex = '0 0 ' + pct + '%';
  });
  document.querySelectorAll('#diff-columns .diff-col').forEach(function(el) {
    el.style.flex = '0 0 ' + pct + '%';
  });
}

// ─── Save / load ──────────────────────────────────────────────────────────────
async function saveToCloud() {
  if (!supabase) {
    showToast('Brak konfiguracji Supabase — uzupełnij SUPABASE_URL i SUPABASE_KEY w app.js');
    return;
  }
  var btn = document.getElementById('btn-save');
  btn.disabled = true;
  btn.textContent = 'Zapisuję…';

  var data = panels.map(function(p) {
    return { name: p.nameEl.value, content: p.cm.getValue() };
  });

  var result = await supabase.from('json_diffs').insert([{ data: data }]).select('id');
  btn.disabled = false;
  btn.textContent = 'Zapisz i udostępnij';

  if (result.error) { showToast('Błąd zapisu: ' + result.error.message); return; }

  var url = location.origin + location.pathname + '?v=' + result.data[0].id;
  history.pushState({}, '', url);
  navigator.clipboard.writeText(url).catch(function() {});
  showToast('Link skopiowany do schowka!');
}

async function loadFromCloud(id) {
  if (!supabase) return;
  var result = await supabase.from('json_diffs').select('data').eq('id', id).single();
  if (result.error || !result.data) { showToast('Nie znaleziono danych'); return; }
  document.getElementById('editors-grid').innerHTML = '';
  panels.splice(0);
  result.data.data.forEach(function(item) { createPanel(item.content, item.name); });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
var toastTimer;
function showToast(msg) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { el.classList.add('hidden'); }, 3500);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function main() {
  supabase = await initSupabase();

  var params = new URLSearchParams(location.search);
  var vid    = params.get('v');

  if (vid && supabase) {
    await loadFromCloud(vid);
  } else {
    createPanel('', 'JSON A');
    createPanel('', 'JSON B');
  }

  document.getElementById('btn-add').addEventListener('click', function() {
    var letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    createPanel('', 'JSON ' + (letters[panels.length] || panels.length + 1));
  });

  document.getElementById('btn-compare').addEventListener('click', function() {
    document.getElementById('diff-section').classList.remove('hidden');
    diffVisible = true;
    renderDiff();
  });

  document.getElementById('btn-close-diff').addEventListener('click', function() {
    document.getElementById('diff-section').classList.add('hidden');
    diffVisible = false;
  });

  document.getElementById('btn-save').addEventListener('click', saveToCloud);

  document.getElementById('chk-only-diff').addEventListener('change', function() {
    if (diffVisible) renderDiff();
  });

  var slider   = document.getElementById('width-slider');
  var widthOut = document.getElementById('width-out');
  slider.addEventListener('input', function() {
    var v = Number(slider.value);
    widthOut.textContent = v + '%';
    applyWidth(v);
    if (diffVisible) renderDiff();
  });
}

main();
