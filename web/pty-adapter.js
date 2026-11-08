const HISTORY_KEY = 'thebird.history';
const HISTORY_LIMIT = 500;
const KEY_TOKEN = /\x1b\[[0-9;]*[ -/]*[@-~]|\x1bO[A-Za-z]|[\s\S]/gu;
const ESCAPE_KEYS = {
  '\x1b[A': 'up', '\x1bOA': 'up', '\x1b[B': 'down', '\x1bOB': 'down',
  '\x1b[C': 'right', '\x1bOC': 'right', '\x1b[D': 'left', '\x1bOD': 'left',
  '\x1b[H': 'home', '\x1bOH': 'home', '\x1b[1~': 'home', '\x1b[F': 'end', '\x1bOF': 'end', '\x1b[4~': 'end',
  '\x1b[3~': 'delete',
};
const CONTROL_KEYS = {
  '\r': 'enter', '\n': 'enter', '\x7f': 'backspace', '\b': 'backspace', '\x03': 'interrupt', '\x04': 'eof',
  '\x01': 'home', '\x05': 'end', '\x02': 'left', '\x06': 'right', '\x10': 'up', '\x0e': 'down',
  '\x0b': 'killEnd', '\x15': 'killHome', '\x17': 'killWord', '\x0c': 'clear', '\t': 'complete',
};
const CLEAR_SCREEN = '\x1b[H\x1b[2J';
const up = (rows) => (rows > 0 ? `\x1b[${rows}A` : '');
const isSpace = (char) => /\s/.test(char);
const WIDE_RANGES = [[0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1f64f], [0x1f680, 0x1f6ff], [0x1f900, 0x1f9ff], [0x1fa70, 0x1faff], [0x20000, 0x3fffd]];
const ZERO_WIDTH_RANGES = [[0x0300, 0x036f], [0x200b, 0x200f], [0xfe00, 0xfe0f], [0x20d0, 0x20ff]];
const inRanges = (code, ranges) => ranges.some(([from, to]) => code >= from && code <= to);
const cellWidth = (char) => {
  const code = char.codePointAt(0);
  if (code < 0x20 || code === 0x7f || inRanges(code, ZERO_WIDTH_RANGES)) return 0;
  return inRanges(code, WIDE_RANGES) ? 2 : 1;
};
const commonPrefix = (words) => words.reduce((prefix, word) => {
  let end = 0;
  while (end < prefix.length && prefix[end] === word[end]) end++;
  return prefix.slice(0, end);
});

function loadHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter((command) => typeof command === 'string') : [];
  } catch {
    return [];
  }
}

