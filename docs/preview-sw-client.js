const SW_PATH = new URL('./preview-sw.js', import.meta.url).href;
const SCOPE = new URL('./preview/', import.meta.url).href;

window.__debug = window.__debug || {};
window.__debug.sw = { registered: false, error: null };

export async function registerPreviewSW() {
  if (!('serviceWorker' in navigator)) {
    window.__debug.sw.error = 'unsupported';
    throw new Error('ServiceWorker not supported');
  }
  try {
    const reg = await navigator.serviceWorker.register(SW_PATH, { scope: SCOPE });
    await navigator.serviceWorker.ready;
    window.__debug.sw.registered = true;
    window.__debug.sw.registration = reg;
    return reg;
  } catch (err) {
    window.__debug.sw.error = err.message;
    throw err;
  }
}

registerPreviewSW();
