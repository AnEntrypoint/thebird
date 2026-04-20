export function createReadline({ term, getCompletions, onLine, getPrompt, isBlockOpen }) {
  let buf = '';
  let pos = 0;
  let histIdx = -1;
  let escBuf = '';
  let inEsc = false;
  let heredocTag = null;
  let heredocBody = '';
  let heredocPrefix = '';

  const write = s => term.write(s);

  function promptStr() { return '\r\n\x1b[32m' + getPrompt() + ' $ \x1b[0m'; }
  function showPrompt() { write(promptStr()); }

  function redraw() {
    write('\r\x1b[2K\x1b[32m' + getPrompt() + ' $ \x1b[0m' + buf);
    if (pos < buf.length) write('\x1b[' + (buf.length - pos) + 'D');
  }

  function insert(ch) {
    buf = buf.slice(0, pos) + ch + buf.slice(pos);
    pos++;
    redraw();
  }

  function delBefore() {
    if (!pos) return;
    buf = buf.slice(0, pos - 1) + buf.slice(pos);
    pos--;
    redraw();
  }

  function delAfter() {
    if (pos >= buf.length) return;
    buf = buf.slice(0, pos) + buf.slice(pos + 1);
    redraw();
  }

  function moveTo(n) {
    pos = Math.max(0, Math.min(buf.length, n));
    const pLen = getPrompt().length + 3;
    if (pLen + pos > 0) write('\r\x1b[' + (pLen + pos) + 'C');
    else write('\r');
  }

  function handleTab() {
    const word = buf.slice(0, pos).split(/\s+/).pop() || '';
    const completions = getCompletions(buf, word);
    if (!completions.length) return;
    if (completions.length === 1) {
      const rest = completions[0].slice(word.length);
      buf = buf.slice(0, pos) + rest + buf.slice(pos);
      pos += rest.length;
      redraw();
      return;
    }
    const common = completions.reduce((a, b) => {
      let i = 0;
      while (i < a.length && a[i] === b[i]) i++;
      return a.slice(0, i);
    });
    if (common.length > word.length) {
      const rest = common.slice(word.length);
      buf = buf.slice(0, pos) + rest + buf.slice(pos);
      pos += rest.length;
      redraw();
      return;
    }
    write('\r\n' + completions.join('  '));
    redraw();
  }

  function commit() {
    const line = buf;
    write('\r\n');
    if (heredocTag !== null) {
      if (line === heredocTag) {
        const full = heredocPrefix + " '" + heredocBody.replace(/'/g, "'\\''") + "'";
        heredocTag = null; heredocBody = ''; heredocPrefix = '';
        buf = ''; pos = 0; histIdx = -1;
        onLine(full);
        return;
      }
      heredocBody += line + '\n';
      buf = ''; pos = 0;
      write('\x1b[32m> \x1b[0m');
      return;
    }
    const hd = line.match(/^(.*?)<<-?\s*(['"]?)(\w+)\2\s*$/);
    if (hd) {
      heredocPrefix = hd[1].trim();
      heredocTag = hd[3];
      heredocBody = '';
      buf = ''; pos = 0;
      write('\x1b[32m> \x1b[0m');
      return;
    }
    if (line.endsWith('\\')) {
      buf = line.slice(0, -1) + '\n';
      pos = buf.length;
      write('\x1b[32m> \x1b[0m');
      return;
    }
    const hist = getHistory();
    const expanded = expandBang(line, hist);
    if (expanded !== line) { write('\x1b[33m' + expanded + '\x1b[0m\r\n'); }
    if (expanded.trim()) hist.unshift(expanded);
    buf = '';
    pos = 0;
    histIdx = -1;
    onLine(expanded);
  }

  function getHistory() { return window.__debug?.shell?.history || []; }

  function histNav(dir) {
    const hist = getHistory();
    if (!hist.length) return;
    histIdx = Math.max(-1, Math.min(hist.length - 1, histIdx + dir));
    buf = histIdx === -1 ? '' : hist[histIdx];
    pos = buf.length;
    redraw();
  }

  const ESC_MAP = {
    '[A': () => histNav(1),
    '[B': () => histNav(-1),
    '[C': () => { if (pos < buf.length) { pos++; write('\x1b[C'); } },
    '[D': () => { if (pos > 0) { pos--; write('\x1b[D'); } },
    '[H': () => moveTo(0),
    '[F': () => moveTo(buf.length),
    '[3~': () => delAfter(),
    '[1~': () => moveTo(0),
    '[4~': () => moveTo(buf.length),
  };

  function onData(data) {
    if (inEsc) {
      escBuf += data;
      if (escBuf === '[') return;
      if (escBuf.match(/^\[[\x40-\x7E]$/) || escBuf.match(/^\[\d+~$/)) {
        const handler = ESC_MAP[escBuf];
        if (handler) handler();
        inEsc = false; escBuf = '';
        return;
      }
      if (escBuf.length > 6) { inEsc = false; escBuf = ''; }
      return;
    }
    if (data === '\x1b') { inEsc = true; escBuf = ''; return; }
    if (data === '\x01') { moveTo(0); return; }
    if (data === '\x05') { moveTo(buf.length); return; }
    if (data === '\x0b') { buf = buf.slice(0, pos); redraw(); return; }
    if (data === '\x15') { buf = buf.slice(pos); pos = 0; redraw(); return; }
    if (data === '\x09') { handleTab(); return; }
    if (data === '\r') { commit(); return; }
    if (data === '\x7f') { delBefore(); return; }
    if (data >= ' ') { insert(data); return; }
  }

  function showContinuation() { write('\x1b[32m> \x1b[0m'); }

  return { onData, showPrompt, showContinuation };
}

function expandBang(line, hist) {
  if (!line.includes('!') || !hist.length) return line;
  return line.replace(/!(!|-?\d+|[A-Za-z]\w*)/g, (m, ref) => {
    if (ref === '!') return hist[0] || m;
    if (/^-?\d+$/.test(ref)) { const n = +ref; return (n < 0 ? hist[-n - 1] : hist[hist.length - n]) || m; }
    const found = hist.find(h => h.startsWith(ref));
    return found || m;
  });
}
