export async function* streamKiloHTTP({ url, model, messages }) {
  yield { type: 'start-step' };
  const base = (url || 'http://localhost:4780').replace(/\/$/, '');
  let sessRes;
  try { sessRes = await fetch(base + '/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); }
  catch (e) { throw new Error('kilo serve not reachable at ' + base + ' — start it with: kilo serve --port ' + (new URL(base).port || 4780) + ' --cors ' + location.origin); }
  if (!sessRes.ok) throw new Error('kilo /session ' + sessRes.status + ': ' + await sessRes.text());
  const { id: sessionId } = await sessRes.json();
  Object.assign(window.__debug = window.__debug || {}, { kilo: { sessionId, url: base, lastStatus: null } });

  const userText = messages.filter(m => m.role === 'user').map(m =>
    typeof m.content === 'string' ? m.content : (m.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  ).join('\n');

  const body = { parts: [{ type: 'text', text: userText }], providerID: 'kilo', modelID: model || 'x-ai/grok-code-fast-1:optimized:free', agent: 'hermes-llm' };
  const msgRes = await fetch(base + '/session/' + sessionId + '/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  window.__debug.kilo.lastStatus = msgRes.status;
  if (!msgRes.ok) throw new Error('kilo message ' + msgRes.status + ': ' + await msgRes.text());
  const result = await msgRes.json();
  window.__debug.kilo.lastResult = result;
  const textParts = (result.parts || []).filter(p => p.type === 'text');
  for (const tp of textParts) yield { type: 'text-delta', textDelta: tp.text };
  yield { type: 'finish-step', finishReason: result.info?.finish || 'stop' };
}
