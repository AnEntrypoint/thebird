// Lazy-load manifest for shell builtins (t4-builtins-manifest).
//
// docs/ has no bundler and no build step (bunx serve docs) -- every file here
// is a plain ES module and the browser's native `import()` is a real dynamic
// import, not a bundler-rewritten one. Before this manifest, shell-builtins.js
// statically imported shell-builtins-{text,extra,util,fs,system}.js (and
// shell-python-pyodide.js) at module-eval time, and shell.js statically imported
// shell-node.js -- which itself statically imports ~30 shell-node-*.js
// Node-emulation modules -- meaning every terminal boot paid for parsing/
// evaluating ALL of that regardless of which commands (if any) a session
// actually ran.
//
// This file is pure data: it maps each dispatchable non-core command name to
// the "group" module that implements it, and maps each group to a dynamic
// import() thunk + the exported factory name that turns `(ctx, readFile,
// writeFile)` into that group's `{ name: fn, ... }` builtins object. Nothing
// here imports a group module eagerly -- COMMAND_MANIFEST is enumerable
// (for tab-completion / `which` / `command -v` / future `help` output /
// witness coverage scripts) WITHOUT ever triggering a single import().
//
// The small always-on core (ls/cat/echo/pwd/cd/mkdir/rm/cp/mv/touch/imgcat/
// head/tail/wc) stays defined directly in shell-builtins.js itself -- it's
// cheap, and shell-builtins.js is already the unavoidable entry point loaded
// by shell.js, so "lazy-loading" it would buy nothing.
export const GROUP_LOADERS = {
  text: { loader: () => import('./shell-builtins-text.js'), make: 'makeTextBuiltins' },
  extra: { loader: () => import('./shell-builtins-extra.js'), make: 'makeExtraBuiltins' },
  util: { loader: () => import('./shell-builtins-util.js'), make: 'makeUtilBuiltins' },
  fs: { loader: () => import('./shell-builtins-fs.js'), make: 'makeFsBuiltins' },
  system: { loader: () => import('./shell-builtins-system.js'), make: 'makeSystemBuiltins' },
  py: { loader: () => import('./shell-python-pyodide.js'), make: 'makePythonBuiltin' },
};

// command name -> group key. Static (hand-derived from each group module's
// own returned-object keys), never produced by executing the modules --
// executing them is exactly the eager cost this manifest exists to avoid.
export const COMMAND_MANIFEST = {
  grep: 'text', sed: 'text', sort: 'text', uniq: 'text', tr: 'text', env: 'text',
  export: 'text', clear: 'text', history: 'text', which: 'text', exit: 'text',
  true: 'text', false: 'text', printenv: 'text',

  test: 'extra', '[': 'extra', tee: 'extra', xargs: 'extra', read: 'extra',
  printf: 'extra', declare: 'extra', shift: 'extra', local: 'extra', set: 'extra',
  break: 'extra', continue: 'extra', source: 'extra', '.': 'extra',

  basename: 'util', dirname: 'util', realpath: 'util', date: 'util', find: 'util',
  awk: 'util', eval: 'util', command: 'util', '[[': 'util', getopts: 'util',
  wait: 'util', trap: 'util', jobs: 'util', netstat: 'util',

  ln: 'fs', chmod: 'fs', stat: 'fs', alias: 'fs', unalias: 'fs', gzip: 'fs',
  gunzip: 'fs', md5sum: 'fs', file: 'fs', du: 'fs', df: 'fs',

  uname: 'system', whoami: 'system', hostname: 'system', id: 'system', free: 'system',
  uptime: 'system', ps: 'system', nproc: 'system', arch: 'system', sleep: 'system',
  od: 'system', xxd: 'system', groups: 'system', logname: 'system', tty: 'system',
  stty: 'system', locale: 'system',

  python: 'py', python3: 'py', pip: 'py', pip3: 'py',
};

// Commands always resident in shell-builtins.js's own `b` object (never
// dynamically imported -- see file comment above).
export const CORE_COMMANDS = ['ls', 'cat', 'echo', 'pwd', 'cd', 'mkdir', 'rm', 'cp', 'mv', 'touch', 'imgcat', 'head', 'tail', 'wc'];

// Runners wired directly in shell.js (kill/trap/jobs/fg/bg/disown/exec/nohup/
// nc/curl) plus non-builtin runtime commands (node/npm/...) that shell.js's
// own dispatch intercepts before ever consulting BUILTINS.
export const RUNTIME_COMMANDS = ['kill', 'fg', 'bg', 'disown', 'exec', 'nohup', 'nc', 'curl', 'npm', 'node', 'pnpm', 'yarn', 'bun', 'deno', 'npx', 'corepack', 'git'];

// Full enumerable command surface -- for tab-completion, `which`, `command -v`,
// and any future `help`/witness-coverage listing. Cheap: touches no loader.
export function allBuiltinNames() {
  return [...new Set([...CORE_COMMANDS, ...Object.keys(COMMAND_MANIFEST), ...RUNTIME_COMMANDS])];
}
