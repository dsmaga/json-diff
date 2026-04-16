/**
 * JSON Diff — app.js
 * CodeMirror 5 + N-way deep diff via material paths
 *
 * prettyLines: JSON.stringify(val, null, 2) → lines,
 *   each line gets a material path reconstructed via an indent-based stack.
 *
 * Highlighting: exact match in diffSet only (no ancestor coloring).
 */

const SUPABASE_URL = '__SUPABASE_URL__';
const SUPABASE_KEY = '__SUPABASE_ANON_KEY__';

const panels    = [];
let supabase    = null;
let diffVisible = false;
let colWidthPct = 50;

async function initSupabase() {
  if (SUPABASE_URL === '__SUPABASE_URL__') return null;
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

// ─── Panel ─────────────────────────────────────────────────────────────────────
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

  const nameEl    = card.querySelector('.editor-name');
  const statusEl  = card.querySelector('.editor-status');
  const removeBtn = card.querySelector('.btn-remove');
  const ta        = card.querySelector('.editor-ta');
  nameEl.value = initialName;

  // Must be in DOM before CodeMirror init
  document.getElementById('editors-grid').appendChild(card);

  const cm = CodeMirror.fromTextArea(ta, {
    mode: { name: 'javascript', json: true },
    theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'material' : 'default',
    lineNumbers: true,
    matchBrackets: true,
    foldGutter: true,
    gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
    lineWrapping: false,
    tabSize: 2,
    extraKeys: { 'Ctrl-Q': cm => cm.foldCode(cm.getCursor()) },
  });
  cm.setSize('100%', '260px');
  cm.setValue(initialContent);
  cm.refresh();
  cm.on('change', () => { validateCm(cm, statusEl); if (diffVisible) renderDiff(); });
  nameEl.addEventListener('input', () => { if (diffVisible) renderDiff(); });
  validateCm(cm, statusEl);

  removeBtn.addEventListener('click', () => {
    card.remove();
    const i = panels.findIndex(p => p.id === id);
    if (i !== -1) panels.splice(i, 1);
    if (diffVisible) renderDiff();
  });

  panels.push({ id, nameEl, cm });
}

function validateCm(cm, statusEl) {
  try {
    const t = cm.getValue().trim();
    if (t) JSON.parse(t);
    statusEl.textContent = 'JSON ok';
    statusEl.className   = 'editor-status status-ok';
  } catch {
    statusEl.textContent = 'błąd JSON';
    statusEl.className   = 'editor-status status-err';
  }
}

// ─── flatten: val → Map<materialPath, serializedLeaf> ──────────────────────────
function flatten(val, prefix) {
  if (prefix === undefined) prefix = '';
  const out = new Map();
  if (val === null || typeof val !== 'object') {
    out.set(prefix, JSON.stringify(val));
    return out;
  }
  if (Array.isArray(val)) {
    if (val.length === 0) { out.set(prefix, '[]'); return out; }
    val.forEach((item, i) => {
      flatten(item, prefix ? `${prefix}[${i}]` : `[${i}]`)
        .forEach((v, k) => out.set(k, v));
    });
    return out;
  }
  const keys = Object.keys(val);
  if (keys.length === 0) { out.set(prefix, '{}'); return out; }
  keys.forEach(k => {
    flatten(val[k], prefix ? `${prefix}.${k}` : k)
      .forEach((v, kk) => out.set(kk, v));
  });
  return out;
}

// ─── nwayDiff: N maps → Set<path> of paths that differ ─────────────────────────
function nwayDiff(maps) {
  const allPaths = new Set();
  maps.forEach(m => m.forEach((_, k) => allPaths.add(k)));
  const diffSet = new Set();
  allPaths.forEach(path => {
    const vals = maps.map(m => m.get(path));
    if (vals.some(v => v !== vals[0])) diffSet.add(path);
  });
  return diffSet;
}

