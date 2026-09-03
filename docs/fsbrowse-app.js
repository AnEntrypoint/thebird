// fsbrowse-in-thebird: a browser-native file browser over the per-instance IDB
// filesystem. fsbrowse (c:/dev/fsbrowse) is a Node/Express REST server; thebird
// has no Node backend, so this reuses fsbrowse's data shape + UX but talks
// directly to instance.fs (the IndexedDB-backed flat path->string store). The fs
// is per-instance (per-SW isolation), so each workspace sees its own files.
//
// thebird-owned functional module — visual styles live upstream in
// anentrypoint-design/src/kits/os/theme.css under .ds-247420 .fsb-* selectors
// (zero-design-CSS-in-thebird rule).

import { iconMarkup } from './vendor/components/shell.js';
import { t } from './vendor/i18n.js';

// Icons come from the upstream kit (no emoji/glyph literals in thebird source).
const ICON_NAME = { dir: 'folder', file: 'file', up: 'corner-up-left' };
function icon(name) { const s = document.createElement('span'); s.className = 'fsb-ic'; s.innerHTML = iconMarkup(name); return s; }
function fmtSize(n) { if (n == null) return ''; if (n < 0) return '(error)'; if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(1) + ' K'; return (n / 1048576).toFixed(1) + ' M'; }
function norm(p) { const s = String(p || '').replace(/^\/+|\/+$/g, ''); return s.split('/').some(seg => seg === '..') ? '' : s; }
function join(a, b) { a = norm(a); b = norm(b); return a ? (b ? a + '/' + b : a) : b; }
function parent(p) { p = norm(p); const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
function base(p) { p = norm(p); const i = p.lastIndexOf('/'); return i < 0 ? p : p.slice(i + 1); }

// Derive immediate children (dirs + files) of a directory from the flat key set.
function listDir(fs, dir) {
  dir = norm(dir);
  const prefix = dir ? dir + '/' : '';
  const dirs = new Set();
  const files = [];
  let keys = [];
  try { keys = fs.list(''); } catch (e) { return [{ __error: true, message: (e && e.message) || String(e), type: 'error' }]; }
  for (const key of keys) {
    const k = norm(key);
    if (prefix && !k.startsWith(prefix)) continue;
    const rest = k.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf('/');
    if (slash < 0) {
      // -1 marks an unreadable file so the row shows '(error)' rather than a
      // misleading '0 B' that looks identical to a genuinely empty file.
      let size = 0; try { const content = fs.readFile(k); size = content ? content.length : 0; } catch { size = -1; }
      files.push({ name: rest, type: 'file', path: k, size });
    } else {
      dirs.add(rest.slice(0, slash));
    }
  }
  const out = [...dirs].sort().map(d => ({ name: d, type: 'dir', path: join(dir, d) }));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return out.concat(files);
}

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null) n.setAttribute(k, v);
  }
  for (const kid of kids) { if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
  return n;
}

// Styled <dialog> replacements for native prompt()/confirm()/alert(), reusing
// the same .tb-sess-modal classes session-ui.js's buildOverlay established
// (theme, focus-trap, ESC-to-close all come from that upstream CSS/native
// <dialog> behavior — no thebird-side styling here).
function buildDialog(title, bodyNode, actions) {
  const opener = document.activeElement;
  const dialog = el('dialog', { class: 'tb-sess-modal' });
  const head = el('div', { class: 'tb-sess-modal-head' }, el('span', { class: 'tb-sess-modal-title' }, title));
  const closeBtn = el('button', { class: 'tb-sess-modal-x', type: 'button', 'aria-label': t('fsbrowse.closeModal', 'Close') });
  closeBtn.innerHTML = iconMarkup('x');
  head.append(closeBtn);
  const body = el('div', { class: 'tb-sess-modal-body' }, bodyNode);
  const foot = el('div', { class: 'tb-sess-modal-foot' });
  for (const a of actions) {
    const b = el('button', {
      class: 'tb-sess-modal-btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''),
      type: 'button',
      onclick: () => a.onClick(close),
    }, a.label);
    foot.append(b);
  }
  dialog.append(head, body, foot);
  document.body.append(dialog);
  function close() { dialog.close(); }
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (document.activeElement === document.body || !document.activeElement) {
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
    }
  }, { once: true });
  dialog.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      const prim = foot.querySelector('.primary');
      if (prim) { e.preventDefault(); prim.click(); }
    }
  });
  closeBtn.addEventListener('click', close);
  dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
  dialog.showModal();
  requestAnimationFrame(() => { const i = body.querySelector('input,textarea,select'); if (i) i.focus(); });
  return { dialog, close };
}

