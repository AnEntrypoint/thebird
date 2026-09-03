// terminal-app: xterm + docs/shell.js (POSIX shell) rendered inside a WM
// window. Extracted from docs/apps.js (pure code motion, no behavior change).
import { Terminal, FitAddon } from './vendor/xterm-bundle.js';
import { createShell } from './shell.js';
import { renderTerminal } from './vendor/kits/os/index.js';
import { resolveInstance } from './apps.js';

export function terminalApp(ctx) {
    const instance = resolveInstance(ctx);
    const pane = renderTerminal({ title: instance.id + ':term', statusText: 'ready' });
    const term = new Terminal({ convertEol: true, fontSize: 13 });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(pane.slot);
    fit.fit();
    const onResize = () => { try { fit.fit(); } catch { /* swallow: fit addon best-effort, terminal may not be attached/visible yet */ } };
    window.addEventListener('resize', onResize);

    if (!window.__debug) window.__debug = {};
    window.__debug.idbSnapshot = instance.fs.snapshot;
    window.__debug.idbPersist = () => instance.fs.flush();

    const shell = createShell({ term, onPreviewWrite: () => {}, instanceId: instance.id, fs: instance.fs });

    const writeLn = s => term.write(String(s).replace(/\n/g, '\r\n') + '\r\n');
    shell.addBuiltins({
        async xinfo() {
            if (!instance.xdisplay) return writeLn('xinfo: no xdisplay open');
            const d = instance.xdisplay;
            const root = d._internal.windows.get(d.root);
            writeLn([
                `display: ${d.display}`,
                `root window: 0x${d.root.toString(16)} (${root.w}x${root.h})`,
                `windows: ${d._internal.windows.size}`,
                `pixmaps: ${d._internal.pixmaps.size}`,
                `gcs: ${d._internal.gcs.size}`,
                `cursors: ${d._internal.cursors.size}`,
                `atoms: ${d._internal.atoms.size}`,
                `pending events: ${d.pendingEvents()}`,
            ].join('\n'));
        },
        async xprop(args) {
            if (!instance.xdisplay) return writeLn('xprop: no xdisplay open');
            const d = instance.xdisplay;
            const wid = args[0] ? (args[0].startsWith('0x') ? parseInt(args[0], 16) : parseInt(args[0], 10)) : d.root;
            const w = d._internal.windows.get(wid);
            if (!w) return writeLn('xprop: BadWindow ' + args[0]);
            const out = [`window: 0x${wid.toString(16)}`, `geometry: ${w.x},${w.y} ${w.w}x${w.h}`, `mapped: ${w.mapped}`];
            const prefix = wid + ':';
            for (const [k, v] of d._internal.properties.entries()) {
                if (!k.startsWith(prefix)) continue;
                const aid = +k.slice(prefix.length);
                const aname = d._internal.atoms.get(aid) || ('#' + aid);
                out.push(`${aname}: ${typeof v.data === 'string' ? v.data : JSON.stringify(v.data)}`);
            }
            writeLn(out.join('\n'));
        },
        async xrun(args) {
            const name = args[0];
            const m = await import('./x-client.js');
            if (!name || name === 'list') return writeLn(Object.keys(m.X_PROGRAMS).join(' '));
            if (!instance.xclient) {
                if (window.__debug && window.__debug.shell && typeof window.__debug.shell.openApp === 'function') {
                    await window.__debug.shell.openApp('xdisplay');
                    for (let i = 0; i < 30 && !instance.xclient; i++) await new Promise(r => setTimeout(r, 50));
                }
                if (!instance.xclient) return writeLn('xrun: no xdisplay open');
            }
            try { m.runXProgram(instance.xclient, name); writeLn(`xrun ${name}: drew on display ${instance.xdisplay.display}`); }
            catch (e) { writeLn(`xrun: ${e.message}`); }
        },
        async freddie(args) {
            if (!instance.host) {
                const mod = await import('./freddie-host.js');
                instance.host = await mod.bootHost({ fs: instance.fs });
            }
            const host = instance.host;
            const sub = args[0] || 'help';
            if (sub === 'tools') return writeLn([...host.pi.tools.keys()].sort().join('\n'));
            if (sub === 'skills') return writeLn([...host.pi.skills.keys()].sort().join('\n'));
            if (sub === 'cli') return writeLn([...host.pi.cli.keys()].sort().join('\n'));
            if (sub === 'tool') {
                const tname = args[1];
                const json = args.slice(2).join(' ');
                let inp = {}; try { inp = json ? JSON.parse(json) : {}; } catch { return writeLn('assistant tool: invalid JSON'); }
                const r = await host.runTool(tname, inp);
                return writeLn(JSON.stringify(r, null, 2));
            }
            if (sub === 'run' || sub === 'exec') {
                const r = await host.runCli(sub, args.slice(1).join(' '));
                return writeLn(typeof r === 'string' ? r : JSON.stringify(r, null, 2));
            }
            writeLn('freddie subcommands: tools | skills | cli | tool <name> <json> | run <prompt> | exec <prompt>');
        },
    });
    const handle = {
        instanceId: instance.id,
        title: instance.id + ':term',
        get cwd() { return shell.cwd; },
        get env() { return shell.env; },
        get history() { return shell.history; },
        async exec(cmd) {
            let buf = '';
            const orig = term.write.bind(term);
            term.write = s => { buf += String(s); orig(s); };
            try { await shell.run(cmd); } finally { term.write = orig; }
            return buf.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '');
        },
        write(s) { term.write(String(s).replace(/\n/g, '\r\n')); },
        focus() { term.focus(); },
        dispose() {
            window.removeEventListener('resize', onResize);
            try { term.dispose(); } catch { /* swallow: cleanup on window close, terminal may already be disposed */ }
        },
        get raw() { return { term, shell }; },
    };
    instance.shells.push(handle);
    if (!window.__debug.instances) window.__debug.instances = {};
    if (!window.__debug.instances[instance.id]) window.__debug.instances[instance.id] = {};
    const list = window.__debug.instances[instance.id].shells = window.__debug.instances[instance.id].shells || [];
    list.push(handle);
    return { node: pane.node, dispose: () => { handle.dispose(); pane.dispose(); } };
}
