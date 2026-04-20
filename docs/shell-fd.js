export function createFdTable(ctx) {
  const table = { 0: { kind: 'stdin', data: '' }, 1: { kind: 'stdout' }, 2: { kind: 'stderr' } };
  ctx.fds = table;

  function open(fd, source, mode) {
    const n = parseInt(fd, 10);
    if (isNaN(n)) throw new Error('fd: invalid: ' + fd);
    table[n] = { kind: 'file', path: source, mode: mode || 'r', buf: '' };
    return n;
  }

  function close(fd) {
    const n = parseInt(fd, 10);
    delete table[n];
  }

  function dup2(src, dst) {
    const s = parseInt(src, 10);
    const d = parseInt(dst, 10);
    if (!table[s]) throw new Error('fd: ' + src + ': bad descriptor');
    table[d] = { ...table[s], duped: s };
  }

  function readFd(fd) {
    const n = parseInt(fd, 10);
    const slot = table[n];
    if (!slot) throw new Error('fd ' + fd + ' not open');
    if (slot.kind === 'stdin') return slot.data || '';
    if (slot.kind === 'file') {
      const snap = window.__debug?.idbSnapshot || {};
      return snap[slot.path.replace(/^\//, '')] || '';
    }
    return slot.buf || '';
  }

  function writeFd(fd, data) {
    const n = parseInt(fd, 10);
    const slot = table[n];
    if (!slot) throw new Error('fd ' + fd + ' not open');
    if (slot.kind === 'stdout' || n === 1) ctx.term.write(data.replace(/\n/g, '\r\n'));
    else if (slot.kind === 'stderr' || n === 2) ctx.term.write('\x1b[31m' + data.replace(/\n/g, '\r\n') + '\x1b[0m');
    else if (slot.kind === 'file') {
      const snap = window.__debug?.idbSnapshot || (window.__debug.idbSnapshot = {});
      const k = slot.path.replace(/^\//, '');
      snap[k] = slot.mode === 'a' ? (snap[k] || '') + data : data;
      window.__debug?.idbPersist?.();
    } else { slot.buf = (slot.buf || '') + data; }
  }

  return { table, open, close, dup2, readFd, writeFd };
}

export function parseFdRedirects(tokens) {
  const out = { args: [], redirs: [] };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const m = t.match(/^(\d+)?(>>|>|<|>&|<&)(\d+)?$/);
    if (m) {
      const from = m[1] != null ? +m[1] : (m[2].includes('<') ? 0 : 1);
      const op = m[2];
      const toNum = m[3] != null ? +m[3] : null;
      if (op === '>&' || op === '<&') { out.redirs.push({ kind: 'dup', fd: from, target: toNum }); continue; }
      const target = tokens[++i];
      out.redirs.push({ kind: op === '<' ? 'read' : 'write', fd: from, path: target, append: op === '>>' });
      continue;
    }
    out.args.push(t);
  }
  return out;
}

export function makeExecBuiltin(ctx, fdTable) {
  return args => {
    if (!args.length) return;
    for (const a of args) {
      const m = a.match(/^(\d+)>(>?)(.+)$/);
      if (m) { fdTable.open(m[1], m[3], m[2] === '>' ? 'a' : 'w'); continue; }
      const r = a.match(/^(\d+)<(.+)$/);
      if (r) { fdTable.open(r[1], r[2], 'r'); continue; }
      const d = a.match(/^(\d+)>&(\d+)$/);
      if (d) { fdTable.dup2(d[2], d[1]); continue; }
      const c = a.match(/^(\d+)>&-$/);
      if (c) { fdTable.close(c[1]); continue; }
    }
  };
}
