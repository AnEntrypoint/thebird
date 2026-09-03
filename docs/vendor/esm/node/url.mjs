// Browser shim for node:url. Only the names freddie's bundle imports.
export function fileURLToPath(u) {
    const s = String(u);
    if (s.startsWith('file://')) return s.slice(7);
    return s;
}
export function pathToFileURL(p) {
    return new URL('file://' + String(p).replace(/^\/+/, '/'));
}
const _url = { fileURLToPath, pathToFileURL, URL };
export default _url;
