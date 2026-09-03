// Whole-workspace zip export/import for an instance's filesystem (docs/instance-fs.js).
// Uses the already-vendored fflate (docs/vendor/esm/fflate.mjs, fetched via esm.sh,
// see docs/vendor/esm/manifest.json) for zipSync/unzipSync -- no new dependency.

export const IGNORED_PATTERNS = [/node_modules\//];

let fflatePromise = null;
function loadFflate() {
    if (!fflatePromise) {
        fflatePromise = import('../vendor/esm/fflate.mjs').then(m =>
            m.zipSync ? m : (m.default && m.default.zipSync ? m.default : m)
        );
    }
    return fflatePromise;
}

function isIgnored(path, patterns) {
    return patterns.some(re => re.test(path));
}

const toBytes = data => (typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data));

/**
 * Export every stored file in instance.fs into a single zip Blob.
 * @param {object} instance - has .fs with list(prefix)/readFile(path)
 * @param {object} [opts]
 * @param {RegExp[]} [opts.ignore] - additional ignore patterns (merged with IGNORED_PATTERNS)
 * @returns {Promise<Blob>}
 */
export async function exportWorkspaceZip(instance, opts = {}) {
    if (!instance || !instance.fs) throw new Error('exportWorkspaceZip: instance.fs required');
    const { zipSync } = await loadFflate();
    const patterns = IGNORED_PATTERNS.concat(opts.ignore || []);
    const paths = instance.fs.list('');
    const files = {};
    for (const path of paths) {
        if (isIgnored(path, patterns)) continue;
        if (path.endsWith('/')) continue; // directory marker, nothing to store
        let content;
        try {
            content = instance.fs.readFile(path);
        } catch (err) {
            console.error('[zip-workspace] skipping unreadable path', path, err);
            continue;
        }
        // zipSync keys are zip entry paths; strip any leading slash for portability.
        const entryPath = String(path).replace(/^\//, '');
        files[entryPath] = [toBytes(content), { level: 6 }];
    }
    const zipped = zipSync(files, { level: 6 });
    return new Blob([zipped], { type: 'application/zip' });
}

/**
 * Export the workspace zip and immediately trigger a browser download.
 * @param {object} instance
 * @param {string} [filename]
 * @param {object} [opts] - forwarded to exportWorkspaceZip
 */
export async function exportWorkspaceZipDownload(instance, filename = 'workspace.zip', opts = {}) {
    const blob = await exportWorkspaceZip(instance, opts);
    const url = URL.createObjectURL(blob);
    try {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
    } finally {
        // Give the download a tick to start before revoking (Safari/Firefox
        // can otherwise cancel an in-flight download when the URL dies).
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return blob;
}

/**
 * Import every file entry from a zip Blob into instance.fs, overwriting
 * existing paths. Directory entries (paths ending in '/') are skipped.
 * @param {object} instance - has .fs with writeFile(path, data)
 * @param {Blob} zipBlob
 * @returns {Promise<string[]>} list of paths written
 */
export async function importWorkspaceZip(instance, zipBlob) {
    if (!instance || !instance.fs) throw new Error('importWorkspaceZip: instance.fs required');
    const { unzipSync } = await loadFflate();
    const buf = new Uint8Array(await zipBlob.arrayBuffer());
    const entries = unzipSync(buf);
    const written = [];
    const decoder = new TextDecoder();
    for (const [entryPath, bytes] of Object.entries(entries)) {
        if (!entryPath || entryPath.endsWith('/')) continue; // directory entry
        const path = entryPath.startsWith('/') ? entryPath : '/' + entryPath;
        instance.fs.writeFile(path, decoder.decode(bytes));
        written.push(path);
    }
    return written;
}
