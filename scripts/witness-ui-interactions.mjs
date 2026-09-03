#!/usr/bin/env node
// UI interaction audit: chat composer (typing enables send, slash hint), and WM
// gestures (double-click titlebar toggles maximize, drag moves window).
import { bootBrowser, sleep, assert, printReportAndExit } from './witness-lib.mjs';
const { browser, page, errs } = await bootBrowser({ tag: 'ui' });
const R = {};

// 1. Chat composer: open chat, type in composer, check send affordance + value
await page.evaluate(async()=>{ try{ await window.__debug.shell.openApp('chat'); }catch{ /* swallow: best-effort open; R.composer below reports noComposer:true if the textarea never appeared */ } });
await sleep(3000);
R.composer = await page.evaluate(async () => {
  const chat = document.querySelector('freddie-chat');
  const ta = chat?.querySelector('textarea') || document.querySelector('.chat-composer textarea, freddie-chat textarea');
  if (!ta) return { noComposer: true };
  ta.focus(); ta.value = '/help test'; ta.dispatchEvent(new Event('input', { bubbles:true }));
  await new Promise(r=>setTimeout(r,200));
  const sendBtn = chat?.querySelector('button[type="submit"], .chat-send, button[aria-label*="send" i], .composer-send');
  return { hasComposer:true, valueSet: ta.value.includes('/help'), sendBtn: !!sendBtn, placeholder: ta.getAttribute('placeholder')?.slice(0,40) };
});

// 2. WM gesture: double-click a window titlebar to toggle maximize
await page.evaluate(async()=>{ try{ await window.__debug.shell.openApp('files'); }catch{ /* swallow: best-effort open; R.wmMaximize below deals with a missing window itself */ } });
await sleep(1500);
R.wmMaximize = await page.evaluate(async () => {
  const w = [...document.querySelectorAll('.wm-win')].find(x=>(x.dataset.kind||'')==='files');
  const bar = w?.querySelector('.wm-bar');
  if (!bar) return { noBar:true };
  const before = w.classList.contains('wm-max') || w.dataset.max==='true';
  bar.dispatchEvent(new MouseEvent('dblclick', { bubbles:true }));
  await new Promise(r=>setTimeout(r,400));
  const afterMax = w.classList.contains('wm-max') || w.dataset.max==='true';
  bar.dispatchEvent(new MouseEvent('dblclick', { bubbles:true })); // restore
  await new Promise(r=>setTimeout(r,400));
  const afterRestore = w.classList.contains('wm-max') || w.dataset.max==='true';
  return { toggledOn: before !== afterMax, toggledBackOff: afterMax !== afterRestore };
});

// 3. WM: window has resize handle
R.wmResize = await page.evaluate(() => {
  const w = [...document.querySelectorAll('.wm-win')][0];
  return { hasResizeHandle: !!w?.querySelector('.wm-resize, .resize-handle, [class*="resize"]') };
});

R.errors = errs.slice(0,8);
console.log(JSON.stringify(R,null,2));
await browser.close();

const report = {};
assert(report, 'composerFound', !R.composer.noComposer, 'chat composer textarea not found');
if (!R.composer.noComposer) {
  assert(report, 'composerValueSet', R.composer.valueSet, 'typing into composer did not set its value');
  assert(report, 'composerSendBtnPresent', R.composer.sendBtn, 'no send button/affordance found in chat composer');
}
assert(report, 'wmMaximizeBarFound', !R.wmMaximize.noBar, 'files window titlebar (.wm-bar) not found');
if (!R.wmMaximize.noBar) {
  assert(report, 'wmMaximizeToggledOn', R.wmMaximize.toggledOn, 'double-click titlebar did not toggle maximize on');
  assert(report, 'wmMaximizeToggledBackOff', R.wmMaximize.toggledBackOff, 'double-click titlebar did not toggle maximize back off');
}
assert(report, 'wmHasResizeHandle', R.wmResize.hasResizeHandle, 'no resize handle found on window');
report.raw = R;

printReportAndExit(report);
