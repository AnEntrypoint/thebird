import { mirrorFromSandbox } from './kilo-fs-mirror.js';

const PART_HANDLERS = {
  text: (part, st, emit) => {
    const prior = st.textByPart.get(part.id) || '';
    const txt = part.text || '';
    if (txt.length > prior.length) {
      emit({ type: 'text-delta', textDelta: txt.slice(prior.length) });
      st.textByPart.set(part.id, txt);
    }
  },
  reasoning: (part, st, emit) => {
    const prior = st.reasonByPart.get(part.id) || '';
    const txt = part.text || '';
    if (txt.length > prior.length) {
      emit({ type: 'reasoning-delta', textDelta: txt.slice(prior.length) });
      st.reasonByPart.set(part.id, txt);
    }
  },
  tool: (part, st, emit) => {
    const sig = part.id + ':' + (part.state?.status || '') + ':' + JSON.stringify(part.state?.input || '').length + ':' + (part.state?.output ? 1 : 0);
    if (st.seenTool.has(sig)) return;
    st.seenTool.add(sig);
    emit({ type: 'tool-event', toolName: part.tool || part.state?.tool, status: part.state?.status, input: part.state?.input, output: part.state?.output, error: part.state?.error, id: part.id });
  },
  file: (part, st, emit) => {
    if (st.seenFile.has(part.id)) return;
    st.seenFile.add(part.id);
    emit({ type: 'file-event', filename: part.filename || part.path, mime: part.mime, url: part.url, id: part.id });
  },
  'step-start': (part, st, emit) => { if (!st.seenStep.has(part.id+':start')) { st.seenStep.add(part.id+':start'); emit({ type: 'step-start', id: part.id }); } },
  'step-finish': (part, st, emit) => { if (!st.seenStep.has(part.id+':finish')) { st.seenStep.add(part.id+':finish'); emit({ type: 'step-finish', id: part.id, tokens: part.tokens, cost: part.cost }); st.stepFinished = true; } },
};

function makeState() { return { textByPart: new Map(), reasonByPart: new Map(), seenTool: new Set(), seenFile: new Set(), seenStep: new Set(), stepFinished: false }; }

export async function* streamKiloHTTP({ url, model, messages, providerType, agent }) {
  yield { type: 'start-step' };
  const base = (url || 'http://localhost:4780').replace(/\/$/, '');
  const fsBase = base.replace(/:\d+$/, ':4781');
  const isOpencode = providerType === 'opencode';
  const dbgKey = isOpencode ? 'opencode' : 'kilo';
  yield { type: 'status', message: 'connecting ' + base };
  let sessRes;
  try { sessRes = await fetch(base + '/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); }
  catch (e) { throw new Error(dbgKey + ' serve not reachable at ' + base + ' — start it with: node start-kilo.js --origin ' + location.origin); }
  if (!sessRes.ok) throw new Error('/session ' + sessRes.status + ': ' + await sessRes.text());
  const { id: sessionId } = await sessRes.json();
  Object.assign(window.__debug = window.__debug || {}, { [dbgKey]: { sessionId, url: base, fsBase, lastStatus: null, events: [] } });
  yield { type: 'status', message: 'session ' + sessionId.slice(0, 8) };

  const userText = messages.filter(m => m.role === 'user').map(m =>
    typeof m.content === 'string' ? m.content : (m.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  ).join('\n');

  const modelId = model || (isOpencode ? 'minimax-m2.5-free' : 'x-ai/grok-code-fast-1:optimized:free');
  const body = { parts: [{ type: 'text', text: userText }] };
  if (agent) body.agent = agent;
  if (isOpencode) body.model = { providerID: 'opencode', modelID: modelId };
  else { body.providerID = 'kilo'; body.modelID = modelId; }

  const st = makeState();
  const emit = ev => { (window.__debug[dbgKey].events ||= []).push({ ...ev, t: Date.now() }); };

  if (isOpencode) {
    const es = new EventSource(base + '/event');
    const assistantMsgs = new Set();
    const pending = [];
    let resolveNext = null;
    const wake = () => { if (resolveNext) { const r = resolveNext; resolveNext = null; r(); } };
    const push = ev => { emit(ev); pending.push(ev); wake(); };
    es.onmessage = e => {
      try {
        const m = JSON.parse(e.data);
        if (m.type === 'message.updated') {
          const info = m.properties?.info;
          if (info?.sessionID === sessionId && info.role === 'assistant') { assistantMsgs.add(info.id); if (info.modelID) push({ type: 'model-info', modelID: info.modelID, providerID: info.providerID }); }
        } else if (m.type === 'message.part.updated') {
          const part = m.properties?.part;
          if (part?.sessionID !== sessionId || !assistantMsgs.has(part.messageID)) return;
          const h = PART_HANDLERS[part.type];
          if (h) h(part, st, push);
          else push({ type: 'unknown-part', partType: part.type, id: part.id, text: part.text, raw: part });
        }
      } catch (_) {}
    };
    yield { type: 'status', message: 'POST /message' };
    const msgRes = await fetch(base + '/session/' + sessionId + '/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    window.__debug[dbgKey].lastStatus = msgRes.status;
    yield { type: 'status', message: 'msg ' + msgRes.status };
    if (!msgRes.ok) { es.close(); throw new Error('message ' + msgRes.status + ': ' + await msgRes.text()); }
    const deadline = Date.now() + 180000;
    let graceUntil = 0;
    while (true) {
      if (pending.length) { yield pending.shift(); continue; }
      if (st.stepFinished) { if (!graceUntil) graceUntil = Date.now() + 1500; if (Date.now() > graceUntil) break; }
      if (Date.now() > deadline) break;
      await new Promise(r => { resolveNext = r; setTimeout(r, 500); });
    }
    es.close();
  } else {
    yield { type: 'status', message: 'POST /message' };
    const msgRes = await fetch(base + '/session/' + sessionId + '/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    window.__debug[dbgKey].lastStatus = msgRes.status;
    yield { type: 'status', message: 'msg ' + msgRes.status };
    if (!msgRes.ok) throw new Error('message ' + msgRes.status + ': ' + await msgRes.text());
    const result = await msgRes.json();
    window.__debug[dbgKey].lastResult = result;
    const info = result.info || {};
    if (info.modelID) { const ev = { type: 'model-info', modelID: info.modelID, providerID: info.providerID }; emit(ev); yield ev; }
    for (const part of (result.parts || [])) {
      const h = PART_HANDLERS[part.type];
      const pending = [];
      const pushLocal = ev => { emit(ev); pending.push(ev); };
      if (h) h(part, st, pushLocal);
      else pushLocal({ type: 'unknown-part', partType: part.type, id: part.id, text: part.text, raw: part });
      for (const ev of pending) yield ev;
    }
  }
  yield { type: 'status', message: 'mirror sandbox' };
  const mirrored = await mirrorFromSandbox(fsBase);
  if (mirrored.length) {
    window.__debug[dbgKey].writes = mirrored;
    for (const path of mirrored) yield { type: 'file-mirrored', path };
    window.showPreview?.();
    window.refreshPreview?.();
  }
  yield { type: 'finish-step', finishReason: 'stop' };
}
