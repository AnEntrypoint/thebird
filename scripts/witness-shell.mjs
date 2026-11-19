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
  check('builtins: a shift past the parameters fails with status 1 and a message', tooMany.stdout === 'rc=1\n' && /shift count out of range/.test(tooMany.stderr), JSON.stringify(tooMany.stderr));
  const unsupported = await run(sh, 'set -e; echo rc=$?');
  check('builtins: an unsupported set option is refused with status 2, not ignored', unsupported.stdout === 'rc=2\n' && /unsupported option -e/.test(unsupported.stderr), JSON.stringify(unsupported.stderr));
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
  check('env: env lists exported variables and not plain ones', exportedOnly.stdout === 'A=1\n', JSON.stringify(exportedOnly.stdout));
  const markedLater = await run(await shell({}), 'export C; C=3; env');
  check('env: a name exported before it is set is listed with its value', markedLater.stdout === 'C=3\n', JSON.stringify(markedLater.stdout));
  const plain = await run(await shell({}), 'X=1; printenv X; echo rc=$?');
  check('env: printenv of a plain variable prints nothing and exits 1', plain.stdout === 'rc=1\n', JSON.stringify(plain.stdout));
  const named = await run(await shell({}), 'export X=2; printenv X; echo rc=$?');
  check('env: printenv of an exported variable prints its value', named.stdout === '2\nrc=0\n', JSON.stringify(named.stdout));
  const several = await run(await shell({}), 'export P=1; export Q=2; printenv P Q');
  check('env: printenv takes several names', several.stdout === '1\n2\n', JSON.stringify(several.stdout));
  const withAssign = await run(await shell({}), 'export Y=3; env Z=4');
  check('env: an assignment on env is added to the listing', withAssign.stdout === 'Y=3\nZ=4\n', JSON.stringify(withAssign.stdout));
  const command = await run(await shell({}), 'env ls; echo rc=$?');
  check('env: running a command is refused with status 125', command.stdout === 'rc=125\n' && command.stderr.includes('running a command is not supported'), JSON.stringify(command.stderr));
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
  const symbolic = await run(sh, 'chmod u+x /cm/f; echo rc=$?');
  check('chmod: a symbolic mode is refused with status 1, not ignored', symbolic.stdout === 'rc=1\n' && symbolic.stderr.includes("chmod: unsupported mode 'u+x'"), JSON.stringify(symbolic.stderr));
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
  check('base64: -w 0 keeps the output on one line', unwrapped.stdout === 'YWJjCg==\n', JSON.stringify(unwrapped.stdout));
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
  check('expr: a longer expression is refused with status 2, not evaluated', chained.stdout === 'rc=2\n' && chained.stderr.includes('only one operator is supported'), JSON.stringify(chained.stderr));
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