// ─── prettyLines: val → [{ text, path }] ───────────────────────────────────────
// Use JSON.stringify so lines match exactly what the user sees.
// Reconstruct path by tracking a stack (path, indent, arrayIndex).
// Stack entry: { path, type: 'obj'|'arr', idx: number }
function prettyLines(val) {
  const raw   = JSON.stringify(val, null, 2);
  const lines = raw.split('\n');

  // stack[top] = current container
  const stack = [];
  // Result
  const result = [];

  // Helper: current base path (container)
  function parentPath() {
    return stack.length ? stack[stack.length - 1].path : '';
  }

  lines.forEach(line => {
    const trimmed  = line.trim();
    const indent   = line.match(/^(\s*)/)[1].length;
    const indentU  = indent / 2; // indent level in units

    // ── Closing bracket ──
    // Line starts with } or ]
    if (/^[}\]]/.test(trimmed)) {
      // closing line path = container path
      const top = stack.length ? stack[stack.length - 1] : null;
      result.push({ text: line, path: top ? top.path : '' });
      stack.pop();
      // If parent is array — increment idx
      if (stack.length && stack[stack.length - 1].type === 'arr') {
        stack[stack.length - 1].idx++;
      }
      return;
    }

    // ── Key: "key": value or "key": { or "key": [
    const keyMatch = trimmed.match(/^"((?:[^"\\]|\\.)*)"\s*:/);
    if (keyMatch) {
      const key      = keyMatch[1];
      const parent   = parentPath();
      const fullPath = parent ? `${parent}.${key}` : key;

      const rest = trimmed.slice(keyMatch[0].length).trim().replace(/,$/, '');

      if (rest === '{') {
        result.push({ text: line, path: fullPath });
        stack.push({ path: fullPath, type: 'obj', idx: 0 });
      } else if (rest === '[') {
        result.push({ text: line, path: fullPath });
        stack.push({ path: fullPath, type: 'arr', idx: 0 });
      } else {
        // leaf — path is fullPath
        result.push({ text: line, path: fullPath });
      }
      return;
    }

    // ── Array element (no key)
    if (stack.length && stack[stack.length - 1].type === 'arr') {
      const top      = stack[stack.length - 1];
      const fullPath = `${top.path}[${top.idx}]`;

      const rest = trimmed.replace(/,$/, '');
      if (rest === '{') {
        result.push({ text: line, path: fullPath });
        stack.push({ path: fullPath, type: 'obj', idx: 0 });
      } else if (rest === '[') {
        result.push({ text: line, path: fullPath });
        stack.push({ path: fullPath, type: 'arr', idx: 0 });
      } else {
        result.push({ text: line, path: fullPath });
        top.idx++;
      }
      return;
    }

    // ── Root opening { or [
    if (trimmed === '{') {
      result.push({ text: line, path: '' });
      stack.push({ path: '', type: 'obj', idx: 0 });
      return;
    }
    if (trimmed === '[') {
      result.push({ text: line, path: '' });
      stack.push({ path: '', type: 'arr', idx: 0 });
      return;
    }

    // Fallback
    result.push({ text: line, path: parentPath() });
  });

  return result;
}

