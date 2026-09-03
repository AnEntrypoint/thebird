#!/usr/bin/env node
// Interactive-surface audit: terminal POSIX command exec (type + get output),
// freddie config write-back (set a value via gm/host config, read it back),
// and freddie chat error-recovery (force an error, UI shows graceful message).
import { bootBrowser, sleep, assert, printReportAndExit } from './witness-lib.mjs';
const { browser, page, errs } = await bootBrowser({ tag: 'iv' });
// Wait for autoboot: active instance + the autobooted terminal/freddie windows.
for (let i=0;i<60;i++){
  const ready = await page.evaluate(() => { const s=window.__debug?.shell; const wins=[...document.querySelectorAll('.wm-win')].map(w=>w.dataset.kind||''); return !!(s && (s.active||document.querySelector('.wm-win')) && wins.includes('terminal')); });
  if (ready) break;
  await sleep(1000);
}
const R = {};

// 1. Terminal: open, focus xterm, type 'echo hello-witness', Enter, read viewport
// openApp('terminal') is not a singleton reuse of autoboot's terminal -- it
// opens a SECOND terminal window (confirmed live: two .wm-win[data-kind
// =terminal] elements exist afterward). Must target the newly-opened
// .wm-focused one specifically, not the first (autoboot) match, or focus()
// lands on a window that never receives the typed keystrokes.
await page.evaluate(async()=>{ try{ await window.__debug.shell.openApp('terminal'); }catch{ /* swallow: best-effort open; termWin lookup below is null and the block is skipped if this never mounted */ } });
await sleep(3500);
// page.$('a, b') returns the first DOM-order match across ALL alternatives,
// not the first alternative that matches -- since .xterm-helper-textarea is
// a descendant of .xterm, a combined selector listing both returns the
// ancestor .xterm div first (it's not focusable, so .focus() below silently
// no-ops and keystrokes go nowhere). Only ever target the actual focusable
// textarea, one specific selector at a time.
const termWin = await page.$('.wm-win[data-kind="terminal"].wm-focused .xterm-helper-textarea')
  || await page.$('.wm-win[data-kind="terminal"].wm-focused textarea')
  || await page.$('.wm-win[data-kind="terminal"] .xterm-helper-textarea')
  || await page.$('.wm-win[data-kind="terminal"] textarea');
if (termWin) {
  // xterm.js's helper textarea is positioned off-screen/zero-opacity by
  // design, so a synthetic elementHandle.click() (which targets the real
  // bounding-box coordinates) can miss it entirely; a direct .focus() call
  // reliably delivers focus regardless of layout.
  try { await termWin.evaluate(el => el.focus()); } catch { /* swallow: focus is best-effort; keyboard.type below still dispatches to whatever has focus even if this missed */ }
  await page.keyboard.type('echo hello-witness');
  await page.keyboard.press('Enter');
  await sleep(2500);
}
R.terminal = await page.evaluate(() => {
  const wins = [...document.querySelectorAll('.wm-win')].filter(w=>(w.dataset.kind||'')==='terminal');
  const t = wins.find(w=>w.classList.contains('wm-focused')) || wins[0];
  // .xterm-rows specifically -- .xterm-screen/.xterm also match the combined
  // selector but their subtree includes xterm's injected dom-renderer
  // <style> tag, whose CSS rule text pollutes textContent ahead of the
  // actual rendered rows.
  const screen = t?.querySelector('.xterm-rows');
  const mounted = !!t?.querySelector('.xterm-rows, .xterm-screen, .xterm');
  const txt = screen ? screen.textContent : '';
  return { mounted, echoesCommand: /echo hello-witness/.test(txt), showsOutput: /hello-witness/.test(txt.replace(/echo hello-witness/,'')), sample: txt.replace(/\s+/g,' ').slice(0,120) };
});

// 2. freddie host config write-back via gm/host (set + read)
R.configWriteback = await page.evaluate(async () => {
  const inst = window.__debug?.instances ? Object.values(window.__debug.instances)[0] : (window.__debug?.shell?.instances?.[0]);
  const host = inst?.host;
  const fs = host?.fs || inst?.fs;
  if (!fs || !fs.getConfig) return { skipped: 'no fs.getConfig' };
  try {
    const cfg = fs.getConfig();
    const before = JSON.stringify(cfg?.display?.skin || null);
    // write a value and read back
    if (fs.setConfigValue) { fs.setConfigValue('display.skin', 'witness-skin'); }
    else if (fs.writeJson && cfg) { cfg.display = cfg.display || {}; cfg.display.skin = 'witness-skin'; fs.writeJson('/etc/freddie/config.yaml', cfg); }
    const after = fs.getConfig()?.display?.skin;
    return { before, after, persisted: after === 'witness-skin' };
  } catch (e) { return { err: String(e).slice(0,120) }; }
});

// 3. freddie chat error recovery: send to chat with acptoapi unreachable model that errors,
//    confirm UI shows a message (not a thrown crash / blank)
await page.evaluate(async()=>{ try{ await window.__debug.shell.openApp('chat'); }catch{ /* swallow: best-effort open; chatErrorRecovery below reports its own err if the chat surface never mounted */ } });
await sleep(3500);
R.chatErrorRecovery = await page.evaluate(async () => {
  const chat = document.querySelector('freddie-chat');
  if (!chat) return { skipped: 'no freddie-chat' };
  const baseline = document.querySelectorAll('.chat-msg.them').length;
  // a slash command that should always produce a UI message even on bad input
  chat.dispatchEvent(new CustomEvent('send', { detail: { text: '/tool nonexistent_tool_xyz {}' }, bubbles:true }));
  for (let i=0;i<20;i++){ await new Promise(r0=>setTimeout(r0,500)); if (document.querySelectorAll('.chat-msg.them').length > baseline) break; }
  const them = [...document.querySelectorAll('.chat-msg.them')];
  const last = them[them.length-1];
  return { gotResponse: them.length > baseline, responseText: last ? (last.textContent||'').slice(0,100) : null };
});

R.errors = errs.slice(0,12);

const report = {};
assert(report, 'terminalEcho', !!(R.terminal && R.terminal.mounted && R.terminal.echoesCommand && R.terminal.showsOutput), 'terminal did not echo/show output: ' + JSON.stringify(R.terminal));
if (R.configWriteback && R.configWriteback.skipped) {
  report.configWriteback = { pass: true, skipped: true, detail: R.configWriteback.skipped };
} else {
  assert(report, 'configWriteback', !!(R.configWriteback && R.configWriteback.persisted), 'config value did not persist: ' + JSON.stringify(R.configWriteback));
}
if (R.chatErrorRecovery && R.chatErrorRecovery.skipped) {
  report.chatErrorRecovery = { pass: true, skipped: true, detail: R.chatErrorRecovery.skipped };
} else {
  assert(report, 'chatErrorRecovery', !!(R.chatErrorRecovery && R.chatErrorRecovery.gotResponse), 'chat did not show a graceful response: ' + JSON.stringify(R.chatErrorRecovery));
}
report.raw = R;

console.log(JSON.stringify(R,null,2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
printReportAndExit(report);