// Styled prompt() replacement -> Promise<string|null>.
function promptDialog(title, defaultValue) {
  return new Promise(resolve => {
    const input = el('input', { class: 'tb-sess-modal-input', type: 'text', value: defaultValue || '' });
    const body = el('div', {}, input);
    let settled = false;
    const finish = v => { if (!settled) { settled = true; resolve(v); } };
    const { close } = buildDialog(title, body, [
      { label: t('fsbrowse.cancel', 'cancel'), onClick: c => { finish(null); c(); } },
      { label: t('fsbrowse.ok', 'ok'), primary: true, onClick: c => { finish(input.value); c(); } },
    ]);
    input.closest('dialog').addEventListener('close', () => finish(null), { once: true });
  });
}

// Styled confirm() replacement -> Promise<boolean>.
function confirmDialog(message) {
  return new Promise(resolve => {
    const body = el('div', { class: 'tb-sess-modal-msg' }, message);
    let settled = false;
    const finish = v => { if (!settled) { settled = true; resolve(v); } };
    const { dialog } = buildDialog(t('fsbrowse.confirmTitle', 'Confirm'), body, [
      { label: t('fsbrowse.cancel', 'cancel'), onClick: c => { finish(false); c(); } },
      { label: t('fsbrowse.ok', 'ok'), primary: true, danger: true, onClick: c => { finish(true); c(); } },
    ]);
    dialog.addEventListener('close', () => finish(false), { once: true });
  });
}

