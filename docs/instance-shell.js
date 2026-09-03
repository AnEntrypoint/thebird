export function createInstanceShell({ fs, container, title }) {
    const jobs = [];
    if (container) {
        const pre = document.createElement('pre');
        pre.className = 'app-shell-pane';
        pre.textContent = (title || 'sh') + ' ready\n';
        container.appendChild(pre);
        container._pre = pre;
    }
    function write(line) {
        const pre = container && container._pre;
        if (pre) { pre.textContent += line + '\n'; pre.scrollTop = pre.scrollHeight; }
    }
    async function exec(line) {
        const argv = String(line || '').trim().split(/\s+/);
        const cmd = argv[0];
        if (!cmd) return '';
        if (cmd === 'echo') { jobs.push({ cmd: line, ts: Date.now() }); const out = argv.slice(1).join(' '); write('$ ' + line); write(out); return out; }
        if (cmd === 'write') {
            const path = argv[1]; const body = argv.slice(2).join(' ');
            if (!path) { write('$ ' + line); write('write: missing path'); return ''; }
            await fs.writeFile(path, body); await fs.flush();
            write('$ ' + line); return '';
        }
        if (cmd === 'cat') {
            const path = argv[1];
            if (!path) { write('$ ' + line); write('cat: missing path'); return ''; }
            if (!await fs.exists(path)) { write('$ ' + line); write('cat: ' + path + ': No such file or directory'); throw new Error('cat: ' + path + ': No such file or directory'); }
            const txt = await fs.readFile(path);
            write('$ ' + line); write(txt); return txt;
        }
        if (cmd === 'ls') {
            const list = await fs.list(argv[1] || '/');
            const out = list.join('\n'); write('$ ' + line); write(out); return out;
        }
        write('$ ' + line); write(cmd + ': command not found'); return '';
    }
    function dispose() {
        if (container && container._pre) container._pre.remove();
    }
    return { exec, jobs, dispose, kind: 'instance-shell' };
}
