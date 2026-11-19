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
  const link = await run(await shell({}), 'echo t > /cp/tt; ln -s /cp/tt /cp/ll; mkdir -p /cp/d; cp -r /cp/ll /cp/d; test -L /cp/d/ll && echo link-kept');
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

group('chmod: symbolic modes match the sandbox chmod, and octal modes still work', async () => {
  const m1 = await run(await shell({}), "echo a > /cm/f; chmod 644 /cm/f; chmod \"u+x\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: u+x adds the owner execute bit", m1.stdout === "rc=0\n744\n" && m1.stderr === "", JSON.stringify([m1.stdout, m1.stderr]));
  const m2 = await run(await shell({}), "echo a > /cm/f; chmod 666 /cm/f; chmod \"go-w\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: go-w removes write from group and other", m2.stdout === "rc=0\n644\n" && m2.stderr === "", JSON.stringify([m2.stdout, m2.stderr]));
  const m3 = await run(await shell({}), "echo a > /cm/f; chmod 755 /cm/f; chmod \"a=r\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: a=r sets read only for all three classes", m3.stdout === "rc=0\n444\n" && m3.stderr === "", JSON.stringify([m3.stdout, m3.stderr]));
  const m4 = await run(await shell({}), "echo a > /cm/f; chmod 444 /cm/f; chmod \"+w\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: +w with no class is limited by the umask for group and other", m4.stdout === "rc=0\n644\n" && m4.stderr === "", JSON.stringify([m4.stdout, m4.stderr]));
  const m5 = await run(await shell({}), "echo a > /cm/f; chmod 644 /cm/f; chmod \"-w\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: -w with no class removes write from all three classes", m5.stdout === "rc=0\n444\n" && m5.stderr === "", JSON.stringify([m5.stdout, m5.stderr]));
  const m6 = await run(await shell({}), "echo a > /cm/f; chmod 000 /cm/f; chmod \"u+rwx,g+r\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: clauses separated by a comma apply in order", m6.stdout === "rc=0\n740\n" && m6.stderr === "", JSON.stringify([m6.stdout, m6.stderr]));
  const m7 = await run(await shell({}), "echo a > /cm/f; chmod 644 /cm/f; chmod \"g=u\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: g=u copies the owner bits to the group", m7.stdout === "rc=0\n664\n" && m7.stderr === "", JSON.stringify([m7.stdout, m7.stderr]));
  const m8 = await run(await shell({}), "echo a > /cm/f; chmod 644 /cm/f; chmod \"a+s\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: a+s sets the setuid and setgid bits", m8.stdout === "rc=0\n6644\n" && m8.stderr === "", JSON.stringify([m8.stdout, m8.stderr]));
  const m9 = await run(await shell({}), "echo a > /cm/f; chmod 644 /cm/f; chmod \"u+x,go+X\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: X adds execute only when some execute bit is already set", m9.stdout === "rc=0\n755\n" && m9.stderr === "", JSON.stringify([m9.stdout, m9.stderr]));
  const m10 = await run(await shell({}), "echo a > /cm/f; chmod 644 /cm/f; chmod \"u+rx,g-r,o=\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: three clauses of different operators in one mode", m10.stdout === "rc=0\n700\n" && m10.stderr === "", JSON.stringify([m10.stdout, m10.stderr]));
  const m11 = await run(await shell({}), "echo a > /cm/f; chmod 644 /cm/f; chmod \"+rw\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: +rw with no class keeps the umask on group and other write", m11.stdout === "rc=0\n644\n" && m11.stderr === "", JSON.stringify([m11.stdout, m11.stderr]));
  const m12 = await run(await shell({}), "echo a > /cm/f; chmod 644 /cm/f; chmod \"u+\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: a class with no permission changes nothing", m12.stdout === "rc=0\n644\n" && m12.stderr === "", JSON.stringify([m12.stdout, m12.stderr]));
  const m13 = await run(await shell({}), "echo a > /cm/f; chmod 700 /cm/f; chmod \"ug+w\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: ug+w adds write to owner and group only", m13.stdout === "rc=0\n720\n" && m13.stderr === "", JSON.stringify([m13.stdout, m13.stderr]));
  const m14 = await run(await shell({}), "echo a > /cm/f; chmod 720 /cm/f; chmod \"a+X\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: a+X adds execute to all classes when the owner has it", m14.stdout === "rc=0\n731\n" && m14.stderr === "", JSON.stringify([m14.stdout, m14.stderr]));
  const m15 = await run(await shell({}), "echo a > /cm/f; chmod 777 /cm/f; chmod \"o=\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: o= clears all bits of other", m15.stdout === "rc=0\n770\n" && m15.stderr === "", JSON.stringify([m15.stdout, m15.stderr]));
  const e1 = await run(await shell({}), "echo a > /cm/f; chmod 644 /cm/f; chmod \"u+q\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: an unknown permission letter is refused with status 1 and the file is unchanged", e1.stdout === "rc=1\n644\n" && e1.stderr === "chmod: invalid operator (expected +, -, or =, but found q)\n", JSON.stringify([e1.stdout, e1.stderr]));
  const e2 = await run(await shell({}), "echo a > /cm/f; chmod 644 /cm/f; chmod \"x+x\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: a letter where a class or operator belongs is refused with status 1", e2.stdout === "rc=1\n644\n" && e2.stderr === "chmod: invalid operator (expected +, -, or =, but found x)\n", JSON.stringify([e2.stdout, e2.stderr]));
  const e3 = await run(await shell({}), "echo a > /cm/f; chmod 644 /cm/f; chmod \"u\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: a clause with no operator is refused with status 1", e3.stdout === "rc=1\n644\n" && e3.stderr === "chmod: invalid mode (u)\n", JSON.stringify([e3.stdout, e3.stderr]));
  const e4 = await run(await shell({}), "echo a > /cm/f; chmod 644 /cm/f; chmod \",u+x\" /cm/f; echo rc=$?; stat -c %a /cm/f");
  check("chmod: an empty clause is refused with status 1", e4.stdout === "rc=1\n644\n" && e4.stderr === "chmod: invalid mode ()\n", JSON.stringify([e4.stdout, e4.stderr]));
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
  check("set -x (gap, compound headers): a for-loop header is not traced, bash prints + for i in 1 2 before each pass; cause: the for executor emits no trace line", xt13.stdout === "1\n2\n" && xt13.stderr === "+ echo 1\n+ echo 2\n+ set +x\n", JSON.stringify([xt13.stdout, xt13.stderr]));
  const xt14 = await run(await shell({}), "PS4='>> '; set -x; echo p; set +x");
  check("set -x (gap, PS4): PS4 is not read, bash prints >> and this shell prints +; cause: the trace prefix is fixed", xt14.stdout === "p\n" && xt14.stderr === "+ echo p\n+ set +x\n", JSON.stringify([xt14.stdout, xt14.stderr]));
  const xt15 = await run(await shell({}), "set -x; echo \"$(echo sub)\"; set +x");
  check("set -x (gap, nested): a command substitution is traced at depth one, bash prints ++; cause: trace depth is not tracked through substitutions", xt15.stdout === "sub\n" && xt15.stderr === "+ echo sub\n+ echo sub\n+ set +x\n", JSON.stringify([xt15.stdout, xt15.stderr]));
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
  check('env: a command env cannot find exits 127, as in bash', missing.stdout === 'rc=127\n', JSON.stringify(missing.stdout));
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
  check('stat: with no -c it prints the file, size and type', plain.stdout === '  File: /st/h\n  Size: 3\n  Type: regular file\n', JSON.stringify(plain.stdout));
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
  check('realpath: a missing name gives a message and status 1', missing.stdout === 'rc=1\n' && missing.stderr.includes('realpath: /rp/none: No such file or directory'), JSON.stringify(missing.stderr));
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
  check('chmod: a digit that is not octal is refused with status 1, as chmod does', digitMode.stdout === 'rc=1\n' && digitMode.stderr === 'chmod: invalid digit found in string\n', JSON.stringify(digitMode.stderr));
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
