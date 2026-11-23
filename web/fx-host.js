import * as fs from './shims/fs.js';
import * as fsPromises from './shims/fs-promises.js';
import * as path from './shims/path.js';
import * as crypto from './shims/crypto.js';
import { Buffer } from './shims/buffer.js';
import { createHost } from './fx-host-core.js';

const wait = (ms, value) => new Promise((resolve) => setTimeout(resolve, ms, value));

export const host = createHost({
  host: 'thebird',
  modules: {
    fs,
    'fs/promises': fsPromises,
    path,
    crypto,
    buffer: { Buffer },
    'timers/promises': { setTimeout: wait, scheduler: { wait } },
  },
  tools: {
    read_file: ({ path: file }) => fs.readFileSync(file, 'utf8'),
    write_file: ({ path: file, content }) => {
      fs.writeFileSync(file, content);
      return 'wrote ' + file;
    },
    FetchURL: async ({ url }) => (await fetch(url)).text(),
  },
});

export const { version, capabilities, tools, verbs, modules } = host;
export default host;
