import { readdirSync, readFileSync } from './shims/fs.js';
import { posix } from './shims/path.js';

const WORKSPACE = '/workspace';
const CHUNK = 0x8000;

const toBase64 = (bytes) => {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  return btoa(binary);
};

const collectFiles = (root, prefix = '', files = {}) => {
  for (const entry of readdirSync(posix.join(root, prefix), { withFileTypes: true })) {
    const key = prefix + entry.name;
    if (entry.isDirectory()) collectFiles(root, `${key}/`, files);
    else if (entry.isFile()) files[key] = { encoding: 'base64', data: toBase64(new Uint8Array(readFileSync(posix.join(root, key)))) };
  }
  return files;
};

export async function publishWebserver({ id, title, description, dir }) {
  if (typeof dir !== 'string' || dir === '') throw new Error('publish needs the folder to publish, for example /workspace/ha');
  const root = posix.resolve(WORKSPACE, dir);
  const files = collectFiles(root);
  const response = await fetch(new URL('/__thebird/registry', self.location.origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, title, description, files }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text || `thebird registry: HTTP ${response.status}`);
  return JSON.parse(text);
}
