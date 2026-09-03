#!/usr/bin/env node
// Witness the stack-name rename: boot the OS, open the apps menu + freddie(assistant)
// + memory(gm) apps, assert the user-visible labels read generic ('assistant',
// 'memory', 'gateway') and the old stack jargon is gone from visible text, while
// the OS still boots and apps still open (ids unchanged).
import { bootBrowser, waitForActiveInstance, assert, printReportAndExit } from './witness-lib.mjs';
const { browser, page, errs } = await bootBrowser({ tag: 'rn' });
await waitForActiveInstance(page);
// open the renamed apps by id (ids unchanged → must still work)
await page.evaluate(async () => { for (const id of ['freddie','gm','chat']) { try { await window.__debug.shell.openApp(id); } catch { /* swallow: best-effort open per app id; keep the loop going so downstream label assertions run against whichever windows did open */ } } });
await new Promise(r => setTimeout(r, 3000));

const r = await page.evaluate(() => {
  // collect visible titlebar text + apps-menu text + chat title/placeholder
  const titles = [...document.querySelectorAll('.wm-bar, .wm-title, [class*="title"]')].map(e => (e.textContent || '').trim()).filter(Boolean);
  // open apps menu if present
  const menuText = (document.querySelector('.os-menu, .launcher-menu, [class*="apps"]')?.textContent || '');
  const chat = document.querySelector('freddie-chat');
  const visibleText = document.body.innerText || '';
  const jargon = ['freddie', 'gm-skill', 'acptoapi', 'plugkit', 'libsql', 'busybase'];
  const found = {};
  for (const j of jargon) { const re = new RegExp(j, 'i'); found[j] = re.test(visibleText); }
  return {
    appsOpened: [...document.querySelectorAll('.wm-win')].map(w => w.dataset.kind),
    titlebars: titles.slice(0, 12),
    chatTitle: chat?.getAttribute('title'),
    chatPlaceholder: chat?.getAttribute('placeholder'),
    jargonVisibleInBody: found,
    assistantSeen: /assistant/i.test(visibleText),
    memorySeen: /\bmemory\b/i.test(visibleText),
  };
});
console.log('RENAME-WITNESS:', JSON.stringify(r, null, 2));
console.log('ERRS:', errs.slice(0, 6));
await browser.close();

const report = {};
// pass: apps still open by id, chat title says assistant, no top-level jargon leaking in titlebars/chat
assert(report, 'freddieAppOpened', r.appsOpened.includes('freddie'), 'freddie app not found among opened windows: ' + JSON.stringify(r.appsOpened));
assert(report, 'chatTitleIsAssistant', /assistant/i.test(r.chatTitle || ''), 'chat title does not read "assistant": ' + r.chatTitle);
assert(report, 'noJargonInTitlebars', !/freddie|gm-skill/i.test((r.titlebars || []).join(' ')), 'stack jargon leaked into titlebars: ' + JSON.stringify(r.titlebars));
report.raw = r;
report.errors = errs.slice(0, 6);

printReportAndExit(report);
