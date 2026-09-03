const streams = new Map();
let nextStreamId = 1000;

// The streams Map is process-global (shared by every instance on the page). To
// stop one instance reading another's procsub data, each stream is tagged with the
// owning shell's namespace token (ns) and a read only succeeds when the caller
// presents the SAME ns. registerStream/readStream keep working without an ns
// (single-instance / legacy callers) but a namespaced shell can no longer be read
// across the instance boundary.
export function registerStream(data, ns) {
  const id = nextStreamId++;
  streams.set(id, { data, ts: Date.now(), ns: ns || null });
  setTimeout(() => streams.delete(id), 60000);
  return '/procsub/' + id;
}

export function readStream(id, ns) {
  const s = streams.get(+id);
  if (!s) return null;
  // A namespaced stream is only readable by a caller in the same namespace.
  // Strict parity: both must share the exact same ns token, or both must be null.
  if (!s.ns && !ns) return s.data;
  if (s.ns && ns && s.ns === ns) return s.data;
  return null;
}

if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('message', ev => {
    if (ev.data?.type === 'PROCSUB_READ') {
      const data = readStream(ev.data.id, ev.data.ns);
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
      out.push(registerStream(data, ctx && ctx.procsubNs));
      i = end + 1; continue;
    }
    if (token[i] === '>' && token[i + 1] === '(') {
      const end = findMatch(token, i + 1);
      if (end < 0) { out.push(token[i++]); continue; }
      const cmd = token.slice(i + 2, end);
      const path = registerStream('', ctx && ctx.procsubNs);
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
