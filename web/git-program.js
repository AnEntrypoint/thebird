function fail(code, message) {
    return Object.assign(new Error(message), { code });
}

function makeFsp(native) {
    const statOf = (path) => {
        const info = native.stat(path);
        if (!info) return null;
        const isDir = info.kind === 2;
        return {
            type: isDir ? 'dir' : 'file',
            mode: info.mode,
            size: info.size,
            ino: 0,
            mtimeMs: info.mtimeMs,
            ctimeMs: info.mtimeMs,
            mtime: new Date(info.mtimeMs),
            ctime: new Date(info.mtimeMs),
            uid: 0,
            gid: 0,
            dev: 0,
            isFile: () => !isDir,
            isDirectory: () => isDir,
            isSymbolicLink: () => false,
        };
    };
    const required = (path, op) => {
        const info = statOf(path);
        if (!info) throw fail('ENOENT', `ENOENT: no such file or directory, ${op} '${path}'`);
        return info;
    };
    const parentOf = (path) => path.slice(0, path.lastIndexOf('/')) || '/';
    const makeDir = (path) => {
        if (!native.mkdir(path)) throw fail('ENOENT', `ENOENT: no such file or directory, mkdir '${path}'`);
    };
    const mkdir = (path, options) => {
        if (options?.recursive) {
            let current = '';
            for (const part of path.split('/').filter(Boolean)) {
                current += `/${part}`;
                const info = statOf(current);
                if (!info) makeDir(current);
                else if (!info.isDirectory()) throw fail('ENOTDIR', `ENOTDIR: not a directory, mkdir '${current}'`);
            }
            return;
        }
        if (statOf(path)) throw fail('EEXIST', `EEXIST: file already exists, mkdir '${path}'`);
        if (!statOf(parentOf(path))) throw fail('ENOENT', `ENOENT: no such file or directory, mkdir '${path}'`);
        makeDir(path);
    };
    const remove = (path, options) => {
        const info = statOf(path);
        if (!info) {
            if (options?.force) return;
            throw fail('ENOENT', `ENOENT: no such file or directory, rm '${path}'`);
        }
        if (!info.isDirectory()) {
            native.unlink(path);
            return;
        }
        if (!options?.recursive) throw fail('EISDIR', `EISDIR: illegal operation on a directory, rm '${path}'`);
        for (const name of native.readdir(path) ?? []) remove(`${path}/${name}`, options);
        if (!native.rmdir(path)) throw fail('ENOTEMPTY', `ENOTEMPTY: directory not empty, rmdir '${path}'`);
    };
    return {
        readFile: async (path, options) => {
            required(path, 'open');
            const bytes = native.readFile(path);
            if (bytes === undefined) throw fail('EISDIR', `EISDIR: illegal operation on a directory, read '${path}'`);
            const encoding = typeof options === 'string' ? options : options?.encoding;
            const view = new Uint8Array(bytes);
            return encoding ? new TextDecoder().decode(view) : view;
        },
        writeFile: async (path, data) => {
            const view = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
            if (!statOf(parentOf(path))) throw fail('ENOENT', `ENOENT: no such file or directory, open '${path}'`);
            if (!native.writeFile(path, view.slice().buffer)) throw fail('EISDIR', `EISDIR: illegal operation on a directory, open '${path}'`);
        },
        unlink: async (path) => {
            required(path, 'unlink');
            if (!native.unlink(path)) throw fail('EISDIR', `EISDIR: illegal operation on a directory, unlink '${path}'`);
        },
        readdir: async (path) => {
            const names = native.readdir(path);
            if (names === undefined) throw fail(statOf(path) ? 'ENOTDIR' : 'ENOENT', `${statOf(path) ? 'ENOTDIR' : 'ENOENT'}: scandir '${path}'`);
            return names;
        },
        mkdir: async (path, options) => mkdir(path, options),
        rmdir: async (path) => {
            required(path, 'rmdir');
            if (!native.rmdir(path)) throw fail('ENOTEMPTY', `ENOTEMPTY: directory not empty, rmdir '${path}'`);
        },
        rm: async (path, options) => remove(path, options),
        stat: async (path) => required(path, 'stat'),
        lstat: async (path) => required(path, 'lstat'),
        readlink: async (path) => {
            throw fail('EINVAL', `EINVAL: invalid argument, readlink '${path}'`);
        },
        symlink: async (target, path) => {
            throw fail('EPERM', `EPERM: symlinks are not supported, symlink '${path}'`);
        },
    };
}

const GIT_AUTHOR = { name: 'lanmower', email: 'almagestfraternite@gmail.com' };
const MAX_DIFF_CELLS = 4000000;

const ignoredPath = (path) => /^\.thebird(\/|$)/.test(path);
const io = (dir) => ({ fs: { promises: fsp }, dir });
const statusRows = (dir) => isomorphic.statusMatrix({ ...io(dir), filter: (path) => !ignoredPath(path) });
const valueOf = (args, flag) => {
    const at = args.indexOf(flag);
    return at === -1 ? undefined : args[at + 1];
};

function shortStatus([path, head, workdir, stage]) {
    if (head === 0 && stage === 0 && workdir === 2) return `?? ${path}`;
    const x = head === stage ? ' ' : stage === 0 ? 'D' : head === 0 ? 'A' : 'M';
    const y = workdir === stage ? ' ' : workdir === 0 ? 'D' : 'M';
    if (x === ' ' && y === ' ') return null;
    return `${x}${y} ${path}`;
}

