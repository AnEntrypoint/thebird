// notes-app: a simple markdown/plain-text notes app backed by the per-instance
// IndexedDB filesystem (instance.fs). Reuses fsbrowse-app.js's approach for
// reading/writing files (fs.list/readFile/writeFile/unlink/flush) rather than
// reinventing a storage layer — notes are just files under 'notes/' with a
// .md extension.
//
// thebird-owned functional module — no design CSS here (zero-design-CSS rule);
// classNames are plain/functional, reusing 'fsb-*' + 'os-btn' conventions
// already visually themed upstream so this needs no new CSS.
//
// SECURITY: note content is rendered via textContent only (list titles, and
// preview through a minimal escaping+regex markdown-lite renderer that never
// touches innerHTML with raw user text) — no innerHTML of unescaped user input.

import { iconMarkup } from './vendor/components/shell.js';
import { shortUid } from './vendor/uid.js';
import { renderMarkdown } from './vendor/markdown.js';
import { t } from './vendor/i18n.js';
import { setIcon, el, confirmDialog } from './lib/dom.js';

const DIR = 'notes';

function icon(name) { const s = document.createElement('span'); s.className = 'fsb-ic'; setIcon(s, name); return s; }

// Markdown preview rendering is delegated to the shared design-repo renderer
// (vendor/markdown.js renderMarkdown): it lazy-loads marked+DOMPurify for full
// markdown, and safe-fails to an escape-first pass (escapeHtml + <br>) when the
// CDN is unavailable — the same escape-first-so-no-raw-tag-reaches-innerHTML
// guarantee the old local renderMarkdownLite made, just centralized upstream.
// Adapter: notes-app's preview is synchronous DOM (textarea input handler), so
// renderMarkdownPreview() fires the async render and applies it to `preview`
// only if this call is still the latest (guards out-of-order resolution while
// typing fast).
function renderMarkdownPreview(preview, src) {
  preview.__mdToken = (preview.__mdToken || 0) + 1;
  const token = preview.__mdToken;
  renderMarkdown(src).then((html) => {
    if (preview.__mdToken === token) preview.innerHTML = html;
  });
}

function norm(p) { return String(p || '').replace(/^\/+|\/+$/g, ''); }
function titleFromPath(p) { const base = norm(p).split('/').pop() || ''; return base.replace(/\.md$/, ''); }

