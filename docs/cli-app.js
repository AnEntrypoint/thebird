// cli-app.js: a generic adapter that turns a shell-command spec into a full
// app -- same terminal substrate terminalApp already uses (xterm + FitAddon +
// docs/shell.js's createShell), auto-running a command line on mount instead
// of requiring a hand-written DOM factory per CLI-style app. This is the
// "apps must be able to be proper cli apps" surface: point createCliApp at a
// command, get a real interactive terminal pane wired to the instance's
// sandboxed POSIX shell + IndexedDB filesystem, with zero new CSS (reuses the
// same renderTerminal kit component and app-canvas-free layout terminalApp
// already ships).
//
// spec shape: { cmd: string, title?: string, statusText?: string }
// `cmd` is an author-time string baked into the app registration (apps.js),
// never runtime/user-supplied text interpolated unescaped -- it is handed to
// shell.run() exactly the way a human typing at the terminal would, so it
// carries the same trust boundary as terminalApp itself, not a new one.

import { t } from './vendor/i18n.js';

function createCliApp({ instance, spec, Terminal, FitAddon, createShell, renderTerminal }) {
    const cmd = (spec && spec.cmd) || '';
    const pane = renderTerminal({ title: (spec && spec.title) || (instance.id + ':cli'), statusText: (spec && spec.statusText) || t('cli.statusReady', 'ready') });
    const term = new Terminal({ convertEol: true, fontSize: 13 });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(pane.slot);
    fit.fit();
    const onResize = () => { try { fit.fit(); } catch { /* swallow: fit can throw if the pane is mid-teardown when a resize fires, non-fatal */ } };
    window.addEventListener('resize', onResize);

    const shell = createShell({ term, onPreviewWrite: () => {}, instanceId: instance.id, fs: instance.fs });

    if (!cmd) {
        term.write(t('cli.noCmdConfigured', 'cli-app: no cmd configured in spec') + '\r\n');
    } else {
        // Fire-and-forget: the shell surfaces its own errors (including
        // "command not found") into the terminal pane, same as a human typing
        // the command themselves -- no separate try/catch swallowing needed.
        shell.run(cmd);
    }

    return {
        node: pane.node,
        dispose: () => {
            window.removeEventListener('resize', onResize);
            try { term.dispose(); } catch { /* swallow: terminal may already be disposed (double-dispose during teardown races), safe to ignore */ }
        },
    };
}

export { createCliApp };