export function createPtyAdapter({ term, client, onBusy = () => {} }) {
  const history = loadHistory();
  const pending = [];
  let chars = [];
  let cursor = 0;
  let draft = [];
  let position = history.length;
  let cols = term.cols;
  let promptText = 'thebird /workspace> ';
  let showPrompt = false;
  let inputDrawn = false;
  let drawnRow = 0;
  let atLineStart = true;
  let busy = false;
  let idle = Promise.resolve();

  const advanceOver = (offset, codes) => codes.reduce((at, char) => {
    const width = cellWidth(char);
    return width === 2 && at % cols === cols - 1 ? at + 1 + width : at + width;
  }, offset);
  const headWidth = () => (showPrompt ? advanceOver(0, Array.from(promptText)) : 0);
  const offsetOf = (count) => advanceOver(headWidth(), chars.slice(0, count));
  const endOffset = () => offsetOf(chars.length);
  const inputActive = () => showPrompt || chars.length > 0;
  const cellAt = (index) => ({ row: Math.floor(index / cols), col: index % cols });
  const endCell = (index) => (index > 0 && index % cols === 0 ? { row: index / cols - 1, col: cols - 1 } : cellAt(index));
  const moveTo = (from, to) => {
    const dy = to.row - from.row;
    return (dy < 0 ? `\x1b[${-dy}A` : dy > 0 ? `\x1b[${dy}B` : '') + `\x1b[${to.col + 1}G`;
  };
  const replaceChars = (next) => {
    chars = next;
    cursor = chars.length;
  };

  const clearInput = () => {
    if (!inputDrawn) return '';
    inputDrawn = false;
    return up(drawnRow) + '\r\x1b[J';
  };

  const render = () => {
    let out = inputDrawn ? clearInput() : atLineStart ? '' : '\r\n';
    const head = showPrompt ? promptText : '';
    out += '\x1b[J' + head + chars.join('');
    const end = endCell(endOffset());
    const target = cellAt(offsetOf(cursor));
    out += moveTo(end, target);
    drawnRow = target.row;
    inputDrawn = true;
    atLineStart = false;
    term.write(out);
  };

  const refresh = () => {
    if (inputActive()) render();
  };

  const writeOutput = (text) => {
    const wasDrawn = inputDrawn;
    let out = clearInput();
    out += text;
    if (text) atLineStart = text.endsWith('\n');
    term.write(out);
    if (wasDrawn) refresh();
  };

  const remember = (command) => {
    if (!command.trim() || history.at(-1) === command) return;
    history.push(command);
    if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {}
  };

  async function execute(command) {
    if (!atLineStart) writeOutput('\n');
    try {
      const result = await client.run(command);
      if (result.output) writeOutput(result.output);
    } catch (err) {
      writeOutput('error: ' + err.message + '\n');
    }
  }

  async function drain() {
    busy = true;
    onBusy(true);
    showPrompt = false;
    refresh();
    while (pending.length) await execute(pending.shift());
    busy = false;
    onBusy(false);
    await refreshPrompt();
  }

  async function refreshPrompt() {
    try {
      promptText = `thebird ${await client.cwd()}> `;
    } catch {}
    showPrompt = true;
    refresh();
  }

  function submit() {
    const command = chars.join('');
    const here = cellAt(offsetOf(cursor));
    const end = endCell(endOffset());
    term.write(moveTo(here, end) + '\r\n');
    inputDrawn = false;
    showPrompt = false;
    atLineStart = true;
    replaceChars([]);
    remember(command);
    position = history.length;
    draft = [];
    if (command.trim()) pending.push(command);
    if (!busy && pending.length) idle = drain();
    else if (!busy) refreshPrompt();
    else refresh();
  }

  function interrupt() {
    replaceChars([]);
    if (busy) {
      pending.length = 0;
      client.cancel();
      writeOutput('^C\n');
    } else {
      writeOutput('^C\n');
      showPrompt = true;
      refresh();
    }
  }

  function historyStep(delta) {
    if (delta < 0) {
      if (position === 0) return;
      if (position === history.length) draft = chars.slice();
      position--;
    } else {
      if (position >= history.length) return;
      position++;
    }
    replaceChars(position === history.length ? draft.slice() : Array.from(history[position]));
    render();
  }

  function killWordBack() {
    let start = cursor;
    while (start > 0 && isSpace(chars[start - 1])) start--;
    while (start > 0 && !isSpace(chars[start - 1])) start--;
    chars.splice(start, cursor - start);
    cursor = start;
  }

  async function complete() {
    let start = cursor;
    while (start > 0 && !isSpace(chars[start - 1])) start--;
    const token = chars.slice(start, cursor).join('');
    const commandPosition = chars.slice(0, start).join('').trim() === '';
    const matches = await client.complete(token, { command: commandPosition });
    if (matches.length === 0) return;
    let insert;
    if (matches.length === 1) insert = matches[0] + (matches[0].endsWith('/') ? '' : ' ');
    else {
      insert = commonPrefix(matches);
      if (insert.length <= token.length) {
        writeOutput(matches.join('  ') + '\n');
        return;
      }
    }
    const codes = Array.from(insert);
    chars.splice(start, cursor - start, ...codes);
    cursor = start + codes.length;
    render();
  }

  const actions = {
    enter: submit,
    interrupt,
    complete,
    clear() {
      term.write(CLEAR_SCREEN);
      inputDrawn = false;
      atLineStart = true;
      refresh();
    },
    backspace() {
      if (cursor === 0) return;
      chars.splice(cursor - 1, 1);
      cursor--;
      render();
    },
    delete() {
      if (cursor === chars.length) return;
      chars.splice(cursor, 1);
      render();
    },
    eof() {
      if (chars.length) actions.delete();
    },
    left() {
      cursor = Math.max(0, cursor - 1);
      render();
    },
    right() {
      cursor = Math.min(chars.length, cursor + 1);
      render();
    },
    home() {
      cursor = 0;
      render();
    },
    end() {
      cursor = chars.length;
      render();
    },
    up: () => historyStep(-1),
    down: () => historyStep(1),
    killEnd() {
      chars.length = cursor;
      render();
    },
    killHome() {
      chars.splice(0, cursor);
      cursor = 0;
      render();
    },
    killWord() {
      killWordBack();
      render();
    },
  };

  return {
    onData(data) {
      for (const token of data.replace(/\r\n/g, '\r').match(KEY_TOKEN) ?? []) {
        const name = ESCAPE_KEYS[token] ?? CONTROL_KEYS[token];
        if (name) actions[name]();
        else if (token.startsWith('\x1b')) continue;
        else if (token >= ' ' && token !== '\x7f') {
          chars.splice(cursor, 0, token);
          cursor++;
          render();
        }
      }
    },
    writeOutput,
    refreshPrompt,
    runLine(command) {
      showPrompt = true;
      replaceChars(Array.from(command));
      render();
      submit();
    },
    whenIdle: () => idle,
    state: () => ({ line: chars.join(''), cursor, prompt: promptText }),
    resize(next) {
      cols = next;
      client.resize(cols, term.rows);
      refresh();
    },
  };
}
