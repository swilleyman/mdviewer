(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('mdv:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('mdv:' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };

  const els = {
    main: $('#main'), editor: $('#editor'), preview: $('#preview'), previewPane: $('#previewPane'),
    docName: $('#docName'), dirty: $('#dirty'), stats: $('#stats'), saveState: $('#saveState'),
    menu: $('#menu'), btnMenu: $('#btnMenu'), toc: $('#toc'), tocList: $('#tocList'),
    fileInput: $('#fileInput'), drop: $('#drop'), toast: $('#toast'),
    urlDialog: $('#urlDialog'), urlInput: $('#urlInput'), themeColor: $('#themeColor'),
  };
  const WIDE = window.matchMedia('(min-width: 900px)');
  const DARK = window.matchMedia('(prefers-color-scheme: dark)');
  const MD_TYPES = [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.mkd'], 'text/plain': ['.txt'] } }];

  const WELCOME = `# Welcome to MD Viewer

A fast Markdown reader and editor that works **offline**, on desktop and phone.

## Getting started

- **Open** a file with the folder button, drag one onto the window, or use **⋮ → Open from URL**.
- Switch between **Edit** and **View** at the top. On wide screens, **Split** shows both.
- Your document is saved in this browser automatically. Use **⋮ → Save .md** to save a file.
- On Android, install it from **⋮ → Install app** (or Chrome's menu → *Add to Home screen*), then **share** any \`.md\` file to *MD Viewer* to open it.

## Shortcuts

| Keys | Action |
| --- | --- |
| <kbd>Ctrl</kbd> + <kbd>O</kbd> | Open file |
| <kbd>Ctrl</kbd> + <kbd>S</kbd> | Save |
| <kbd>Ctrl</kbd> + <kbd>E</kbd> | Toggle edit / view |

## What renders

GitHub-flavored Markdown: tables, ~~strikethrough~~, task lists, autolinks like https://example.com, and code with syntax highlighting.

- [x] Task lists
- [ ] Still to do

\`\`\`js
function greet(name) {
  return \`Hello, \${name}!\`;
}
\`\`\`

> Blockquotes look like this.

<details>
<summary>Collapsible sections work too</summary>

Hidden content, revealed on tap.

</details>
`;

  const state = {
    name: store.get('name', 'Welcome.md'),
    mode: store.get('mode', WIDE.matches ? 'split' : 'view'),
    theme: store.get('theme', 'auto'),
    scale: store.get('scale', 1),
    dirty: store.get('dirty', false),
    baseUrl: store.get('baseUrl', null),
    handle: null,
  };

  /* ---------- helpers ---------- */
  const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  let toastTimer;
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const baseName = (n) => n.replace(/\.(md|markdown|mdown|mkd|txt)$/i, '') || 'document';

  /* ---------- rendering ---------- */
  if (window.marked) marked.use({ gfm: true, breaks: false });

  function splitFrontMatter(src) {
    const m = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(src);
    return m ? { fm: m[1], body: src.slice(m[0].length) } : { fm: null, body: src };
  }

  function toHtml(src) {
    const { fm, body } = splitFrontMatter(src);
    let html = (window.marked && window.DOMPurify)
      ? DOMPurify.sanitize(marked.parse(body))
      : `<pre style="white-space:pre-wrap">${escapeHtml(body)}</pre>`;
    if (fm) html = `<details class="frontmatter"><summary>Front matter</summary><pre><code class="language-yaml">${escapeHtml(fm)}</code></pre></details>` + html;
    return html;
  }

  function slugify(text) {
    return text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-') || 'section';
  }

  function enhance(root) {
    const seen = new Map();
    root.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => {
      const base = slugify(h.textContent);
      const n = seen.get(base) || 0;
      seen.set(base, n + 1);
      h.id = n ? `${base}-${n}` : base;
    });
    root.querySelectorAll('pre code').forEach((code) => {
      if (window.hljs) {
        const lang = (code.className.match(/language-([\w+-]+)/) || [])[1];
        if (!lang || hljs.getLanguage(lang)) hljs.highlightElement(code);
      }
    });
    root.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      if (href.startsWith('#')) return;
      if (state.baseUrl && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
        try { a.href = new URL(href, state.baseUrl).href; } catch { /* leave as-is */ }
      }
      if (/^https?:/i.test(a.href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    });
    if (state.baseUrl) {
      root.querySelectorAll('img[src]').forEach((img) => {
        const src = img.getAttribute('src');
        if (!/^[a-z][a-z0-9+.-]*:/i.test(src)) { try { img.src = new URL(src, state.baseUrl).href; } catch { /* ignore */ } }
      });
    }
  }

  function addCopyButtons(root) {
    root.querySelectorAll('pre').forEach((pre) => {
      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.type = 'button';
      btn.textContent = 'Copy';
      pre.appendChild(btn);
    });
  }

  function render() {
    const src = els.editor.value;
    els.preview.innerHTML = toHtml(src);
    enhance(els.preview);
    addCopyButtons(els.preview);
    buildToc();
    const words = (src.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
    els.stats.textContent = `${words.toLocaleString()} words · ${Math.max(1, Math.round(words / 230))} min read`;
  }
  const renderSoon = debounce(render, 120);

  function buildToc() {
    const hs = [...els.preview.querySelectorAll('h1,h2,h3,h4')];
    els.tocList.innerHTML = hs.length ? '' : '<div class="empty">No headings in this document.</div>';
    const top = hs.length ? Math.min(...hs.map((h) => +h.tagName[1])) : 1;
    for (const h of hs) {
      const a = document.createElement('a');
      a.href = '#' + h.id;
      a.textContent = h.textContent;
      a.dataset.level = String(+h.tagName[1] - top + 1);
      els.tocList.appendChild(a);
    }
  }

  function scrollToId(id) {
    const target = document.getElementById(id);
    if (!target || !els.preview.contains(target)) return;
    if (effectiveMode() === 'edit') setMode('view');
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- document state ---------- */
  function setName(name) {
    state.name = name;
    els.docName.textContent = name;
    els.docName.title = name;
    document.title = `${name} · MD Viewer`;
    store.set('name', name);
  }
  function setDirty(d) {
    state.dirty = d;
    els.dirty.hidden = !d;
    store.set('dirty', d);
  }
  const persist = debounce(() => {
    store.set('text', els.editor.value);
    els.saveState.textContent = 'Saved in browser';
  }, 400);

  function loadDoc(text, name, { handle = null, baseUrl = null } = {}) {
    els.editor.value = text;
    state.handle = handle;
    state.baseUrl = baseUrl;
    store.set('baseUrl', baseUrl);
    store.set('text', text);
    setName(name);
    setDirty(false);
    render();
    els.previewPane.scrollTop = 0;
    els.editor.scrollTop = 0;
    if (effectiveMode() === 'edit') setMode('view');
    els.saveState.textContent = '';
  }

  const confirmDiscard = () => !state.dirty || confirm('You have unsaved changes. Discard them?');

  async function readFile(file, handle = null) {
    try {
      loadDoc(await file.text(), file.name || 'Untitled.md', { handle });
    } catch {
      toast("Couldn't read that file");
    }
  }

  /* ---------- modes, theme, scale ---------- */
  const effectiveMode = () => (state.mode === 'split' && !WIDE.matches ? 'view' : state.mode);
  function setMode(m, focus = false) {
    const prev = effectiveMode();
    const ratio = prev === 'edit' ? scrollRatio(els.editor) : scrollRatio(els.previewPane);
    state.mode = m;
    store.set('mode', m);
    applyMode();
    const now = effectiveMode();
    if (now !== prev) {
      if (now === 'edit' || now === 'split') setScrollRatio(els.editor, ratio);
      if (now !== 'edit') setScrollRatio(els.previewPane, ratio);
    }
    if (focus && now !== 'view') els.editor.focus({ preventScroll: true });
  }
  function applyMode() {
    const m = effectiveMode();
    els.main.dataset.mode = m;
    document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  }
  const scrollRatio = (el) => { const max = el.scrollHeight - el.clientHeight; return max > 0 ? el.scrollTop / max : 0; };
  const setScrollRatio = (el, r) => { el.style.scrollBehavior = 'auto'; el.scrollTop = r * (el.scrollHeight - el.clientHeight); el.style.scrollBehavior = ''; };

  const THEME_LABEL = { auto: 'Theme: match system', light: 'Theme: light', dark: 'Theme: dark' };
  function applyTheme() {
    const t = state.theme;
    if (t === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    const dark = t === 'dark' || (t === 'auto' && DARK.matches);
    $('#hljsLight').disabled = dark;
    $('#hljsDark').disabled = !dark;
    els.themeColor.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || (dark ? '#0f1115' : '#ffffff');
    $('#btnTheme').title = THEME_LABEL[t];
    $('#btnTheme').setAttribute('aria-label', THEME_LABEL[t]);
  }
  function cycleTheme() {
    state.theme = { auto: 'light', light: 'dark', dark: 'auto' }[state.theme];
    store.set('theme', state.theme);
    applyTheme();
    toast(THEME_LABEL[state.theme]);
  }
  function applyScale() {
    document.documentElement.style.setProperty('--md-scale', state.scale);
  }
  function changeScale(delta) {
    state.scale = Math.min(1.6, Math.max(0.8, Math.round((state.scale + delta) * 10) / 10));
    store.set('scale', state.scale);
    applyScale();
    toast(`Text size ${Math.round(state.scale * 100)}%`);
  }

  /* ---------- file actions ---------- */
  async function openFile() {
    if (!confirmDiscard()) return;
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({ types: MD_TYPES });
        await readFile(await handle.getFile(), handle);
      } catch (e) {
        if (e.name !== 'AbortError') els.fileInput.click();
      }
      return;
    }
    els.fileInput.click();
  }

  async function writeHandle(handle, text) {
    const w = await handle.createWritable();
    await w.write(text);
    await w.close();
  }

  async function save() {
    const text = els.editor.value;
    try {
      if (state.handle && state.handle.createWritable) {
        await writeHandle(state.handle, text);
      } else if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({ suggestedName: state.name, types: MD_TYPES });
        await writeHandle(handle, text);
        state.handle = handle;
        setName(handle.name);
      } else {
        download(new Blob([text], { type: 'text/markdown' }), state.name);
      }
      setDirty(false);
      toast(`Saved ${state.name}`);
    } catch (e) {
      if (e.name !== 'AbortError') {
        download(new Blob([text], { type: 'text/markdown' }), state.name);
        setDirty(false);
      }
    }
  }

  async function shareDoc() {
    const file = new File([els.editor.value], state.name, { type: 'text/markdown' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: state.name });
      else await navigator.share({ title: state.name, text: els.editor.value });
    } catch (e) {
      if (e.name !== 'AbortError') toast("Couldn't share");
    }
  }

  async function exportHtml() {
    let css = '';
    try {
      const dark = !$('#hljsDark').disabled;
      const [md, hl] = await Promise.all([
        fetch('md.css').then((r) => r.text()),
        fetch((dark ? $('#hljsDark') : $('#hljsLight')).href).then((r) => (r.ok ? r.text() : '')).catch(() => ''),
      ]);
      css = md + '\n' + hl;
    } catch { /* export without styles */ }
    const body = els.preview.cloneNode(true);
    body.querySelectorAll('.copy-btn').forEach((b) => b.remove());
    const themeAttr = state.theme === 'auto' ? '' : ` data-theme="${state.theme}"`;
    const html = `<!doctype html>
<html lang="en"${themeAttr}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(baseName(state.name))}</title>
<style>body{margin:0;background:var(--bg)}\n${css}</style>
</head>
<body>
<article class="md">
${body.innerHTML}
</article>
</body>
</html>`;
    download(new Blob([html], { type: 'text/html' }), baseName(state.name) + '.html');
  }

  function githubToRaw(url) {
    const m = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/i.exec(url);
    if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
    const g = /^https?:\/\/gist\.github\.com\/([^/]+)\/([0-9a-f]+)\/?$/i.exec(url);
    if (g) return `https://gist.githubusercontent.com/${g[1]}/${g[2]}/raw`;
    return url;
  }

  async function openUrl(input) {
    let url;
    try { url = new URL(githubToRaw(input.trim())).href; } catch { toast('That is not a valid URL'); return; }
    toast('Loading…');
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status);
      const text = await res.text();
      const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || 'remote.md');
      loadDoc(text, /\.\w+$/.test(last) ? last : last + '.md', { baseUrl: url });
      els.toast.classList.remove('show');
    } catch {
      toast("Couldn't load it — the site may block outside access");
    }
  }

  function newDoc() {
    if (!confirmDiscard()) return;
    loadDoc('', 'Untitled.md');
    setMode(WIDE.matches ? 'split' : 'edit', true);
  }

  /* ---------- menu & drawer ---------- */
  function toggleMenu(open = els.menu.hidden) {
    els.menu.hidden = !open;
    els.btnMenu.setAttribute('aria-expanded', String(open));
    if (open) els.menu.querySelector('button:not([hidden])').focus({ preventScroll: true });
  }
  function toggleToc(open = els.toc.hidden) {
    els.toc.hidden = !open;
    if (open) toggleMenu(false);
  }

  let installPrompt = null;
  const ACTIONS = {
    new: newDoc,
    open: openFile,
    url: () => { els.urlInput.value = ''; els.urlDialog.showModal(); },
    save,
    share: shareDoc,
    html: exportHtml,
    print: () => { if (effectiveMode() === 'edit') setMode('view'); setTimeout(() => window.print(), 50); },
    smaller: () => changeScale(-0.1),
    larger: () => changeScale(0.1),
    install: async () => {
      if (!installPrompt) return;
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      document.querySelector('[data-act="install"]').hidden = true;
    },
    welcome: () => { if (confirmDiscard()) loadDoc(WELCOME, 'Welcome.md'); },
  };

  /* ---------- events ---------- */
  els.editor.addEventListener('input', () => {
    if (!state.dirty) setDirty(true);
    els.saveState.textContent = '';
    renderSoon();
    persist();
  });
  els.editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      if (e.shiftKey) {
        const { selectionStart: s, value } = els.editor;
        const lineStart = value.lastIndexOf('\n', s - 1) + 1;
        const m = /^ {1,2}/.exec(value.slice(lineStart));
        if (m) { els.editor.setSelectionRange(lineStart, lineStart + m[0].length); document.execCommand('delete'); }
      } else {
        document.execCommand('insertText', false, '  ');
      }
    }
  });
  els.editor.addEventListener('scroll', () => {
    if (effectiveMode() === 'split') setScrollRatio(els.previewPane, scrollRatio(els.editor));
  }, { passive: true });

  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode, true)));
  $('#btnOpen').addEventListener('click', openFile);
  $('#btnTheme').addEventListener('click', cycleTheme);
  $('#btnToc').addEventListener('click', () => toggleToc());
  $('#tocClose').addEventListener('click', () => toggleToc(false));
  els.btnMenu.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
  els.menu.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const keepOpen = btn.dataset.act === 'smaller' || btn.dataset.act === 'larger';
    if (!keepOpen) toggleMenu(false);
    ACTIONS[btn.dataset.act]();
  });
  document.addEventListener('click', (e) => {
    if (!els.menu.hidden && !els.menu.contains(e.target)) toggleMenu(false);
  });

  els.tocList.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    e.preventDefault();
    if (!WIDE.matches) toggleToc(false);
    scrollToId(decodeURIComponent(a.hash.slice(1)));
  });

  els.preview.addEventListener('click', async (e) => {
    const copy = e.target.closest('.copy-btn');
    if (copy) {
      const code = copy.parentElement.querySelector('code') || copy.parentElement;
      try { await navigator.clipboard.writeText(code.innerText); copy.textContent = 'Copied'; }
      catch { copy.textContent = 'Failed'; }
      setTimeout(() => { copy.textContent = 'Copy'; }, 1400);
      return;
    }
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (href.startsWith('#')) {
      e.preventDefault();
      scrollToId(decodeURIComponent(href.slice(1)));
    } else if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      e.preventDefault();
      toast('Relative links can’t be opened here');
    }
  });

  els.fileInput.addEventListener('change', () => {
    const f = els.fileInput.files[0];
    if (f) readFile(f);
    els.fileInput.value = '';
  });

  els.urlDialog.addEventListener('close', () => {
    if (els.urlDialog.returnValue === 'ok' && els.urlInput.value) {
      if (confirmDiscard()) openUrl(els.urlInput.value);
    }
  });

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') { toggleMenu(false); toggleToc(false); }
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); save(); }
    else if (k === 'o') { e.preventDefault(); openFile(); }
    else if (k === 'e') { e.preventDefault(); setMode(effectiveMode() === 'view' ? (WIDE.matches ? 'split' : 'edit') : 'view', true); }
  });

  // Drag & drop
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; els.drop.hidden = false; } });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; els.drop.hidden = true; } });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    els.drop.hidden = true;
    const item = [...e.dataTransfer.items].find((i) => i.kind === 'file');
    if (!item || !confirmDiscard()) return;
    let handle = null;
    if (item.getAsFileSystemHandle) { try { handle = await item.getAsFileSystemHandle(); } catch { /* ignore */ } }
    readFile(item.getAsFile(), handle && handle.kind === 'file' ? handle : null);
  });

  WIDE.addEventListener('change', applyMode);
  DARK.addEventListener('change', applyTheme);

  // Warn before closing with unsaved edits (desktop browsers; text is still kept in browser storage).
  window.addEventListener('beforeunload', (e) => { if (state.dirty && state.handle) e.preventDefault(); });

  /* ---------- install / PWA integration ---------- */
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    document.querySelector('[data-act="install"]').hidden = false;
  });
  window.addEventListener('appinstalled', () => { document.querySelector('[data-act="install"]').hidden = true; toast('Installed'); });
  if (navigator.share) document.querySelector('[data-act="share"]').hidden = false;

  // "Open with" on desktop for the installed app
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
      if (!params.files || !params.files.length) return;
      const handle = params.files[0];
      await readFile(await handle.getFile(), handle);
    });
  }

  async function consumeShare() {
    if (!('caches' in window)) return false;
    try {
      const cache = await caches.open('mdviewer-share');
      const key = new URL('__share__', location.href).href;
      const res = await cache.match(key);
      if (!res) return false;
      const data = await res.json();
      await cache.delete(key);
      if (data.url) openUrl(data.url);
      else loadDoc(data.text || '', data.name || 'Shared.md');
      return true;
    } catch { return false; }
  }

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support unavailable */ });
  }

  /* ---------- start ---------- */
  async function start() {
    applyTheme();
    applyScale();
    applyMode();
    const params = new URLSearchParams(location.search);
    const saved = store.get('text', null);
    els.editor.value = saved === null ? WELCOME : saved;
    setName(state.name);
    setDirty(state.dirty);
    render();

    let handled = false;
    if (params.has('share')) handled = await consumeShare();
    if (!handled && params.get('url')) { handled = true; openUrl(params.get('url')); }
    if (params.toString()) history.replaceState(null, '', location.pathname);
    if (!window.marked) toast('Offline: showing plain text until the renderer loads');
  }
  start();
})();
