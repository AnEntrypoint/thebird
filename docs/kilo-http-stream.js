import { mirrorFromSandbox } from './kilo-fs-mirror.js';

export async function* streamKiloHTTP({ url, model, messages, providerType, agent }) {
  yield { type: 'start-step' };
  const base = (url || 'http://localhost:4780').replace(/\/$/, '');
  const fsBase = base.replace(/:\d+$/, ':4781');
  const isOpencode = providerType === 'opencode';
  const dbgKey = isOpencode ? 'opencode' : 'kilo';
  let sessRes;
  try { sessRes = await fetch(base + '/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); }
  catch (e) { throw new Error(dbgKey + ' serve not reachable at ' + base + ' — start it with: node start-kilo.js --origin ' + location.origin); }
  if (!sessRes.ok) throw new Error('/session ' + sessRes.status + ': ' + await sessRes.text());
  const { id: sessionId } = await sessRes.json();
  Object.assign(window.__debug = window.__debug || {}, { [dbgKey]: { sessionId, url: base, fsBase, lastStatus: null } });

  const userText = messages.filter(m => m.role === 'user').map(m =>
    typeof m.content === 'string' ? m.content : (m.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  ).join('\n');

  const modelId = model || 'x-ai/grok-code-fast-1:optimized:free';
  const codingIntent = /\b(write|create|make|build|generate|save|file|html|css|script|app|page|code)\b/i.test(userText);
  const agentName = agent || (codingIntent ? 'code' : 'ask');
  const body = { parts: [{ type: 'text', text: userText }], agent: agentName };
  if (isOpencode) body.model = { providerID: 'kilo', modelID: modelId };
  else { body.providerID = 'kilo'; body.modelID = modelId; }

  let text = '';
  if (isOpencode) {
    const es = new EventSource(base + '/event');
    const textByPart = new Map();
    const assistantMsgs = new Set();
    let done = false;
    const pending = [];
    let resolveNext = null;
    const push = ev => { pending.push(ev); if (resolveNext) { const r = resolveNext; resolveNext = null; r(); } };
    es.onmessage = e => {
      try {
        const m = JSON.parse(e.data);
        if (m.type === 'message.updated') {
          const info = m.properties?.info;
          if (info?.sessionID === sessionId && info.role === 'assistant') {
            assistantMsgs.add(info.id);
            if (info.time?.completed) { done = true; if (resolveNext) { const r = resolveNext; resolveNext = null; r(); } }
          }
        } else if (m.type === 'message.part.updated') {
          const part = m.properties?.part;
          if (part?.sessionID === sessionId && part.type === 'text' && assistantMsgs.has(part.messageID)) {
            const prior = textByPart.get(part.id) || '';
            const txt = part.text || '';
            if (txt.length > prior.length) { push({ type:'text-delta', textDelta: txt.slice(prior.length) }); textByPart.set(part.id, txt); }
          }
        }
      } catch (_) {}
    };
    const msgRes = await fetch(base + '/session/' + sessionId + '/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    window.__debug[dbgKey].lastStatus = msgRes.status;
    if (!msgRes.ok) { es.close(); throw new Error('message ' + msgRes.status + ': ' + await msgRes.text()); }
    const deadline = Date.now() + 180000;
    while (!done || pending.length) {
      if (pending.length) { const ev = pending.shift(); if (ev.type === 'text-delta') text += ev.textDelta; yield ev; continue; }
      if (Date.now() > deadline) break;
      await new Promise(r => { resolveNext = r; setTimeout(r, 5000); });
    }
    es.close();
  } else {
    const msgRes = await fetch(base + '/session/' + sessionId + '/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    window.__debug[dbgKey].lastStatus = msgRes.status;
    if (!msgRes.ok) throw new Error('message ' + msgRes.status + ': ' + await msgRes.text());
    const result = await msgRes.json();
    window.__debug[dbgKey].lastResult = result;
    for (const tp of (result.parts || []).filter(p => p.type === 'text')) { text += tp.text; yield { type: 'text-delta', textDelta: tp.text }; }
  }
  const mirrored = await mirrorFromSandbox(fsBase);
  if (mirrored.length) { window.__debug[dbgKey].writes = mirrored; window.refreshPreview?.(); }
  yield { type: 'finish-step', finishReason: 'stop' };
}
