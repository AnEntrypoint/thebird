// A real command interpreter for the terminal kit.
//
// The kit used to push '(stub) ran: <input>' into an array and render it -- the
// word "stub" was visible to users, and nothing executed. This module is the
// execution half: a virtual filesystem plus a command table, both synchronous
// and dependency-free, so the terminal surface has something genuine to drive.
//
// Deliberately NOT a real OS. Commands operate on an in-memory tree; there is
// no network, no eval, and no host access, so a demo page cannot be turned into
// an exfiltration surface by typing into it. Unknown input reports a real
// not-found error the way a shell does, rather than echoing success.

const FS = {
    'readme.md': 'the 247420 design system\n\nan editorial component library. run `ls` to look around,\n`help` for the command list.\n',
    'colors_and_type.css': '/* the token bible: --acid, --ink, --paper, the --fs-* scale */\n',
    src: {
        'components.js': '// barrel over src/components/<group>.js\n',
        'bootstrap.js': '// mountKit() -- every kit boots through here\n',
        css: { 'app-shell.css': '/* @import barrel over app-shell/*.css */\n' },
    },
    ui_kits: {
        'terminal/': null,
        'dashboard/': null,
        'file-browser/': null,
    },
};

function nodeAt(path) {
    let cur = FS;
    for (const seg of path) {
        if (!cur || typeof cur !== 'object') return undefined;
        cur = cur[seg];
    }
    return cur;
}

const isDir = (n) => n && typeof n === 'object';

// Resolve a user-typed path against cwd, honouring . and .. and a leading /.
function resolvePath(cwd, raw) {
    const parts = String(raw).split('/').filter(Boolean);
    const out = String(raw).startsWith('/') ? [] : cwd.slice();
    for (const p of parts) {
        if (p === '.') continue;
        if (p === '..') out.pop();
        else out.push(p);
    }
    return out;
}

const promptPath = (cwd) => '~/' + cwd.join('/');

// Each command returns an array of {kind, text} lines, matching the six line
// kinds the kit's Line() renderer already knows: cmt, cmd, out, ok, warn, log.
const COMMANDS = {
    help(_args, ctx) {
        const names = Object.keys(COMMANDS).sort();
        return [
            { kind: 'cmt', text: '# available commands' },
            ...names.map((n) => ({ kind: 'out', text: n.padEnd(10) + COMMANDS[n].desc })),
            { kind: 'out', text: '' },
            { kind: 'out', text: 'up/down walks history, tab completes, ctrl+l or clear wipes the screen.' },
        ];
    },
    ls(args, ctx) {
        const target = args[0] ? resolvePath(ctx.cwd, args[0]) : ctx.cwd;
        const node = nodeAt(target);
        if (node === undefined) return [{ kind: 'warn', text: 'ls: ' + args[0] + ': no such file or directory' }];
        if (!isDir(node)) return [{ kind: 'out', text: args[0] }];
        const keys = Object.keys(node).sort();
        if (!keys.length) return [{ kind: 'out', text: '(empty)' }];
        return keys.map((k) => ({ kind: 'out', text: isDir(node[k]) ? k + '/' : k }));
    },
    cd(args, ctx) {
        if (!args[0] || args[0] === '~') { ctx.cwd.length = 0; return []; }
        const next = resolvePath(ctx.cwd, args[0]);
        const node = nodeAt(next);
        if (node === undefined) return [{ kind: 'warn', text: 'cd: ' + args[0] + ': no such file or directory' }];
        if (!isDir(node)) return [{ kind: 'warn', text: 'cd: ' + args[0] + ': not a directory' }];
        ctx.cwd.length = 0;
        next.forEach((s) => ctx.cwd.push(s));
        return [];
    },
    cat(args, ctx) {
        if (!args[0]) return [{ kind: 'warn', text: 'cat: missing operand' }];
        const node = nodeAt(resolvePath(ctx.cwd, args[0]));
        if (node === undefined) return [{ kind: 'warn', text: 'cat: ' + args[0] + ': no such file or directory' }];
        if (isDir(node)) return [{ kind: 'warn', text: 'cat: ' + args[0] + ': is a directory' }];
        if (node === null) return [{ kind: 'out', text: '(binary or generated)' }];
        return String(node).split('\n').map((text) => ({ kind: 'out', text }));
    },
    pwd(_args, ctx) { return [{ kind: 'out', text: promptPath(ctx.cwd) }]; },
    echo(args) { return [{ kind: 'out', text: args.join(' ') }]; },
    whoami() { return [{ kind: 'out', text: 'visitor@247420' }]; },
    date() { return [{ kind: 'out', text: new Date().toString() }]; },
    theme(args, ctx) {
        const want = args[0];
        if (want !== 'light' && want !== 'dark') {
            return [{ kind: 'warn', text: 'theme: expected `light` or `dark`' }];
        }
        ctx.setTheme(want);
        return [{ kind: 'ok', text: 'theme set to ' + want }];
    },
    clear(_args, ctx) { ctx.clear(); return []; },
};

COMMANDS.help.desc = 'list these commands';
COMMANDS.ls.desc = 'list directory contents';
COMMANDS.cd.desc = 'change directory';
COMMANDS.cat.desc = 'print a file';
COMMANDS.pwd.desc = 'print working directory';
COMMANDS.echo.desc = 'write arguments to output';
COMMANDS.whoami.desc = 'print the current user';
COMMANDS.date.desc = 'print the current date';
COMMANDS.theme.desc = 'switch light/dark';
COMMANDS.clear.desc = 'clear the scrollback';

// Split a command line into argv, honouring single and double quotes so
// `echo "two words"` is one argument rather than two.
export function tokenize(line) {
    const out = [];
    let cur = '';
    let quote = null;
    for (const ch of String(line)) {
        if (quote) {
            if (ch === quote) quote = null;
            else cur += ch;
        } else if (ch === '"' || ch === "'") {
            quote = ch;
        } else if (/\s/.test(ch)) {
            if (cur) { out.push(cur); cur = ''; }
        } else {
            cur += ch;
        }
    }
    if (cur) out.push(cur);
    return out;
}

// Complete a partial word against command names (first token) or the current
// directory's entries (any later token). Returns the completed line, or the
// original when there is no unambiguous single match.
export function complete(line, cwd) {
    const argv = tokenize(line);
    const trailing = /\s$/.test(line);
    const head = trailing ? '' : (argv[argv.length - 1] || '');
    const pool = (argv.length <= 1 && !trailing)
        ? Object.keys(COMMANDS)
        : Object.keys(nodeAt(cwd) || {});
    const hits = pool.filter((k) => k.startsWith(head));
    if (hits.length !== 1) return line;
    const base = trailing ? argv : argv.slice(0, -1);
    return [...base, hits[0]].join(' ');
}

export const commandNames = () => Object.keys(COMMANDS).sort();

// Run one line. ctx carries { cwd, clear, setTheme } so commands can mutate the
// session without this module reaching into the DOM itself.
export function run(line, ctx) {
    const argv = tokenize(line);
    if (!argv.length) return [];
    const [name, ...args] = argv;
    const cmd = COMMANDS[name];
    if (!cmd) {
        return [{ kind: 'warn', text: name + ': command not found — try `help`' }];
    }
    try {
        return cmd(args, ctx) || [];
    } catch (err) {
        return [{ kind: 'warn', text: name + ': ' + (err && err.message ? err.message : 'failed') }];
    }
}
