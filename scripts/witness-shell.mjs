import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
let passes = 0;

function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (ok) passes++;
  else failures++;
}

const core = await import(pathToFileURL(join(root, 'web', 'shell-core.js')).href).catch((err) => ({ missing: err.message }));
const coreReady = typeof core.createShell === 'function';
const MISSING = 'web/shell-core.js is not present: the txiki shell has not been built';

function memoryHost(files = {}) {
  const store = new Map(Object.entries(files));
  const dirs = new Set(['/', '/workspace']);
  return {
    read(path) {
      if (!store.has(path)) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      return store.get(path);
    },
    write(path, text) {
      store.set(path, text);
    },
    exists(path) {
      return store.has(path) || dirs.has(path);
    },
    list(path) {
      const prefix = path.endsWith('/') ? path : path + '/';
      return [...store.keys()].filter((name) => name.startsWith(prefix) && !name.slice(prefix.length).includes('/')).map((name) => name.slice(prefix.length));
    },
    mkdir(path) {
      dirs.add(path);
    },
    remove(path) {
      store.delete(path);
      dirs.delete(path);
    },
  };
}

const BUILTINS = ['git', 'sqlite3', 'python3', 'pip', 'qjs', 'tjs', 'curl', 'wget'];

async function shell(files) {
  const host = memoryHost(files);
  return core.createShell({ host, cwd: '/workspace', builtins: BUILTINS });
}

async function run(sh, script, options) {
  return sh.run(script, options);
}

const cases = [];
function group(title, body) {
  cases.push({ title, body });
}

group('parser: quoting, lists, pipes and redirections', async () => {
  const sh = await shell({});
  const quoted = await run(sh, `echo "a b" 'c d' e\\ f`);
  check('parser: double and single quotes keep spaces, and a backslash escapes a space', quoted.stdout === 'a b c d e f\n', JSON.stringify(quoted.stdout));
  const lists = await run(sh, 'echo one; echo two && echo three || echo four');
  check('parser: ; && and || run the lists in order', lists.stdout === 'one\ntwo\nthree\n', JSON.stringify(lists.stdout));
  const orRuns = await run(sh, 'false || echo or-ran');
  check('parser: || runs the right side when the left side fails', orRuns.stdout === 'or-ran\n', JSON.stringify(orRuns.stdout));
  const piped = await run(sh, 'echo abc | tr a-z A-Z');
  check('parser: a pipe feeds the left output to the right command', piped.stdout === 'ABC\n', JSON.stringify(piped.stdout));
  const redirected = await run(sh, 'echo first > /workspace/r.txt && echo second >> /workspace/r.txt && cat < /workspace/r.txt');
  check('parser: > truncates, >> appends and < reads a file', redirected.stdout === 'first\nsecond\n', JSON.stringify(redirected.stdout));
  const stderrRedirect = await run(sh, 'cat /workspace/missing.txt 2> /workspace/err.txt; cat /workspace/err.txt');
  check('parser: 2> sends stderr to a file', stderrRedirect.stdout.includes('missing.txt') && stderrRedirect.stdout.includes('No such file'), JSON.stringify(stderrRedirect.stdout));
  const status = await run(sh, 'false; echo rc=$?; (exit 3); echo sub=$?');
  check('parser: $? holds the last status, and a subshell reports its own exit', status.stdout === 'rc=1\nsub=3\n', JSON.stringify(status.stdout));
});

group('variables, command substitution and parameter expansion', async () => {
  const sh = await shell({});
  const assign = await run(sh, 'x=5; echo $x ${x}y "$x"');
  check('variables: assignment, $x, ${x} and quoted "$x" expand', assign.stdout === '5 5y 5\n', JSON.stringify(assign.stdout));
  const exported = await run(sh, 'export GREETING=hi; echo $GREETING');
  check('variables: export makes a value visible in the same shell', exported.stdout === 'hi\n', JSON.stringify(exported.stdout));
  const subst = await run(sh, 'y=$(echo inner); echo $y $(echo outer)');
  check('variables: $(...) substitutes its output and strips the trailing newline', subst.stdout === 'inner outer\n', JSON.stringify(subst.stdout));
  const defaults = await run(sh, 'echo ${UNSET_NAME:-fallback} ${#GREETING}');
  check('variables: ${NAME:-default} and ${#NAME} expand', defaults.stdout === 'fallback 2\n', JSON.stringify(defaults.stdout));
});

group('arithmetic', async () => {
  const sh = await shell({});
  const math = await run(sh, 'echo $((2+3*4)) $(( (7-2) % 3 ))');
  check('arithmetic: $((...)) follows precedence and parentheses', math.stdout === '14 2\n', JSON.stringify(math.stdout));
  const vars = await run(sh, 'i=2; echo $((i*i)) $((i<3))');
  check('arithmetic: variables inside $((...)) are read, and comparisons yield 0 or 1', vars.stdout === '4 1\n', JSON.stringify(vars.stdout));
});