function firstLineTitle(content) {
  const line = String(content || '').split('\n')[0].trim();
  return line.replace(/^#+\s*/, '').slice(0, 60);
}

export function createNotesApp({ instance } = {}) {
  if (!instance || !instance.fs) {
    const fallbackShell = (typeof window !== 'undefined' && window.__debug && window.__debug.shell) || null;
    instance = (fallbackShell && fallbackShell.active) || instance || {};
  }
  const fs = instance.fs;
  const root = el('div', { class: 'fsb-root', 'data-notes': instance.id || '?' });

  let current = null; // path of currently open note, or null (list view)
  let dirty = false;
  let loadFailed = false; // true when the currently open note's content failed to read — blocks save to avoid clobbering it with blank content

  function listNotes() {
    let keys = [];
    try { keys = fs.list(''); } catch { /* swallow: fs.list unavailable/failed, treat as no notes yet */ keys = []; }
    const prefix = DIR + '/';
    return keys
      .map(norm)
      .filter(k => k.startsWith(prefix) && k.endsWith('.md'))
      .sort()
      .reverse();
  }

  function newNotePath() {
    // Date.now() alone collides when two notes are created within the same
    // millisecond (e.g. rapid double-click/double-invoke of "new"), silently
    // aliasing the second write onto the first note's file. Append a random
    // suffix and verify uniqueness against the existing note list so every
    // created path is guaranteed distinct.
    let existing = null;
    for (let i = 0; i < 5; i++) {
      const ts = Date.now();
      const suffix = shortUid(6);
      const path = DIR + '/' + ts + '-' + suffix + '.md';
      if (existing === null) { try { existing = new Set(listNotes()); } catch { /* swallow: listNotes failed, assume no collisions and fall back to an empty set */ existing = new Set(); } }
      if (!existing.has(path)) return path;
    }
    return DIR + '/' + Date.now() + '-' + shortUid(8) + '.md';
  }

  function flash(msg) {
    const f = el('div', { class: 'fsb-empty' }, msg);
    root.prepend(f);
    setTimeout(() => f.remove(), 1500);
  }

  // Navigating away from a dirty editor (back button, opening a different
  // note, or delete-while-editing) used to silently discard in-memory edits:
  // `dirty` was tracked but never consulted before the navigation mutated
  // `current`/re-rendered. Every navigation path now routes through this
  // guard, which auto-saves the currently-open textarea (if any and if
  // dirty) before proceeding — mirrors the existing explicit Save button's
  // fs.writeFile+flush path so no separate confirm-and-lose-work UI is
  // needed. No-op when there's nothing dirty to save.
  async function saveIfDirtyBeforeNav() {
    if (!dirty || !current || loadFailed) return;
    const ta = root.querySelector('textarea.fsb-view');
    if (!ta) return;
    await saveCurrent(ta);
  }

  async function openNote(path) {
    await saveIfDirtyBeforeNav();
    current = path;
    dirty = false;
    render();
  }

  // fs.flush() is async (debounced IDB persist settling); the writeFile/unlink
  // calls above it are synchronous against the in-memory snapshot, but if we
  // don't await the flush promise a page reload immediately after save/delete/
  // create can race the underlying IDB write and lose the change. All three
  // callers below await this helper so a reload right after save/delete/create
  // is guaranteed to observe the persisted state.
  async function doFlush() { if (fs.flush) { try { await fs.flush(); } catch { /* swallow: best-effort IDB flush, in-memory write already applied so a failure here is non-fatal */ } } }

  async function saveCurrent(ta) {
    if (!current) return;
    if (loadFailed) { flash(t('notes.saveBlockedLoadFailed', "can't save: note failed to load, saving would erase it")); return; }
    try {
      fs.writeFile(current, ta.value);
      await doFlush();
      dirty = false;
      flash(t('notes.saved', 'saved'));
    } catch (e) { flash(t('notes.saveFailed', 'save failed: ') + (e && e.message || e)); }
  }

  async function deleteNote(path) {
    const ok = await confirmDialog({
      title: t('notes.confirmDeleteTitle', 'Delete Note'),
      message: t('notes.confirmDelete', 'Delete this note?'),
      confirmLabel: t('notes.delete', 'Delete'),
      cancelLabel: t('session.cancel', 'Cancel'),
    });
    if (!ok) return;
    // Invalidate the open editor's dirty state for this path *before* the
    // unlink so a saveCurrent() that raced the confirm-dialog await window
    // (e.g. a blur-triggered save firing while the dialog was open) cannot
    // observe dirty===true after we've committed to deleting and silently
    // recreate the file via fs.writeFile immediately after unlink.
    if (current === path) { dirty = false; current = null; }
    try { fs.unlink(path); await doFlush(); } catch (e) { flash(t('notes.deleteFailed', 'delete failed: ') + (e && e.message || e)); }
    render();
  }

  async function createNote() {
    const path = newNotePath();
    try { fs.writeFile(path, '# New note\n\n'); await doFlush(); } catch (e) { flash(t('notes.createFailed', 'create failed: ') + (e && e.message || e)); return; }
    openNote(path);
  }

  function renderList() {
    root.textContent = '';
    const bar = el('div', { class: 'fsb-bar' },
      el('span', { class: 'fsb-name' }, t('notes.title', 'Notes')),
      el('button', { class: 'fsb-btn', title: t('notes.newNote', 'new note'), onclick: createNote }, icon('file'), ' ' + t('notes.new', 'new')),
      el('button', { class: 'fsb-btn', title: t('notes.refresh', 'refresh'), onclick: () => render() }, icon('refresh')));
    const listEl = el('div', { class: 'fsb-list' });
    root.append(bar, listEl);

    const notes = listNotes();
    if (!notes.length) {
      listEl.append(el('div', { class: 'fsb-empty' }, t('notes.empty', '(no notes yet — click "new" to create one)')));
      return;
    }
    for (const path of notes) {
      let content = '';
      let readFailed = false;
      try { content = fs.readFile(path); } catch { /* note file missing/unreadable: show blank preview + inline error indicator rather than failing the whole list render */ content = ''; readFailed = true; }
      const title = firstLineTitle(content) || titleFromPath(path);
      const activate = () => openNote(path);
      const nameText = (title || t('notes.untitled', '(untitled)')) +
        (readFailed ? ' ' + t('notes.readFailedShort', '(failed to load)') : '');
      const row = el('div', {
        class: 'fsb-row', role: 'button', tabindex: '0',
        'aria-label': t('notes.openNoteAria', 'Open note ') + title + (readFailed ? ' — ' + t('notes.readFailed', 'failed to load note contents') : ''),
        onclick: activate,
        onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); activate(); } },
      },
        el('span', { class: 'fsb-icon' }, icon('file-text')),
        el('span', { class: 'fsb-name', title: readFailed ? t('notes.readFailed', 'failed to load note contents') : undefined }, nameText),
        el('span', { class: 'fsb-actions' },
          el('button', { class: 'fsb-act', title: t('notes.delete', 'delete'), 'aria-label': t('notes.deleteNoteAria', 'Delete ') + title, onclick: (ev) => { ev.stopPropagation(); deleteNote(path); } }, icon('trash'))));
      listEl.append(row);
    }
  }

  function renderEditor() {
    root.textContent = '';
    let content = '';
    loadFailed = false;
    try { content = fs.readFile(current); } catch (e) {
      content = '';
      loadFailed = true;
      flash(t('notes.loadFailed', 'failed to load note: ') + (e && e.message || e));
    }

    const ta = el('textarea', { class: 'fsb-view', spellcheck: 'false' });
    ta.value = content;
    ta.disabled = loadFailed;

    const preview = el('div', { class: 'fsb-list' });
    function updatePreview() { renderMarkdownPreview(preview, ta.value); }
    updatePreview();

    ta.addEventListener('input', () => { dirty = true; updatePreview(); });

    const bar = el('div', { class: 'fsb-bar' },
      el('button', { class: 'fsb-btn', onclick: async () => { await saveIfDirtyBeforeNav(); current = null; render(); } }, icon('chevron-left'), ' ' + t('notes.back', 'back')),
      el('span', { class: 'fsb-name' }, titleFromPath(current) || t('notes.untitled', '(untitled)')),
      el('button', { class: 'fsb-btn', title: t('notes.save', 'save'), disabled: loadFailed, onclick: () => saveCurrent(ta) }, icon('check'), ' ' + t('notes.save', 'save')),
      el('button', { class: 'fsb-btn', title: t('notes.delete', 'delete'), onclick: () => deleteNote(current) }, icon('trash')));

    const split = el('div', { class: 'fsb-list' }, ta, preview);
    root.append(bar, split);
  }

  function render() {
    if (current) renderEditor();
    else renderList();
  }

  render();

  if (typeof window !== 'undefined') {
    window.__debug = window.__debug || {}; window.__debug.instances = window.__debug.instances || {};
    window.__debug.instances[instance.id] = window.__debug.instances[instance.id] || {};
    window.__debug.instances[instance.id].notes = { root, listNotes, get current() { return current; }, refresh: render };
  }

  return {
    node: root,
    dispose: () => { root.textContent = ''; },
    getViewState() { return { current: current || null }; },
    restoreViewState(s) {
      if (!s) return;
      if (s.current && typeof s.current === 'string') {
        let exists = false;
        try { exists = fs.exists(s.current); } catch { /* swallow: fs.exists check failed, treat the note as missing and fall back to list view */ }
        current = exists ? s.current : null;
      } else current = null;
      render();
    },
  };
}
