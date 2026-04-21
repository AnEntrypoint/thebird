import { ClientSideConnection } from './vendor/acp-sdk.js';

function wsStream(url) {
  const ws = new WebSocket(url);
  const incoming = [];
  let notify = null;
  Object.assign(window.__debug = window.__debug || {}, {
    acp: Object.assign(window.__debug?.acp || {}, { wsUrl: url, wsState: 'connecting' })
  });
  ws.addEventListener('message', e => {
    const msg = JSON.parse(e.data);
    if (notify) { const fn = notify; notify = null; fn(msg); }
    else incoming.push(msg);
  });
  const readable = new ReadableStream({
    start(ctrl) {
      ws.addEventListener('close', () => {
        window.__debug.acp.wsState = 'closed';
        ctrl.close();
      });
      ws.addEventListener('error', e => {
        window.__debug.acp.wsState = 'error';
        window.__debug.acp.wsError = e.message || String(e);
        ctrl.error(e);
      });
    },
    pull() {
      return new Promise(res => {
        if (incoming.length) { res(incoming.shift()); return; }
        notify = msg => res(msg);
      }).then(msg => {});
    }
  });
  const writable = new WritableStream({
    write(msg) { ws.send(JSON.stringify(msg)); }
  });
  return new Promise((res, rej) => {
    ws.addEventListener('open', () => {
      window.__debug.acp.wsState = 'open';
      res({ readable, writable });
    });
    ws.addEventListener('error', (e) => {
      window.__debug.acp.wsState = 'error';
      const errMsg = e?.message || 'WebSocket connection failed';
      window.__debug.acp.wsError = errMsg;
      console.log('[ACP] Connection error:', errMsg);
      rej(new Error(errMsg));
    });
  });
}

export async function* streamACP({ url, model, messages, system, tools, maxOutputTokens, onStepFinish }) {
  yield { type: 'start-step' };
  const stream = await wsStream(url);
  let sessionUpdates = [];
  let notifyUpdate = null;
  const client = new ClientSideConnection(agent => ({
    sessionUpdate(params) {
      if (notifyUpdate) { const fn = notifyUpdate; notifyUpdate = null; fn(params); }
      else sessionUpdates.push(params);
    },
    requestPermission() { return Promise.resolve({ outcome: 'allow_once' }); },
    readTextFile({ path }) {
      const t = tools?.read_file;
      return t?.execute?.({ path }).then(c => ({ content: c })) || Promise.resolve({ content: '' });
    },
    writeTextFile({ path, content }) {
      const t = tools?.write_file;
      return t?.execute?.({ path, content }).then(() => ({})) || Promise.resolve({});
    },
  }), stream);

  await client.initialize({ protocolVersion: 1, capabilities: {}, clientInfo: { name: 'thebird', version: '1.0' } });
  const { sessionId } = await client.newSession({ cwd: '/' });

  const userText = messages.filter(m => m.role === 'user').map(m =>
    typeof m.content === 'string' ? m.content : m.content.filter(b => b.type === 'text').map(b => b.text).join('')
  ).join('\n');

  const promptPromise = client.prompt({ sessionId, message: { role: 'user', content: [{ type: 'text', text: userText }] } });

  const getUpdate = () => new Promise(res => {
    if (sessionUpdates.length) { res(sessionUpdates.shift()); return; }
    notifyUpdate = res;
  });

  let done = false;
  promptPromise.then(() => { done = true; if (notifyUpdate) { const fn = notifyUpdate; notifyUpdate = null; fn(null); } });

  while (!done) {
    const update = await getUpdate();
    if (!update) break;
    for (const item of (update.updates || [])) {
      if (item.type === 'message_chunk' && item.chunk?.type === 'text') {
        yield { type: 'text-delta', textDelta: item.chunk.text };
      }
    }
  }

  yield { type: 'finish-step', finishReason: 'stop' };
  if (onStepFinish) await onStepFinish();
}
