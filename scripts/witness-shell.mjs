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
