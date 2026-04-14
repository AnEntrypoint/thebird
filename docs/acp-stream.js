import { ClientSideConnection } from './vendor/acp-sdk.js';

function wsStream(url) {
  const ws = new WebSocket(url);
  const incoming = [];
  let notify = null;
  ws.addEventListener('message', e => {
    const msg = JSON.parse(e.data);
    if (notify) { const fn = notify; notify = null; fn(msg); }
    else incoming.push(msg);
  });
  const readable = new ReadableStream({
    start(ctrl) {
      ws.addEventListener('close', () => ctrl.close());
      ws.addEventListener('error', e => ctrl.error(e));
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
    ws.addEventListener('open', () => res({ readable, writable }));
    ws.addEventListener('error', rej);
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

  await client.initialize({ protocolVersion: '0.1', capabilities: {}, clientInfo: { name: 'thebird', version: '1.0' } });
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