// ─── Render diff ───────────────────────────────────────────────────────────────
function renderDiff() {
  const container = document.getElementById('diff-columns');
  container.innerHTML = '';

  const parsed = panels.map(p => {
    try { return JSON.parse(p.cm.getValue()); } catch { return null; }
  });

  const validParsed = parsed.filter(p => p !== null);
  const flatMaps    = validParsed.map(p => flatten(p));
  const diffSet     = flatMaps.length >= 2 ? nwayDiff(flatMaps) : new Set();
  const onlyDiff    = document.getElementById('chk-only-diff').checked;
  const errCount    = parsed.filter(p => p === null).length;

  document.getElementById('diff-stats').textContent =
    `${diffSet.size} różnych ścieżek` +
    (errCount ? ` · ${errCount} panel(i) z błędem JSON` : '');

  panels.forEach((panel, pi) => {
    const col = document.createElement('div');
    col.className  = 'diff-col';
    col.style.flex     = `0 0 ${colWidthPct}%`;
    col.style.minWidth = '220px';

    const header = document.createElement('div');
    header.className   = 'diff-col-header';
    header.textContent = panel.nameEl.value || `JSON ${pi + 1}`;
    col.appendChild(header);

    const body = document.createElement('div');
    body.className = 'diff-body';

    const p = parsed[pi];
    if (p === null) {
      const err = document.createElement('div');
      err.style.cssText = 'padding:12px;color:var(--rem-text);font-size:12px';
      err.textContent = 'Błąd parsowania JSON';
      body.appendChild(err);
    } else {
      const pLines = prettyLines(p);
      pLines.forEach(({ text, path }, li) => {
        // Highlight only if path is directly in diffSet
        // (differing leaf) — no ancestor/container highlighting
        const diff = diffSet.has(path);
        if (onlyDiff && !diff) return;

        const row = document.createElement('div');
        row.className = `diff-line ${diff ? 'line-changed' : 'line-same'}`;
        if (diff) row.title = path;

        const numEl = document.createElement('div');
        numEl.className   = 'line-num';
        numEl.textContent = String(li + 1);

        const contentEl = document.createElement('div');
        contentEl.className   = 'line-content';
        contentEl.textContent = text;

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
  const bodies = document.querySelectorAll('.diff-body');
  let syncing = false;
  bodies.forEach(b => {
    b.addEventListener('scroll', () => {
      if (syncing) return;
      syncing = true;
      bodies.forEach(o => {
        if (o !== b) { o.scrollTop = b.scrollTop; o.scrollLeft = b.scrollLeft; }
      });
      syncing = false;
    });
  });
}

function applyWidth(pct) {
  colWidthPct = pct;
  document.querySelectorAll('.editor-card').forEach(
    el => { el.style.flex = `0 0 ${pct}%`; }
  );
  document.querySelectorAll('#diff-columns .diff-col').forEach(
    el => { el.style.flex = `0 0 ${pct}%`; }
  );
}

async function saveToCloud() {
  if (!supabase) { showToast('Brak konfiguracji Supabase'); return; }
  const btn = document.getElementById('btn-save');
  btn.disabled = true; btn.textContent = 'Zapisuję…';
  const data = panels.map(p => ({ name: p.nameEl.value, content: p.cm.getValue() }));
  const { data: rows, error } = await supabase
    .from('json_diffs').insert([{ data }]).select('id');
  btn.disabled = false; btn.textContent = 'Zapisz i udostępnij';
  if (error) { showToast('Błąd: ' + error.message); return; }
  const url = `${location.origin}${location.pathname}?v=${rows[0].id}`;
  history.pushState({}, '', url);
  navigator.clipboard.writeText(url).catch(() => {});
  showToast('Link skopiowany!');
}

async function loadFromCloud(id) {
  if (!supabase) return;
  const { data, error } = await supabase
    .from('json_diffs').select('data').eq('id', id).single();
  if (error || !data) { showToast('Nie znaleziono'); return; }
  document.getElementById('editors-grid').innerHTML = '';
  panels.splice(0);
  data.data.forEach(item => createPanel(item.content, item.name));
}

let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

async function main() {
  supabase = await initSupabase();
  const vid = new URLSearchParams(location.search).get('v');
  if (vid && supabase) {
    await loadFromCloud(vid);
  } else {
    createPanel('', 'JSON A');
    createPanel('', 'JSON B');
  }

  document.getElementById('btn-add').addEventListener('click', () => {
    const l = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    createPanel('', 'JSON ' + (l[panels.length] || panels.length + 1));
  });
  document.getElementById('btn-compare').addEventListener('click', () => {
    document.getElementById('diff-section').classList.remove('hidden');
    diffVisible = true;
    renderDiff();
  });
  document.getElementById('btn-close-diff').addEventListener('click', () => {
    document.getElementById('diff-section').classList.add('hidden');
    diffVisible = false;
  });
  document.getElementById('btn-save').addEventListener('click', saveToCloud);
  document.getElementById('chk-only-diff').addEventListener('change', () => {
    if (diffVisible) renderDiff();
  });

  const slider   = document.getElementById('width-slider');
  const widthOut = document.getElementById('width-out');
  slider.addEventListener('input', () => {
    const v = Number(slider.value);
    widthOut.textContent = v + '%';
    applyWidth(v);
    if (diffVisible) renderDiff();
  });
}

main();
