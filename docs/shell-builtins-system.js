// System-info coreutils (uname/whoami/hostname/id/free/uptime/ps/nproc/arch/
// sleep/od/xxd/groups/logname/tty/stty/locale/tr). Follows the same
// convention as shell-builtins-util.js/shell-builtins-text.js: wl() writes a
// CRLF-terminated xterm line, ctx.lastExitCode mirrors POSIX exit-code
// semantics (0 success, 1 generic failure, 2 usage error). A separate,
// disconnected implementation of these commands lived in
// shell-node-coreutils.js's makeCoreutils() -- never imported by shell.js or
// any dispatcher, so uname/whoami/hostname/id/free/uptime/ps/nproc/arch/
// sleep/od/xxd/groups/logname/tty/stty/locale were completely unreachable
// despite existing in source (a genuine "all commands 1:1" gap: 17 real
// coreutils commands the shell claims no knowledge of). This file ports
// those into the actual builtin-merge pattern (shell-builtins.js `...text,
// ...extra, ...util, ...fsExtra`), fixing the missing ctx.lastExitCode/wl()
// conventions along the way. makeCoreutils's tr was a complete no-op stub
// (`tr:args=>{return 0;}`) that would have silently shadowed the REAL tr
// already correctly implemented in shell-builtins-text.js if it had ever
// been merged after text -- this module deliberately does NOT re-implement
// tr/pwd/dirname/basename/true/false, all of which already have correct
// implementations elsewhere; merging this module BEFORE those in
// shell-builtins.js (not after) lets the real ones win on any name clash.
export function makeSystemBuiltins(ctx, readFile) {
    const w = s => ctx.term.write(s);
    const wl = s => w(s + '\r\n');
    return {
        uname: args => {
            ctx.lastExitCode = 0;
            const flags = args.filter(a => a.startsWith('-')).join('');
            const info = { kernel: 'Linux', node: 'thebird', release: '6.0.0-browser', version: '#1 SMP PREEMPT thebird', machine: 'x86_64', os: 'GNU/Linux' };
            if (flags.includes('a')) wl(`${info.kernel} ${info.node} ${info.release} ${info.version} ${info.machine} ${info.os}`);
            else if (flags.includes('r')) wl(info.release);
            else if (flags.includes('n')) wl(info.node);
            else if (flags.includes('m')) wl(info.machine);
            else if (flags.includes('v')) wl(info.version);
            else if (flags.includes('o')) wl(info.os);
            else wl(info.kernel);
        },
        whoami: () => { ctx.lastExitCode = 0; wl((ctx.env && ctx.env.USER) || 'root'); },
        hostname: args => {
            ctx.lastExitCode = 0;
            if (args[0]) { ctx.env = ctx.env || {}; ctx.env.HOSTNAME = args[0]; return; }
            wl((ctx.env && ctx.env.HOSTNAME) || 'thebird');
        },
        id: args => {
            ctx.lastExitCode = 0;
            if (args.includes('-u')) { wl('0'); return; }
            if (args.includes('-g')) { wl('0'); return; }
            if (args.includes('-un')) { wl((ctx.env && ctx.env.USER) || 'root'); return; }
            wl('uid=0(root) gid=0(root) groups=0(root)');
        },
        free: args => {
            ctx.lastExitCode = 0;
            const m = (typeof performance !== 'undefined' && performance.memory) || { totalJSHeapSize: 1e9, usedJSHeapSize: 5e8, jsHeapSizeLimit: 2e9 };
            const kb = n => (n / 1024) | 0;
            wl('              total        used        free      shared  buff/cache   available');
            wl(`Mem:    ${String(kb(m.jsHeapSizeLimit)).padStart(11)} ${String(kb(m.usedJSHeapSize)).padStart(11)} ${String(kb(m.jsHeapSizeLimit - m.usedJSHeapSize)).padStart(11)}           0           0 ${String(kb(m.jsHeapSizeLimit - m.usedJSHeapSize)).padStart(11)}`);
            wl('Swap:             0           0           0');
        },
        uptime: () => {
            ctx.lastExitCode = 0;
            const sec = (performance.now() / 1000) | 0;
            const h = (sec / 3600) | 0, m = ((sec % 3600) / 60) | 0;
            wl(`${new Date().toTimeString().slice(0, 8)} up ${h}:${String(m).padStart(2, '0')}, 1 user, load average: 0.00, 0.00, 0.00`);
        },
        ps: () => {
            ctx.lastExitCode = 0;
            wl('  PID TTY          TIME CMD');
            wl('    1 pts/0    00:00:00 sh');
            const jobs = Object.entries(ctx.bgJobs || {});
            let pid = 2;
            for (const [, job] of jobs) wl(`${String(pid++).padStart(5)} pts/0    00:00:00 ${(job.cmd || '?').slice(0, 40)}`);
        },
        nproc: () => { ctx.lastExitCode = 0; wl(String((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 1)); },
        arch: () => { ctx.lastExitCode = 0; wl('x86_64'); },
        sleep: args => {
            ctx.lastExitCode = 0;
            const secs = parseFloat(args[0]) || 0;
            return new Promise(resolve => setTimeout(resolve, secs * 1000));
        },
        od: args => {
            ctx.lastExitCode = 0;
            const path = args.find(a => !a.startsWith('-'));
            if (!path) { ctx.lastExitCode = 1; return; }
            const c = readFile(path);
            const b = typeof c === 'string' ? new TextEncoder().encode(c) : c;
            for (let i = 0; i < b.length; i += 16) {
                const hex = [...b.slice(i, i + 16)].map(x => x.toString(16).padStart(2, '0')).join(' ');
                wl(i.toString(8).padStart(7, '0') + ' ' + hex);
            }
        },
        xxd: args => {
            ctx.lastExitCode = 0;
            const path = args.find(a => !a.startsWith('-'));
            if (!path) { ctx.lastExitCode = 1; return; }
            const c = readFile(path);
            const b = typeof c === 'string' ? new TextEncoder().encode(c) : c;
            for (let i = 0; i < b.length; i += 16) {
                const row = b.slice(i, i + 16);
                const hex = [...row].map(x => x.toString(16).padStart(2, '0')).join(' ').padEnd(47);
                const asc = [...row].map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('');
                wl(i.toString(16).padStart(8, '0') + ': ' + hex + ' ' + asc);
            }
        },
        groups: () => { ctx.lastExitCode = 0; wl('root'); },
        logname: () => { ctx.lastExitCode = 0; wl((ctx.env && ctx.env.USER) || 'root'); },
        tty: () => { ctx.lastExitCode = 0; wl('/dev/pts/0'); },
        stty: () => { ctx.lastExitCode = 0; },
        locale: () => { ctx.lastExitCode = 0; wl('LANG=C.UTF-8'); wl('LC_ALL='); },
    };
}
