// Browser shim for node:os.
export function homedir() { return '/home/thebird'; }
export function platform() { return 'browser'; }
export function arch() { return 'wasm'; }
export function tmpdir() { return '/tmp'; }
export function cpus() { return [{ model: 'browser', speed: 0 }]; }
export const EOL = '\n';
const _os = { homedir, platform, arch, tmpdir, cpus, EOL };
export default _os;