async function gitStatus(dir) {
    const branch = await isomorphic.currentBranch(io(dir));
    const lines = (await statusRows(dir)).map(shortStatus).filter(Boolean);
    return [`## ${branch ?? 'HEAD (no branch)'}`, ...lines].join('\n');
}

async function gitLog(dir, count) {
    let commits;
    try {
        commits = await isomorphic.log({ ...io(dir), depth: Math.max(1, Number(count) || 20) });
    } catch (err) {
        if (err.code === 'NotFoundError') throw new Error('no commits yet');
        throw err;
    }
    return commits.map(({ oid, commit }) => `${oid.slice(0, 7)} ${commit.message.split('\n')[0]}`).join('\n');
}

function changedLines(before, after) {
    const a = before.split('\n');
    const b = after.split('\n');
    if (a.length * b.length > MAX_DIFF_CELLS) return [...a.map((line) => '-' + line), ...b.map((line) => '+' + line)];
    const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
        }
    }
    const out = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { i++; j++; }
        else if (table[i + 1][j] >= table[i][j + 1]) out.push('-' + a[i++]);
        else out.push('+' + b[j++]);
    }
    while (i < a.length) out.push('-' + a[i++]);
    while (j < b.length) out.push('+' + b[j++]);
    return out;
}

async function gitDiff(dir) {
    const headOid = await isomorphic.resolveRef({ ...io(dir), ref: 'HEAD' });
    const sections = [];
    for (const [path, head, workdir] of await statusRows(dir)) {
        if (head === 0 || workdir === head) continue;
        const { blob } = await isomorphic.readBlob({ ...io(dir), oid: headOid, filepath: path });
        const before = new TextDecoder().decode(blob);
        const after = workdir === 0 ? '' : await fsp.readFile(`${dir}/${path}`, 'utf8');
        const lines = changedLines(before, after);
        if (lines.length === 0) continue;
        sections.push([`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, ...lines].join('\n'));
    }
    return sections.join('\n');
}

async function gitAdd(dir, paths) {
    const all = paths.length === 0 || paths.includes('.');
    let count = 0;
    for (const [path, , workdir, stage] of await statusRows(dir)) {
        if (!all && !paths.includes(path)) continue;
        if (workdir === 0 && stage === 0) continue;
        if (workdir === 0) await isomorphic.remove({ ...io(dir), filepath: path });
        else if (workdir !== stage) await isomorphic.add({ ...io(dir), filepath: path });
        else continue;
        count++;
    }
    return `staged ${count} path${count === 1 ? '' : 's'}`;
}

async function gitInit(dir) {
    await isomorphic.init(io(dir));
    return `initialized empty repository in ${dir}/.git/`;
}

async function gitBranches(dir) {
    const current = await isomorphic.currentBranch(io(dir));
    return (await isomorphic.listBranches(io(dir))).map((name) => `${name === current ? '*' : ' '} ${name}`).join('\n');
}

async function gitCreateBranch(dir, name) {
    await isomorphic.branch({ ...io(dir), ref: name });
    return `created branch ${name}`;
}

async function gitCheckout(dir, args) {
    const create = args[0] === '-b';
    const name = create ? args[1] : args[0];
    if (!name || args.length !== (create ? 2 : 1)) throw new Error('checkout takes one branch name, or -b <name>; paths and other flags are not supported in the in-page shell');
    if (create) await isomorphic.branch({ ...io(dir), ref: name });
    await isomorphic.checkout({ ...io(dir), ref: name });
    return `switched to ${name}`;
}

async function gitCommit(dir, message) {
    if (!message) throw new Error('commit needs -m <message>');
    const gateResult = await gate.runCommitGate({ lib: isomorphic, fs: { promises: fsp }, dir, rows: await statusRows(dir) });
    if (!gateResult.ok) {
        const failed = gateResult.checks.filter((item) => !item.ok).map((item) => `${item.name}: ${item.detail}`);
        throw new Error(`commit refused by the in-page gate: ${failed.join('; ')}`);
    }
    const oid = await isomorphic.commit({ ...io(dir), message, author: GIT_AUTHOR });
    return [
        ...gateResult.checks.map((item) => `gate ${item.name}: ${item.detail}`),
        `committed ${oid.slice(0, 7)}`,
    ].join('\n');
}

async function gitMain(argv, dir) {
    const [sub, ...rest] = argv;
    const tasks = {
        '--version': () => `git version ${isomorphic.version()} (in-page, isomorphic-git)`,
        init: () => gitInit(dir),
        status: () => gitStatus(dir),
        log: () => gitLog(dir, valueOf(rest, '-n')),
        diff: () => gitDiff(dir),
        add: () => gitAdd(dir, rest),
        commit: () => gitCommit(dir, valueOf(rest, '-m')),
        branch: () => {
            if (rest.length === 0) return gitBranches(dir);
            if (rest[0].startsWith('-') || rest.length > 1) throw new Error('branch flags and multiple names are not supported in the in-page shell');
            return gitCreateBranch(dir, rest[0]);
        },
        checkout: () => gitCheckout(dir, rest),
    };
    const task = tasks[sub];
    if (!task) throw new Error(`git ${sub ?? ''}: the in-page shell supports init, status, log, diff, add, commit, and local branch and checkout; push, fetch and pull are not supported in the in-page shell`);
    return task();
}
