import { dirname, resolve } from './shims/path.js';
const SPECIFIER = "(fx:host(?:/[\\w/]+)?|node:[\\w/]+)";
const STATIC_IMPORT = new RegExp("^import\\s+(?:(\\*\\s+as\\s+[\\w$]+)|([\\w$]+)|\\{([^}]*)\\}|([\\w$]+)\\s*,\\s*\\{([^}]*)\\})\\s+from\\s+['\"]" + SPECIFIER + "['\"];?", 'gm');

const destructure = (names) => '{ ' + names.split(',').map((name) => name.trim()).filter(Boolean).map((name) => name.replace(/\s+as\s+/, ': ')).join(', ') + ' }';

export const hostImports = (source) => source.replace(STATIC_IMPORT, (match, namespace, whole, named, mixedWhole, mixedNamed, specifier) => {
  const load = 'require(' + JSON.stringify(specifier) + ')';
  if (namespace) return 'const ' + namespace.replace(/^\*\s+as\s+/, '') + ' = ' + load + ';';
  if (whole) return 'const ' + whole + ' = ' + load + ';';
  if (named !== undefined) return 'const ' + destructure(named) + ' = ' + load + ';';
  return 'const ' + mixedWhole + ' = ' + load + '; const ' + destructure(mixedNamed) + ' = ' + mixedWhole + ';';
});

export const MIRROR_ROOT = '/.thebird-host';
const RELATIVE_IMPORT = /(\bfrom\s+|^import\s+)(['"])(\.{1,2}\/[^'"]+)\2/gm;

export const mirrorRelativeImports = (source, fromDir, fs, seen = new Set()) => source.replace(RELATIVE_IMPORT, (match, lead, quote, specifier) => lead + quote + mirrorFile(resolve(fromDir, specifier), fs, seen) + quote);

function mirrorFile(file, fs, seen) {
  const target = MIRROR_ROOT + file;
  if (!seen.has(file)) {
    seen.add(file);
    const source = hostImports(mirrorRelativeImports(fs.readFileSync(file, 'utf8'), dirname(file), fs, seen));
    fs.mkdirSync(dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
  }
  return target;
}
