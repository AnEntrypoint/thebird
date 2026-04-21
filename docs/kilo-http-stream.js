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
  Object.assign(window.__debug = window.__debug || {}, { kilo: { sessionId, url: base, fsBase, writes: [], lastStatus: null } });

  const es = new EventSource(base + '/event');
  const pendingWrites = new Set();
  es.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'message.part.updated') {
        const part = msg.properties?.part;
        if (part?.type === 'tool' && part.state?.status === 'completed' && (part.tool === 'write' || part.tool === 'edit')) {
          const abs = part.state.input?.filePath;
          if (abs) pendingWrites.add(abs);
        }
      }
    } catch (_) {}
  };

  const userText = messages.filter(m => m.role === 'user').map(m =>
    typeof m.content === 'string' ? m.content : (m.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  ).join('\n');

  const body = { parts: [{ type: 'text', text: userText }], providerID: 'kilo', modelID: model || 'x-ai/grok-code-fast-1:optimized:free' };
  const msgRes = await fetch(base + '/session/' + sessionId + '/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  window.__debug.kilo.lastStatus = msgRes.status;
  if (!msgRes.ok) { es.close(); throw new Error('kilo message ' + msgRes.status + ': ' + await msgRes.text()); }
  const result = await msgRes.json();
  window.__debug.kilo.lastResult = result;
  es.close();
  const mirrored = await mirrorFromSandbox(fsBase, [...pendingWrites]);
  window.__debug.kilo.writes = mirrored;
  if (mirrored.length) window.refreshPreview?.();
  const textParts = (result.parts || []).filter(p => p.type === 'text');
  for (const tp of textParts) yield { type: 'text-delta', textDelta: tp.text };
  if (mirrored.length) yield { type: 'text-delta', textDelta: '\n\n[mirrored to preview: ' + mirrored.join(', ') + ']' };
  yield { type: 'finish-step', finishReason: result.info?.finish || 'stop' };
}
