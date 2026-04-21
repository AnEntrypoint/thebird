import { mirrorFromSandbox } from './kilo-fs-mirror.js';

export async function* streamKiloHTTP({ url, model, messages }) {
  yield { type: 'start-step' };
  const base = (url || 'http://localhost:4780').replace(/\/$/, '');
  const fsBase = base.replace(/:\d+$/, ':4781');
  let sessRes;
  try { sessRes = await fetch(base + '/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); }
  catch (e) { throw new Error('kilo serve not reachable at ' + base + ' — start it with: node start-kilo.js --origin ' + location.origin); }
  if (!sessRes.ok) throw new Error('kilo /session ' + sessRes.status + ': ' + await sessRes.text());
  const { id: sessionId } = await sessRes.json();
  Object.assign(window.__debug = window.__debug || {}, { kilo: { sessionId, url: base, fsBase, writes: [], toolCalls: [], lastStatus: null } });

  const queue = [];
  let resolveNext = null;
  let streamEnded = false;
  const push = ev => { queue.push(ev); if (resolveNext) { const r = resolveNext; resolveNext = null; r(); } };
  const textSeen = new Set();
  const toolState = new Map();

  const es = new EventSource(base + '/event');
  es.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type !== 'message.part.updated') return;
      const part = msg.properties?.part;
      if (!part) return;
      if (part.type === 'text' && part.messageID && !textSeen.has(part.id)) {
        const prior = toolState.get('__text_' + part.id) || '';
        const txt = part.text || '';
        if (txt.length > prior.length) { push({ type: 'text-delta', textDelta: txt.slice(prior.length) }); toolState.set('__text_' + part.id, txt); }
      } else if (part.type === 'tool') {
        const cid = part.callID;
        const st = part.state?.status;
        if (st === 'running' && !toolState.has(cid)) {
          toolState.set(cid, { name: part.tool, args: part.state.input || {} });
          push({ type: 'tool-call', toolCallId: cid, toolName: part.tool, args: part.state.input || {} });
          window.__debug.kilo.toolCalls.push({ id: cid, name: part.tool, args: part.state.input || {} });
        } else if (st === 'completed' && toolState.has(cid) && !toolState.get(cid).completed) {
          toolState.get(cid).completed = true;
          push({ type: 'tool-result', toolCallId: cid, toolName: part.tool, args: part.state.input || {}, result: part.state.output || '' });
        }
      }
    } catch (_) {}
  };

  const userText = messages.filter(m => m.role === 'user').map(m =>
    typeof m.content === 'string' ? m.content : (m.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  ).join('\n');

  const body = { parts: [{ type: 'text', text: userText }], providerID: 'kilo', modelID: model || 'x-ai/grok-code-fast-1:optimized:free' };
  const msgPromise = fetch(base + '/session/' + sessionId + '/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => {
    window.__debug.kilo.lastStatus = r.status;
    const json = await r.json();
    window.__debug.kilo.lastResult = json;
    streamEnded = true;
    if (resolveNext) { const x = resolveNext; resolveNext = null; x(); }
    return json;
  });

  while (!streamEnded || queue.length) {
    if (queue.length) { yield queue.shift(); continue; }
    await new Promise(r => { resolveNext = r; });
  }
  const result = await msgPromise;
  es.close();
  const touched = [...toolState.values()].filter(v => v.completed && (v.name === 'write' || v.name === 'edit')).map(v => v.args.filePath).filter(Boolean);
  const mirrored = await mirrorFromSandbox(fsBase, touched);
  window.__debug.kilo.writes = mirrored;
  if (mirrored.length) window.refreshPreview?.();
  yield { type: 'finish-step', finishReason: result.info?.finish || 'stop' };
}
