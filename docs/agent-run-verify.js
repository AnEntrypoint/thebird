// agent-run-verify: when a chat turn's agent wrote file(s), install any
// declared npm dependency and execute the agent's declared RUN:/FILE:
// command for real, then read the file(s) back from instance.fs to prove
// they exist -- the exact rigor docs/autocode-app.js's dedicated pipeline
// used to provide only inside its own standalone app. Folded into the
// normal chat/assistant turn (docs/freddie-chat.js) instead of a separate
// app: any ordinary conversation where the model writes files gets this
// automatically, no mode toggle. A turn that writes nothing is a no-op
// here (extractWrittenFiles returns []) so plain conversational chat is
// unaffected.
//
// Scope note: this module belongs to THEBIRD's own chat wrapper only. It
// is never imported by the vendored freddie bundle/package itself, so
// other freddie consumers (e.g. a sibling project's server-side agent
// with its own domain tools) never inherit this behavior -- it only runs
// inside thebird's docs/freddie-chat.js turn loop.

import { createShell } from './shell.js';

const INSTALL_TIMEOUT_MS = 45000; // installOne's own retry/timeout ladder tops out near 45s per package
const EXEC_TIMEOUT_MS = 15000;

// Extract every file the agent's tool_calls wrote this turn, in call order,
// de-duplicated by path (a rewrite supersedes the earlier entry's position).
// Accepts both tool_call shapes seen across call sites: the agent machine's
// own context.messages carries {id, name, arguments}; a re-sent/OpenAI-wire
// copy carries {id, type:'function', function:{name, arguments}}.
export function extractWrittenFiles(agentMsgs) {
    const seen = new Set();
    const writtenFiles = [];
    for (const m of (agentMsgs || [])) {
        if (!m || m.role !== 'assistant' || !Array.isArray(m.tool_calls)) continue;
        for (const tc of m.tool_calls) {
            if (!tc) continue;
            const name = tc.name || (tc.function && tc.function.name);
            if (name !== 'write') continue;
            const rawArgs = tc.arguments != null ? tc.arguments : (tc.function && tc.function.arguments);
            let args = null;
            try { args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs; } catch { /* swallow: malformed tool_call arguments, skip this call's path rather than aborting the whole scan */ }
            const p = args && args.path;
            if (!p) continue;
            if (!seen.has(p)) { seen.add(p); writtenFiles.push(p); }
        }
    }
    return writtenFiles;
}

// Parse the agent's final reply text for the FILE:/RUN: convention (same
// convention docs/autocode-app.js taught its agent turns).
export function parseFileAndRunMarkers(replyText, writtenFiles) {
    const text = String(replyText || '');
    const fm = text.match(/FILE:\s*(\S+)/);
    const filePath = fm ? fm[1] : (writtenFiles.length ? writtenFiles[writtenFiles.length - 1] : null);
    const rm = text.match(/RUN:\s*(.+)/);
    const runCmd = rm ? rm[1].trim() : null;
    return { filePath, runCmd };
}

// Read every written file back from instance.fs to prove it actually
// landed (never trust the agent's claim alone).
export function verifyWrittenFiles(instance, writtenFiles) {
    const fileContents = new Map();
    const results = [];
    for (const p of writtenFiles) {
        const content = instance.fs.readFile(p);
        if (content == null) throw new Error('file "' + p + '" reported written but not found in instance.fs');
        fileContents.set(p, content);
        results.push(p + ' (' + content.length + 'b)');
    }
    return { fileContents, summary: results.join(', ') };
}

function stripAnsi(s) { return s.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '').trim(); }

// Derive the directory to `cd` into before install/execute from the actual
// written paths -- unlike docs/autocode-app.js (which always wrote under a
// hardcoded /work/), regular chat's `write` tool resolves relative to
// whatever the user configured as cfg.agent.cwd (docs/freddie-host.js
// resolveCwd), so the run directory must be derived from where the files
// actually landed, not assumed. Uses the package.json's directory when one
// was written (dependencies/scripts are cwd-relative to it); otherwise the
// entry file's own directory; root ('') means no leading slash needed for `cd`.
function deriveRunDir(writtenFiles) {
    const pkgPath = writtenFiles.find(p => /(^|\/)package\.json$/.test(p));
    const anchor = pkgPath || writtenFiles[0] || '';
    const idx = anchor.lastIndexOf('/');
    return idx === -1 ? '' : anchor.slice(0, idx);
}

