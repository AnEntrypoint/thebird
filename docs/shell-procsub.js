const streams = new Map();
let nextStreamId = 1000;

export function registerStream(data) {
  const id = nextStreamId++;
  streams.set(id, { data, ts: Date.now() });
  setTimeout(() => streams.delete(id), 60000);
  return '/procsub/' + id;
}

export function readStream(id) {
  const s = streams.get(+id);
  return s ? s.data : null;
}

if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('message', ev => {
    if (ev.data?.type === 'PROCSUB_READ') {
      const data = readStream(ev.data.id);
      ev.ports[0]?.postMessage({ data: data || '', found: data !== null });
    }
  });
}

export async function expandProcSub(token, captureRun, ctx) {
  const out = [];
  let i = 0;
  while (i < token.length) {
    if (token[i] === '<' && token[i + 1] === '(') {
      const end = findMatch(token, i + 1);
      if (end < 0) { out.push(token[i++]); continue; }
      const cmd = token.slice(i + 2, end);
      const data = captureRun ? captureRun(cmd) : '';
      out.push(registerStream(data));
      i = end + 1; continue;
    }
    if (token[i] === '>' && token[i + 1] === '(') {
      const end = findMatch(token, i + 1);
      if (end < 0) { out.push(token[i++]); continue; }
      const cmd = token.slice(i + 2, end);
      const path = registerStream('');
      ctx.pendingWrites = ctx.pendingWrites || [];
      ctx.pendingWrites.push({ path, cmd });
      out.push(path);
      i = end + 1; continue;
    }
    out.push(token[i++]);
  }
  return out.join('');
}

function findMatch(s, start) {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

export function swFetchProcSub(path) {
  const m = path.match(/^\/procsub\/(\d+)$/);
  if (!m) return null;
  return readStream(m[1]);
}
