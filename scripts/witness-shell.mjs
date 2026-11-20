import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
  const links = new Map();
  const children = (path) => {
    const prefix = path === '/' ? '/' : path + '/';
    const names = new Set();
    for (const key of [...store.keys(), ...dirs, ...links.keys()]) {
      if (key !== path && key.startsWith(prefix)) names.add(key.slice(prefix.length).split('/')[0]);
    }
    return [...names];
  };
  const follow = (path, depth = 0) => {
    if (!links.has(path)) return path;
    if (depth > 8) return null;
    return follow(resolve(dirname(path), links.get(path)), depth + 1);
  };
  const statOf = (real) => {
    if (real === null) return null;
    if (dirs.has(real) || children(real).length > 0) return { dir: true, size: 0 };
    if (store.has(real)) return { dir: false, size: store.get(real).length };
    return null;
  };
  return {
    read(path) {
      const real = follow(path);
      if (real === null || !store.has(real)) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      return store.get(real);
    },
    write(path, text) {
      store.set(follow(path) ?? path, text);
    },
    exists(path) {
      return statOf(follow(path)) !== null;
    },
    stat(path) {
      return statOf(follow(path));
    },
    lstat(path) {
      if (links.has(path)) return { dir: false, link: true, size: links.get(path).length };
      return statOf(path);
    },
    readlink(path) {
      return links.get(path);
    },
    symlink(target, path) {
      if (links.has(path) || store.has(path) || dirs.has(path)) return false;
      links.set(path, target);
      return true;
    },
    list(path) {
      const real = follow(path);
      return real === null ? [] : children(real);
    },
    mkdir(path) {
      dirs.add(path);
    },
    remove(path, recursive) {
      if (links.has(path)) {
        links.delete(path);
        return;
      }
      const prefix = path + '/';
      for (const key of [...store.keys()]) if (key === path || (recursive && key.startsWith(prefix))) store.delete(key);
      for (const dir of [...dirs]) if (dir === path || (recursive && dir.startsWith(prefix))) dirs.delete(dir);
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
  const started = performance.now();
  const pending = run(sh, 'sleep 30; echo late', { signal: controller.signal });
  setTimeout(() => controller.abort(), 200);
  const cancelled = await pending;
  const elapsed = performance.now() - started;
  check('Ctrl-C: an abort ends sleep 30 within two seconds with exit 130 and cancelled', cancelled.exitCode === 130 && elapsed < 2000 && cancelled.stderr.includes('cancelled'), `exit ${cancelled.exitCode} after ${elapsed} ms`);
  const after = await run(sh, 'echo next');
  check('Ctrl-C: the shell accepts the next command after an abort', after.stdout === 'next\n', JSON.stringify(after.stdout));
});

group('timeout: a command past the limit is stopped', async () => {
  const sh = await shell({});
  const limited = await run(sh, 'sleep 5; echo late', { timeoutMs: 200 });
  check('timeout: a command past timeoutMs ends with exit 124 and a timed-out message', limited.exitCode === 124 && /timed out/.test(limited.stderr), `exit ${limited.exitCode}`);
  check('timeout: the production limit is 900000 ms, as in bash-shell.js', core.COMMAND_TIMEOUT_MS === 900000, String(core.COMMAND_TIMEOUT_MS));
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

group('coreutils: ls, mkdir, rm, find, wc, test -d, date, uname and whoami', async () => {
  const sh = await shell({ '/workspace/notes/a.txt': 'one\ntwo\n', '/workspace/notes/.hidden': 'x', '/workspace/notes/sub/B.MD': 'three\n', '/workspace/notes/sub/c.txt': 'four\n' });
  const listing = await run(sh, 'ls notes');
  check('coreutils: ls lists a directory and skips dotfiles', listing.stdout === 'a.txt\nsub\n', JSON.stringify(listing.stdout));
  const all = await run(sh, 'ls -a notes');
  check('coreutils: ls -a includes dotfiles', all.stdout === '.hidden\na.txt\nsub\n', JSON.stringify(all.stdout));
  const made = await run(sh, 'mkdir -p notes/deep/er && ls notes/deep');
  check('coreutils: mkdir -p creates every missing parent', made.stdout === 'er\n' && made.exitCode === 0, JSON.stringify(made.stdout));
  const exists = await run(sh, 'mkdir notes/deep');
  check('coreutils: mkdir without -p refuses an existing directory', exists.exitCode === 1 && exists.stderr.includes('File exists'), JSON.stringify(exists.stderr));
  const removed = await run(sh, 'rm notes/a.txt && ls notes');
  check('coreutils: rm removes a file', removed.stdout === 'deep\nsub\n', JSON.stringify(removed.stdout));
  const refused = await run(sh, 'rm notes/sub');
  check('coreutils: rm refuses a directory without -r', refused.exitCode === 1 && refused.stderr.includes('Is a directory'), JSON.stringify(refused.stderr));
  const recursive = await run(sh, 'rm -r notes/sub && ls notes');
  check('coreutils: rm -r removes a directory tree', recursive.stdout === 'deep\n', JSON.stringify(recursive.stdout));
  const forced = await run(sh, 'rm -f notes/missing.txt; echo rc=$?');
  check('coreutils: rm -f ignores a missing file', forced.stdout === 'rc=0\n', JSON.stringify(forced.stdout));
  const dir = await run(sh, 'test -d notes && echo dir-ok');
  check('coreutils: test -d is true for a directory', dir.stdout === 'dir-ok\n', JSON.stringify(dir.stdout));
});

group('coreutils: find, wc, date, uname and whoami on a populated tree', async () => {
  const sh = await shell({ '/workspace/notes/a.txt': 'one\ntwo\n', '/workspace/notes/sub/B.MD': 'three\n', '/workspace/notes/sub/c.txt': 'four\n' });
  const byName = await run(sh, 'find notes -name "*.txt"');
  check('coreutils: find -name matches the glob on the base name, in sorted tree order', byName.stdout === 'notes/a.txt\nnotes/sub/c.txt\n', JSON.stringify(byName.stdout));
  const byIname = await run(sh, 'find notes -iname "*.md"');
  check('coreutils: find -iname ignores case', byIname.stdout === 'notes/sub/B.MD\n', JSON.stringify(byIname.stdout));
  const dirs = await run(sh, 'find notes -type d');
  check('coreutils: find -type d lists directories only', dirs.stdout === 'notes\nnotes/sub\n', JSON.stringify(dirs.stdout));
  const lines = await run(sh, 'cat notes/a.txt | wc -l');
  check('coreutils: wc -l counts lines of piped input', lines.stdout === '2\n', JSON.stringify(lines.stdout));
  const words = await run(sh, 'wc -w notes/a.txt');
  check('coreutils: wc -w names the file it counted', words.stdout === '2 notes/a.txt\n', JSON.stringify(words.stdout));
  const none = await run(sh, 'find notes -name "*.zzz" | wc -l');
  check('coreutils: a find with no matches counts zero', none.stdout === '0\n', JSON.stringify(none.stdout));
  const seconds = await run(sh, 'date +%s');
  check('coreutils: date +%s prints epoch seconds', /^\d{10}\n$/.test(seconds.stdout), JSON.stringify(seconds.stdout));
  const nanos = await run(sh, 'date +%s%N');
  check('coreutils: date +%s%N prints epoch nanoseconds', /^\d{19}\n$/.test(nanos.stdout), JSON.stringify(nanos.stdout));
  const year = await run(sh, 'date +%Y');
  check('coreutils: date +%Y prints the year', /^\d{4}\n$/.test(year.stdout), JSON.stringify(year.stdout));
  const system = await run(sh, 'uname -s; whoami');
  check('coreutils: uname -s and whoami print the in-page identity', system.stdout === 'Linux\nuser\n', JSON.stringify(system.stdout));
});

group('coreutils: grep, hostname and id', async () => {
  const sh = await shell({ '/workspace/log.txt': 'alpha\nbeta\nAlpha two\n', '/workspace/other.txt': 'beta here\n' });
  const numbered = await run(sh, 'grep -in alpha log.txt');
  check('coreutils: grep -in matches ignoring case and prints line numbers', numbered.stdout === '1:alpha\n3:Alpha two\n', JSON.stringify(numbered.stdout));
  const inverted = await run(sh, 'grep -v alpha log.txt');
  check('coreutils: grep -v prints the lines that do not match', inverted.stdout === 'beta\nAlpha two\n', JSON.stringify(inverted.stdout));
  const counted = await run(sh, 'cat log.txt | grep -c alpha');
  check('coreutils: grep -c counts the matching lines of piped input', counted.stdout === '1\n', JSON.stringify(counted.stdout));
  const several = await run(sh, 'grep beta log.txt other.txt');
  check('coreutils: grep over several files prefixes each line with its file name', several.stdout === 'log.txt:beta\nother.txt:beta here\n', JSON.stringify(several.stdout));
  const missing = await run(sh, 'grep x nosuch.txt; echo rc=$?');
  check('coreutils: grep on a missing file reports it and exits 2', missing.stdout === 'rc=2\n' && missing.stderr.includes('No such file'), JSON.stringify(missing.stdout));
  const nothing = await run(sh, 'grep zzz log.txt; echo rc=$?');
  check('coreutils: grep with no match exits 1', nothing.stdout === 'rc=1\n', JSON.stringify(nothing.stdout));
  const identity = await run(sh, 'hostname; id');
  check('coreutils: hostname and id print the in-page identity', identity.stdout === 'thebird\nuid=1000(user) gid=1000(user) groups=1000(user)\n', JSON.stringify(identity.stdout));
  const found = await run(sh, 'command -v grep hostname id');
  check('lookups: grep, hostname and id resolve as core commands', found.stdout === '/bin/grep\n/bin/hostname\n/bin/id\n', JSON.stringify(found.stdout));
});

group('links: ln -s, readlink, test -L, ls -l arrows, rm of a link, and links across a restart', async () => {
  const host = memoryHost({ '/workspace/notes/target.txt': 'hello\n', '/workspace/notes/dir/inner.txt': 'x\n' });
  const first = await core.createShell({ host, cwd: '/workspace', builtins: BUILTINS });
  const made = await run(first, 'cd notes && ln -s target.txt link.txt && echo made');
  check('links: ln -s creates a link and exits 0', made.exitCode === 0 && made.stdout === 'made\n', JSON.stringify(made));
  const read = await run(first, 'readlink link.txt');
  check('links: readlink prints the target as stored', read.stdout === 'target.txt\n', JSON.stringify(read.stdout));
  const followed = await run(first, 'cat link.txt');
  check('links: cat follows a link to its target', followed.stdout === 'hello\n', JSON.stringify(followed.stdout));
  const testL = await run(first, 'test -L link.txt && echo yes; test -L target.txt || echo no');
  check('links: test -L is true for a link and false for its target', testL.stdout === 'yes\nno\n', JSON.stringify(testL.stdout));
  await run(first, 'ln -s dir dirlink');
  const long = await run(first, 'ls -l');
  check('links: ls -l shows each link with an arrow to its target', long.stdout === 'd 0 dir\nl 3 dirlink -> dir\nl 10 link.txt -> target.txt\n- 6 target.txt\n', JSON.stringify(long.stdout));
  const removed = await run(first, 'rm link.txt && ls && cat target.txt');
  check('links: rm removes the link and leaves its target in place', removed.stdout === 'dir\ndirlink\ntarget.txt\nhello\n' && removed.exitCode === 0, JSON.stringify(removed.stdout));
  const second = await core.createShell({ host, cwd: '/workspace', builtins: BUILTINS });
  const restarted = await run(second, 'cd notes && readlink dirlink && test -L dirlink && echo still-link');
  check('links: a link survives a new shell over the same store', restarted.stdout === 'dir\nstill-link\n', JSON.stringify(restarted.stdout));
  await run(second, 'rm dirlink');
  const third = await core.createShell({ host, cwd: '/workspace', builtins: BUILTINS });
  const gone = await run(third, 'cd notes && test -L dirlink || echo gone && ls dir');
  check('links: rm of a link is still in effect after a restart, and the directory it pointed at is untouched', gone.stdout === 'gone\ninner.txt\n', JSON.stringify(gone.stdout));
});

group('process: & starts a job, $! names its PID, ps lists it, kill signals it and wait reports the status', async () => {
  const sh = await shell({});
  const started = await run(sh, 'sleep 30 & echo pid=$!; ps | grep "sleep 30"; kill $!; wait $!; echo rc=$?');
  const lines = started.stdout.split('\n');
  const pid = /^pid=(\d+)$/.exec(lines[0])?.[1] ?? '';
  check('process: $! after & names a PID above the shell PID', pid !== '' && Number(pid) > 100, JSON.stringify(lines[0]));
  const listed = lines.find((line) => line.includes('sleep 30')) ?? '';
  check('process: ps lists the background job by its PID, parent 100 and command', listed.trim().split(/\s+/).join(' ') === `${pid} 100 S sleep 30`, JSON.stringify(listed));
  check('process: kill -TERM stops the job and wait returns 128 + 15', lines.includes('rc=143'), JSON.stringify(started.stdout));
  const plain = await run(sh, 'ps');
  check('process: ps prints the header and the shell row when no job runs', plain.stdout === 'PID PPID STAT COMMAND\n100    0 S    thebird\n', JSON.stringify(plain.stdout));
  const missing = await run(sh, 'kill 999; echo rc=$?');
  check('process: kill of a PID that is not running exits 1 with no such process', missing.stdout === 'rc=1\n' && missing.stderr === 'kill: (999) - No such process\n', JSON.stringify(missing.stderr));
  const idle = await run(sh, 'wait; echo rc=$?');
  check('process: wait with no jobs exits 0', idle.stdout === 'rc=0\n', JSON.stringify(idle.stdout));
  const joined = await run(sh, 'echo hi & wait; echo done');
  check('process: a background job finishes before wait returns, and its output is kept', joined.stdout === 'hi\ndone\n', JSON.stringify(joined.stdout));
  const failed = await run(sh, 'false & wait $!; echo rc=$?');
  check('process: wait $! returns the status the job exited with', failed.stdout === 'rc=1\n', JSON.stringify(failed.stdout));
  const status = await run(sh, 'false & echo rc=$?');
  check('process: $? is 0 right after a background command starts', status.stdout === 'rc=0\n', JSON.stringify(status.stdout));
  const signals = await run(sh, 'kill -l; kill -9 999; echo rc=$?');
  check('process: kill -l lists the signal names', signals.stdout.startsWith('HUP INT KILL TERM\n'), JSON.stringify(signals.stdout));
  const found = await run(sh, 'command -v ps kill; type -t wait');
  check('process: ps and kill resolve as core commands and wait as a builtin', found.stdout === '/bin/ps\n/bin/kill\nbuiltin\n', JSON.stringify(found.stdout));
});

group('sed: substitution, addresses, ranges, replacements, in-place edits and errors', async () => {
  const sh = await shell({ '/workspace/a.txt': 'one\ntwo\nthree\nfour\n', '/workspace/b.txt': 'x\ny' });
  const global = await run(sh, "sed 's/o/0/g' a.txt");
  check('sed: s with g replaces every match on each line', global.stdout === '0ne\ntw0\nthree\nf0ur\n', JSON.stringify(global.stdout));
  const numbered = await run(sh, "sed -n '2p' a.txt");
  check('sed: -n with a numeric address and p prints only that line', numbered.stdout === 'two\n', JSON.stringify(numbered.stdout));
  const ranged = await run(sh, "sed '/two/,/three/d' a.txt");
  check('sed: a regex range with d deletes the lines from start to end inclusive', ranged.stdout === 'one\nfour\n', JSON.stringify(ranged.stdout));
  const groups = await run(sh, "sed -E 's/(o)(n)/[&]\\2\\1/' a.txt");
  check('sed: & inserts the whole match and \\1 and \\2 insert the groups', groups.stdout === '[on]noe\ntwo\nthree\nfour\n', JSON.stringify(groups.stdout));
  const unterminated = await run(sh, "sed 's/y/z/' b.txt");
  check('sed: input without a trailing newline gives output without one', unterminated.stdout === 'x\nz', JSON.stringify(unterminated.stdout));
  const inPlace = await run(sh, "sed -i 's/two/TWO/' a.txt; cat a.txt");
  check('sed: -i rewrites the file and prints nothing itself', inPlace.stdout === 'one\nTWO\nthree\nfour\n', JSON.stringify(inPlace.stdout));
  const missing = await run(sh, 'sed p nosuch.txt; echo rc=$?');
  check('sed: a missing file is reported and exits 2', missing.stdout === 'rc=2\n' && missing.stderr.includes("sed: can't read nosuch.txt: No such file or directory"), JSON.stringify([missing.stdout, missing.stderr]));
  const unknown = await run(sh, 'sed k a.txt; echo rc=$?');
  check('sed: an unknown command is reported with its position and exits 1', unknown.stdout === 'rc=1\n' && unknown.stderr.includes("sed: -e expression #1, char 1: unknown command: 'k'"), JSON.stringify([unknown.stdout, unknown.stderr]));
});

group('tar: create, list, extract and errors', async () => {
  const sh = await shell({ '/workspace/a.txt': 'one\ntwo\n', '/workspace/b.txt': 'three\n' });
  const listed = await run(sh, 'tar -cf out.tar a.txt b.txt && tar -tf out.tar');
  check('tar: create then list prints the members in order', listed.stdout === 'a.txt\nb.txt\n', JSON.stringify(listed.stdout));
  const tree = await run(sh, 'mkdir -p d/sub && echo hi > d/sub/x.txt && echo top > d/y.txt && tar -cf t.tar d && tar -tf t.tar');
  check('tar: a directory member is archived recursively in sorted order', tree.stdout === 'd/\nd/sub/\nd/sub/x.txt\nd/y.txt\n', JSON.stringify(tree.stdout));
  const restored = await run(sh, 'tar -xf t.tar -C restored && cat restored/d/sub/x.txt restored/d/y.txt');
  check('tar: -C extracts the tree into a new directory', restored.stdout === 'hi\ntop\n' && restored.exitCode === 0, JSON.stringify(restored));
  const verbose = await run(sh, 'tar cvf v.tar a.txt d/y.txt && mkdir again && tar -xvf v.tar -C again && cat again/a.txt');
  check('tar: combined -cvf and -xvf flags print each member name', verbose.stdout === 'a.txt\nd/y.txt\na.txt\nd/y.txt\none\ntwo\n', JSON.stringify(verbose.stdout));
  const missingMember = await run(sh, 'tar -cf m.tar a.txt nope.txt');
  check('tar: a missing member reports Cannot stat and exits 2', missingMember.exitCode === 2 && missingMember.stderr === 'tar: nope.txt: Cannot stat: No such file or directory\n', JSON.stringify(missingMember));
  const missingArchive = await run(sh, 'tar -tf none.tar');
  check('tar: a missing archive reports Cannot open and exits 2', missingArchive.exitCode === 2 && missingArchive.stderr === 'tar: none.tar: Cannot open: No such file or directory\n', JSON.stringify(missingArchive));
  const noMode = await run(sh, 'tar -f x.tar');
  check('tar: no mode reports the -ctx error and exits 2', noMode.exitCode === 2 && noMode.stderr === 'tar: You must specify one of the -ctx options\n', JSON.stringify(noMode));
  const piped = await run(sh, 'tar -cf - a.txt | tar -tf -');
  check('tar: an archive written to stdout lists from stdin', piped.stdout === 'a.txt\n', JSON.stringify(piped.stdout));
});

group('jq: filters, output and errors', async () => {
  const sh = await shell({
    '/workspace/a.json': '{"name":"x","n":2,"items":[1,2,3],"people":[{"name":"ann","age":30},{"name":"bob","age":20}]}',
    '/workspace/mixed.json': '{"a":1} 5 {"a":2}',
  });
  const raw = await run(sh, "jq -r '.name' a.json");
  check('jq: -r prints a string field without quotes', raw.stdout === 'x\n' && raw.exitCode === 0, JSON.stringify(raw));
  const indexed = await run(sh, "jq -c '.items[-1], [.items[]]' a.json");
  check('jq: negative index and iterate inside an array with -c', indexed.stdout === '3\n[1,2,3]\n', JSON.stringify(indexed.stdout));
  const piped = await run(sh, "jq -c '.people[] | .name' a.json");
  check('jq: a pipe applies the right side to every output of the left', piped.stdout === '"ann"\n"bob"\n', JSON.stringify(piped.stdout));
  const selected = await run(sh, "jq -c '.people[] | select(.age > 25) | .name' a.json");
  check('jq: select with a comparison keeps only matching inputs', selected.stdout === '"ann"\n', JSON.stringify(selected.stdout));
  const pretty = await run(sh, "jq '{name, count: (.items | length), tags: [.items[0]], none: []}' a.json");
  check('jq: an object is pretty-printed with two-space indentation', pretty.stdout === '{\n  "name": "x",\n  "count": 3,\n  "tags": [\n    1\n  ],\n  "none": []\n}\n', JSON.stringify(pretty.stdout));
  const built = await run(sh, "printf '' | jq -nc '[1,2] + [3] | {total: add, n: length}'");
  check('jq: -n runs once on null and builds an object from add and length', built.stdout === '{"total":6,"n":3}\n' && built.exitCode === 0, JSON.stringify(built));
  const failed = await run(sh, "jq '.a' mixed.json");
  check('jq: a runtime error reports the input and exits 5 after the other inputs', failed.exitCode === 5 && failed.stdout === '1\n2\n' && failed.stderr === 'jq: error (at mixed.json:2): Cannot index number with "a"\n', JSON.stringify(failed));
  const missing = await run(sh, "jq -c '.n' missing.json a.json");
  check('jq: a missing file is reported, the rest is processed, and the exit is 2', missing.exitCode === 2 && missing.stdout === '2\n' && missing.stderr === 'jq: error: Could not open missing.json: No such file or directory\n', JSON.stringify(missing));
  const syntax = await run(sh, "jq '.a[' a.json");
  check('jq: a syntax error in the filter exits 3', syntax.exitCode === 3 && syntax.stderr === 'jq: error: syntax error, unexpected end of file\njq: 1 compile error\n', JSON.stringify(syntax));
});

group('awk: fields, patterns, actions and errors', async () => {
  const sh = await shell({
    '/workspace/a.txt': 'one two\nthree four\n',
    '/workspace/p.txt': 'root:x:0\nalice:x:1000\n',
    '/workspace/n.txt': '3\n4\n5\n',
    '/workspace/kv.txt': 'a 1\nb 22\n',
  });
  const byDefault = await run(sh, "awk '{print $2}' a.txt");
  check('awk: prints a field split on whitespace', byDefault.stdout === 'two\nfour\n' && byDefault.exitCode === 0, JSON.stringify(byDefault));
  const byColon = await run(sh, "awk -F: '{print $1, $3}' p.txt");
  check('awk: -F splits on a literal separator and print joins with OFS', byColon.stdout === 'root 0\nalice 1000\n', JSON.stringify(byColon.stdout));
  const byRegex = await run(sh, "awk '/^a/' p.txt");
  check('awk: a regex pattern alone prints the matching records', byRegex.stdout === 'alice:x:1000\n', JSON.stringify(byRegex.stdout));
  const byComparison = await run(sh, "awk -F: '$3 > 10 {print $1}' p.txt");
  check('awk: a numeric comparison pattern selects records', byComparison.stdout === 'alice\n', JSON.stringify(byComparison.stdout));
  const sum = await run(sh, "awk 'BEGIN { s = 0 } { s += $1 } END { print NR, s }' n.txt");
  check('awk: BEGIN and END with a sum over a field and NR', sum.stdout === '3 12\n', JSON.stringify(sum.stdout));
  const formatted = await run(sh, "awk '{printf \"%s=%d\\n\", $1, $2}' kv.txt");
  check('awk: printf formats through the shell printf without adding ORS', formatted.stdout === 'a=1\nb=22\n', JSON.stringify(formatted.stdout));
  const builtins = await run(sh, "awk '{print toupper($1), length($2), substr($2, 2, 3)}' a.txt");
  check('awk: toupper, length and substr', builtins.stdout === 'ONE 3 wo\nTHREE 4 our\n', JSON.stringify(builtins.stdout));
  const divided = await run(sh, "awk 'BEGIN { print 1/0 }'");
  check('awk: division by zero exits 2 with a message', divided.exitCode === 2 && divided.stdout === '' && divided.stderr === 'awk: division by zero\n', JSON.stringify(divided));
  const missing = await run(sh, "awk '{print $1}' nope.txt a.txt");
  check('awk: a missing file is reported, the rest are read, and the exit is 2', missing.exitCode === 2 && missing.stdout === 'one\nthree\n' && missing.stderr === "awk: can't open file nope.txt\n", JSON.stringify(missing));
});

group('loops: while and until run their body while the condition holds', async () => {
  const sh = await shell({});
  const counted = await run(sh, 'n=0; while [ $n -lt 3 ]; do echo w$n; n=$((n+1)); done');
  check('loops: while repeats its body while the condition is 0', counted.stdout === 'w0\nw1\nw2\n', JSON.stringify(counted.stdout));
  const never = await run(sh, 'while false; do echo never; done; echo after');
  check('loops: a while whose condition is false never runs its body, and the status is 0', never.stdout === 'after\n' && never.exitCode === 0, JSON.stringify(never.stdout));
  const until = await run(sh, 'n=0; until [ $n -ge 2 ]; do echo u$n; n=$((n+1)); done');
  check('loops: until repeats its body while the condition is not 0', until.stdout === 'u0\nu1\n', JSON.stringify(until.stdout));
  const endless = await run(sh, 'while true; do true; done', { timeoutMs: 200 });
  check('loops: a while that never ends is stopped by the command timeout with exit 124', endless.exitCode === 124 && /timed out/.test(endless.stderr), `exit ${endless.exitCode}`);
});

group('loops: break leaves its loop, continue starts its next item, and both take a count', async () => {
  const sh = await shell({});
  const broke = await run(sh, 'for i in 1 2 3; do echo $i; break; done; echo after');
  check('loops: break in a for loop leaves it after the first item', broke.stdout === '1\nafter\n', JSON.stringify(broke.stdout));
  const skipped = await run(sh, 'for i in 1 2 3; do if [ $i = 2 ]; then continue; fi; echo $i; done');
  check('loops: continue skips the rest of one item and runs the next', skipped.stdout === '1\n3\n', JSON.stringify(skipped.stdout));
  const whileBreak = await run(sh, 'n=0; while true; do n=$((n+1)); if [ $n -eq 3 ]; then break; fi; done; echo n=$n', { timeoutMs: 2000 });
  check('loops: break in a while loop ends it', whileBreak.stdout === 'n=3\n', JSON.stringify(whileBreak.stdout));
  const twoLevels = await run(sh, 'for i in 1 2; do for j in a b; do break 2; done; echo never; done; echo done');
  check('loops: break 2 leaves both loops', twoLevels.stdout === 'done\n', JSON.stringify(twoLevels.stdout));
  const continueOuter = await run(sh, 'for i in 1 2; do for j in a b; do continue 2; done; echo never; done; echo end');
  check('loops: continue 2 starts the next item of the outer loop', continueOuter.stdout === 'end\n', JSON.stringify(continueOuter.stdout));
  const outside = await run(sh, 'break; echo after-break');
  check('loops: break outside a loop prints a message, and the shell goes on with status 0', outside.stdout === 'after-break\n' && /only meaningful in a loop/.test(outside.stderr) && outside.exitCode === 0, JSON.stringify(outside.stderr));
});

group('case: the first matching arm runs, with | alternatives, glob patterns and a default', async () => {
  const sh = await shell({});
  const first = await run(sh, 'case x in a) echo A;; x) echo X;; esac');
  check('case: the arm whose pattern matches runs, and the others do not', first.stdout === 'X\n', JSON.stringify(first.stdout));
  const glob = await run(sh, 'v=hello; case $v in h*) echo starts-h;; *) echo other;; esac');
  check('case: a glob pattern matches the expanded word', glob.stdout === 'starts-h\n', JSON.stringify(glob.stdout));
  const fallback = await run(sh, 'case zz in a|b) echo ab;; *) echo default;; esac');
  check('case: a * arm is the default when nothing else matches', fallback.stdout === 'default\n', JSON.stringify(fallback.stdout));
  const alternative = await run(sh, 'case b in a|b) echo ab;; esac');
  check('case: an arm with | alternatives matches any of them', alternative.stdout === 'ab\n', JSON.stringify(alternative.stdout));
  const none = await run(sh, 'case q in a) echo a;; esac; echo after');
  check('case: with no match nothing runs, the status is 0, and the shell goes on', none.stdout === 'after\n' && none.exitCode === 0, JSON.stringify(none.stdout));
  const quoted = await run(sh, "case '*' in '*') echo literal;; *) echo glob;; esac");
  check('case: a quoted * in a pattern matches only a literal star', quoted.stdout === 'literal\n', JSON.stringify(quoted.stdout));
  const notQuoted = await run(sh, "case xyz in '*') echo literal;; *) echo glob;; esac");
  check('case: a quoted * does not match other text', notQuoted.stdout === 'glob\n', JSON.stringify(notQuoted.stdout));
  const several = await run(sh, 'case 1 in 1) echo one; echo uno;; esac');
  check('case: every command in the matching arm runs', several.stdout === 'one\nuno\n', JSON.stringify(several.stdout));
  const status = await run(sh, 'case a in a) false;; esac; echo rc=$?');
  check('case: the status is the status of the arm that ran', status.stdout === 'rc=1\n', JSON.stringify(status.stdout));
});

group('builtins: :, shift and set move and read the positional parameters', async () => {
  const sh = await shell({});
  const colon = await run(sh, ': x y; echo rc=$?');
  check('builtins: : does nothing, ignores its words and exits 0', colon.stdout === 'rc=0\n', JSON.stringify(colon.stdout));
  const setArgs = await run(sh, 'set -- a b c; echo $1 $2 $#');
  check('builtins: set -- replaces the positional parameters', setArgs.stdout === 'a b 3\n', JSON.stringify(setArgs.stdout));
  const shifted = await run(sh, 'set -- a b c; shift; echo $1 $#');
  check('builtins: shift drops one positional parameter', shifted.stdout === 'b 2\n', JSON.stringify(shifted.stdout));
  const shiftedTwo = await run(sh, 'set -- a b c; shift 2; echo $1 $#');
  check('builtins: shift N drops N positional parameters', shiftedTwo.stdout === 'c 1\n', JSON.stringify(shiftedTwo.stdout));
  const emptied = await run(sh, 'set -- x y; shift; shift; echo $#');
  check('builtins: shifting every parameter leaves none', emptied.stdout === '0\n', JSON.stringify(emptied.stdout));
  const tooMany = await run(sh, 'set -- a; shift 2; echo rc=$?');
  check('builtins: a shift past the parameters fails with status 1 and is silent, as in bash', tooMany.stdout === 'rc=1\n' && tooMany.stderr === '', JSON.stringify(tooMany.stderr));
  const numeric = await run(sh, 'set -- a; shift x; echo rc=$?');
  check('builtins: a non-numeric shift count is an error with status 2', numeric.stdout === 'rc=2\n' && /numeric argument required/.test(numeric.stderr), JSON.stringify(numeric.stderr));
  const unsupported = await run(sh, 'set -u; echo rc=$?');
  check('builtins: an unsupported set option is refused with status 2, not ignored', unsupported.stdout === 'rc=2\n' && /unsupported option -u/.test(unsupported.stderr), JSON.stringify(unsupported.stderr));
  const listed = await run(sh, 'v=1; set | grep "^v="');
  check('builtins: a bare set lists the shell variables', listed.stdout === 'v=1\n', JSON.stringify(listed.stdout));
});

group('redirects: here-strings and heredocs feed their text to the command', async () => {
  const sh = await shell({});
  const expanded = await run(sh, 'v=world; cat <<EOF\nhello $v\nEOF\n');
  check('redirects: an unquoted heredoc expands its $ words', expanded.stdout === 'hello world\n', JSON.stringify(expanded.stdout));
  const quoted = await run(sh, "v=world; cat <<'EOF'\nhello $v\nEOF\n");
  check('redirects: a quoted delimiter keeps the body literal', quoted.stdout === 'hello $v\n', JSON.stringify(quoted.stdout));
  const herestring = await run(sh, 'cat <<< "one two"');
  check('redirects: a here-string feeds one line to stdin', herestring.stdout === 'one two\n', JSON.stringify(herestring.stdout));
  const piped = await run(sh, 'cat <<EOF | tr a-z A-Z\nabc\nEOF\necho after\n');
  check('redirects: a heredoc feeds a pipeline and the shell goes on', piped.stdout === 'ABC\nafter\n', JSON.stringify(piped.stdout));
  const escapes = await run(sh, 'cat <<EOF\nback\\$x \\\\ \nEOF\n');
  check('redirects: an unquoted heredoc keeps a literal $ and reads \\\ as one backslash', escapes.stdout === 'back$x \\ \n', JSON.stringify(escapes.stdout));
  const twice = await run(sh, 'cat <<EOF\na\nEOF\ncat <<EOF\nb\nEOF\n');
  check('redirects: two heredocs on one line read their bodies in order', twice.stdout === 'a\nb\n', JSON.stringify(twice.stdout));
});

group('redirects: &> sends stdout and stderr to a file, &>> appends to it', async () => {
  const sh = await shell({});
  await run(sh, 'mkdir -p /t');
  const both = await run(sh, 'echo out &> /t/a.txt; cat /t/a.txt');
  check('redirects: &> writes stdout to the file and nothing to the output', both.stdout === 'out\n' && both.stderr === '', JSON.stringify(both.stdout));
  const error = await run(sh, 'cat /nope/x &> /t/e.txt; cat /t/e.txt');
  check('redirects: &> also takes stderr into the file', error.stdout === 'cat: /nope/x: No such file or directory\n', JSON.stringify(error.stdout));
  const appended = await run(sh, 'echo a &> /t/c.txt; echo b &>> /t/c.txt; cat /t/c.txt');
  check('redirects: &>> appends stdout and stderr to the file', appended.stdout === 'a\nb\n', JSON.stringify(appended.stdout));
  const quiet = await run(sh, 'echo x &> /t/d.txt');
  check('redirects: &> leaves neither stdout nor stderr on the shell', quiet.stdout === '' && quiet.stderr === '', JSON.stringify(quiet.stdout));
});

group('expansion: brace lists, ranges and tilde expand before the command runs', async () => {
  const sh = await shell({});
  const list = await run(sh, 'echo {a,b,c}');
  check('expansion: a brace list makes one word per item', list.stdout === 'a b c\n', JSON.stringify(list.stdout));
  const affixes = await run(sh, 'echo x{1,2}y');
  check('expansion: a prefix and a suffix are kept around each item', affixes.stdout === 'x1y x2y\n', JSON.stringify(affixes.stdout));
  const range = await run(sh, 'echo {1..3} {3..1} {a..c}');
  check('expansion: a numeric or letter range counts up or down', range.stdout === '1 2 3 3 2 1 a b c\n', JSON.stringify(range.stdout));
  const nested = await run(sh, 'echo {a,b{1,2}} {01..03}');
  check('expansion: a nested list expands, and a padded range keeps its zeros', nested.stdout === 'a b1 b2 01 02 03\n', JSON.stringify(nested.stdout));
  const quoted = await run(sh, "echo '{a,b}' {a}");
  check('expansion: quoted braces and a single item are left as written', quoted.stdout === '{a,b} {a}\n', JSON.stringify(quoted.stdout));
  const loop = await run(sh, 'for i in {1..3}; do echo $i; done');
  check('expansion: a brace range feeds a for loop', loop.stdout === '1\n2\n3\n', JSON.stringify(loop.stdout));
  const bare = await run(sh, 'echo ~');
  check('expansion: a tilde stays literal while HOME is unset', bare.stdout === '~\n', JSON.stringify(bare.stdout));
  const home = await run(sh, 'HOME=/h; echo ~ ~/x');
  check('expansion: a leading tilde becomes HOME', home.stdout === '/h /h/x\n', JSON.stringify(home.stdout));
  const emptyHome = await run(await shell({}), 'HOME=; set -- ~ x; echo $#');
  check('expansion: an empty HOME still makes a field, as in bash', emptyHome.stdout === '2\n', JSON.stringify(emptyHome.stdout));
  const notTilde = await run(sh, "HOME=/h; echo '~' ~x a~");
  check('expansion: a quoted tilde, a tilde with a name, and a tilde mid-word stay literal', notTilde.stdout === '~ ~x a~\n', JSON.stringify(notTilde.stdout));
});

group('files: cp, mv, touch and tee copy, move, create and write files', async () => {
  const sh = await shell({});
  await run(sh, 'mkdir -p /e2');
  const copied = await run(sh, 'echo hi > /e2/a.txt; cp /e2/a.txt /e2/b.txt; cat /e2/b.txt');
  check('files: cp copies a file to a new name', copied.stdout === 'hi\n', JSON.stringify(copied.stdout));
  const intoDir = await run(sh, 'mkdir /e2/d; cp /e2/a.txt /e2/d; cat /e2/d/a.txt');
  check('files: cp into a directory keeps the file name', intoDir.stdout === 'hi\n', JSON.stringify(intoDir.stdout));
  const many = await run(sh, 'echo p > /e2/p; echo q > /e2/q; mkdir /e2/box; cp /e2/p /e2/q /e2/box; cat /e2/box/q');
  check('files: cp of several files goes into the directory last named', many.stdout === 'q\n', JSON.stringify(many.stdout));
  const moved = await run(sh, 'echo hi > /e2/m.txt; mv /e2/m.txt /e2/n.txt; cat /e2/n.txt; cat /e2/m.txt; echo rc=$?');
  check('files: mv moves the file, and the old name is gone', moved.stdout === 'hi\nrc=1\n' && moved.stderr.includes("cat: /e2/m.txt: No such file or directory"), JSON.stringify(moved.stdout + moved.stderr));
  const touched = await run(sh, 'touch /e2/new.txt; cat /e2/new.txt; echo rc=$?');
  check('files: touch creates an empty file', touched.stdout === 'rc=0\n', JSON.stringify(touched.stdout));
  const teed = await run(sh, 'echo one | tee /e2/t.txt; cat /e2/t.txt');
  check('files: tee writes its input to the file and to stdout', teed.stdout === 'one\none\n', JSON.stringify(teed.stdout));
  const appended = await run(sh, 'echo one | tee /e2/u.txt; echo two | tee -a /e2/u.txt; cat /e2/u.txt');
  check('files: tee -a appends to the file', appended.stdout === 'one\ntwo\none\ntwo\n', JSON.stringify(appended.stdout));
  const missing = await run(sh, 'cp /e2/nope /e2/x; echo rc=$?');
  check('files: cp of a missing file fails with status 1 and a message', missing.stdout === 'rc=1\n' && missing.stderr.includes("cp: cannot stat '/e2/nope': No such file or directory"), JSON.stringify(missing.stderr));
  const dirCopy = await run(sh, 'mkdir /e2/dd; cp /e2/dd /e2/x; echo rc=$?');
  check('files: cp of a directory without -r is refused with status 1', dirCopy.stdout === 'rc=1\n' && dirCopy.stderr.includes("-r not specified; omitting directory '/e2/dd'"), JSON.stringify(dirCopy.stderr));
  const noParent = await run(sh, 'touch /nodir/x; echo rc=$?');
  check('files: touch under a missing directory fails with status 1', noParent.stdout === 'rc=1\n' && noParent.stderr.includes("touch: cannot touch '/nodir/x': No such file or directory"), JSON.stringify(noParent.stderr));
  const notDir = await run(sh, 'echo a > /e2/r; echo b > /e2/s; cp /e2/r /e2/s /e2/r; echo rc=$?');
  check('files: cp of several files needs a directory as its last name', notDir.stdout === 'rc=1\n' && notDir.stderr.includes('is not a directory'), JSON.stringify(notDir.stderr));
  const same = await run(sh, 'echo a > /e2/v; mv /e2/v /e2/v; echo rc=$?');
  check('files: mv of a file onto itself is refused', same.stdout === 'rc=1\n' && same.stderr.includes("mv: '/e2/v' and '/e2/v' are the same file"), JSON.stringify(same.stderr));
});

group('mv: a file moved onto itself stays in place, as GNU mv leaves it', async () => {
  const kept = await run(await shell({}), 'echo a > /workspace/k; mv /workspace/k /workspace/k; cat /workspace/k');
  check('mv: a file moved onto itself is unchanged', kept.stdout === 'a\n' && kept.exitCode === 0, JSON.stringify(kept.stdout));
  const status = await run(await shell({}), 'echo a > /workspace/k; mv /workspace/k /workspace/k; echo rc=$?');
  check('mv: the same-file refusal exits 1', status.stdout === 'rc=1\n' && status.stderr === "mv: '/workspace/k' and '/workspace/k' are the same file\n", JSON.stringify(status));
});

group('errexit: set -e stops at a failing command with its status, and set +e turns it off', async () => {
  const rows = [
    ['set -e; false; echo SHOULD_NOT_PRINT', '', 1],
    ['set -e; false || false; echo no3', '', 1],
    ['set -e; f() { false; echo in-f; }; f; echo after', '', 1],
    ['set -e; while false; do :; done; echo loop-ok', 'loop-ok\n', 0],
    ['set -e; if true; then false; echo in-then; fi; echo after', '', 1],
    ['set -e; echo a; set +e; false; echo b', 'a\nb\n', 0],
    ['set -e; false | true; echo pipe-ok', 'pipe-ok\n', 0],
    ['set -e; { false; echo grp; } || echo or-branch', 'grp\n', 0],
    ['set -e; (false; echo sub-inner); echo outer', '', 1],
    ['set -e; echo a | false; echo pipe-last-fails', '', 1],
    ['set -e; false || true; if false; then :; fi; echo survived; true && false; echo no2', 'survived\n', 1],
    ['set -e; set -- p q; shift 1; echo $1', 'q\n', 0],
  ];
  for (const [script, stdout, exitCode] of rows) {
    const result = await run(await shell({}), script);
    check('errexit (as bash): ' + JSON.stringify(script), result.stdout === stdout && result.exitCode === exitCode, JSON.stringify([result.stdout, result.exitCode]));
  }
});

group('cp -r: a directory is copied with its tree, and a link is copied as a link, as GNU cp does', async () => {
  const tree = await run(await shell({}), 'mkdir -p /cp/a/b; echo x > /cp/a/b/f; echo y > /cp/a/g; cp -r /cp/a /cp/c; cat /cp/c/b/f /cp/c/g; echo rc=$?');
  check('cp -r: a directory is copied with its files and subdirectories', tree.stdout === 'x\ny\nrc=0\n', JSON.stringify(tree.stdout));
  const into = await run(await shell({}), 'mkdir -p /cp/a/b; echo x > /cp/a/b/f; mkdir -p /cp/t; cp -r /cp/a /cp/t; cat /cp/t/a/b/f; echo rc=$?');
  check('cp -r: a directory copied into a directory lands inside it', into.stdout === 'x\nrc=0\n', JSON.stringify(into.stdout));
  const plain = await run(await shell({}), 'mkdir -p /cp/a; cp /cp/a /cp/z; echo rc=$?');
  check('cp: a directory without -r is omitted with status 1, as GNU cp', plain.stdout === 'rc=1\n' && plain.stderr === "cp: -r not specified; omitting directory '/cp/a'\n", JSON.stringify(plain));
  const link = await run(await shell({}), 'mkdir -p /cp; echo t > /cp/tt; ln -s /cp/tt /cp/ll; mkdir -p /cp/d; cp -r /cp/ll /cp/d; test -L /cp/d/ll && echo link-kept');
  check('cp -r: a link is copied as a link', link.stdout === 'link-kept\n', JSON.stringify(link.stdout));
  const self = await run(await shell({}), 'mkdir -p /cp/m/n; echo k > /cp/m/n/f; cp -r /cp/m /cp/m; echo rc=$?');
  check('cp -r: a directory cannot be copied into itself', self.stdout === 'rc=1\n' && self.stderr === "cp: cannot copy a directory, '/cp/m', into itself, '/cp/m/m'\n", JSON.stringify(self));
});

group('mv: a directory is moved with its tree, and not into itself, as GNU mv does', async () => {
  const moved = await run(await shell({}), 'mkdir -p /mv/d2/s; echo q > /mv/d2/s/f; mv /mv/d2 /mv/e; cat /mv/e/s/f; test -d /mv/d2; echo rc=$?');
  check('mv: a directory is moved with its tree and the source is gone', moved.stdout === 'q\nrc=1\n', JSON.stringify(moved.stdout));
  const into = await run(await shell({}), 'mkdir -p /mv/x/y; echo r > /mv/x/y/f; mkdir -p /mv/dst; mv /mv/x /mv/dst; cat /mv/dst/x/y/f; echo rc=$?');
  check('mv: a directory moved into a directory lands inside it', into.stdout === 'r\nrc=0\n', JSON.stringify(into.stdout));
  const self = await run(await shell({}), 'mkdir -p /mv/p/q; mv /mv/p /mv/p/q; echo rc=$?');
  check('mv: a directory cannot be moved into its own subdirectory', self.stdout === 'rc=1\n' && self.stderr === "mv: cannot move '/mv/p' to a subdirectory of itself, '/mv/p/q/p'\n", JSON.stringify(self));
});

group('diff -u and -U: unified output, with labels, matches GNU diff', async () => {
  const u1 = await run(await shell({ '/workspace/a.txt': "a\nb\nc\nd\ne\nf\ng\n", '/workspace/b.txt': "a\nb\nX\nd\ne\nf\ng\n" }), "diff -u --label A --label B /workspace/a.txt /workspace/b.txt; echo rc=$?");
  check("diff -u: a changed line gets a hunk with three lines of context", u1.stdout === "--- A\n+++ B\n@@ -1,6 +1,6 @@\n a\n b\n-c\n+X\n d\n e\n f\nrc=1\n", JSON.stringify(u1.stdout));
  const u2 = await run(await shell({ '/workspace/a.txt': "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15\n", '/workspace/b.txt': "A\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\nB\n" }), "diff -u --label A --label B /workspace/a.txt /workspace/b.txt; echo rc=$?");
  check("diff -u: changes far apart get two hunks", u2.stdout === "--- A\n+++ B\n@@ -1,4 +1,4 @@\n-1\n+A\n 2\n 3\n 4\n@@ -12,4 +12,4 @@\n 12\n 13\n 14\n-15\n+B\nrc=1\n", JSON.stringify(u2.stdout));
  const u3 = await run(await shell({ '/workspace/a.txt': "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n", '/workspace/b.txt': "A\n2\n3\n4\n5\n6\n7\nH\n9\n10\n11\n12\n" }), "diff -u --label A --label B /workspace/a.txt /workspace/b.txt; echo rc=$?");
  check("diff -u: changes six unchanged lines apart share one hunk", u3.stdout === "--- A\n+++ B\n@@ -1,11 +1,11 @@\n-1\n+A\n 2\n 3\n 4\n 5\n 6\n 7\n-8\n+H\n 9\n 10\n 11\nrc=1\n", JSON.stringify(u3.stdout));
  const u4 = await run(await shell({ '/workspace/a.txt': "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n", '/workspace/b.txt': "A\n2\n3\n4\n5\n6\n7\n8\nI\n10\n11\n12\n" }), "diff -u --label A --label B /workspace/a.txt /workspace/b.txt; echo rc=$?");
  check("diff -u: changes seven unchanged lines apart get two hunks", u4.stdout === "--- A\n+++ B\n@@ -1,4 +1,4 @@\n-1\n+A\n 2\n 3\n 4\n@@ -6,7 +6,7 @@\n 6\n 7\n 8\n-9\n+I\n 10\n 11\n 12\nrc=1\n", JSON.stringify(u4.stdout));
  const u5 = await run(await shell({ '/workspace/a.txt': "x\ny\n", '/workspace/b.txt': "new0\nx\ny\n" }), "diff -u --label A --label B /workspace/a.txt /workspace/b.txt; echo rc=$?");
  check("diff -u: an insertion at the start of a file", u5.stdout === "--- A\n+++ B\n@@ -1,2 +1,3 @@\n+new0\n x\n y\nrc=1\n", JSON.stringify(u5.stdout));
  const u6 = await run(await shell({ '/workspace/a.txt': "p\nq\nr\n", '/workspace/b.txt': "p\nq\n" }), "diff -u --label A --label B /workspace/a.txt /workspace/b.txt; echo rc=$?");
  check("diff -u: a deletion at the end of a file", u6.stdout === "--- A\n+++ B\n@@ -1,3 +1,2 @@\n p\n q\n-r\nrc=1\n", JSON.stringify(u6.stdout));
  const u7 = await run(await shell({ '/workspace/a.txt': "", '/workspace/b.txt': "only\n" }), "diff -u --label A --label B /workspace/a.txt /workspace/b.txt; echo rc=$?");
  check("diff -u: an empty file gives a hunk that starts at line 0", u7.stdout === "--- A\n+++ B\n@@ -0,0 +1 @@\n+only\nrc=1\n", JSON.stringify(u7.stdout));
  const u8 = await run(await shell({ '/workspace/a.txt': "a\nb\nc\n", '/workspace/b.txt': "a\nNEW\nb\nc\n" }), "diff -U0 --label A --label B /workspace/a.txt /workspace/b.txt; echo rc=$?");
  check("diff -U0: a zero-context insertion gives a zero-length old range", u8.stdout === "--- A\n+++ B\n@@ -1,0 +2 @@\n+NEW\nrc=1\n", JSON.stringify(u8.stdout));
  const u9 = await run(await shell({ '/workspace/a.txt': "a\nb\nc\nd\n", '/workspace/b.txt': "a\nd\n" }), "diff -U0 --label A --label B /workspace/a.txt /workspace/b.txt; echo rc=$?");
  check("diff -U0: a zero-context deletion gives a zero-length new range", u9.stdout === "--- A\n+++ B\n@@ -2,2 +1,0 @@\n-b\n-c\nrc=1\n", JSON.stringify(u9.stdout));
  const u10 = await run(await shell({ '/workspace/a.txt': "a\nb\nc\nd\ne\nf\ng\n", '/workspace/b.txt': "a\nb\nX\nd\ne\nf\ng\n" }), "diff -U1 --label A --label B /workspace/a.txt /workspace/b.txt; echo rc=$?");
  check("diff -U1: one line of context on each side", u10.stdout === "--- A\n+++ B\n@@ -2,3 +2,3 @@\n b\n-c\n+X\n d\nrc=1\n", JSON.stringify(u10.stdout));
  const u11 = await run(await shell({ '/workspace/a.txt': "1\n2\n3\n4\n5\n6\n", '/workspace/b.txt': "1\n3\n4\nZ\n5\n6\n" }), "diff -u --label A --label B /workspace/a.txt /workspace/b.txt; echo rc=$?");
  check("diff -u: a mixed change block lists its deletions and then its insertions", u11.stdout === "--- A\n+++ B\n@@ -1,6 +1,6 @@\n 1\n-2\n 3\n 4\n+Z\n 5\n 6\nrc=1\n", JSON.stringify(u11.stdout));
  const u12 = await run(await shell({ '/workspace/a.txt': "same\n", '/workspace/b.txt': "same\n" }), "diff -u --label A --label B /workspace/a.txt /workspace/b.txt; echo rc=$?");
  check("diff -u: identical files give no output and status 0", u12.stdout === "rc=0\n", JSON.stringify(u12.stdout));
});

group('diff -c and -C: context output, with labels, matches GNU diff', async () => {
  const c1 = await run(await shell({ '/workspace/a.txt': "a\nb\nc\nd\ne\nf\ng\n", '/workspace/b.txt': "a\nb\nX\nd\ne\nf\ng\n" }), "diff -c --label A --label B /workspace/a.txt /workspace/b.txt; echo rc=$?");
  check("diff -c: a changed line is marked with ! on both sides, with context", c1.stdout === "*** A\n--- B\n***************\n*** 1,6 ****\n  a\n  b\n! c\n  d\n  e\n  f\n--- 1,6 ----\n  a\n  b\n! X\n  d\n  e\n  f\nrc=1\n", JSON.stringify(c1.stdout));
  const c2 = await run(await shell({ '/workspace/a.txt': "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15\n", '/workspace/b.txt': "A\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\nB\n" }), "diff -c --label A --label B /workspace/a.txt /workspace/b.txt; echo rc=$?");
  check("diff -c: changes far apart get two hunks, each with its own separator", c2.stdout === "*** A\n--- B\n***************\n*** 1,4 ****\n! 1\n  2\n  3\n  4\n--- 1,4 ----\n! A\n  2\n  3\n  4\n***************\n*** 12,15 ****\n  12\n  13\n  14\n! 15\n--- 12,15 ----\n  12\n  13\n  14\n! B\nrc=1\n", JSON.stringify(c2.stdout));
  const c3 = await run(await shell({ '/workspace/a.txt': "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n", '/workspace/b.txt': "A\n2\n3\n4\n5\n6\n7\nH\n9\n10\n11\n12\n" }), "diff -c --label A --label B /workspace/a.txt /workspace/b.txt; echo rc=$?");
  check("diff -c: changes six unchanged lines apart share one hunk", c3.stdout === "*** A\n--- B\n***************\n*** 1,11 ****\n! 1\n  2\n  3\n  4\n  5\n  6\n  7\n! 8\n  9\n  10\n  11\n--- 1,11 ----\n! A\n  2\n  3\n  4\n  5\n  6\n  7\n! H\n  9\n  10\n  11\nrc=1\n", JSON.stringify(c3.stdout));
  const c4 = await run(await shell({ '/workspace/a.txt': "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n", '/workspace/b.txt': "A\n2\n3\n4\n5\n6\n7\n8\nI\n10\n11\n12\n" }), "diff -c --label A --label B /workspace/a.txt /workspace/b.txt; echo rc=$?");
  check("diff -c: changes seven unchanged lines apart get two hunks", c4.stdout === "*** A\n--- B\n***************\n*** 1,4 ****\n! 1\n  2\n  3\n  4\n--- 1,4 ----\n! A\n  2\n  3\n  4\n***************\n*** 6,12 ****\n  6\n  7\n  8\n! 9\n  10\n  11\n  12\n--- 6,12 ----\n  6\n  7\n  8\n! I\n  10\n  11\n  12\nrc=1\n", JSON.stringify(c4.stdout));
  const c5 = await run(await shell({ '/workspace/a.txt': "x\ny\n", '/workspace/b.txt': "new0\nx\ny\n" }), "diff -c --label A --label B /workspace/a.txt /workspace/b.txt; echo rc=$?");
  check("diff -c: an insertion at the start shows no old lines, only the new side", c5.stdout === "*** A\n--- B\n***************\n*** 1,2 ****\n--- 1,3 ----\n+ new0\n  x\n  y\nrc=1\n", JSON.stringify(c5.stdout));
  const c6 = await run(await shell({ '/workspace/a.txt': "p\nq\nr\n", '/workspace/b.txt': "p\nq\n" }), "diff -c --label A --label B /workspace/a.txt /workspace/b.txt; echo rc=$?");
  check("diff -c: a deletion at the end shows the old side with - and no new lines", c6.stdout === "*** A\n--- B\n***************\n*** 1,3 ****\n  p\n  q\n- r\n--- 1,2 ----\nrc=1\n", JSON.stringify(c6.stdout));
  const c7 = await run(await shell({ '/workspace/a.txt': "", '/workspace/b.txt': "only\n" }), "diff -c --label A --label B /workspace/a.txt /workspace/b.txt; echo rc=$?");
  check("diff -c: an empty old file gives the range 0 and the new lines with +", c7.stdout === "*** A\n--- B\n***************\n*** 0 ****\n--- 1 ----\n+ only\nrc=1\n", JSON.stringify(c7.stdout));
  const c8 = await run(await shell({ '/workspace/a.txt': "a\nb\nc\n", '/workspace/b.txt': "a\nNEW\nb\nc\n" }), "diff -C0 --label A --label B /workspace/a.txt /workspace/b.txt; echo rc=$?");
  check("diff -C0: a zero-context insertion gives the old range as the line before it", c8.stdout === "*** A\n--- B\n***************\n*** 1 ****\n--- 2 ----\n+ NEW\nrc=1\n", JSON.stringify(c8.stdout));
  const c9 = await run(await shell({ '/workspace/a.txt': "a\nb\nc\nd\n", '/workspace/b.txt': "a\nd\n" }), "diff -C0 --label A --label B /workspace/a.txt /workspace/b.txt; echo rc=$?");
  check("diff -C0: a zero-context deletion gives the new range as the line before it", c9.stdout === "*** A\n--- B\n***************\n*** 2,3 ****\n- b\n- c\n--- 1 ----\nrc=1\n", JSON.stringify(c9.stdout));
  const c10 = await run(await shell({ '/workspace/a.txt': "a\nb\nc\nd\ne\nf\ng\n", '/workspace/b.txt': "a\nb\nX\nd\ne\nf\ng\n" }), "diff -C1 --label A --label B /workspace/a.txt /workspace/b.txt; echo rc=$?");
  check("diff -C1: one line of context on each side", c10.stdout === "*** A\n--- B\n***************\n*** 2,4 ****\n  b\n! c\n  d\n--- 2,4 ----\n  b\n! X\n  d\nrc=1\n", JSON.stringify(c10.stdout));
  const c11 = await run(await shell({ '/workspace/a.txt': "1\n2\n3\n4\n5\n6\n", '/workspace/b.txt': "1\n3\n4\nZ\n5\n6\n" }), "diff -c --label A --label B /workspace/a.txt /workspace/b.txt; echo rc=$?");
  check("diff -c: a deletion and an insertion in one hunk are marked - and + on their own sides", c11.stdout === "*** A\n--- B\n***************\n*** 1,6 ****\n  1\n- 2\n  3\n  4\n  5\n  6\n--- 1,6 ----\n  1\n  3\n  4\n+ Z\n  5\n  6\nrc=1\n", JSON.stringify(c11.stdout));
  const c12 = await run(await shell({ '/workspace/a.txt': "1\n2\n3\n4\n5\n6\n7\n8\n9\n", '/workspace/b.txt': "1\n2\nX\n4\n5\n6\n7\n8\n9\n" }), "diff -c --label A --label B /workspace/a.txt /workspace/b.txt; echo rc=$?");
  check("diff -c: a replaced line is marked ! on both sides", c12.stdout === "*** A\n--- B\n***************\n*** 1,6 ****\n  1\n  2\n! 3\n  4\n  5\n  6\n--- 1,6 ----\n  1\n  2\n! X\n  4\n  5\n  6\nrc=1\n", JSON.stringify(c12.stdout));
  const c13 = await run(await shell({ '/workspace/a.txt': "same\n", '/workspace/b.txt': "same\n" }), "diff -c --label A --label B /workspace/a.txt /workspace/b.txt; echo rc=$?");
  check("diff -c: identical files give no output and status 0", c13.stdout === "rc=0\n", JSON.stringify(c13.stdout));
});

group('chmod: symbolic modes match GNU chmod, and octal modes still work', async () => {
  const m1 = await run(await shell({}), "mkdir -p /cm; echo a > /cm/f; chmod 644 /cm/f; chmod \"u+x\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: u+x adds the owner execute bit", m1.stdout === "rc=0\n744\n" && m1.stderr === "", JSON.stringify([m1.stdout, m1.stderr]));
  const m2 = await run(await shell({}), "mkdir -p /cm; echo a > /cm/f; chmod 666 /cm/f; chmod \"go-w\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: go-w removes write from group and other", m2.stdout === "rc=0\n644\n" && m2.stderr === "", JSON.stringify([m2.stdout, m2.stderr]));
  const m3 = await run(await shell({}), "mkdir -p /cm; echo a > /cm/f; chmod 755 /cm/f; chmod \"a=r\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: a=r sets read only for all three classes", m3.stdout === "rc=0\n444\n" && m3.stderr === "", JSON.stringify([m3.stdout, m3.stderr]));
  const m4 = await run(await shell({}), "mkdir -p /cm; echo a > /cm/f; chmod 444 /cm/f; chmod \"+w\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: +w with no class is limited by the umask for group and other", m4.stdout === "rc=0\n644\n" && m4.stderr === "", JSON.stringify([m4.stdout, m4.stderr]));
  const m5 = await run(await shell({}), "mkdir -p /cm; echo a > /cm/f; chmod 644 /cm/f; chmod \"-w\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: -w with no class removes write from all three classes", m5.stdout === "rc=0\n444\n" && m5.stderr === "", JSON.stringify([m5.stdout, m5.stderr]));
  const m6 = await run(await shell({}), "mkdir -p /cm; echo a > /cm/f; chmod 000 /cm/f; chmod \"u+rwx,g+r\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: clauses separated by a comma apply in order", m6.stdout === "rc=0\n740\n" && m6.stderr === "", JSON.stringify([m6.stdout, m6.stderr]));
  const m7 = await run(await shell({}), "mkdir -p /cm; echo a > /cm/f; chmod 644 /cm/f; chmod \"g=u\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: g=u copies the owner bits to the group", m7.stdout === "rc=0\n664\n" && m7.stderr === "", JSON.stringify([m7.stdout, m7.stderr]));
  const m8 = await run(await shell({}), "mkdir -p /cm; echo a > /cm/f; chmod 644 /cm/f; chmod \"a+s\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: a+s sets the setuid and setgid bits", m8.stdout === "rc=0\n6644\n" && m8.stderr === "", JSON.stringify([m8.stdout, m8.stderr]));
  const m9 = await run(await shell({}), "mkdir -p /cm; echo a > /cm/f; chmod 644 /cm/f; chmod \"u+x,go+X\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: X adds execute only when some execute bit is already set", m9.stdout === "rc=0\n755\n" && m9.stderr === "", JSON.stringify([m9.stdout, m9.stderr]));
  const m10 = await run(await shell({}), "mkdir -p /cm; echo a > /cm/f; chmod 644 /cm/f; chmod \"u+rx,g-r,o=\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: three clauses of different operators in one mode", m10.stdout === "rc=0\n700\n" && m10.stderr === "", JSON.stringify([m10.stdout, m10.stderr]));
  const m11 = await run(await shell({}), "mkdir -p /cm; echo a > /cm/f; chmod 644 /cm/f; chmod \"+rw\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: +rw with no class keeps the umask on group and other write", m11.stdout === "rc=0\n644\n" && m11.stderr === "", JSON.stringify([m11.stdout, m11.stderr]));
  const m12 = await run(await shell({}), "mkdir -p /cm; echo a > /cm/f; chmod 644 /cm/f; chmod \"u+\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: a class with no permission changes nothing", m12.stdout === "rc=0\n644\n" && m12.stderr === "", JSON.stringify([m12.stdout, m12.stderr]));
  const m13 = await run(await shell({}), "mkdir -p /cm; echo a > /cm/f; chmod 700 /cm/f; chmod \"ug+w\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: ug+w adds write to owner and group only", m13.stdout === "rc=0\n720\n" && m13.stderr === "", JSON.stringify([m13.stdout, m13.stderr]));
  const m14 = await run(await shell({}), "mkdir -p /cm; echo a > /cm/f; chmod 720 /cm/f; chmod \"a+X\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: a+X adds execute to all classes when the owner has it", m14.stdout === "rc=0\n731\n" && m14.stderr === "", JSON.stringify([m14.stdout, m14.stderr]));
  const m15 = await run(await shell({}), "mkdir -p /cm; echo a > /cm/f; chmod 777 /cm/f; chmod \"o=\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: o= clears all bits of other", m15.stdout === "rc=0\n770\n" && m15.stderr === "", JSON.stringify([m15.stdout, m15.stderr]));
  const e1 = await run(await shell({}), "mkdir -p /cm; echo a > /cm/f; chmod 644 /cm/f; chmod \"u+q\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: an unknown permission letter is refused with status 1 and the file is unchanged", e1.stdout === "rc=1\n644\n" && e1.stderr === "chmod: invalid mode: 'u+q'\nTry 'chmod --help' for more information.\n", JSON.stringify([e1.stdout, e1.stderr]));
  const e2 = await run(await shell({}), "mkdir -p /cm; echo a > /cm/f; chmod 644 /cm/f; chmod \"x+x\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: a letter where a class or operator belongs is refused with status 1", e2.stdout === "rc=1\n644\n" && e2.stderr === "chmod: invalid mode: 'x+x'\nTry 'chmod --help' for more information.\n", JSON.stringify([e2.stdout, e2.stderr]));
  const e3 = await run(await shell({}), "mkdir -p /cm; echo a > /cm/f; chmod 644 /cm/f; chmod \"u\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: a clause with no operator is refused with status 1", e3.stdout === "rc=1\n644\n" && e3.stderr === "chmod: invalid mode: 'u'\nTry 'chmod --help' for more information.\n", JSON.stringify([e3.stdout, e3.stderr]));
  const e4 = await run(await shell({}), "mkdir -p /cm; echo a > /cm/f; chmod 644 /cm/f; chmod \",u+x\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: an empty clause is refused with status 1", e4.stdout === "rc=1\n644\n" && e4.stderr === "chmod: invalid mode: ',u+x'\nTry 'chmod --help' for more information.\n", JSON.stringify([e4.stdout, e4.stderr]));
});

group('set -x: tracing matches bash for simple commands, and the gaps are rows with their cause', async () => {
  const xt0 = await run(await shell({}), "echo a; set -x; echo hi; set +x; echo b");
  check("set -x: a simple command is traced with + and its expanded words", xt0.stdout === "a\nhi\nb\n" && xt0.stderr === "+ echo hi\n+ set +x\n", JSON.stringify([xt0.stdout, xt0.stderr]));
  const xt1 = await run(await shell({}), "set -x; x=5; echo $x \"a b\" \"q\"; set +x");
  check("set -x: an assignment is traced, then the command with the expanded variable", xt1.stdout === "5 a b q\n" && xt1.stderr === "+ x=5\n+ echo 5 'a b' q\n+ set +x\n", JSON.stringify([xt1.stdout, xt1.stderr]));
  const xt2 = await run(await shell({}), "set -x; echo a | cat; set +x");
  check("set -x: each stage of a pipeline is traced", xt2.stdout === "a\n" && xt2.stderr === "+ echo a\n+ cat\n+ set +x\n", JSON.stringify([xt2.stdout, xt2.stderr]));
  const xt3 = await run(await shell({}), "f() { echo in; }; set -x; f; set +x");
  check("set -x: a function call is traced, then the commands in its body", xt3.stdout === "in\n" && xt3.stderr === "+ f\n+ echo in\n+ set +x\n", JSON.stringify([xt3.stdout, xt3.stderr]));
  const xt4 = await run(await shell({}), "set -x; if true; then echo y; fi; set +x");
  check("set -x: the condition of an if is traced as a simple command", xt4.stdout === "y\n" && xt4.stderr === "+ true\n+ echo y\n+ set +x\n", JSON.stringify([xt4.stdout, xt4.stderr]));
  const xt5 = await run(await shell({}), "set -x; echo ''; set +x");
  check("set -x: an empty word is traced as two quotes", xt5.stdout === "\n" && xt5.stderr === "+ echo ''\n+ set +x\n", JSON.stringify([xt5.stdout, xt5.stderr]));
  const xt6 = await run(await shell({}), "set -x; false; echo rc=$?; set +x");
  check("set -x: a failing command is traced and the status is kept", xt6.stdout === "rc=1\n" && xt6.stderr === "+ false\n+ echo rc=1\n+ set +x\n", JSON.stringify([xt6.stdout, xt6.stderr]));
  const xt7 = await run(await shell({}), "set -x; a=1 echo hi; set +x");
  check("set -x: prefix assignments are traced on their own lines before the command", xt7.stdout === "hi\n" && xt7.stderr === "+ a=1\n+ echo hi\n+ set +x\n", JSON.stringify([xt7.stdout, xt7.stderr]));
  const xt8 = await run(await shell({}), "set -x; x='a b'; echo x='a b'; y=\"it's\"; echo \"$y\"; set +x");
  check("set -x: a value with a space or a quote is quoted, as bash quotes it", xt8.stdout === "x=a b\nit's\n" && xt8.stderr === "+ x='a b'\n+ echo 'x=a b'\n+ y='it'\\''s'\n+ echo 'it'\\''s'\n+ set +x\n", JSON.stringify([xt8.stdout, xt8.stderr]));
  const xt9 = await run(await shell({}), "set -x; a=1 b=2; set +x");
  check("set -x: assignments with no command are traced one per line", xt9.stdout === "" && xt9.stderr === "+ a=1\n+ b=2\n+ set +x\n", JSON.stringify([xt9.stdout, xt9.stderr]));
  const xt10 = await run(await shell({}), "set -x; e=; echo \"[$e]\"; set +x");
  check("set -x: an empty assignment is traced with no quotes", xt10.stdout === "[]\n" && xt10.stderr === "+ e=\n+ echo '[]'\n+ set +x\n", JSON.stringify([xt10.stdout, xt10.stderr]));
  const xt11 = await run(await shell({}), "set -ex; echo ee; set +ex");
  check("set -ex: the combined letters -e and -x both take effect", xt11.stdout === "ee\n" && xt11.stderr === "+ echo ee\n+ set +ex\n", JSON.stringify([xt11.stdout, xt11.stderr]));
  const xt12 = await run(await shell({}), "set -x; echo 'a\\b'; set +x");
  check("set -x: a word with a backslash is single-quoted", xt12.stdout === "a\\b\n" && xt12.stderr === "+ echo 'a\\b'\n+ set +x\n", JSON.stringify([xt12.stdout, xt12.stderr]));
  const xt13 = await run(await shell({}), "set -x; for i in 1 2; do echo $i; done; set +x");
  check("set -x: a for loop header is printed before each pass, as bash does", xt13.stdout === "1\n2\n" && xt13.stderr === "+ for i in 1 2\n+ echo 1\n+ for i in 1 2\n+ echo 2\n+ set +x\n", JSON.stringify([xt13.stdout, xt13.stderr]));
  const xt14 = await run(await shell({}), "PS4='>> '; set -x; echo p; set +x");
  check("set -x: PS4 sets the text before each trace line, as bash does", xt14.stdout === "p\n" && xt14.stderr === ">> echo p\n>> set +x\n", JSON.stringify([xt14.stdout, xt14.stderr]));
  const xt15 = await run(await shell({}), "PS4=''; set -x; echo p; set +x");
  check("set -x: an empty PS4 gives no text before each trace line, as bash does", xt15.stdout === "p\n" && xt15.stderr === "echo p\nset +x\n", JSON.stringify([xt15.stdout, xt15.stderr]));
  const xt16 = await run(await shell({}), "set -x; echo \"$(echo sub)\"; set +x");
  check("set -x: a command substitution is traced at ++, as bash does", xt16.stdout === "sub\n" && xt16.stderr === "++ echo sub\n+ echo sub\n+ set +x\n", JSON.stringify([xt16.stdout, xt16.stderr]));
});

group('redirects: an output into a missing directory is refused before the command runs, as dash does', async () => {
  const rd0 = await run(await shell({}), "echo a > /nonexist-q/z; echo rc=$?");
  check("redirects: an output into a missing directory fails with status 2 and the command does not run, as dash does", rd0.stdout === "rc=2\n" && rd0.stderr === "thebird: cannot create /nonexist-q/z: Directory nonexistent\n", JSON.stringify([rd0.stdout, rd0.stderr]));
  const rd1 = await run(await shell({}), "echo a >> /nonexist-q/z; echo rc=$?");
  check("redirects: an append into a missing directory fails with status 2, as dash does", rd1.stdout === "rc=2\n" && rd1.stderr === "thebird: cannot create /nonexist-q/z: Directory nonexistent\n", JSON.stringify([rd1.stdout, rd1.stderr]));
  const rd2 = await run(await shell({}), "echo e 2> /nonexist-q/deep/z; echo rc=$?");
  check("redirects: a 2> into a missing directory fails before the command runs, as dash does", rd2.stdout === "rc=2\n" && rd2.stderr === "thebird: cannot create /nonexist-q/deep/z: Directory nonexistent\n", JSON.stringify([rd2.stdout, rd2.stderr]));
  const rd3 = await run(await shell({}), "echo a > /dev/null; echo rc=$?");
  check("redirects: an output into /dev/null still works next to a missing directory check, as dash does", rd3.stdout === "rc=0\n" && rd3.stderr === "", JSON.stringify([rd3.stdout, rd3.stderr]));
});

group('expr: length, substr and index count characters in a UTF-8 locale, as GNU expr does', async () => {
  const ex0 = await run(await shell({}), "expr length 'a😀é'; echo rc=$?");
  check("expr length counts characters in a UTF-8 locale, not UTF-16 units, as GNU expr does", ex0.stdout === "3\nrc=0\n" && ex0.stderr === "", JSON.stringify([ex0.stdout, ex0.stderr]));
  const ex1 = await run(await shell({}), "expr length 'héllo'; echo rc=$?");
  check("expr length counts a two-byte letter as one character", ex1.stdout === "5\nrc=0\n" && ex1.stderr === "", JSON.stringify([ex1.stdout, ex1.stderr]));
  const ex2 = await run(await shell({}), "expr length 'abc'; echo rc=$?");
  check("expr length of ASCII is unchanged", ex2.stdout === "3\nrc=0\n" && ex2.stderr === "", JSON.stringify([ex2.stdout, ex2.stderr]));
  const ex3 = await run(await shell({}), "expr substr 'a😀é' 2 1; echo rc=$?");
  check("expr substr takes characters, so a character outside the BMP is one", ex3.stdout === "😀\nrc=0\n" && ex3.stderr === "", JSON.stringify([ex3.stdout, ex3.stderr]));
  const ex4 = await run(await shell({}), "expr substr 'a😀é' 3 5; echo rc=$?");
  check("expr substr after an astral character starts at the next character", ex4.stdout === "é\nrc=0\n" && ex4.stderr === "", JSON.stringify([ex4.stdout, ex4.stderr]));
  const ex5 = await run(await shell({}), "expr index 'a😀é' 'é'; echo rc=$?");
  check("expr index counts characters, so an accented letter is at position 3", ex5.stdout === "3\nrc=0\n" && ex5.stderr === "", JSON.stringify([ex5.stdout, ex5.stderr]));
  const ex6 = await run(await shell({}), "expr index 'a😀é' '😀'; echo rc=$?");
  check("expr index of an astral character is at position 2", ex6.stdout === "2\nrc=0\n" && ex6.stderr === "", JSON.stringify([ex6.stdout, ex6.stderr]));
});

group('expr: equivalence classes and collating symbols of one character match it, as GNU expr does in the C locale', async () => {
  const eq0 = await run(await shell({}), "expr e : '[[=e=]]'; echo rc=$?");
  check("expr: an equivalence class [=c=] matches the character itself, as GNU expr does in the C locale", eq0.stdout === "1\nrc=0\n" && eq0.stderr === "", JSON.stringify([eq0.stdout, eq0.stderr]));
  const eq1 = await run(await shell({}), "expr x : '[[=e=]]'; echo rc=$?");
  check("expr: an equivalence class [=c=] does not match another character", eq1.stdout === "0\nrc=1\n" && eq1.stderr === "", JSON.stringify([eq1.stdout, eq1.stderr]));
  const eq2 = await run(await shell({}), "expr e : '[[.e.]]'; echo rc=$?");
  check("expr: a collating symbol [.c.] matches the character itself", eq2.stdout === "1\nrc=0\n" && eq2.stderr === "", JSON.stringify([eq2.stdout, eq2.stderr]));
  const eq3 = await run(await shell({}), "expr e : '[^[=e=]]'; echo rc=$?");
  check("expr: a negated equivalence class does not match its own character", eq3.stdout === "0\nrc=1\n" && eq3.stderr === "", JSON.stringify([eq3.stdout, eq3.stderr]));
  const eq4 = await run(await shell({}), "expr 'é' : '[[=e=]]'; echo rc=$?");
  check("expr: an equivalence class matches an accented letter with its base letter, as GNU expr does in a UTF-8 locale", eq4.stdout === "1\nrc=0\n" && eq4.stderr === "", JSON.stringify([eq4.stdout, eq4.stderr]));
});

group("expr: an equivalence class matches the accented letters of its base letter, and a collating symbol of one is refused, as GNU expr does in a UTF-8 locale", async () => {
  const eu1 = await run(await shell({}), "expr 'E' : '[[=e=]]'; echo rc=$?");
  check("expr: an equivalence class matches the base letter in upper case, and an upper-case class matches a lower-case letter", eu1.stdout === "1\nrc=0\n" && eu1.stderr === "", JSON.stringify([eu1.stdout, eu1.stderr]));
  const eu2 = await run(await shell({}), "expr 'e' : '[[=E=]]'; echo rc=$?");
  check("expr: an upper-case equivalence class matches a lower-case letter", eu2.stdout === "1\nrc=0\n" && eu2.stderr === "", JSON.stringify([eu2.stdout, eu2.stderr]));
  const eu3 = await run(await shell({}), "expr 'É' : '[[=e=]]'; echo rc=$?");
  check("expr: an upper-case accented letter matches the base letter's class", eu3.stdout === "1\nrc=0\n" && eu3.stderr === "", JSON.stringify([eu3.stdout, eu3.stderr]));
  const eu4 = await run(await shell({}), "expr 'ẽ' : '[[=e=]]'; echo rc=$?");
  check("expr: a tilde and a macron above a letter match its base letter's class", eu4.stdout === "1\nrc=0\n" && eu4.stderr === "", JSON.stringify([eu4.stdout, eu4.stderr]));
  const eu5 = await run(await shell({}), "expr 'ḗ' : '[[=e=]]'; echo rc=$?");
  check("expr: a macron with an acute accent matches the base letter's class", eu5.stdout === "1\nrc=0\n" && eu5.stderr === "", JSON.stringify([eu5.stdout, eu5.stderr]));
  const eu6 = await run(await shell({}), "expr 'é' : '[[=é=]]'; echo rc=$?");
  check("expr: an accented letter matches its own equivalence class", eu6.stdout === "1\nrc=0\n" && eu6.stderr === "", JSON.stringify([eu6.stdout, eu6.stderr]));
  const eu7 = await run(await shell({}), "expr 'e' : '[[=é=]]'; echo rc=$?");
  check("expr: a base letter matches the equivalence class of an accented letter", eu7.stdout === "1\nrc=0\n" && eu7.stderr === "", JSON.stringify([eu7.stdout, eu7.stderr]));
  const eu8 = await run(await shell({}), "expr 'é' : '[[=E=]]'; echo rc=$?");
  check("expr: an accented letter matches an upper-case base class", eu8.stdout === "1\nrc=0\n" && eu8.stderr === "", JSON.stringify([eu8.stdout, eu8.stderr]));
  const eu9 = await run(await shell({}), "expr 'é' : '[^[=e=]]'; echo rc=$?");
  check("expr: a negated equivalence class excludes an accented letter of its base", eu9.stdout === "0\nrc=1\n" && eu9.stderr === "", JSON.stringify([eu9.stdout, eu9.stderr]));
  const eu10 = await run(await shell({}), "expr 'x' : '[^[=e=]]'; echo rc=$?");
  check("expr: a negated equivalence class matches a letter outside its base", eu10.stdout === "1\nrc=0\n" && eu10.stderr === "", JSON.stringify([eu10.stdout, eu10.stderr]));
  const eu11 = await run(await shell({}), "expr 'eé' : '[[=e=]]*'; echo rc=$?");
  check("expr: an equivalence class with a repeat counts accented letters of its base", eu11.stdout === "2\nrc=0\n" && eu11.stderr === "", JSON.stringify([eu11.stdout, eu11.stderr]));
  const eu12 = await run(await shell({}), "expr 'é' : '[[=e=]x]'; echo rc=$?");
  check("expr: an equivalence class with another character in the bracket matches both", eu12.stdout === "1\nrc=0\n" && eu12.stderr === "", JSON.stringify([eu12.stdout, eu12.stderr]));
  const eu13 = await run(await shell({}), "expr 'x' : '[[=e=]x]'; echo rc=$?");
  check("expr: an equivalence class with another character in the bracket matches that character", eu13.stdout === "1\nrc=0\n" && eu13.stderr === "", JSON.stringify([eu13.stdout, eu13.stderr]));
  const eu14 = await run(await shell({}), "expr 'é' : '[[=e=][x]]'; echo rc=$?");
  check("expr: a bracket with an equivalence class and a bracket inside ends at the first close bracket", eu14.stdout === "0\nrc=1\n" && eu14.stderr === "", JSON.stringify([eu14.stdout, eu14.stderr]));
  const eu15 = await run(await shell({}), "expr 'é]' : '[[=e=][x]]'; echo rc=$?");
  check("expr: a bracket with an equivalence class and a bracket inside matches the bracket and the close bracket after it", eu15.stdout === "2\nrc=0\n" && eu15.stderr === "", JSON.stringify([eu15.stdout, eu15.stderr]));
  const eu16 = await run(await shell({}), "expr '-' : '[[=-=]]'; echo rc=$?");
  check("expr: a hyphen as an equivalence class matches itself", eu16.stdout === "1\nrc=0\n" && eu16.stderr === "", JSON.stringify([eu16.stdout, eu16.stderr]));
  const eu17 = await run(await shell({}), "expr 'ø' : '[[=o=]]'; echo rc=$?");
  check("expr: an o with a stroke matches the base letter o's class, as GNU expr does", eu17.stdout === "1\nrc=0\n" && eu17.stderr === "", JSON.stringify([eu17.stdout, eu17.stderr]));
  const eu18 = await run(await shell({}), "expr 'ł' : '[[=l=]]'; echo rc=$?");
  check("expr: an l with a stroke matches the base letter l's class, as GNU expr does", eu18.stdout === "1\nrc=0\n" && eu18.stderr === "", JSON.stringify([eu18.stdout, eu18.stderr]));
  const eu19 = await run(await shell({}), "expr 'ß' : '[[=s=]]'; echo rc=$?");
  check("expr: a sharp s does not match the base letter s's class, as GNU expr does", eu19.stdout === "0\nrc=1\n" && eu19.stderr === "", JSON.stringify([eu19.stdout, eu19.stderr]));
  const eu20 = await run(await shell({}), "expr 'é' : '[[.é.]]'; echo rc=$?");
  check("expr: a collating symbol of an accented letter is refused with status 2", eu20.stdout === "rc=2\n" && eu20.stderr === "expr: Invalid collation character\n", JSON.stringify([eu20.stdout, eu20.stderr]));
  const eu21 = await run(await shell({}), "expr 'é' : '[[.e.]]'; echo rc=$?");
  check("expr: a collating symbol of a base letter matches the accented letter's base, as GNU expr does", eu21.stdout === "0\nrc=1\n" && eu21.stderr === "", JSON.stringify([eu21.stdout, eu21.stderr]));
  const eu22 = await run(await shell({}), "expr 'é' : '[[=ab=]]'; echo rc=$?");
  check("expr: an equivalence class of two characters is refused with status 2", eu22.stdout === "rc=2\n" && eu22.stderr === "expr: Invalid collation character\n", JSON.stringify([eu22.stdout, eu22.stderr]));
  const eu23 = await run(await shell({}), "expr 'e' : '[[=é=]x]'; echo rc=$?");
  check("expr: an equivalence class with a class after it matches the class's letter", eu23.stdout === "1\nrc=0\n" && eu23.stderr === "", JSON.stringify([eu23.stdout, eu23.stderr]));
});

group('redirects: a compound command sends its output and takes its input through its redirects, as bash and dash do', async () => {
  const cp0 = await run(await shell({}), "mkdir -p /cr; for i in 1 2; do echo $i; done > /cr/f; cat /cr/f");
  check("redirects: a for loop sends its output to the file, as bash does", cp0.stdout === "1\n2\n" && cp0.stderr === "", JSON.stringify([cp0.stdout, cp0.stderr]));
  const cp1 = await run(await shell({}), "mkdir -p /cr; { echo a; echo b; } > /cr/g; cat /cr/g; echo rc=$?");
  check("redirects: a group sends its output to the file, as bash does", cp1.stdout === "a\nb\nrc=0\n" && cp1.stderr === "", JSON.stringify([cp1.stdout, cp1.stderr]));
  const cp2 = await run(await shell({}), "mkdir -p /cr; if true; then echo y; fi >> /cr/h; if true; then echo z; fi >> /cr/h; cat /cr/h");
  check("redirects: an if appends to the file, as bash does", cp2.stdout === "y\nz\n" && cp2.stderr === "", JSON.stringify([cp2.stdout, cp2.stderr]));
  const cp3 = await run(await shell({}), "mkdir -p /cr; echo p > /cr/in; echo q >> /cr/in; { cat; } < /cr/in > /cr/o; cat /cr/o");
  check("redirects: a group reads its input from a file and writes to another, as bash does", cp3.stdout === "p\nq\n" && cp3.stderr === "", JSON.stringify([cp3.stdout, cp3.stderr]));
  const cp4 = await run(await shell({}), "mkdir -p /cr; case x in x) echo hit;; esac > /cr/c; cat /cr/c");
  check("redirects: a case sends its output to the file, as bash does", cp4.stdout === "hit\n" && cp4.stderr === "", JSON.stringify([cp4.stdout, cp4.stderr]));
  const cp5 = await run(await shell({}), "mkdir -p /cr; { echo a; cat /nope-cr/x; } 2> /cr/err; cat /cr/err");
  check("redirects: a group 2> sends its stderr to the file, as bash does", cp5.stdout === "a\ncat: /nope-cr/x: No such file or directory\n" && cp5.stderr === "", JSON.stringify([cp5.stdout, cp5.stderr]));
  const cp6 = await run(await shell({}), "mkdir -p /cr; { echo x; cat /nope-cr/y; } &> /cr/both; cat /cr/both");
  check("redirects: a group &> sends both streams to the file, as bash does", cp6.stdout === "x\ncat: /nope-cr/y: No such file or directory\n" && cp6.stderr === "", JSON.stringify([cp6.stdout, cp6.stderr]));
  const cp7 = await run(await shell({}), "for i in 1; do echo x; done > /nodir-cr/f; echo rc=$?");
  check("redirects: a compound command into a missing directory is refused before it runs, as dash does", cp7.stdout === "rc=2\n" && cp7.stderr === "thebird: cannot create /nodir-cr/f: Directory nonexistent\n", JSON.stringify([cp7.stdout, cp7.stderr]));
  const cp8 = await run(await shell({}), "{ cat; } < /nofile-cr; echo rc=$?");
  check("redirects: a group from a missing input file is refused, as dash does", cp8.stdout === "rc=2\n" && cp8.stderr === "thebird: cannot open /nofile-cr: No such file\n", JSON.stringify([cp8.stdout, cp8.stderr]));
});

group('expansion: ${name?word} and ${name:?word} stop a command with the message bash gives, and a set name passes through', async () => {
  const xq0 = await run(await shell({}), "echo ${qx?no qx}; echo after");
  check("expansion: ${qx?word} stops a command when qx is unset, with the message bash gives", xq0.stdout === "" && xq0.stderr === "thebird: qx: no qx\n", JSON.stringify([xq0.stdout, xq0.stderr]));
  const xq1 = await run(await shell({}), "echo ${qx?}; echo after");
  check("expansion: ${qx?} with no word reports parameter not set, as bash does", xq1.stdout === "" && xq1.stderr === "thebird: qx: parameter not set\n", JSON.stringify([xq1.stdout, xq1.stderr]));
  const xq2 = await run(await shell({}), "x=; echo ${x:?}; echo after");
  check("expansion: ${x:?} reports a null name as parameter null or not set, as bash does", xq2.stdout === "" && xq2.stderr === "thebird: x: parameter null or not set\n", JSON.stringify([xq2.stdout, xq2.stderr]));
  const xq3 = await run(await shell({}), "x=; echo ${x?}; echo after");
  check("expansion: ${x?} passes a set but empty name through, as bash does", xq3.stdout === "\nafter\n" && xq3.stderr === "", JSON.stringify([xq3.stdout, xq3.stderr]));
  const xq4 = await run(await shell({}), "x=v; echo ${x:?no}; echo after");
  check("expansion: ${x:?word} returns a set name, as bash does", xq4.stdout === "v\nafter\n" && xq4.stderr === "", JSON.stringify([xq4.stdout, xq4.stderr]));
  const xq5 = await run(await shell({}), "echo start; echo ${qx?msg here}; echo after");
  check("expansion: output before a failing ${qx?word} is kept, and the rest of the list stops", xq5.stdout === "start\n" && xq5.stderr === "thebird: qx: msg here\n", JSON.stringify([xq5.stdout, xq5.stderr]));
  const xq6 = await run(await shell({}), "PS4='${qx?no qx} '; set -x; :; echo after");
  check("set -x: a failing ${qx?word} in PS4 is reported and the literal PS4 is traced, as bash does", xq6.stdout === "after\n" && xq6.stderr === "thebird: qx: no qx\n${qx?no qx} :\nthebird: qx: no qx\n${qx?no qx} echo after\n", JSON.stringify([xq6.stdout, xq6.stderr]));
});

group('set -x: PS4 prompt escapes for the user and host names expand to the shell identity, as bash expands its own', async () => {
  const ps0 = await run(await shell({}), "PS4='\\u> '; set -x; :");
  check("set -x: PS4 \\u expands to the name whoami prints, as bash expands its login name", ps0.stdout === "" && ps0.stderr === "user> :\n", JSON.stringify([ps0.stdout, ps0.stderr]));
  const ps1 = await run(await shell({}), "PS4='\\h> '; set -x; :");
  check("set -x: PS4 \\h expands to the short host name, as bash does", ps1.stdout === "" && ps1.stderr === "thebird> :\n", JSON.stringify([ps1.stdout, ps1.stderr]));
  const ps2 = await run(await shell({}), "PS4='\\H> '; set -x; :");
  check("set -x: PS4 \\H expands to the full host name, as bash does", ps2.stdout === "" && ps2.stderr === "thebird> :\n", JSON.stringify([ps2.stdout, ps2.stderr]));
  const ps3 = await run(await shell({}), "PS4='[\\u@\\h] '; set -x; echo hi");
  check("set -x: PS4 expands the user and host escapes between literal text, as bash does", ps3.stdout === "hi\n" && ps3.stderr === "[user@thebird] echo hi\n", JSON.stringify([ps3.stdout, ps3.stderr]));
  const ps4 = await run(await shell({}), "PS4='\\\\u> '; set -x; :");
  check("set -x: PS4 keeps an escaped backslash as a literal backslash, as bash does", ps4.stdout === "" && ps4.stderr === "\\u> :\n", JSON.stringify([ps4.stdout, ps4.stderr]));
  const ps5 = await run(await shell({}), "PS4='\\h+ '; set -x; for i in 1; do echo $i; done");
  check("set -x: PS4 escapes are expanded at each for loop trace, as bash does", ps5.stdout === "1\n" && ps5.stderr === "thebird+ for i in 1\nthebird+ echo 1\n", JSON.stringify([ps5.stdout, ps5.stderr]));
  const ps6 = await run(await shell({}), "PS4='\\u ${qx?no} '; set -x; :; echo after");
  check("set -x: PS4 escapes are expanded before a failing expansion in PS4 is traced as its literal, as bash does", ps6.stdout === "after\n" && ps6.stderr === "thebird: qx: no\nuser ${qx?no} :\nthebird: qx: no\nuser ${qx?no} echo after\n", JSON.stringify([ps6.stdout, ps6.stderr]));
});

group('unset: a variable, a function and a local are removed in the scope that holds them, as bash does', async () => {
  const un0 = await run(await shell({}), "x=1; unset x; echo \"[${x-unset}]\"");
  check("unset: a variable is removed, so its default applies, as bash does", un0.stdout === "[unset]\n" && un0.stderr === "", JSON.stringify([un0.stdout, un0.stderr]));
  const un1 = await run(await shell({}), "unset nosuch; echo rc=$?");
  check("unset: an unset name that was never set exits 0, as bash does", un1.stdout === "rc=0\n" && un1.stderr === "", JSON.stringify([un1.stdout, un1.stderr]));
  const un2 = await run(await shell({}), "a=1; b=2; unset a b; echo \"[${a-A}][${b-B}]\"");
  check("unset: several names are removed in one call, as bash does", un2.stdout === "[A][B]\n" && un2.stderr === "", JSON.stringify([un2.stdout, un2.stderr]));
  const un3 = await run(await shell({}), "c=1; unset -v c; echo \"[${c-C}]\"");
  check("unset -v: removes a variable, as bash does", un3.stdout === "[C]\n" && un3.stderr === "", JSON.stringify([un3.stdout, un3.stderr]));
  const un4 = await run(await shell({}), "f(){ echo f; }; unset -f f; f 2>/dev/null; echo rc=$?");
  check("unset -f: removes a function, so calling it is not found, as bash does", un4.stdout === "rc=127\n" && un4.stderr === "", JSON.stringify([un4.stdout, un4.stderr]));
  const un5 = await run(await shell({}), "k=k; m(){ unset k; }; m; echo \"[${k-gone}]\"");
  check("unset: a variable unset inside a called function is removed for the caller too, as bash does", un5.stdout === "[gone]\n" && un5.stderr === "", JSON.stringify([un5.stdout, un5.stderr]));
  const un6 = await run(await shell({}), "z=g; p(){ local z=l; q; echo \"[${z-empty}]\"; }; q(){ unset z; }; p; echo \"[$z]\"");
  check("unset: a local unset by a called function reveals the global of the same name, as bash does", un6.stdout === "[g]\n[g]\n" && un6.stderr === "", JSON.stringify([un6.stdout, un6.stderr]));
  const un7 = await run(await shell({}), "g=g; h(){ local g=l; unset g; echo \"[${g-empty}]\"; }; h; echo \"[$g]\"");
  check("unset: a local unset in its own function hides the global until the function returns, as bash does", un7.stdout === "[empty]\n[g]\n" && un7.stderr === "", JSON.stringify([un7.stdout, un7.stderr]));
  const un8 = await run(await shell({}), "w(){ local v=1; unset v; v=2; echo \"[$v]\"; }; w; echo \"[${v-none}]\"");
  check("unset: a local unset and set again holds the new value, and is gone after the function, as bash does", un8.stdout === "[2]\n[none]\n" && un8.stderr === "", JSON.stringify([un8.stdout, un8.stderr]));
  const un9 = await run(await shell({}), "unset 1x; echo rc=$?");
  check("unset: a name that is not a valid identifier is ignored with status 0, as bash does", un9.stdout === "rc=0\n" && un9.stderr === "", JSON.stringify([un9.stdout, un9.stderr]));
  const un10 = await run(await shell({}), "unset; echo rc=$?");
  check("unset: with no names it does nothing and exits 0, as bash does", un10.stdout === "rc=0\n" && un10.stderr === "", JSON.stringify([un10.stdout, un10.stderr]));
});

group('compound: a compound command keeps the output it printed before exit, return, break or an error ends it, as bash does', async () => {
  const cx0 = await run(await shell({}), "mkdir -p /ex; (for i in 1 2; do echo $i; exit 4; done) > /ex/f1; echo rc=$?; cat /ex/f1");
  check("compound: a subshell that exits keeps the output of its loop in the redirect file, as bash does", cx0.stdout === "rc=4\n1\n" && cx0.stderr === "", JSON.stringify([cx0.stdout, cx0.stderr]));
  const cx1 = await run(await shell({}), "f(){ echo a; return 1; }; f; echo rc=$?");
  check("compound: a function that returns keeps the output it printed before return, as bash does", cx1.stdout === "a\nrc=1\n" && cx1.stderr === "", JSON.stringify([cx1.stdout, cx1.stderr]));
  const cx2 = await run(await shell({}), "mkdir -p /ex; f(){ { echo b; return 5; } > /ex/f3; echo no; }; f; echo rc=$?; cat /ex/f3");
  check("compound: a group that returns keeps its output in the redirect file, as bash does", cx2.stdout === "rc=5\nb\n" && cx2.stderr === "", JSON.stringify([cx2.stdout, cx2.stderr]));
  const cx3 = await run(await shell({}), "mkdir -p /ex; f(){ if true; then echo c; return 6; fi > /ex/f4; }; f; echo rc=$?; cat /ex/f4");
  check("compound: an if that returns keeps its output in the redirect file, as bash does", cx3.stdout === "rc=6\nc\n" && cx3.stderr === "", JSON.stringify([cx3.stdout, cx3.stderr]));
  const cx4 = await run(await shell({}), "for i in 1; do if true; then echo x; break; fi; done; echo end");
  check("compound: break inside an if keeps the output printed before it, as bash does", cx4.stdout === "x\nend\n" && cx4.stderr === "", JSON.stringify([cx4.stdout, cx4.stderr]));
  const cx5 = await run(await shell({}), "for i in 1; do for j in a b; do echo $j; break 2; done; done; echo end");
  check("compound: break 2 from an inner loop keeps the output of the inner loop, as bash does", cx5.stdout === "a\nend\n" && cx5.stderr === "", JSON.stringify([cx5.stdout, cx5.stderr]));
  const cx6 = await run(await shell({}), "mkdir -p /ex; (while true; do echo loop; exit 7; done) > /ex/o; echo rc=$?; cat /ex/o");
  check("compound: an exit inside a loop with a redirect keeps the output in the file, as bash does", cx6.stdout === "rc=7\nloop\n" && cx6.stderr === "", JSON.stringify([cx6.stdout, cx6.stderr]));
  const cx7 = await run(await shell({}), "mkdir -p /ex; (echo p; exit 9) > /ex/p; echo rc=$?; cat /ex/p");
  check("compound: a subshell that exits keeps its output on stdout when it has no redirect, as bash does", cx7.stdout === "rc=9\np\n" && cx7.stderr === "", JSON.stringify([cx7.stdout, cx7.stderr]));
  const cx8 = await run(await shell({}), "mkdir -p /ex; (echo x; { echo y; exit 8; } > /ex/y) > /ex/z; echo rc=$?; cat /ex/z; cat /ex/y");
  check("compound: an inner redirect and an outer redirect each keep their own output, as bash does", cx8.stdout === "rc=8\nx\ny\n" && cx8.stderr === "", JSON.stringify([cx8.stdout, cx8.stderr]));
  const cx9 = await run(await shell({}), "for i in 1 2; do echo $i; if true; then break; fi; done; echo end");
  check("compound: a loop that breaks at its first pass keeps the output of each pass, as bash does", cx9.stdout === "1\nend\n" && cx9.stderr === "", JSON.stringify([cx9.stdout, cx9.stderr]));
});

group('read: the builtin reads a line into names, splits it on IFS, and keeps backslashes only with -r, as bash does', async () => {
  const rd0 = await run(await shell({}), "printf '  x  \\n' | { read; echo \"[$REPLY]\"; }");
  check("read: a line with leading and trailing spaces keeps its whole text in REPLY, as bash does", rd0.stdout === "[  x  ]\n" && rd0.stderr === "", JSON.stringify([rd0.stdout, rd0.stderr]));
  const rd1 = await run(await shell({}), "IFS= read a b <<< 'x y'; echo \"[$a][$b]\"");
  check("read: IFS empty keeps the whole line in the first name, as bash does", rd1.stdout === "[x y][]\n" && rd1.stderr === "", JSON.stringify([rd1.stdout, rd1.stderr]));
  const rd2 = await run(await shell({}), "read -z x <<< 'a'; echo rc=$?");
  check("read: an unknown option is refused with bash usage text and status 2", rd2.stdout === "rc=2\n" && rd2.stderr === "read: -z: invalid option\nread: usage: read [-Eers] [-a array] [-d delim] [-i text] [-n nchars] [-N nchars] [-p prompt] [-t timeout] [-u fd] [name ...]\n", JSON.stringify([rd2.stdout, rd2.stderr]));
  const rd3 = await run(await shell({}), "read -q x <<< 'a'; echo rc=$?; echo \"[$x]\"");
  check("read: an unknown option leaves the name unset and exits 2, as bash does", rd3.stdout === "rc=2\n[]\n" && rd3.stderr === "read: -q: invalid option\nread: usage: read [-Eers] [-a array] [-d delim] [-i text] [-n nchars] [-N nchars] [-p prompt] [-t timeout] [-u fd] [name ...]\n", JSON.stringify([rd3.stdout, rd3.stderr]));
  const rd4 = await run(await shell({}), "read; echo rc=$?");
  check("read: with no input and no name it exits 1, as bash does", rd4.stdout === "rc=1\n" && rd4.stderr === "", JSON.stringify([rd4.stdout, rd4.stderr]));
  const rd5 = await run(await shell({}), "printf 'a\\nb\\nc\\n' | { read x; cat; }");
  check("read: the next command in the same group reads what read left, as bash does", rd5.stdout === "b\nc\n" && rd5.stderr === "", JSON.stringify([rd5.stdout, rd5.stderr]));
  const rd6 = await run(await shell({}), "printf 'a\\nb\\n' | { read x; read y; echo \"$x $y\"; }");
  check("read: two reads in a group take two lines, as bash does", rd6.stdout === "a b\n" && rd6.stderr === "", JSON.stringify([rd6.stdout, rd6.stderr]));
  const rd7 = await run(await shell({}), "printf 'a\\n' | read x; echo \"[$x]\"");
  check("read: a read on the right of a pipe does not set the variable in the shell, as bash does", rd7.stdout === "[]\n" && rd7.stderr === "", JSON.stringify([rd7.stdout, rd7.stderr]));
  const rd8 = await run(await shell({}), "read -- x <<< 'dd'; echo \"[$x]\"");
  check("read: -- ends the options, so a name that begins with a dash is read, as bash does", rd8.stdout === "[dd]\n" && rd8.stderr === "", JSON.stringify([rd8.stdout, rd8.stderr]));
  const rd9 = await run(await shell({}), "printf 'a b\\n' | { read -r; echo \"[$REPLY]\"; }");
  check("read -r: a line with no names goes whole into REPLY, as bash does", rd9.stdout === "[a b]\n" && rd9.stderr === "", JSON.stringify([rd9.stdout, rd9.stderr]));
  const rd10 = await run(await shell({}), "IFS=: read a b <<< 'p:'; echo \"[$a][$b]\"");
  check("read: a colon IFS with no value after the colon leaves the last name empty, as bash does", rd10.stdout === "[p][]\n" && rd10.stderr === "", JSON.stringify([rd10.stdout, rd10.stderr]));
  const rd11 = await run(await shell({}), "printf 'a b  c d\\n' | { read x y; echo \"[$x][$y]\"; }");
  check("read: the last name takes the rest of the line with inner spaces, as bash does", rd11.stdout === "[a][b  c d]\n" && rd11.stderr === "", JSON.stringify([rd11.stdout, rd11.stderr]));
  const rd12 = await run(await shell({}), "printf '  a   b c  \\n' | { read x y; echo \"[$x][$y]\"; }");
  check("read: leading and trailing spaces are trimmed from the fields, as bash does", rd12.stdout === "[a][b c]\n" && rd12.stderr === "", JSON.stringify([rd12.stdout, rd12.stderr]));
  const rd13 = await run(await shell({}), "printf 'z' | { read y; echo \"rc=$? [$y]\"; }");
  check("read: a last line with no newline is assigned and exits 1, as bash does", rd13.stdout === "rc=1 [z]\n" && rd13.stderr === "", JSON.stringify([rd13.stdout, rd13.stderr]));
  const rd14 = await run(await shell({}), "printf 'a\\\\ b\\n' | { read x; echo \"[$x]\"; }");
  check("read: a backslash escapes the next character and is removed, as bash does", rd14.stdout === "[a b]\n" && rd14.stderr === "", JSON.stringify([rd14.stdout, rd14.stderr]));
  const rd15 = await run(await shell({}), "printf 'a\\\\ b\\n' | { read -r x; echo \"[$x]\"; }");
  check("read -r: a backslash is kept, as bash does", rd15.stdout === "[a\\ b]\n" && rd15.stderr === "", JSON.stringify([rd15.stdout, rd15.stderr]));
  const rd16 = await run(await shell({}), "printf 'a\\\\\\nb\\n' | { read x; echo \"[$x]\"; }");
  check("read: a backslash at the end of a line joins it to the next line, as bash does", rd16.stdout === "[ab]\n" && rd16.stderr === "", JSON.stringify([rd16.stdout, rd16.stderr]));
  const rd17 = await run(await shell({}), "printf 'p:q:r:s\\n' | { IFS=: read a b c; echo \"[$a][$b][$c]\"; }");
  check("read: IFS colon splits the fields and the last name takes the rest, as bash does", rd17.stdout === "[p][q][r:s]\n" && rd17.stderr === "", JSON.stringify([rd17.stdout, rd17.stderr]));
  const rd18 = await run(await shell({}), "printf 'p::r\\n' | { IFS=: read a b c; echo \"[$a][$b][$c]\"; }");
  check("read: an empty field between two colons is kept, as bash does", rd18.stdout === "[p][][r]\n" && rd18.stderr === "", JSON.stringify([rd18.stdout, rd18.stderr]));
  const rd19 = await run(await shell({}), "printf 'one\\n' | { read a b c; echo \"[$a][$b][$c]\"; }");
  check("read: more names than fields leave the rest empty, as bash does", rd19.stdout === "[one][][]\n" && rd19.stderr === "", JSON.stringify([rd19.stdout, rd19.stderr]));
  const rd20 = await run(await shell({}), "printf '1\\n2\\n' | { while read n; do echo \"got $n\"; done; echo end; }");
  check("read: a while loop reads one line per pass until the input ends, as bash does", rd20.stdout === "got 1\ngot 2\nend\n" && rd20.stderr === "", JSON.stringify([rd20.stdout, rd20.stderr]));
  const rd21 = await run(await shell({}), "read q <<< 'hs val'; echo \"[$q]\"");
  check("read: a here-string feeds read, as bash does", rd21.stdout === "[hs val]\n" && rd21.stderr === "", JSON.stringify([rd21.stdout, rd21.stderr]));
  const rd22 = await run(await shell({}), "printf 'x\\n' | { read 1bad; echo rc=$?; }");
  check("read: an invalid name is refused with status 1, as bash does", rd22.stdout === "rc=1\n" && rd22.stderr === "read: `1bad': not a valid identifier\n", JSON.stringify([rd22.stdout, rd22.stderr]));
  const rd23 = await run(await shell({}), "mkdir -p /ex; printf 'k\\n' > /ex/in; { read v; echo \"[$v]\"; } < /ex/in");
  check("read: a group with a file on its input reads from the file, as bash does", rd23.stdout === "[k]\n" && rd23.stderr === "", JSON.stringify([rd23.stdout, rd23.stderr]));
  const rd24 = await run(await shell({}), "mkdir -p /ex; printf 'l1\\nl2\\n' > /ex/in; while read n; do echo \"w $n\"; done < /ex/in; echo end");
  check("read: a while loop with a file on its input reads each line of the file, as bash does", rd24.stdout === "w l1\nw l2\nend\n" && rd24.stderr === "", JSON.stringify([rd24.stdout, rd24.stderr]));
  const rd25 = await run(await shell({}), "mkdir -p /ex; printf 'q1\\nq2\\n' > /ex/in; read a < /ex/in; read b < /ex/in; echo \"[$a][$b]\"");
  check("read: each read with its own file input starts that file again, as bash does", rd25.stdout === "[q1][q1]\n" && rd25.stderr === "", JSON.stringify([rd25.stdout, rd25.stderr]));
  const rd26 = await run(await shell({}), "f(){ read v; echo \"f got [$v]\"; }; printf 'g1\\ng2\\n' | { f; read w; echo \"[$w]\"; }");
  check("read: a function reads from the stream of the group that calls it, as bash does", rd26.stdout === "f got [g1]\n[g2]\n" && rd26.stderr === "", JSON.stringify([rd26.stdout, rd26.stderr]));
});

group("LINENO: a multi-line substitution numbers each command by the first word of that command, as bash does", async () => {
  const ln0 = await run(await shell({}), "echo $(\necho $LINENO\n)");
  check("a bare substitution that starts on a line with a newline after $( numbers its command by the line of that command", ln0.stdout === "1\n" && ln0.stderr === "", JSON.stringify([ln0.stdout, ln0.stderr]));
  const ln1 = await run(await shell({}), "echo $(\necho $LINENO\necho $LINENO\n)");
  check("two commands in a substitution number from the line of the first word of each command", ln1.stdout === "1 2\n" && ln1.stderr === "", JSON.stringify([ln1.stdout, ln1.stderr]));
  const ln2 = await run(await shell({}), "echo x\necho $(\necho $LINENO\n)\necho $LINENO");
  check("a substitution on line 2 after a line of text numbers its command from line 2 and the next command from line 5", ln2.stdout === "x\n2\n5\n" && ln2.stderr === "", JSON.stringify([ln2.stdout, ln2.stderr]));
  const ln3 = await run(await shell({}), "x=$(\necho $LINENO\n)\necho $x");
  check("an assignment with a substitution numbers the command inside by its own line", ln3.stdout === "3\n" && ln3.stderr === "", JSON.stringify([ln3.stdout, ln3.stderr]));
  const ln4 = await run(await shell({}), "echo $(echo a\n\necho $LINENO\n)");
  check("a blank line inside a substitution does not move the line of the next command", ln4.stdout === "a 2\n" && ln4.stderr === "", JSON.stringify([ln4.stdout, ln4.stderr]));
  const ln5 = await run(await shell({}), "echo $(echo a; echo $LINENO\necho b\necho $LINENO\n)");
  check("a semicolon on the same line does not move the line of a command in a substitution", ln5.stdout === "a 1 b 3\n" && ln5.stderr === "", JSON.stringify([ln5.stdout, ln5.stderr]));
  const ln6 = await run(await shell({}), "echo \"$(echo a\necho $LINENO\n)\"");
  check("a quoted substitution numbers its command as an unquoted one does", ln6.stdout === "a\n2\n" && ln6.stderr === "", JSON.stringify([ln6.stdout, ln6.stderr]));
  const ln7 = await run(await shell({}), "echo $(echo one\necho $LINENO\n) $LINENO");
  check("a $LINENO argument after a multi-line substitution is the line of the outer command", ln7.stdout === "one 2 1\n" && ln7.stderr === "", JSON.stringify([ln7.stdout, ln7.stderr]));
  const ln8 = await run(await shell({}), "echo $(echo a\necho $LINENO\n)$LINENO");
  check("a $LINENO joined to a multi-line substitution is the line of the outer command", ln8.stdout === "a 21\n" && ln8.stderr === "", JSON.stringify([ln8.stdout, ln8.stderr]));
  const ln9 = await run(await shell({}), "x=1 y=$(\necho $LINENO\n)\necho $y");
  check("an assignment after a line break in a substitution is numbered from the assignment line", ln9.stdout === "1\n" && ln9.stderr === "", JSON.stringify([ln9.stdout, ln9.stderr]));
  const ln10 = await run(await shell({}), "y=$(\necho $LINENO\n) x=1\necho $y");
  check("an assignment before a substitution with a line break numbers the inner command by its own line", ln10.stdout === "3\n" && ln10.stderr === "", JSON.stringify([ln10.stdout, ln10.stderr]));
  const ln11 = await run(await shell({}), "echo $(echo a\necho b\n)\necho $LINENO");
  check("a substitution after a closed one numbers the outer command after it by its line", ln11.stdout === "a b\n4\n" && ln11.stderr === "", JSON.stringify([ln11.stdout, ln11.stderr]));
  const ln12 = await run(await shell({}), "x=$(echo $LINENO\necho $LINENO\n)\necho $x");
  check("an assignment whose substitution starts with a command numbers that command by the assignment line", ln12.stdout === "3 4\n" && ln12.stderr === "", JSON.stringify([ln12.stdout, ln12.stderr]));
  const ln13 = await run(await shell({}), "echo first $(\necho x\n) last $LINENO");
  check("a $LINENO after a multi-line substitution on the same command is the outer line", ln13.stdout === "first x last 1\n" && ln13.stderr === "", JSON.stringify([ln13.stdout, ln13.stderr]));
  const ln14 = await run(await shell({}), "for i in $(\necho a\necho b\n); do echo $i $LINENO; done");
  check("a for word list with a multi-line substitution numbers the loop body by its own line", ln14.stdout === "a 4\nb 4\n" && ln14.stderr === "", JSON.stringify([ln14.stdout, ln14.stderr]));
  const ln15 = await run(await shell({}), "PS4='L$LINENO '\nset -x\necho $(\necho $LINENO\n)\nset +x");
  check("a trace of a command in a substitution after PS4 with LINENO shows the line of that command", ln15.stdout === "3\n" && ln15.stderr === "LL3 echo 3\nL3 echo 3\nL6 set +x\n", JSON.stringify([ln15.stdout, ln15.stderr]));
  const ln16 = await run(await shell({}), "PS4='L$LINENO '\nset -x\nx=$(\necho $LINENO\n)\nset +x");
  check("a trace of an assignment with a substitution shows the line of the assignment", ln16.stdout === "" && ln16.stderr === "LL5 echo 5\nL5 x=5\nL6 set +x\n", JSON.stringify([ln16.stdout, ln16.stderr]));
  const ln17 = await run(await shell({}), "PS4='L$LINENO '\nset -x\necho $(echo a\necho $LINENO\n)\nset +x");
  check("a trace of a command with a multi-line substitution argument shows the line of that command", ln17.stdout === "a 4\n" && ln17.stderr === "LL3 echo a\nLL4 echo 4\nL3 echo a 4\nL6 set +x\n", JSON.stringify([ln17.stdout, ln17.stderr]));
});

group('set -x: PS4 is expanded at each trace, and LINENO is the command line, as bash does', async () => {
  const ps0 = await run(await shell({}), "x=5; PS4='$x: '; set -x; echo a; set +x");
  check("PS4 with a parameter is expanded at each trace, as bash does", ps0.stdout === "a\n" && ps0.stderr === "5: echo a\n5: set +x\n", JSON.stringify([ps0.stdout, ps0.stderr]));
  const ps1 = await run(await shell({}), "PS4='$((1+2))> '; set -x; echo b; set +x");
  check("PS4 with arithmetic is expanded at each trace, as bash does", ps1.stdout === "b\n" && ps1.stderr === "3> echo b\n3> set +x\n", JSON.stringify([ps1.stdout, ps1.stderr]));
  const ps2 = await run(await shell({}), "PS4='$(echo P)> '; set -x; echo c; set +x");
  check("PS4 with a command substitution is expanded and not traced itself, as bash does", ps2.stdout === "c\n" && ps2.stderr === "P> echo c\nP> set +x\n", JSON.stringify([ps2.stdout, ps2.stderr]));
  const ps3 = await run(await shell({}), "PS4='${y:-dflt}> '; set -x; echo d; set +x");
  check("PS4 with a default is expanded, as bash does", ps3.stdout === "d\n" && ps3.stderr === "dflt> echo d\ndflt> set +x\n", JSON.stringify([ps3.stdout, ps3.stderr]));
  const ps4 = await run(await shell({}), "PS4='$unset_thing'; set -x; echo k; set +x");
  check("PS4 that expands to nothing adds no prefix, as bash does", ps4.stdout === "k\n" && ps4.stderr === "echo k\nset +x\n", JSON.stringify([ps4.stdout, ps4.stderr]));
  const ps5 = await run(await shell({}), "PS4='a$'; set -x; echo l; set +x");
  check("PS4 with a lone trailing dollar keeps the dollar, as bash does", ps5.stdout === "l\n" && ps5.stderr === "a$echo l\na$set +x\n", JSON.stringify([ps5.stdout, ps5.stderr]));
  const ps6 = await run(await shell({}), "PS4='$(echo \"two words\")'; set -x; echo m; set +x");
  check("PS4 with a substitution that has spaces keeps the spaces, as bash does", ps6.stdout === "m\n" && ps6.stderr === "two wordsecho m\ntwo wordsset +x\n", JSON.stringify([ps6.stdout, ps6.stderr]));
  const ps7 = await run(await shell({}), "PS4='[$((2*3))] '; set -x; echo n; set +x");
  check("PS4 with arithmetic in brackets, as bash does", ps7.stdout === "n\n" && ps7.stderr === "[6] echo n\n[6] set +x\n", JSON.stringify([ps7.stdout, ps7.stderr]));
  const ps8 = await run(await shell({}), "PS4='\\$'; set -x; echo o; set +x");
  check("PS4 with an escaped dollar prints a dollar, as bash does", ps8.stdout === "o\n" && ps8.stderr === "$echo o\n$set +x\n", JSON.stringify([ps8.stdout, ps8.stderr]));
  const ps9 = await run(await shell({}), "v='>>'; PS4='$v'; set -x; echo i; set +x");
  check("PS4 whose first character is repeated for the depth, as bash does", ps9.stdout === "i\n" && ps9.stderr === ">>echo i\n>>set +x\n", JSON.stringify([ps9.stdout, ps9.stderr]));
  const ps10 = await run(await shell({}), "PS4='a '; set -x; echo 1; PS4='b '; echo 2; set +x");
  check("PS4 can change between traces, as bash does", ps10.stdout === "1\n2\n" && ps10.stderr === "a echo 1\na PS4='b '\nb echo 2\nb set +x\n", JSON.stringify([ps10.stdout, ps10.stderr]));
  const ps11 = await run(await shell({}), "PS4='[$LINENO] '; set -x\necho a\nfor i in 1 2; do\n  echo $i\ndone\nset +x\necho $LINENO");
  check("$LINENO on a command is the line of that command, and set -x traces it, as bash does", ps11.stdout === "a\n1\n2\n7\n" && ps11.stderr === "[2] echo a\n[3] for i in 1 2\n[4] echo 1\n[3] for i in 1 2\n[4] echo 2\n[6] set +x\n", JSON.stringify([ps11.stdout, ps11.stderr]));
  const ps12 = await run(await shell({}), "PS4='[$LINENO] '; set -x\nfor i in 1; do :; done\nset +x");
  check("$LINENO in a for header is the line of the for, as bash does", ps12.stdout === "" && ps12.stderr === "[2] for i in 1\n[2] :\n[3] set +x\n", JSON.stringify([ps12.stdout, ps12.stderr]));
  const ps13 = await run(await shell({}), "PS4='[$LINENO] '\necho $(\nset -x\necho q\nset +x\n)");
  check("PS4 LINENO in a multi-line substitution numbers its trace lines from the first word, as bash does", ps13.stdout === "q\n" && ps13.stderr === "[[3] echo q\n[[4] set +x\n", JSON.stringify([ps13.stdout, ps13.stderr]));
  const ps14 = await run(await shell({}), "PS4='$(echo P)> '; echo $(set -x; echo q; set +x)");
  check("a command substitution inside PS4 adds to the depth, as bash does", ps14.stdout === "q\n" && ps14.stderr === "PP> echo q\nPP> set +x\n", JSON.stringify([ps14.stdout, ps14.stderr]));
  const ps15 = await run(await shell({}), "PS4='[$LINENO] '; echo a $(echo b)\nset -x; echo c; set +x");
  check("the trace of a command substitution keeps its line, as bash does", ps15.stdout === "a b\nc\n" && ps15.stderr === "[2] echo c\n[2] set +x\n", JSON.stringify([ps15.stdout, ps15.stderr]));
});

group('set -x: a for loop traces its header before each pass, as bash does', async () => {
  const fh0 = await run(await shell({}), "set -x; for i in a b c; do :; done; set +x");
  check("set -x: a for loop traces its header before each pass, with the words as written", fh0.stdout === "" && fh0.stderr === "+ for i in a b c\n+ :\n+ for i in a b c\n+ :\n+ for i in a b c\n+ :\n+ set +x\n", JSON.stringify([fh0.stdout, fh0.stderr]));
  const fh1 = await run(await shell({}), "set -x; for i in 'a b' \"\"; do echo $i; done; set +x");
  check("set -x: a for header keeps the quotes of its words as written", fh1.stdout === "a b\n\n" && fh1.stderr === "+ for i in 'a b' \"\"\n+ echo a b\n+ for i in 'a b' \"\"\n+ echo\n+ set +x\n", JSON.stringify([fh1.stdout, fh1.stderr]));
  const fh2 = await run(await shell({}), "x=1; set -x; for i in $x \"$x\" ${x}z; do :; done; set +x");
  check("set -x: a for header keeps variables unexpanded, as written", fh2.stdout === "" && fh2.stderr === "+ for i in $x \"$x\" ${x}z\n+ :\n+ for i in $x \"$x\" ${x}z\n+ :\n+ for i in $x \"$x\" ${x}z\n+ :\n+ set +x\n", JSON.stringify([fh2.stdout, fh2.stderr]));
  const fh3 = await run(await shell({}), "set -- a b; set -x; for i; do :; done; set +x");
  check("set -x: a for with no in list has the header for i in \"$@\"", fh3.stdout === "" && fh3.stderr === "+ for i in \"$@\"\n+ :\n+ for i in \"$@\"\n+ :\n+ set +x\n", JSON.stringify([fh3.stdout, fh3.stderr]));
  const fh4 = await run(await shell({}), "set -x; for i in 1 2; do echo $i; break; done; set +x");
  check("set -x: a for header is printed once for each pass, and a break ends it after one", fh4.stdout === "1\n" && fh4.stderr === "+ for i in 1 2\n+ echo 1\n+ break\n+ set +x\n", JSON.stringify([fh4.stdout, fh4.stderr]));
  const fh5 = await run(await shell({}), "set -x; for i in; do echo $i; done; set +x");
  check("set -x: a for with an empty list runs no pass and prints no header", fh5.stdout === "" && fh5.stderr === "+ set +x\n", JSON.stringify([fh5.stdout, fh5.stderr]));
  const fh6 = await run(await shell({}), "set -x; for i in 1 2; do for j in x; do echo $i$j; done; done; set +x");
  check("set -x: nested for loops print each header before its own passes", fh6.stdout === "1x\n2x\n" && fh6.stderr === "+ for i in 1 2\n+ for j in x\n+ echo 1x\n+ for i in 1 2\n+ for j in x\n+ echo 2x\n+ set +x\n", JSON.stringify([fh6.stdout, fh6.stderr]));
});

group('set -x: a command substitution adds a + to the trace prefix, as bash does', async () => {
  const sd0 = await run(await shell({}), "set -x; x=$(echo a); set +x");
  check("set -x: a command substitution is traced one level deeper, with ++ before its commands", sd0.stdout === "" && sd0.stderr === "++ echo a\n+ x=a\n+ set +x\n", JSON.stringify([sd0.stdout, sd0.stderr]));
  const sd1 = await run(await shell({}), "set -x; echo $(echo $(echo a)); set +x");
  check("set -x: nested command substitutions are traced at +++ and ++", sd1.stdout === "a\n" && sd1.stderr === "+++ echo a\n++ echo a\n+ echo a\n+ set +x\n", JSON.stringify([sd1.stdout, sd1.stderr]));
  const sd2 = await run(await shell({}), "PS4='>> '; set -x; echo $(echo a); set +x");
  check("set -x: PS4 repeats its first character for each substitution level", sd2.stdout === "a\n" && sd2.stderr === ">>> echo a\n>> echo a\n>> set +x\n", JSON.stringify([sd2.stdout, sd2.stderr]));
  const sd3 = await run(await shell({}), "set -x; echo \"$(echo a)\" \"$(echo b)\"; set +x");
  check("set -x: two command substitutions in one command are each traced at ++", sd3.stdout === "a b\n" && sd3.stderr === "++ echo a\n++ echo b\n+ echo a b\n+ set +x\n", JSON.stringify([sd3.stdout, sd3.stderr]));
  const sd4 = await run(await shell({}), "f() { echo in; }; set -x; echo $(f); set +x");
  check("set -x: a function called in a substitution is traced at ++, with its body at ++", sd4.stdout === "in\n" && sd4.stderr === "++ f\n++ echo in\n+ echo in\n+ set +x\n", JSON.stringify([sd4.stdout, sd4.stderr]));
  const sd5 = await run(await shell({}), "set -x; if [ \"$(echo a)\" = a ]; then echo y; fi; set +x");
  check("set -x: a substitution in an if condition is traced at ++, and the if test at +", sd5.stdout === "y\n" && sd5.stderr === "++ echo a\n+ '[' a = a ']'\n+ echo y\n+ set +x\n", JSON.stringify([sd5.stdout, sd5.stderr]));
  const sd6 = await run(await shell({}), "set -x; for i in $(echo a b); do echo $i; done; set +x");
  check("set -x: a substitution in a for list is traced before the for header", sd6.stdout === "a\nb\n" && sd6.stderr === "++ echo a b\n+ for i in $(echo a b)\n+ echo a\n+ for i in $(echo a b)\n+ echo b\n+ set +x\n", JSON.stringify([sd6.stdout, sd6.stderr]));
  const sd7 = await run(await shell({}), "set -x; ( echo sub ); set +x");
  check("set -x: a subshell is not a substitution, so its commands are traced at +", sd7.stdout === "sub\n" && sd7.stderr === "+ echo sub\n+ set +x\n", JSON.stringify([sd7.stdout, sd7.stderr]));
});

group('chmod -v and -c: a changed or retained mode is reported as GNU chmod reports it', async () => {
  const cv0 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && echo s > /cm/t/tree/sub/b && ln -s a /cm/t/tree/lnk && echo f > /cm/t/f1 && echo g > /cm/t/f2 && chmod 600 /cm/t/f1 /cm/t/tree/a && chmod 644 /cm/t/f2 && chmod 755 /cm/t/tree /cm/t/tree/sub; chmod -v 644 /cm/t/f1 /cm/t/f2; echo rc=$?");
  check("chmod -v reports a changed mode and a retained one, as GNU chmod does", cv0.stdout === "mode of '/cm/t/f1' changed from 0600 (rw-------) to 0644 (rw-r--r--)\nmode of '/cm/t/f2' retained as 0644 (rw-r--r--)\nrc=0\n" && cv0.stderr === "", JSON.stringify([cv0.stdout, cv0.stderr]));
  const cv1 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && echo s > /cm/t/tree/sub/b && ln -s a /cm/t/tree/lnk && echo f > /cm/t/f1 && echo g > /cm/t/f2 && chmod 600 /cm/t/f1 /cm/t/tree/a && chmod 644 /cm/t/f2 && chmod 755 /cm/t/tree /cm/t/tree/sub; chmod -c 644 /cm/t/f1 /cm/t/f2; echo rc=$?");
  check("chmod -c reports only a mode that changed, as GNU chmod does", cv1.stdout === "mode of '/cm/t/f1' changed from 0600 (rw-------) to 0644 (rw-r--r--)\nrc=0\n" && cv1.stderr === "", JSON.stringify([cv1.stdout, cv1.stderr]));
  const cv2 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && echo s > /cm/t/tree/sub/b && ln -s a /cm/t/tree/lnk && echo f > /cm/t/f1 && echo g > /cm/t/f2 && chmod 600 /cm/t/f1 /cm/t/tree/a && chmod 644 /cm/t/f2 && chmod 755 /cm/t/tree /cm/t/tree/sub; chmod -c 644 /cm/t/f2; echo rc=$?");
  check("chmod -c with no mode change prints nothing", cv2.stdout === "rc=0\n" && cv2.stderr === "", JSON.stringify([cv2.stdout, cv2.stderr]));
  const cv3 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && echo s > /cm/t/tree/sub/b && ln -s a /cm/t/tree/lnk && echo f > /cm/t/f1 && echo g > /cm/t/f2 && chmod 600 /cm/t/f1 /cm/t/tree/a && chmod 644 /cm/t/f2 && chmod 755 /cm/t/tree /cm/t/tree/sub; chmod --verbose 600 /cm/t/f1; chmod --changes 755 /cm/t/f1; echo rc=$?");
  check("chmod --verbose and --changes take the long names, as GNU chmod does", cv3.stdout === "mode of '/cm/t/f1' retained as 0600 (rw-------)\nmode of '/cm/t/f1' changed from 0600 (rw-------) to 0755 (rwxr-xr-x)\nrc=0\n" && cv3.stderr === "", JSON.stringify([cv3.stdout, cv3.stderr]));
  const cv4 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && echo s > /cm/t/tree/sub/b && ln -s a /cm/t/tree/lnk && echo f > /cm/t/f1 && echo g > /cm/t/f2 && chmod 600 /cm/t/f1 /cm/t/tree/a && chmod 644 /cm/t/f2 && chmod 755 /cm/t/tree /cm/t/tree/sub; chmod -v -R 700 /cm/t/tree > /cm/t/o 2> /cm/t/e; echo rc=$?; sort /cm/t/o; sort /cm/t/e");
  check("chmod -v -R reports each entry and the symlink it skips, as GNU chmod does", cv4.stdout === "rc=0\nmode of '/cm/t/tree' changed from 0755 (rwxr-xr-x) to 0700 (rwx------)\nmode of '/cm/t/tree/a' changed from 0600 (rw-------) to 0700 (rwx------)\nmode of '/cm/t/tree/sub' changed from 0755 (rwxr-xr-x) to 0700 (rwx------)\nmode of '/cm/t/tree/sub/b' changed from 0644 (rw-r--r--) to 0700 (rwx------)\nneither symbolic link '/cm/t/tree/lnk' nor referent has been changed\n" && cv4.stderr === "", JSON.stringify([cv4.stdout, cv4.stderr]));
  const cv5 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && echo s > /cm/t/tree/sub/b && ln -s a /cm/t/tree/lnk && echo f > /cm/t/f1 && echo g > /cm/t/f2 && chmod 600 /cm/t/f1 /cm/t/tree/a && chmod 644 /cm/t/f2 && chmod 755 /cm/t/tree /cm/t/tree/sub; chmod -c -R 700 /cm/t/tree > /cm/t/o 2> /cm/t/e; echo rc=$?; sort /cm/t/o; sort /cm/t/e");
  check("chmod -c -R reports only the entries that changed, as GNU chmod does", cv5.stdout === "rc=0\nmode of '/cm/t/tree' changed from 0755 (rwxr-xr-x) to 0700 (rwx------)\nmode of '/cm/t/tree/a' changed from 0600 (rw-------) to 0700 (rwx------)\nmode of '/cm/t/tree/sub' changed from 0755 (rwxr-xr-x) to 0700 (rwx------)\nmode of '/cm/t/tree/sub/b' changed from 0644 (rw-r--r--) to 0700 (rwx------)\n" && cv5.stderr === "", JSON.stringify([cv5.stdout, cv5.stderr]));
  const cv6 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && echo s > /cm/t/tree/sub/b && ln -s a /cm/t/tree/lnk && echo f > /cm/t/f1 && echo g > /cm/t/f2 && chmod 600 /cm/t/f1 /cm/t/tree/a && chmod 644 /cm/t/f2 && chmod 755 /cm/t/tree /cm/t/tree/sub; chmod -vR 700 /cm/t/tree > /cm/t/o 2> /cm/t/e; echo rc=$?; sort /cm/t/o; sort /cm/t/e");
  check("chmod -vR combines the flags, as GNU chmod does", cv6.stdout === "rc=0\nmode of '/cm/t/tree' changed from 0755 (rwxr-xr-x) to 0700 (rwx------)\nmode of '/cm/t/tree/a' changed from 0600 (rw-------) to 0700 (rwx------)\nmode of '/cm/t/tree/sub' changed from 0755 (rwxr-xr-x) to 0700 (rwx------)\nmode of '/cm/t/tree/sub/b' changed from 0644 (rw-r--r--) to 0700 (rwx------)\nneither symbolic link '/cm/t/tree/lnk' nor referent has been changed\n" && cv6.stderr === "", JSON.stringify([cv6.stdout, cv6.stderr]));
  const cv7 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && echo s > /cm/t/tree/sub/b && ln -s a /cm/t/tree/lnk && echo f > /cm/t/f1 && echo g > /cm/t/f2 && chmod 600 /cm/t/f1 /cm/t/tree/a && chmod 644 /cm/t/f2 && chmod 755 /cm/t/tree /cm/t/tree/sub; chmod -v -R a=r /cm/t/tree > /cm/t/o 2> /cm/t/e; echo rc=$?; sort /cm/t/o; sort /cm/t/e");
  check("chmod -v -R with a mode that removes search reports the entries it cannot reach, as GNU chmod does", cv7.stdout === "rc=1\n'/cm/t/tree/a' could not be accessed\n'/cm/t/tree/lnk' could not be accessed\n'/cm/t/tree/sub' could not be accessed\nmode of '/cm/t/tree' changed from 0755 (rwxr-xr-x) to 0444 (r--r--r--)\nchmod: cannot access '/cm/t/tree/a': Permission denied\nchmod: cannot access '/cm/t/tree/lnk': Permission denied\nchmod: cannot access '/cm/t/tree/sub': Permission denied\n" && cv7.stderr === "", JSON.stringify([cv7.stdout, cv7.stderr]));
});

group('chmod --reference: the mode comes from the reference file, as GNU chmod does', async () => {
  const cf0 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && echo s > /cm/t/tree/sub/b && ln -s a /cm/t/tree/lnk && echo f > /cm/t/f1 && echo g > /cm/t/f2 && chmod 600 /cm/t/f1 /cm/t/tree/a && chmod 644 /cm/t/f2 && chmod 755 /cm/t/tree /cm/t/tree/sub; chmod --reference=/cm/t/f2 /cm/t/f1; echo rc=$?; stat -c %a /cm/t/f1");
  check("chmod --reference takes the mode of the reference file, as GNU chmod does", cf0.stdout === "rc=0\n644\n" && cf0.stderr === "", JSON.stringify([cf0.stdout, cf0.stderr]));
  const cf1 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && echo s > /cm/t/tree/sub/b && ln -s a /cm/t/tree/lnk && echo f > /cm/t/f1 && echo g > /cm/t/f2 && chmod 600 /cm/t/f1 /cm/t/tree/a && chmod 644 /cm/t/f2 && chmod 755 /cm/t/tree /cm/t/tree/sub; chmod --reference /cm/t/f2 /cm/t/f1; echo rc=$?; stat -c %a /cm/t/f1");
  check("chmod --reference with a separate argument takes the same mode", cf1.stdout === "rc=0\n644\n" && cf1.stderr === "", JSON.stringify([cf1.stdout, cf1.stderr]));
  const cf2 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && echo s > /cm/t/tree/sub/b && ln -s a /cm/t/tree/lnk && echo f > /cm/t/f1 && echo g > /cm/t/f2 && chmod 600 /cm/t/f1 /cm/t/tree/a && chmod 644 /cm/t/f2 && chmod 755 /cm/t/tree /cm/t/tree/sub; chmod --reference=/cm/t/nope /cm/t/f1; echo rc=$?; stat -c %a /cm/t/f1");
  check("chmod --reference of a missing file fails and changes nothing, as GNU chmod does", cf2.stdout === "rc=1\n600\n" && cf2.stderr === "chmod: failed to get attributes of '/cm/t/nope': No such file or directory\n", JSON.stringify([cf2.stdout, cf2.stderr]));
  const cf3 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && echo s > /cm/t/tree/sub/b && ln -s a /cm/t/tree/lnk && echo f > /cm/t/f1 && echo g > /cm/t/f2 && chmod 600 /cm/t/f1 /cm/t/tree/a && chmod 644 /cm/t/f2 && chmod 755 /cm/t/tree /cm/t/tree/sub; chmod --reference=/cm/t/f2 644 /cm/t/f1; echo rc=$?; stat -c %a /cm/t/f1");
  check("chmod --reference refuses a mode operand, which becomes a file, as GNU chmod does", cf3.stdout === "rc=1\n644\n" && cf3.stderr === "chmod: cannot access '644': No such file or directory\n", JSON.stringify([cf3.stdout, cf3.stderr]));
  const cf4 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && echo s > /cm/t/tree/sub/b && ln -s a /cm/t/tree/lnk && echo f > /cm/t/f1 && echo g > /cm/t/f2 && chmod 600 /cm/t/f1 /cm/t/tree/a && chmod 644 /cm/t/f2 && chmod 755 /cm/t/tree /cm/t/tree/sub; chmod --reference=/cm/t/f2; echo rc=$?");
  check("chmod --reference with no file says missing operand, as GNU chmod does", cf4.stdout === "rc=1\n" && cf4.stderr === "chmod: missing operand\nTry 'chmod --help' for more information.\n", JSON.stringify([cf4.stdout, cf4.stderr]));
  const cf5 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && echo s > /cm/t/tree/sub/b && ln -s a /cm/t/tree/lnk && echo f > /cm/t/f1 && echo g > /cm/t/f2 && chmod 600 /cm/t/f1 /cm/t/tree/a && chmod 644 /cm/t/f2 && chmod 755 /cm/t/tree /cm/t/tree/sub; chmod -v --reference=/cm/t/f2 /cm/t/f1; echo rc=$?");
  check("chmod --reference with -v reports the change, as GNU chmod does", cf5.stdout === "mode of '/cm/t/f1' changed from 0600 (rw-------) to 0644 (rw-r--r--)\nrc=0\n" && cf5.stderr === "", JSON.stringify([cf5.stdout, cf5.stderr]));
  const cf6 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && echo s > /cm/t/tree/sub/b && ln -s a /cm/t/tree/lnk && echo f > /cm/t/f1 && echo g > /cm/t/f2 && chmod 600 /cm/t/f1 /cm/t/tree/a && chmod 644 /cm/t/f2 && chmod 755 /cm/t/tree /cm/t/tree/sub; chmod --reference=/cm/t/f2 -R /cm/t/tree > /cm/t/o 2> /cm/t/e; echo rc=$?; sort /cm/t/o; sort /cm/t/e");
  check("chmod --reference with -R copies the mode to each entry, as GNU chmod does", cf6.stdout === "rc=1\nchmod: cannot access '/cm/t/tree/a': Permission denied\nchmod: cannot access '/cm/t/tree/lnk': Permission denied\nchmod: cannot access '/cm/t/tree/sub': Permission denied\n" && cf6.stderr === "", JSON.stringify([cf6.stdout, cf6.stderr]));
  const cf7 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && echo s > /cm/t/tree/sub/b && ln -s a /cm/t/tree/lnk && echo f > /cm/t/f1 && echo g > /cm/t/f2 && chmod 600 /cm/t/f1 /cm/t/tree/a && chmod 644 /cm/t/f2 && chmod 755 /cm/t/tree /cm/t/tree/sub; chmod --reference; echo rc=$?");
  check("chmod --reference without an argument says so, as GNU chmod does", cf7.stdout === "rc=1\n" && cf7.stderr === "chmod: option '--reference' requires an argument\nTry 'chmod --help' for more information.\n", JSON.stringify([cf7.stdout, cf7.stderr]));
});

group('chmod --dereference: a symlink operand and a -R entry follow their referent, as GNU chmod does', async () => {
  const cd0 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && echo s > /cm/t/tree/sub/b && ln -s a /cm/t/tree/lnk && echo f > /cm/t/f1 && echo g > /cm/t/f2 && chmod 600 /cm/t/f1 /cm/t/tree/a && chmod 644 /cm/t/f2 && chmod 755 /cm/t/tree /cm/t/tree/sub; echo o > /cm/t/out && chmod 600 /cm/t/out && ln -s /cm/t/out /cm/t/tree/olink && ln -s /cm/t/f1 /cm/t/tlink && ln -s /cm/t/tree /cm/t/tlinkd; chmod 644 /cm/t/tlink; echo rc=$?; stat -c %a /cm/t/f1 /cm/t/tlink");
  check("chmod on a symlink operand changes its referent, as GNU chmod does", cd0.stdout === "rc=0\n644\n777\n" && cd0.stderr === "", JSON.stringify([cd0.stdout, cd0.stderr]));
  const cd1 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && echo s > /cm/t/tree/sub/b && ln -s a /cm/t/tree/lnk && echo f > /cm/t/f1 && echo g > /cm/t/f2 && chmod 600 /cm/t/f1 /cm/t/tree/a && chmod 644 /cm/t/f2 && chmod 755 /cm/t/tree /cm/t/tree/sub; echo o > /cm/t/out && chmod 600 /cm/t/out && ln -s /cm/t/out /cm/t/tree/olink && ln -s /cm/t/f1 /cm/t/tlink && ln -s /cm/t/tree /cm/t/tlinkd; chmod -v 644 /cm/t/tlink; echo rc=$?");
  check("chmod -v on a symlink operand names the link and reports the referent mode", cd1.stdout === "mode of '/cm/t/tlink' changed from 0600 (rw-------) to 0644 (rw-r--r--)\nrc=0\n" && cd1.stderr === "", JSON.stringify([cd1.stdout, cd1.stderr]));
  const cd2 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && echo s > /cm/t/tree/sub/b && ln -s a /cm/t/tree/lnk && echo f > /cm/t/f1 && echo g > /cm/t/f2 && chmod 600 /cm/t/f1 /cm/t/tree/a && chmod 644 /cm/t/f2 && chmod 755 /cm/t/tree /cm/t/tree/sub; echo o > /cm/t/out && chmod 600 /cm/t/out && ln -s /cm/t/out /cm/t/tree/olink && ln -s /cm/t/f1 /cm/t/tlink && ln -s /cm/t/tree /cm/t/tlinkd; chmod -v -R --dereference 700 /cm/t/tree > /cm/t/o 2> /cm/t/e; echo rc=$?; sort /cm/t/o; sort /cm/t/e; stat -c %a /cm/t/out");
  check("chmod -R --dereference follows a link inside the tree to its target", cd2.stdout === "rc=0\nmode of '/cm/t/tree' changed from 0755 (rwxr-xr-x) to 0700 (rwx------)\nmode of '/cm/t/tree/a' changed from 0600 (rw-------) to 0700 (rwx------)\nmode of '/cm/t/tree/lnk' retained as 0700 (rwx------)\nmode of '/cm/t/tree/olink' changed from 0600 (rw-------) to 0700 (rwx------)\nmode of '/cm/t/tree/sub' changed from 0755 (rwxr-xr-x) to 0700 (rwx------)\nmode of '/cm/t/tree/sub/b' changed from 0644 (rw-r--r--) to 0700 (rwx------)\n700\n" && cd2.stderr === "", JSON.stringify([cd2.stdout, cd2.stderr]));
  const cd3 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && echo s > /cm/t/tree/sub/b && ln -s a /cm/t/tree/lnk && echo f > /cm/t/f1 && echo g > /cm/t/f2 && chmod 600 /cm/t/f1 /cm/t/tree/a && chmod 644 /cm/t/f2 && chmod 755 /cm/t/tree /cm/t/tree/sub; echo o > /cm/t/out && chmod 600 /cm/t/out && ln -s /cm/t/out /cm/t/tree/olink && ln -s /cm/t/f1 /cm/t/tlink && ln -s /cm/t/tree /cm/t/tlinkd; chmod -R 700 /cm/t/tree; echo rc=$?; stat -c %a /cm/t/out");
  check("chmod -R without --dereference leaves a link target outside the tree alone", cd3.stdout === "rc=0\n600\n" && cd3.stderr === "", JSON.stringify([cd3.stdout, cd3.stderr]));
  const cd4 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && echo s > /cm/t/tree/sub/b && ln -s a /cm/t/tree/lnk && echo f > /cm/t/f1 && echo g > /cm/t/f2 && chmod 600 /cm/t/f1 /cm/t/tree/a && chmod 644 /cm/t/f2 && chmod 755 /cm/t/tree /cm/t/tree/sub; echo o > /cm/t/out && chmod 600 /cm/t/out && ln -s /cm/t/out /cm/t/tree/olink && ln -s /cm/t/f1 /cm/t/tlink && ln -s /cm/t/tree /cm/t/tlinkd; chmod -v -R 700 /cm/t/tlinkd > /cm/t/o 2> /cm/t/e; echo rc=$?; sort /cm/t/o; sort /cm/t/e");
  check("chmod -R on a symlink to a directory walks the directory it names, as GNU chmod does", cd4.stdout === "rc=0\nmode of '/cm/t/tlinkd' changed from 0755 (rwxr-xr-x) to 0700 (rwx------)\nmode of '/cm/t/tlinkd/a' changed from 0600 (rw-------) to 0700 (rwx------)\nmode of '/cm/t/tlinkd/sub' changed from 0755 (rwxr-xr-x) to 0700 (rwx------)\nmode of '/cm/t/tlinkd/sub/b' changed from 0644 (rw-r--r--) to 0700 (rwx------)\nneither symbolic link '/cm/t/tlinkd/lnk' nor referent has been changed\nneither symbolic link '/cm/t/tlinkd/olink' nor referent has been changed\n" && cd4.stderr === "", JSON.stringify([cd4.stdout, cd4.stderr]));
});

group('chmod -h and --no-dereference: a link operand is left alone, as GNU chmod does on Linux', async () => {
  const ch0 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && echo s > /cm/t/tree/sub/b && ln -s a /cm/t/tree/lnk && echo f > /cm/t/f1 && echo g > /cm/t/f2 && chmod 600 /cm/t/f1 /cm/t/tree/a && chmod 644 /cm/t/f2 && chmod 755 /cm/t/tree /cm/t/tree/sub; echo o > /cm/t/out && chmod 600 /cm/t/out && ln -s /cm/t/out /cm/t/tree/olink && ln -s /cm/t/f1 /cm/t/tlink && ln -s /cm/t/tree /cm/t/tlinkd; chmod -h 644 /cm/t/tlink; echo rc=$?; stat -c %a /cm/t/f1");
  check("chmod -h leaves a symlink operand alone, and its referent keeps its mode, as GNU chmod does on Linux", ch0.stdout === "rc=0\n600\n" && ch0.stderr === "", JSON.stringify([ch0.stdout, ch0.stderr]));
  const ch1 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && echo s > /cm/t/tree/sub/b && ln -s a /cm/t/tree/lnk && echo f > /cm/t/f1 && echo g > /cm/t/f2 && chmod 600 /cm/t/f1 /cm/t/tree/a && chmod 644 /cm/t/f2 && chmod 755 /cm/t/tree /cm/t/tree/sub; echo o > /cm/t/out && chmod 600 /cm/t/out && ln -s /cm/t/out /cm/t/tree/olink && ln -s /cm/t/f1 /cm/t/tlink && ln -s /cm/t/tree /cm/t/tlinkd; chmod -hv 644 /cm/t/tlink; echo rc=$?; stat -c %a /cm/t/f1");
  check("chmod -hv names the link and says neither the link nor its referent changed, as GNU chmod does", ch1.stdout === "neither symbolic link '/cm/t/tlink' nor referent has been changed\nrc=0\n600\n" && ch1.stderr === "", JSON.stringify([ch1.stdout, ch1.stderr]));
  const ch2 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && echo s > /cm/t/tree/sub/b && ln -s a /cm/t/tree/lnk && echo f > /cm/t/f1 && echo g > /cm/t/f2 && chmod 600 /cm/t/f1 /cm/t/tree/a && chmod 644 /cm/t/f2 && chmod 755 /cm/t/tree /cm/t/tree/sub; echo o > /cm/t/out && chmod 600 /cm/t/out && ln -s /cm/t/out /cm/t/tree/olink && ln -s /cm/t/f1 /cm/t/tlink && ln -s /cm/t/tree /cm/t/tlinkd; chmod --no-dereference -v 700 /cm/t/f2 /cm/t/tlink > /cm/t/o 2> /cm/t/e; echo rc=$?; sort /cm/t/o; sort /cm/t/e");
  check("chmod --no-dereference changes a regular file and leaves a link operand alone", ch2.stdout === "rc=0\nmode of '/cm/t/f2' changed from 0644 (rw-r--r--) to 0700 (rwx------)\nneither symbolic link '/cm/t/tlink' nor referent has been changed\n" && ch2.stderr === "", JSON.stringify([ch2.stdout, ch2.stderr]));
  const ch3 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && echo s > /cm/t/tree/sub/b && ln -s a /cm/t/tree/lnk && echo f > /cm/t/f1 && echo g > /cm/t/f2 && chmod 600 /cm/t/f1 /cm/t/tree/a && chmod 644 /cm/t/f2 && chmod 755 /cm/t/tree /cm/t/tree/sub; echo o > /cm/t/out && chmod 600 /cm/t/out && ln -s /cm/t/out /cm/t/tree/olink && ln -s /cm/t/f1 /cm/t/tlink && ln -s /cm/t/tree /cm/t/tlinkd; chmod -hR 700 /cm/t/tree; echo rc=$?; stat -c %a /cm/t/tree/a /cm/t/out");
  check("chmod -hR walks a tree and leaves the links in it alone, as GNU chmod does", ch3.stdout === "rc=0\n700\n600\n" && ch3.stderr === "", JSON.stringify([ch3.stdout, ch3.stderr]));
  const ch4 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && echo s > /cm/t/tree/sub/b && ln -s a /cm/t/tree/lnk && echo f > /cm/t/f1 && echo g > /cm/t/f2 && chmod 600 /cm/t/f1 /cm/t/tree/a && chmod 644 /cm/t/f2 && chmod 755 /cm/t/tree /cm/t/tree/sub; echo o > /cm/t/out && chmod 600 /cm/t/out && ln -s /cm/t/out /cm/t/tree/olink && ln -s /cm/t/f1 /cm/t/tlink && ln -s /cm/t/tree /cm/t/tlinkd; chmod -hvR 700 /cm/t/tree > /cm/t/o 2> /cm/t/e; echo rc=$?; sort /cm/t/o; sort /cm/t/e");
  check("chmod -hvR reports each link inside the tree as neither changed, as GNU chmod does", ch4.stdout === "rc=0\nmode of '/cm/t/tree' changed from 0755 (rwxr-xr-x) to 0700 (rwx------)\nmode of '/cm/t/tree/a' changed from 0600 (rw-------) to 0700 (rwx------)\nmode of '/cm/t/tree/sub' changed from 0755 (rwxr-xr-x) to 0700 (rwx------)\nmode of '/cm/t/tree/sub/b' changed from 0644 (rw-r--r--) to 0700 (rwx------)\nneither symbolic link '/cm/t/tree/lnk' nor referent has been changed\nneither symbolic link '/cm/t/tree/olink' nor referent has been changed\n" && ch4.stderr === "", JSON.stringify([ch4.stdout, ch4.stderr]));
});

group('chmod: a dangling symlink, a missing operand and a symlink cycle are reported with GNU wording', async () => {
  const dg0 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && ln -s /cm/t/nowhere /cm/t/dangle && mkdir -p /cm/t/dtree && echo a > /cm/t/dtree/a && ln -s /cm/t/nowhere /cm/t/dtree/dl; chmod 644 /cm/t/dangle; echo rc=$?");
  check("chmod on a dangling symlink operand is refused with GNU wording and status 1", dg0.stdout === "rc=1\n" && dg0.stderr === "chmod: cannot operate on dangling symlink '/cm/t/dangle'\n", JSON.stringify([dg0.stdout, dg0.stderr]));
  const dg1 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && ln -s /cm/t/nowhere /cm/t/dangle && mkdir -p /cm/t/dtree && echo a > /cm/t/dtree/a && ln -s /cm/t/nowhere /cm/t/dtree/dl; chmod -v 644 /cm/t/dangle > /cm/t/o 2> /cm/t/e; echo rc=$?; cat /cm/t/o; cat /cm/t/e");
  check("chmod -v on a dangling operand also names it as not accessed, on stdout", dg1.stdout === "rc=1\n'/cm/t/dangle' could not be accessed\nchmod: cannot operate on dangling symlink '/cm/t/dangle'\n" && dg1.stderr === "", JSON.stringify([dg1.stdout, dg1.stderr]));
  const dg2 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && ln -s /cm/t/nowhere /cm/t/dangle && mkdir -p /cm/t/dtree && echo a > /cm/t/dtree/a && ln -s /cm/t/nowhere /cm/t/dtree/dl; chmod -h 644 /cm/t/dangle; echo rc=$?");
  check("chmod -h on a dangling operand is a no-op, as GNU chmod does on Linux", dg2.stdout === "rc=0\n" && dg2.stderr === "", JSON.stringify([dg2.stdout, dg2.stderr]));
  const dg3 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && ln -s /cm/t/nowhere /cm/t/dangle && mkdir -p /cm/t/dtree && echo a > /cm/t/dtree/a && ln -s /cm/t/nowhere /cm/t/dtree/dl; chmod -v 644 /cm/t/nosuch > /cm/t/o 2> /cm/t/e; echo rc=$?; cat /cm/t/o; cat /cm/t/e");
  check("chmod -v on a missing operand names it as not accessed, on stdout, as GNU chmod does", dg3.stdout === "rc=1\n'/cm/t/nosuch' could not be accessed\nchmod: cannot access '/cm/t/nosuch': No such file or directory\n" && dg3.stderr === "", JSON.stringify([dg3.stdout, dg3.stderr]));
  const dg4 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && ln -s /cm/t/nowhere /cm/t/dangle && mkdir -p /cm/t/dtree && echo a > /cm/t/dtree/a && ln -s /cm/t/nowhere /cm/t/dtree/dl; chmod -R --dereference 700 /cm/t/dtree > /cm/t/o 2> /cm/t/e; echo rc=$?; cat /cm/t/o; cat /cm/t/e");
  check("chmod -R --dereference on a tree with a dangling link refuses the link, as GNU chmod does", dg4.stdout === "rc=1\nchmod: cannot dereference '/cm/t/dtree/dl': No such file or directory\n" && dg4.stderr === "", JSON.stringify([dg4.stdout, dg4.stderr]));
  const dg5 = await run(await shell({}), "mkdir -p /cm/t/tree/sub && echo a > /cm/t/tree/a && ln -s /cm/t/nowhere /cm/t/dangle && mkdir -p /cm/t/dtree && echo a > /cm/t/dtree/a && ln -s /cm/t/nowhere /cm/t/dtree/dl; chmod -vR --dereference 700 /cm/t/dtree > /cm/t/o 2> /cm/t/e; echo rc=$?; sort /cm/t/o; sort /cm/t/e");
  check("chmod -vR --dereference names the dangling entry as not accessed, on stdout", dg5.stdout === "rc=1\n'/cm/t/dtree/dl' could not be accessed\nmode of '/cm/t/dtree' changed from 0755 (rwxr-xr-x) to 0700 (rwx------)\nmode of '/cm/t/dtree/a' changed from 0644 (rw-r--r--) to 0700 (rwx------)\nchmod: cannot dereference '/cm/t/dtree/dl': No such file or directory\n" && dg5.stderr === "", JSON.stringify([dg5.stdout, dg5.stderr]));
  const dg6 = await run(await shell({}), "mkdir -p /cm/t/cyc/sub && echo z > /cm/t/cyc/sub/z && ln -s /cm/t/cyc /cm/t/cyc/sub/up; chmod -R --dereference 700 /cm/t/cyc > /cm/t/o 2> /cm/t/e; echo rc=$?; cat /cm/t/o; cat /cm/t/e; stat -c %a /cm/t/cyc/sub/z");
  check("chmod -R --dereference on a symlink cycle stops and prints nothing without -v, as GNU chmod does", dg6.stdout === "rc=0\n700\n" && dg6.stderr === "", JSON.stringify([dg6.stdout, dg6.stderr]));
  const dg7 = await run(await shell({}), "mkdir -p /cm/t/cyc/sub && echo z > /cm/t/cyc/sub/z && ln -s /cm/t/cyc /cm/t/cyc/sub/up; chmod -vR --dereference 700 /cm/t/cyc > /cm/t/o 2> /cm/t/e; echo rc=$?; sort /cm/t/o; sort /cm/t/e");
  check("chmod -vR --dereference on a symlink cycle reports each entry once as retained, as GNU chmod does", dg7.stdout === "rc=0\nmode of '/cm/t/cyc' changed from 0755 (rwxr-xr-x) to 0700 (rwx------)\nmode of '/cm/t/cyc/sub' changed from 0755 (rwxr-xr-x) to 0700 (rwx------)\nmode of '/cm/t/cyc/sub/up' retained as 0700 (rwx------)\nmode of '/cm/t/cyc/sub/z' changed from 0644 (rw-r--r--) to 0700 (rwx------)\n" && dg7.stderr === "", JSON.stringify([dg7.stdout, dg7.stderr]));
});

group("chmod -R and -v: the owner bits decide whether a directory can be read and its entries reached, as GNU chmod does on Linux", async () => {
  const co0 = await run(await shell({}), "mkdir d && echo a > d/a && mkdir d/sub && echo b > d/sub/b && chmod 755 d d/sub; chmod -R 300 d; echo rc=$?; stat -c \"%a %n\" d");
  check("chmod -R with a directory that has no owner read bit reports the directory it cannot read, as GNU chmod does on Linux", co0.stdout === "rc=1\n300 d\n" && co0.stderr === "chmod: cannot read directory 'd': Permission denied\n", JSON.stringify([co0.stdout, co0.stderr]));
  const co1 = await run(await shell({}), "mkdir d && echo a > d/a && mkdir d/sub && echo b > d/sub/b && chmod 755 d d/sub; chmod -R 100 d; echo rc=$?; stat -c \"%a %n\" d");
  check("chmod -R with a directory of owner search only reports the directory it cannot read, as GNU chmod does on Linux", co1.stdout === "rc=1\n100 d\n" && co1.stderr === "chmod: cannot read directory 'd': Permission denied\n", JSON.stringify([co1.stdout, co1.stderr]));
  const co2 = await run(await shell({}), "mkdir d && echo a > d/a && mkdir d/sub && echo b > d/sub/b && chmod 755 d d/sub; chmod -R 000 d; echo rc=$?; stat -c \"%a %n\" d");
  check("chmod -R with a directory of no owner bits reports the directory it cannot read, as GNU chmod does on Linux", co2.stdout === "rc=1\n0 d\n" && co2.stderr === "chmod: cannot read directory 'd': Permission denied\n", JSON.stringify([co2.stdout, co2.stderr]));
  const co3 = await run(await shell({}), "mkdir d && echo a > d/a && mkdir d/sub && echo b > d/sub/b && chmod 755 d d/sub; chmod -R 400 d; echo rc=$?; stat -c \"%a %n\" d");
  check("chmod -R with a directory of owner read only reports each entry it cannot reach, as GNU chmod does on Linux", co3.stdout === "rc=1\n400 d\n" && co3.stderr === "chmod: cannot access 'd/a': Permission denied\nchmod: cannot access 'd/sub': Permission denied\n", JSON.stringify([co3.stdout, co3.stderr]));
  const co4 = await run(await shell({}), "mkdir d && echo a > d/a && mkdir d/sub && echo b > d/sub/b && chmod 755 d d/sub; chmod -vR 400 d; echo rc=$?; stat -c \"%a %n\" d");
  check("chmod -vR with a directory of owner read only reports each entry it cannot reach, as GNU chmod does on Linux", co4.stdout === "mode of 'd' changed from 0755 (rwxr-xr-x) to 0400 (r--------)\n'd/a' could not be accessed\n'd/sub' could not be accessed\nrc=1\n400 d\n" && co4.stderr === "chmod: cannot access 'd/a': Permission denied\nchmod: cannot access 'd/sub': Permission denied\n", JSON.stringify([co4.stdout, co4.stderr]));
  const co5 = await run(await shell({}), "mkdir d && echo a > d/a && mkdir d/sub && echo b > d/sub/b && chmod 755 d d/sub; chmod -vR 300 d; echo rc=$?; stat -c \"%a %n\" d");
  check("chmod -vR with a directory of owner search only reports the directory it cannot read, as GNU chmod does on Linux", co5.stdout === "mode of 'd' changed from 0755 (rwxr-xr-x) to 0300 (-wx------)\n'd' could not be accessed\nrc=1\n300 d\n" && co5.stderr === "chmod: cannot read directory 'd': Permission denied\n", JSON.stringify([co5.stdout, co5.stderr]));
  const co6 = await run(await shell({}), "mkdir d && echo a > d/a && mkdir d/sub && echo b > d/sub/b && chmod 755 d d/sub; chmod -vR 000 d; echo rc=$?; stat -c \"%a %n\" d");
  check("chmod -vR with a directory of no owner bits reports the directory it cannot read, as GNU chmod does on Linux", co6.stdout === "mode of 'd' changed from 0755 (rwxr-xr-x) to 0000 (---------)\n'd' could not be accessed\nrc=1\n0 d\n" && co6.stderr === "chmod: cannot read directory 'd': Permission denied\n", JSON.stringify([co6.stdout, co6.stderr]));
  const co7 = await run(await shell({}), "mkdir d && echo a > d/a && mkdir d/sub && echo b > d/sub/b && chmod 755 d d/sub; chmod -R 500 d; echo rc=$?; stat -c \"%a %n\" d d/a d/sub d/sub/b");
  check("chmod -R with a directory of owner read and search changes every entry, as GNU chmod does on Linux", co7.stdout === "rc=0\n500 d\n500 d/a\n500 d/sub\n500 d/sub/b\n" && co7.stderr === "", JSON.stringify([co7.stdout, co7.stderr]));
  const co8 = await run(await shell({}), "mkdir d && echo a > d/a && mkdir d/sub && echo b > d/sub/b && chmod 755 d d/sub; chmod 000 d; chmod -R 700 d; echo rc=$?; stat -c \"%a %n\" d d/a d/sub d/sub/b");
  check("chmod -R on a directory with no owner bits changes it first and then reaches its entries, as GNU chmod does on Linux", co8.stdout === "rc=0\n700 d\n700 d/a\n700 d/sub\n700 d/sub/b\n" && co8.stderr === "", JSON.stringify([co8.stdout, co8.stderr]));
  const co9 = await run(await shell({}), "mkdir d && echo a > d/a && mkdir d/sub && echo b > d/sub/b && chmod 755 d d/sub; chmod 000 d; chmod -R 700 d/a; echo rc=$?; stat -c \"%a %n\" d");
  check("chmod -R on an entry under a directory without owner search reports the entry it cannot reach, as GNU chmod does on Linux", co9.stdout === "rc=1\n0 d\n" && co9.stderr === "chmod: cannot access 'd/a': Permission denied\n", JSON.stringify([co9.stdout, co9.stderr]));
  const co10 = await run(await shell({}), "mkdir d && echo a > d/a && mkdir d/sub && echo b > d/sub/b && chmod 755 d d/sub; chmod 000 d; chmod -v 700 d/a; echo rc=$?; stat -c \"%a %n\" d");
  check("chmod -v on an entry under a directory without owner search reports the entry it cannot reach, as GNU chmod does on Linux", co10.stdout === "'d/a' could not be accessed\nrc=1\n0 d\n" && co10.stderr === "chmod: cannot access 'd/a': Permission denied\n", JSON.stringify([co10.stdout, co10.stderr]));
  const co11 = await run(await shell({}), "mkdir d && echo a > d/a && mkdir d/sub && echo b > d/sub/b && chmod 755 d d/sub; chmod 000 d; chmod 644 d/sub; echo rc=$?");
  check("chmod on a directory entry under a directory without owner search reports the entry it cannot reach, as GNU chmod does on Linux", co11.stdout === "rc=1\n" && co11.stderr === "chmod: cannot access 'd/sub': Permission denied\n", JSON.stringify([co11.stdout, co11.stderr]));
  const co12 = await run(await shell({}), "mkdir d && echo a > d/a && mkdir d/sub && echo b > d/sub/b && chmod 755 d d/sub; chmod 000 d; chmod -R 700 d/sub/b; echo rc=$?");
  check("chmod -R on a nested file under a directory without owner search reports the whole path it cannot reach, as GNU chmod does on Linux", co12.stdout === "rc=1\n" && co12.stderr === "chmod: cannot access 'd/sub/b': Permission denied\n", JSON.stringify([co12.stdout, co12.stderr]));
});

group("stat -c: the owner and group names are the shell identity, as GNU stat names the identity abc", async () => {
  const si0 = await run(await shell({}), "mkdir d && echo a > d/a && mkdir d/sub && echo b > d/sub/b && chmod 755 d d/sub; stat -c \"%U %G %a %n\" d d/a");
  check("stat -c with %U and %G names the shell identity for a directory and a file, as GNU stat names the identity abc", si0.stdout === "user user 755 d\nuser user 644 d/a\n" && si0.stderr === "", JSON.stringify([si0.stdout, si0.stderr]));
  const si1 = await run(await shell({}), "mkdir d && echo a > d/a && mkdir d/sub && echo b > d/sub/b && chmod 755 d d/sub; chmod 600 d/a; stat -c \"%U:%G %a %n\" d/a");
  check("stat -c with %U and %G names the shell identity after a chmod of the file, as GNU stat names the identity abc", si1.stdout === "user:user 600 d/a\n" && si1.stderr === "", JSON.stringify([si1.stdout, si1.stderr]));
  const si2 = await run(await shell({}), "mkdir d && echo a > d/a && mkdir d/sub && echo b > d/sub/b && chmod 755 d d/sub; stat -c \"%U %G %F %n\" d d/a");
  check("stat -c with %U, %G and %F names the owner, group and type of each name, as GNU stat does for the identity abc", si2.stdout === "user user directory d\nuser user regular file d/a\n" && si2.stderr === "", JSON.stringify([si2.stdout, si2.stderr]));
});

group("chmod through a symbolic link: every directory the lookup passes through needs owner search, as GNU chmod does on Linux", async () => {
  const lk0 = await run(await shell({}), "mkdir d && echo a > d/a && ln -s d lnk && chmod 000 d; chmod 700 lnk/a; echo rc=$?");
  check("chmod through a directory symlink into a directory without owner search is refused, as GNU chmod does on Linux", lk0.stdout === "rc=1\n" && lk0.stderr === "chmod: cannot access 'lnk/a': Permission denied\n", JSON.stringify([lk0.stdout, lk0.stderr]));
  const lk1 = await run(await shell({}), "mkdir d && echo a > d/a && ln -s d/a la && chmod 000 d; chmod 700 la; echo rc=$?");
  check("chmod through a file symlink into a directory without owner search is refused when the link is followed, as GNU chmod does on Linux", lk1.stdout === "rc=1\n" && lk1.stderr === "chmod: cannot access 'la': Permission denied\n", JSON.stringify([lk1.stdout, lk1.stderr]));
  const lk2 = await run(await shell({}), "mkdir d && echo a > d/a && ln -s d/a la && chmod 000 d; chmod -h 700 la; echo rc=$?");
  check("chmod -h on a file symlink into a directory without owner search is refused, as GNU chmod does on Linux", lk2.stdout === "rc=1\n" && lk2.stderr === "chmod: cannot access 'la': Permission denied\n", JSON.stringify([lk2.stdout, lk2.stderr]));
  const lk3 = await run(await shell({}), "mkdir d && echo a > d/a && ln -s d lnk && chmod 000 d; chmod -h 700 lnk; echo rc=$?");
  check("chmod -h on a directory symlink to a directory without owner search is not refused, as GNU chmod does on Linux", lk3.stdout === "rc=0\n" && lk3.stderr === "", JSON.stringify([lk3.stdout, lk3.stderr]));
  const lk4 = await run(await shell({}), "mkdir d && echo a > d/a && ln -s d/a la && chmod 000 d; chmod -vh 700 la; echo rc=$?");
  check("chmod -vh on a file symlink into a directory without owner search is refused and reported, as GNU chmod does on Linux", lk4.stdout === "'la' could not be accessed\nrc=1\n" && lk4.stderr === "chmod: cannot access 'la': Permission denied\n", JSON.stringify([lk4.stdout, lk4.stderr]));
  const lk5 = await run(await shell({}), "mkdir d && echo a > d/a && ln -s a d/lk && chmod 000 d; chmod -h 700 d/lk; echo rc=$?");
  check("chmod -h on a symlink in a directory without owner search is refused, as GNU chmod does on Linux", lk5.stdout === "rc=1\n" && lk5.stderr === "chmod: cannot access 'd/lk': Permission denied\n", JSON.stringify([lk5.stdout, lk5.stderr]));
  const lk6 = await run(await shell({}), "mkdir d && echo a > d/a && ln -s a d/lk && chmod 000 d; chmod 700 d/lk; echo rc=$?");
  check("chmod on a symlink in a directory without owner search is refused, as GNU chmod does on Linux", lk6.stdout === "rc=1\n" && lk6.stderr === "chmod: cannot access 'd/lk': Permission denied\n", JSON.stringify([lk6.stdout, lk6.stderr]));
  const lk7 = await run(await shell({}), "mkdir d && echo a > d/a && ln -s d l1 && ln -s l1 l2 && chmod 000 d; chmod 700 l2/a; echo rc=$?");
  check("chmod through a directory symlink to a file in a directory reached through a second link is refused, as GNU chmod does on Linux", lk7.stdout === "rc=1\n" && lk7.stderr === "chmod: cannot access 'l2/a': Permission denied\n", JSON.stringify([lk7.stdout, lk7.stderr]));
  const lk8 = await run(await shell({}), "mkdir d && mkdir d/e && echo a > d/e/a && ln -s d/e lnk2 && chmod 000 d/e; chmod 700 lnk2/a; echo rc=$?");
  check("chmod through a directory symlink to a subdirectory without owner search is refused, as GNU chmod does on Linux", lk8.stdout === "rc=1\n" && lk8.stderr === "chmod: cannot access 'lnk2/a': Permission denied\n", JSON.stringify([lk8.stdout, lk8.stderr]));
  const lk9 = await run(await shell({}), "mkdir d e && echo a > d/a && ln -s ../d/a e/lk && chmod 000 d; chmod -R --dereference 700 e; echo rc=$?");
  check("chmod -R --dereference refuses a symlink whose target is in a directory without owner search, as GNU chmod does on Linux", lk9.stdout === "rc=1\n" && lk9.stderr === "chmod: cannot dereference 'e/lk': Permission denied\n", JSON.stringify([lk9.stdout, lk9.stderr]));
  const lk10 = await run(await shell({}), "mkdir d e && echo a > d/a && ln -s ../d/a e/lk && chmod 000 d; chmod -vR --dereference 700 e; echo rc=$?");
  check("chmod -vR --dereference reports the symlink whose target is in a directory without owner search, as GNU chmod does on Linux", lk10.stdout === "mode of 'e' changed from 0755 (rwxr-xr-x) to 0700 (rwx------)\n'e/lk' could not be accessed\nrc=1\n" && lk10.stderr === "chmod: cannot dereference 'e/lk': Permission denied\n", JSON.stringify([lk10.stdout, lk10.stderr]));
  const lk11 = await run(await shell({}), "mkdir d e && echo a > d/a && ln -s ../d/a e/lk && chmod 000 d; chmod -R 700 e; echo rc=$?");
  check("chmod -R without --dereference leaves a symlink whose target is in a directory without owner search alone, as GNU chmod does on Linux", lk11.stdout === "rc=0\n" && lk11.stderr === "", JSON.stringify([lk11.stdout, lk11.stderr]));
});

group("chmod through a link with .. resolves the link first, and the directory lookup needs owner search, as GNU chmod does on Linux", async () => {
  const lk0 = await run(await shell({}), "mkdir d d/e && echo one > d/x && echo two > x && ln -s d/e lnk && chmod 600 lnk/../x; echo rc=$?; stat -c \"%a %n\" d/x x");
  check("chmod through a link with .. changes the file the physical path names, as GNU chmod does on Linux", lk0.stdout === "rc=0\n600 d/x\n644 x\n" && lk0.stderr === "", JSON.stringify([lk0.stdout, lk0.stderr]));
  const lk1 = await run(await shell({}), "mkdir d d/e && echo one > d/x && ln -s d/e lnk && chmod 600 lnk/..; echo rc=$?; stat -c \"%a %n\" d .");
  check("chmod through a link with .. changes the directory the physical path names, as GNU chmod does on Linux", lk1.stdout === "rc=0\n600 d\n755 .\n" && lk1.stderr === "", JSON.stringify([lk1.stdout, lk1.stderr]));
  const lk2 = await run(await shell({}), "mkdir d d/e && echo one > d/e/y && ln -s d/e lnk && chmod -vR 600 lnk/..; echo rc=$?; stat -c \"%a %n\" d");
  check("chmod -vR through a link with .. reports the directory it cannot read once its mode removes the search it needs, as GNU chmod does on Linux", lk2.stdout === "mode of 'lnk/..' changed from 0755 (rwxr-xr-x) to 0600 (rw-------)\n'lnk/..' could not be accessed\nrc=1\n600 d\n" && lk2.stderr === "chmod: cannot read directory 'lnk/..': Permission denied\n", JSON.stringify([lk2.stdout, lk2.stderr]));
  const lk3 = await run(await shell({}), "mkdir d d/e && echo one > d/x && chmod 000 d && ln -s d/e lnk; chmod 600 lnk/../x; echo rc=$?");
  check("chmod through a link with .. into a directory without owner search is refused, as GNU chmod does on Linux", lk3.stdout === "rc=1\n" && lk3.stderr === "chmod: cannot access 'lnk/../x': Permission denied\n", JSON.stringify([lk3.stdout, lk3.stderr]));
});

group("stat and chmod: a lookup through a directory without owner search is refused, as GNU does on Linux", async () => {
  const sr0 = await run(await shell({}), "mkdir d && echo a > d/a && chmod 000 d; stat -c \"%a %n\" d/a; echo rc=$?");
  check("stat -c refuses a file under a directory without owner search, as GNU stat does on Linux", sr0.stdout === "rc=1\n" && sr0.stderr === "stat: cannot statx 'd/a': Permission denied\n", JSON.stringify([sr0.stdout, sr0.stderr]));
  const sr1 = await run(await shell({}), "mkdir d && echo a > d/a && chmod 000 d; stat -c \"%a %n\" d d/a; echo rc=$?");
  check("stat -c reports a directory without owner search and refuses the file under it, as GNU stat does on Linux", sr1.stdout === "0 d\nrc=1\n" && sr1.stderr === "stat: cannot statx 'd/a': Permission denied\n", JSON.stringify([sr1.stdout, sr1.stderr]));
  const sr2 = await run(await shell({}), "mkdir d && echo a > d/a && ln -s d/a la && chmod 000 d; stat -c \"%a %n\" la; echo rc=$?");
  check("stat -c reports a symbolic link into a directory without owner search as the link, as GNU stat does on Linux", sr2.stdout === "777 la\nrc=0\n" && sr2.stderr === "", JSON.stringify([sr2.stdout, sr2.stderr]));
  const sr3 = await run(await shell({}), "mkdir d && echo a > d/a && ln -s d lnk && chmod 000 d; stat -c \"%a %n\" lnk/a; echo rc=$?");
  check("stat -c refuses a path through a directory symbolic link into a directory without owner search, as GNU stat does on Linux", sr3.stdout === "rc=1\n" && sr3.stderr === "stat: cannot statx 'lnk/a': Permission denied\n", JSON.stringify([sr3.stdout, sr3.stderr]));
  const sr4 = await run(await shell({}), "mkdir d && echo a > d/a && ln -s d lnk && chmod 000 d; stat -c \"%a %n\" lnk; echo rc=$?");
  check("stat -c reports a directory symbolic link to a directory without owner search as the link, as GNU stat does on Linux", sr4.stdout === "777 lnk\nrc=0\n" && sr4.stderr === "", JSON.stringify([sr4.stdout, sr4.stderr]));
  const sr5 = await run(await shell({}), "mkdir d d/e && echo a > d/e/x && ln -s d/e lnk && chmod 000 d; stat -c \"%a %n\" lnk/..; echo rc=$?");
  check("stat -c refuses a dot-dot after a directory symbolic link into a directory without owner search, as GNU stat does on Linux", sr5.stdout === "rc=1\n" && sr5.stderr === "stat: cannot statx 'lnk/..': Permission denied\n", JSON.stringify([sr5.stdout, sr5.stderr]));
  const sr6 = await run(await shell({}), "mkdir d && chmod 000 d; stat -c \"%a %n\" d/.; echo rc=$?");
  check("stat -c refuses a dot in a directory without owner search, as GNU stat does on Linux", sr6.stdout === "rc=1\n" && sr6.stderr === "stat: cannot statx 'd/.': Permission denied\n", JSON.stringify([sr6.stdout, sr6.stderr]));
  const sr7 = await run(await shell({}), "mkdir d && echo a > d/a && chmod 000 d; stat -c \"%a %n\" d/a d/a; echo rc=$?");
  check("stat -c repeats a name under a directory without owner search once for each operand, as GNU stat does on Linux", sr7.stdout === "rc=1\n" && sr7.stderr === "stat: cannot statx 'd/a': Permission denied\nstat: cannot statx 'd/a': Permission denied\n", JSON.stringify([sr7.stdout, sr7.stderr]));
  const sr8 = await run(await shell({}), "mkdir d && chmod 000 d; chmod 700 d/.; echo rc=$?; stat -c \"%a %n\" d");
  check("chmod refuses a dot in a directory without owner search, as GNU chmod does on Linux", sr8.stdout === "rc=1\n0 d\n" && sr8.stderr === "chmod: cannot access 'd/.': Permission denied\n", JSON.stringify([sr8.stdout, sr8.stderr]));
});

group("stat -c: a dot-dot after a symbolic link names the physical directory, as GNU stat does on Linux", async () => {
  const sq0 = await run(await shell({}), "mkdir d d/e && chmod 750 d && ln -s d/e lnk && stat -c \"%a %n\" lnk/..; echo rc=$?");
  check("stat -c with a dot-dot after a directory symbolic link reports the directory the physical path names, as GNU stat does on Linux", sq0.stdout === "750 lnk/..\nrc=0\n" && sq0.stderr === "", JSON.stringify([sq0.stdout, sq0.stderr]));
});

group("stat -L: a symbolic link operand is followed to its target, and a dangling or blocked target is refused, as GNU stat does on Linux", async () => {
  const gr0 = await run(await shell({}), "echo a > f && chmod 600 f && ln -s f lk && stat -L -c \"%a %n\" lk; echo rc=$?");
  check("stat -L -c reports the target of a file symbolic link, as GNU stat does on Linux", gr0.stdout === "600 lk\nrc=0\n" && gr0.stderr === "", JSON.stringify([gr0.stdout, gr0.stderr]));
  const gr1 = await run(await shell({}), "echo a > f && chmod 600 f && ln -s f lk && stat -c \"%a %n\" lk; echo rc=$?");
  check("stat -c without -L reports a symbolic link as the link, as GNU stat does on Linux", gr1.stdout === "777 lk\nrc=0\n" && gr1.stderr === "", JSON.stringify([gr1.stdout, gr1.stderr]));
  const gr2 = await run(await shell({}), "ln -s nope dl && stat -L -c \"%a %n\" dl; echo rc=$?");
  check("stat -L -c refuses a dangling symbolic link, as GNU stat does on Linux", gr2.stdout === "rc=1\n" && gr2.stderr === "stat: cannot statx 'dl': No such file or directory\n", JSON.stringify([gr2.stdout, gr2.stderr]));
  const gr3 = await run(await shell({}), "mkdir d && echo a > d/a && ln -s d/a lk && chmod 000 d && stat -L -c \"%a %n\" lk; echo rc=$?");
  check("stat -L -c refuses a symbolic link whose target is in a directory without owner search, as GNU stat does on Linux", gr3.stdout === "rc=1\n" && gr3.stderr === "stat: cannot statx 'lk': Permission denied\n", JSON.stringify([gr3.stdout, gr3.stderr]));
  const gr4 = await run(await shell({}), "echo a > f && chmod 640 f && ln -s f lk && ln -s lk lk2 && stat -L -c \"%a %n\" lk2; echo rc=$?");
  check("stat -L -c follows a chain of symbolic links to its end, as GNU stat does on Linux", gr4.stdout === "640 lk2\nrc=0\n" && gr4.stderr === "", JSON.stringify([gr4.stdout, gr4.stderr]));
  const gr5 = await run(await shell({}), "mkdir sub && ln -s sub dl2 && stat -L -c \"%F %n\" dl2; echo rc=$?");
  check("stat -L -c reports the type of a symbolic link to a directory as directory, as GNU stat does on Linux", gr5.stdout === "directory dl2\nrc=0\n" && gr5.stderr === "", JSON.stringify([gr5.stdout, gr5.stderr]));
  const gr6 = await run(await shell({}), "echo a > f && chmod 600 f && ln -s f lk && stat -L -c \"%a %n\" f lk; echo rc=$?");
  check("stat -L -c reports a plain file and a link to it together, as GNU stat does on Linux", gr6.stdout === "600 f\n600 lk\nrc=0\n" && gr6.stderr === "", JSON.stringify([gr6.stdout, gr6.stderr]));
  const gr7 = await run(await shell({}), "echo a > f && ln -s f lk && stat -L -c \"%F %n\" lk; echo rc=$?");
  check("stat -L -c reports the type of a symbolic link to a regular file, as GNU stat does on Linux", gr7.stdout === "regular file lk\nrc=0\n" && gr7.stderr === "", JSON.stringify([gr7.stdout, gr7.stderr]));
});

group("stat -c %N: a plain or linked operand prints its quoted name, and a symbolic link adds its immediate target, as GNU stat does on Linux", async () => {
  const gr0 = await run(await shell({}), "echo a > f && stat -c \"%N\" f; echo rc=$?");
  check("stat -c %N prints the quoted name of a plain file, as GNU stat does on Linux", gr0.stdout === "'f'\nrc=0\n" && gr0.stderr === "", JSON.stringify([gr0.stdout, gr0.stderr]));
  const gr1 = await run(await shell({}), "echo a > f && ln -s f lk && stat -c \"%N\" lk; echo rc=$?");
  check("stat -c %N prints a file symbolic link with its immediate target, as GNU stat does on Linux", gr1.stdout === "'lk' -> 'f'\nrc=0\n" && gr1.stderr === "", JSON.stringify([gr1.stdout, gr1.stderr]));
  const gr2 = await run(await shell({}), "ln -s nope dl && stat -c \"%N\" dl; echo rc=$?");
  check("stat -c %N prints a dangling symbolic link with its target, as GNU stat does on Linux", gr2.stdout === "'dl' -> 'nope'\nrc=0\n" && gr2.stderr === "", JSON.stringify([gr2.stdout, gr2.stderr]));
  const gr3 = await run(await shell({}), "echo a > f && ln -s f lk && stat -L -c \"%N\" lk; echo rc=$?");
  check("stat -L -c %N prints only the quoted name of a followed symbolic link, as GNU stat does on Linux", gr3.stdout === "'lk'\nrc=0\n" && gr3.stderr === "", JSON.stringify([gr3.stdout, gr3.stderr]));
  const gr4 = await run(await shell({}), "mkdir sub && stat -c \"%N\" sub; echo rc=$?");
  check("stat -c %N prints the quoted name of a directory, as GNU stat does on Linux", gr4.stdout === "'sub'\nrc=0\n" && gr4.stderr === "", JSON.stringify([gr4.stdout, gr4.stderr]));
  const gr5 = await run(await shell({}), "echo a > f && ln -s f lk && ln -s lk lk2 && stat -c \"%N\" lk2; echo rc=$?");
  check("stat -c %N prints only the first hop of a chain of symbolic links, as GNU stat does on Linux", gr5.stdout === "'lk2' -> 'lk'\nrc=0\n" && gr5.stderr === "", JSON.stringify([gr5.stdout, gr5.stderr]));
  const gr6 = await run(await shell({}), "mkdir sub && ln -s sub dl2 && stat -c \"%N\" dl2; echo rc=$?");
  check("stat -c %N prints a symbolic link to a directory with its target, as GNU stat does on Linux", gr6.stdout === "'dl2' -> 'sub'\nrc=0\n" && gr6.stderr === "", JSON.stringify([gr6.stdout, gr6.stderr]));
  const gr7 = await run(await shell({}), "echo a > \"my f\" && ln -s \"my f\" \"my l\" && stat -c \"%N\" \"my l\"; echo rc=$?");
  check("stat -c %N quotes a name with a space, as GNU stat does on Linux", gr7.stdout === "'my l' -> 'my f'\nrc=0\n" && gr7.stderr === "", JSON.stringify([gr7.stdout, gr7.stderr]));
  const gr8 = await run(await shell({}), "mkdir d && echo a > d/f && ln -s f d/lk && stat -c \"%N\" d/lk; echo rc=$?");
  check("stat -c %N prints a link in a directory with its relative target, as GNU stat does on Linux", gr8.stdout === "'d/lk' -> 'f'\nrc=0\n" && gr8.stderr === "", JSON.stringify([gr8.stdout, gr8.stderr]));
  const gr9 = await run(await shell({}), "mkdir d && echo a > f && ln -s ../f d/lk && stat -c \"%N\" d/lk; echo rc=$?");
  check("stat -c %N prints a link whose target has a dot-dot unchanged, as GNU stat does on Linux", gr9.stdout === "'d/lk' -> '../f'\nrc=0\n" && gr9.stderr === "", JSON.stringify([gr9.stdout, gr9.stderr]));
  const gr10 = await run(await shell({}), "echo a > \"it's\" && stat -c \"%N\" \"it's\"; echo rc=$?");
  check("stat -c %N quotes a name with an apostrophe, as GNU stat does on Linux", gr10.stdout === "\"it's\"\nrc=0\n" && gr10.stderr === "", JSON.stringify([gr10.stdout, gr10.stderr]));
});

group("stat -c %N: a control character, a non-ASCII byte and a double quote are quoted as GNU stat quotes them in C locale", async () => {
  const gr0 = await run(await shell({}), "echo a > \"a\u0001b\" && stat -c \"%N\" \"a\u0001b\"; echo rc=$?");
  check("stat -c %N quotes a name with a soh control character in $-quoting, as GNU stat does on Linux", gr0.stdout === "'a'$'\\001''b'\nrc=0\n" && gr0.stderr === "", JSON.stringify([gr0.stdout, gr0.stderr]));
  const gr1 = await run(await shell({}), "echo a > \"a\tb\" && stat -c \"%N\" \"a\tb\"; echo rc=$?");
  check("stat -c %N quotes a name with a tab control character in $-quoting, as GNU stat does on Linux", gr1.stdout === "'a'$'\\t''b'\nrc=0\n" && gr1.stderr === "", JSON.stringify([gr1.stdout, gr1.stderr]));
  const gr2 = await run(await shell({}), "echo a > \"a\nb\" && stat -c \"%N\" \"a\nb\"; echo rc=$?");
  check("stat -c %N quotes a name with a newline control character in $-quoting, as GNU stat does on Linux", gr2.stdout === "'a'$'\\n''b'\nrc=0\n" && gr2.stderr === "", JSON.stringify([gr2.stdout, gr2.stderr]));
  const gr3 = await run(await shell({}), "echo a > \"a\u001fb\" && stat -c \"%N\" \"a\u001fb\"; echo rc=$?");
  check("stat -c %N quotes a name with a us control character in $-quoting, as GNU stat does on Linux", gr3.stdout === "'a'$'\\037''b'\nrc=0\n" && gr3.stderr === "", JSON.stringify([gr3.stdout, gr3.stderr]));
  const gr4 = await run(await shell({}), "echo a > \"a\u0007b\" && stat -c \"%N\" \"a\u0007b\"; echo rc=$?");
  check("stat -c %N quotes a name with a bel control character in $-quoting, as GNU stat does on Linux", gr4.stdout === "'a'$'\\a''b'\nrc=0\n" && gr4.stderr === "", JSON.stringify([gr4.stdout, gr4.stderr]));
  const gr5 = await run(await shell({}), "echo a > \"a\bb\" && stat -c \"%N\" \"a\bb\"; echo rc=$?");
  check("stat -c %N quotes a name with a bs control character in $-quoting, as GNU stat does on Linux", gr5.stdout === "'a'$'\\b''b'\nrc=0\n" && gr5.stderr === "", JSON.stringify([gr5.stdout, gr5.stderr]));
  const gr6 = await run(await shell({}), "echo a > \"a\fb\" && stat -c \"%N\" \"a\fb\"; echo rc=$?");
  check("stat -c %N quotes a name with a ff control character in $-quoting, as GNU stat does on Linux", gr6.stdout === "'a'$'\\f''b'\nrc=0\n" && gr6.stderr === "", JSON.stringify([gr6.stdout, gr6.stderr]));
  const gr7 = await run(await shell({}), "echo a > \"a\rb\" && stat -c \"%N\" \"a\rb\"; echo rc=$?");
  check("stat -c %N quotes a name with a cr control character in $-quoting, as GNU stat does on Linux", gr7.stdout === "'a'$'\\r''b'\nrc=0\n" && gr7.stderr === "", JSON.stringify([gr7.stdout, gr7.stderr]));
  const gr8 = await run(await shell({}), "echo a > \"a\u000bb\" && stat -c \"%N\" \"a\u000bb\"; echo rc=$?");
  check("stat -c %N quotes a name with a vt control character in $-quoting, as GNU stat does on Linux", gr8.stdout === "'a'$'\\v''b'\nrc=0\n" && gr8.stderr === "", JSON.stringify([gr8.stdout, gr8.stderr]));
  const gr9 = await run(await shell({}), "echo a > \"ab\" && stat -c \"%N\" \"ab\"; echo rc=$?");
  check("stat -c %N quotes a name with a del control character in $-quoting, as GNU stat does on Linux", gr9.stdout === "'a'$'\\177''b'\nrc=0\n" && gr9.stderr === "", JSON.stringify([gr9.stdout, gr9.stderr]));
  const gr10 = await run(await shell({}), "echo a > \"a\u001bb\" && stat -c \"%N\" \"a\u001bb\"; echo rc=$?");
  check("stat -c %N quotes a name with a esc control character in $-quoting, as GNU stat does on Linux", gr10.stdout === "'a'$'\\033''b'\nrc=0\n" && gr10.stderr === "", JSON.stringify([gr10.stdout, gr10.stderr]));
  const gr11 = await run(await shell({}), "echo a > \"café\" && stat -c \"%N\" \"café\"; echo rc=$?");
  check("stat -c %N escapes the bytes of a non-ASCII name in C locale, as GNU stat does on Linux", gr11.stdout === "'caf'$'\\303\\251'\nrc=0\n" && gr11.stderr === "", JSON.stringify([gr11.stdout, gr11.stderr]));
  const gr12 = await run(await shell({}), "echo a > \"x€\" && stat -c \"%N\" \"x€\"; echo rc=$?");
  check("stat -c %N escapes a three-byte character in C locale, as GNU stat does on Linux", gr12.stdout === "'x'$'\\342\\202\\254'\nrc=0\n" && gr12.stderr === "", JSON.stringify([gr12.stdout, gr12.stderr]));
  const gr13 = await run(await shell({}), "echo a > \"it's \\\"x\\\"\" && stat -c \"%N\" \"it's \\\"x\\\"\"; echo rc=$?");
  check("stat -c %N quotes a name with both an apostrophe and a double quote, as GNU stat does on Linux", gr13.stdout === "'it'\\''s \"x\"'\nrc=0\n" && gr13.stderr === "", JSON.stringify([gr13.stdout, gr13.stderr]));
  const gr14 = await run(await shell({}), "echo a > 'x\"y' && stat -c \"%N\" 'x\"y'; echo rc=$?");
  check("stat -c %N quotes a name with a double quote and no apostrophe, as GNU stat does on Linux", gr14.stdout === "'x\"y'\nrc=0\n" && gr14.stderr === "", JSON.stringify([gr14.stdout, gr14.stderr]));
});

group("stat -c %N: a name with a control character or a non-ASCII byte and a quote is quoted as GNU stat quotes it in C locale", async () => {
  const gr0 = await run(await shell({}), "echo a > \"it's\tx\" && stat -c \"%N\" \"it's\tx\"; echo rc=$?");
  check("stat -c %N quotes an apostrophe with a tab, as GNU stat does on Linux", gr0.stdout === "'it'\\''s'$'\\t''x'\nrc=0\n" && gr0.stderr === "", JSON.stringify([gr0.stdout, gr0.stderr]));
  const gr1 = await run(await shell({}), "echo a > 'x\"\ty' && stat -c \"%N\" 'x\"\ty'; echo rc=$?");
  check("stat -c %N quotes a double quote with a tab, as GNU stat does on Linux", gr1.stdout === "'x\"'$'\\t''y'\nrc=0\n" && gr1.stderr === "", JSON.stringify([gr1.stdout, gr1.stderr]));
  const gr2 = await run(await shell({}), "echo a > \"café's\" && stat -c \"%N\" \"café's\"; echo rc=$?");
  check("stat -c %N quotes an apostrophe with a non-ASCII character, as GNU stat does on Linux", gr2.stdout === "'caf'$'\\303\\251'\\''s'\nrc=0\n" && gr2.stderr === "", JSON.stringify([gr2.stdout, gr2.stderr]));
  const gr3 = await run(await shell({}), "echo a > \"it's \\\"é\\\"\" && stat -c \"%N\" \"it's \\\"é\\\"\"; echo rc=$?");
  check("stat -c %N quotes a name with both quote kinds and a non-ASCII character, as GNU stat does on Linux", gr3.stdout === "'it'\\''s \"'$'\\303\\251''\"'\nrc=0\n" && gr3.stderr === "", JSON.stringify([gr3.stdout, gr3.stderr]));
  const gr4 = await run(await shell({}), "echo a > 'x\"é' && stat -c \"%N\" 'x\"é'; echo rc=$?");
  check("stat -c %N quotes a double quote with a non-ASCII character, as GNU stat does on Linux", gr4.stdout === "'x\"'$'\\303\\251'\nrc=0\n" && gr4.stderr === "", JSON.stringify([gr4.stdout, gr4.stderr]));
  const gr5 = await run(await shell({}), "echo a > f && ln -s f \"l'\tk\" && stat -c \"%N\" \"l'\tk\"; echo rc=$?");
  check("stat -c %N quotes a symbolic link whose name has an apostrophe and a tab, as GNU stat does on Linux", gr5.stdout === "'l'\\'''$'\\t''k' -> 'f'\nrc=0\n" && gr5.stderr === "", JSON.stringify([gr5.stdout, gr5.stderr]));
  const gr6 = await run(await shell({}), "echo a > \"f'\tg\" && ln -s \"f'\tg\" lk && stat -c \"%N\" lk; echo rc=$?");
  check("stat -c %N quotes a symbolic link whose target has an apostrophe and a tab, as GNU stat does on Linux", gr6.stdout === "'lk' -> 'f'\\'''$'\\t''g'\nrc=0\n" && gr6.stderr === "", JSON.stringify([gr6.stdout, gr6.stderr]));
});

group("stat -c %N: a name that starts with an apostrophe before a control character is quoted as GNU stat quotes it in C locale", async () => {
  const gr0 = await run(await shell({}), "echo a > \"'\tx\" && stat -c \"%N\" \"'\tx\"; echo rc=$?");
  check("stat -c %N quotes a name that starts with an apostrophe before a tab, as GNU stat does on Linux", gr0.stdout === "''\\'''$'\\t''x'\nrc=0\n" && gr0.stderr === "", JSON.stringify([gr0.stdout, gr0.stderr]));
});

group("stat -c %N: a name that starts with a tab is quoted as GNU stat quotes it in C locale", async () => {
  const gr0 = await run(await shell({}), "echo a > \"\tx\" && stat -c \"%N\" \"\tx\"; echo rc=$?");
  check("stat -c %N quotes a name that starts with a tab, as GNU stat does on Linux", gr0.stdout === "''$'\\t''x'\nrc=0\n" && gr0.stderr === "", JSON.stringify([gr0.stdout, gr0.stderr]));
});

group("stat -c %N: a name with a non-ASCII byte and a control character or apostrophe, or a non-ASCII name alone, is quoted as GNU stat quotes it in C locale", async () => {
  const gr0 = await run(await shell({}), "echo a > \"é\" && stat -c \"%N\" \"é\"; echo rc=$?");
  check("stat -c %N quotes a name that is one non-ASCII character alone, as GNU stat does on Linux", gr0.stdout === "''$'\\303\\251'\nrc=0\n" && gr0.stderr === "", JSON.stringify([gr0.stdout, gr0.stderr]));
  const gr1 = await run(await shell({}), "echo a > \"éx\" && stat -c \"%N\" \"éx\"; echo rc=$?");
  check("stat -c %N quotes a name that starts with a non-ASCII character, as GNU stat does on Linux", gr1.stdout === "''$'\\303\\251''x'\nrc=0\n" && gr1.stderr === "", JSON.stringify([gr1.stdout, gr1.stderr]));
  const gr2 = await run(await shell({}), "echo a > \"é'x\" && stat -c \"%N\" \"é'x\"; echo rc=$?");
  check("stat -c %N quotes a non-ASCII character before an apostrophe, as GNU stat does on Linux", gr2.stdout === "''$'\\303\\251'\\''x'\nrc=0\n" && gr2.stderr === "", JSON.stringify([gr2.stdout, gr2.stderr]));
  const gr3 = await run(await shell({}), "echo a > \"é\tx\" && stat -c \"%N\" \"é\tx\"; echo rc=$?");
  check("stat -c %N quotes a non-ASCII character before a tab, as GNU stat does on Linux", gr3.stdout === "''$'\\303\\251\\t''x'\nrc=0\n" && gr3.stderr === "", JSON.stringify([gr3.stdout, gr3.stderr]));
  const gr4 = await run(await shell({}), "echo a > \"a\té\" && stat -c \"%N\" \"a\té\"; echo rc=$?");
  check("stat -c %N quotes a tab between a letter and a non-ASCII character, as GNU stat does on Linux", gr4.stdout === "'a'$'\\t\\303\\251'\nrc=0\n" && gr4.stderr === "", JSON.stringify([gr4.stdout, gr4.stderr]));
  const gr5 = await run(await shell({}), "echo a > \"it's\té\" && stat -c \"%N\" \"it's\té\"; echo rc=$?");
  check("stat -c %N quotes an apostrophe, a tab and a non-ASCII character, as GNU stat does on Linux", gr5.stdout === "'it'\\''s'$'\\t\\303\\251'\nrc=0\n" && gr5.stderr === "", JSON.stringify([gr5.stdout, gr5.stderr]));
  const gr6 = await run(await shell({}), "echo a > \"é'\té\" && stat -c \"%N\" \"é'\té\"; echo rc=$?");
  check("stat -c %N quotes an apostrophe, a non-ASCII character and a tab in that order, as GNU stat does on Linux", gr6.stdout === "''$'\\303\\251'\\'''$'\\t\\303\\251'\nrc=0\n" && gr6.stderr === "", JSON.stringify([gr6.stdout, gr6.stderr]));
});

group("stat -c %N: an apostrophe after a non-ASCII character, at the end of a name, is quoted as GNU stat quotes it in C locale", async () => {
  const gr0 = await run(await shell({}), "echo a > \"xé'\" && stat -c \"%N\" \"xé'\"; echo rc=$?");
  check("stat -c %N quotes an apostrophe after a non-ASCII character at the end of a name, as GNU stat does on Linux", gr0.stdout === "'x'$'\\303\\251'\\'''\nrc=0\n" && gr0.stderr === "", JSON.stringify([gr0.stdout, gr0.stderr]));
  const gr1 = await run(await shell({}), "echo a > \"é'\" && stat -c \"%N\" \"é'\"; echo rc=$?");
  check("stat -c %N quotes an apostrophe after a non-ASCII character alone, as GNU stat does on Linux", gr1.stdout === "''$'\\303\\251'\\'''\nrc=0\n" && gr1.stderr === "", JSON.stringify([gr1.stdout, gr1.stderr]));
});

group("expr: an equivalence class of a non-Latin letter matches the letters of its class, and a multi-character collating symbol is refused, as GNU expr does in a UTF-8 locale", async () => {
  const gr0 = await run(await shell({}), "expr 'α' : '[[=α=]]'; echo rc=$?");
  check("expr: an equivalence class of a Greek letter matches the letter itself, as GNU expr does in a UTF-8 locale", gr0.stdout === "1\nrc=0\n" && gr0.stderr === "", JSON.stringify([gr0.stdout, gr0.stderr]));
  const gr1 = await run(await shell({}), "expr 'ά' : '[[=α=]]'; echo rc=$?");
  check("expr: an equivalence class of a Greek letter matches its accented form, as GNU expr does in a UTF-8 locale", gr1.stdout === "1\nrc=0\n" && gr1.stderr === "", JSON.stringify([gr1.stdout, gr1.stderr]));
  const gr2 = await run(await shell({}), "expr 'β' : '[[=α=]]'; echo rc=$?");
  check("expr: an equivalence class of a Greek letter does not match another Greek letter, as GNU expr does in a UTF-8 locale", gr2.stdout === "0\nrc=1\n" && gr2.stderr === "", JSON.stringify([gr2.stdout, gr2.stderr]));
  const gr3 = await run(await shell({}), "expr 'ω' : '[[=Ω=]]'; echo rc=$?");
  check("expr: an equivalence class of a Greek capital matches the small letter, as GNU expr does in a UTF-8 locale", gr3.stdout === "1\nrc=0\n" && gr3.stderr === "", JSON.stringify([gr3.stdout, gr3.stderr]));
  const gr4 = await run(await shell({}), "expr 'й' : '[[=и=]]'; echo rc=$?");
  check("expr: an equivalence class of a Cyrillic letter does not match its breve form, as GNU expr does in a UTF-8 locale", gr4.stdout === "0\nrc=1\n" && gr4.stderr === "", JSON.stringify([gr4.stdout, gr4.stderr]));
  const gr5 = await run(await shell({}), "expr 'ё' : '[[=е=]]'; echo rc=$?");
  check("expr: an equivalence class of a Cyrillic letter matches the diaeresis form, as GNU expr does in a UTF-8 locale", gr5.stdout === "1\nrc=0\n" && gr5.stderr === "", JSON.stringify([gr5.stdout, gr5.stderr]));
  const gr6 = await run(await shell({}), "expr 'ab' : '[[.ab.]]'; echo rc=$?");
  check("expr: a multi-character collating symbol is refused, as GNU expr does in a UTF-8 locale", gr6.stdout === "rc=2\n" && gr6.stderr === "expr: Invalid collation character\n", JSON.stringify([gr6.stdout, gr6.stderr]));
  const gr7 = await run(await shell({}), "expr 'a' : '[[.a.]]'; echo rc=$?");
  check("expr: a collating symbol of one letter inside a bracket matches that letter, as GNU expr does in a UTF-8 locale", gr7.stdout === "1\nrc=0\n" && gr7.stderr === "", JSON.stringify([gr7.stdout, gr7.stderr]));
});

group("expr: a breve above a Latin letter matches its base letter, as GNU expr does in a UTF-8 locale", async () => {
  const gr0 = await run(await shell({}), "expr 'ă' : '[[=a=]]'; echo rc=$?");
  check("expr: a Latin letter with a breve matches its base letter's class, as GNU expr does in a UTF-8 locale", gr0.stdout === "1\nrc=0\n" && gr0.stderr === "", JSON.stringify([gr0.stdout, gr0.stderr]));
  const gr1 = await run(await shell({}), "expr 'ğ' : '[[=g=]]'; echo rc=$?");
  check("expr: a Latin g with a breve matches its base letter's class, as GNU expr does in a UTF-8 locale", gr1.stdout === "1\nrc=0\n" && gr1.stderr === "", JSON.stringify([gr1.stdout, gr1.stderr]));
});

group("expr: an equivalence class of a Greek letter with a psili or a dialytika matches the plain letter, and a Cyrillic letter with a breve matches its plain letter, as GNU expr does in a UTF-8 locale", async () => {
  const gr0 = await run(await shell({}), "expr 'ἀ' : '[[=α=]]'; echo rc=$?");
  check("expr: an equivalence class of a Greek letter with a psili matches the plain letter, as GNU expr does in a UTF-8 locale", gr0.stdout === "1\nrc=0\n" && gr0.stderr === "", JSON.stringify([gr0.stdout, gr0.stderr]));
  const gr1 = await run(await shell({}), "expr 'ἄ' : '[[=α=]]'; echo rc=$?");
  check("expr: an equivalence class of a Greek letter with a psili and an oxia matches the plain letter, as GNU expr does in a UTF-8 locale", gr1.stdout === "1\nrc=0\n" && gr1.stderr === "", JSON.stringify([gr1.stdout, gr1.stderr]));
  const gr2 = await run(await shell({}), "expr 'ϊ' : '[[=ι=]]'; echo rc=$?");
  check("expr: an equivalence class of a Greek iota with a dialytika matches the plain iota, as GNU expr does in a UTF-8 locale", gr2.stdout === "1\nrc=0\n" && gr2.stderr === "", JSON.stringify([gr2.stdout, gr2.stderr]));
  const gr3 = await run(await shell({}), "expr 'ў' : '[[=у=]]'; echo rc=$?");
  check("expr: a Cyrillic letter with a breve matches its plain base letter, as GNU expr does in a UTF-8 locale", gr3.stdout === "1\nrc=0\n" && gr3.stderr === "", JSON.stringify([gr3.stdout, gr3.stderr]));
  const gr4 = await run(await shell({}), "expr 'Ў' : '[[=ў=]]'; echo rc=$?");
  check("expr: a Cyrillic letter with a breve matches its own upper case, as GNU expr does in a UTF-8 locale", gr4.stdout === "1\nrc=0\n" && gr4.stderr === "", JSON.stringify([gr4.stdout, gr4.stderr]));
});

group("stat -c %N: runs of apostrophes next to a tab or a non-ASCII character are quoted as GNU stat quotes them in C locale", async () => {
  const gr0 = await run(await shell({}), "echo a > \"x''\ty\" && stat -c \"%N\" \"x''\ty\"; echo rc=$?");
  check("stat -c %N quotes two apostrophes before a tab, as GNU stat does on Linux", gr0.stdout === "'x'\\'''\\'''$'\\t''y'\nrc=0\n" && gr0.stderr === "", JSON.stringify([gr0.stdout, gr0.stderr]));
  const gr1 = await run(await shell({}), "echo a > \"x'''\ty\" && stat -c \"%N\" \"x'''\ty\"; echo rc=$?");
  check("stat -c %N quotes three apostrophes before a tab, as GNU stat does on Linux", gr1.stdout === "'x'\\'''\\'''\\'''$'\\t''y'\nrc=0\n" && gr1.stderr === "", JSON.stringify([gr1.stdout, gr1.stderr]));
  const gr2 = await run(await shell({}), "echo a > \"'\tx\t'\" && stat -c \"%N\" \"'\tx\t'\"; echo rc=$?");
  check("stat -c %N quotes an apostrophe between two tabs, as GNU stat does on Linux", gr2.stdout === "''\\'''$'\\t''x'$'\\t'\\'''\nrc=0\n" && gr2.stderr === "", JSON.stringify([gr2.stdout, gr2.stderr]));
  const gr3 = await run(await shell({}), "echo a > \"é''x\" && stat -c \"%N\" \"é''x\"; echo rc=$?");
  check("stat -c %N quotes two apostrophes after a non-ASCII character, as GNU stat does on Linux", gr3.stdout === "''$'\\303\\251'\\'''\\''x'\nrc=0\n" && gr3.stderr === "", JSON.stringify([gr3.stdout, gr3.stderr]));
  const gr4 = await run(await shell({}), "echo a > \"x\t'''\" && stat -c \"%N\" \"x\t'''\"; echo rc=$?");
  check("stat -c %N quotes three apostrophes after a tab, as GNU stat does on Linux", gr4.stdout === "'x'$'\\t'\\'''\\'''\\'''\nrc=0\n" && gr4.stderr === "", JSON.stringify([gr4.stdout, gr4.stderr]));
});

group('case: a newline may come before the first pattern, but a semicolon may not, as bash does', async () => {
  const cs0 = await run(await shell({}), "case a in ; a) echo x;; esac");
  check("case: a semicolon before the first pattern is a syntax error, as bash does", cs0.stdout === "" && cs0.stderr.startsWith("syntax error"), JSON.stringify([cs0.stdout, cs0.stderr]));
  const cs1 = await run(await shell({}), "case a in\na) echo x;; esac");
  check("case: a newline before the first pattern is allowed, as bash does", cs1.stdout === "x\n" && cs1.stderr === "", JSON.stringify([cs1.stdout, cs1.stderr]));
  const cs2 = await run(await shell({}), "case b in\n\na) echo 1;;\nb) echo 2;;\nesac");
  check("case: blank lines before the first pattern and between arms are allowed, as bash does", cs2.stdout === "2\n" && cs2.stderr === "", JSON.stringify([cs2.stdout, cs2.stderr]));
  const cs3 = await run(await shell({}), "case a in a) echo 1;; ; b) echo 2;; esac");
  check("case: a semicolon between arms is a syntax error, as bash does", cs3.stdout === "" && cs3.stderr.startsWith("syntax error"), JSON.stringify([cs3.stdout, cs3.stderr]));
});

group('quoting: a backslash-newline is removed inside double quotes and in an unquoted heredoc body, as bash does', async () => {
  const bq0 = await run(await shell({}), "echo \"a\\\nb\"");
  check("quoting: a backslash-newline inside double quotes joins the lines, as bash does", bq0.stdout === "ab\n" && bq0.stderr === "", JSON.stringify([bq0.stdout, bq0.stderr]));
  const bq1 = await run(await shell({}), "echo \"x\\\\\ny\"");
  check("quoting: a doubled backslash before a newline inside double quotes stays one backslash, as bash does", bq1.stdout === "x\\\ny\n" && bq1.stderr === "", JSON.stringify([bq1.stdout, bq1.stderr]));
  const bq2 = await run(await shell({}), "echo \"a\\q\\\nb\"");
  check("quoting: a backslash before a letter inside double quotes is kept, and a backslash-newline after it joins the lines, as bash does", bq2.stdout === "a\\qb\n" && bq2.stderr === "", JSON.stringify([bq2.stdout, bq2.stderr]));
  const bq3 = await run(await shell({}), "echo \"\\$x\\\ny\"");
  check("quoting: a backslash-newline after an escaped dollar joins the lines, as bash does", bq3.stdout === "$xy\n" && bq3.stderr === "", JSON.stringify([bq3.stdout, bq3.stderr]));
  const hd0 = await run(await shell({}), "cat <<E\na\\\nb\nE");
  check("quoting: a backslash-newline in an unquoted heredoc body joins the lines, as bash does", hd0.stdout === "ab\n" && hd0.stderr === "", JSON.stringify([hd0.stdout, hd0.stderr]));
  const hd1 = await run(await shell({}), "cat <<'E'\na\\\nb\nE");
  check("quoting: a backslash-newline in a quoted heredoc body is kept, as bash does", hd1.stdout === "a\\\nb\n" && hd1.stderr === "", JSON.stringify([hd1.stdout, hd1.stderr]));
  const sq = await run(await shell({}), "echo 'a\\\nb'");
  check("quoting: a backslash-newline inside single quotes is kept, as bash does", sq.stdout === "a\\\nb\n" && sq.stderr === "", JSON.stringify([sq.stdout, sq.stderr]));
});

group('quoting: a backslash-newline inside a command substitution in double quotes, and in a heredoc delimiter word, joins the lines, as bash does', async () => {
  const cs0 = await run(await shell({}), 'echo "$(echo a\\\nb)"');
  check('quoting: a backslash-newline inside a command substitution in double quotes joins the lines, as bash does', cs0.stdout === 'ab\n' && cs0.stderr === '', JSON.stringify([cs0.stdout, cs0.stderr]));
  const cs1 = await run(await shell({}), 'echo "$(echo "x\\\ny")"');
  check('quoting: a backslash-newline inside a quoted word of a command substitution joins the lines, as bash does', cs1.stdout === 'xy\n' && cs1.stderr === '', JSON.stringify([cs1.stdout, cs1.stderr]));
  const cs2 = await run(await shell({}), "echo \"$(printf '%s' x\\\ny)\"");
  check('quoting: a backslash-newline between words of a command substitution joins the lines, as bash does', cs2.stdout === 'xy\n' && cs2.stderr === '', JSON.stringify([cs2.stdout, cs2.stderr]));
  const cs3 = await run(await shell({}), 'cat <<E\\\nF\na\nEF');
  check('quoting: a backslash-newline in an unquoted heredoc delimiter word joins the lines, as bash does', cs3.stdout === 'a\n' && cs3.stderr === '', JSON.stringify([cs3.stdout, cs3.stderr]));
  const cs4 = await run(await shell({}), 'cat <<"E\\\nF"\na\\\nb\nEF');
  check('quoting: a backslash-newline in a double-quoted heredoc delimiter word leaves the body unchanged, as bash does', cs4.stdout === 'a\\\nb\n' && cs4.stderr === '', JSON.stringify([cs4.stdout, cs4.stderr]));
  const cs5 = await run(await shell({}), 'echo "$(cat <<E\np\\\nq\nE\n)"');
  check('quoting: a heredoc inside a command substitution in double quotes joins a backslash-newline, as bash does', cs5.stdout === 'pq\n' && cs5.stderr === '', JSON.stringify([cs5.stdout, cs5.stderr]));
  const cs6 = await run(await shell({}), 'echo "$(echo a\\\nb; echo "c\\\nd")"');
  check('quoting: two command substitutions in one word each join their own backslash-newlines, as bash does', cs6.stdout === 'ab\ncd\n' && cs6.stderr === '', JSON.stringify([cs6.stdout, cs6.stderr]));
});

group('arithmetic: a backslash-newline inside $(( )) is removed before the expression is read, as bash does', async () => {
  const ar0 = await run(await shell({}), 'echo $((1+\\\n2))');
  check('arithmetic: a backslash-newline between operands is removed, as bash does', ar0.stdout === '3\n' && ar0.stderr === '', JSON.stringify([ar0.stdout, ar0.stderr]));
  const ar1 = await run(await shell({}), 'echo $((1 \\\n+ 2))');
  check('arithmetic: a backslash-newline after an operand and a space is removed, as bash does', ar1.stdout === '3\n' && ar1.stderr === '', JSON.stringify([ar1.stdout, ar1.stderr]));
  const ar2 = await run(await shell({}), 'x=$((\\\n5*2)); echo $x');
  check('arithmetic: a backslash-newline right after the opening parentheses is removed, as bash does', ar2.stdout === '10\n' && ar2.stderr === '', JSON.stringify([ar2.stdout, ar2.stderr]));
  const ar3 = await run(await shell({}), 'echo $((2\\\n*3))');
  check('arithmetic: a backslash-newline before an operator is removed, as bash does', ar3.stdout === '6\n' && ar3.stderr === '', JSON.stringify([ar3.stdout, ar3.stderr]));
  const ar4 = await run(await shell({}), 'echo "$((4\\\n*5))"');
  check('arithmetic: a backslash-newline inside $(( )) within double quotes is removed, as bash does', ar4.stdout === '20\n' && ar4.stderr === '', JSON.stringify([ar4.stdout, ar4.stderr]));
  const ar5 = await run(await shell({}), 'echo $((\\\n7))');
  check('arithmetic: a backslash-newline before the only operand is removed, as bash does', ar5.stdout === '7\n' && ar5.stderr === '', JSON.stringify([ar5.stdout, ar5.stderr]));
  const ar6 = await run(await shell({}), 'echo $((1\\\\\n+2))');
  check('arithmetic: a doubled backslash before a newline is not removed, and the expression is a syntax error, as bash does', ar6.stdout === '' && ar6.stderr !== '', JSON.stringify([ar6.stdout, ar6.stderr]));
  const hd0 = await run(await shell({}), 'cat <<"E"\\\nF\na\\\nb\nEF');
  check('quoting: a backslash-newline after a closing quote in a heredoc delimiter word leaves the quoted body unchanged, as bash does', hd0.stdout === 'a\\\nb\n' && hd0.stderr === '', JSON.stringify([hd0.stdout, hd0.stderr]));
  const hd1 = await run(await shell({}), 'cat <<E"F"\\\nG\na\nEFG');
  check('quoting: a backslash-newline after an unquoted and a quoted part of a heredoc delimiter word joins the lines, as bash does', hd1.stdout === 'a\n' && hd1.stderr === '', JSON.stringify([hd1.stdout, hd1.stderr]));
});

group('heredoc: a backslash-newline inside $(( )) in an unquoted heredoc body is removed before the expression is read, as bash does', async () => {
  const hb0 = await run(await shell({}), 'cat <<E\n$((1+\\\n2))\nE');
  check('heredoc: a backslash-newline between operands of $(( )) in an unquoted heredoc body is removed, as bash does', hb0.stdout === '3\n' && hb0.stderr === '', JSON.stringify([hb0.stdout, hb0.stderr]));
  const hb1 = await run(await shell({}), "cat <<'E'\n$((1+\\\n2))\nE");
  check('heredoc: a backslash-newline inside $(( )) in a quoted heredoc body is kept, as bash does', hb1.stdout === '$((1+\\\n2))\n' && hb1.stderr === '', JSON.stringify([hb1.stdout, hb1.stderr]));
  const hb2 = await run(await shell({}), 'cat <<E\n$((\\\n5*2))\nE');
  check('heredoc: a backslash-newline right after the opening parentheses of $(( )) in a heredoc body is removed, as bash does', hb2.stdout === '10\n' && hb2.stderr === '', JSON.stringify([hb2.stdout, hb2.stderr]));
  const hb3 = await run(await shell({}), 'cat <<E\nx $((2\\\n*3)) y\nE');
  check('heredoc: a backslash-newline before an operator of $(( )) in a heredoc body is removed, as bash does', hb3.stdout === 'x 6 y\n' && hb3.stderr === '', JSON.stringify([hb3.stdout, hb3.stderr]));
  const hb4 = await run(await shell({}), 'echo "$(cat <<E\n$((4\\\n*5))\nE\n)"');
  check('heredoc: a heredoc body inside a command substitution in double quotes removes a backslash-newline in $(( )), as bash does', hb4.stdout === '20\n' && hb4.stderr === '', JSON.stringify([hb4.stdout, hb4.stderr]));
});

group('arithmetic command: (( ... )) sets status 0 for a non-zero value and 1 for zero, as bash does', async () => {
  const ac0 = await run(await shell({}), '(( 1 + 2 )); echo $?');
  check('arithmetic command: a non-zero value gives status 0, as bash does', ac0.stdout === '0\n' && ac0.stderr === '', JSON.stringify([ac0.stdout, ac0.stderr]));
  const ac1 = await run(await shell({}), '(( 1 + \\\n 2 )); echo $?');
  check('arithmetic command: a backslash-newline between operands is removed, as bash does', ac1.stdout === '0\n' && ac1.stderr === '', JSON.stringify([ac1.stdout, ac1.stderr]));
  const ac2 = await run(await shell({}), '(( 0 )); echo $?');
  check('arithmetic command: a zero value gives status 1, as bash does', ac2.stdout === '1\n' && ac2.stderr === '', JSON.stringify([ac2.stdout, ac2.stderr]));
  const ac3 = await run(await shell({}), '(( 0 \\\n)); echo $?');
  check('arithmetic command: a zero value followed by a backslash-newline gives status 1, as bash does', ac3.stdout === '1\n' && ac3.stderr === '', JSON.stringify([ac3.stdout, ac3.stderr]));
  const ac4 = await run(await shell({}), '((\\\n3*2)); echo $?');
  check('arithmetic command: a backslash-newline right after the opening parentheses is removed, as bash does', ac4.stdout === '0\n' && ac4.stderr === '', JSON.stringify([ac4.stdout, ac4.stderr]));
  const ac5 = await run(await shell({}), 'x=0; (( x = \\\n5 )); echo $x');
  check('arithmetic command: an assignment inside (( )) sets the variable, as bash does', ac5.stdout === '5\n' && ac5.stderr === '', JSON.stringify([ac5.stdout, ac5.stderr]));
  const ac6 = await run(await shell({}), '(( 1\\\\\n+2 )); echo $?');
  check('arithmetic command: a doubled backslash before a newline is a syntax error with status 1, as bash does', ac6.stdout === '1\n' && ac6.stderr !== '', JSON.stringify([ac6.stdout, ac6.stderr]));
  const ac7 = await run(await shell({}), '((echo a); echo b)');
  check('arithmetic command: a (( that does not close with )) is a nested subshell, as bash does', ac7.stdout === 'a\nb\n' && ac7.stderr === '', JSON.stringify([ac7.stdout, ac7.stderr]));
});

group('arithmetic command: += -= *= /= %= assign to a name, and ++ and -- change it before or after the value, as bash does', async () => {
  const cp0 = await run(await shell({}), 'x=5; (( x += 3 )); echo $? $x');
  check('arithmetic command: += adds the right side to the variable, as bash does', cp0.stdout === '0 8\n' && cp0.stderr === '', JSON.stringify([cp0.stdout, cp0.stderr]));
  const cp1 = await run(await shell({}), 'x=5; (( x -= 3 )); echo $? $x');
  check('arithmetic command: -= subtracts the right side from the variable, as bash does', cp1.stdout === '0 2\n' && cp1.stderr === '', JSON.stringify([cp1.stdout, cp1.stderr]));
  const cp2 = await run(await shell({}), 'x=5; (( x *= 3 )); echo $? $x');
  check('arithmetic command: *= multiplies the variable, as bash does', cp2.stdout === '0 15\n' && cp2.stderr === '', JSON.stringify([cp2.stdout, cp2.stderr]));
  const cp3 = await run(await shell({}), 'x=7; (( x /= 2 )); echo $? $x');
  check('arithmetic command: /= divides the variable and truncates, as bash does', cp3.stdout === '0 3\n' && cp3.stderr === '', JSON.stringify([cp3.stdout, cp3.stderr]));
  const cp4 = await run(await shell({}), 'x=7; (( x %= 4 )); echo $? $x');
  check('arithmetic command: %= keeps the remainder in the variable, as bash does', cp4.stdout === '0 3\n' && cp4.stderr === '', JSON.stringify([cp4.stdout, cp4.stderr]));
  const cp5 = await run(await shell({}), 'x=5; (( x++ )); echo $? $x');
  check('arithmetic command: a postfix ++ tests the old value and increments, as bash does', cp5.stdout === '0 6\n' && cp5.stderr === '', JSON.stringify([cp5.stdout, cp5.stderr]));
  const cp6 = await run(await shell({}), 'x=5; (( ++x )); echo $? $x');
  check('arithmetic command: a prefix ++ gives the new value, as bash does', cp6.stdout === '0 6\n' && cp6.stderr === '', JSON.stringify([cp6.stdout, cp6.stderr]));
  const cp7 = await run(await shell({}), 'x=0; (( x++ )); echo $? $x');
  check('arithmetic command: a postfix ++ whose old value is zero gives status 1, as bash does', cp7.stdout === '1 1\n' && cp7.stderr === '', JSON.stringify([cp7.stdout, cp7.stderr]));
  const cp8 = await run(await shell({}), 'x=5; (( x-- )); echo $? $x');
  check('arithmetic command: a postfix -- decrements the variable, as bash does', cp8.stdout === '0 4\n' && cp8.stderr === '', JSON.stringify([cp8.stdout, cp8.stderr]));
  const cp9 = await run(await shell({}), 'x=0; (( --x )); echo $? $x');
  check('arithmetic command: a prefix -- to zero gives -1 and status 0, as bash does', cp9.stdout === '0 -1\n' && cp9.stderr === '', JSON.stringify([cp9.stdout, cp9.stderr]));
  const cp10 = await run(await shell({}), 'x=5; (( y = x++ )); echo $? $x $y');
  check('arithmetic command: a postfix ++ on the right of = gives the old value, as bash does', cp10.stdout === '0 6 5\n' && cp10.stderr === '', JSON.stringify([cp10.stdout, cp10.stderr]));
  const cp11 = await run(await shell({}), 'x=5; (( x += 1 + 2 )); echo $? $x');
  check('arithmetic command: the right side of += is a whole expression, as bash does', cp11.stdout === '0 8\n' && cp11.stderr === '', JSON.stringify([cp11.stdout, cp11.stderr]));
  const cp12 = await run(await shell({}), 'x=0; (( x /= 0 )); echo $? $x');
  check('arithmetic command: a division by zero in a compound assignment gives status 1 and leaves the variable, as bash does', cp12.stdout === '1 0\n' && cp12.stderr !== '', JSON.stringify([cp12.stdout, cp12.stderr]));
  const cp13 = await run(await shell({}), '(( 1 += 2 )); echo $?');
  check('arithmetic command: an assignment to a number is an error with status 1, as bash does', cp13.stdout === '1\n' && cp13.stderr !== '', JSON.stringify([cp13.stdout, cp13.stderr]));
  const cp14 = await run(await shell({}), '(( y += 1 )); echo $? $y');
  check('arithmetic command: += on an unset name starts from zero, as bash does', cp14.stdout === '0 1\n' && cp14.stderr === '', JSON.stringify([cp14.stdout, cp14.stderr]));
});

group('arithmetic command: a redirection on (( )) is applied, as bash does', async () => {
  const rd0 = await run(await shell({}), '(( 1 )) >/dev/null; echo $?');
  check('arithmetic command: a stdout redirection to /dev/null leaves the status of a non-zero value, as bash does', rd0.stdout === '0\n' && rd0.stderr === '', JSON.stringify([rd0.stdout, rd0.stderr]));
  const rd1 = await run(await shell({}), '(( 0 )) >/dev/null; echo $?');
  check('arithmetic command: a stdout redirection to /dev/null leaves the status of zero, as bash does', rd1.stdout === '1\n' && rd1.stderr === '', JSON.stringify([rd1.stdout, rd1.stderr]));
  const rd2 = await run(await shell({}), '(( 1 / 0 )) 2>/dev/null; echo $?');
  check('arithmetic command: a stderr redirection to /dev/null hides the division-by-zero message, as bash does', rd2.stdout === '1\n' && rd2.stderr === '', JSON.stringify([rd2.stdout, rd2.stderr]));
  const rd4 = await run(await shell({}), '(( 1 )) 2>&1; echo $?');
  check('arithmetic command: a stderr redirection onto stdout is accepted, as bash does', rd4.stdout === '0\n' && rd4.stderr === '', JSON.stringify([rd4.stdout, rd4.stderr]));
  const rd3 = await run(await shell({}), '(( 1 / 0 )) >/dev/null; echo $?');
  check('arithmetic command: a stdout redirection leaves the division-by-zero message on stderr, as bash does', rd3.stdout === '1\n' && rd3.stderr !== '', JSON.stringify([rd3.stdout, rd3.stderr]));
  const rd5 = await run(await shell({}), '(( 1 / 0 )) 2>&1; echo $?');
  check('arithmetic command: a stderr redirection onto stdout puts the division-by-zero message on stdout, as bash does', rd5.stdout.includes('division') && rd5.stdout.endsWith('\n1\n') && rd5.stderr === '', JSON.stringify([rd5.stdout, rd5.stderr]));
});

group('pipes and continuations: a newline after | and a continuation between assignments follow bash', async () => {
  const pn0 = await run(await shell({}), 'echo a |\necho $LINENO');
  check('pipes: a newline after | continues the pipeline, and LINENO is the line of the next command, as bash does', pn0.stdout === '2\n' && pn0.stderr === '', JSON.stringify([pn0.stdout, pn0.stderr]));
  const pn1 = await run(await shell({}), 'echo a |\n\necho $LINENO');
  check('pipes: blank lines after | still continue the pipeline, as bash does', pn1.stdout === '3\n' && pn1.stderr === '', JSON.stringify([pn1.stdout, pn1.stderr]));
  const pn2 = await run(await shell({}), 'x=1 \\\n y=2; echo $y');
  check('assignments: a continuation between two assignments leaves both as assignments, as bash does', pn2.stdout === '2\n' && pn2.stderr === '', JSON.stringify([pn2.stdout, pn2.stderr]));
  const pn3 = await run(await shell({}), 'x=1 \\\n y=$LINENO; echo $y');
  check('assignments: LINENO after a continuation between two assignments is the first line, as bash does', pn3.stdout === '1\n' && pn3.stderr === '', JSON.stringify([pn3.stdout, pn3.stderr]));
  const pn4 = await run(await shell({}), 'echo a \\\n b');
  check('words: a continuation between two words gives one space between them, as bash does', pn4.stdout === 'a b\n' && pn4.stderr === '', JSON.stringify([pn4.stdout, pn4.stderr]));
});
group('expr: an equivalence class matches the compatibility forms of its letter, as GNU expr does in a UTF-8 locale', async () => {
  const cp0 = await run(await shell({}), "expr '\u{249c}' : '[[=a=]]'; echo rc=$?");
  check('expr: an equivalence class [=a=] matches a parenthesised a (U+249C)', cp0.stdout === "1\nrc=0\n" && cp0.stderr === "", JSON.stringify([cp0.stdout, cp0.stderr]));
  const cp1 = await run(await shell({}), "expr '\u{1f110}' : '[[=a=]]'; echo rc=$?");
  check('expr: an equivalence class [=a=] matches a parenthesised capital A (U+1F110)', cp1.stdout === "1\nrc=0\n" && cp1.stderr === "", JSON.stringify([cp1.stdout, cp1.stderr]));
  const cp2 = await run(await shell({}), "expr '\u{aa}' : '[[=a=]]'; echo rc=$?");
  check('expr: an equivalence class [=a=] matches feminine ordinal a (U+00AA)', cp2.stdout === "1\nrc=0\n" && cp2.stderr === "", JSON.stringify([cp2.stdout, cp2.stderr]));
  const cp3 = await run(await shell({}), "expr '\u{ff41}' : '[[=a=]]'; echo rc=$?");
  check('expr: an equivalence class [=a=] matches fullwidth a (U+FF41)', cp3.stdout === "1\nrc=0\n" && cp3.stderr === "", JSON.stringify([cp3.stdout, cp3.stderr]));
  const cp4 = await run(await shell({}), "expr '\u{1d41a}' : '[[=a=]]'; echo rc=$?");
  check('expr: an equivalence class [=a=] matches bold a (U+1D41A)', cp4.stdout === "1\nrc=0\n" && cp4.stderr === "", JSON.stringify([cp4.stdout, cp4.stderr]));
  const cp5 = await run(await shell({}), "expr '\u{1f150}' : '[[=a=]]'; echo rc=$?");
  check('expr: an equivalence class [=a=] matches negative circled a (U+1F150), which has no decomposition', cp5.stdout === "1\nrc=0\n" && cp5.stderr === "", JSON.stringify([cp5.stdout, cp5.stderr]));
  const cp6 = await run(await shell({}), "expr '\u{1f170}' : '[[=a=]]'; echo rc=$?");
  check('expr: an equivalence class [=a=] matches negative squared a (U+1F170), which has no decomposition', cp6.stdout === "1\nrc=0\n" && cp6.stderr === "", JSON.stringify([cp6.stdout, cp6.stderr]));
  const cp7 = await run(await shell({}), "expr '\u{1d79}' : '[[=g=]]'; echo rc=$?");
  check('expr: an equivalence class [=g=] matches insular g (U+1D79), which has no decomposition', cp7.stdout === "1\nrc=0\n" && cp7.stderr === "", JSON.stringify([cp7.stdout, cp7.stderr]));
  const cp8 = await run(await shell({}), "expr '\u{1f18a}' : '[[=p=]]'; echo rc=$?");
  check('expr: an equivalence class [=p=] matches crossed negative squared p (U+1F18A), which has no decomposition', cp8.stdout === "1\nrc=0\n" && cp8.stderr === "", JSON.stringify([cp8.stdout, cp8.stderr]));
  const cp9 = await run(await shell({}), "expr '\u{2071}' : '[[=i=]]'; echo rc=$?");
  check('expr: an equivalence class [=i=] matches superscript i (U+2071)', cp9.stdout === "1\nrc=0\n" && cp9.stderr === "", JSON.stringify([cp9.stdout, cp9.stderr]));
  const cp10 = await run(await shell({}), "expr '\u{1f12d}' : '[[=c=]]'; echo rc=$?");
  check('expr: an equivalence class [=c=] matches a two-letter compatibility glyph (U+1F12D) does not match one letter', cp10.stdout === "0\nrc=1\n" && cp10.stderr === "", JSON.stringify([cp10.stdout, cp10.stderr]));
  const cp11 = await run(await shell({}), "expr '\u{251}' : '[[=a=]]'; echo rc=$?");
  check('expr: an equivalence class [=a=] matches latin small alpha (U+0251) does not match a', cp11.stdout === "0\nrc=1\n" && cp11.stderr === "", JSON.stringify([cp11.stdout, cp11.stderr]));
  const cp12 = await run(await shell({}), "expr '\u{1f12a}' : '[[=s=]]'; echo rc=$?");
  check('expr: an equivalence class [=s=] matches a tortoise-shell bracketed S (U+1F12A), as GNU expr does in a UTF-8 locale', cp12.stdout === "1\nrc=0\n" && cp12.stderr === "", JSON.stringify([cp12.stdout, cp12.stderr]));
});
group('realpath: -s keeps the path lexical, -P resolves links again (the last of -s and -P wins), and a missing component is an error only where GNU realpath gives one', async () => {
  const sh = await shell({});
  await run(sh, "echo x > tgt.txt; ln -s tgt.txt lk; ln -s nosuch dl; mkdir sub; mkdir sub/deep; ln -s /workspace/tgt.txt al; ln -s sub dirlink; ln -s sub/deep dl2");
  const rp0 = await run(sh, "realpath -s lk; echo rc=$?");
  check("realpath: realpath -s lk matches GNU realpath", rp0.stdout === "/workspace/lk\nrc=0\n" && rp0.stderr === "", JSON.stringify([rp0.stdout, rp0.stderr]));
  const rp1 = await run(sh, "realpath -s al; echo rc=$?");
  check("realpath: realpath -s al matches GNU realpath", rp1.stdout === "/workspace/al\nrc=0\n" && rp1.stderr === "", JSON.stringify([rp1.stdout, rp1.stderr]));
  const rp2 = await run(sh, "realpath -s dirlink/../tgt.txt; echo rc=$?");
  check("realpath: realpath -s dirlink/../tgt.txt matches GNU realpath", rp2.stdout === "/workspace/tgt.txt\nrc=0\n" && rp2.stderr === "", JSON.stringify([rp2.stdout, rp2.stderr]));
  const rp3 = await run(sh, "realpath -s sub/../tgt.txt; echo rc=$?");
  check("realpath: realpath -s sub/../tgt.txt matches GNU realpath", rp3.stdout === "/workspace/tgt.txt\nrc=0\n" && rp3.stderr === "", JSON.stringify([rp3.stdout, rp3.stderr]));
  const rp4 = await run(sh, "realpath -s .; echo rc=$?");
  check("realpath: realpath -s . matches GNU realpath", rp4.stdout === "/workspace\nrc=0\n" && rp4.stderr === "", JSON.stringify([rp4.stdout, rp4.stderr]));
  const rp5 = await run(sh, "realpath -s lk dl; echo rc=$?");
  check("realpath: realpath -s lk dl matches GNU realpath", rp5.stdout === "/workspace/lk\n/workspace/dl\nrc=0\n" && rp5.stderr === "", JSON.stringify([rp5.stdout, rp5.stderr]));
  const rp6 = await run(sh, "realpath -s dl2/..; echo rc=$?");
  check("realpath: realpath -s dl2/.. matches GNU realpath", rp6.stdout === "/workspace\nrc=0\n" && rp6.stderr === "", JSON.stringify([rp6.stdout, rp6.stderr]));
  const rp7 = await run(sh, "realpath -s dl2/../..; echo rc=$?");
  check("realpath: realpath -s dl2/../.. matches GNU realpath", rp7.stdout === "/\nrc=0\n" && rp7.stderr === "", JSON.stringify([rp7.stdout, rp7.stderr]));
  const rp8 = await run(sh, "realpath -s nosuch; echo rc=$?");
  check("realpath: realpath -s nosuch matches GNU realpath", rp8.stdout === "/workspace/nosuch\nrc=0\n" && rp8.stderr === "", JSON.stringify([rp8.stdout, rp8.stderr]));
  const rp9 = await run(sh, "realpath -s nosuch/x; echo rc=$?");
  check("realpath: realpath -s nosuch/x matches GNU realpath", rp9.stdout === "/workspace/nosuch/x\nrc=0\n" && rp9.stderr === "", JSON.stringify([rp9.stdout, rp9.stderr]));
  const rp10 = await run(sh, "realpath -s nosuchdir/../x; echo rc=$?");
  check("realpath: realpath -s nosuchdir/../x matches GNU realpath", rp10.stdout === "rc=1\n" && rp10.stderr === "realpath: nosuchdir/../x: No such file or directory\n", JSON.stringify([rp10.stdout, rp10.stderr]));
  const rp11 = await run(sh, "realpath -s dl; echo rc=$?");
  check("realpath: realpath -s dl matches GNU realpath", rp11.stdout === "/workspace/dl\nrc=0\n" && rp11.stderr === "", JSON.stringify([rp11.stdout, rp11.stderr]));
  const rp12 = await run(sh, "realpath -s -e dl; echo rc=$?");
  check("realpath: realpath -s -e dl matches GNU realpath", rp12.stdout === "rc=1\n" && rp12.stderr === "realpath: dl: No such file or directory\n", JSON.stringify([rp12.stdout, rp12.stderr]));
  const rp13 = await run(sh, "realpath -s -e nosuch/x; echo rc=$?");
  check("realpath: realpath -s -e nosuch/x matches GNU realpath", rp13.stdout === "rc=1\n" && rp13.stderr === "realpath: nosuch/x: No such file or directory\n", JSON.stringify([rp13.stdout, rp13.stderr]));
  const rp14 = await run(sh, "realpath -s tgt.txt/x; echo rc=$?");
  check("realpath: realpath -s tgt.txt/x matches GNU realpath", rp14.stdout === "rc=1\n" && rp14.stderr === "realpath: tgt.txt/x: Not a directory\n", JSON.stringify([rp14.stdout, rp14.stderr]));
  const rp15 = await run(sh, "realpath -s tgt.txt/..; echo rc=$?");
  check("realpath: realpath -s tgt.txt/.. matches GNU realpath", rp15.stdout === "rc=1\n" && rp15.stderr === "realpath: tgt.txt/..: Not a directory\n", JSON.stringify([rp15.stdout, rp15.stderr]));
  const rp16 = await run(sh, "realpath -s -e sub; echo rc=$?");
  check("realpath: realpath -s -e sub matches GNU realpath", rp16.stdout === "/workspace/sub\nrc=0\n" && rp16.stderr === "", JSON.stringify([rp16.stdout, rp16.stderr]));
  const rp17 = await run(sh, "realpath -s ./lk; echo rc=$?");
  check("realpath: realpath -s ./lk matches GNU realpath", rp17.stdout === "/workspace/lk\nrc=0\n" && rp17.stderr === "", JSON.stringify([rp17.stdout, rp17.stderr]));
  const rp18 = await run(sh, "realpath -s -P lk; echo rc=$?");
  check("realpath: realpath -s -P lk matches GNU realpath", rp18.stdout === "/workspace/tgt.txt\nrc=0\n" && rp18.stderr === "", JSON.stringify([rp18.stdout, rp18.stderr]));
  const rp19 = await run(sh, "realpath -P -s lk; echo rc=$?");
  check("realpath: realpath -P -s lk matches GNU realpath", rp19.stdout === "/workspace/lk\nrc=0\n" && rp19.stderr === "", JSON.stringify([rp19.stdout, rp19.stderr]));
  const rp20 = await run(sh, "realpath -s -P dl2/..; echo rc=$?");
  check("realpath: realpath -s -P dl2/.. matches GNU realpath", rp20.stdout === "/workspace/sub\nrc=0\n" && rp20.stderr === "", JSON.stringify([rp20.stdout, rp20.stderr]));
  const rp21 = await run(sh, "realpath dl2/..; echo rc=$?");
  check("realpath: realpath dl2/.. matches GNU realpath", rp21.stdout === "/workspace/sub\nrc=0\n" && rp21.stderr === "", JSON.stringify([rp21.stdout, rp21.stderr]));
  const rp22 = await run(sh, "realpath dl; echo rc=$?");
  check("realpath: realpath dl matches GNU realpath", rp22.stdout === "/workspace/nosuch\nrc=0\n" && rp22.stderr === "", JSON.stringify([rp22.stdout, rp22.stderr]));
  const rp23 = await run(sh, "realpath nosuch; echo rc=$?");
  check("realpath: realpath nosuch matches GNU realpath", rp23.stdout === "/workspace/nosuch\nrc=0\n" && rp23.stderr === "", JSON.stringify([rp23.stdout, rp23.stderr]));
  const rp24 = await run(sh, "realpath nosuch/x; echo rc=$?");
  check("realpath: realpath nosuch/x matches GNU realpath", rp24.stdout === "rc=1\n" && rp24.stderr === "realpath: nosuch/x: No such file or directory\n", JSON.stringify([rp24.stdout, rp24.stderr]));
  const rp25 = await run(sh, "realpath tgt.txt/..; echo rc=$?");
  check("realpath: realpath tgt.txt/.. matches GNU realpath", rp25.stdout === "rc=1\n" && rp25.stderr === "realpath: tgt.txt/..: Not a directory\n", JSON.stringify([rp25.stdout, rp25.stderr]));
  const rp26 = await run(sh, "realpath -e dl; echo rc=$?");
  check("realpath: realpath -e dl matches GNU realpath", rp26.stdout === "rc=1\n" && rp26.stderr === "realpath: dl: No such file or directory\n", JSON.stringify([rp26.stdout, rp26.stderr]));
  const rp27 = await run(sh, "realpath -e lk; echo rc=$?");
  check("realpath: realpath -e lk matches GNU realpath", rp27.stdout === "/workspace/tgt.txt\nrc=0\n" && rp27.stderr === "", JSON.stringify([rp27.stdout, rp27.stderr]));
  const rp28 = await run(sh, "realpath dirlink/..; echo rc=$?");
  check("realpath: realpath dirlink/.. matches GNU realpath", rp28.stdout === "/workspace\nrc=0\n" && rp28.stderr === "", JSON.stringify([rp28.stdout, rp28.stderr]));
});
group('realpath: -m allows missing components with no check, and the last of -e and -m wins, as GNU realpath does', async () => {
  const sh = await shell({});
  await run(sh, "echo x > tgt.txt; ln -s tgt.txt lk; ln -s nosuch dl; mkdir sub; mkdir sub/deep; ln -s /workspace/tgt.txt al; ln -s sub dirlink; ln -s sub/deep dl2");
  const rm0 = await run(sh, "realpath -m nosuch/x; echo rc=$?");
  check("realpath: realpath -m nosuch/x matches GNU realpath", rm0.stdout === "/workspace/nosuch/x\nrc=0\n" && rm0.stderr === "", JSON.stringify([rm0.stdout, rm0.stderr]));
  const rm1 = await run(sh, "realpath -m a/b/c; echo rc=$?");
  check("realpath: realpath -m a/b/c matches GNU realpath", rm1.stdout === "/workspace/a/b/c\nrc=0\n" && rm1.stderr === "", JSON.stringify([rm1.stdout, rm1.stderr]));
  const rm2 = await run(sh, "realpath -m dl; echo rc=$?");
  check("realpath: realpath -m dl matches GNU realpath", rm2.stdout === "/workspace/nosuch\nrc=0\n" && rm2.stderr === "", JSON.stringify([rm2.stdout, rm2.stderr]));
  const rm3 = await run(sh, "realpath -m lk; echo rc=$?");
  check("realpath: realpath -m lk matches GNU realpath", rm3.stdout === "/workspace/tgt.txt\nrc=0\n" && rm3.stderr === "", JSON.stringify([rm3.stdout, rm3.stderr]));
  const rm4 = await run(sh, "realpath -s -m nosuch/../z; echo rc=$?");
  check("realpath: realpath -s -m nosuch/../z matches GNU realpath", rm4.stdout === "/workspace/z\nrc=0\n" && rm4.stderr === "", JSON.stringify([rm4.stdout, rm4.stderr]));
  const rm5 = await run(sh, "realpath -m tgt.txt/x; echo rc=$?");
  check("realpath: realpath -m tgt.txt/x matches GNU realpath", rm5.stdout === "/workspace/tgt.txt/x\nrc=0\n" && rm5.stderr === "", JSON.stringify([rm5.stdout, rm5.stderr]));
  const rm6 = await run(sh, "realpath -m tgt.txt/..; echo rc=$?");
  check("realpath: realpath -m tgt.txt/.. matches GNU realpath", rm6.stdout === "/workspace\nrc=0\n" && rm6.stderr === "", JSON.stringify([rm6.stdout, rm6.stderr]));
  const rm7 = await run(sh, "realpath -m dl2/..; echo rc=$?");
  check("realpath: realpath -m dl2/.. matches GNU realpath", rm7.stdout === "/workspace/sub\nrc=0\n" && rm7.stderr === "", JSON.stringify([rm7.stdout, rm7.stderr]));
  const rm8 = await run(sh, "realpath -m lk/..; echo rc=$?");
  check("realpath: realpath -m lk/.. matches GNU realpath", rm8.stdout === "/workspace\nrc=0\n" && rm8.stderr === "", JSON.stringify([rm8.stdout, rm8.stderr]));
  const rm9 = await run(sh, "realpath -m nosuch/..; echo rc=$?");
  check("realpath: realpath -m nosuch/.. matches GNU realpath", rm9.stdout === "/workspace\nrc=0\n" && rm9.stderr === "", JSON.stringify([rm9.stdout, rm9.stderr]));
  const rm10 = await run(sh, "realpath -m -e tgt.txt; echo rc=$?");
  check("realpath: realpath -m -e tgt.txt matches GNU realpath", rm10.stdout === "/workspace/tgt.txt\nrc=0\n" && rm10.stderr === "", JSON.stringify([rm10.stdout, rm10.stderr]));
  const rm11 = await run(sh, "realpath -m -e nosuch; echo rc=$?");
  check("realpath: realpath -m -e nosuch matches GNU realpath", rm11.stdout === "rc=1\n" && rm11.stderr === "realpath: nosuch: No such file or directory\n", JSON.stringify([rm11.stdout, rm11.stderr]));
  const rm12 = await run(sh, "realpath -e -m nosuch; echo rc=$?");
  check("realpath: realpath -e -m nosuch matches GNU realpath", rm12.stdout === "/workspace/nosuch\nrc=0\n" && rm12.stderr === "", JSON.stringify([rm12.stdout, rm12.stderr]));
  const rm13 = await run(sh, "realpath -m /nonexistent/a; echo rc=$?");
  check("realpath: realpath -m /nonexistent/a matches GNU realpath", rm13.stdout === "/nonexistent/a\nrc=0\n" && rm13.stderr === "", JSON.stringify([rm13.stdout, rm13.stderr]));
  const rm14 = await run(sh, "realpath -m -s dl2/../..; echo rc=$?");
  check("realpath: realpath -m -s dl2/../.. matches GNU realpath", rm14.stdout === "/\nrc=0\n" && rm14.stderr === "", JSON.stringify([rm14.stdout, rm14.stderr]));
  const rm15 = await run(sh, "realpath -m -s tgt.txt/..; echo rc=$?");
  check("realpath: realpath -m -s tgt.txt/.. matches GNU realpath", rm15.stdout === "/workspace\nrc=0\n" && rm15.stderr === "", JSON.stringify([rm15.stdout, rm15.stderr]));
  const rm16 = await run(sh, "realpath -m -e dl2/x; echo rc=$?");
  check("realpath: realpath -m -e dl2/x matches GNU realpath", rm16.stdout === "rc=1\n" && rm16.stderr === "realpath: dl2/x: No such file or directory\n", JSON.stringify([rm16.stdout, rm16.stderr]));
  const rm17 = await run(sh, "realpath -m sub/deep/../../tgt.txt; echo rc=$?");
  check("realpath: realpath -m sub/deep/../../tgt.txt matches GNU realpath", rm17.stdout === "/workspace/tgt.txt\nrc=0\n" && rm17.stderr === "", JSON.stringify([rm17.stdout, rm17.stderr]));
  const rm18 = await run(sh, "realpath -m -e dl; echo rc=$?");
  check("realpath: realpath -m -e dl matches GNU realpath", rm18.stdout === "rc=1\n" && rm18.stderr === "realpath: dl: No such file or directory\n", JSON.stringify([rm18.stdout, rm18.stderr]));
  const rm19 = await run(sh, "realpath -m nosuch/../../..; echo rc=$?");
  check("realpath: realpath -m nosuch/../../.. matches GNU realpath", rm19.stdout === "/\nrc=0\n" && rm19.stderr === "", JSON.stringify([rm19.stdout, rm19.stderr]));
});
group("LINENO: a command after a backslash continuation, a comment, or in a multi-line compound body numbers its line as bash does", async () => {
  const gr0 = await run(await shell({}), "echo a \\\necho $LINENO");
  check("LINENO after a backslash-newline continuation numbers the command by its first line, as bash does", gr0.stdout === "a echo 1\n" && gr0.stderr === "", JSON.stringify([gr0.stdout, gr0.stderr]));
  const gr1 = await run(await shell({}), "f() {\necho $LINENO\n}\nf");
  check("LINENO in a function body defined over several lines numbers the body line, as bash does", gr1.stdout === "2\n" && gr1.stderr === "", JSON.stringify([gr1.stdout, gr1.stderr]));
  const gr2 = await run(await shell({}), "for i in 1 2; do\necho $LINENO\ndone");
  check("LINENO in a for body over several lines numbers the body line, as bash does", gr2.stdout === "2\n2\n" && gr2.stderr === "", JSON.stringify([gr2.stdout, gr2.stderr]));
  const gr3 = await run(await shell({}), "cat <<E\na\n$LINENO\nE");
  check("LINENO in a heredoc body numbers the body line, as bash does", gr3.stdout === "a\n1\n" && gr3.stderr === "", JSON.stringify([gr3.stdout, gr3.stderr]));
  const gr4 = await run(await shell({}), "case a in\na) echo $LINENO;;\nesac");
  check("LINENO in a case arm over several lines numbers the arm line, as bash does", gr4.stdout === "2\n" && gr4.stderr === "", JSON.stringify([gr4.stdout, gr4.stderr]));
  const gr5 = await run(await shell({}), "# c\necho $LINENO");
  check("LINENO after a comment line numbers the command line, as bash does", gr5.stdout === "2\n" && gr5.stderr === "", JSON.stringify([gr5.stdout, gr5.stderr]));
  const gr6 = await run(await shell({}), "if true\nthen\necho $LINENO\nfi");
  check("LINENO in an if body over several lines numbers the body line, as bash does", gr6.stdout === "3\n" && gr6.stderr === "", JSON.stringify([gr6.stdout, gr6.stderr]));
  const gr7 = await run(await shell({}), "while echo $LINENO\ndo\nbreak\ndone");
  check("LINENO in a while condition over several lines numbers the condition line, as bash does", gr7.stdout === "1\n" && gr7.stderr === "", JSON.stringify([gr7.stdout, gr7.stderr]));
});

group('chmod -R: a recursive chmod matches GNU chmod on a tree, and its errors match', async () => {
  const cr0 = await run(await shell({}), "mkdir -p /cm/t/a/sub/deep && echo x > /cm/t/a/f1 && echo y > /cm/t/a/sub/f2 && echo z > /cm/t/a/sub/deep/f3 && ln -s f1 /cm/t/a/link && chmod 600 /cm/t/a/f1 /cm/t/a/sub/f2 /cm/t/a/sub/deep/f3 && chmod 700 /cm/t/a /cm/t/a/sub /cm/t/a/sub/deep; chmod -R 750 /cm/t/a; for p in /cm/t/a /cm/t/a/f1 /cm/t/a/sub /cm/t/a/sub/f2 /cm/t/a/sub/deep /cm/t/a/sub/deep/f3 /cm/t/a/link; do stat -c %a $p; done");
  check("chmod -R 750 sets every entry, and a symlink keeps its own mode", cr0.stdout === "750\n750\n750\n750\n750\n750\n777\n" && cr0.stderr === "", JSON.stringify([cr0.stdout, cr0.stderr]));
  const cr1 = await run(await shell({}), "mkdir -p /cm/t/a/sub/deep && echo x > /cm/t/a/f1 && echo y > /cm/t/a/sub/f2 && echo z > /cm/t/a/sub/deep/f3 && ln -s f1 /cm/t/a/link && chmod 600 /cm/t/a/f1 /cm/t/a/sub/f2 /cm/t/a/sub/deep/f3 && chmod 700 /cm/t/a /cm/t/a/sub /cm/t/a/sub/deep; chmod -R u+x,go-w /cm/t/a; for p in /cm/t/a /cm/t/a/f1 /cm/t/a/sub /cm/t/a/sub/f2 /cm/t/a/sub/deep /cm/t/a/sub/deep/f3 /cm/t/a/link; do stat -c %a $p; done");
  check("chmod -R with a symbolic mode applies it to each entry on its own", cr1.stdout === "700\n700\n700\n700\n700\n700\n777\n" && cr1.stderr === "", JSON.stringify([cr1.stdout, cr1.stderr]));
  const cr2 = await run(await shell({}), "mkdir -p /cm/t/a/sub/deep && echo x > /cm/t/a/f1 && echo y > /cm/t/a/sub/f2 && echo z > /cm/t/a/sub/deep/f3 && ln -s f1 /cm/t/a/link && chmod 600 /cm/t/a/f1 /cm/t/a/sub/f2 /cm/t/a/sub/deep/f3 && chmod 700 /cm/t/a /cm/t/a/sub /cm/t/a/sub/deep; chmod 750 -R /cm/t/a; for p in /cm/t/a /cm/t/a/f1 /cm/t/a/sub /cm/t/a/sub/f2 /cm/t/a/sub/deep /cm/t/a/sub/deep/f3 /cm/t/a/link; do stat -c %a $p; done");
  check("chmod takes -R after the mode, as GNU chmod does", cr2.stdout === "750\n750\n750\n750\n750\n750\n777\n" && cr2.stderr === "", JSON.stringify([cr2.stdout, cr2.stderr]));
  const cr3 = await run(await shell({}), "mkdir -p /cm/t/a/sub/deep && echo x > /cm/t/a/f1 && echo y > /cm/t/a/sub/f2 && echo z > /cm/t/a/sub/deep/f3 && ln -s f1 /cm/t/a/link && chmod 600 /cm/t/a/f1 /cm/t/a/sub/f2 /cm/t/a/sub/deep/f3 && chmod 700 /cm/t/a /cm/t/a/sub /cm/t/a/sub/deep; echo o > /cm/t/out && chmod 644 /cm/t/out && ln -s /cm/t/out /cm/t/a/outlink && chmod -R 777 /cm/t/a; stat -c %a /cm/t/out");
  check("chmod -R does not follow a symlink to a file outside the tree", cr3.stdout === "644\n" && cr3.stderr === "", JSON.stringify([cr3.stdout, cr3.stderr]));
  const cr4 = await run(await shell({}), "mkdir -p /cm/t/d && echo x > /cm/t/d/f1 && chmod -R a=r /cm/t/d; echo rc=$?");
  check("chmod -R a=r removes search from a directory, and its entries are refused as GNU chmod refuses them", cr4.stdout === "rc=1\n" && cr4.stderr === "chmod: cannot access '/cm/t/d/f1': Permission denied\n", JSON.stringify([cr4.stdout, cr4.stderr]));
  const cr5 = await run(await shell({}), "chmod -R 750 /cm/t/none; echo rc=$?");
  check("chmod -R on a missing path reports it and exits 1", cr5.stdout === "rc=1\n" && cr5.stderr === "chmod: cannot access '/cm/t/none': No such file or directory\n", JSON.stringify([cr5.stdout, cr5.stderr]));
  const cr6 = await run(await shell({}), "chmod 644; echo rc=$?");
  check("chmod with a mode and no file says missing operand after the mode, as GNU chmod does", cr6.stdout === "rc=1\n" && cr6.stderr === "chmod: missing operand after '644'\nTry 'chmod --help' for more information.\n", JSON.stringify([cr6.stdout, cr6.stderr]));
  const cr7 = await run(await shell({}), "chmod; echo rc=$?");
  check("chmod with no operands says missing operand, as GNU chmod does", cr7.stdout === "rc=1\n" && cr7.stderr === "chmod: missing operand\nTry 'chmod --help' for more information.\n", JSON.stringify([cr7.stdout, cr7.stderr]));
  const cr8 = await run(await shell({}), "mkdir -p /cm/t && echo a > /cm/t/z && chmod 7 /cm/t/z && stat -c %a /cm/t/z && chmod 0 /cm/t/z && stat -c %a /cm/t/z");
  check("chmod 0 and chmod 7 are octal modes, and stat reports them without padding", cr8.stdout === "7\n0\n" && cr8.stderr === "", JSON.stringify([cr8.stdout, cr8.stderr]));
});

group('text: sort, uniq, head, tail and cut read lines and pick from them', async () => {
  const sh = await shell({});
  const sorted = await run(sh, 'printf "b\na\nc\n" | sort');
  check('text: sort puts the lines in order', sorted.stdout === 'a\nb\nc\n', JSON.stringify(sorted.stdout));
  const numeric = await run(sh, 'printf "3\n1\n2\n" | sort -n');
  check('text: sort -n compares the lines as numbers', numeric.stdout === '1\n2\n3\n', JSON.stringify(numeric.stdout));
  const reversed = await run(sh, 'printf "b\na\nb\n" | sort -ru');
  check('text: sort -ru reverses the order and keeps one of each line', reversed.stdout === 'b\na\n', JSON.stringify(reversed.stdout));
  const counted = await run(sh, 'printf "a\na\nb\n" | uniq -c');
  check('text: uniq -c counts each run of equal lines', counted.stdout === '      2 a\n      1 b\n', JSON.stringify(counted.stdout));
  const head = await run(sh, 'printf "1\n2\n3\n4\n" | head -n 2');
  check('text: head -n keeps the first lines', head.stdout === '1\n2\n', JSON.stringify(head.stdout));
  const headDigits = await run(sh, 'printf "1\n2\n3\n4\n" | head -2');
  check('text: head -N is the same as head -n N', headDigits.stdout === '1\n2\n', JSON.stringify(headDigits.stdout));
  const tail = await run(sh, 'printf "1\n2\n3\n4\n" | tail -n 2');
  check('text: tail -n keeps the last lines', tail.stdout === '3\n4\n', JSON.stringify(tail.stdout));
  const tailFrom = await run(sh, 'printf "1\n2\n3\n4\n5\n" | tail -n +4');
  check('text: tail -n +N starts at line N', tailFrom.stdout === '4\n5\n', JSON.stringify(tailFrom.stdout));
  const field = await run(sh, 'printf "a:b:c\nd:e:f\n" | cut -d: -f2');
  check('text: cut -d -f keeps one field of each line', field.stdout === 'b\ne\n', JSON.stringify(field.stdout));
  const fields = await run(sh, 'printf "a:b:c\n" | cut -d: -f1,3');
  check('text: cut keeps a list of fields in line order', fields.stdout === 'a:c\n', JSON.stringify(fields.stdout));
  const noDelim = await run(sh, 'printf "abc\n" | cut -f1');
  check('text: cut passes a line with no tab through whole', noDelim.stdout === 'abc\n', JSON.stringify(noDelim.stdout));
  const missing = await run(sh, 'cut -d: -f1 /e3/nope; echo rc=$?');
  check('text: a missing file gives a message and status 1', missing.stdout === 'rc=1\n' && missing.stderr.includes('cut: /e3/nope: No such file or directory'), JSON.stringify(missing.stderr));
  const noFields = await run(sh, 'cut -d:; echo rc=$?');
  check('text: cut without -f is refused with status 1', noFields.stdout === 'rc=1\n' && noFields.stderr.includes('you must specify the list of fields'), JSON.stringify(noFields.stderr));
});

group('env: env and printenv show only the exported variables', async () => {
  const exportedOnly = await run(await shell({}), 'export A=1; B=2; env');
  check('env: env lists exported variables, PWD among them, and not plain ones', exportedOnly.stdout === 'A=1\nPWD=/workspace\n', JSON.stringify(exportedOnly.stdout));
  const markedLater = await run(await shell({}), 'export C; C=3; env');
  check('env: a name exported before it is set is listed with its value', markedLater.stdout === 'C=3\nPWD=/workspace\n', JSON.stringify(markedLater.stdout));
  const plain = await run(await shell({}), 'X=1; printenv X; echo rc=$?');
  check('env: printenv of a plain variable prints nothing and exits 1', plain.stdout === 'rc=1\n', JSON.stringify(plain.stdout));
  const named = await run(await shell({}), 'export X=2; printenv X; echo rc=$?');
  check('env: printenv of an exported variable prints its value', named.stdout === '2\nrc=0\n', JSON.stringify(named.stdout));
  const several = await run(await shell({}), 'export P=1; export Q=2; printenv P Q');
  check('env: printenv takes several names', several.stdout === '1\n2\n', JSON.stringify(several.stdout));
  const withAssign = await run(await shell({}), 'export Y=3; env Z=4');
  check('env: an assignment on env is added to the listing', withAssign.stdout === 'PWD=/workspace\nY=3\nZ=4\n', JSON.stringify(withAssign.stdout));
  const command = await run(await shell({}), 'env A=1 printenv A; printenv A; echo rc=$?');
  check('env: env runs a command with the assignment set, and the assignment does not stay', command.stdout === '1\nrc=1\n', JSON.stringify(command.stdout));
  const missing = await run(await shell({}), 'env nosuchcmd; echo rc=$?');
  check('env: a command env cannot find exits 127 with the No such file or directory message', missing.stdout === 'rc=127\n' && missing.stderr === "env: 'nosuchcmd': No such file or directory\n", JSON.stringify([missing.stdout, missing.stderr]));
  const start = await run(await shell({}), 'printenv PWD');
  check('env: PWD is the working directory when the shell starts, as in bash', start.stdout === '/workspace\n', JSON.stringify(start.stdout));
  const pwd = await run(await shell({}), 'mkdir -p /pw; cd /pw; printenv PWD');
  check('env: PWD is exported and follows cd, as in bash', pwd.stdout === '/pw\n', JSON.stringify(pwd.stdout));
});

group('stat: stat reports the name, size, type and mode of a file', async () => {
  const sh = await shell({});
  await run(sh, 'mkdir -p /st');
  const fields = await run(sh, 'echo hello > /st/f; stat -c "%n %s %F" /st/f');
  check('stat: -c reports the name, size and type', fields.stdout === '/st/f 6 regular file\n', JSON.stringify(fields.stdout));
  const dir = await run(sh, 'mkdir /st/d; stat -c "%F %a" /st/d');
  check('stat: a directory is a directory with mode 755 by default', dir.stdout === 'directory 755\n', JSON.stringify(dir.stdout));
  const mode = await run(sh, 'echo x > /st/g; stat -c %a /st/g');
  check('stat: a file is 644 by default', mode.stdout === '644\n', JSON.stringify(mode.stdout));
  const missing = await run(sh, 'stat /st/none; echo rc=$?');
  check('stat: a missing file gives a message and status 1', missing.stdout === 'rc=1\n' && missing.stderr.includes("stat: cannot statx '/st/none': No such file or directory"), JSON.stringify(missing.stderr));
  const link = await run(sh, 'echo x > /st/t; ln -s /st/t /st/l; stat -c %F /st/l');
  check('stat: a symbolic link is reported as itself', link.stdout === 'symbolic link\n', JSON.stringify(link.stdout));
  const plain = await run(sh, 'echo hi > /st/h; stat /st/h');
  const plainLines = plain.stdout.split('\n');
  check('stat: with no -c, the file name is the first line, as GNU stat prints it', plainLines[0] === '  File: /st/h', JSON.stringify(plain.stdout));
  check('stat: with no -c, the size line has GNU padding, blocks, IO block and the type, as GNU stat prints it', plainLines[1] === '  Size: 3         \tBlocks: 8          IO Block: 4096   regular file', JSON.stringify(plainLines[1]));
  check('stat: with no -c, the device line has the inode and the link count, as GNU stat prints it', /^Device: 0,0\tInode: \d+ +Links: 1$/.test(plainLines[2]), JSON.stringify(plainLines[2]));
  check('stat: with no -c, the access line has the mode, the user and the group, as GNU stat prints it', plainLines[3] === 'Access: (0644/-rw-r--r--)  Uid: ( 1000/    user)   Gid: ( 1000/    user)', JSON.stringify(plainLines[3]));
  check('stat: with no -c, the times and birth are the model epoch and a dash, and the output is eight lines', plainLines.length === 9 && plainLines[4].startsWith('Access: 1970-01-01') && plainLines[5].startsWith('Modify: 1970-01-01') && plainLines[6].startsWith('Change: 1970-01-01') && plainLines[7] === ' Birth: -' && plainLines[8] === '', JSON.stringify(plain.stdout));
  const linkShape = await run(sh, 'echo x > /st/t; ln -s /st/t /st/l; stat /st/l');
  const linkLines = linkShape.stdout.split('\n');
  check('stat: with no -c, a symbolic link shows its name and its target, and its size is the target length, as GNU stat prints it', linkLines[0] === "  File: '/st/l' -> '/st/t'" && linkLines[1] === '  Size: 5         \tBlocks: 0          IO Block: 4096   symbolic link' && linkLines[3] === 'Access: (0777/lrwxrwxrwx)  Uid: ( 1000/    user)   Gid: ( 1000/    user)', JSON.stringify(linkShape.stdout));
  const dirShape = await run(sh, 'mkdir /st/q; mkdir /st/q/r; stat /st/q');
  const dirLines = dirShape.stdout.split('\n');
  check('stat: with no -c, a directory has size 4096, 8 blocks and 2 plus its subdirectories links, as GNU stat prints it', dirLines[1] === '  Size: 4096      \tBlocks: 8          IO Block: 4096   directory' && dirLines[2].endsWith('Links: 3'), JSON.stringify(dirShape.stdout));
  const modeShape = await run(sh, 'echo z > /st/m; chmod 600 /st/m; stat /st/m');
  check('stat: with no -c, a file with mode 600 shows 0600 and the rw- symbols, as GNU stat prints it', modeShape.stdout.split('\n')[3] === 'Access: (0600/-rw-------)  Uid: ( 1000/    user)   Gid: ( 1000/    user)', JSON.stringify(modeShape.stdout));
  const followShape = await run(sh, 'stat -L /st/l');
  check('stat: with no -c and -L, the link is followed and shows the target as a regular file, as GNU stat prints it', followShape.stdout.split('\n')[0] === '  File: /st/l' && followShape.stdout.split('\n')[1] === '  Size: 2         \tBlocks: 8          IO Block: 4096   regular file', JSON.stringify(followShape.stdout));
  const twoShape = await run(sh, 'stat /st/h /st/t');
  check('stat: with no -c and two names, each name gets its own block, as GNU stat prints it', (twoShape.stdout.match(/^  File: /gm) ?? []).length === 2, JSON.stringify(twoShape.stdout));
  const percent = await run(sh, 'echo x > /st/p; stat -c "%s%%" /st/p');
  check('stat: %% in the format is one percent sign', percent.stdout === '2%\n', JSON.stringify(percent.stdout));
});

group('realpath: realpath resolves .., relative names and symbolic links', async () => {
  const sh = await shell({});
  await run(sh, 'mkdir -p /rp; echo x > /rp/f; echo y > /rp/t; ln -s /rp/t /rp/l; ln -s /rp/l /rp/l2');
  const plain = await run(sh, 'realpath /rp/f');
  check('realpath: an absolute name is printed as it is', plain.stdout === '/rp/f\n', JSON.stringify(plain.stdout));
  const relative = await run(sh, 'cd /rp; realpath f');
  check('realpath: a relative name is taken from the current directory', relative.stdout === '/rp/f\n', JSON.stringify(relative.stdout));
  const dots = await run(sh, 'realpath /rp/../rp/./f');
  check('realpath: .. and . are resolved', dots.stdout === '/rp/f\n', JSON.stringify(dots.stdout));
  const link = await run(sh, 'realpath /rp/l');
  check('realpath: a symbolic link is followed to its target', link.stdout === '/rp/t\n', JSON.stringify(link.stdout));
  const chained = await run(sh, 'realpath /rp/l2');
  check('realpath: a chain of links is followed to the end', chained.stdout === '/rp/t\n', JSON.stringify(chained.stdout));
  const missing = await run(sh, 'realpath /rp/none; echo rc=$?');
  check('realpath: a missing last name is resolved without an error, as GNU realpath does by default', missing.stdout === '/rp/none\nrc=0\n' && missing.stderr === '', JSON.stringify(missing.stderr));
  const missingE = await run(sh, 'realpath -e /rp/none; echo rc=$?');
  check('realpath: a missing name under -e gives a message and status 1, as GNU realpath does', missingE.stdout === 'rc=1\n' && missingE.stderr === 'realpath: /rp/none: No such file or directory\n', JSON.stringify(missingE.stderr));
  const loop = await run(sh, 'ln -s /rp/b2 /rp/b1; ln -s /rp/b1 /rp/b2; realpath /rp/b1; echo rc=$?');
  check('realpath: a loop of links is refused with status 1', loop.stdout === 'rc=1\n' && loop.stderr.includes('Too many levels of symbolic links'), JSON.stringify(loop.stderr));
});

group('chmod: chmod sets an octal mode that stat reports', async () => {
  const sh = await shell({});
  await run(sh, 'mkdir -p /cm; echo x > /cm/f');
  const set = await run(sh, 'chmod 600 /cm/f; stat -c %a /cm/f');
  check('chmod: an octal mode is recorded and reported by stat', set.stdout === '600\n', JSON.stringify(set.stdout));
  const leading = await run(sh, 'chmod 0755 /cm/f; stat -c %a /cm/f');
  check('chmod: a leading zero is allowed and dropped', leading.stdout === '755\n', JSON.stringify(leading.stdout));
  const several = await run(sh, 'echo a > /cm/p; echo b > /cm/q; chmod 700 /cm/p /cm/q; stat -c %a /cm/p /cm/q');
  check('chmod: one mode is set on each named file', several.stdout === '700\n700\n', JSON.stringify(several.stdout));
  const missing = await run(sh, 'chmod 644 /cm/none; echo rc=$?');
  check('chmod: a missing file gives a message and status 1', missing.stdout === 'rc=1\n' && missing.stderr.includes("chmod: cannot access '/cm/none': No such file or directory"), JSON.stringify(missing.stderr));
  const digitMode = await run(sh, 'chmod 999 /cm/f; echo rc=$?');
  check('chmod: a number that is not octal is refused as an invalid mode, as GNU chmod does', digitMode.stdout === 'rc=1\n' && digitMode.stderr === "chmod: invalid mode: '999'\nTry 'chmod --help' for more information.\n", JSON.stringify(digitMode.stderr));
});

group('md5sum: md5sum prints the MD5 of its input and of each file', async () => {
  const sh = await shell({});
  await run(sh, 'mkdir -p /md');
  const abc = await run(sh, 'printf "abc" | md5sum');
  check('md5sum: the MD5 of stdin is printed with a dash', abc.stdout === '900150983cd24fb0d6963f7d28e17f72  -\n', JSON.stringify(abc.stdout));
  const empty = await run(sh, 'printf "" | md5sum');
  check('md5sum: the MD5 of empty input is the empty-input digest', empty.stdout === 'd41d8cd98f00b204e9800998ecf8427e  -\n', JSON.stringify(empty.stdout));
  const fox = await run(sh, 'printf "The quick brown fox jumps over the lazy dog" | md5sum');
  check('md5sum: a longer input gives the published digest', fox.stdout === '9e107d9d372bb6826bd81d3542a419d6  -\n', JSON.stringify(fox.stdout));
  const unicode = await run(sh, 'echo café | md5sum');
  check('md5sum: a non-ASCII input is hashed as UTF-8 bytes', unicode.stdout === '6e99834b7c3e3fd53529a5489725d7e8  -\n', JSON.stringify(unicode.stdout));
  const file = await run(sh, 'echo abc > /md/f; md5sum /md/f');
  check('md5sum: a file is hashed and named as given', file.stdout === '0bee89b07a248e27c83fc3d5951213c1  /md/f\n', JSON.stringify(file.stdout));
  const missing = await run(sh, 'md5sum /md/none; echo rc=$?');
  check('md5sum: a missing file gives a message and status 1', missing.stdout === 'rc=1\n' && missing.stderr.includes('md5sum: /md/none: No such file or directory'), JSON.stringify(missing.stderr));
});

group('base64: base64 encodes and decodes stdin, and wraps its output', async () => {
  const sh = await shell({});
  const encoded = await run(sh, 'printf "hello" | base64');
  check('base64: stdin is encoded and the result is one line', encoded.stdout === 'aGVsbG8=\n', JSON.stringify(encoded.stdout));
  const round = await run(sh, 'printf "hello" | base64 | base64 -d');
  check('base64: decoding an encoding gives the input back', round.stdout === 'hello', JSON.stringify(round.stdout));
  const wrapped = await run(sh, 'echo abc | base64 -w 4');
  check('base64: -w sets the line width', wrapped.stdout === 'YWJj\nCg==\n', JSON.stringify(wrapped.stdout));
  const unwrapped = await run(sh, 'echo abc | base64 -w 0');
  check('base64: -w 0 prints one line with no final newline, as GNU does', unwrapped.stdout === 'YWJjCg==', JSON.stringify(unwrapped.stdout));
  const emptyWrap = await run(await shell({}), "printf '' | base64 -w 0; echo rc=$?");
  check('base64: -w 0 on empty input prints nothing but the status', emptyWrap.stdout === 'rc=0\n', JSON.stringify(emptyWrap.stdout));
  const unicode = await run(sh, 'echo café | base64');
  check('base64: a non-ASCII input is encoded as UTF-8 bytes', unicode.stdout === 'Y2Fmw6kK\n', JSON.stringify(unicode.stdout));
  const decoded = await run(sh, 'printf "aGk=" | base64 -d');
  check('base64: -d decodes a padded input', decoded.stdout === 'hi', JSON.stringify(decoded.stdout));
  const bad = await run(sh, 'printf "@@@" | base64 -d; echo rc=$?');
  check('base64: a character outside the alphabet is refused with status 1', bad.stdout === 'rc=1\n' && bad.stderr.includes('base64: invalid input'), JSON.stringify(bad.stderr));
  const empty = await run(sh, 'printf "" | base64; echo rc=$?');
  check('base64: empty input gives no output and status 0', empty.stdout === 'rc=0\n', JSON.stringify(empty.stdout));
});

group('diff: diff prints the normal-format changes between two files', async () => {
  const sh = await shell({});
  await run(sh, 'mkdir -p /df');
  const same = await run(sh, 'printf "a\\n" > /df/a1; printf "a\\n" > /df/a2; diff /df/a1 /df/a2; echo rc=$?');
  check('diff: identical files print nothing and exit 0', same.stdout === 'rc=0\n', JSON.stringify(same.stdout));
  await run(sh, 'printf "1\\n2\\n3\\n" > /df/c1; printf "1\\nX\\n3\\n" > /df/c2');
  const change = await run(sh, 'diff /df/c1 /df/c2; echo rc=$?');
  check('diff: a changed line is a c hunk with < and > lines', change.stdout === '2c2\n< 2\n---\n> X\nrc=1\n', JSON.stringify(change.stdout));
  await run(sh, 'printf "1\\n" > /df/d1; printf "0\\n1\\n" > /df/d2');
  const added = await run(sh, 'diff /df/d1 /df/d2; echo rc=$?');
  check('diff: an added line is an a hunk', added.stdout === '0a1\n> 0\nrc=1\n', JSON.stringify(added.stdout));
  await run(sh, 'printf "1\\n2\\n" > /df/e1; printf "1\\n" > /df/e2');
  const removed = await run(sh, 'diff /df/e1 /df/e2; echo rc=$?');
  check('diff: a removed line is a d hunk', removed.stdout === '2d1\n< 2\nrc=1\n', JSON.stringify(removed.stdout));
  await run(sh, 'printf "a\\nb\\nc\\nd\\ne\\n" > /df/f1; printf "a\\nB\\nc\\nd\\nE\\n" > /df/f2');
  const several = await run(sh, 'diff /df/f1 /df/f2; echo rc=$?');
  check('diff: two separate changes give two hunks in order', several.stdout === '2c2\n< b\n---\n> B\n5c5\n< e\n---\n> E\nrc=1\n', JSON.stringify(several.stdout));
  const stdin = await run(sh, 'printf "1\\n3\\n" | diff - /df/c2; echo rc=$?');
  check('diff: - reads the first file from stdin', stdin.stdout === '1a2\n> X\nrc=1\n', JSON.stringify(stdin.stdout));
  const missing = await run(sh, 'diff /df/none /df/c1; echo rc=$?');
  check('diff: a missing file gives a message and status 2', missing.stdout === 'rc=2\n' && missing.stderr.includes('diff: /df/none: No such file or directory'), JSON.stringify(missing.stderr));
});

group('expr: expr computes arithmetic, comparisons and length, and sets the status from the result', async () => {
  const sh = await shell({});
  const sums = await run(sh, "expr 2 + 3; expr 7 - 10");
  check('expr: addition and subtraction, with a negative result', sums.stdout === '5\n-3\n', JSON.stringify(sums.stdout));
  const products = await run(sh, "expr 4 '*' 5; expr 7 / 2; expr 7 % 3; expr -7 / 2");
  check('expr: multiplication, division and remainder truncate toward zero', products.stdout === '20\n3\n1\n-3\n', JSON.stringify(products.stdout));
  const equal = await run(sh, 'expr 3 = 3; echo rc=$?; expr 3 = 4; echo rc=$?');
  check('expr: a true comparison prints 1 with status 0, a false one prints 0 with status 1', equal.stdout === '1\nrc=0\n0\nrc=1\n', JSON.stringify(equal.stdout));
  const compare = await run(sh, "expr 10 '>' 9; expr abc '<' abd; expr length hello");
  check('expr: numbers compare as numbers, words as text, and length counts characters', compare.stdout === '1\n1\n5\n', JSON.stringify(compare.stdout));
  const zero = await run(sh, 'expr 1 / 0; echo rc=$?');
  check('expr: division by zero gives a message and status 2', zero.stdout === 'rc=2\n' && zero.stderr.includes('expr: division by zero'), JSON.stringify(zero.stderr));
  const notInt = await run(sh, 'expr 2 + x; echo rc=$?');
  check('expr: an arithmetic operand that is not an integer gives status 2', notInt.stdout === 'rc=2\n' && notInt.stderr.includes('expr: non-integer argument'), JSON.stringify(notInt.stderr));
  const logic = await run(sh, "expr 0 '&' 5; echo rc=$?; expr 0 '|' 7; expr 3 '&' 4");
  check('expr: & and | pick a side by truth, and the status follows the result', logic.stdout === '0\nrc=1\n7\n3\n', JSON.stringify(logic.stdout));
  const none = await run(sh, 'expr; echo rc=$?');
  check('expr: no operand gives a message and status 2', none.stdout === 'rc=2\n' && none.stderr.includes('expr: missing operand'), JSON.stringify(none.stderr));
  const zeroOnly = await run(sh, 'expr 0; echo rc=$?');
  check('expr: a lone 0 is a false result with status 1', zeroOnly.stdout === '0\nrc=1\n', JSON.stringify(zeroOnly.stdout));
  const chained = await run(sh, "expr 1 + 2 '*' 3; echo rc=$?");
  check('expr: a longer expression is evaluated with * before +', chained.stdout === '7\nrc=0\n' && chained.stderr === '', JSON.stringify([chained.stdout, chained.stderr]));
});

group('expr: * / % bind tighter than + and -, parentheses group, and the values match the sandbox expr', async () => {
  const sh = await shell({});
  const x0 = await run(sh, "expr 1 + 2 '*' 3; echo rc=$?");
  check("expr: * binds tighter than + in 1 + 2 * 3, with the operator quoted", x0.stdout === "7\nrc=0\n" && x0.stderr === "", JSON.stringify([x0.stdout, x0.stderr]));
  const x1 = await run(sh, "expr 2 \\* 3 + 1; echo rc=$?");
  check("expr: * before + when the operator is escaped on the command line", x1.stdout === "7\nrc=0\n" && x1.stderr === "", JSON.stringify([x1.stdout, x1.stderr]));
  const x2 = await run(sh, "expr 10 - 4 / 2; echo rc=$?");
  check("expr: / binds tighter than - and truncates", x2.stdout === "8\nrc=0\n" && x2.stderr === "", JSON.stringify([x2.stdout, x2.stderr]));
  const x3 = await run(sh, "expr 10 / 3 '*' 3; echo rc=$?");
  check("expr: a left-to-right chain of * and / gives the GNU value", x3.stdout === "9\nrc=0\n" && x3.stderr === "", JSON.stringify([x3.stdout, x3.stderr]));
  const x4 = await run(sh, "expr 2 '*' 3 '*' 4; echo rc=$?");
  check("expr: a chain of * is multiplied out", x4.stdout === "24\nrc=0\n" && x4.stderr === "", JSON.stringify([x4.stdout, x4.stderr]));
  const x5 = await run(sh, "expr 7 % 3 '+' 1; echo rc=$?");
  check("expr: % binds tighter than +", x5.stdout === "2\nrc=0\n" && x5.stderr === "", JSON.stringify([x5.stdout, x5.stderr]));
  const x6 = await run(sh, "expr '(' 1 + 2 ')' '*' 3; echo rc=$?");
  check("expr: parentheses group a sum before *", x6.stdout === "9\nrc=0\n" && x6.stderr === "", JSON.stringify([x6.stdout, x6.stderr]));
  const x7 = await run(sh, "expr 1 '+' 1 '*' 0 '+' 5; echo rc=$?");
  check("expr: a chain of + and * mixes precedence correctly", x7.stdout === "6\nrc=0\n" && x7.stderr === "", JSON.stringify([x7.stdout, x7.stderr]));
  const x8 = await run(sh, "expr -3 '*' -2; echo rc=$?");
  check("expr: negative operands multiply by sign", x8.stdout === "6\nrc=0\n" && x8.stderr === "", JSON.stringify([x8.stdout, x8.stderr]));
  const x9 = await run(sh, "expr 3 '<' 4 '+' 1; echo rc=$?");
  check("expr: a comparison is looser than + in 3 < 4 + 1", x9.stdout === "1\nrc=0\n" && x9.stderr === "", JSON.stringify([x9.stdout, x9.stderr]));
  const x10 = await run(sh, "expr 1 + 1 '=' 2; echo rc=$?");
  check("expr: = is looser than + in 1 + 1 = 2", x10.stdout === "1\nrc=0\n" && x10.stderr === "", JSON.stringify([x10.stdout, x10.stderr]));
  const x11 = await run(sh, "expr 1 '|' 0 '&' 0; echo rc=$?");
  check("expr: & binds tighter than | in 1 | 0 & 0", x11.stdout === "1\nrc=0\n" && x11.stderr === "", JSON.stringify([x11.stdout, x11.stderr]));
  const x12 = await run(sh, "expr 0 '|' 5 '&' 3; echo rc=$?");
  check("expr: & returns its left operand when both are non-zero", x12.stdout === "5\nrc=0\n" && x12.stderr === "", JSON.stringify([x12.stdout, x12.stderr]));
  const x13 = await run(sh, "expr 2 '+' 3 '-' 1 '-' 1; echo rc=$?");
  check("expr: subtraction is left-associative", x13.stdout === "3\nrc=0\n" && x13.stderr === "", JSON.stringify([x13.stdout, x13.stderr]));
  const x14 = await run(sh, "expr 1 + 2 3; echo rc=$?");
  check("expr: an operand left after a complete expression is a syntax error", x14.stdout === "rc=2\n" && x14.stderr === "expr: syntax error: unexpected argument '3'\n", JSON.stringify([x14.stdout, x14.stderr]));
  const x15 = await run(sh, "expr 1 +; echo rc=$?");
  check("expr: an operator with no right operand is a syntax error", x15.stdout === "rc=2\n" && x15.stderr === "expr: syntax error: missing argument after '+'\n", JSON.stringify([x15.stdout, x15.stderr]));
  const x16 = await run(sh, "expr '(' 1 + 2; echo rc=$?");
  check("expr: an unclosed parenthesis is a syntax error", x16.stdout === "rc=2\n" && x16.stderr === "expr: syntax error: expecting ')' after '2'\n", JSON.stringify([x16.stdout, x16.stderr]));
  const x17 = await run(sh, "expr 1 + 2 ')'; echo rc=$?");
  check("expr: a stray close parenthesis is a syntax error", x17.stdout === "rc=2\n" && x17.stderr === "expr: syntax error: unexpected argument ')'\n", JSON.stringify([x17.stdout, x17.stderr]));
  const x18 = await run(sh, "expr 1 '*' 'x'; echo rc=$?");
  check("expr: a non-integer operand of * is refused with status 2", x18.stdout === "rc=2\n" && x18.stderr === "expr: non-integer argument\n", JSON.stringify([x18.stdout, x18.stderr]));
  const x19 = await run(sh, "expr 1 '/' 0; echo rc=$?");
  check("expr: division by zero inside a longer expression is refused", x19.stdout === "rc=2\n" && x19.stderr === "expr: division by zero\n", JSON.stringify([x19.stdout, x19.stderr]));
});

group('expr: match, :, substr, index and length take the GNU values, with the regex rules', async () => {
  const sh = await shell({});
  const xo0 = await run(sh, "expr abcdef : 'ab.*'; echo rc=$?");
  check("expr: : returns the length of the match, as GNU expr does", xo0.stdout === "6\nrc=0\n" && xo0.stderr === "", JSON.stringify([xo0.stdout, xo0.stderr]));
  const xo1 = await run(sh, "expr abcdef : 'a\\(b\\)'; echo rc=$?");
  check("expr: a group in the regex makes : return the group text", xo1.stdout === "b\nrc=0\n" && xo1.stderr === "", JSON.stringify([xo1.stdout, xo1.stderr]));
  const xo2 = await run(sh, "expr abc : x; echo rc=$?");
  check("expr: a : with no match returns 0 and status 1", xo2.stdout === "0\nrc=1\n" && xo2.stderr === "", JSON.stringify([xo2.stdout, xo2.stderr]));
  const xo3 = await run(sh, "expr abc : 'x\\(y\\)'; echo rc=$?");
  check("expr: a : with no match and a group returns the empty string and status 1", xo3.stdout === "\nrc=1\n" && xo3.stderr === "", JSON.stringify([xo3.stdout, xo3.stderr]));
  const xo4 = await run(sh, "expr match abcdef abc; echo rc=$?");
  check("expr: match takes the same operands as :", xo4.stdout === "3\nrc=0\n" && xo4.stderr === "", JSON.stringify([xo4.stdout, xo4.stderr]));
  const xo5 = await run(sh, "expr 'a+b' : 'a+b'; echo rc=$?");
  check("expr: + is literal in a basic regular expression", xo5.stdout === "3\nrc=0\n" && xo5.stderr === "", JSON.stringify([xo5.stdout, xo5.stderr]));
  const xo6 = await run(sh, "expr 'a(b' : 'a(b'; echo rc=$?");
  check("expr: ( is literal in a basic regular expression", xo6.stdout === "3\nrc=0\n" && xo6.stderr === "", JSON.stringify([xo6.stdout, xo6.stderr]));
  const xo7 = await run(sh, "expr 'a*' : 'a\\*'; echo rc=$?");
  check("expr: an escaped star matches a literal star", xo7.stdout === "2\nrc=0\n" && xo7.stderr === "", JSON.stringify([xo7.stdout, xo7.stderr]));
  const xo8 = await run(sh, "expr '*a' : '*a'; echo rc=$?");
  check("expr: a star at the start of a basic regular expression is literal", xo8.stdout === "2\nrc=0\n" && xo8.stderr === "", JSON.stringify([xo8.stdout, xo8.stderr]));
  const xo9 = await run(sh, "expr abc : 'a\\|ab'; echo rc=$?");
  check("expr: alternation takes the longest match, as POSIX requires", xo9.stdout === "2\nrc=0\n" && xo9.stderr === "", JSON.stringify([xo9.stdout, xo9.stderr]));
  const xo10 = await run(sh, "expr abcabc : '.*c'; echo rc=$?");
  check("expr: .* takes the longest match", xo10.stdout === "6\nrc=0\n" && xo10.stderr === "", JSON.stringify([xo10.stdout, xo10.stderr]));
  const xo11 = await run(sh, "expr abc : '^b'; echo rc=$?");
  check("expr: the regex is anchored at the start, so ^b does not match inside abc", xo11.stdout === "0\nrc=1\n" && xo11.stderr === "", JSON.stringify([xo11.stdout, xo11.stderr]));
  const xo12 = await run(sh, "expr 'a^b' : 'a^b'; echo rc=$?");
  check("expr: a caret that is not at the start is literal", xo12.stdout === "3\nrc=0\n" && xo12.stderr === "", JSON.stringify([xo12.stdout, xo12.stderr]));
  const xo13 = await run(sh, "expr aaa : 'a\\{2\\}'; echo rc=$?");
  check("expr: an interval with braces takes two copies", xo13.stdout === "2\nrc=0\n" && xo13.stderr === "", JSON.stringify([xo13.stdout, xo13.stderr]));
  const xo14 = await run(sh, "expr abc : 'a\\{2\\}'; echo rc=$?");
  check("expr: an interval that does not match gives 0", xo14.stdout === "0\nrc=1\n" && xo14.stderr === "", JSON.stringify([xo14.stdout, xo14.stderr]));
  const xo15 = await run(sh, "expr 'a$b' : 'a$b'; echo rc=$?");
  check("expr: a dollar that is not at the end is literal", xo15.stdout === "3\nrc=0\n" && xo15.stderr === "", JSON.stringify([xo15.stdout, xo15.stderr]));
  const xo16 = await run(sh, "expr 'a\\b' : 'a\\\\b'; echo rc=$?");
  check("expr: a backslash in the regex matches a backslash", xo16.stdout === "3\nrc=0\n" && xo16.stderr === "", JSON.stringify([xo16.stdout, xo16.stderr]));
  const xo17 = await run(sh, "expr abc : '[ab]*'; echo rc=$?");
  check("expr: a bracket expression with a star", xo17.stdout === "2\nrc=0\n" && xo17.stderr === "", JSON.stringify([xo17.stdout, xo17.stderr]));
  const xo18 = await run(sh, "expr 'a]' : 'a]'; echo rc=$?");
  check("expr: a close bracket outside a bracket expression is literal", xo18.stdout === "2\nrc=0\n" && xo18.stderr === "", JSON.stringify([xo18.stdout, xo18.stderr]));
  const xo19 = await run(sh, "expr abc : '\\(a\\)\\(b\\)'; echo rc=$?");
  check("expr: the first group is returned when there are two", xo19.stdout === "a\nrc=0\n" && xo19.stderr === "", JSON.stringify([xo19.stdout, xo19.stderr]));
  const xo20 = await run(sh, "expr abc : 'a\\(x\\)*'; echo rc=$?");
  check("expr: a group that does not take part gives the empty string", xo20.stdout === "\nrc=1\n" && xo20.stderr === "", JSON.stringify([xo20.stdout, xo20.stderr]));
  const xo21 = await run(sh, "expr 1 + abc : a; echo rc=$?");
  check("expr: : binds tighter than +", xo21.stdout === "2\nrc=0\n" && xo21.stderr === "", JSON.stringify([xo21.stdout, xo21.stderr]));
  const xo22 = await run(sh, "expr abc : 'a\\(b\\)c' \\* 2; echo rc=$?");
  check("expr: : binds tighter than *, so its text is an operand of *", xo22.stdout === "rc=2\n" && xo22.stderr === "expr: non-integer argument\n", JSON.stringify([xo22.stdout, xo22.stderr]));
  const xo23 = await run(sh, "expr abc : '\\('; echo rc=$?");
  check("expr: an unmatched ( is refused with status 2", xo23.stdout === "rc=2\n" && xo23.stderr === "expr: Unmatched ( or \\(\n", JSON.stringify([xo23.stdout, xo23.stderr]));
  const xo24 = await run(sh, "expr abc : '\\)'; echo rc=$?");
  check("expr: an unmatched ) is refused with status 2", xo24.stdout === "rc=2\n" && xo24.stderr === "expr: Unmatched ) or \\)\n", JSON.stringify([xo24.stdout, xo24.stderr]));
  const xo25 = await run(sh, "expr abc : '[a'; echo rc=$?");
  check("expr: an unclosed bracket is refused with status 2", xo25.stdout === "rc=2\n" && xo25.stderr === "expr: Unmatched [, [^, [:, [., or [=\n", JSON.stringify([xo25.stdout, xo25.stderr]));
  const xo26 = await run(sh, "expr abc : 'a\\'; echo rc=$?");
  check("expr: a trailing backslash is refused with status 2", xo26.stdout === "rc=2\n" && xo26.stderr === "expr: Trailing backslash\n", JSON.stringify([xo26.stdout, xo26.stderr]));
  const xo27 = await run(sh, "expr abc :; echo rc=$?");
  check("expr: a : with no regex is a syntax error", xo27.stdout === "rc=2\n" && xo27.stderr === "expr: syntax error: missing argument after ':'\n", JSON.stringify([xo27.stdout, xo27.stderr]));
  const xo28 = await run(sh, "expr substr abcdef 2 3; echo rc=$?");
  check("expr: substr takes a 1-based start and a length", xo28.stdout === "bcd\nrc=0\n" && xo28.stderr === "", JSON.stringify([xo28.stdout, xo28.stderr]));
  const xo29 = await run(sh, "expr substr abcdef 2 99; echo rc=$?");
  check("expr: substr with a length past the end gives the rest of the string", xo29.stdout === "bcdef\nrc=0\n" && xo29.stderr === "", JSON.stringify([xo29.stdout, xo29.stderr]));
  const xo30 = await run(sh, "expr substr abcdef 0 3; echo rc=$?");
  check("expr: substr with a start of 0 gives the empty string and status 1", xo30.stdout === "\nrc=1\n" && xo30.stderr === "", JSON.stringify([xo30.stdout, xo30.stderr]));
  const xo31 = await run(sh, "expr substr abcdef 9 3; echo rc=$?");
  check("expr: substr with a start past the end gives the empty string and status 1", xo31.stdout === "\nrc=1\n" && xo31.stderr === "", JSON.stringify([xo31.stdout, xo31.stderr]));
  const xo32 = await run(sh, "expr substr abcdef 2 -1; echo rc=$?");
  check("expr: substr with a negative length gives the empty string and status 1", xo32.stdout === "\nrc=1\n" && xo32.stderr === "", JSON.stringify([xo32.stdout, xo32.stderr]));
  const xo33 = await run(sh, "expr substr abcdef x 1; echo rc=$?");
  check("expr: substr with a non-integer start gives the empty string and status 1", xo33.stdout === "\nrc=1\n" && xo33.stderr === "", JSON.stringify([xo33.stdout, xo33.stderr]));
  const xo34 = await run(sh, "expr substr abc 1; echo rc=$?");
  check("expr: substr with too few operands is a syntax error", xo34.stdout === "rc=2\n" && xo34.stderr === "expr: syntax error: missing argument after '1'\n", JSON.stringify([xo34.stdout, xo34.stderr]));
  const xo35 = await run(sh, "expr index abcdef cd; echo rc=$?");
  check("expr: index gives the 1-based position of the first character found", xo35.stdout === "3\nrc=0\n" && xo35.stderr === "", JSON.stringify([xo35.stdout, xo35.stderr]));
  const xo36 = await run(sh, "expr index abcdef xz; echo rc=$?");
  check("expr: index gives 0 and status 1 when no character is found", xo36.stdout === "0\nrc=1\n" && xo36.stderr === "", JSON.stringify([xo36.stdout, xo36.stderr]));
  const xo37 = await run(sh, "expr index abcdef ''; echo rc=$?");
  check("expr: index with no characters gives 0 and status 1", xo37.stdout === "0\nrc=1\n" && xo37.stderr === "", JSON.stringify([xo37.stdout, xo37.stderr]));
  const xo38 = await run(sh, "expr index abc; echo rc=$?");
  check("expr: index with too few operands is a syntax error", xo38.stdout === "rc=2\n" && xo38.stderr === "expr: syntax error: missing argument after 'abc'\n", JSON.stringify([xo38.stdout, xo38.stderr]));
  const xo39 = await run(sh, "expr length abc + 1; echo rc=$?");
  check("expr: length is an operand, so length abc + 1 is 4", xo39.stdout === "4\nrc=0\n" && xo39.stderr === "", JSON.stringify([xo39.stdout, xo39.stderr]));
  const xo40 = await run(sh, "expr 1 + length abcd; echo rc=$?");
  check("expr: length as the right operand of +", xo40.stdout === "5\nrc=0\n" && xo40.stderr === "", JSON.stringify([xo40.stdout, xo40.stderr]));
  const xo41 = await run(sh, "expr length abc = 3; echo rc=$?");
  check("expr: length in a comparison", xo41.stdout === "1\nrc=0\n" && xo41.stderr === "", JSON.stringify([xo41.stdout, xo41.stderr]));
  const xo42 = await run(sh, "expr length abc x; echo rc=$?");
  check("expr: a word left after length is a syntax error", xo42.stdout === "rc=2\n" && xo42.stderr === "expr: syntax error: unexpected argument 'x'\n", JSON.stringify([xo42.stdout, xo42.stderr]));
  const xo43 = await run(sh, "expr length ab length cd; echo rc=$?");
  check("expr: a second length after a length operand is a syntax error", xo43.stdout === "rc=2\n" && xo43.stderr === "expr: syntax error: unexpected argument 'length'\n", JSON.stringify([xo43.stdout, xo43.stderr]));
  const xo44 = await run(sh, "expr 1 + length; echo rc=$?");
  check("expr: length with no operand is a syntax error", xo44.stdout === "rc=2\n" && xo44.stderr === "expr: syntax error: missing argument after 'length'\n", JSON.stringify([xo44.stdout, xo44.stderr]));
  const xo45 = await run(sh, "expr length ''; echo rc=$?");
  check("expr: length of the empty string is 0 and status 1", xo45.stdout === "0\nrc=1\n" && xo45.stderr === "", JSON.stringify([xo45.stdout, xo45.stderr]));
  const xo46 = await run(sh, "expr match abc 'a\\(b\\)'; echo rc=$?");
  check("expr: match takes a group like :", xo46.stdout === "b\nrc=0\n" && xo46.stderr === "", JSON.stringify([xo46.stdout, xo46.stderr]));
});

group('expr: POSIX character classes in a bracket expression match GNU expr', async () => {
  const sh = await shell({});

  const xc0 = await run(sh, "expr abc1 : '[[:alpha:]]*'; echo rc=$?");
  check("expr: a POSIX class in a bracket expression matches its characters", xc0.stdout === "3\nrc=0\n" && xc0.stderr === "", JSON.stringify([xc0.stdout, xc0.stderr]));
  const xc1 = await run(sh, "expr a1 : '[[:digit:]]'; echo rc=$?");
  check("expr: a digit class does not match a leading letter", xc1.stdout === "0\nrc=1\n" && xc1.stderr === "", JSON.stringify([xc1.stdout, xc1.stderr]));
  const xc2 = await run(sh, "expr '1a' : '[[:digit:]]'; echo rc=$?");
  check("expr: a digit class matches a leading digit", xc2.stdout === "1\nrc=0\n" && xc2.stderr === "", JSON.stringify([xc2.stdout, xc2.stderr]));
  const xc3 = await run(sh, "expr ' b' : '[[:space:]]b'; echo rc=$?");
  check("expr: a space class matches a space and a class can sit beside a letter", xc3.stdout === "2\nrc=0\n" && xc3.stderr === "", JSON.stringify([xc3.stdout, xc3.stderr]));
  const xc4 = await run(sh, "expr 'A-z' : '[[:upper:]-]*'; echo rc=$?");
  check("expr: an upper class can be mixed with a literal dash in one bracket", xc4.stdout === "2\nrc=0\n" && xc4.stderr === "", JSON.stringify([xc4.stdout, xc4.stderr]));
  const xc5 = await run(sh, "expr abc : '[[:foo:]]'; echo rc=$?");
  check("expr: an unknown character class name is refused with status 2", xc5.stdout === "rc=2\n" && xc5.stderr === "expr: Invalid character class name\n", JSON.stringify([xc5.stdout, xc5.stderr]));
});

group('expr: a colon or match counts an astral character as one, as GNU expr does in a UTF-8 locale', async () => {
  const ex0 = await run(await shell({}), "expr 'a😀b' : '.*'; echo rc=$?");
  check("expr: a colon match counts an astral character as one, as GNU expr does in a UTF-8 locale", ex0.stdout === "3\nrc=0\n" && ex0.stderr === "", JSON.stringify([ex0.stdout, ex0.stderr]));
  const ex1 = await run(await shell({}), "expr 'a😀b' : 'a.'; echo rc=$?");
  check("expr: a colon match of a literal and one character counts the astral character, as GNU expr does", ex1.stdout === "2\nrc=0\n" && ex1.stderr === "", JSON.stringify([ex1.stdout, ex1.stderr]));
  const ex2 = await run(await shell({}), "expr 'a😀b' : 'a\\(.\\)'; echo rc=$?");
  check("expr: a colon match captures an astral character as one unit, as GNU expr does", ex2.stdout === "😀\nrc=0\n" && ex2.stderr === "", JSON.stringify([ex2.stdout, ex2.stderr]));
  const ex3 = await run(await shell({}), "expr 'a😀b' : '..'; echo rc=$?");
  check("expr: two dots match two characters when one is astral, as GNU expr does", ex3.stdout === "2\nrc=0\n" && ex3.stderr === "", JSON.stringify([ex3.stdout, ex3.stderr]));
  const ex4 = await run(await shell({}), "expr match 'a😀b' '.\\(.\\)'; echo rc=$?");
  check("expr: match captures the character after the first, when it is astral, as GNU expr does", ex4.stdout === "😀\nrc=0\n" && ex4.stderr === "", JSON.stringify([ex4.stdout, ex4.stderr]));
  const ex5 = await run(await shell({}), "expr 'a😀b' : '.*b'; echo rc=$?");
  check("expr: a colon match ending in a literal counts the whole string, as GNU expr does", ex5.stdout === "3\nrc=0\n" && ex5.stderr === "", JSON.stringify([ex5.stdout, ex5.stderr]));
  const ex6 = await run(await shell({}), "expr '😀😀' : '.'; echo rc=$?");
  check("expr: a dot matches one astral character, as GNU expr does", ex6.stdout === "1\nrc=0\n" && ex6.stderr === "", JSON.stringify([ex6.stdout, ex6.stderr]));
  const ex7 = await run(await shell({}), "expr 'x😀y' : '.*\\(😀\\)'; echo rc=$?");
  check("expr: a capture after astral characters returns the astral character, as GNU expr does", ex7.stdout === "😀\nrc=0\n" && ex7.stderr === "", JSON.stringify([ex7.stdout, ex7.stderr]));
});

group('seq: seq counts from first to last by step, and refuses bad arguments', async () => {
  const sh = await shell({});
  const last = await run(sh, 'seq 3');
  check('seq: one argument counts from 1 to it', last.stdout === '1\n2\n3\n', JSON.stringify(last.stdout));
  const empty = await run(sh, 'seq 0; echo rc=$?');
  check('seq: an empty range prints nothing and exits 0', empty.stdout === 'rc=0\n', JSON.stringify(empty.stdout));
  const decimal = await run(sh, 'seq 1 0.5 3');
  check('seq: decimals keep the widest number of places', decimal.stdout === '1.0\n1.5\n2.0\n2.5\n3.0\n', JSON.stringify(decimal.stdout));
  const down = await run(sh, 'seq 5 -2 1');
  check('seq: a negative step counts down', down.stdout === '5\n3\n1\n', JSON.stringify(down.stdout));
  const range = await run(sh, 'seq 2 4');
  check('seq: two arguments give the first and last', range.stdout === '2\n3\n4\n', JSON.stringify(range.stdout));
  const oneDecimal = await run(sh, 'seq 1.5 2');
  check('seq: a single decimal step past the end is not printed', oneDecimal.stdout === '1.5\n', JSON.stringify(oneDecimal.stdout));
  const word = await run(sh, 'seq x; echo rc=$?');
  check('seq: a non-number gives a message and status 1', word.stdout === 'rc=1\n' && word.stderr.includes("seq: invalid floating point argument: 'x'"), JSON.stringify(word.stderr));
  const zeroStep = await run(sh, 'seq 1 0 3; echo rc=$?');
  check('seq: a zero step gives a message and status 1', zeroStep.stdout === 'rc=1\n' && zeroStep.stderr.includes("seq: invalid Zero increment value: '0'"), JSON.stringify(zeroStep.stderr));
  const none = await run(sh, 'seq; echo rc=$?');
  check('seq: no operand gives a message and status 1', none.stdout === 'rc=1\n' && none.stderr.includes('seq: missing operand'), JSON.stringify(none.stderr));
  const extra = await run(sh, 'seq 1 2 3 4; echo rc=$?');
  check('seq: a fourth argument gives a message and status 1', extra.stdout === 'rc=1\n' && extra.stderr.includes("seq: extra operand '4'"), JSON.stringify(extra.stderr));
});

group('basename and dirname: basename gives the last name, dirname the directory part', async () => {
  const sh = await shell({});
  const base = await run(sh, 'basename /a/b/c.txt');
  check('basename: the last part of a path', base.stdout === 'c.txt\n', JSON.stringify(base.stdout));
  const suffix = await run(sh, 'basename /a/b/c.txt .txt');
  check('basename: a suffix argument is removed', suffix.stdout === 'c\n', JSON.stringify(suffix.stdout));
  const trailing = await run(sh, 'basename /a/b/; basename /; basename name.txt name.txt');
  check('basename: trailing slashes are dropped, / stays /, a suffix equal to the name is kept', trailing.stdout === 'b\n/\nname.txt\n', JSON.stringify(trailing.stdout));
  const several = await run(sh, 'basename -s .txt /a/x.txt /a/y.txt');
  check('basename: -s gives each name without the suffix', several.stdout === 'x\ny\n', JSON.stringify(several.stdout));
  const all = await run(sh, 'basename -a /p/q /r/s');
  check('basename: -a treats each argument as a name', all.stdout === 'q\ns\n', JSON.stringify(all.stdout));
  const none = await run(sh, 'basename; echo rc=$?');
  check('basename: no operand gives a message and status 1', none.stdout === 'rc=1\n' && none.stderr.includes('basename: missing operand'), JSON.stringify(none.stderr));
  const dir = await run(sh, 'dirname /a/b/c.txt');
  check('dirname: the directory part of a path', dir.stdout === '/a/b\n', JSON.stringify(dir.stdout));
  const bare = await run(sh, 'dirname c.txt; dirname /c.txt; dirname /');
  check('dirname: a bare name is ., a top-level name is /, / stays /', bare.stdout === '.\n/\n/\n', JSON.stringify(bare.stdout));
  const slashes = await run(sh, 'dirname a/b/; dirname //a//b//');
  check('dirname: trailing slashes are dropped and leading ones kept', slashes.stdout === 'a\n//a\n', JSON.stringify(slashes.stdout));
  const pair = await run(sh, 'dirname /a/b /x');
  check('dirname: each argument gets its own line', pair.stdout === '/a\n/\n', JSON.stringify(pair.stdout));
  const noneDir = await run(sh, 'dirname; echo rc=$?');
  check('dirname: no operand gives a message and status 1', noneDir.stdout === 'rc=1\n' && noneDir.stderr.includes('dirname: missing operand'), JSON.stringify(noneDir.stderr));
});

group('loops: a for loop yields per item, so timeoutMs stops a long for loop', async () => {
  const sh = await shell({});
  const started = Date.now();
  const long = await run(sh, 'for i in {1..100000}; do :; done', { timeoutMs: 300 });
  const elapsed = Date.now() - started;
  check('loops: a for over a large list is stopped by timeoutMs with exit 124', long.exitCode === 124, 'exit ' + long.exitCode);
  check('loops: the stop comes at the timeout, not after the whole list', elapsed < 5000, elapsed + ' ms');
  const short = await run(sh, 'for i in 1 2 3; do echo $i; done');
  check('loops: a short for loop still runs every item', short.stdout === '1\n2\n3\n', JSON.stringify(short.stdout));
});

group('parity: the txiki shell and bashkit give the same stdout, stderr and status for the same commands', async () => {
  const kitDir = join(root, 'web', 'vendor', 'bashkit');
  let kit;
  try {
    kit = await import(pathToFileURL(join(kitDir, 'index.js')).href);
    await kit.initBashkit(readFileSync(join(kitDir, 'bashkit_wasm_bg.wasm')));
  } catch (err) {
    check('parity: bashkit is vendored and loads in Node (scripts/vendor-bashkit.mjs)', false, err.message);
    return;
  }
  const preamble = 'mkdir -p /workspace /tmp /t /st /md /df /cm /rp /e2 /e3 /s /d /dd /box; ';
  const commands = [
    "export A=1; B=2; env",
    "export C; C=3; env",
    "export Y=3; env Z=4",
    "mkdir -p /pw; cd /pw; printenv PWD",
    "env ls; echo rc=$?",
    "env A=1 printenv A; printenv A; echo rc=$?",
    "HOME=/home/sandbox; export HOME; echo ~",
    "set -e; echo rc=$?",
    "set -- a; shift 2; echo rc=$?",
    "echo abc | base64 -w 0",
    "echo one; echo two && echo three || echo four",
    "false || echo or-ran",
    "echo abc | tr a-z A-Z",
    "echo first > /workspace/r.txt && echo second >> /workspace/r.txt && cat < /workspace/r.txt",
    "cat /workspace/missing.txt 2> /workspace/err.txt; cat /workspace/err.txt",
    "false; echo rc=$?; (exit 3); echo sub=$?",
    "x=5; echo $x ${x}y \"$x\"",
    "export GREETING=hi; echo $GREETING",
    "y=$(echo inner); echo $y $(echo outer)",
    "echo ${UNSET_NAME:-fallback} ${#GREETING}",
    "echo $((2+3*4)) $(( (7-2) % 3 ))",
    "i=2; echo $((i*i)) $((i<3))",
    "cd /workspace; echo *.txt",
    "echo a?.txt",
    "echo nomatch*",
    "echo \"*.txt\"",
    "greet() { echo hi $1 $#; }; greet bob ann",
    "f() { return 4; }; f; echo rc=$?",
    "g() { local v=inside; echo $v; }; g; echo v=$v",
    "echo next",
    "false",
    "echo rc=$?",
    "cd /workspace",
    "pwd",
    "ls notes",
    "ls -a notes",
    "rm notes/a.txt && ls notes",
    "rm notes/sub",
    "rm -r notes/sub && ls notes",
    "rm -f notes/missing.txt; echo rc=$?",
    "test -d notes && echo dir-ok",
    "find notes -name \"*.txt\"",
    "find notes -iname \"*.md\"",
    "find notes -type d",
    "cat notes/a.txt | wc -l",
    "find notes -name \"*.zzz\" | wc -l",
    "grep -in alpha log.txt",
    "grep -v alpha log.txt",
    "cat log.txt | grep -c alpha",
    "grep beta log.txt other.txt",
    "grep x nosuch.txt; echo rc=$?",
    "grep zzz log.txt; echo rc=$?",
    "wait; echo rc=$?",
    "echo hi & wait; echo done",
    "false & wait $!; echo rc=$?",
    "false & echo rc=$?",
    "sed 's/o/0/g' a.txt",
    "sed -n '2p' a.txt",
    "sed '/two/,/three/d' a.txt",
    "sed -E 's/(o)(n)/[&]\\2\\1/' a.txt",
    "sed 's/y/z/' b.txt",
    "sed -i 's/two/TWO/' a.txt; cat a.txt",
    "sed p nosuch.txt; echo rc=$?",
    "tar -xf t.tar -C restored && cat restored/d/sub/x.txt restored/d/y.txt",
    "tar -tf none.tar",
    "tar -cf - a.txt | tar -tf -",
    "printf '' | jq -nc '[1,2] + [3] | {total: add, n: length}'",
    "n=0; while [ $n -lt 3 ]; do echo w$n; n=$((n+1)); done",
    "while false; do echo never; done; echo after",
    "n=0; until [ $n -ge 2 ]; do echo u$n; n=$((n+1)); done",
    "for i in 1 2 3; do echo $i; break; done; echo after",
    "for i in 1 2 3; do if [ $i = 2 ]; then continue; fi; echo $i; done",
    "for i in 1 2; do for j in a b; do break 2; done; echo never; done; echo done",
    "for i in 1 2; do for j in a b; do continue 2; done; echo never; done; echo end",
    "case x in a) echo A;; x) echo X;; esac",
    "v=hello; case $v in h*) echo starts-h;; *) echo other;; esac",
    "case zz in a|b) echo ab;; *) echo default;; esac",
    "case b in a|b) echo ab;; esac",
    "case q in a) echo a;; esac; echo after",
    "case '*' in '*') echo literal;; *) echo glob;; esac",
    "case xyz in '*') echo literal;; *) echo glob;; esac",
    "case 1 in 1) echo one; echo uno;; esac",
    "case a in a) false;; esac; echo rc=$?",
    ": x y; echo rc=$?",
    "set -- a b c; echo $1 $2 $#",
    "set -- a b c; shift; echo $1 $#",
    "set -- a b c; shift 2; echo $1 $#",
    "set -- x y; shift; shift; echo $#",
    "v=1; set | grep \"^v=\"",
    "v=world; cat <<EOF\nhello $v\nEOF\n",
    "v=world; cat <<'EOF'\nhello $v\nEOF\n",
    "cat <<< \"one two\"",
    "cat <<EOF | tr a-z A-Z\nabc\nEOF\necho after\n",
    "cat <<EOF\nback\\$x \\\\ \nEOF\n",
    "cat <<EOF\na\nEOF\ncat <<EOF\nb\nEOF\n",
    "echo out &> /t/a.txt; cat /t/a.txt",
    "cat /nope/x &> /t/e.txt; cat /t/e.txt",
    "echo a &> /t/c.txt; echo b &>> /t/c.txt; cat /t/c.txt",
    "echo x &> /t/d.txt",
    "echo {a,b,c}",
    "echo x{1,2}y",
    "echo {1..3} {3..1} {a..c}",
    "echo {a,b{1,2}} {01..03}",
    "echo '{a,b}' {a}",
    "for i in {1..3}; do echo $i; done",
    "HOME=/h; echo ~ ~/x",
    "HOME=/h; echo '~' ~x a~",
    "mkdir -p /e2",
    "echo hi > /e2/a.txt; cp /e2/a.txt /e2/b.txt; cat /e2/b.txt",
    "echo p > /e2/p; echo q > /e2/q; mkdir /e2/box; cp /e2/p /e2/q /e2/box; cat /e2/box/q",
    "echo hi > /e2/m.txt; mv /e2/m.txt /e2/n.txt; cat /e2/n.txt; cat /e2/m.txt; echo rc=$?",
    "touch /e2/new.txt; cat /e2/new.txt; echo rc=$?",
    "echo one | tee /e2/t.txt; cat /e2/t.txt",
    "echo one | tee /e2/u.txt; echo two | tee -a /e2/u.txt; cat /e2/u.txt",
    "mkdir /e2/dd; cp /e2/dd /e2/x; echo rc=$?",
    "touch /nodir/x; echo rc=$?",
    "echo a > /e2/r; echo b > /e2/s; cp /e2/r /e2/s /e2/r; echo rc=$?",
    "printf \"b\na\nc\n\" | sort",
    "printf \"3\n1\n2\n\" | sort -n",
    "printf \"b\na\nb\n\" | sort -ru",
    "printf \"a\na\nb\n\" | uniq -c",
    "printf \"1\n2\n3\n4\n\" | head -n 2",
    "printf \"1\n2\n3\n4\n\" | head -2",
    "printf \"1\n2\n3\n4\n\" | tail -n 2",
    "printf \"1\n2\n3\n4\n5\n\" | tail -n +4",
    "printf \"a:b:c\nd:e:f\n\" | cut -d: -f2",
    "printf \"a:b:c\n\" | cut -d: -f1,3",
    "printf \"abc\n\" | cut -f1",
    "cut -d: -f1 /e3/nope; echo rc=$?",
    "X=1; printenv X; echo rc=$?",
    "export X=2; printenv X; echo rc=$?",
    "export P=1; export Q=2; printenv P Q",
    "mkdir -p /st",
    "echo hello > /st/f; stat -c \"%n %s %F\" /st/f",
    "mkdir /st/d; stat -c \"%F %a\" /st/d",
    "echo x > /st/g; stat -c %a /st/g",
    "echo x > /st/p; stat -c \"%s%%\" /st/p",
    "mkdir -p /rp; echo x > /rp/f; echo y > /rp/t; ln -s /rp/t /rp/l; ln -s /rp/l /rp/l2",
    "mkdir -p /cm; echo x > /cm/f",
    "echo a > /cm/p; echo b > /cm/q; chmod 700 /cm/p /cm/q; stat -c %a /cm/p /cm/q",
    "chmod 644 /cm/none; echo rc=$?",
    "mkdir -p /md",
    "printf \"abc\" | md5sum",
    "printf \"\" | md5sum",
    "printf \"The quick brown fox jumps over the lazy dog\" | md5sum",
    "echo café | md5sum",
    "echo abc > /md/f; md5sum /md/f",
    "printf \"hello\" | base64",
    "printf \"hello\" | base64 | base64 -d",
    "echo abc | base64 -w 4",
    "echo café | base64",
    "printf \"aGk=\" | base64 -d",
    "printf \"\" | base64; echo rc=$?",
    "mkdir -p /df",
    "printf \"a\\n\" > /df/a1; printf \"a\\n\" > /df/a2; diff /df/a1 /df/a2; echo rc=$?",
    "printf \"1\\n2\\n3\\n\" > /df/c1; printf \"1\\nX\\n3\\n\" > /df/c2",
    "printf \"1\\n\" > /df/d1; printf \"0\\n1\\n\" > /df/d2",
    "printf \"1\\n2\\n\" > /df/e1; printf \"1\\n\" > /df/e2",
    "printf \"a\\nb\\nc\\nd\\ne\\n\" > /df/f1; printf \"a\\nB\\nc\\nd\\nE\\n\" > /df/f2",
    "expr 2 + 3; expr 7 - 10",
    "expr 4 '*' 5; expr 7 / 2; expr 7 % 3; expr -7 / 2",
    "expr 3 = 3; echo rc=$?; expr 3 = 4; echo rc=$?",
    "expr 10 '>' 9; expr abc '<' abd; expr length hello",
    "expr 1 / 0; echo rc=$?",
    "expr 2 + x; echo rc=$?",
    "expr 0 '&' 5; echo rc=$?; expr 0 '|' 7; expr 3 '&' 4",
    "expr; echo rc=$?",
    "expr 0; echo rc=$?",
    "seq 3",
    "seq 0; echo rc=$?",
    "seq 1 0.5 3",
    "seq 5 -2 1",
    "seq 2 4",
    "seq 1.5 2",
    "seq; echo rc=$?",
    "seq 1 2 3 4; echo rc=$?",
    "basename /a/b/c.txt",
    "basename /a/b/c.txt .txt",
    "basename /a/b/; basename /; basename name.txt name.txt",
    "basename -s .txt /a/x.txt /a/y.txt",
    "basename -a /p/q /r/s",
    "basename; echo rc=$?",
    "dirname /a/b/c.txt",
    "dirname c.txt; dirname /c.txt; dirname /",
    "dirname a/b/; dirname //a//b//",
    "dirname /a/b /x",
    "dirname; echo rc=$?",
    "for i in 1 2 3; do echo $i; done",
  ];
  for (const script of commands) {
    const text = preamble + script;
    const txiki = await run(await shell({}), text, { timeoutMs: 10000 });
    const expected = await new kit.Bash({ cwd: '/workspace', timeoutMs: 20000 }).execute(text);
    const got = [txiki.stdout, txiki.stderr, txiki.exitCode];
    const want = [expected.stdout, expected.stderr, expected.exitCode];
    const same = JSON.stringify(got) === JSON.stringify(want);
    check('parity: ' + JSON.stringify(script), same, same ? '' : 'txiki ' + JSON.stringify(got) + ' bashkit ' + JSON.stringify(want));
  }
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
