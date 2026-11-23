import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mirrorRelativeImports } from '../web/host-imports.js';

const memoryFs = (files) => ({
  files,
  readFileSync: (path) => {
    if (!(path in files)) throw new Error('ENOENT ' + path);
    return files[path];
  },
  writeFileSync: (path, data) => {
    files[path] = data;
  },
  mkdirSync: () => {},
});

test('a relative import is mirrored, its copy has the fx:host import rewritten, and the entry points at the copy', () => {
  const fs = memoryFs({
    '/workspace/sib/dep.mjs': "import host from 'fx:host';\nexport const joined = host.modules.path.join('a', 'b');\n",
  });
  const entry = mirrorRelativeImports("import dep, { joined } from './dep.mjs';\n", '/workspace/sib', fs);
  assert.equal(entry, "import dep, { joined } from '/.thebird-host/workspace/sib/dep.mjs';\n");
  assert.equal(fs.files['/.thebird-host/workspace/sib/dep.mjs'], 'const host = require("fx:host");\nexport const joined = host.modules.path.join(\'a\', \'b\');\n');
});

test('a cycle between two sibling modules mirrors each once and terminates', () => {
  const fs = memoryFs({
    '/w/a.mjs': "import './b.mjs';\nexport const a = 1;\n",
    '/w/b.mjs': "import { a } from './a.mjs';\nexport const b = a;\n",
  });
  mirrorRelativeImports(fs.files['/w/a.mjs'], '/w', fs);
  assert.deepEqual(Object.keys(fs.files).filter((key) => key.startsWith('/.thebird-host')).sort(), ['/.thebird-host/w/a.mjs', '/.thebird-host/w/b.mjs']);
});

test('a module without relative imports is not changed by the mirror', () => {
  const fs = memoryFs({});
  assert.equal(mirrorRelativeImports("import x from 'lodash';\n", '/w', fs), "import x from 'lodash';\n");
  assert.deepEqual(Object.keys(fs.files), []);
});
