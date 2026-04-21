export function extractCodeBlocks(text) {
  const out = [];
  const re = /```(\w+)?(?:\s+([^\n`]+))?\n([\s\S]*?)```/g;
  let m, idx = 0;
  while ((m = re.exec(text))) {
    const lang = (m[1] || '').toLowerCase();
    const hint = (m[2] || '').trim();
    const code = m[3];
    const name = pickName(lang, hint, code, idx++);
    out.push({ name, lang, code });
  }
  return out;
}
function pickName(lang, hint, code, idx) {
  if (hint && /\.\w+$/.test(hint)) return hint.replace(/^[./]+/, '');
  if (lang === 'html' || /<!DOCTYPE|<html/i.test(code)) return idx === 0 ? 'index.html' : `file-${idx}.html`;
  if (lang === 'css') return idx === 0 ? 'styles.css' : `file-${idx}.css`;
  if (lang === 'js' || lang === 'javascript') return idx === 0 ? 'app.js' : `file-${idx}.js`;
  if (lang === 'json') return idx === 0 ? 'data.json' : `file-${idx}.json`;
  return `snippet-${idx}.txt`;
}
export function applyExtracted(blocks) {
  const snap = window.__debug.idbSnapshot || (window.__debug.idbSnapshot = {});
  const written = [];
  for (const b of blocks) {
    if (snap[b.name] !== b.code) { snap[b.name] = b.code; written.push(b.name); }
  }
  if (written.length) { window.__debug.idbPersist?.(); window.__debug.shell?.onPreviewWrite?.(); }
  return written;
}
