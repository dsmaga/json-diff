# JSON Diff

Compare up to N named JSON files side-by-side with deep diff highlighting, collapsible sections, and shareable links.

## Features

- Unlimited named JSON editors
- Deep N-way diff: a path is highlighted if it differs across **any** two panels
- Missing keys treated as differences
- "Differences only" filter with context
- Synchronized scrolling across all columns
- Adjustable column width (20–100%)
- Save to Supabase + shareable link
- Auto dark mode

---

## Deployment: GitHub Pages + Supabase

### 1. Supabase — database setup

1. Create a free account at [supabase.com](https://supabase.com)
2. Create a new project
3. In **SQL Editor** run:

```sql
create table json_diffs (
  id   uuid default gen_random_uuid() primary key,
  data jsonb not null,
  created_at timestamptz default now()
);

alter table json_diffs enable row level security;

create policy "anon insert"
  on json_diffs for insert to anon
  with check (true);

create policy "anon select"
  on json_diffs for select to anon
  using (true);
```

4. Go to **Settings → API Keys** → **Legacy anon, service_role API keys** and copy:
   - `Project URL`
   - `anon` / `public` key

---

### 2. Configure the app

Open `app.js` and replace the placeholders at the top:

```js
const SUPABASE_URL = 'https://your-project.supabase.co';
const SUPABASE_KEY = 'eyJ...';
```

The `anon` key is safe to commit — it is designed for browser use and protected by RLS policies. Consider adding a periodic cleanup job to avoid hitting the 500 MB free tier limit:

```sql
delete from json_diffs where created_at < now() - interval '30 days';
```

---

### 3. GitHub Pages

1. Create a new repository on GitHub (public or private)
2. Push the four files:
   ```
   index.html
   style.css
   app.js
   README.md
   ```
3. Go to **Settings → Pages**
4. Under **Source** select:
   - Branch: `main`
   - Folder: `/ (root)`
5. Click **Save**

The app will be live at:
```
https://your-username.github.io/repo-name/
```

---

## File structure

```
├── index.html   — HTML structure
├── style.css    — styles (light/dark mode)
├── app.js       — diff engine, CodeMirror 5, Supabase
└── README.md
```

## Dependencies (loaded from CDN, no build step)

| Library | Version | Purpose |
|---|---|---|
| CodeMirror | 5.65.16 | JSON editor with line numbers and folding |
| @supabase/supabase-js | 2 | save/load via Supabase |

## Diff algorithm

1. **`flatten(val)`** — recursively reduces a JSON value to `Map<materialPath, serializedLeaf>`, e.g. `trial.enabled → "false"`
2. **`nwayDiff(maps[])`** — unions all paths across panels; a path is added to `diffSet` if its value (or presence) differs between any two panels
3. **`prettyLines(val)`** — walks the object tree in parallel with `JSON.stringify` output, assigning each line exactly one material path via an indent-based stack
4. A line is highlighted if and only if its path is directly in `diffSet` (no ancestor coloring)

## Supabase free tier limits

- 500 MB database storage
- 50,000 requests / month
- Project pauses after 1 week of inactivity (resume from dashboard)