group('globbing', async () => {
  const sh = await shell({ '/workspace/a1.txt': '', '/workspace/a2.txt': '', '/workspace/b.txt': '' });
  const star = await run(sh, 'cd /workspace; echo *.txt');
  check('globbing: *.txt expands to the matching files in sorted order', star.stdout === 'a1.txt a2.txt b.txt\n', JSON.stringify(star.stdout));
  const single = await run(sh, 'echo a?.txt');
  check('globbing: ? matches one character', single.stdout === 'a1.txt a2.txt\n', JSON.stringify(single.stdout));
  const none = await run(sh, 'echo nomatch*');
  check('globbing: a pattern with no match is passed through unchanged', none.stdout === 'nomatch*\n', JSON.stringify(none.stdout));
  const quoted = await run(sh, 'echo "*.txt"');
  check('globbing: a quoted pattern is not expanded', quoted.stdout === '*.txt\n', JSON.stringify(quoted.stdout));
});

group('functions', async () => {
  const sh = await shell({});
  const greet = await run(sh, 'greet() { echo hi $1 $#; }; greet bob ann');
  check('functions: a defined function runs with positional parameters and $#', greet.stdout === 'hi bob 2\n', JSON.stringify(greet.stdout));
  const ret = await run(sh, 'f() { return 4; }; f; echo rc=$?');
  check('functions: return sets the function status', ret.stdout === 'rc=4\n', JSON.stringify(ret.stdout));
  const scope = await run(sh, 'g() { local v=inside; echo $v; }; g; echo v=$v');
  check('functions: local keeps a variable inside the function', scope.stdout === 'inside\nv=\n', JSON.stringify(scope.stdout));
});

group('lookups: which, command -v and type agree for every in-page builtin', async () => {
  const sh = await shell({});
  const names = BUILTINS.join(' ');
  const agree = await run(sh, `for n in ${names}; do a=$(command -v "$n"); w=$(which "$n"); [ "$a" = "$w" ] && [ -n "$a" ] || echo disagree-$n; done; echo lookups-checked`);
  check('lookups: which and command -v report the same name for every in-page builtin', agree.stdout === 'lookups-checked\n', JSON.stringify(agree.stdout));
  const kind = await run(sh, 'type -t git; if which nosuch; then echo bad; else echo missing-ok; fi');
  check('lookups: type -t names an in-page builtin as builtin, and which fails for an unknown name', kind.stdout === 'builtin\nmissing-ok\n', JSON.stringify(kind.stdout));
});

group('Ctrl-C abort: a running command stops and the shell reports 130 cancelled', async () => {
  const sh = await shell({});
  const controller = new AbortController();
  const started = Date.now();
  const pending = run(sh, 'sleep 30; echo late', { signal: controller.signal });
  setTimeout(() => controller.abort(), 200);
  const cancelled = await pending;
  const elapsed = Date.now() - started;
  check('Ctrl-C: an abort ends sleep 30 within two seconds with exit 130 and cancelled', cancelled.exitCode === 130 && elapsed < 2000 && cancelled.stderr.includes('cancelled'), `exit ${cancelled.exitCode} after ${elapsed} ms`);
  const after = await run(sh, 'echo next');
  check('Ctrl-C: the shell accepts the next command after an abort', after.stdout === 'next\n', JSON.stringify(after.stdout));
});

group('timeout: a command past the limit is stopped', async () => {
  const sh = await shell({});
  const limited = await run(sh, 'sleep 5; echo late', { timeoutMs: 200 });
  check('timeout: a command past timeoutMs ends with exit 124 and a timed-out message', limited.exitCode === 124 && /timed out/.test(limited.stderr), `exit ${limited.exitCode}`);
  check('timeout: the production limit is 300000 ms, as in bash-shell.js', core.COMMAND_TIMEOUT_MS === 300000, String(core.COMMAND_TIMEOUT_MS));
});

group('$? carry: the status and the directory persist from one run to the next', async () => {
  const sh = await shell({});
  await run(sh, 'false');
  const carried = await run(sh, 'echo rc=$?');
  check('$? carry: the status of one run is $? in the next', carried.stdout === 'rc=1\n', JSON.stringify(carried.stdout));
  await run(sh, 'cd /workspace');
  const cwd = await run(sh, 'pwd');
  check('$? carry: cd persists to the next run', cwd.stdout === '/workspace\n', JSON.stringify(cwd.stdout));
});

for (const { title, body } of cases) {
  console.log(`== ${title}`);
  if (!coreReady) {
    check(`${title.split(':')[0]}: shell core is built`, false, MISSING);
    continue;
  }
  try {
    await body();
  } catch (err) {
    check(`${title.split(':')[0]}: runs without an error`, false, err.message.slice(0, 200));
  }
}
console.log(`RESULT PASS=${passes} FAIL=${failures}`);
process.exit(failures === 0 ? 0 : 1);
