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
