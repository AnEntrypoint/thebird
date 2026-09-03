const MAX_PIPE_BUFFER = 10 * 1024 * 1024;

export function createFdTable(ctx, snap, persist) {
  // snap()/persist() are the instance-scoped filesystem closures from createShell
  // (routing to fs.snapshot/fs.flush). Fall back to the shared global only when
  // they are absent so a standalone fdTable still works.
  if (typeof snap !== 'function') snap = () => (window.__debug?.idbSnapshot || (window.__debug.idbSnapshot = {}));
  if (typeof persist !== 'function') persist = () => window.__debug?.idbPersist?.();
  const table = { 0: { kind: 'stdin', data: '' }, 1: { kind: 'stdout' }, 2: { kind: 'stderr' } };
  ctx.fds = table;

  function open(fd, source, mode) {
    const n = parseInt(fd, 10);
    if (isNaN(n)) throw new Error('fd: invalid: ' + fd);
    if (n < 0 || n > 65535) throw new Error('bash: ' + n + ': invalid file descriptor: Bad file descriptor');
    table[n] = { kind: 'file', path: source, mode: mode || 'r', buf: '' };
    return n;
  }

  function close(fd) {
    const n = parseInt(fd, 10);
    if (n > 65535) throw new Error('bash: ' + n + ': invalid file descriptor: Bad file descriptor');
    if (n < 3) { table[n] = { kind: 'closed', std: n }; return; }
    delete table[n];
  }

  function dup2(src, dst) {
    const s = parseInt(src, 10);
    const d = parseInt(dst, 10);
    if (isNaN(s) || isNaN(d) || s < 0 || s > 65535 || d < 0 || d > 65535) throw new Error('bash: ' + (s > 65535 ? s : d) + ': invalid file descriptor: Bad file descriptor');
    const slot = table[s];
    if (!slot) throw new Error('fd: ' + src + ': bad descriptor');
    // 'file' kind: intentionally alias the same slot object -- both fds address
    // the same backing snapshot key (path/mode), so sharing the reference is
    // correct dup semantics, not a bug.
    // Any other kind (stdin/stdout/stderr/generic buf-accumulator): copy the
    // slot into an independent object so writes through dst never mutate src's
    // buffer (and vice versa) -- these have no shared backing store to alias.
    table[d] = slot.kind === 'file' ? slot : { ...slot };
  }

  function readFd(fd) {
    const n = parseInt(fd, 10);
    const slot = table[n];
    if (!slot) throw new Error('fd ' + fd + ' not open');
    if (slot.kind === 'closed') throw new Error('read error: Bad file descriptor');
    if (slot.kind === 'stdin') return slot.data || '';
    if (slot.kind === 'file') {
      const s = snap();
      const k = slot.path.replace(/^\//, '');
      if (!(k in s)) throw new Error('read error: ' + slot.path + ': No such file or directory');
      return s[k] || '';
    }
    return slot.buf || '';
  }

  function writeFd(fd, data) {
    const n = parseInt(fd, 10);
    const slot = table[n];
    if (!slot) throw new Error('fd ' + fd + ' not open');
    if (slot.kind === 'closed') throw new Error('write error: Bad file descriptor');
    if (slot.kind === 'stdout' || n === 1) ctx.term.write(data.replace(/\n/g, '\r\n'));
    else if (slot.kind === 'stderr' || n === 2) ctx.term.write('\x1b[31m' + data.replace(/\n/g, '\r\n') + '\x1b[0m');
    else if (slot.kind === 'file') {
      const s = snap();
      const k = slot.path.replace(/^\//, '');
      s[k] = slot.mode === 'a' ? (s[k] || '') + data : data;
      persist();
    } else {
      let next = (slot.buf || '') + data;
      if (next.length > MAX_PIPE_BUFFER) {
        ctx.term.write('\x1b[33m[fd buffer truncated: data exceeds ' + (MAX_PIPE_BUFFER / 1024 / 1024) + 'MB]\x1b[0m\r\n');
        next = next.slice(0, MAX_PIPE_BUFFER);
      }
      slot.buf = next;
    }
  }

  return { table, open, close, dup2, readFd, writeFd };
}

export function parseFdRedirects(tokens) {
  const out = { args: [], redirs: [] };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const c = t.match(/^(\d+)?(>&|<&)-$/);
    if (c) {
      const from = c[1] != null ? +c[1] : (c[2].includes('<') ? 0 : 1);
      out.redirs.push({ kind: 'close', fd: from });
      continue;
    }
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