export function createFsbrowseApp({ instance } = {}) {
  if (!instance || !instance.fs) {
    const fallbackShell = (typeof window !== 'undefined' && window.__debug && window.__debug.shell) || null;
    instance = (fallbackShell && fallbackShell.active) || instance || {};
  }
  const fs = instance.fs;
  const root = el('div', { class: 'fsb-root', 'data-fsbrowse': instance.id || '?' });
  let cwd = '';
  let openedFile = null;

  const crumbs = el('div', { class: 'fsb-crumbs' });
  const list = el('div', { class: 'fsb-list' });
  const bar = el('div', { class: 'fsb-bar' },
    el('button', { class: 'fsb-btn', title: t('fsbrowse.up', 'up'), onclick: () => { cwd = parent(cwd); render(); } }, icon(ICON_NAME.up)),
    crumbs,
    el('button', { class: 'fsb-btn', title: t('fsbrowse.newFolder', 'new folder'), onclick: mkdir }, icon('folder'), ' ' + t('fsbrowse.folder', 'folder')),
    el('button', { class: 'fsb-btn', title: t('fsbrowse.newFile', 'new file'), onclick: newFile }, icon('file'), ' ' + t('fsbrowse.file', 'file')),
    el('button', { class: 'fsb-btn', title: t('fsbrowse.upload', 'upload'), onclick: upload }, icon('upload'), ' ' + t('fsbrowse.upload', 'upload')),
    el('button', { class: 'fsb-btn', title: t('fsbrowse.refresh', 'refresh'), onclick: () => render() }, icon('refresh')),
  );
  root.append(bar, list);

  function renderCrumbs() {
    crumbs.textContent = '';
    const parts = norm(cwd).split('/').filter(Boolean);
    crumbs.append(el('a', { class: 'fsb-crumb', onclick: () => { cwd = ''; render(); } }, '/'));
    let acc = '';
    for (const part of parts) {
      acc = join(acc, part);
      const here = acc;
      crumbs.append(el('span', { class: 'fsb-crumb-sep' }, '/'), el('a', { class: 'fsb-crumb', onclick: () => { cwd = here; render(); } }, part));
    }
  }

  // Binary-file heuristic: check extension against a known-binary list first
  // (cheap, no content read needed), then fall back to sniffing the first
  // 1024 chars of already-read content for null bytes / high non-printable
  // ratio -- same signal fsbrowse's readFile already produced, no new read.
  const BINARY_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'zip', 'gz', 'tar', 'exe', 'dll', 'wasm', 'pdf', 'woff', 'woff2', 'ttf', 'otf', 'mp3', 'mp4', 'wav', 'ogg', 'sqlite', 'db']);
  // Image extension -> MIME map for <img> preview; upload() stores binary
  // content base64-encoded with a 'data:base64,' marker prefix (see upload()),
  // so preview decodes that marker back to a Blob/object URL rather than
  // guessing from raw bytes.
  const IMAGE_EXT_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
  function isImagePath(path) {
    const ext = base(path).split('.').pop().toLowerCase();
    return Object.prototype.hasOwnProperty.call(IMAGE_EXT_MIME, ext);
  }
  const DATA_B64_PREFIX = 'data:base64,';
  // Decode this module's own upload()-written convention (raw bytes read via
  // FileReader.readAsDataURL, stored verbatim as 'data:<mime>;base64,<data>'
  // strings) OR the legacy internal marker back into a Blob object URL.
  function imageObjectUrl(path, content) {
    if (typeof content !== 'string') return null;
    if (content.startsWith('data:')) {
      // Already a full data URL (upload() convention below) -- usable as-is,
      // no re-encoding needed.
      return content;
    }
    return null;
  }
  function looksBinary(path, content) {
    const ext = base(path).split('.').pop().toLowerCase();
    if (BINARY_EXTS.has(ext)) return true;
    if (typeof content !== 'string' || !content.length) return false;
    const sample = content.slice(0, 1024);
    if (sample.indexOf('\u0000') >= 0) return true;
    let nonPrintable = 0;
    for (let i = 0; i < sample.length; i++) {
      const c = sample.charCodeAt(i);
      if (c < 9 || (c > 13 && c < 32) || c === 127) nonPrintable++;
    }
    return nonPrintable / sample.length > 0.1;
  }

  function openFile(path) {
    openedFile = path;
    let content = ''; try { content = fs.readFile(path); } catch (e) { content = '(' + (e.message || 'error') + ')'; }
    list.textContent = '';
    if (looksBinary(path, content)) {
      if (isImagePath(path)) {
        const objUrl = imageObjectUrl(path, content);
        if (objUrl) {
          const img = el('img', { class: 'fsb-img-preview', alt: base(path), src: objUrl });
          img.style.maxWidth = '100%';
          list.append(
            el('div', { class: 'fsb-bar' },
              el('button', { class: 'fsb-btn', onclick: () => render() }, icon('chevron-left'), ' ' + t('fsbrowse.back', 'back')),
              el('span', { class: 'fsb-name' }, '/' + path),
              el('button', { class: 'fsb-btn', onclick: () => download(path) }, icon('download'), ' ' + t('fsbrowse.download', 'download'))),
            el('div', { class: 'fsb-empty' }, img),
          );
          return;
        }
      }
      list.append(
        el('div', { class: 'fsb-bar' },
          el('button', { class: 'fsb-btn', onclick: () => render() }, icon('chevron-left'), ' ' + t('fsbrowse.back', 'back')),
          el('span', { class: 'fsb-name' }, '/' + path)),
        el('div', { class: 'fsb-empty' },
          t('fsbrowse.binaryFile', 'This looks like a binary file and cannot be previewed as text.'),
          el('div', {},
            el('button', { class: 'fsb-btn', onclick: () => download(path) }, icon('download'), ' ' + t('fsbrowse.download', 'download')))),
      );
      return;
    }
    list.append(
      el('div', { class: 'fsb-bar' },
        el('button', { class: 'fsb-btn', onclick: () => render() }, icon('chevron-left'), ' ' + t('fsbrowse.back', 'back')),
        el('span', { class: 'fsb-name' }, '/' + path),
        el('button', { class: 'fsb-btn', onclick: () => download(path) }, icon('download'), ' ' + t('fsbrowse.download', 'download')),
        el('button', { class: 'fsb-btn', onclick: () => saveEdit(path) }, icon('check'), ' ' + t('fsbrowse.save', 'save'))),
      (function () { const ta = el('textarea', { class: 'fsb-view', spellcheck: 'false' }); ta.value = content; return ta; })(),
    );
  }
  // saveEdit grabs the live textarea from the DOM (the editor is single-instance
  // per open file), so callers pass only the path — no stale element ref.
  function saveEdit(path) {
    const ta = list.querySelector('textarea.fsb-view'); if (!ta) return;
    try { fs.writeFile(path, ta.value); if (fs.flush) fs.flush(); flash(t('fsbrowse.savedPath', 'saved /{path}', { path })); }
    catch (e) { flash(t('fsbrowse.saveFailed', 'save failed: {error}', { error: (e && e.message || e) })); }
  }

  function download(path) {
    let content = ''; try { content = fs.readFile(path); } catch (e) { flash(t('fsbrowse.downloadFailed', 'download failed: {error}', { error: (e && e.message || e) })); return; }
    const blob = new Blob([content], { type: 'application/octet-stream' });
    const a = el('a', { href: URL.createObjectURL(blob), download: base(path) });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  async function mkdir() {
    const name = await promptDialog(t('fsbrowse.newFolderNamePrompt', 'new folder name')); if (!name || !name.trim()) return;
    if (name.length > 255) { flash(t('fsbrowse.nameTooLong', 'name too long (max 255 characters)')); return; }
    if (name.includes('/')) { flash(t('fsbrowse.nameNoSlash', 'name cannot contain "/"')); return; }
    // directories are implicit; create a .keep marker so the empty dir shows
    fs.writeFile(join(cwd, norm(name) + '/.keep'), ''); if (fs.flush) fs.flush(); render();
  }
  async function newFile() {
    const name = await promptDialog(t('fsbrowse.newFileNamePrompt', 'new file name')); if (!name || !name.trim()) return;
    if (name.length > 255) { flash(t('fsbrowse.nameTooLong', 'name too long (max 255 characters)')); return; }
    if (name.includes('/')) { flash(t('fsbrowse.nameNoSlash', 'name cannot contain "/"')); return; }
    const p = join(cwd, norm(name)); if (fs.exists(p)) { flash(t('fsbrowse.exists', 'exists')); return; }
    fs.writeFile(p, ''); if (fs.flush) fs.flush(); render();
  }
  // The confirm/prompt dialogs are async, so `entry` can go stale between
  // opening the dialog and the user answering it (another window/instance on
  // the same fs deletes or moves it meanwhile). Re-check existence against
  // the live fs right before acting; if it's gone, reconcile the view instead
  // of attempting an op against a path that no longer resolves.
  function stillExists(entry) {
    if (entry.type === 'file') return fs.exists(entry.path);
    const pfx = norm(entry.path) + '/';
    return fs.list('').map(norm).some(k => k.startsWith(pfx));
  }
  async function rename(entry) {
    const srcDir = cwd; // capture cwd before the await — user may navigate elsewhere while the dialog is open
    const next = await promptDialog(t('fsbrowse.renamePrompt', 'rename {name} to', { name: entry.name }), entry.name); if (!next || next === entry.name) return;
    if (!stillExists(entry)) { render(); flash(t('fsbrowse.goneRefreshed', '{name} no longer exists — refreshed', { name: entry.name })); return; }
    const np = join(srcDir, norm(next));
    const errs = []; let attempted = 0;
    if (entry.type === 'file') {
      attempted = 1;
      try {
        const body = fs.readFile(entry.path);
        fs.writeFile(np, body);
        try { fs.unlink(entry.path); } catch (e) {
          // Rollback: remove the new copy if we cannot remove the original.
          try { fs.unlink(np); } catch { /* rollback is best-effort; the original error is rethrown regardless */ }
          throw e;
        }
      } catch (e) { errs.push(entry.path + ': ' + (e && e.message || e)); }
    } else { // rename dir: move every key under it
      // Read all first, then write all, then delete all — so a write failure
      // leaves the old files intact and a delete failure only orphans old copies
      // (recoverable) rather than creating corrupt half-renamed state.
      const pfx = norm(entry.path) + '/';
      const toMove = fs.list('').map(norm).filter(k => k.startsWith(pfx));
      attempted = toMove.length;
      const reads = [];
      for (const k of toMove) {
        try { reads.push({ k, body: fs.readFile(k) }); }
        catch (e) { errs.push(k + ': read: ' + (e && e.message || e)); }
      }
      if (!errs.length) {
        const written = [];
        for (const { k, body } of reads) {
          const dest = join(np, k.slice(pfx.length));
          try { fs.writeFile(dest, body); written.push({ k, dest }); }
          catch (e) {
            errs.push(k + ': write: ' + (e && e.message || e));
            // Rollback written files on first write failure.
            for (const { dest: d } of written) { try { fs.unlink(d); } catch { /* rollback is best-effort; the write error is already recorded */ } }
            break;
          }
        }
        if (!errs.length) {
          const currentKeys = fs.list('').map(norm).filter(k => k.startsWith(pfx));
          const newFiles = currentKeys.filter(k => !toMove.includes(k));
          if (newFiles.length) {
            errs.push(t('fsbrowse.concurrentWriteDetected', 'concurrent write detected: {count} new file(s) appeared under {path} during rename; aborting delete phase', { count: newFiles.length, path: entry.path }));
            for (const { k } of reads) { try { fs.unlink(join(np, k.slice(pfx.length))); } catch { /* abort-cleanup is best-effort; orphan copies are recoverable */ } }
          } else {
            for (const { k } of reads) { try { fs.unlink(k); } catch (e) { errs.push(k + ': delete: ' + (e && e.message || e)); } }
          }
        }
      }
    }
    if (fs.flush) fs.flush(); render();
    if (errs.length) flash(t('fsbrowse.renameResult', 'rename: {failed} of {attempted} file(s) failed ({ok} ok): {errs} (click to dismiss)', { failed: errs.length, attempted, ok: (attempted - errs.length), errs: errs.join(', ') }), true);
  }
  async function del(entry) {
    if (!await confirmDialog(t('fsbrowse.deleteConfirm', 'delete {name}?', { name: entry.name }))) return;
    if (!stillExists(entry)) { render(); flash(t('fsbrowse.goneRefreshed', '{name} no longer exists — refreshed', { name: entry.name })); return; }
    const errs = []; let attempted = 0;
    if (entry.type === 'file') { attempted = 1; try { fs.unlink(entry.path); } catch (e) { errs.push(entry.path + ': ' + (e && e.message || e)); } }
    else { const pfx = norm(entry.path) + '/'; for (const k of fs.list('').map(norm)) if (k.startsWith(pfx)) { attempted++; try { fs.unlink(k); } catch (e) { errs.push(k + ': ' + (e && e.message || e)); } } }
    if (fs.flush) fs.flush(); render();
    if (errs.length) flash(t('fsbrowse.deleteResult', 'delete: {failed} of {attempted} file(s) failed ({ok} ok): {errs}', { failed: errs.length, attempted, ok: (attempted - errs.length), errs: errs.slice(0, 3).join(', ') }));
  }
  // No documented size limit existed before this pass, against unbounded
  // IndexedDB growth (per-origin quotas vary by browser but are commonly
  // hundreds of MB to low GB -- a single 10MB asset is a conservative,
  // non-arbitrary ceiling that still leaves headroom for many assets).
  const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
  function readFileForStore(file) {
    // Images (by extension) are stored as full data URLs so fsbrowse can
    // preview them directly via <img src> without a separate decode step;
    // everything else keeps the existing as-text convention.
    if (isImagePath(file.name)) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('read failed'));
        reader.readAsDataURL(file);
      });
    }
    return file.text();
  }
  async function uploadFiles(fileList) {
    const oversized = [];
    for (const file of fileList) {
      const name = base(file.name); if (!name) continue;
      if (file.size > MAX_UPLOAD_BYTES) { oversized.push(name); continue; }
      const content = await readFileForStore(file);
      fs.writeFile(join(cwd, name), content);
    }
    if (fs.flush) fs.flush(); render();
    if (oversized.length) {
      flash(t('fsbrowse.uploadTooLarge', '{count} file(s) exceeded the 10MB upload limit and were skipped: {names}', { count: oversized.length, names: oversized.join(', ') }), true);
    }
  }
  function upload() {
    const inp = el('input', { type: 'file', multiple: 'true' });
    inp.addEventListener('change', () => uploadFiles(inp.files));
    inp.click();
  }
  function flash(msg, persistent) {
    const f = el('div', { class: 'fsb-empty' }, msg); list.prepend(f);
    if (persistent) { f.addEventListener('click', () => f.remove()); }
    else { setTimeout(() => f.remove(), 1500); }
  }

  // drag-drop upload
  root.addEventListener('dragover', e => { e.preventDefault(); root.classList.add('fsb-dropping'); });
  root.addEventListener('dragleave', () => root.classList.remove('fsb-dropping'));
  root.addEventListener('drop', e => {
    e.preventDefault(); root.classList.remove('fsb-dropping');
    // OS-file drops (e.dataTransfer.files) only -- drags originating from an
    // fsbrowse row itself carry no e.dataTransfer.files (see dragstart below),
    // so this never misfires on an in-app asset drag.
    if (e.dataTransfer.files && e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  });

  function render() {
    openedFile = null;
    renderCrumbs();
    list.textContent = '';
    const entries = listDir(fs, cwd).filter(e => !(e.type === 'file' && e.name === '.keep'));
    if (entries.length === 1 && entries[0].__error) { list.append(el('div', { class: 'fsb-error' }, t('fsbrowse.filesystemError', 'Filesystem error: {message}', { message: entries[0].message }))); return; }
    if (!entries.length) { list.append(el('div', { class: 'fsb-empty' }, t('fsbrowse.emptyFolder', '(empty folder -- use the new-file/new-folder buttons or drop files)'))); return; }
    for (const entry of entries) {
      const activate = () => { if (entry.type === 'dir') { cwd = entry.path; render(); } else openFile(entry.path); };
      // Rows are interactive: keyboard-reachable (role=button + tabindex) and
      // Enter/Space activate, so navigation isn't mouse-only.
      const row = el('div', {
        class: 'fsb-row', role: 'button', tabindex: '0',
        'aria-label': entry.type === 'dir' ? t('fsbrowse.openFolderAria', 'Open folder {name}', { name: entry.name }) : t('fsbrowse.openFileAria', 'Open file {name}', { name: entry.name }),
        onclick: activate,
        onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); activate(); } },
        // Files (not dirs) are draggable so they can be dropped onto other
        // thebird apps (e.g. the level editor canvas). A custom MIME type
        // carries just the fs path -- the receiving app reads content via
        // instance.fs itself rather than the drag payload carrying bytes.
        draggable: entry.type === 'file' ? 'true' : undefined,
        ondragstart: entry.type === 'file' ? (ev) => { ev.dataTransfer.setData('text/thebird-asset-path', entry.path); ev.dataTransfer.effectAllowed = 'copy'; } : undefined,
      },
        el('span', { class: 'fsb-icon' }, icon(ICON_NAME[entry.type] || 'file')),
        el('span', { class: 'fsb-name' }, entry.name),
        el('span', { class: 'fsb-size' }, entry.type === 'file' ? fmtSize(entry.size) : ''),
        el('span', { class: 'fsb-actions' },
          el('button', { class: 'fsb-act', title: t('fsbrowse.rename', 'rename'), 'aria-label': t('fsbrowse.renameAria', 'Rename {name}', { name: entry.name }), onclick: (ev) => { ev.stopPropagation(); rename(entry); } }, icon('pencil')),
          el('button', { class: 'fsb-act', title: t('fsbrowse.delete', 'delete'), 'aria-label': t('fsbrowse.deleteAria', 'Delete {name}', { name: entry.name }), onclick: (ev) => { ev.stopPropagation(); del(entry); } }, icon('trash'))));
      list.append(row);
    }
  }

  render();

  if (typeof window !== 'undefined') {
    window.__debug = window.__debug || {}; window.__debug.instances = window.__debug.instances || {};
    window.__debug.instances[instance.id] = window.__debug.instances[instance.id] || {};
    window.__debug.instances[instance.id].fsbrowse = { root, get cwd() { return cwd; }, refresh: render, listDir: (d) => listDir(fs, d) };
  }
  return {
    node: root,
    dispose: () => { root.textContent = ''; },
    getViewState() { return { cwd: norm(cwd), openedFile: openedFile || null }; },
    restoreViewState(s) {
      if (!s || typeof s.cwd !== 'string') return;
      const next = norm(s.cwd);
      // If the persisted dir no longer exists (deleted since snapshot), fall
      // back to root rather than showing a misleading '(empty folder)'.
      let exists = !next;
      if (next) { try { exists = fs.list('').some(k => norm(k).startsWith(next + '/') || norm(k) === next); } catch { /* list failure means we cannot confirm the dir; treat as missing and fall back to root */ } }
      cwd = exists ? next : '';
      render();
      // Reopen the file the user was editing, if it still exists.
      if (s.openedFile && typeof s.openedFile === 'string') {
        const normalizedPath = norm(s.openedFile);
        let fileExists = false; try { fileExists = normalizedPath && fs.exists(normalizedPath); } catch { /* exists-probe failure => treat as gone; parent-dir fallback below handles it */ }
        if (fileExists) openFile(normalizedPath);
        else { cwd = parent(normalizedPath) || ''; flash(t('fsbrowse.restoredFileDeleted', 'Restored file was deleted, navigating to parent dir')); render(); }
      }
    },
  };
}
