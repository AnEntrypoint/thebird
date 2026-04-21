export async function mirrorFromSandbox(fsBase) {
  try {
    const listRes = await fetch(fsBase + '/__list');
    if (!listRes.ok) return [];
    const relFiles = await listRes.json();
    const snap = window.__debug.idbSnapshot || (window.__debug.idbSnapshot = {});
    const mirrored = [];
    for (const rel of relFiles) {
      const r = await fetch(fsBase + '/' + rel);
      if (!r.ok) continue;
      const content = await r.text();
      if (snap[rel] !== content) { snap[rel] = content; mirrored.push(rel); }
    }
    if (mirrored.length) {
      window.__debug.idbPersist?.();
      window.__debug.shell?.onPreviewWrite?.();
      window.showPreview?.();
      window.refreshPreview?.();
    }
    return mirrored;
  } catch (e) { return []; }
}