async function runInShell(shell, fakeTerm, cmd, timeoutMs) {
    let buf = '';
    fakeTerm.write = (s) => { buf += String(s); };
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve('__timeout__'), timeoutMs));
    const result = await Promise.race([shell.run(cmd).then(() => '__done__'), timeoutPromise]);
    return { timedOut: result === '__timeout__', output: stripAnsi(buf) };
}

// Runs npm install (if a package.json was written) then the RUN:/FILE:
// command, sharing one shell instance across both so the derived `cd`
// persists between them. Returns a short human-readable summary of what
// happened at each stage,
// or null for a stage that did not apply -- the caller renders whichever
// entries are non-null into the chat transcript.
export async function installAndRun({ instance, writtenFiles, filePath, runCmd }) {
    const out = { install: null, execute: null };
    if (!writtenFiles.length) return out;

    const fakeTerm = { write: () => {}, onData: () => {} };
    const shell = createShell({ term: fakeTerm, onPreviewWrite: () => {}, instanceId: instance.id, fs: instance.fs });
    const runDir = deriveRunDir(writtenFiles);
    const cd = runDir ? ('cd /' + runDir + ' && ') : '';

    const wrotePackageJson = writtenFiles.some(p => /(^|\/)package\.json$/.test(p));
    if (wrotePackageJson) {
        const { timedOut, output } = await runInShell(shell, fakeTerm, cd + 'npm install', INSTALL_TIMEOUT_MS);
        if (timedOut) {
            out.install = { ok: false, text: 'npm install exceeded ' + (INSTALL_TIMEOUT_MS / 1000) + 's - dependency fetch likely hung or unreachable' };
        } else if (/install failed:/.test(output)) {
            out.install = { ok: false, text: output.match(/install failed:.*/)[0] };
        } else {
            out.install = { ok: true, text: output || '(no output)' };
        }
    }

    const canExecute = runCmd || (filePath && /\.(m?js)$/i.test(filePath));
    if (canExecute && !(out.install && out.install.ok === false)) {
        const cmd = runCmd ? (cd + runCmd) : ('node /' + filePath.replace(/^\/+/, ''));
        const { timedOut, output } = await runInShell(shell, fakeTerm, cmd, EXEC_TIMEOUT_MS);
        if (timedOut) {
            out.execute = {
                ok: false,
                text: 'execution exceeded ' + (EXEC_TIMEOUT_MS / 1000) + 's - likely an infinite loop or unresolved async operation. '
                    + 'Note: if the generated code is synchronously blocking (e.g. while(true){}), this cannot preempt it '
                    + '(node execution runs on the main thread, no Worker isolation) - reload if the tab is unresponsive.',
            };
        } else {
            out.execute = { ok: true, text: output ? ('output: ' + output.slice(0, 200)) : '(no stdout - ran without error)' };
        }
    }
    return out;
}

// Top-level entry point called from freddie-chat.js's submit() right after
// runAgentTurn resolves. No-ops (returns null) when the turn wrote nothing,
// so ordinary conversational turns are unaffected. On a written-files turn,
// runs install+execute+verify and returns a single summary string for the
// caller to push into the transcript via pushFreddie -- never throws itself
// (callers already wrap the whole submit() body in try/catch, but each
// internal stage is captured into the summary text rather than escaping,
// so one failed stage does not blank out the reply the model already gave).
export async function runInstallExecuteVerify({ instance, agentMsgs, replyText }) {
    const writtenFiles = extractWrittenFiles(agentMsgs);
    if (!writtenFiles.length) return null;

    const { filePath, runCmd } = parseFileAndRunMarkers(replyText, writtenFiles);
    const lines = [];

    let verified;
    try {
        verified = verifyWrittenFiles(instance, writtenFiles);
        lines.push('[verify] ' + writtenFiles.length + '/' + writtenFiles.length + ' file(s) confirmed on disk - ' + verified.summary);
    } catch (e) {
        lines.push('[verify] FAILED - ' + (e && e.message || e));
        return lines.join('\n');
    }

    let stageResult;
    try {
        stageResult = await installAndRun({ instance, writtenFiles, filePath, runCmd });
    } catch (e) {
        lines.push('[run] FAILED - ' + (e && e.message || e));
        return lines.join('\n');
    }
    if (stageResult.install) lines.push('[npm install] ' + (stageResult.install.ok ? stageResult.install.text : 'FAILED - ' + stageResult.install.text));
    if (stageResult.execute) lines.push('[run] ' + (stageResult.execute.ok ? stageResult.execute.text : 'FAILED - ' + stageResult.execute.text));
    return lines.join('\n');
}
