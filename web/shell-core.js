import { runSed } from './shell-sed.js';
import { runTar, tarConcat } from './shell-tar.js';
import { runJq } from './shell-jq.js';
import { runAwk } from './shell-awk.js';

export const COMMAND_TIMEOUT_MS = 900000;

const BREAKS = new Set([' ', '\t', '\r', '\n', ';', '&', '|', '<', '>', '(', ')']);
const FD_OPS = ['3', '4', '5', '6', '7', '8', '9'].flatMap((fd) => [fd + '>>', fd + '>&', fd + '>']);
const FD_OUTPUTS = ['3', '4', '5', '6', '7', '8', '9'].flatMap((fd) => [fd + '>', fd + '>>']);
const FD_INPUTS = ['3', '4', '5', '6', '7', '8', '9'].map((fd) => fd + '<');
const FD_HEREDOCS = ['3', '4', '5', '6', '7', '8', '9'].flatMap((fd) => [fd + '<<<', fd + '<<']);
const FD1_HEREDOCS = ['1<<<', '1<<-', '1<<'];
const FD_HEREDOC_BODIES = ['3', '4', '5', '6', '7', '8', '9'].map((fd) => fd + '<<').concat(['1<<', '1<<-']);
const FD0_OPS = { '0<<<': '<<<', '0<<-': '<<-', '0<<': '<<', '0<': '<' };
const DUP_IN_OPS = ['<&', '0<&', '1<&', '2<&', ...['3', '4', '5', '6', '7', '8', '9'].map((fd) => fd + '<&')];
const INPUT_DUP_OPS = new Set(['<&', '0<&']);
const OPERATORS = ['<<-', ...FD1_HEREDOCS, ...DUP_IN_OPS, '1<>', '1<', ...Object.keys(FD0_OPS), ...FD_OPS, ...FD_HEREDOCS, ...FD_INPUTS, '2>>', '2>&1', '2>&', '1>>', '1>&', '1>', '>&', '2>', '&>>', '&>', '&&', '||', '|&', ';;', '>>', '>', '<<<', '<<', '<', '|', '(', ')', ';', '&'];
const REDIRECTS = new Set(['>', '>>', '<', '<<', '<<-', '<<<', ...FD1_HEREDOCS, '1<', '1<>', ...DUP_IN_OPS, '&>', '&>>', '2>', '2>>', '2>&1', '2>&', '1>>', '1>&', '1>', '>&', ...FD_OPS, ...FD_HEREDOCS, ...FD_INPUTS]);
const DUP_OPS = new Set(['>&', '1>&', '2>&', ...FD_OPS.filter((op) => op.endsWith('>&')), ...DUP_IN_OPS]);
const FILE_FDS = { '>': [1], '1>': [1], '>>': [1], '1>>': [1], '&>': [1, 2], '&>>': [1, 2], '2>': [2], '2>>': [2] };
const ESCAPES = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', e: '\x1b', '\\': '\\', '"': '"', "'": "'" };
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=/;
const INDEXED_ASSIGN = /^([A-Za-z_][A-Za-z0-9_]*)\[([^\]]*)\]=/;
class TestFailure extends Error {}

const testInteger = (text) => {
  if (!/^[ \t\n]*[+-]?[0-9]+[ \t\n]*$/.test(text)) throw new TestFailure(text + ': integer expected');
  return Number(text.trim());
};

const INTEGER_COMPARE = { '-eq': (x, y) => x === y, '-ne': (x, y) => x !== y, '-lt': (x, y) => x < y, '-le': (x, y) => x <= y, '-gt': (x, y) => x > y, '-ge': (x, y) => x >= y };
const menuTabStop = (at) => (Math.floor(at / 8) + 1) * 8;
const menuPad = (from, to) => {
  let at = from;
  let out = '';
  while (menuTabStop(at) <= to) {
    out += '\t';
    at = menuTabStop(at);
  }
  return out + ' '.repeat(Math.max(0, to - at));
};
const selectMenu = (items, columnsValue) => {
  if (items.length < 10) return items.map((item, i) => (i + 1) + ') ' + item + '\n').join('');
  const width = Number.isInteger(columnsValue) && columnsValue > 0 ? columnsValue : 80;
  const digits = String(items.length).length;
  const column = Math.max(...items.map((item) => [...item].length)) + digits + 4;
  const columns = Math.max(1, Math.floor(width / column));
  const rows = Math.ceil(items.length / columns);
  const cols = Math.ceil(items.length / rows);
  let out = '';
  for (let row = 0; row < rows; row++) {
    let line = '';
    let at = 0;
    for (let col = 0; col < cols; col++) {
      const index = col * rows + row;
      if (index >= items.length) break;
      const number = String(index + 1);
      if (col === 0) {
        line = number + ') ' + items[index];
        at = [...line].length;
        continue;
      }
      const label = number.padStart(digits) + ') ' + items[index];
      line += menuPad(at, col * column) + label;
      at = col * column + [...label].length;
    }
    out += line + '\n';
  }
  return out;
};
const CONDITIONAL_BINARY = new Set(['==', '=', '!=', '=~', '<', '>', '-eq', '-ne', '-lt', '-le', '-gt', '-ge']);
const SHELL_BUILTINS = new Set(['echo', 'printf', 'true', 'false', 'exit', 'export', 'local', 'return', 'test', '[', 'command', 'type', 'which', 'wait']);
const SHELL_PID = 100;
const SIGNALS = { HUP: 1, INT: 2, KILL: 9, TERM: 15 };
const NULL_DEVICE = '/dev/null';

class ShellExit {
  constructor(code) {
    this.code = code;
  }
}

class ReturnSignal {
  constructor(code) {
    this.code = code;
  }
}

class LoopSignal {
  constructor(kind, levels) {
    this.kind = kind;
    this.levels = levels;
  }
}

class Signalled {
  constructor(signo) {
    this.signo = signo;
  }
}

class Cancelled {}

class TimedOut {}

function syntaxError(message) {
  return new Error(`syntax error: ${message}`);
}

const BASH_CLOSERS = { 'double quote': '"', 'single quote': "'", 'command substitution': ')', 'parameter expansion': '}', backquote: '`' };

function bashSyntaxError(message, { line, at, echo = false, eof = false, near } = {}) {
  return Object.assign(new Error(message), { bash: true, line, at, echo, eof, near });
}

function nearToken(token) {
  const text = token.newline ? 'newline' : (token.op ?? token.text);
  return bashSyntaxError("syntax error near unexpected token `" + text + "'", { line: token.line, echo: true });
}

function eofError(open) {
  return bashSyntaxError('syntax error: unexpected end of file from `' + (open.text ?? open.op) + "' command on line " + open.line, { eof: true });
}

function unterminated(what, at) {
  if (!(what in BASH_CLOSERS)) return syntaxError(`unterminated ${what}`);
  return bashSyntaxError("unexpected EOF while looking for matching `" + BASH_CLOSERS[what] + "'", { at, eof: at === undefined });
}

function backquoteEnd(src, start) {
  for (let i = start; i < src.length; i++) {
    if (src[i] === '\\') i++;
    else if (src[i] === '`') return i;
  }
  return -1;
}

function skipDoubleQuote(src, start) {
  for (let j = start + 1; j < src.length; j++) {
    if (src[j] === '\\') j++;
    else if (src[j] === '"') return j;
  }
  throw unterminated('double quote', start);
}

function matchParen(src, start) {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') i++;
    else if (c === "'") {
      const end = src.indexOf("'", i + 1);
      if (end < 0) throw unterminated('single quote', i);
      i = end;
    } else if (c === '"') i = skipDoubleQuote(src, i);
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  throw unterminated('command substitution');
}

const SHELL_USER = 'user';
const SHELL_UID = 1000;
const SHELL_GID = 1000;
const SHELL_GROUP = 'user';
const SHELL_HOST = 'thebird';

function readChars(text, pos, raw) {
  const chars = [];
  let i = pos;
  while (i < text.length) {
    const c = text[i];
    if (c === '\n') return { chars, end: i + 1, eof: false };
    if (c === '\\' && !raw && i + 1 < text.length) {
      if (text[i + 1] !== '\n') chars.push({ c: text[i + 1], escaped: true });
      i += 2;
      continue;
    }
    chars.push({ c, escaped: false });
    i++;
  }
  return { chars, end: i, eof: true };
}

function splitRead(chars, count, ifs) {
  if (!ifs.length) return [chars.map((x) => x.c).join(''), ...Array(count - 1).fill('')];
  const isWs = (x) => !x.escaped && ' \t\n'.includes(x.c) && ifs.includes(x.c);
  const isDelim = (x) => !x.escaped && !' \t\n'.includes(x.c) && ifs.includes(x.c);
  const values = [];
  let p = 0;
  const skipWs = () => {
    while (p < chars.length && isWs(chars[p])) p++;
  };
  skipWs();
  for (let k = 0; k < count - 1; k++) {
    let field = '';
    while (p < chars.length && !isWs(chars[p]) && !isDelim(chars[p])) field += chars[p++].c;
    values.push(field);
    skipWs();
    if (p < chars.length && isDelim(chars[p])) {
      p++;
      skipWs();
    }
  }
  const rest = chars.slice(p);
  while (rest.length && isWs(rest[rest.length - 1])) rest.pop();
  values.push(rest.map((x) => x.c).join(''));
  return values;
}

function parameterPart(text) {
  const slice = /^([A-Za-z_][A-Za-z0-9_]*)\[([@*])\]:(?![-=+?])([^:]*)(?::(.*))?$/s.exec(text);
  if (slice) return { k: 'slice', name: slice[1], index: slice[2], offset: slice[3], length: slice[4] ?? null };
  const keys = /^!([A-Za-z_][A-Za-z0-9_]*)\[([@*])\]$/.exec(text);
  if (keys) return { k: 'keys', name: keys[1], index: keys[2] };
  const m = /^(#)?([A-Za-z_][A-Za-z0-9_]*|[0-9]|[?#@*$!])(?:\[([^\]]*)\])?(?:(:?[-+=?])(.*))?$/s.exec(text);
  if (!m) throw syntaxError(`bad substitution ${text}`);
  if (m[1]) return { k: 'len', name: m[2], index: m[3] };
  return { k: 'param', name: m[2], index: m[3], op: m[4] ?? null, word: readParts(m[5] ?? '', 0, new Set()).parts };
}

function readDollar(src, i) {
  const next = src[i + 1];
  if (next === '(' && src[i + 2] === '(') {
    const close = matchParen(src, i + 1);
    if (src[close - 1] !== ')') throw syntaxError('bad arithmetic expansion');
    return { part: { k: 'arith', src: src.slice(i + 3, close - 1) }, end: close + 1 };
  }
  if (next === '(') {
    const close = matchParen(src, i + 1);
    return { part: { k: 'cmd', src: src.slice(i + 2, close) }, end: close + 1 };
  }
  if (next === '{') {
    const close = src.indexOf('}', i + 2);
    if (close < 0) throw unterminated('parameter expansion', i);
    return { part: parameterPart(src.slice(i + 2, close)), end: close + 1 };
  }
  if (next !== undefined && /[?#@*$!0-9]/.test(next)) return { part: { k: 'param', name: next, op: null, word: [] }, end: i + 2 };
  const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i + 1));
  if (name) return { part: { k: 'param', name: name[0], op: null, word: [] }, end: i + 1 + name[0].length };
  return { part: { k: 'lit', s: '$' }, end: i + 1 };
}

function readDouble(src, i) {
  const parts = [];
  let lit = '';
  let j = i + 1;
  while (src[j] !== '"') {
    if (j >= src.length) throw unterminated('double quote', i);
    const c = src[j];
    if (c === '\\' && src[j + 1] === '\n') {
      j += 2;
    } else if (c === '\\' && '$`"\\\n'.includes(src[j + 1])) {
      lit += src[j + 1];
      j += 2;
    } else if (c === '`') {
      if (lit) parts.push({ k: 'sq', s: lit });
      lit = '';
      const end = backquoteEnd(src, j + 1);
      if (end < 0) throw unterminated('backquote', j);
      parts.push({ k: 'cmd', src: src.slice(j + 1, end).replace(/\\([`\\$])/g, '$1') });
      j = end + 1;
    } else if (c === '$') {
      if (lit) parts.push({ k: 'sq', s: lit });
      lit = '';
      const r = readDollar(src, j);
      parts.push(r.part);
      j = r.end;
    } else {
      lit += c;
      j++;
    }
  }
  if (lit) parts.push({ k: 'sq', s: lit });
  return { part: { k: 'dq', parts }, end: j + 1 };
}

function readParts(src, start, breaks) {
  const parts = [];
  let lit = '';
  let i = start;
  const flush = () => {
    if (lit) parts.push({ k: 'lit', s: lit });
    lit = '';
  };
  while (i < src.length && !breaks.has(src[i])) {
    const c = src[i];
    if (c === "'") {
      flush();
      const end = src.indexOf("'", i + 1);
      if (end < 0) throw unterminated('single quote', i);
      parts.push({ k: 'sq', s: src.slice(i + 1, end) });
      i = end + 1;
    } else if (c === '"') {
      flush();
      const r = readDouble(src, i);
      parts.push(r.part);
      i = r.end;
    } else if (c === '\\' && src[i + 1] === '\n') {
      i += 2;
    } else if (c === '\\') {
      flush();
      parts.push({ k: 'sq', s: src[i + 1] ?? '' });
      i += 2;
    } else if (c === '`') {
      flush();
      const end = backquoteEnd(src, i + 1);
      if (end < 0) throw unterminated('backquote', i);
      parts.push({ k: 'cmd', src: src.slice(i + 1, end).replace(/\\([`\\$])/g, '$1') });
      i = end + 1;
    } else if (c === '$') {
      flush();
      const r = readDollar(src, i);
      parts.push(r.part);
      i = r.end;
    } else {
      lit += c;
      i++;
    }
  }
  flush();
  return { parts, end: i };
}

const textOf = (part) => (part.k === 'dq' ? part.parts.map(textOf).join('') : part.s ?? '');

const isQuoted = (part) => part.k === 'sq' || part.k === 'dq';

function readBodyParts(text) {
  const parts = [];
  let lit = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\' && text[i + 1] === '\n') {
      i += 2;
    } else if (c === '\\' && '$`\\'.includes(text[i + 1] ?? '')) {
      lit += text[i + 1];
      i += 2;
    } else if (c === '$') {
      if (lit) parts.push({ k: 'lit', s: lit });
      lit = '';
      const r = readDollar(text, i);
      parts.push(r.part);
      i = r.end;
    } else {
      lit += c;
      i++;
    }
  }
  if (lit) parts.push({ k: 'lit', s: lit });
  return parts;
}

function readHeredocBody(src, start, doc) {
  const lines = [];
  let i = start;
  while (i < src.length) {
    const end = src.indexOf('\n', i);
    const next = end < 0 ? src.length : end;
    const line = src.slice(i, next);
    i = next + 1;
    const bare = doc.strip ? line.replace(/^\t+/, '') : line;
    if (bare === doc.delim) break;
    lines.push(bare);
  }
  const text = lines.map((line) => line + '\n').join('');
  doc.token.body = doc.quoted ? [{ k: 'sq', s: text }] : readBodyParts(text);
  return i;
}

function arithmeticCommand(src, i) {
  let depth = 2;
  for (let j = i + 2; j < src.length; j++) {
    if (src[j] === '(') depth++;
    else if (src[j] === ')' && --depth === 0) return src[j - 1] === ')' ? { src: src.slice(i + 2, j - 1), end: j + 1 } : null;
  }
  return null;
}

export function tokenize(src, firstLine = 1, substitution = false) {
  const tokens = [];
  const heredocs = [];
  let lineNo = firstLine;
  let lineScan = 0;
  let segmentHasText = false;
  const lineAt = (at) => {
    for (; lineScan < at; lineScan++) {
      const ch = src[lineScan];
      if (ch === '\n') {
        if (!substitution || segmentHasText) lineNo++;
        segmentHasText = false;
      } else if (ch !== ' ' && ch !== '\t' && ch !== '\r') segmentHasText = true;
    }
    return lineNo;
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r') i++;
    else if (c === '\n') {
      tokens.push({ op: ';', line: lineAt(i), newline: true });
      i++;
      while (heredocs.length) i = readHeredocBody(src, i, heredocs.shift());
    } else if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
    } else {
      const arith = src.startsWith('((', i) ? arithmeticCommand(src, i) : null;
      if (arith) {
        tokens.push({ op: '((', src: arith.src, line: lineAt(i) });
        i = arith.end;
        continue;
      }
      const found = OPERATORS.find((candidate) => src.startsWith(candidate, i));
      const raw = found === '2>&1' && /[^\s;&|()<>]/.test(src[i + found.length] ?? '') ? '2>&' : found;
      if (raw) {
        const op = FD0_OPS[raw] ?? raw;
        const opToken = { op, line: lineAt(i) };
        tokens.push(opToken);
        i += raw.length;
        if ((op.endsWith('>&') || op.endsWith('<&')) && src[i] === '-') {
          tokens.push({ parts: [{ k: 'lit', s: '-' }], text: '-', line: lineAt(i), endLine: lineAt(i) });
          i++;
        }
        if (op === '<<' || op === '<<-' || FD_HEREDOC_BODIES.includes(op)) {
          while (src[i] === ' ' || src[i] === '\t') i++;
          const word = readParts(src, i, BREAKS);
          if (!word.parts.length) throw nearToken({ newline: true });
          tokens.push({ parts: word.parts, line: lineAt(i) });
          heredocs.push({ token: opToken, delim: word.parts.map(textOf).join(''), quoted: word.parts.some(isQuoted), strip: op.endsWith('<<-') });
          i = word.end;
        }
      } else {
        const word = readParts(src, i, BREAKS);
        if (word.parts.length) tokens.push({ parts: word.parts, text: src.slice(i, word.end), line: lineAt(i), endLine: lineAt(word.end) });
        i = word.end;
      }
    }
  }
  return tokens;
}

const isWord = (token, text) => token?.parts?.length === 1 && token.parts[0].k === 'lit' && token.parts[0].s === text;

const isAssignment = (parts) => parts[0]?.k === 'lit' && ASSIGNMENT.test(parts[0].s);
const isArrayAssignment = (parts) => parts.length === 1 && parts[0].k === 'lit' && /^[A-Za-z_][A-Za-z0-9_]*=$/.test(parts[0].s);
const isIndexedAssignment = (parts) => parts[0]?.k === 'lit' && INDEXED_ASSIGN.test(parts[0].s);

function parseIndexedAssignment(parts) {
  const [head, name, index] = INDEXED_ASSIGN.exec(parts[0].s);
  const rest = parts[0].s.slice(head.length);
  return { name, index: [{ k: 'lit', s: index }], value: rest ? [{ k: 'lit', s: rest }, ...parts.slice(1)] : parts.slice(1) };
}

function parseAssignment(parts) {
  const [, name] = ASSIGNMENT.exec(parts[0].s);
  const rest = parts[0].s.slice(name.length + 1);
  return { name, value: rest ? [{ k: 'lit', s: rest }, ...parts.slice(1)] : parts.slice(1) };
}

function parse(tokens, partial = false) {
  let pos = 0;

  const parseRedirect = () => {
    const opToken = tokens[pos++];
    const { op } = opToken;
    if (op === '2>&1') return { op };
    const target = tokens[pos];
    if (!target?.parts) throw nearToken(target ?? { newline: true });
    pos++;
    return { op, target: target.parts, text: target.text, body: opToken.body };
  };

  const litText = (token) => (token?.parts?.length === 1 && token.parts[0].k === 'lit' ? token.parts[0].s : null);
  const condNear = (token) => (token?.parts ? token.text : token?.newline ? 'newline' : (token?.op ?? 'newline'));
  const condError = (message, token, near) => bashSyntaxError(message, { line: token?.line, echo: true, near });

  const parseRegexOperand = (left) => {
    const parts = [];
    let end = pos + 2;
    while (tokens[end]?.parts ? !isWord(tokens[end], ']]') : ['(', ')', '|'].includes(tokens[end]?.op)) {
      parts.push(...(tokens[end].parts ?? [{ k: 'lit', s: tokens[end].op }]));
      end++;
    }
    if (!parts.length) throw condError("unexpected argument `" + condNear(tokens[pos + 2]) + "' to conditional binary operator", tokens[pos + 2], condNear(tokens[pos + 2]));
    pos = end;
    return { type: 'binary', op: '=~', left: left.parts, right: parts };
  };

  const parseCondLeaf = () => {
    const token = tokens[pos];
    if (isWord(token, ']]')) throw condError('', token, ']]');
    if (!token?.parts) throw nearToken(token ?? { newline: true });
    const op = litText(token);
    if (op !== null && /^-[a-zA-Z]$/.test(op)) {
      const operand = tokens[pos + 1];
      if (!operand?.parts || isWord(operand, ']]')) throw condError(`unexpected argument \`${condNear(operand)}' to conditional unary operator`, operand, condNear(operand));
      pos += 2;
      return { type: 'unary', op, parts: operand.parts };
    }
    const next = tokens[pos + 1];
    const binary = litText(next) ?? next?.op;
    if (CONDITIONAL_BINARY.has(binary)) {
      if (binary === '=~') return parseRegexOperand(token);
      const right = tokens[pos + 2];
      if (!right?.parts || isWord(right, ']]')) throw condError(`unexpected argument \`${condNear(right)}' to conditional binary operator`, right, condNear(right));
      pos += 3;
      return { type: 'binary', op: binary, left: token.parts, right: right.parts };
    }
    if (next?.parts ? !isWord(next, ']]') : !['&&', '||', ')'].includes(next?.op)) {
      throw condError(`unexpected token \`${condNear(next)}', conditional binary operator expected`, next, next?.parts ? next.text : condNear(token));
    }
    pos++;
    return { type: 'word', parts: token.parts };
  };

  const parseCondNot = () => {
    if (isWord(tokens[pos], '!')) {
      pos++;
      return { type: 'not', expr: parseCondNot() };
    }
    if (tokens[pos]?.op === '(') {
      pos++;
      const expr = parseCondOr();
      if (tokens[pos]?.op !== ')') throw condError(`unexpected token \`${condNear(tokens[pos])}', expected \`)'`, tokens[pos], condNear(tokens[pos]));
      pos++;
      return expr;
    }
    return parseCondLeaf();
  };

  const parseCondAnd = () => {
    let expr = parseCondNot();
    while (tokens[pos]?.op === '&&') {
      pos++;
      expr = { type: 'and', left: expr, right: parseCondNot() };
    }
    return expr;
  };

  const parseCondOr = () => {
    let expr = parseCondAnd();
    while (tokens[pos]?.op === '||') {
      pos++;
      expr = { type: 'or', left: expr, right: parseCondAnd() };
    }
    return expr;
  };

  const parseConditional = () => {
    const open = tokens[pos++];
    const expr = parseCondOr();
    const token = tokens[pos];
    if (!isWord(token, ']]')) {
      if (token) throw condError(`syntax error in conditional expression: unexpected token \`${condNear(token)}'`, token, condNear(token));
      throw nearToken({ newline: true });
    }
    pos++;
    return { type: 'cond', expr, line: open.line, redirects: parseTrailingRedirects() };
  };

  const parseArrayValue = () => {
    pos += 2;
    const words = [];
    for (;;) {
      const token = tokens[pos];
      if (!token) throw bashSyntaxError('syntax error: unexpected end of file', { eof: true });
      if (token.op === ')') {
        pos++;
        return words;
      }
      if (!token.parts) {
        if (!token.newline) throw nearToken(token);
      } else words.push(token.parts);
      pos++;
    }
  };

  const parseSimple = () => {
    if (isWord(tokens[pos], '[[')) return parseConditional();
    const first = tokens[pos];
    const line = first?.endLine ?? first?.line;
    const assigns = [];
    const words = [];
    const redirects = [];
    let arrayAt;
    while (pos < tokens.length) {
      const token = tokens[pos];
      if (token.parts && !words.length && isArrayAssignment(token.parts) && tokens[pos + 1]?.op === '(') {
        arrayAt = pos + 1;
        assigns.push({ name: token.parts[0].s.slice(0, -1), array: parseArrayValue() });
      } else if (token.parts && !words.length && isIndexedAssignment(token.parts)) {
        assigns.push(parseIndexedAssignment(token.parts));
        pos++;
      } else if (token.parts && !words.length && isAssignment(token.parts)) {
        assigns.push(parseAssignment(token.parts));
        pos++;
      } else if (token.parts) {
        words.push(token.parts);
        pos++;
      } else if (REDIRECTS.has(token.op)) redirects.push(parseRedirect());
      else break;
    }
    if (arrayAt !== undefined && words.length) throw nearToken(tokens[arrayAt]);
    if (!assigns.length && !words.length && !redirects.length) throw syntaxError(`unexpected '${tokens[pos]?.op ?? 'end of input'}'`);
    return { type: 'simple', assigns, words, redirects, line };
  };

  const parseTrailingRedirects = () => {
    const redirects = [];
    while (REDIRECTS.has(tokens[pos]?.op)) redirects.push(parseRedirect());
    return redirects;
  };

  const expectWord = (text) => {
    if (!isWord(tokens[pos], text)) throw syntaxError(`expected '${text}'`);
    pos++;
  };

  const parseBody = (stops) => {
    const start = pos;
    const list = parseSequence(stops);
    if (!list.items.length && start < tokens.length) throw nearToken(tokens[start]);
    return list;
  };

  const parseIf = () => {
    const branches = [];
    let elseBody = null;
    for (;;) {
      const cond = parseBody(['then']);
      expectWord('then');
      branches.push({ cond, body: parseBody(['elif', 'else', 'fi']) });
      if (isWord(tokens[pos], 'elif')) {
        pos++;
        continue;
      }
      if (isWord(tokens[pos], 'else')) {
        pos++;
        elseBody = parseBody(['fi']);
      }
      expectWord('fi');
      return { type: 'if', branches, elseBody, redirects: parseTrailingRedirects() };
    }
  };

  const parseFor = () => {
    const line = tokens[pos]?.line;
    const token = tokens[pos++];
    if (!token?.parts || token.parts.length !== 1 || token.parts[0].k !== 'lit') throw syntaxError("expected a name after 'for'");
    const name = token.parts[0].s;
    let words = null;
    let wordText = null;
    if (tokens[pos] && !isWord(tokens[pos], 'in') && !isWord(tokens[pos], 'do') && tokens[pos].op !== ';' && !tokens[pos].newline) throw nearToken(tokens[pos]);
    if (isWord(tokens[pos], 'in')) {
      pos++;
      words = [];
      wordText = [];
      while (tokens[pos]?.parts) {
        words.push(tokens[pos].parts);
        wordText.push(tokens[pos++].text);
      }
    }
    while (tokens[pos]?.op === ';') pos++;
    expectWord('do');
    const body = parseBody(['done']);
    expectWord('done');
    return { type: 'for', name, words, wordText, body, line, redirects: parseTrailingRedirects() };
  };

  const parseSelect = () => {
    const line = tokens[pos]?.line;
    const token = tokens[pos++];
    if (!token?.parts || token.parts.length !== 1 || token.parts[0].k !== 'lit') throw syntaxError("expected a name after 'select'");
    const name = token.parts[0].s;
    let words = null;
    let wordText = null;
    if (tokens[pos] && !isWord(tokens[pos], 'in') && !isWord(tokens[pos], 'do') && tokens[pos].op !== ';' && !tokens[pos].newline) throw nearToken(tokens[pos]);
    if (isWord(tokens[pos], 'in')) {
      pos++;
      words = [];
      wordText = [];
      while (tokens[pos]?.parts) {
        words.push(tokens[pos].parts);
        wordText.push(tokens[pos++].text);
      }
    }
    while (tokens[pos]?.op === ';') pos++;
    expectWord('do');
    const body = parseBody(['done']);
    expectWord('done');
    return { type: 'select', name, words, wordText, body, line, redirects: parseTrailingRedirects() };
  };

  const parseWhile = (negate) => {
    const cond = parseBody(['do']);
    expectWord('do');
    const body = parseBody(['done']);
    expectWord('done');
    return { type: 'while', negate, cond, body, redirects: parseTrailingRedirects() };
  };

  const parseCase = () => {
    const word = tokens[pos];
    if (!word?.parts) throw syntaxError("expected a word after 'case'");
    pos++;
    expectWord('in');
    const arms = [];
    while (pos < tokens.length) {
      while (tokens[pos]?.newline) pos++;
      if (isWord(tokens[pos], 'esac')) break;
      if (tokens[pos].op === '(') pos++;
      const patterns = [];
      for (;;) {
        const token = tokens[pos];
        if (!token?.parts) throw token ? nearToken(token) : syntaxError('expected a pattern');
        patterns.push(token.parts);
        pos++;
        if (tokens[pos]?.op !== '|') break;
        pos++;
      }
      if (tokens[pos]?.op !== ')') throw syntaxError("expected ')'");
      pos++;
      const body = parseSequence(['esac']);
      arms.push({ patterns, body });
      if (tokens[pos]?.op === ';;') pos++;
      else if (!isWord(tokens[pos], 'esac')) throw syntaxError("expected ';;'");
    }
    if (!isWord(tokens[pos], 'esac')) throw syntaxError("expected 'esac'");
    pos++;
    return { type: 'case', word: word.parts, arms, redirects: parseTrailingRedirects() };
  };

  const isCompoundOpen = (token) => ['if', 'for', 'select', 'while', 'until', 'case', '{'].some((word) => isWord(token, word)) || token.op === '(';

  const parseCommand = () => {
    const open = tokens[pos];
    try {
      return parseCommandBody();
    } catch (err) {
      if (err.bash || pos < tokens.length || !open || !isCompoundOpen(open)) throw err;
      throw eofError(open);
    }
  };

  const parseCommandBody = () => {
    const token = tokens[pos];
    if (!token) throw bashSyntaxError('syntax error: unexpected end of file', { eof: true });
    if (isWord(token, ']]')) throw nearToken(token);
    if (isWord(token, 'if')) {
      pos++;
      return parseIf();
    }
    if (isWord(token, 'for')) {
      pos++;
      return parseFor();
    }
    if (isWord(token, 'while') || isWord(token, 'until')) {
      pos++;
      return parseWhile(isWord(token, 'until'));
    }
    if (isWord(token, 'case')) {
      pos++;
      return parseCase();
    }
    if (token.op === '((') {
      pos++;
      return { type: 'arith', src: token.src, redirects: parseTrailingRedirects() };
    }
    if (token.op === '(') {
      pos++;
      const list = parseBody([]);
      if (tokens[pos]?.op !== ')') throw syntaxError("expected ')'");
      pos++;
      return { type: 'subshell', list, redirects: parseTrailingRedirects() };
    }
    if (isWord(token, '{')) {
      pos++;
      const list = parseBody(['}']);
      if (!isWord(tokens[pos], '}')) throw syntaxError("expected '}'");
      pos++;
      return { type: 'group', list, redirects: parseTrailingRedirects() };
    }
    if (token.op !== undefined) throw nearToken(token);
    if (isWord(token, 'function') && tokens[pos + 1]?.parts?.length === 1 && tokens[pos + 1].parts[0].k === 'lit') {
      const name = tokens[pos + 1].parts[0].s;
      pos += 2;
      if (tokens[pos]?.op === '(' && tokens[pos + 1]?.op === ')') pos += 2;
      while (tokens[pos]?.op === ';') pos++;
      const body = parseCommand();
      if (body.type !== 'group' && body.type !== 'subshell') throw syntaxError('a function body must be a group or a subshell');
      return { type: 'funcdef', name, body };
    }
    if (isWord(token, 'select') && tokens[pos + 1]?.parts) {
      pos++;
      return parseSelect();
    }
    if ((isWord(token, 'function') || isWord(token, 'select')) && !tokens[pos + 1]?.parts) throw nearToken(tokens[pos + 1] ?? { newline: true });
    const closer = ['then', 'elif', 'else', 'fi', 'do', 'done', 'esac', '}'].find((word) => isWord(token, word));
    if (closer) throw nearToken(token);
    if (token.parts.length === 1 && token.parts[0].k === 'lit' && tokens[pos + 1]?.op === '(' && tokens[pos + 2]?.op === ')') {
      pos += 3;
      while (tokens[pos]?.op === ';') pos++;
      const body = parseCommand();
      if (body.type !== 'group' && body.type !== 'subshell') throw syntaxError('a function body must be a group or a subshell');
      return { type: 'funcdef', name: token.parts[0].s, body };
    }
    if (token.parts.length === 1 && token.parts[0].k === 'lit' && !token.parts[0].s.includes('=') && tokens[pos + 1]?.op === '(' && token.parts[0].s !== '[[') throw nearToken(tokens[pos + 2] ?? { newline: true });
    return parseSimple();
  };

  const parsePipeline = () => {
    const negate = isWord(tokens[pos], '!');
    if (negate) pos++;
    const cmds = negate && (pos >= tokens.length || tokens[pos].op === ';') ? [] : [parseCommand()];
    while (tokens[pos]?.op === '|' || tokens[pos]?.op === '|&') {
      if (tokens[pos].op === '|&') cmds[cmds.length - 1].mergeStderr = true;
      pos++;
      while (tokens[pos]?.newline) pos++;
      cmds.push(parseCommand());
    }
    return { cmds, negate };
  };

  const atCloser = (stops) => tokens[pos].op === ')' || tokens[pos].op === ';;' || stops.some((word) => isWord(tokens[pos], word));

  const parseSequence = (stops, topLevel = false) => {
    const items = [];
    let op = null;
    const endsLine = () => {
      if (!topLevel || !tokens[pos]?.newline) return false;
      pos++;
      return true;
    };
    while (pos < tokens.length && !atCloser(stops)) {
      if (tokens[pos].op === ';' && !tokens[pos].newline) throw nearToken(tokens[pos]);
      if (tokens[pos].op === ';') {
        pos++;
        continue;
      }
      items.push({ op, pipe: parsePipeline(), background: false });
      const next = tokens[pos];
      if (topLevel && next?.newline) {
        pos++;
        break;
      }
      if (next?.op === '&') {
        pos++;
        items.at(-1).background = true;
        op = ';';
        if (endsLine()) break;
      } else if (next?.op === ';') {
        pos++;
        op = ';';
        if (endsLine()) break;
      } else if (next?.op === '&&' || next?.op === '||') {
        pos++;
        op = next.op;
        while (tokens[pos]?.newline) pos++;
        if (pos >= tokens.length) throw bashSyntaxError('syntax error: unexpected end of file', { eof: true });
      } else break;
    }
    return { items };
  };

  const list = { items: [] };
  let error = null;
  try {
    while (pos < tokens.length) {
      if (tokens[pos].op === ';' && !tokens[pos].newline) throw nearToken(tokens[pos]);
      if (tokens[pos].op === ';') {
        pos++;
        continue;
      }
      const command = parseSequence([], true);
      if (pos < tokens.length && !tokens[pos - 1]?.newline) throw nearToken(tokens[pos]);
      if (!command.items.length) throw nearToken(tokens[pos]);
      if (list.items.length) command.items[0].op = ';';
      list.items.push(...command.items);
    }
  } catch (err) {
    if (!partial) throw err;
    error = err;
  }
  return partial ? { list, error } : list;
}

export function parseScript(src, firstLine, substitution = false) {
  return parse(tokenize(src, firstLine, substitution));
}

function syntaxReport(err, src) {
  if (!err.bash) return err.message + '\n';
  const line = err.line ?? (err.eof ? src.replace(/\n$/, '').split('\n').length + 1 : 1 + (src.slice(0, err.at ?? src.length).match(/\n/g) ?? []).length);
  const prefix = 'bash: -c: line ' + line + ': ';
  const echoed = err.echo ? prefix + '`' + src.split('\n')[line - 1] + "'\n" : '';
  const head = err.message ? prefix + err.message + '\n' : '';
  const near = err.near === undefined ? '' : prefix + 'syntax error near `' + err.near + "'\n";
  return head + near + echoed;
}

export function syntaxText(src) {
  const { error } = parseScriptPartial(src);
  return error ? syntaxReport(error, src) : null;
}

export function parseScriptPartial(src) {
  let failure;
  try {
    return parse(tokenize(src), true);
  } catch (err) {
    failure = err;
  }
  const lines = src.split('\n');
  for (let k = lines.length - 1; k >= 0; k--) {
    const prefix = lines.slice(0, k).map((line) => line + '\n').join('');
    try {
      const { list, error } = parse(tokenize(prefix), true);
      return { list, error: error ?? failure };
    } catch {
      continue;
    }
  }
  return { list: { items: [] }, error: failure };
}

const ok = (out) => ({ code: 0, out, err: '' });
const basenameOf = (name) => name.split('/').filter(Boolean).pop() ?? name;
const parentOf = (path) => path.slice(0, path.lastIndexOf('/')) || '/';
const linesOf = (text) => {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
};
const yieldTurn = () => new Promise((done) => setTimeout(done, 0));
const joinLines = (lines) => lines.map((line) => line + '\n').join('');
function argsOf(argv, valued) {
  const flags = new Map();
  const operands = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const attached = valued.find((flag) => arg.startsWith(flag) && arg.length > flag.length);
    if (valued.includes(arg)) flags.set(arg, argv[++i] ?? '');
    else if (attached) flags.set(attached, arg.slice(attached.length));
    else if (/^-\d+$/.test(arg)) flags.set('-n', arg.slice(1));
    else if (/^-[a-zA-Z]+$/.test(arg)) for (const ch of arg.slice(1)) flags.set('-' + ch, true);
    else operands.push(arg);
  }
  return { flags, operands };
}
function fieldPicks(spec) {
  return spec.split(',').map((part) => {
    const dash = part.indexOf('-');
    if (dash < 0) return [Number(part), Number(part)];
    const from = part.slice(0, dash) === '' ? 1 : Number(part.slice(0, dash));
    const to = part.slice(dash + 1) === '' ? Infinity : Number(part.slice(dash + 1));
    return [from, to];
  });
}

function globRegExp(pattern, caseInsensitive = false) {
  const body = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${body}$`, caseInsensitive ? 'i' : '');
}

function padNumber(n, width) {
  const digits = String(Math.abs(n)).padStart(width - (n < 0 ? 1 : 0), '0');
  return n < 0 ? '-' + digits : digits;
}

function braceRange(inner) {
  const numeric = /^(-?\d+)\.\.(-?\d+)$/.exec(inner);
  if (numeric) {
    const [a, b] = [numeric[1], numeric[2]];
    const width = /^-?0\d/.test(a) || /^-?0\d/.test(b) ? Math.max(a.length, b.length) : 0;
    const from = Number(a);
    const to = Number(b);
    const step = from <= to ? 1 : -1;
    const values = [];
    for (let n = from; step > 0 ? n <= to : n >= to; n += step) values.push(padNumber(n, width));
    return values;
  }
  const letters = /^([a-zA-Z])\.\.([a-zA-Z])$/.exec(inner);
  if (letters) {
    const from = letters[1].charCodeAt(0);
    const to = letters[2].charCodeAt(0);
    const step = from <= to ? 1 : -1;
    const values = [];
    for (let c = from; step > 0 ? c <= to : c >= to; c += step) values.push(String.fromCharCode(c));
    return values;
  }
  return null;
}

function splitTopCommas(inner) {
  const pieces = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === ',' && depth === 0) {
      pieces.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  pieces.push(inner.slice(start));
  return pieces;
}

function braceExpand(text) {
  const open = text.indexOf('{');
  if (open < 0) return [text];
  let depth = 0;
  let close = -1;
  for (let i = open; i < text.length && close < 0; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) close = i;
  }
  if (close < 0) return [text];
  const pre = text.slice(0, open);
  const post = text.slice(close + 1);
  const inner = text.slice(open + 1, close);
  const range = braceRange(inner);
  if (range) return range.flatMap((alt) => braceExpand(pre + alt + post));
  const alts = splitTopCommas(inner);
  if (alts.length < 2) return braceExpand(inner).flatMap((mid) => braceExpand(post).map((rest) => pre + '{' + mid + '}' + rest));
  return alts.flatMap((alt) => braceExpand(pre + alt + post));
}

const MD5_SHIFTS = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const MD5_CONSTANTS = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

function utf8Bytes(text) {
  const encoded = encodeURIComponent(text);
  const bytes = [];
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === '%') {
      bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(encoded.charCodeAt(i));
  }
  return bytes;
}

const SHA256_ROUNDS = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
const rotateRight = (x, n) => (x >>> n) | (x << (32 - n));
function sha256Hex(bytes) {
  const blocks = ((bytes.length + 9 + 63) >> 6) << 6;
  const padded = new Uint8Array(blocks);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(blocks - 8, Math.floor((bytes.length * 8) / 0x100000000));
  view.setUint32(blocks - 4, (bytes.length * 8) >>> 0);
  const state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  for (let offset = 0; offset < blocks; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotateRight(w[i - 15], 7) ^ rotateRight(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotateRight(w[i - 2], 17) ^ rotateRight(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)) + ((e & f) ^ (~e & g)) + SHA256_ROUNDS[i] + w[i]) >>> 0;
      const t2 = ((rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    const working = [a, b, c, d, e, f, g, h];
    for (let i = 0; i < 8; i++) state[i] = (state[i] + working[i]) >>> 0;
  }
  return state.map((word) => word.toString(16).padStart(8, '0')).join('');
}

function md5Hex(bytes) {
  const data = bytes.concat([0x80]);
  while (data.length % 64 !== 56) data.push(0);
  const bitLength = bytes.length * 8;
  for (let i = 0; i < 4; i++) data.push((bitLength >>> (8 * i)) & 0xff);
  for (let i = 0; i < 4; i++) data.push((Math.floor(bitLength / 2 ** 32) >>> (8 * i)) & 0xff);
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let offset = 0; offset < data.length; offset += 64) {
    const words = [];
    for (let i = 0; i < 16; i++) {
      const at = offset + 4 * i;
      words[i] = data[at] | (data[at + 1] << 8) | (data[at + 2] << 16) | (data[at + 3] << 24);
    }
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let f;
      let g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      f = (f + a + MD5_CONSTANTS[i] + words[g]) | 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((f << MD5_SHIFTS[i]) | (f >>> (32 - MD5_SHIFTS[i])))) | 0;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }
  return [a0, b0, c0, d0].map((word) => [0, 8, 16, 24].map((shift) => ((word >>> shift) & 0xff).toString(16).padStart(2, '0')).join('')).join('');
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64Encode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += BASE64_ALPHABET[(n >> 18) & 63] + BASE64_ALPHABET[(n >> 12) & 63];
    out += i + 1 < bytes.length ? BASE64_ALPHABET[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? BASE64_ALPHABET[n & 63] : '=';
  }
  return out;
}

function base64Decode(text) {
  const body = text.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body)) return null;
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of body) {
    if (ch === '=') break;
    buffer = ((buffer << 6) | BASE64_ALPHABET.indexOf(ch)) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return bytes;
}

function bytesToText(bytes) {
  try {
    return decodeURIComponent(bytes.map((byte) => '%' + byte.toString(16).padStart(2, '0')).join(''));
  } catch {
    return String.fromCharCode(...bytes);
  }
}
function diffBlocks(a, b) {
  const n = a.length;
  const m = b.length;
  const table = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const hunks = [];
  let hunk = null;
  const open = (i, j) => {
    if (!hunk) hunk = { a0: i, a1: i, b0: j, b1: j };
  };
  const close = () => {
    if (hunk) hunks.push(hunk);
    hunk = null;
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      close();
      i++;
      j++;
    } else if (j >= m || (i < n && table[i + 1][j] >= table[i][j + 1])) {
      open(i, j);
      i++;
      hunk.a1 = i;
    } else {
      open(i, j);
      j++;
      hunk.b1 = j;
    }
  }
  close();
  return hunks;
}

function lineDiff(a, b) {
  const range = (start, end) => (end - start === 1 ? String(start + 1) : (start + 1) + ',' + end);
  const hunks = diffBlocks(a, b);
  let out = '';
  for (const h of hunks) {
    const dels = a.slice(h.a0, h.a1).map((line) => '< ' + line + '\n').join('');
    const ins = b.slice(h.b0, h.b1).map((line) => '> ' + line + '\n').join('');
    if (dels && ins) out += range(h.a0, h.a1) + 'c' + range(h.b0, h.b1) + '\n' + dels + '---\n' + ins;
    else if (dels) out += range(h.a0, h.a1) + 'd' + h.b0 + '\n' + dels;
    else out += h.a0 + 'a' + range(h.b0, h.b1) + '\n' + ins;
  }
  return out;
}

function contextGroups(blocks, width) {
  const groups = [];
  for (const block of blocks) {
    const last = groups.at(-1);
    if (last && block.a0 - last.at(-1).a1 <= 2 * width) last.push(block);
    else groups.push([block]);
  }
  return groups;
}

function unifiedRange(start, count) {
  if (count === 0) return start + ',0';
  return count === 1 ? String(start + 1) : (start + 1) + ',' + count;
}

function unifiedDiff(a, b, width, headers) {
  const blocks = diffBlocks(a, b);
  if (!blocks.length) return '';
  let out = '--- ' + headers[0] + '\n+++ ' + headers[1] + '\n';
  for (const group of contextGroups(blocks, width)) {
    const first = group[0];
    const last = group.at(-1);
    const lead = Math.min(width, first.a0);
    const trail = Math.min(width, a.length - last.a1);
    const loA = first.a0 - lead;
    const hiA = last.a1 + trail;
    const loB = first.b0 - lead;
    const hiB = last.b1 + trail;
    out += '@@ -' + unifiedRange(loA, hiA - loA) + ' +' + unifiedRange(loB, hiB - loB) + ' @@\n';
    let ai = loA;
    for (const block of group) {
      for (; ai < block.a0; ai++) out += ' ' + a[ai] + '\n';
      for (; ai < block.a1; ai++) out += '-' + a[ai] + '\n';
      for (let bi = block.b0; bi < block.b1; bi++) out += '+' + b[bi] + '\n';
    }
    for (; ai < hiA; ai++) out += ' ' + a[ai] + '\n';
  }
  return out;
}

const UMASK = 0o022;
const CHMOD_SHIFT = { u: 6, g: 3, o: 0 };
const CHMOD_SPECIAL = { u: 0o4000, g: 0o2000, o: 0o1000 };

function formatMode(bits) {
  return bits.toString(8);
}

function symbolicMode(bits) {
  return [6, 3, 0].map((shift, index) => {
    const special = bits & [0o4000, 0o2000, 0o1000][index];
    const run = (bits >> shift) & 1;
    const execute = index < 2 ? ['S', 's'] : ['T', 't'];
    const x = special ? (run ? execute[1] : execute[0]) : run ? 'x' : '-';
    return ((bits >> shift) & 4 ? 'r' : '-') + ((bits >> shift) & 2 ? 'w' : '-') + x;
  }).join('');
}

function octalModeText(bits) {
  return bits.toString(8).padStart(4, '0') + ' (' + symbolicMode(bits) + ')';
}

function applySymbolicMode(bits, spec, isDir) {
  for (const clause of spec.split(',')) {
    const who = /^[ugoa]*/.exec(clause)[0];
    const rest = clause.slice(who.length);
    if (!rest) return { error: 'invalid mode (' + clause + ')' };
    const op = rest[0];
    if (!'+-='.includes(op)) return { error: 'invalid operator (expected +, -, or =, but found ' + op + ')' };
    const perms = rest.slice(1);
    for (const ch of perms) if (!'rwxXstugo'.includes(ch)) return { error: 'invalid operator (expected +, -, or =, but found ' + ch + ')' };
    const implicit = who === '';
    const classes = implicit || who.includes('a') ? ['u', 'g', 'o'] : [...new Set(who)];
    const anyExec = (bits & 0o111) !== 0;
    for (const target of classes) {
      const shift = CHMOD_SHIFT[target];
      let value = 0;
      for (const ch of perms) {
        if (ch === 'r') value |= 4;
        else if (ch === 'w') value |= 2;
        else if (ch === 'x') value |= 1;
        else if (ch === 'X') {
          if (isDir || anyExec) value |= 1;
        } else if (ch === 'u' || ch === 'g' || ch === 'o') value |= (bits >> CHMOD_SHIFT[ch]) & 7;
      }
      if (implicit && op !== '-') value &= ~((UMASK >> shift) & 7);
      let special = 0;
      if (perms.includes('s') && target !== 'o') special |= CHMOD_SPECIAL[target];
      if (perms.includes('t') && target === 'o') special |= CHMOD_SPECIAL.o;
      if (op === '+') bits |= (value << shift) | special;
      else if (op === '-') bits &= ~((value << shift) | special);
      else bits = (bits & ~((7 << shift) | CHMOD_SPECIAL[target])) | (value << shift) | special;
    }
  }
  return { bits };
}

function contextRange(start, count) {
  if (count === 0) return String(start);
  return count === 1 ? String(start + 1) : (start + 1) + ',' + (start + count);
}

function contextDiff(a, b, width, headers) {
  const blocks = diffBlocks(a, b);
  if (!blocks.length) return '';
  let out = '*** ' + headers[0] + '\n--- ' + headers[1] + '\n';
  for (const group of contextGroups(blocks, width)) {
    const first = group[0];
    const last = group.at(-1);
    const lead = Math.min(width, first.a0);
    const trail = Math.min(width, a.length - last.a1);
    const loA = first.a0 - lead;
    const hiA = last.a1 + trail;
    const loB = first.b0 - lead;
    const hiB = last.b1 + trail;
    let oldText = '';
    let newText = '';
    let hasOld = false;
    let hasNew = false;
    let ai = loA;
    for (const block of group) {
      for (; ai < block.a0; ai++) {
        oldText += '  ' + a[ai] + '\n';
        newText += '  ' + a[ai] + '\n';
      }
      const mark = block.a1 > block.a0 && block.b1 > block.b0 ? '! ' : null;
      hasOld = hasOld || block.a1 > block.a0;
      hasNew = hasNew || block.b1 > block.b0;
      for (; ai < block.a1; ai++) oldText += (mark ?? '- ') + a[ai] + '\n';
      for (let bi = block.b0; bi < block.b1; bi++) newText += (mark ?? '+ ') + b[bi] + '\n';
    }
    for (; ai < hiA; ai++) {
      oldText += '  ' + a[ai] + '\n';
      newText += '  ' + a[ai] + '\n';
    }
    out += '***************\n*** ' + contextRange(loA, hiA - loA) + ' ****\n' + (hasOld ? oldText : '');
    out += '--- ' + contextRange(loB, hiB - loB) + ' ----\n' + (hasNew ? newText : '');
  }
  return out;
}

const TRACE_SAFE = /^[\w@%+=:,./-]+$/;

function traceWord(word) {
  if (TRACE_SAFE.test(word)) return word;
  return "'" + word.replaceAll("'", "'\\''") + "'";
}

function traceLines(assigned, argv, prefix) {
  let text = '';
  for (const [name, value] of assigned) text += prefix + name + '=' + (value === '' ? '' : traceWord(value)) + '\n';
  if (argv.length) text += prefix + argv.map(traceWord).join(' ') + '\n';
  return text;
}

class ExprFailure extends Error {}

const CHARACTER_CLASSES = {
  alpha: 'a-zA-Z',
  digit: '0-9',
  alnum: 'a-zA-Z0-9',
  upper: 'A-Z',
  lower: 'a-z',
  space: ' \\t\\n\\r\\f\\v',
  blank: ' \\t',
  xdigit: '0-9A-Fa-f',
  punct: '\\x21-\\x2f\\x3a-\\x40\\x5b-\\x60\\x7b-\\x7e',
};

function characterClass(name) {
  if (!Object.hasOwn(CHARACTER_CLASSES, name)) throw new ExprFailure('Invalid character class name');
  return CHARACTER_CLASSES[name];
}

const STROKED_BASE = { 'ø': 'o', 'ǿ': 'o', 'ſ': 's', 'ẛ': 's', 'ŀ': 'l', 'ł': 'l', 'ð': 'd', 'đ': 'd' };
const LETTER_GLYPHS = new Map([
  [0x1d79, 'g'], [0x1d9e, 'd'], [0x1f18a, 'p'], [0x1f1a5, 'd'],
  ...Array.from({ length: 26 }, (_, i) => [0x1f150 + i, String.fromCharCode(97 + i)]),
  ...Array.from({ length: 26 }, (_, i) => [0x1f170 + i, String.fromCharCode(97 + i)]),
]);
const COMPATIBILITY_RANGES = [[0xaa, 0xaa], [0x2070, 0x209f], [0x2460, 0x24ff], [0x1d00, 0x1dbf], [0x1d400, 0x1d7ff], [0x1f100, 0x1f1ff], [0xff00, 0xffef]];
const inCompatibilityRange = (cp) => COMPATIBILITY_RANGES.some(([start, end]) => cp >= start && cp <= end);
const compatibilityBase = (folded) => {
  if (LETTER_GLYPHS.has(folded.codePointAt(0))) return LETTER_GLYPHS.get(folded.codePointAt(0));
  const letters = Array.from(folded.normalize('NFKD')).filter((char) => /\p{L}/u.test(char));
  return letters.length === 1 ? letters[0].toLowerCase() : folded;
};
const equivalenceBase = (letter) => {
  const folded = letter.toLowerCase();
  if (inCompatibilityRange(folded.codePointAt(0))) return compatibilityBase(folded);
  const decomposed = Array.from(folded.normalize('NFD'));
  if (folded === 'й') return folded;
  return STROKED_BASE[folded] ?? decomposed[0];
};
const equivalenceClasses = new Map();
const equivalenceItems = (letter) => {
  const base = equivalenceBase(letter);
  if (!equivalenceClasses.has(base)) {
    const members = new Set([base, base.toUpperCase()].filter((member) => Array.from(member).length === 1));
    for (const [start, end] of [[0xc0, 0x24f], [0x370, 0x3ff], [0x400, 0x4ff], [0x1e00, 0x1eff], [0x1f00, 0x1fff], ...COMPATIBILITY_RANGES]) {
      for (let cp = start; cp <= end; cp++) {
        const candidate = String.fromCodePoint(cp);
        if (equivalenceBase(candidate) === base) members.add(candidate);
      }
    }
    equivalenceClasses.set(base, [...members].map((member) => '\\u{' + member.codePointAt(0).toString(16) + '}').join(''));
  }
  return equivalenceClasses.get(base);
};
const collatingEnd = (pattern, start) => {
  const kind = pattern[start + 1];
  const end = pattern.indexOf(kind + ']', start + 2);
  if (end < 0) throw new ExprFailure('Unmatched [, [^, [:, [., or [=');
  const symbol = Array.from(pattern.slice(start + 2, end));
  if (symbol.length !== 1) throw new ExprFailure('Invalid collation character');
  if (kind === '.' && !/^[A-Za-z0-9]$/.test(symbol[0])) throw new ExprFailure(symbol[0].codePointAt(0) > 127 ? 'Invalid collation character' : 'equivalence classes and collating symbols are not supported');
  return end + 2;
};
function breToJs(pattern) {
  let out = '';
  let groups = 0;
  let depth = 0;
  let atStart = true;
  const literal = (ch) => ch.replace(/[.*+?^$(){}|[\]\\\/]/g, '\\$&');
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      i++;
      if (i >= pattern.length) throw new ExprFailure('Trailing backslash');
      const next = pattern[i];
      atStart = false;
      if (next === '(') {
        groups++;
        depth++;
        out += '(';
        atStart = true;
      } else if (next === ')') {
        if (depth === 0) throw new ExprFailure('Unmatched ) or \\)');
        depth--;
        out += ')';
      } else if (next === '|') {
        out += '|';
        atStart = true;
      } else if (next === '{') {
        const close = pattern.indexOf('\\}', i);
        if (close < 0) throw new ExprFailure('Unmatched \\{');
        out += '{' + pattern.slice(i + 1, close) + '}';
        i = close + 1;
      } else if (next === '+' || next === '?') {
        out += next;
      } else if (/[1-9]/.test(next)) {
        out += '\\' + next;
      } else {
        out += literal(next);
      }
    } else if ('(){}+?|'.includes(ch)) {
      out += '\\' + ch;
      atStart = false;
    } else if (ch === '*') {
      out += atStart ? '\\*' : '*';
      atStart = false;
    } else if (ch === '^') {
      out += atStart ? '^' : '\\^';
    } else if (ch === '$') {
      const atEnd = i === pattern.length - 1 || pattern.startsWith('\\)', i + 1) || pattern.startsWith('\\|', i + 1);
      out += atEnd ? '$' : '\\$';
      atStart = false;
    } else if (ch === '[') {
      let j = i + 1;
      if (pattern[j] === '^') j++;
      if (pattern[j] === ']') j++;
      while (j < pattern.length && pattern[j] !== ']') {
        if (pattern.startsWith('[=', j) || pattern.startsWith('[.', j)) j = collatingEnd(pattern, j);
        else if (pattern.startsWith('[:', j) && pattern.includes(':]', j + 2)) j = pattern.indexOf(':]', j + 2) + 2;
        else j++;
      }
      if (j >= pattern.length) throw new ExprFailure('Unmatched [, [^, [:, [., or [=');
      const body = pattern.slice(i + 1, j);
      const negate = body.startsWith('^');
      const items = (negate ? body.slice(1) : body).replace(/\\/g, '\\\\').replace(/\[=(.)=\]/gu, (_, letter) => equivalenceItems(letter)).replace(/\[\.([A-Za-z0-9])\.\]/g, '$1').replace(/\[:(\w+):\]/g, (_, name) => characterClass(name)).replace(/^\]/, '\\]');
      out += '[' + (negate ? '^' : '') + items + ']';
      i = j;
      atStart = false;
    } else if (ch === '.') {
      out += '[\\s\\S]';
      atStart = false;
    } else {
      out += literal(ch);
      atStart = false;
    }
  }
  if (depth > 0) throw new ExprFailure('Unmatched ( or \\(');
  return { source: out, groups };
}

function matchString(text, pattern) {
  const { source, groups } = breToJs(pattern);
  const n = Array.from(text).length;
  for (let end = n; end >= 0; end--) {
    const found = new RegExp('^(?:' + source + ')(?=[\\s\\S]{' + (n - end) + '}$)', 'u').exec(text);
    if (found) return groups > 0 ? (found[1] ?? '') : String(end);
  }
  return groups > 0 ? '' : '0';
}

const LOCALE_NAMES = ['LC_ALL', 'LC_CTYPE', 'LANG'];
const LOCALE_MODES = new Map([['C', 'bytes'], ['POSIX', 'bytes'], ['C.UTF-8', 'characters'], ['C.utf8', 'characters'], ['en_US.UTF-8', 'characters'], ['en_US.utf8', 'characters']]);
const DEFAULT_LANG = 'en_US.UTF-8';
const NON_READERS = new Set(['true', 'false', 'echo', 'printf', 'exit', 'cd', 'export', 'unset', 'return', 'test', '[', ':', 'pwd', 'set', 'shift', 'local']);
const PARTIAL_READERS = new Set(['read', 'head']);
function headEnd(text, count) {
  let end = 0;
  for (let line = 0; line < count; line++) {
    const next = text.indexOf('\n', end);
    if (next === -1) return text.length;
    end = next + 1;
  }
  return end;
}
const BASH_BUILTINS = new Set(['.', ':', '[', 'alias', 'bg', 'break', 'builtin', 'caller', 'cd', 'command', 'continue', 'declare', 'dirs', 'disown', 'echo', 'enable', 'eval', 'exec', 'exit', 'export', 'false', 'fc', 'fg', 'getopts', 'hash', 'help', 'history', 'jobs', 'kill', 'let', 'local', 'logout', 'mapfile', 'popd', 'printf', 'pushd', 'pwd', 'read', 'readarray', 'readonly', 'return', 'set', 'shift', 'shopt', 'source', 'suspend', 'test', 'times', 'trap', 'true', 'type', 'typeset', 'ulimit', 'umask', 'unalias', 'unset', 'wait']);

const COLLATION_PRIMARY = ' !"#%&\'()*+,-./:;<=>?@[\\]^_' + '\x60' + '{|}~$0123456789' + 'abcdefghiıjklmnŋopqĸrstŧuvwxyzþ' + 'αβγδεζηθικλμνξοπρστυφχψω' + '\u0430\u04d9\u0431\u0432\u0433\u0493\u0434\u0452\u0499\u0435\u0454\u0436\u0437\u0438\u0456\u0439\u0458\u043a\u049b\u04a1\u043b\u0459\u043c\u043d\u04a3\u045a\u043e\u04e9\u043f\u0481\u0440\u0441\u04ab\u0442\u045b\u0443\u04af\u0479\u0444\u0445\u04b3\u0461\u047f\u047d\u0446\u0447\u04b7\u045f\u0448\u0449\u044a\u044b\u044c\u0463\u044d\u044e\u044f\u0467\u046b\u046f\u0471\u0473\u0475\u04cf';
const COLLATION_ACCENTS = '̧́̀̂̊̈̃̆̏';
const COLLATING_LOCALES = new Set(['en_US.UTF-8', 'en_US.utf8']);
const COLLATION_VARIANT = 10;
const COLLATION_OBLIQUE = 9;
const COLLATION_FORMS = new Map([
  ['ß', [{ base: 's', variant: true, compat: true }, { base: 's', compat: true }]],
  ['æ', [{ base: 'a', variant: true, compat: true }, { base: 'e', compat: true }]],
  ['œ', [{ base: 'o', variant: true, compat: true }, { base: 'e', compat: true }]],
  ['ð', [{ base: 'd', variant: true, compat: true }]],
  ['ſ', [{ base: 's', variant: true, compat: true }]],
  ['ĳ', [{ base: 'i', compat: true }, { base: 'j', compat: true }]],
  ['ґ', [{ base: 'г', variant: true, compat: true }]],
  ['й', [{ base: 'й' }]],
  ['đ', [{ base: 'd', oblique: true }]],
  ['ħ', [{ base: 'h', oblique: true }]],
  ['ł', [{ base: 'l', oblique: true }]],
  ['ø', [{ base: 'o', oblique: true }]],
  ['ς', [{ base: 'σ', final: true }]],
]);

const collationUnits = (text) => {
  const units = [];
  const push = (base, upper, form) => units.push({ base, upper, accents: [], variant: form.variant === true, oblique: form.oblique === true, compat: form.compat === true, final: form.final === true });
  for (const raw of text) {
    const rawLower = raw.toLowerCase();
    const forms = COLLATION_FORMS.get(rawLower);
    if (forms) {
      for (const form of forms) push(form.base, raw !== rawLower, form);
      continue;
    }
    for (const char of raw.normalize('NFD')) {
      if (COLLATION_ACCENTS.includes(char)) {
        if (units.length) units.at(-1).accents.push(char);
        continue;
      }
      const lower = char.toLowerCase();
      push(lower, char !== lower, {});
    }
  }
  return units;
};

const collationLevels = (text) => {
  const units = collationUnits(text);
  const weight = (base) => {
    const at = COLLATION_PRIMARY.indexOf(base);
    return at === -1 ? COLLATION_PRIMARY.length + base.codePointAt(0) : at;
  };
  const letters = units.filter((unit) => /[\p{L}\p{N}]/u.test(unit.base));
  const accentRank = (unit) => (unit.accents.length ? COLLATION_ACCENTS.indexOf(unit.accents[0]) + 1 : 0);
  const caseLevel = (unit) => {
    if (unit.final) return 2;
    if (unit.compat) return unit.upper ? 3 : 2;
    return unit.upper ? 1 : 0;
  };
  return [
    units.filter((unit) => /[\p{L}\p{N}]/u.test(unit.base) || unit.base === '$').map((unit) => weight(unit.base)),
    letters.flatMap((unit) => [0, ...(unit.accents.length ? [accentRank(unit)] : []), ...(unit.oblique ? [COLLATION_OBLIQUE] : []), ...(unit.variant ? [COLLATION_VARIANT] : [])]),
    letters.flatMap((unit) => [caseLevel(unit), ...(unit.oblique ? [0] : []), ...(unit.variant ? [2] : [])]),
    units.map((unit) => weight(unit.base)),
  ];
};

const compareSequences = (left, right) => {
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
};

const collate = (left, right) => {
  const a = collationLevels(left);
  const b = collationLevels(right);
  for (let level = 0; level < a.length; level++) {
    const order = compareSequences(a[level], b[level]);
    if (order !== 0) return order;
  }
  return left < right ? -1 : left > right ? 1 : 0;
};

function localeChoice(get) {
  for (const name of LOCALE_NAMES) {
    const value = get(name);
    if (value) return { name, value };
  }
  return { name: null, value: 'C' };
}

function characterWidth(char, mode) {
  return mode === 'bytes' ? new TextEncoder().encode(char).length : 1;
}

function characterCount(text, mode) {
  return Array.from(text).reduce((total, char) => total + characterWidth(char, mode), 0);
}

function exprEval(argv, mode) {
  const isInt = (s) => /^[+-]?\d+$/.test(s);
  const truthy = (value) => value !== '' && value !== '0';
  if (!argv.length) return { code: 2, out: '', err: 'expr: missing operand\n' };
  if (argv.length === 1) return { code: truthy(argv[0]) ? 0 : 1, out: argv[0] + '\n', err: '' };
  let pos = 0;
  const fail = (message) => {
    throw new ExprFailure(message);
  };
  const take = () => {
    if (pos >= argv.length) fail("syntax error: missing argument after '" + argv[pos - 1] + "'");
    return argv[pos++];
  };
  const arith = (op, left, right) => {
    if (!isInt(left) || !isInt(right)) fail('non-integer argument');
    const a = Number(left);
    const b = Number(right);
    if ((op === '/' || op === '%') && b === 0) fail('division by zero');
    const value = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : op === '/' ? Math.trunc(a / b) : a % b;
    return String(value);
  };
  const compare = (op, left, right) => {
    const numeric = isInt(left) && isInt(right);
    const x = numeric ? Number(left) : left;
    const y = numeric ? Number(right) : right;
    const holds = op === '=' ? x === y : op === '!=' ? x !== y : op === '<' ? x < y : op === '>' ? x > y : op === '<=' ? x <= y : x >= y;
    return holds ? '1' : '0';
  };
  const indexOfChars = (text, chars) => {
    if (!chars.length) return '0';
    let before = 0;
    for (const point of Array.from(text)) {
      if (chars.includes(point)) return String(before + 1);
      before += characterWidth(point, mode);
    }
    return '0';
  };
  const substring = (text, start, length) => {
    const from = isInt(start) ? Number(start) : 0;
    const count = isInt(length) ? Number(length) : 0;
    const points = Array.from(text);
    if (from < 1 || from > points.length || count <= 0) return '';
    return points.slice(from - 1, from - 1 + count).join('');
  };
  const primary = () => {
    if (pos >= argv.length) fail("syntax error: missing argument after '" + argv[pos - 1] + "'");
    const token = argv[pos++];
    if (token === ')') fail("syntax error: unexpected argument ')'");
    if (token === 'length') return String(characterCount(take(), mode));
    if (token === 'index') {
      const text = take();
      return indexOfChars(text, take());
    }
    if (token === 'substr') {
      const text = take();
      const start = take();
      return substring(text, start, take());
    }
    if (token === 'match') {
      const text = take();
      return matchString(text, take());
    }
    if (token !== '(') return token;
    const inner = disjunction();
    if (argv[pos] !== ')') fail("syntax error: expecting ')' after '" + argv[pos - 1] + "'");
    pos++;
    return inner;
  };
  const matched = () => {
    let value = primary();
    while (argv[pos] === ':') {
      pos++;
      value = matchString(value, primary());
    }
    return value;
  };
  const multiplicative = () => {
    let value = matched();
    while (argv[pos] === '*' || argv[pos] === '/' || argv[pos] === '%') {
      const op = argv[pos++];
      value = arith(op, value, matched());
    }
    return value;
  };
  const additive = () => {
    let value = multiplicative();
    while (argv[pos] === '+' || argv[pos] === '-') {
      const op = argv[pos++];
      value = arith(op, value, multiplicative());
    }
    return value;
  };
  const comparison = () => {
    let value = additive();
    while (['=', '!=', '<', '>', '<=', '>='].includes(argv[pos])) {
      const op = argv[pos++];
      value = compare(op, value, additive());
    }
    return value;
  };
  const conjunction = () => {
    let value = comparison();
    while (argv[pos] === '&') {
      pos++;
      const right = comparison();
      value = truthy(value) && truthy(right) ? value : '0';
    }
    return value;
  };
  const disjunction = () => {
    let value = conjunction();
    while (argv[pos] === '|') {
      pos++;
      const right = conjunction();
      value = truthy(value) ? value : truthy(right) ? right : '0';
    }
    return value;
  };
  try {
    const value = disjunction();
    if (pos < argv.length) fail("syntax error: unexpected argument '" + argv[pos] + "'");
    return { code: truthy(value) ? 0 : 1, out: value + '\n', err: '' };
  } catch (error) {
    if (error instanceof ExprFailure) return { code: 2, out: '', err: 'expr: ' + error.message + '\n' };
    throw error;
  }
}

const SEQ_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

function baseName(name) {
  const trimmed = name.replace(/\/+$/, '');
  if (trimmed === '' && name.startsWith('/')) return '/';
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

function stripSuffix(base, suffix) {
  return suffix && base !== suffix && base.endsWith(suffix) ? base.slice(0, -suffix.length) : base;
}

function dirOf(name) {
  const trimmed = name.replace(/\/+$/, '');
  if (trimmed === '') return name.startsWith('/') ? '/' : '.';
  const slash = trimmed.lastIndexOf('/');
  if (slash < 0) return '.';
  const head = trimmed.slice(0, slash).replace(/\/+$/, '');
  return head === '' ? '/' : head;
}

function normalize(path) {
  const parts = [];
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return '/' + parts.join('/');
}

function expandSet(text) {
  let chars = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i + 1] === '-' && i + 2 < text.length) {
      for (let c = text.charCodeAt(i); c <= text.charCodeAt(i + 2); c++) chars += String.fromCharCode(c);
      i += 2;
    } else chars += text[i];
  }
  return chars;
}

function formatPrintf([format = '', ...args]) {
  let index = 0;
  const text = format.replace(/\\(?:([0-7]{1,3})|(.))/g, (match, octal, ch) => (octal !== undefined ? String.fromCharCode(parseInt(octal, 8)) : (ESCAPES[ch] ?? match)));
  const pass = () => text.replace(/%([sdq%])/g, (match, spec) => {
    if (spec === '%') return '%';
    const value = args[index++] ?? '';
    if (spec === 'q') return value === '' ? "''" : value.replace(/[^\w@%+=:,./-]/g, '\\$&');
    return spec === 'd' ? String(parseInt(value, 10) || 0) : value;
  });
  let out = '';
  let used;
  do {
    const before = index;
    out += pass();
    used = index > before;
  } while (used && index < args.length);
  return out;
}

const OPERATOR_LEVELS = [['||'], ['&&'], ['==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];

function applyOperator(op, left, right) {
  if (op === '*') return left * right;
  if (op === '/' || op === '%') {
    if (right === 0) throw new Error('arithmetic: division by zero');
    return op === '/' ? Math.trunc(left / right) : left % right;
  }
  if (op === '+') return left + right;
  if (op === '-') return left - right;
  if (op === '<') return Number(left < right);
  if (op === '>') return Number(left > right);
  if (op === '<=') return Number(left <= right);
  if (op === '>=') return Number(left >= right);
  if (op === '==') return Number(left === right);
  if (op === '!=') return Number(left !== right);
  if (op === '&&') return Number(Boolean(left) && Boolean(right));
  return Number(Boolean(left) || Boolean(right));
}

export function evaluateArithmetic(src, lookup, assign) {
  const compact = src.replace(/\\\n/g, '').replace(/\s+/g, '');
  const tokens = compact.match(/0[xX][0-9a-fA-F]+|\d+|[A-Za-z_]\w*|\+\+|--|[-+*/%]=|<=|>=|==|!=|&&|\|\||=|[-+*/%<>()!]/g) ?? [];
  if (tokens.join('') !== compact) throw new Error(`arithmetic: bad expression '${src.trim()}'`);
  let pos = 0;
  const peek = () => tokens[pos];

  const primary = () => {
    const token = tokens[pos++];
    if (token === undefined) throw new Error('arithmetic: unexpected end of expression');
    if (token === '(') {
      const value = binary(0);
      if (tokens[pos++] !== ')') throw new Error('arithmetic: expected )');
      return value;
    }
    if (/^0[xX][0-9a-fA-F]+$/.test(token)) return parseInt(token.slice(2), 16);
    if (/^0[0-7]+$/.test(token)) return parseInt(token, 8);
    if (/^\d+$/.test(token)) return Number(token);
    if (/^[A-Za-z_]/.test(token)) {
      if (peek() === '++' || peek() === '--') {
        const old = Number(lookup(token)) || 0;
        assign(token, String(old + (tokens[pos++] === '++' ? 1 : -1)));
        return old;
      }
      return Number(lookup(token)) || 0;
    }
    throw new Error(`arithmetic: unexpected '${token}'`);
  };

  const unary = () => {
    if (peek() === '++' || peek() === '--') {
      const op = tokens[pos++];
      const name = tokens[pos++];
      if (!/^[A-Za-z_]/.test(name ?? '')) throw new Error('arithmetic: attempted assignment to non-variable');
      const value = (Number(lookup(name)) || 0) + (op === '++' ? 1 : -1);
      assign(name, String(value));
      return value;
    }
    if (peek() === '!') {
      pos++;
      return Number(!unary());
    }
    if (peek() === '-') {
      pos++;
      return -unary();
    }
    if (peek() === '+') {
      pos++;
      return unary();
    }
    return primary();
  };

  function binary(level) {
    if (level === OPERATOR_LEVELS.length) return unary();
    let left = binary(level + 1);
    while (OPERATOR_LEVELS[level].includes(peek())) {
      const op = tokens[pos++];
      left = applyOperator(op, left, binary(level + 1));
    }
    return left;
  }

  const ASSIGNMENTS = ['=', '+=', '-=', '*=', '/=', '%='];
  const expression = () => {
    if (!ASSIGNMENTS.includes(tokens[1])) return binary(0);
    if (!/^[A-Za-z_]/.test(tokens[0])) throw new Error('arithmetic: attempted assignment to non-variable');
    const name = tokens[0];
    const op = tokens[1];
    pos = 2;
    const right = binary(0);
    const value = op === '=' ? right : applyOperator(op.slice(0, -1), Number(lookup(name)) || 0, right);
    assign(name, String(value));
    return value;
  };
  const value = expression();
  if (pos < tokens.length) throw new Error(`arithmetic: unexpected '${tokens[pos]}'`);
  return value;
}

export function createShell({ host, cwd = '/workspace', builtins = [], saved = null } = {}) {
  const state = { cwd: saved?.cwd ?? cwd, status: saved?.status ?? 0 };
  const vars = new Map(saved?.vars ?? [['LANG', DEFAULT_LANG]]);
  const fdTable = new Map();
  const exported = new Set(saved?.exported ?? ['LANG']);
  const inherited = new Set(saved ? [] : ['LANG']);
  const prefixNames = new Set();
  const localeWarnings = [];
  const childLocale = () => localeChoice((name) => (exported.has(name) || prefixNames.has(name) ? vars.get(name) : undefined));
  const childLocaleMode = () => LOCALE_MODES.get(childLocale().value) ?? 'bytes';
  let shellLocale = LOCALE_MODES.get(localeChoice((name) => vars.get(name)).value) ?? 'bytes';
  const settleLocale = (warnAbout = null, clearing = false) => {
    const named = LOCALE_NAMES.map((name) => ({ name, value: variableValue(name) })).filter((entry) => entry.value);
    const choice = named[0] ?? { name: null, value: 'C' };
    let mode = LOCALE_MODES.get(choice.value);
    if (mode === undefined && clearing) mode = named.slice(1).map((entry) => LOCALE_MODES.get(entry.value)).find((found) => found !== undefined);
    if (mode !== undefined) shellLocale = mode;
    else if (warnAbout !== null && warnAbout !== 'LANG' && warnAbout === choice.name) localeWarnings.push('thebird: warning: setlocale: ' + choice.name + ': cannot change locale (' + choice.value + '): No such file or directory\n');
  };
  const takeLocaleWarnings = () => localeWarnings.splice(0).join('');
  let errexit = saved?.errexit ?? false;
  let xtrace = saved?.xtrace ?? false;
  let substDepth = 0;
  const expandTrace = async (ps4, sink) => {
    const traced = xtrace;
    const scratch = { out: '', err: '', signal: sink.signal };
    xtrace = false;
    try {
      return await expandText(readBodyParts(ps4), scratch);
    } catch (err) {
      scratch.err += err.message + '\n';
      return ps4;
    } finally {
      xtrace = traced;
      sink.err += scratch.err;
    }
  };
  const promptEscapes = (ps4) => ps4.replace(/\\\\|\\[uhH]/g, (token) => (token === '\\\\' ? token : token[1] === 'u' ? SHELL_USER : SHELL_HOST));
  const tracePrefix = async (sink) => {
    const ps4 = promptEscapes(vars.get('PS4') ?? '+ ');
    if (ps4 === '') return '';
    const expanded = await expandTrace(ps4, sink);
    return expanded === '' ? '' : expanded[0].repeat(substDepth + 1) + expanded.slice(1);
  };
  let errexitSuspended = 0;
  if (!vars.has('PWD')) vars.set('PWD', state.cwd);
  exported.add('PWD');
  const modes = new Map(saved?.modes ?? []);
  const arrays = new Map();
  const arrayIndex = (part) => (/^\d+$/.test(part.index) ? Number(part.index) : evaluateArithmetic(part.index, (name) => variableValue(name) ?? '', setVariable));
  const arrayItems = (name) => {
    const items = arrays.get(name);
    return items ? [...items.keys()].sort((a, b) => a - b).map((key) => items.get(key)) : [];
  };
  const elementChars = (values, index, inDouble) => {
    if (index === '@' && inDouble) return values.flatMap((value) => [{ start: true }, ...[...value].map((c) => ({ c, q: true, split: false }))]);
    return [...values.join(' ')].map((c) => ({ c, q: inDouble, split: !inDouble }));
  };
  const onlyAtArray = (part) => part.parts.length === 1 && (part.parts[0].k === 'keys' || part.parts[0].k === 'param') && part.parts[0].index === '@';
  const arraySlice = (part) => {
    const items = arrays.get(part.name);
    const keys = [...(items?.keys() ?? [])].sort((a, b) => a - b);
    if (!keys.length) return [];
    const offset = arrayIndex({ index: part.offset.trim() });
    const start = offset < 0 ? keys.at(-1) + 1 + offset : offset;
    const picked = keys.filter((key) => key >= start).map((key) => items.get(key));
    return part.length === null ? picked : picked.slice(0, arrayIndex({ index: part.length.trim() }));
  };
  const arrayElement = (name, index) => {
    const items = arrays.get(name);
    if (!items) return undefined;
    return items.get(index < 0 ? Math.max(...items.keys()) + 1 + index : index);
  };
  const arrayLength = (part) => {
    if (part.index === '@' || part.index === '*') return arrayItems(part.name).length;
    return characterCount(arrayElement(part.name, arrayIndex(part)) ?? '', shellLocale);
  };
  const setElement = (name, index, value) => {
    if (!arrays.has(name)) {
      arrays.set(name, new Map(vars.has(name) ? [[0, vars.get(name)]] : []));
      vars.delete(name);
    }
    arrays.get(name).set(index, value);
  };
  const fileTicks = new Map();
  let fileClock = 0;
  const clockKey = (path) => searchedDirectories(path).real;
  const readFileText = (path) => {
    const key = clockKey(path);
    fileTicks.set(key, { m: fileTicks.get(key)?.m ?? 0, a: ++fileClock });
    return host.read(path);
  };
  const writeFileText = (path, data) => {
    const t = ++fileClock;
    const key = clockKey(path);
    const record = fileTicks.get(key);
    fileTicks.set(key, record ? { m: t, a: record.a } : { m: t, a: t });
    host.write(path, data);
  };
  const functions = new Map(saved?.functions ?? []);
  const inPage = new Set(builtins);
  const jobs = new Map();
  let nextPid = saved?.nextPid ?? SHELL_PID + 1;
  let lastPid = saved?.lastPid ?? null;
  let runSink = null;
  const frames = [];
  let positional = [];
  let loopDepth = 0;

  const hostModeText = (path) => {
    const mode = host.stat(path)?.mode;
    return Number.isInteger(mode) ? (mode & 0o7777).toString(8) : undefined;
  };
  const modeOf = (path, fallback) => modes.get(path) ?? hostModeText(path) ?? fallback;
  const ownerBits = (path) => (parseInt(modeOf(path, '755'), 8) >> 6) & 7;
  const searchedDirectories = (path, followLast = true, depth = 0) => {
    const parts = path.split('/').filter((part) => part !== '');
    const searched = [];
    let current = '/';
    for (let i = 0; i < parts.length; i++) {
      searched.push(current);
      if (parts[i] === '.') continue;
      if (parts[i] === '..') {
        current = parentOf(current);
        continue;
      }
      const candidate = (current === '/' ? '' : current) + '/' + parts[i];
      if (host.lstat?.(candidate)?.link && depth < 40 && (followLast || i < parts.length - 1)) {
        const target = host.readlink(candidate);
        const inner = searchedDirectories(target.startsWith('/') ? target : (current === '/' ? '' : current) + '/' + target, true, depth + 1);
        searched.push(...inner.searched);
        current = inner.real;
      } else current = candidate;
    }
    return { real: current, searched };
  };
  const blockedAncestor = (path) => searchedDirectories(path).searched.some((dir) => !(ownerBits(dir) & 1));
  const permissionBit = (text, bit) => {
    const path = resolvePath(text);
    const info = statInfo(searchedDirectories(path).real);
    if (!info || blockedAncestor(path)) return false;
    return ((parseInt(info.mode, 8) >> 6) & bit) !== 0;
  };
  const statInfo = (path) => {
    const link = host.lstat?.(path);
    if (!link && !host.stat(path)) return null;
    if (link?.link) return { type: 'symbolic link', size: link.size ?? 0, mode: modes.get(path) ?? '777' };
    const info = host.stat(path);
    const dir = info?.dir === true;
    return { type: dir ? 'directory' : 'regular file', size: info?.size ?? 0, mode: modeOf(path, dir ? '755' : '644') };
  };

  const inodeNumbers = new Map();
  const inodeOf = (path) => {
    if (!inodeNumbers.has(path)) inodeNumbers.set(path, inodeNumbers.size + 1);
    return inodeNumbers.get(path);
  };
  const statLayout = (name, real, info) => {
    const link = info.type === 'symbolic link';
    const dir = info.type === 'directory';
    const digits = info.mode.padStart(4, '0');
    const kind = link ? 'l' : dir ? 'd' : '-';
    const symbolic = kind + Array.from(digits.slice(-3)).map((digit) => ['r', 'w', 'x'].map((bit, i) => ((Number(digit) & (4 >> i)) ? bit : '-')).join('')).join('');
    const size = dir ? 4096 : info.size;
    const blocks = dir ? 8 : link || info.size === 0 ? 0 : Math.ceil(info.size / 4096) * 8;
    const base = real === '/' ? '' : real;
    const subdirs = dir ? host.list(real).filter((child) => host.lstat(base + '/' + child)?.link !== true && host.stat(base + '/' + child)?.dir === true).length : 0;
    const links = dir ? 2 + subdirs : 1;
    const fileName = link ? name + ' -> ' + host.readlink(real) : name;
    const time = '1970-01-01 00:00:00.000000000 +0000';
    return [
      '  File: ' + fileName,
      '  Size: ' + String(size).padEnd(10) + '\tBlocks: ' + String(blocks).padEnd(10) + ' IO Block: ' + '4096'.padEnd(6) + ' ' + info.type,
      'Device: 0,0\tInode: ' + String(inodeOf(real)).padEnd(10) + '  Links: ' + links,
      'Access: (' + digits + '/' + symbolic + ')  Uid: (' + String(SHELL_UID).padStart(5) + '/' + SHELL_USER.padStart(8) + ')   Gid: (' + String(SHELL_GID).padStart(5) + '/' + SHELL_GROUP.padStart(8) + ')',
      'Access: ' + time,
      'Modify: ' + time,
      'Change: ' + time,
      ' Birth: -',
    ].join('\n');
  };
  const realpathOf = (name, mode, strip) => {
    const todo = (name.startsWith('/') ? name : state.cwd + '/' + name).split('/').filter((part) => part !== '' && part !== '.');
    const stack = [];
    let expansions = 0;
    while (todo.length > 0) {
      const part = todo.shift();
      if (part === '..') {
        stack.pop();
        continue;
      }
      const path = '/' + stack.concat(part).join('/');
      if (host.lstat(path)?.link && !strip) {
        expansions += 1;
        if (expansions > 40) return { error: 'Too many levels of symbolic links' };
        const target = host.readlink(path);
        if (target.startsWith('/')) stack.length = 0;
        todo.unshift(...target.split('/').filter((piece) => piece !== '' && piece !== '.'));
        continue;
      }
      const info = host.stat(path);
      const last = todo.length === 0;
      if (mode !== 'missing') {
        if (!info) {
          if (mode === 'existing' || (!last && (!strip || todo[0] === '..'))) return { error: 'No such file or directory' };
        } else if (info.dir !== true && !last) return { error: 'Not a directory' };
      }
      stack.push(part);
    }
    return { path: '/' + stack.join('/') };
  };
  const realPath = (path) => {
    let current = normalize(path);
    for (let hops = 0; hops < 40; hops++) {
      const parts = current.split('/').filter(Boolean);
      let prefix = '';
      let linked = false;
      for (let i = 0; i < parts.length && !linked; i++) {
        prefix += '/' + parts[i];
        if (host.lstat(prefix)?.link) {
          const target = host.readlink(prefix);
          const base = target.startsWith('/') ? target : parentOf(prefix) + '/' + target;
          current = normalize([base, ...parts.slice(i + 1)].join('/'));
          linked = true;
        }
      }
      if (!linked) return current;
    }
    return null;
  };

  const octalBytes = (ch) => encodeURIComponent(ch).split('%').slice(1).map((hex) => '\\' + parseInt(hex, 16).toString(8).padStart(3, '0')).join('');
const ansiEscape = (ch) => {
  if (ch.codePointAt(0) >= 0x80) return octalBytes(ch);
  return { 7: '\\a', 8: '\\b', 9: '\\t', 10: '\\n', 11: '\\v', 12: '\\f', 13: '\\r' }[ch.charCodeAt(0)] ?? '\\' + ch.charCodeAt(0).toString(8).padStart(3, '0');
};
const quoteName = (text, locale = 'bytes') => {
  const escape = locale === 'characters' ? /[\x00-\x1f\x7f-\x9f]/u : /[\x00-\x1f\x7f]|[^\x20-\x7e]/u;
  if (!escape.test(text)) {
    if (text.includes("'") && text.includes('"')) return "'" + text.replace(/'/g, "'\\''") + "'";
    if (text.includes("'")) return '"' + text + '"';
    return "'" + text + "'";
  }
  let out = "'";
  let mode = 'quote';
  for (const ch of text) {
    if (escape.test(ch)) {
      if (mode === 'quote') out += "'";
      if (mode !== 'dollar') out += "$'";
      mode = 'dollar';
      out += ansiEscape(ch);
    } else if (ch === "'") {
      if (mode === 'dollar') out += "'";
      out += mode === 'quote' ? "'\\''" : "\\''";
      mode = 'quote';
    } else {
      if (mode === 'dollar') out += "'";
      if (mode !== 'quote') out += "'";
      mode = 'quote';
      out += ch;
    }
  }
  return out + "'";
};
const expandStat = (format, name, info, linkTarget, locale) => format.replace(/%(.)/g, (whole, code) => {
    if (code === 'N') return info.type === 'symbolic link' ? quoteName(name, locale) + ' -> ' + quoteName(linkTarget, locale) : quoteName(name, locale);
    if (code === 'n') return name;
    if (code === 's') return String(info.size);
    if (code === 'F') return info.type;
    if (code === 'a') return info.mode;
    if (code === 'U') return SHELL_USER;
    if (code === 'G') return SHELL_GROUP;
    if (code === '%') return '%';
    return whole;
  });

  const byName = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);
  const environmentLines = (extra) => {
    const entries = new Map([...exported].filter((name) => vars.has(name) && !inherited.has(name)).map((name) => [name, vars.get(name)]));
    for (const [name, value] of extra) entries.set(name, value);
    return [...entries].sort(byName).map(([name, value]) => name + '=' + value + '\n').join('');
  };

  const resolvePath = (name) => normalize(name.startsWith('/') ? name : state.cwd + '/' + name);

  const loopControl = (kind, argv) => {
    if (loopDepth === 0) return { code: 0, out: '', err: `${kind}: only meaningful in a loop\n` };
    throw new LoopSignal(kind, Math.min(Number(argv[0] ?? 1) || 1, loopDepth));
  };

  const digestCommand = (verb, hex, argv, stdin) => {
    const names = argv.filter((arg) => !arg.startsWith('-'));
    if (!names.length) return ok(hex(utf8Bytes(stdin)) + '  -\n');
    let out = '';
    let err = '';
    let code = 0;
    for (const name of names) {
      if (name === '-') {
        out += hex(utf8Bytes(stdin)) + '  -\n';
        continue;
      }
      try {
        out += hex(utf8Bytes(readFileText(resolvePath(name)))) + '  ' + name + '\n';
      } catch {
        err += verb + ': ' + name + ': No such file or directory\n';
        code = 1;
      }
    }
    return { code, out, err };
  };

  const commands = {
    break: ({ argv }) => loopControl('break', argv),
    continue: ({ argv }) => loopControl('continue', argv),
    echo: ({ argv }) => ok(argv.join(' ') + '\n'),
    printf: ({ argv }) => ok(formatPrintf(argv)),
    true: () => ok(''),
    read: ({ argv, stdin, stream }) => readBuiltin(argv, stream ?? { text: stdin, pos: 0 }),
    unset: ({ argv }) => {
      const functionsOnly = argv[0] === '-f';
      for (const name of argv[0] === '-f' || argv[0] === '-v' ? argv.slice(1) : argv) {
        if (functionsOnly) functions.delete(name);
        else removeVariable(name);
      }
      return ok('');
    },
    sleep: ({ argv, signal }) => sleepFor(Number(argv[0] ?? 0) * 1000, signal),
    ps: () => {
      const header = { pid: 'PID', ppid: 'PPID', stat: 'STAT', command: 'COMMAND' };
      const rows = [
        { pid: String(SHELL_PID), ppid: '0', stat: 'S', command: 'thebird' },
        ...[...jobs.values()].filter((job) => !job.done).map((job) => ({ pid: String(job.pid), ppid: String(SHELL_PID), stat: 'S', command: job.command })),
      ];
      const table = [header, ...rows];
      const width = (key) => Math.max(...table.map((row) => row[key].length));
      const [pidWidth, ppidWidth, statWidth] = [width('pid'), width('ppid'), width('stat')];
      const line = (row) => `${row.pid.padStart(pidWidth)} ${row.ppid.padStart(ppidWidth)} ${row.stat.padEnd(statWidth)} ${row.command}\n`;
      return ok(table.map(line).join(''));
    },
    kill: ({ argv }) => {
      if (argv[0] === '-l') return ok(Object.keys(SIGNALS).join(' ') + '\n');
      const targets = [...argv];
      let signo = SIGNALS.TERM;
      if (targets[0]?.startsWith('-')) {
        const spec = targets.shift().slice(1);
        signo = signalNumber(spec);
        if (signo === null) return { code: 1, out: '', err: `kill: ${spec}: invalid signal specification\n` };
      }
      let err = '';
      let code = 0;
      for (const target of targets) {
        const pid = Number(target);
        if (!Number.isInteger(pid)) {
          err += `kill: ${target}: arguments must be process or job IDs\n`;
          code = 1;
        } else if (pid === SHELL_PID) {
          err += `kill: (${pid}) - Operation not permitted\n`;
          code = 1;
        } else if (!jobs.has(pid) || jobs.get(pid).done) {
          err += `kill: (${pid}) - No such process\n`;
          code = 1;
        } else jobs.get(pid).control.abort(new Signalled(signo));
      }
      return { code, out: '', err };
    },
    wait: async ({ argv, signal }) => {
      const targets = argv.length ? argv.map(Number) : [...jobs.keys()];
      let code = 0;
      let err = '';
      for (const pid of targets) {
        const job = jobs.get(pid);
        if (!job) {
          err += `wait: pid ${pid} is not a child of this shell\n`;
          code = 127;
          continue;
        }
        code = await awaitJob(job, signal);
        jobs.delete(pid);
      }
      return { code, out: '', err };
    },
    cd: ({ argv }) => {
      const target = resolvePath(argv[0] ?? '/workspace');
      if (!host.exists(target)) return { code: 1, out: '', err: `cd: ${argv[0]}: No such file or directory\n` };
      state.cwd = target;
      vars.set('PWD', target);
      return ok('');
    },
    pwd: () => ok(state.cwd + '\n'),
    mkdir: ({ argv }) => {
      const recursive = argv[0] === '-p';
      let err = '';
      let code = 0;
      for (const name of recursive ? argv.slice(1) : argv) {
        const path = resolvePath(name);
        if (recursive) {
          let current = '';
          for (const part of path.split('/').filter(Boolean)) {
            current += '/' + part;
            if (!host.exists(current)) host.mkdir(current);
          }
        } else if (host.exists(path)) {
          err += `mkdir: cannot create directory '${name}': File exists\n`;
          code = 1;
        } else host.mkdir(path);
      }
      return { code, out: '', err };
    },
    rm: ({ argv }) => {
      const flags = argv.filter((arg) => arg.startsWith('-')).join('');
      const recursive = /[rR]/.test(flags);
      const force = flags.includes('f');
      let err = '';
      let code = 0;
      for (const name of argv.filter((arg) => !arg.startsWith('-'))) {
        const path = resolvePath(name);
        const info = host.lstat(path);
        if (!info) {
          if (!force) {
            err += `rm: cannot remove '${name}': No such file or directory\n`;
            code = 1;
          }
        } else if (info.dir && !recursive) {
          err += `rm: cannot remove '${name}': Is a directory\n`;
          code = 1;
        } else host.remove(path, recursive);
      }
      return { code, out: '', err };
    },
    ls: ({ argv }) => {
      const flags = argv.filter((arg) => arg.startsWith('-')).join('');
      const long = flags.includes('l');
      const all = flags.includes('a');
      const targets = argv.filter((arg) => !arg.startsWith('-'));
      const describe = (path, name) => {
        const link = host.lstat(path);
        if (link?.link) return `l ${link.size} ${name} -> ${host.readlink(path)}\n`;
        return `${link?.dir ? 'd' : '-'} ${link?.size ?? 0} ${name}\n`;
      };
      let out = '';
      let err = '';
      let code = 0;
      for (const name of targets.length ? targets : ['.']) {
        const path = resolvePath(name);
        const info = host.stat(path);
        if (!info && !host.lstat(path)) {
          err += `ls: cannot access '${name}': No such file or directory\n`;
          code = 2;
        } else if (!info?.dir) out += long ? describe(path, name) : name + '\n';
        else {
          for (const entry of host.list(path).sort()) {
            if (!all && entry.startsWith('.')) continue;
            out += long ? describe(`${path === '/' ? '' : path}/${entry}`, entry) : entry + '\n';
          }
        }
      }
      return { code, out, err };
    },
    ln: ({ argv }) => {
      const flags = argv.filter((arg) => arg.startsWith('-')).join('');
      const operands = argv.filter((arg) => !arg.startsWith('-'));
      if (!flags.includes('s')) return { code: 1, out: '', err: 'ln: only symbolic links are supported; use ln -s\n' };
      if (operands.length < 1 || operands.length > 2) return { code: 1, out: '', err: 'ln: usage: ln -s TARGET [LINK_NAME]\n' };
      const [target, given] = operands;
      const base = target.split('/').filter(Boolean).pop() ?? target;
      const name = given ?? base;
      let dest = resolvePath(name);
      if (host.stat(dest)?.dir) dest = `${dest === '/' ? '' : dest}/${base}`;
      if (host.lstat(dest)) {
        if (!flags.includes('f')) return { code: 1, out: '', err: `ln: failed to create symbolic link '${name}': File exists\n` };
        host.remove(dest, false);
      }
      host.symlink(target, dest);
      return ok('');
    },
    touch: ({ argv }) => {
      const noCreate = argv.includes('-c') || argv.includes('--no-create');
      const names = argv.filter((arg) => arg !== '-c' && arg !== '--no-create');
      if (!names.length) return { code: 1, out: '', err: "touch: missing file operand\nTry 'touch --help' for more information.\n" };
      let err = '';
      let code = 0;
      for (const name of names) {
        const path = resolvePath(name);
        if (host.exists(path)) {
          host.touch?.(path);
          continue;
        }
        if (noCreate) continue;
        if (!host.stat(parentOf(path))?.dir) {
          err += "touch: cannot touch '" + name + "': No such file or directory\n";
          code = 1;
        } else writeFileText(path, '');
      }
      return { code, out: '', err };
    },
    cp: ({ argv }) => copyOrMove('cp', argv),
    mv: ({ argv }) => copyOrMove('mv', argv),
    tee: ({ argv, stdin }) => {
      const append = argv.includes('-a');
      let err = '';
      let code = 0;
      for (const name of argv.filter((arg) => !arg.startsWith('-'))) {
        const path = resolvePath(name);
        if (!host.stat(parentOf(path))?.dir) {
          err += 'tee: ' + name + ': No such file or directory\n';
          code = 1;
          continue;
        }
        const prior = append && host.exists(path) ? readFileText(path) : '';
        writeFileText(path, prior + (stdin ?? ''));
      }
      return { code, out: stdin ?? '', err };
    },
    head: ({ argv, stdin = '', stream }) => {
      const { flags, operands } = argsOf(argv, ['-n']);
      const count = Number(flags.get('-n') ?? 10);
      if (!Number.isInteger(count)) return { code: 1, out: '', err: 'head: invalid number of lines\n' };
      const input = textInputs('head', operands, stdin);
      if (stream && !operands.length) stream.pos += count < 0 || !stream.seekable ? stdin.length : headEnd(stdin, count);
      return { code: input.code, out: joinLines(linesOf(input.text).slice(0, count)), err: input.err };
    },
    tail: ({ argv, stdin = '' }) => {
      const { flags, operands } = argsOf(argv, ['-n']);
      const raw = flags.get('-n') ?? '10';
      const fromLine = raw.startsWith('+') ? Number(raw.slice(1)) : null;
      const count = Number(raw);
      if (fromLine === null ? !Number.isInteger(count) : !Number.isInteger(fromLine)) return { code: 1, out: '', err: 'tail: invalid number of lines\n' };
      const input = textInputs('tail', operands, stdin);
      const lines = linesOf(input.text);
      const picked = fromLine !== null ? lines.slice(Math.max(fromLine - 1, 0)) : count === 0 ? [] : lines.slice(-count);
      return { code: input.code, out: joinLines(picked), err: input.err };
    },
    sort: ({ argv, stdin = '' }) => {
      const { flags, operands } = argsOf(argv, ['-t', '-k']);
      const input = textInputs('sort', operands, stdin, (name) => 'sort: cannot read: ' + name + ': No such file or directory\n', 2);
      const byText = COLLATING_LOCALES.has(childLocale().value) ? collate : (a, b) => (a < b ? -1 : a > b ? 1 : 0);
      const separator = flags.get('-t');
      const [, keyFrom, keyTo, keyMod = ''] = /^(\d+)(?:,(\d+))?([a-z]*)$/.exec(flags.get('-k') ?? '') ?? [];
      const numeric = flags.has('-n') || keyMod.includes('n');
      const keyOf = (line) => {
        if (keyFrom === undefined) return line;
        const fields = separator === undefined ? line.replace(/^\s+/, '').split(/\s+/) : line.split(separator);
        return fields.slice(Number(keyFrom) - 1, keyTo === undefined ? undefined : Number(keyTo)).join(separator ?? ' ');
      };
      const compareKeys = numeric ? (a, b) => (Number.parseFloat(a) || 0) - (Number.parseFloat(b) || 0) : byText;
      const compare = (a, b) => compareKeys(keyOf(a), keyOf(b)) || byText(a, b);
      let lines = linesOf(input.text).sort(compare);
      if (flags.has('-r') || keyMod.includes('r')) lines.reverse();
      if (flags.has('-u')) lines = lines.filter((line, i) => i === 0 || line !== lines[i - 1]);
      return { code: input.code, out: joinLines(lines), err: input.err };
    },
    uniq: ({ argv, stdin = '' }) => {
      const { flags, operands } = argsOf(argv, []);
      const input = textInputs('uniq', operands, stdin);
      const groups = [];
      for (const line of linesOf(input.text)) {
        const last = groups.at(-1);
        if (last && last.line === line) last.count++;
        else groups.push({ line, count: 1 });
      }
      const kept = flags.has('-d') ? groups.filter(({ count }) => count > 1) : flags.has('-u') ? groups.filter(({ count }) => count === 1) : groups;
      const out = kept.map(({ line, count }) => (flags.has('-c') ? String(count).padStart(7) + ' ' : '') + line + '\n').join('');
      return { code: input.code, out, err: input.err };
    },
    cut: ({ argv, stdin = '' }) => {
      const { flags, operands } = argsOf(argv, ['-d', '-f', '-c']);
      if (!flags.has('-f') && !flags.has('-c')) return { code: 1, out: '', err: 'cut: you must specify the list of fields\n' };
      const characters = flags.has('-c');
      const delim = flags.get('-d') ?? '\t';
      const picks = fieldPicks(flags.get(characters ? '-c' : '-f'));
      if (picks.some(([from, to]) => !(from >= 1) || Number.isNaN(to))) return { code: 1, out: '', err: 'cut: fields are numbered from 1\n' };
      const input = textInputs('cut', operands, stdin);
      const out = joinLines(linesOf(input.text).map((line) => {
        if (characters) return [...line].filter((_, i) => picks.some(([from, to]) => i + 1 >= from && i + 1 <= to)).join('');
        if (!line.includes(delim)) return line;
        return line.split(delim).filter((_, i) => picks.some(([from, to]) => i + 1 >= from && i + 1 <= to)).join(delim);
      }));
      return { code: input.code, out, err: input.err };
    },
    readlink: ({ argv }) => {
      const operands = argv.filter((arg) => !arg.startsWith('-'));
      if (operands.length !== 1) return { code: 1, out: '', err: 'readlink: usage: readlink NAME\n' };
      const path = resolvePath(operands[0]);
      const info = host.lstat(path);
      if (!info?.link) return { code: 1, out: '', err: '' };
      return ok(host.readlink(path) + '\n');
    },
    find: async ({ argv, signal }) => {
      let i = 0;
      const roots = [];
      while (i < argv.length && !argv[i].startsWith('-')) roots.push(argv[i++]);
      if (!roots.length) roots.push('.');
      const predicates = [];
      let maxDepth = Infinity;
      let execArgv = null;
      while (i < argv.length) {
        const flag = argv[i];
        const value = argv[i + 1] ?? '';
        if (flag === '-empty') {
          predicates.push((_name, info, path) => (info.dir ? host.list(path).length === 0 : info.size === 0));
          i += 1;
          continue;
        }
        if (flag === '-exec') {
          const end = argv.indexOf(';', i + 1);
          if (end === -1) throw new Error("find: missing argument to `-exec'");
          execArgv = argv.slice(i + 1, end);
          i = end + 1;
          continue;
        }
        if (flag === '-name') predicates.push((name) => globRegExp(value).test(name));
        else if (flag === '-iname') predicates.push((name) => globRegExp(value, true).test(name));
        else if (flag === '-type') predicates.push((_name, info) => (value === 'd' ? info.dir : !info.dir));
        else if (flag === '-maxdepth') maxDepth = Number(value);
        else throw new Error(`find: unknown predicate '${flag}'`);
        i += 2;
      }
      let out = '';
      let err = '';
      let code = 0;
      const visit = async (display, path, depth = 0) => {
        const info = host.stat(path);
        if (!info) return;
        const base = display.slice(display.lastIndexOf('/') + 1) || display;
        if (predicates.every((test) => test(base, info, path))) {
          if (execArgv) {
            const result = await dispatch([execArgv[0], ...execArgv.slice(1).map((arg) => arg.split('{}').join(display))], '', signal);
            out += result.out;
            err += result.err;
          } else out += display + '\n';
        }
        if (info.dir && depth < maxDepth) {
          for (const entry of host.list(path).sort()) await visit(`${display.replace(/\/$/, '')}/${entry}`, `${path === '/' ? '' : path}/${entry}`);
        }
      };
      for (const root of roots) {
        const path = resolvePath(root);
        if (!host.stat(path)) {
          err += `find: '${root}': No such file or directory\n`;
          code = 1;
        } else await visit(root, path);
      }
      return { code, out, err };
    },
    wc: ({ argv, stdin = '' }) => {
      const flags = argv.filter((arg) => arg.startsWith('-')).join('');
      const files = argv.filter((arg) => !arg.startsWith('-'));
      const wanted = [!flags || flags.includes('l'), !flags || flags.includes('w'), !flags || flags.includes('c')];
      const columns = wanted.filter(Boolean).length;
      const counts = (text) => ({ lines: (text.match(/\n/g) ?? []).length, words: text.split(/\s+/).filter(Boolean).length, chars: text.length });
      const row = (count, width) => [wanted[0] ? count.lines : null, wanted[1] ? count.words : null, wanted[2] ? count.chars : null].filter((value) => value !== null).map((value) => String(value).padStart(width)).join(' ');
      if (!files.length) return ok(row(counts(stdin), columns > 1 ? 7 : 1) + '\n');
      const found = [];
      let err = '';
      let code = 0;
      for (const name of files) {
        try {
          found.push({ name, count: counts(readFileText(resolvePath(name))) });
        } catch {
          err += `wc: ${name}: No such file or directory\n`;
          code = 1;
        }
      }
      const width = columns > 1 ? String(found.reduce((total, { count }) => total + count.chars, 0)).length : 1;
      const total = found.reduce((sum, { count }) => ({ lines: sum.lines + count.lines, words: sum.words + count.words, chars: sum.chars + count.chars }), { lines: 0, words: 0, chars: 0 });
      const lines = found.map(({ name, count }) => `${row(count, width)} ${name}\n`);
      if (found.length > 1) lines.push(`${row(total, width)} total\n`);
      return { code, out: lines.join(''), err };
    },
    date: ({ argv }) => {
      const at = argv.indexOf('-d');
      const source = at < 0 ? null : argv[at + 1] ?? '';
      const now = source === null ? new Date() : /^@-?\d+$/.test(source) ? new Date(Number(source.slice(1)) * 1000) : new Date(NaN);
      if (Number.isNaN(now.getTime())) return { code: 1, out: '', err: 'date: invalid date ' + (LOCALE_MODES.get(childLocale().value) === 'characters' ? '‘' + source + '’' : "'" + source + "'") + '\n' };
      const format = argv.find((arg) => arg.startsWith('+'));
      if (format === undefined) return ok(now.toUTCString() + '\n');
      const pad = (value, width = 2) => String(value).padStart(width, '0');
      const text = format.slice(1).replace(/%([sNYmdHMSFT%])/g, (match, spec) => {
        if (spec === 'F') return String(now.getUTCFullYear()) + '-' + pad(now.getUTCMonth() + 1) + '-' + pad(now.getUTCDate());
        if (spec === 'T') return pad(now.getUTCHours()) + ':' + pad(now.getUTCMinutes()) + ':' + pad(now.getUTCSeconds());
        if (spec === 's') return String(Math.floor(now.getTime() / 1000));
        if (spec === 'N') return pad(now.getTime() % 1000, 3) + '000000';
        if (spec === 'Y') return String(now.getUTCFullYear());
        if (spec === 'm') return pad(now.getUTCMonth() + 1);
        if (spec === 'd') return pad(now.getUTCDate());
        if (spec === 'H') return pad(now.getUTCHours());
        if (spec === 'M') return pad(now.getUTCMinutes());
        if (spec === 'S') return pad(now.getUTCSeconds());
        return '%';
      });
      return ok(text + '\n');
    },
    uname: () => ok('Linux\n'),
    whoami: () => ok(SHELL_USER + '\n'),
    hostname: () => ok(SHELL_HOST + '\n'),
    id: () => ok('uid=1000(user) gid=1000(user) groups=1000(user)\n'),
    grep: ({ argv, stdin = '' }) => {
      const isFlags = (arg) => /^-[a-zA-Z]+$/.test(arg);
      const flags = argv.filter(isFlags).join('');
      const [pattern, ...files] = argv.filter((arg) => !isFlags(arg));
      if (pattern === undefined) return { code: 2, out: '', err: 'grep: no pattern given\n' };
      let re;
      try {
        re = new RegExp(flags.includes('F') ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern, flags.includes('i') ? 'i' : '');
      } catch {
        return { code: 2, out: '', err: `grep: invalid regular expression '${pattern}'\n` };
      }
      if (flags.includes('w')) re = new RegExp('(?<![A-Za-z0-9_])(?:' + re.source + ')(?![A-Za-z0-9_])', re.flags);
      const invert = flags.includes('v');
      const numbered = flags.includes('n');
      const counting = flags.includes('c');
      const scan = (label, text) => {
        const lines = text.split('\n');
        if (lines.at(-1) === '') lines.pop();
        const hits = lines.map((line, index) => ({ line, number: index + 1 })).filter(({ line }) => re.test(line) !== invert);
        const out = hits.map(({ line, number }) => `${label}${numbered ? number + ':' : ''}${line}\n`).join('');
        return { count: hits.length, out: counting ? `${label}${hits.length}\n` : out };
      };
      const recursive = flags.includes('r');
      const implicit = !files.length && recursive;
      const targets = files.length ? files : recursive ? ['.'] : [null];
      const labelled = files.length > 1 || recursive;
      const childName = (dir, entry) => (implicit ? entry : dir.replace(/\/$/, '') + '/' + entry);
      let out = '';
      let err = '';
      let code = 1;
      let matched = 0;
      const visit = (name) => {
        const info = name === null ? null : host.stat(resolvePath(name));
        if (info?.dir) {
          if (!recursive) {
            err += `grep: ${name}: Is a directory\n`;
            code = 2;
            return;
          }
          for (const entry of host.list(resolvePath(name)).sort()) visit(childName(name, entry));
          return;
        }
        let text = stdin;
        if (name !== null) {
          try {
            text = readFileText(resolvePath(name));
          } catch {
            err += `grep: ${name}: No such file or directory\n`;
            code = 2;
            return;
          }
        }
        const result = scan(labelled && name !== null ? `${name}:` : '', text);
        matched += result.count;
        if (flags.includes('l')) {
          if (result.count) out += (name ?? '(standard input)') + '\n';
        } else out += result.out;
      };
      for (const name of targets) visit(name);
      if (code !== 2 && matched) code = 0;
      return { code, out, err };
    },
    false: () => ({ code: 1, out: '', err: '' }),
    exit: ({ argv }) => {
      throw new ShellExit(Number(argv[0] ?? state.status));
    },
    base64: ({ argv, stdin = '' }) => {
      const decode = argv.includes('-d');
      const wrapFlag = argv.indexOf('-w');
      const wrapAt = wrapFlag >= 0 ? Number(argv[wrapFlag + 1]) : 76;
      if (!Number.isInteger(wrapAt) || wrapAt < 0) return { code: 1, out: '', err: 'base64: invalid wrap size\n' };
      const names = argv.filter((arg, i) => !arg.startsWith('-') && i !== wrapFlag + 1);
      const input = textInputs('base64', names, stdin);
      if (decode) {
        const bytes = base64Decode(input.text);
        if (bytes === null) return { code: 1, out: '', err: 'base64: invalid input\n' };
        return { code: input.code, out: bytesToText(bytes), err: input.err };
      }
      const encoded = base64Encode(utf8Bytes(input.text));
      if (wrapAt === 0) return { code: input.code, out: encoded, err: input.err };
      const width = wrapAt;
      let out = '';
      for (let i = 0; i < encoded.length; i += width) out += encoded.slice(i, i + width) + '\n';
      return { code: input.code, out, err: input.err };
    },
    diff: ({ argv, stdin = '' }) => {
      let mode = 'normal';
      let width = 3;
      const labels = [];
      const names = [];
      for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '-' || !arg.startsWith('-')) names.push(arg);
        else if (arg === '--label') labels.push(argv[++i] ?? '');
        else if (arg.startsWith('--label=')) labels.push(arg.slice('--label='.length));
        else if (arg === '-u') mode = 'unified';
        else if (arg === '-c') mode = 'context';
        else if (/^-[UC]/.test(arg)) {
          const value = arg.length > 2 ? arg.slice(2) : argv[++i];
          if (!/^\d+$/.test(value ?? '')) return { code: 2, out: '', err: `diff: invalid context length '${value ?? ''}'\n` };
          mode = arg[1] === 'U' ? 'unified' : 'context';
          width = Number(value);
        } else if (arg.startsWith('--')) return { code: 2, out: '', err: `diff: unrecognized option '${arg}'\nTry 'diff --help' for more information.\n` };
        else return { code: 2, out: '', err: `diff: invalid option -- '${arg[1]}'\nTry 'diff --help' for more information.\n` };
      }
      if (names.length !== 2) return { code: 2, out: '', err: 'diff: two files are needed\n' };
      const texts = [];
      let err = '';
      for (const name of names) {
        if (name === '-') {
          texts.push(stdin);
          continue;
        }
        try {
          texts.push(readFileText(resolvePath(name)));
        } catch {
          err += 'diff: ' + name + ': No such file or directory\n';
        }
      }
      if (err) return { code: 2, out: '', err };
      const headers = [labels[0] ?? names[0], labels[1] ?? names[1]];
      const out = mode === 'unified' ? unifiedDiff(linesOf(texts[0]), linesOf(texts[1]), width, headers) : mode === 'context' ? contextDiff(linesOf(texts[0]), linesOf(texts[1]), width, headers) : lineDiff(linesOf(texts[0]), linesOf(texts[1]));
      return { code: out ? 1 : 0, out, err: '' };
    },
    expr: ({ argv }) => exprEval(argv, childLocaleMode()),
    seq: ({ argv }) => {
      if (!argv.length) return { code: 1, out: '', err: 'seq: missing operand\n' };
      if (argv.length > 3) return { code: 1, out: '', err: "seq: extra operand '" + argv[3] + "'\n" };
      const bad = argv.find((arg) => !SEQ_NUMBER.test(arg));
      if (bad !== undefined) return { code: 1, out: '', err: "seq: invalid floating point argument: '" + bad + "'\n" };
      const [first, step, last] = argv.length === 1 ? ['1', '1', argv[0]] : argv.length === 2 ? [argv[0], '1', argv[1]] : argv;
      const start = Number(first);
      const increment = Number(step);
      const end = Number(last);
      if (increment === 0) return { code: 1, out: '', err: "seq: invalid Zero increment value: '" + step + "'\n" };
      const count = Math.floor((end - start) / increment + 1e-9);
      if (count > 1000000) return { code: 1, out: '', err: 'seq: too many values\n' };
      const decimals = Math.max(...[first, step, last].map((text) => (text.split('.')[1] ?? '').length));
      let out = '';
      for (let k = 0; k <= count; k++) out += (start + k * increment).toFixed(decimals) + '\n';
      return { code: 0, out, err: '' };
    },
    basename: ({ argv }) => {
      let suffix = null;
      let multi = false;
      const operands = [];
      for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '-s') {
          suffix = argv[++i] ?? '';
          multi = true;
        } else if (argv[i] === '-a') multi = true;
        else operands.push(argv[i]);
      }
      if (!operands.length) return { code: 1, out: '', err: 'basename: missing operand\n' };
      if (!multi && operands.length > 2) return { code: 1, out: '', err: "basename: extra operand '" + operands[2] + "'\n" };
      if (!multi && operands.length === 2) suffix = operands[1];
      const names = multi ? operands : [operands[0]];
      return { code: 0, out: names.map((name) => stripSuffix(baseName(name), suffix) + '\n').join(''), err: '' };
    },
    dirname: ({ argv }) => {
      const names = argv.filter((arg) => !arg.startsWith('-'));
      if (!names.length) return { code: 1, out: '', err: 'dirname: missing operand\n' };
      return { code: 0, out: names.map((name) => dirOf(name) + '\n').join(''), err: '' };
    },
    md5sum: ({ argv, stdin = '' }) => digestCommand('md5sum', md5Hex, argv, stdin),
    sha256sum: ({ argv, stdin = '' }) => digestCommand('sha256sum', sha256Hex, argv, stdin),
    realpath: ({ argv }) => {
      let mode = 'default';
      let strip = false;
      let out = '';
      let err = '';
      let code = 0;
      const names = [];
      for (const arg of argv) {
        if (arg === '-e') mode = 'existing';
        else if (arg === '-m') mode = 'missing';
        else if (arg === '-s') strip = true;
        else if (arg === '-P') strip = false;
        else if (!arg.startsWith('-')) names.push(arg);
      }
      for (const name of names) {
        const result = realpathOf(name, mode, strip);
        if (result.error) {
          err += 'realpath: ' + name + ': ' + result.error + '\n';
          code = 1;
        } else out += result.path + '\n';
      }
      return { code, out, err };
    },
    chmod: ({ argv }) => {
      const quoted = (text) => quoteName(text, childLocaleMode());
      const flagLetters = argv.map((arg) => (arg === '--recursive' ? 'R' : arg === '--verbose' ? 'v' : arg === '--changes' ? 'c' : arg === '--dereference' ? 'D' : arg === '--no-dereference' ? 'h' : /^-[Rvch]+$/.test(arg) ? arg.slice(1) : '')).join('');
      const recursive = flagLetters.includes('R');
      const verbose = flagLetters.includes('v');
      const changes = flagLetters.includes('c');
      const dereference = flagLetters.includes('D');
      const noDereference = flagLetters.includes('h');
      const operands = [];
      let referenceFile = null;
      for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith('--reference=')) referenceFile = argv[i].slice('--reference='.length);
        else if (argv[i] === '--reference') {
          if (i + 1 >= argv.length) return { code: 1, out: '', err: "chmod: option '--reference' requires an argument\n" + "Try 'chmod --help' for more information.\n" };
          referenceFile = argv[++i];
        } else operands.push(argv[i]);
      }
      if (referenceFile !== null && !statInfo(resolvePath(referenceFile))) return { code: 1, out: '', err: "chmod: failed to get attributes of " + quoted(referenceFile) + ": No such file or directory\n" };
      const positional = operands.filter((arg) => !/^(-[Rvch]+|--recursive|--verbose|--changes|--dereference|--no-dereference)$/.test(arg));
      const mode = referenceFile === null ? positional[0] : undefined;
      const names = referenceFile === null ? positional.slice(1) : positional;
      const referenceBits = referenceFile === null ? null : parseInt(modes.get(resolvePath(referenceFile)) ?? (host.stat(resolvePath(referenceFile))?.dir === true ? '755' : '644'), 8);
      const usage = "Try 'chmod --help' for more information.\n";
      if (referenceFile !== null ? !names.length : mode === undefined) return { code: 1, out: '', err: 'chmod: missing operand\n' + usage };
      if (!names.length) return { code: 1, out: '', err: "chmod: missing operand after " + quoted(mode) + "\n" + usage };
      const octal = mode !== undefined && /^[0-7]{1,4}$/.test(mode);
      if (mode !== undefined && !octal && applySymbolicMode(0, mode, false).error) return { code: 1, out: '', err: "chmod: invalid mode: " + quoted(mode) + "\n" + usage };
      const changeOne = (path) => {
        const dir = host.stat(path)?.dir === true;
        const before = parseInt(modes.get(path) ?? (dir ? '755' : '644'), 8);
        const after = referenceBits ?? (octal ? parseInt(mode, 8) : applySymbolicMode(before, mode, dir).bits);
        modes.set(path, formatMode(after));
        return { before, after };
      };
      const report = (shown, before, after) => {
        if (before !== after) return verbose || changes ? "mode of " + quoted(shown) + " changed from " + octalModeText(before) + ' to ' + octalModeText(after) + '\n' : '';
        return verbose ? "mode of " + quoted(shown) + " retained as " + octalModeText(after) + '\n' : '';
      };
      let out = '';
      let err = '';
      let code = 0;
      const referentOf = (path) => {
        let current = path;
        for (let hops = 0; hops < 40 && host.lstat(current)?.link; hops++) {
          const target = host.readlink(current);
          current = normalize(target.startsWith('/') ? target : parentOf(current) + '/' + target);
        }
        return current;
      };
      let walked = new Set();
      const visit = (path, shown, access = null) => {
        const seen = walked.has(path);
        walked.add(path);
        const { before, after } = changeOne(path);
        out += report(shown, before, after);
        if (seen || !recursive || host.stat(path)?.dir !== true) return;
        if (!(ownerBits(path) & 4) || (access !== null && searchedDirectories(access).searched.some((dir) => !(ownerBits(dir) & 1)))) {
          err += "chmod: cannot read directory " + quoted(shown) + ": Permission denied\n";
          code = 1;
          if (verbose) out += quoted(shown) + " could not be accessed\n";
          return;
        }
        const searchable = ownerBits(path) & 1;
        for (const entry of host.list(path).sort()) {
          const child = (path === '/' ? '' : path) + '/' + entry;
          if (!searchable) {
            err += "chmod: cannot access " + quoted(shown + '/' + entry) + ": Permission denied\n";
            code = 1;
            if (verbose) out += quoted(shown + '/' + entry) + " could not be accessed\n";
          } else if (host.lstat(child)?.link && dereference && blockedAncestor(child)) {
            err += "chmod: cannot dereference " + quoted(shown + '/' + entry) + ": Permission denied\n";
            code = 1;
            if (verbose) out += quoted(shown + '/' + entry) + " could not be accessed\n";
          } else if (host.lstat(child)?.link && dereference && !statInfo(referentOf(child))) {
            err += "chmod: cannot dereference " + quoted(shown + '/' + entry) + ": No such file or directory\n";
            code = 1;
            if (verbose) out += quoted(shown + '/' + entry) + " could not be accessed\n";
          } else if (host.lstat(child)?.link && !dereference) {
            if (verbose) out += "neither symbolic link " + quoted(shown + '/' + entry) + " nor referent has been changed\n";
          } else visit(referentOf(child), shown + '/' + entry);
        }
      };
      for (const name of names) {
        const rawPath = name.startsWith('/') ? name : state.cwd + '/' + name;
        const walk = searchedDirectories(rawPath, true);
        const named = searchedDirectories(rawPath, false).real;
        if (walk.searched.some((dir) => !(ownerBits(dir) & 1))) {
          if (verbose) out += quoted(name) + " could not be accessed\n";
          err += "chmod: cannot access " + quoted(name) + ": Permission denied\n";
          code = 1;
        } else if (noDereference && host.lstat(named)?.link) {
          if (verbose) out += "neither symbolic link " + quoted(name) + " nor referent has been changed\n";
        } else if (!statInfo(walk.real)) {
          if (verbose) out += quoted(name) + " could not be accessed\n";
          err += host.lstat(named)?.link ? "chmod: cannot operate on dangling symlink " + quoted(name) + "\n" : "chmod: cannot access " + quoted(name) + ": No such file or directory\n";
          code = 1;
        } else {
          walked = new Set();
          visit(walk.real, name, rawPath);
        }
      }
      return { code, out, err };
    },
    stat: ({ argv }) => {
      const flagAt = argv.indexOf('-c');
      const format = flagAt >= 0 ? argv[flagAt + 1] ?? '' : null;
      const follow = argv.includes('-L');
      const names = (flagAt >= 0 ? argv.filter((arg, i) => i !== flagAt && i !== flagAt + 1) : argv).filter((arg) => arg !== '-L');
      if (!names.length) return { code: 1, out: '', err: 'stat: missing operand\n' };
      let out = '';
      let err = '';
      let code = 0;
      for (const name of names) {
        const walk = searchedDirectories(name.startsWith('/') ? name : state.cwd + '/' + name, follow);
        if (walk.searched.some((dir) => !(ownerBits(dir) & 1))) {
          err += "stat: cannot statx " + quoteName(name, childLocaleMode()) + ": Permission denied\n";
          code = 1;
          continue;
        }
        const info = statInfo(walk.real);
        if (!info) {
          err += "stat: cannot statx " + quoteName(name, childLocaleMode()) + ": No such file or directory\n";
          code = 1;
        } else if (format === null) out += statLayout(name, walk.real, info) + '\n';
        else out += expandStat(format, name, info, info.type === 'symbolic link' ? host.readlink(walk.real) : null, childLocaleMode()) + '\n';
      }
      return { code, out, err };
    },
    env: async ({ argv, stdin, signal }) => {
      const assigns = new Map();
      let at = 0;
      for (; at < argv.length && argv[at].indexOf('=') > 0; at++) {
        const eq = argv[at].indexOf('=');
        assigns.set(argv[at].slice(0, eq), argv[at].slice(eq + 1));
      }
      if (argv[at]?.startsWith('-')) return { code: 125, out: '', err: `env: unsupported option ${argv[at]}\n` };
      if (at === argv.length) {
        const prefixed = [...prefixNames].filter((name) => vars.has(name)).map((name) => [name, vars.get(name)]);
        return ok(environmentLines(new Map([...prefixed, ...assigns])));
      }
      const command = argv[at];
      if (!functions.has(command) && !Object.hasOwn(commands, command) && !inPage.has(command)) return { code: 127, out: '', err: "env: '" + command + "': No such file or directory\n" };
      const restore = [...assigns.keys()].map((name) => [name, vars.get(name), exported.has(name)]);
      for (const [name, value] of assigns) {
        setVariable(name, value);
        exported.add(name);
      }
      try {
        return await dispatch(argv.slice(at), stdin, signal);
      } finally {
        for (const [name, value, wasExported] of restore) {
          if (value === undefined) vars.delete(name);
          else setVariable(name, value);
          if (!wasExported) exported.delete(name);
        }
      }
    },
    printenv: ({ argv }) => {
      if (!argv.length) return ok(environmentLines(new Map()));
      let out = '';
      let code = 0;
      for (const name of argv) {
        if (exported.has(name) && vars.has(name)) out += vars.get(name) + '\n';
        else code = 1;
      }
      return { code, out, err: '' };
    },
    export: ({ argv }) => {
      for (const arg of argv) {
        const eq = arg.indexOf('=');
        const name = eq > 0 ? arg.slice(0, eq) : arg;
        if (eq > 0) setVariable(name, arg.slice(eq + 1));
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
          exported.add(name);
          inherited.delete(name);
        }
      }
      return ok('');
    },
    local: ({ argv }) => {
      const frame = frames.at(-1);
      for (const arg of argv) {
        const eq = arg.indexOf('=');
        const name = eq < 0 ? arg : arg.slice(0, eq);
        frame?.set(name, eq < 0 ? '' : arg.slice(eq + 1));
        if (LOCALE_NAMES.includes(name)) settleLocale(name, eq < 0 || arg.slice(eq + 1) === '');
      }
      return ok('');
    },
    return: ({ argv }) => {
      throw new ReturnSignal(Number(argv[0] ?? state.status));
    },
    ':': () => ok(''),
    shift: ({ argv }) => {
      const count = argv.length ? Number(argv[0]) : 1;
      if (!Number.isInteger(count)) return { code: 2, out: '', err: `shift: ${argv[0]}: numeric argument required\n` };
      if (count < 0 || count > positional.length) return { code: 1, out: '', err: '' };
      positional = positional.slice(count);
      return ok('');
    },
    set: ({ argv }) => {
      if (!argv.length) return ok([...vars].sort(byName).map(([name, value]) => `${name}=${value}\n`).join(''));
      for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--') {
          positional = argv.slice(i + 1);
          return ok('');
        }
        if (!/^[-+][ex]+$/.test(argv[i])) return { code: 2, out: '', err: `set: unsupported option ${argv[i]}\n` };
        for (const letter of argv[i].slice(1)) {
          if (letter === 'e') errexit = argv[i][0] === '-';
          else xtrace = argv[i][0] === '-';
        }
      }
      return ok('');
    },
    test: ({ argv }) => testBuiltin(argv, 'test'),
    '[': ({ argv }) => {
      if (argv.at(-1) !== ']') return { code: 2, out: '', err: "[: missing ']'\n" };
      return testBuiltin(argv.slice(0, -1), '[');
    },
    which: ({ argv }) => lookupNames(argv),
    type: ({ argv }) => typeNames(argv),
    command: ({ argv, stdin, signal }) => (argv[0] === '-v' ? lookupNames(argv.slice(1)) : dispatch(argv, stdin, signal)),
    cat({ argv, stdin }) {
      if (!argv.length) return ok(stdin ?? '');
      let out = '';
      let err = '';
      let code = 0;
      for (const name of argv) {
        if (name === '-') {
          out += stdin ?? '';
          continue;
        }
        try {
          out += readFileText(resolvePath(name));
        } catch {
          err += `cat: ${name}: No such file or directory\n`;
          code = 1;
        }
      }
      return { code, out, err };
    },
    tr({ argv, stdin = '' }) {
      const { flags, operands } = argsOf(argv, []);
      const from = expandSet(operands[0] ?? '');
      const to = expandSet(operands[1] ?? '');
      let out = '';
      const squeezeSet = to.length ? to : from;
      let prev = null;
      for (const c of stdin) {
        const index = from.indexOf(c);
        if (flags.has('-d')) {
          if (index < 0) out += c;
          continue;
        }
        const mapped = index < 0 || !to.length ? c : to[Math.min(index, to.length - 1)];
        if (flags.has('-s') && mapped === prev && squeezeSet.includes(mapped)) continue;
        out += mapped;
        prev = mapped;
      }
      return ok(out);
    },
    xargs: async ({ argv, stdin = '', signal }) => {
      let at = 0;
      let size = Infinity;
      while (at < argv.length && argv[at].startsWith('-') && argv[at] !== '-') {
        const arg = argv[at++];
        const count = arg === '-n' ? argv[at++] : arg.startsWith('-n') ? arg.slice(2) : null;
        if (count === null) return { code: 1, out: '', err: 'xargs: unsupported option ' + arg + '\n' };
        size = Number(count);
        if (!Number.isInteger(size) || size < 1) return { code: 1, out: '', err: 'xargs: invalid number of arguments\n' };
      }
      const command = argv.slice(at);
      if (!command.length) command.push('echo');
      const words = stdin.split(/\s+/).filter(Boolean);
      const batches = [];
      for (let i = 0; i < words.length; i += size) batches.push(words.slice(i, i + size));
      if (!batches.length) batches.push([]);
      let out = '';
      let err = '';
      let code = 0;
      for (const batch of batches) {
        const result = await dispatch([...command, ...batch], '', signal);
        out += result.out;
        err += result.err;
        if (result.code && !code) code = 123;
      }
      return { code, out, err };
    },
    sed: ({ argv, stdin }) => runSed(argv, toolContext(stdin)),
    tar: ({ argv, stdin, stream }) => runTar(argv, { ...toolContext(stdin), stdinBytes: stream?.bytes ?? null }),
    jq: ({ argv, stdin }) => runJq(argv, { ...toolContext(stdin), environment: Object.fromEntries([...exported].filter((name) => vars.has(name)).map((name) => [name, vars.get(name)])) }),
    awk: ({ argv, stdin }) => runAwk(argv, toolContext(stdin)),
  };

  const signalNumber = (spec) => {
    if (/^\d+$/.test(spec)) return Number(spec);
    return SIGNALS[spec.replace(/^SIG/i, '').toUpperCase()] ?? null;
  };

  const awaitJob = (job, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const onAbort = () => reject(signal.reason);
      signal?.addEventListener('abort', onAbort, { once: true });
      job.promise.then((code) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(code);
      });
    });

  const sleepFor = (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve(ok(''));
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });

  const locate = (name) => {
    if (functions.has(name)) return name;
    if (inPage.has(name) || SHELL_BUILTINS.has(name)) return name;
    if (Object.hasOwn(commands, name)) return `/bin/${name}`;
    return null;
  };

  const lookupNames = (names) => {
    let out = '';
    let code = 0;
    for (const name of names) {
      const found = locate(name);
      if (found === null) code = 1;
      else out += found + '\n';
    }
    return { code, out, err: '' };
  };

  const typeNames = (argv) => {
    const mode = argv[0] === '-t' ? argv.shift() : null;
    let out = '';
    let err = '';
    let code = 0;
    for (const name of argv) {
      const found = locate(name);
      if (found === null) {
        code = 1;
        if (!mode) err += `type: ${name}: not found\n`;
      } else if (mode === '-t') {
        const kind = functions.has(name) ? 'function' : SHELL_BUILTINS.has(name) || inPage.has(name) ? 'builtin' : 'file';
        out += kind + '\n';
      } else if (functions.has(name)) out += `${name} is a function\n`;
      else if (SHELL_BUILTINS.has(name) || inPage.has(name)) out += `${name} is a shell builtin\n`;
      else out += `${name} is ${found}\n`;
    }
    return { code, out, err };
  };

  const testBuiltin = (args, name) => {
    try {
      return { code: evaluateTest(args) ? 0 : 1, out: '', err: '' };
    } catch (err) {
      if (!(err instanceof TestFailure)) throw err;
      return { code: 2, out: '', err: name + ': ' + err.message + '\n' };
    }
  };

  const evaluateTest = (args) => {
    if (args[0] === '!' && args.length > 1) return !evaluateTest(args.slice(1));
    if (args.length === 0) return false;
    if (args.length === 1) return args[0] !== '';
    if (args.length === 2) {
      const [op, value] = args;
      if (op === '-n') return value !== '';
      if (op === '-z') return value === '';
      if (op === '-e') return host.exists(resolvePath(value));
      if (op === '-f' || op === '-d') {
        const info = host.stat(resolvePath(value));
        return Boolean(info) && (op === '-d') === info.dir;
      }
      if (op === '-L' || op === '-h') return Boolean(host.lstat(resolvePath(value))?.link);
      if (op === '-r' || op === '-w' || op === '-x') return permissionBit(value, { '-r': 4, '-w': 2, '-x': 1 }[op]);
      if (op === '-O' || op === '-G') {
        const real = searchedDirectories(resolvePath(value)).real;
        const [key, id] = op === '-O' ? ['uid', SHELL_UID] : ['gid', SHELL_GID];
        return Boolean(statInfo(real)) && (host.stat(real)?.[key] ?? id) === id;
      }
      if (op === '-N') {
        const real = searchedDirectories(resolvePath(value)).real;
        const record = fileTicks.get(real);
        return Boolean(statInfo(real)) && record !== undefined && record.m > record.a;
      }
      if (op === '-s') return (host.stat(resolvePath(value))?.size ?? 0) > 0;
      throw new Error(`test: ${op}: unary operator not supported`);
    }
    if (args.length === 3) {
      const [a, op, b] = args;
      if (op === '=' || op === '==') return a === b;
      if (op === '!=') return a !== b;
      const numeric = { '-eq': (x, y) => x === y, '-ne': (x, y) => x !== y, '-lt': (x, y) => x < y, '-gt': (x, y) => x > y, '-le': (x, y) => x <= y, '-ge': (x, y) => x >= y };
      if (numeric[op]) return numeric[op](testInteger(a), testInteger(b));
      throw new Error(`test: ${op}: binary operator not supported`);
    }
    throw new Error('test: too many arguments');
  };

  const variableValue = (name) => {
    if (name === '?') return String(state.status);
    if (/^[1-9]$/.test(name)) return positional[Number(name) - 1];
    if (name === '#') return String(positional.length);
    if (name === '@' || name === '*') return positional.join(' ');
    if (name === '0') return 'thebird';
    if (name === '$') return '1';
    if (name === '!') return lastPid === null ? '' : String(lastPid);
    for (let i = frames.length - 1; i >= 0; i--) {
      if (frames[i].has(name)) return frames[i].get(name);
    }
    return vars.get(name);
  };

  const removeVariable = (name) => {
    for (let i = frames.length - 1; i >= 0; i--) {
      if (!frames[i].has(name)) continue;
      if (i === frames.length - 1) frames[i].set(name, undefined);
      else frames[i].delete(name);
      settleLocale();
      return;
    }
    vars.delete(name);
    exported.delete(name);
    inherited.delete(name);
    settleLocale(null, LOCALE_NAMES.includes(name));
  };

  const readBuiltin = (argv, cursor) => {
    let raw = false;
    let at = 0;
    while (at < argv.length && argv[at].startsWith('-') && argv[at] !== '-') {
      if (argv[at] === '--') {
        at++;
        break;
      }
      for (const letter of argv[at].slice(1)) {
        if (letter === 'r') raw = true;
        else return { code: 2, out: '', err: 'read: -' + letter + ': invalid option\nread: usage: read [-Eers] [-a array] [-d delim] [-i text] [-n nchars] [-N nchars] [-p prompt] [-t timeout] [-u fd] [name ...]\n' };
      }
      at++;
    }
    const names = argv.slice(at);
    const bad = names.find((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name));
    if (bad !== undefined) return { code: 1, out: '', err: 'read: `' + bad + "': not a valid identifier\n" };
    const { chars, end, eof } = readChars(cursor.text, cursor.pos, raw);
    cursor.pos = end;
    if (!names.length) setVariable('REPLY', chars.map((x) => x.c).join(''));
    else {
      const values = splitRead(chars, names.length, vars.get('IFS') ?? ' \t\n');
      names.forEach((name, i) => setVariable(name, values[i]));
    }
    return { code: eof ? 1 : 0, out: '', err: '' };
  };

  const setVariable = (name, value, quiet = false) => {
    if (arrays.has(name)) return setElement(name, 0, value);
    const frame = frames.at(-1);
    if (frame?.has(name)) frame.set(name, value);
    else vars.set(name, value);
    if (!quiet && !prefixNames.has(name)) inherited.delete(name);
    if (LOCALE_NAMES.includes(name)) settleLocale(quiet ? null : name, value === '');
  };

  async function expandChars(parts, inDouble, sink) {
    const chars = [];
    const add = (text, quoted) => {
      for (const c of text) chars.push({ c, q: quoted, split: !quoted });
    };
    for (const part of parts) {
      if (part.k === 'lit') add(part.s, false);
      else if (part.k === 'sq') add(part.s, true);
      else if (part.k === 'dq') chars.push(...(await expandChars(part.parts, true, sink)));
      else if (part.k === 'param' && part.index === '@') chars.push(...elementChars(arrayItems(part.name), '@', inDouble));
      else if (part.k === 'slice') chars.push(...elementChars(arraySlice(part), part.index, inDouble));
      else if (part.k === 'keys') chars.push(...elementChars([...(arrays.get(part.name)?.keys() ?? [])].sort((a, b) => a - b).map(String), part.index, inDouble));
      else if (part.k === 'param') add(await parameterText(part, sink), inDouble);
      else if (part.k === 'len') add(String(part.index !== undefined ? arrayLength(part) : characterCount(arrays.has(part.name) ? (arrays.get(part.name).get(0) ?? '') : (variableValue(part.name) ?? ''), shellLocale)), inDouble);
      else if (part.k === 'cmd') add(await commandText(part.src, sink), inDouble);
      else if (part.k === 'arith') add(String(evaluateArithmetic(part.src, (name) => variableValue(name) ?? '', setVariable)), inDouble);
      else throw new Error(`${part.k} is not supported yet`);
    }
    return chars;
  }

  async function parameterText(part, sink) {
    if (part.index !== undefined) {
      if (part.index === '*') return arrayItems(part.name).join(' ');
      return arrayElement(part.name, arrayIndex(part)) ?? '';
    }
    if (arrays.has(part.name)) return arrays.get(part.name).get(0) ?? '';
    const value = variableValue(part.name);
    const unset = part.op?.startsWith(':') ? !value : value === undefined;
    if (part.op === null) return value ?? '';
    if (part.op === ':-' || part.op === '-') return unset ? await expandText(part.word, sink) : value;
    if (part.op === '?' || part.op === ':?') {
      if (!unset) return value;
      const word = part.word.length ? await expandText(part.word, sink) : part.op === '?' ? 'parameter not set' : 'parameter null or not set';
      throw new Error('thebird: ' + part.name + ': ' + word);
    }
    throw new Error(`${part.name}${part.op} is not supported yet`);
  }

  async function expandText(parts, sink) {
    return (await expandChars(parts, false, sink)).map((ch) => ch.c).join('');
  }

  async function commandText(src, sink) {
    const sub = { out: '', err: '', signal: sink.signal };
    const outerLine = vars.get('LINENO');
    substDepth++;
    try {
      await runSequence(parseScript(src, Number(outerLine) || 1, true), '', sub);
    } catch (err) {
      if (!(err instanceof ShellExit)) throw err;
    } finally {
      substDepth--;
      if (outerLine !== undefined) vars.set('LINENO', outerLine);
    }
    sink.err += sub.err;
    return sub.out.replace(/\n+$/, '');
  }

  function splitFields(chars) {
    const fields = [];
    let current = [];
    let started = false;
    for (const ch of chars) {
      if (ch.start) {
        if (started) fields.push(current);
        current = [];
        started = true;
      } else if (ch.split && /[ \t\n]/.test(ch.c)) {
        if (current.length) fields.push(current);
        current = [];
      } else current.push(ch);
    }
    if (started || current.length) fields.push(current);
    return fields;
  }

  const isWildcard = (ch) => !ch.q && (ch.c === '*' || ch.c === '?');
  const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function globField(field) {
    const slash = field.findLastIndex((ch) => ch.c === '/');
    const dirChars = field.slice(0, slash + 1);
    const baseChars = field.slice(slash + 1);
    if (dirChars.some(isWildcard)) return [];
    const dirText = dirChars.map((ch) => ch.c).join('');
    const pattern = new RegExp('^' + baseChars.map((ch) => (isWildcard(ch) ? (ch.c === '*' ? '[^/]*' : '[^/]') : escapeRegExp(ch.c))).join('') + '$');
    let names;
    try {
      names = host.list(resolvePath(dirText || '.'));
    } catch {
      return [];
    }
    const dotted = baseChars[0]?.c === '.';
    return names
      .filter((name) => pattern.test(name) && (dotted || !name.startsWith('.')))
      .sort()
      .map((name) => dirText + name);
  }

  async function expandWord(parts, sink) {
    const fields = splitFields(await expandChars(parts, false, sink));
    if (!fields.length && parts.some((part) => part.k === 'sq' || (part.k === 'dq' && !onlyAtArray(part)))) return [''];
    const words = [];
    for (const field of fields) {
      const matches = field.some(isWildcard) ? globField(field) : [];
      if (matches.length) words.push(...matches);
      else words.push(field.map((ch) => ch.c).join(''));
    }
    return words;
  }

  const braceWords = (parts) => {
    if (!parts.length || !parts.every((part) => part.k === 'lit')) return [parts];
    return braceExpand(parts.map((part) => part.s).join('')).map((text) => [{ k: 'lit', s: text }]);
  };

  const tildeWord = (parts) => {
    const home = vars.get('HOME');
    const first = parts[0];
    if (home === undefined || first?.k !== 'lit' || first.s[0] !== '~') return parts;
    const tildeOnly = first.s.length === 1 && parts.length === 1;
    if (!tildeOnly && first.s[1] !== '/') return parts;
    return [{ k: 'sq', s: home }, { k: 'lit', s: first.s.slice(1) }, ...parts.slice(1)];
  };

  async function expandWords(words, sink) {
    const argv = [];
    for (const word of words) {
      for (const variant of braceWords(word)) argv.push(...(await expandWord(tildeWord(variant), sink)));
    }
    return argv;
  }

  const bodyText = async (parts, sink) => (await expandChars(parts, false, sink)).map((ch) => ch.c).join('');

  const wordPath = async (parts, sink) => resolvePath((await expandWord(parts, sink))[0] ?? '');

  const describePart = (part) => {
    if (part.k === 'lit' || part.k === 'sq') return part.s;
    if (part.k === 'dq') return `"${part.parts.map(describePart).join('')}"`;
    if (part.k === 'param') return `$${part.name}`;
    if (part.k === 'cmd') return `$(${part.src})`;
    if (part.k === 'arith') return `$((${part.src}))`;
    return '';
  };

  const describePipe = (pipe) =>
    pipe.cmds.map((cmd) => (cmd.type === 'simple' ? cmd.words.map((parts) => parts.map(describePart).join('')).join(' ') : cmd.type)).join(' | ');

  const startJob = (pipe, stdin) => {
    const pid = nextPid++;
    const control = new AbortController();
    const job = { pid, command: describePipe(pipe), control, done: false, code: 0, promise: null };
    jobs.set(pid, job);
    lastPid = pid;
    job.promise = (async () => {
      const sink = { out: '', err: '', signal: control.signal };
      let code;
      try {
        code = await runPipeline(pipe, stdin, sink);
      } catch (err) {
        if (err instanceof Signalled) code = 128 + err.signo;
        else if (err instanceof ShellExit) code = err.code;
        else {
          code = 2;
          sink.err += `${err.message}\n`;
        }
      }
      job.done = true;
      job.code = code;
      runSink.out += sink.out;
      runSink.err += sink.err;
      return code;
    })();
    return job;
  };

  async function runSimple(node, stdin, sink, stream) {
    vars.set('LINENO', String(node.line));
    const argv = await expandWords(node.words, sink);
    const assigned = [];
    for (const assign of node.assigns) {
      if (assign.array) arrays.set(assign.name, new Map((await expandWords(assign.array, sink)).map((value, i) => [i, value])));
      else if (assign.index) setElement(assign.name, arrayIndex({ index: await expandText(assign.index, sink) }), await expandText(assign.value, sink));
      else assigned.push([assign.name, await expandText(assign.value, sink)]);
    }
    const trace = xtrace ? traceLines(assigned, argv, await tracePrefix(sink)) : '';
    sink.err += trace;
    if (!argv.length) {
      for (const [name, value] of assigned) setVariable(name, value);
      return { code: 0, out: '', err: takeLocaleWarnings() };
    }
    const saved = new Map(assigned.map(([name]) => [name, vars.get(name)]));
    const priorPrefix = [...prefixNames];
    const external = !BASH_BUILTINS.has(argv[0]) && !functions.has(argv[0]);
    for (const [name] of assigned) prefixNames.add(name);
    for (const [name, value] of assigned) setVariable(name, value, external);
    try {
      const result = await runCommand(node, argv, stdin, sink, stream);
      return { ...result, err: takeLocaleWarnings() + result.err };
    } finally {
      prefixNames.clear();
      for (const name of priorPrefix) prefixNames.add(name);
      for (const [name, value] of saved) {
        if (value === undefined) vars.delete(name);
        else setVariable(name, value, true);
      }
      settleLocale();
    }
  }

  function writeRedirect(path, text) {
    if (path !== NULL_DEVICE) writeFileText(path, text);
  }

  async function openFile(redirect, sink) {
    const path = await wordPath(redirect.target, sink);
    const append = redirect.op.endsWith('>>');
    if (path !== NULL_DEVICE && (!append || !host.exists(path))) writeRedirect(path, '');
    return path;
  }

  const badFdResult = (target) => ({ code: 1, out: '', err: 'thebird: ' + target + ': Bad file descriptor\n' });
  const ambiguousResult = (text) => ({ code: 1, out: '', err: 'thebird: ' + text + ': ambiguous redirect\n' });

  async function dupOf(redirect, sink) {
    const words = await expandWord(redirect.target, sink);
    const word = words.length === 1 ? words[0] : null;
    if (word === '-') return { close: true };
    if (word !== null && /^[0-9]+$/.test(word)) return { fd: Number(word) };
    if (word === '') return { error: badFdResult(/^[0-9]/.test(redirect.op) ? redirect.op[0] : '""') };
    if (redirect.op === '>&' || redirect.op === '1>&') {
      if (word === null) return { error: ambiguousResult(redirect.text) };
      return { file: true };
    }
    return { error: ambiguousResult(word ?? redirect.text) };
  }

  async function outputFailure(redirect, sink) {
    const path = await wordPath(redirect.target, sink);
    if (path === NULL_DEVICE) return null;
    let dir = parentOf(resolvePath(path));
    if (host.stat(dir)?.dir === true) return null;
    while (!host.stat(dir) && dir !== '/') dir = parentOf(dir);
    const found = host.stat(dir);
    const word = (await expandWord(redirect.target, sink)).join('');
    return { code: 1, out: '', err: 'thebird: ' + word + ': ' + (found && found.dir !== true ? 'Not a directory' : 'No such file or directory') + '\n' };
  }

  async function inputFailure(redirect, sink) {
    const path = await wordPath(redirect.target, sink);
    if (path === NULL_DEVICE || host.exists(path)) return null;
    const word = (await expandWord(redirect.target, sink)).join('');
    return { code: 1, out: '', err: 'thebird: ' + word + ': No such file or directory\n' };
  }

  async function failAt(redirects, index, failure, sink) {
    const routed = await applyOutputRedirects(redirects.slice(0, index), '', failure.err, sink);
    return { code: failure.code, out: routed.out, err: routed.err };
  }

  async function openRedirects(redirects, sink) {
    const open = new Set([0, 1, 2, ...fdTable.keys()]);
    for (const [index, redirect] of redirects.entries()) {
      const { op } = redirect;
      if (DUP_OPS.has(op) || op === '2>&1') {
        const fd = Number(op.startsWith('<') ? '0' : op.startsWith('>') ? '1' : op[0]);
        const dup = op === '2>&1' ? { fd: 1 } : await dupOf(redirect, sink);
        if (dup.error) return failAt(redirects, index, dup.error, sink);
        if (dup.close) open.delete(fd);
        else if (dup.file) {
          const failure = await outputFailure(redirect, sink);
          if (failure) return failAt(redirects, index, failure, sink);
          await openFile(redirect, sink);
          open.add(1).add(2);
        } else if (!open.has(dup.fd)) return failAt(redirects, index, badFdResult(String(dup.fd)), sink);
        else open.add(fd);
      } else if (op === '<' || op === '1<' || FD_INPUTS.includes(op)) {
        const failure = await inputFailure(redirect, sink);
        if (failure) return failAt(redirects, index, failure, sink);
        if (op !== '<') open.add(Number(op[0]));
      } else if (FD1_HEREDOCS.includes(op) || FD_HEREDOCS.includes(op)) {
        open.add(Number(op[0]));
      } else if (op === '1<>' || FD_OUTPUTS.includes(op) || FILE_FDS[op]) {
        const failure = await outputFailure(redirect, sink);
        if (failure) return failAt(redirects, index, failure, sink);
        if (op === '1<>') {
          const path = await wordPath(redirect.target, sink);
          if (path !== NULL_DEVICE && !host.exists(path)) writeRedirect(path, '');
          open.add(1);
        } else {
          await openFile(redirect, sink);
          for (const fd of FILE_FDS[op] ?? [Number(op[0])]) open.add(fd);
        }
      }
    }
    return null;
  }

  async function applyTableRedirects(redirects, sink) {
    for (const redirect of redirects) {
      const { op } = redirect;
      const fd = Number(op[0]);
      if (DUP_OPS.has(op)) {
        const target = (await expandWord(redirect.target, sink)).join('');
        if (target === '-') fdTable.delete(fd);
        else fdTable.set(fd, target === '1' ? 'out' : target === '2' ? 'err' : target === '0' ? 'readonly' : fdTable.get(Number(target)));
      } else if (FD_OUTPUTS.includes(op)) {
        fdTable.set(fd, { path: await wordPath(redirect.target, sink) });
      } else if (FD_INPUTS.includes(op)) {
        fdTable.set(fd, { read: await wordPath(redirect.target, sink), pos: 0 });
      } else if (FD_HEREDOCS.includes(op)) {
        const text = op.endsWith('<<<') ? (await expandWord(redirect.target, sink)).join(' ') + '\n' : await bodyText(redirect.body, sink);
        fdTable.set(fd, { heredoc: text, pos: 0 });
      }
    }
  }

  async function applyExecRedirects(redirects, sink) {
    if (redirects.some((redirect) => !/^[3-9]/.test(redirect.op))) return { code: 2, out: '', err: 'thebird: exec: only descriptors 3 to 9 can be redirected\n' };
    await applyTableRedirects(redirects, sink);
    return { code: 0, out: '', err: '' };
  }

  async function inputDup(redirect, input, sink) {
    const dup = await dupOf(redirect, sink);
    if (dup.close) return { text: '', entry: null, shared: false };
    if (dup.fd === 0) return { text: input, entry: null, shared: true };
    const entry = fdTable.get(dup.fd);
    return { text: inputText(entry).slice(entry?.pos ?? 0), entry: entry?.pos === undefined ? null : entry, shared: false };
  }

  function inputText(entry) {
    if (entry?.heredoc !== undefined) return entry.heredoc;
    if (entry?.read === undefined || entry.read === NULL_DEVICE) return '';
    return readFileText(entry.read);
  }

  async function resolveInput(redirects, stdin, sink, seekable0) {
    let input = stdin;
    let entry = null;
    let seekable = seekable0;
    for (const redirect of redirects) {
      if (/^[3-9]/.test(redirect.op)) await applyTableRedirects([redirect], sink);
      else if (redirect.op === '<<' || redirect.op === '<<-') {
        input = await bodyText(redirect.body, sink);
        entry = null;
        seekable = false;
      } else if (redirect.op === '<<<') {
        input = (await expandWord(redirect.target, sink)).join(' ') + '\n';
        entry = null;
        seekable = false;
      } else if (redirect.op === '<') {
        const path = await wordPath(redirect.target, sink);
        input = path === NULL_DEVICE ? '' : readFileText(path);
        entry = null;
        seekable = true;
      } else if (INPUT_DUP_OPS.has(redirect.op)) {
        const dup = await inputDup(redirect, input, sink);
        input = dup.text;
        if (!dup.shared) {
          entry = dup.entry;
          seekable = dup.entry !== null && dup.entry.read !== undefined;
        }
      }
    }
    return { input, entry, seekable };
  }

  async function withRedirects(node, stdin, sink, run, stream) {
    const opened = await openRedirects(node.redirects, sink);
    if (opened) return opened;
    const descriptors = node.redirects.filter((redirect) => /^[3-9]/.test(redirect.op));
    const saved = descriptors.map((redirect) => [Number(redirect.op[0]), fdTable.get(Number(redirect.op[0]))]);
    let result;
    let entry = null;
    let cursor = stream;
    try {
      const resolved = await resolveInput(node.redirects, stdin, sink, stream?.seekable === true);
      entry = resolved.entry;
      const hasInput = node.redirects.some((redirect) => /^<</.test(redirect.op) || redirect.op === '<' || INPUT_DUP_OPS.has(redirect.op));
      cursor = hasInput ? { text: resolved.input, pos: 0, seekable: resolved.seekable } : stream;
      const scratch = { out: '', err: '', signal: sink.signal, stream: cursor };
      try {
        result = await run(node, resolved.input, scratch);
      } catch (err) {
        if (err && typeof err === 'object') err.output = await applyOutputRedirects(node.redirects, scratch.out, scratch.err, sink);
        throw err;
      }
    } finally {
      if (entry) entry.pos += cursor.pos;
      for (const [fd, value] of saved) {
        if (value === undefined) fdTable.delete(fd);
        else fdTable.set(fd, value);
      }
    }
    return { code: result.code, ...(await applyOutputRedirects(node.redirects, result.out, result.err, sink)) };
  }

  async function runCommand(node, argv, stdin, sink, stream) {
    const opened = await openRedirects(node.redirects, sink);
    if (opened) return opened;
    if (argv.length === 1 && argv[0] === 'exec') return applyExecRedirects(node.redirects, sink);
    const execute = argv[0] === 'exec';
    if (execute) argv = argv.slice(1);
    const descriptors = node.redirects.filter((redirect) => /^[3-9]/.test(redirect.op));
    const saved = descriptors.map((redirect) => [Number(redirect.op[0]), fdTable.get(Number(redirect.op[0]))]);
    let result;
    try {
      let input = stdin;
      let redirected = false;
      let seekable = stream?.seekable === true;
      let fdEntry = null;
      for (const redirect of node.redirects) {
        if (/^[3-9]/.test(redirect.op)) await applyTableRedirects([redirect], sink);
        else if (redirect.op === '<<' || redirect.op === '<<-') {
          input = await bodyText(redirect.body, sink);
          redirected = true;
          fdEntry = null;
          seekable = false;
        } else if (redirect.op === '<<<') {
          input = (await expandWord(redirect.target, sink)).join(' ') + '\n';
          redirected = true;
          fdEntry = null;
          seekable = false;
        } else if (redirect.op === '<') {
          try {
            const path = await wordPath(redirect.target, sink);
            input = path === NULL_DEVICE ? '' : readFileText(path);
          } catch {
            return { code: 1, out: '', err: argv[0] + ': no such file\n' };
          }
          redirected = true;
          fdEntry = null;
          seekable = true;
        } else if (INPUT_DUP_OPS.has(redirect.op)) {
          const dup = await inputDup(redirect, input, sink);
          input = dup.text;
          if (!dup.shared) {
            redirected = true;
            fdEntry = dup.entry;
            seekable = dup.entry !== null && dup.entry.read !== undefined;
          }
        }
      }
      const inputStream = redirected ? { text: input, pos: 0, seekable } : stream;
      result = execute && !commandKnown(argv[0]) ? { code: 127, out: '', err: 'thebird: exec: ' + argv[0] + ': not found\n' } : await dispatch(argv, input, sink.signal, inputStream);
      if (inputStream?.text === input) {
        if (!NON_READERS.has(argv[0]) && !functions.has(argv[0]) && !PARTIAL_READERS.has(argv[0])) inputStream.pos = input.length;
        if (fdEntry) fdEntry.pos += inputStream.pos;
      }
    } finally {
      for (const [fd, value] of saved) {
        if (value === undefined) fdTable.delete(fd);
        else fdTable.set(fd, value);
      }
    }
    const applied = await applyOutputRedirects(node.redirects, result.out, result.err, sink, result.bytes ?? null);
    const finished = { code: result.code, ...applied };
    if (execute) throw Object.assign(new ShellExit(finished.code), { output: { out: finished.out, err: finished.err } });
    return finished;
  }

  async function applyOutputRedirects(redirects, out, err, sink, bytes = null) {
    const fds = { 0: 'readonly', 1: 'out', 2: 'err' };
    for (const [fd, target] of fdTable) fds[fd] = target;
    for (const redirect of redirects) {
      const { op } = redirect;
      if (DUP_OPS.has(op) || op === '2>&1') {
        const fd = op.startsWith('<') ? '0' : op.startsWith('>') ? '1' : op[0];
        const dup = op === '2>&1' ? { fd: 1 } : await dupOf(redirect, sink);
        if (dup.error) return dup.error;
        if (dup.close) delete fds[fd];
        else if (dup.file) {
          const target = { path: await wordPath(redirect.target, sink) };
          fds[1] = target;
          fds[2] = target;
        } else if (!(dup.fd in fds)) return badFdResult(String(dup.fd));
        else fds[fd] = fds[dup.fd];
      } else if (FD1_HEREDOCS.includes(op) || op === '1<') {
        fds[1] = 'readonly';
      } else if (op === '1<>') {
        fds[1] = { path: await wordPath(redirect.target, sink), rw: true };
      } else if (FD_INPUTS.includes(op)) {
        fds[op[0]] = { read: await wordPath(redirect.target, sink) };
      } else if (FD_HEREDOCS.includes(op)) {
        fds[op[0]] = 'readonly';
      } else if (FD_OUTPUTS.includes(op)) {
        fds[op[0]] = { path: await wordPath(redirect.target, sink) };
      } else if (FILE_FDS[op]) {
        const target = { path: await wordPath(redirect.target, sink) };
        for (const fd of FILE_FDS[op]) fds[fd] = target;
      }
    }
    const files = new Map();
    let outText = '';
    let errText = '';
    let writeFailed = false;
    const route = (fd, text) => {
      const target = fds[fd];
      if (target === 'out') outText += text;
      else if (target === 'err') errText += text;
      else if (target === undefined || target === 'readonly' || target.read !== undefined || target.heredoc !== undefined) writeFailed = writeFailed || text !== '';
      else {
        const entry = files.get(target.path) ?? { text: '', rw: false };
        entry.text += text;
        entry.rw = entry.rw || target.rw === true;
        files.set(target.path, entry);
      }
    };
    let outBytes = bytes;
    if (outBytes && fds[1] !== 'out') {
      const target = fds[1];
      if (typeof target === 'object' && target.path !== undefined && target.rw !== true && target.read === undefined && target.heredoc === undefined) {
        const append = redirects.some((redirect) => redirect.op === '>>' || redirect.op === '1>>' || redirect.op === '&>>');
        const prior = append && host.exists(target.path) ? host.readBytes(target.path) : new Uint8Array(0);
        writeRedirect(target.path, tarConcat([prior, outBytes]));
      }
      outBytes = null;
    }
    route(1, out);
    route(2, err);
    if (writeFailed) route(2, 'thebird: write error: Bad file descriptor\n');
    for (const [path, { text, rw }] of files) {
      if (text === '') continue;
      const prior = host.exists(path) ? readFileText(path) : '';
      writeRedirect(path, rw ? text + prior.slice(text.length) : prior + text);
    }
    if (writeFailed) return { out: outText, err: errText, code: 1, bytes: outBytes };
    return { out: outText, err: errText, bytes: outBytes };
  }

  async function runSubshell(node, stdin, sink) {
    const savedCwd = state.cwd;
    const savedVars = new Map(vars);
    const savedFds = new Map(fdTable);
    const inner = sink;
    let code;
    try {
      code = await runSequence(node.list, stdin, inner);
    } catch (err) {
      if (!(err instanceof ShellExit)) throw err;
      code = err.code;
    } finally {
      state.cwd = savedCwd;
      vars.clear();
      for (const [name, value] of savedVars) vars.set(name, value);
      settleLocale();
      fdTable.clear();
      for (const [fd, value] of savedFds) fdTable.set(fd, value);
    }
    return { code, out: inner.out, err: inner.err };
  }

  async function runGroup(node, stdin, sink) {
    const inner = sink;
    const code = await runSequence(node.list, stdin, inner);
    return { code, out: inner.out, err: inner.err };
  }

  function textInputs(verb, names, stdin, missing = (name) => verb + ': ' + name + ': No such file or directory\n', failure = 1) {
    if (!names.length) return { text: stdin, err: '', code: 0 };
    let text = '';
    let err = '';
    let code = 0;
    for (const name of names) {
      if (name === '-') {
        text += stdin;
        continue;
      }
      try {
        text += readFileText(resolvePath(name));
      } catch {
        err += missing(name);
        code = failure;
      }
    }
    return { text, err, code };
  }

  function copyTree(src, dst) {
    if (host.lstat(src)?.link) {
      host.symlink(host.readlink(src), dst);
      return;
    }
    if (!host.stat(src)?.dir) {
      writeFileText(dst, readFileText(src));
      return;
    }
    host.mkdir(dst, true);
    for (const entry of host.list(src).sort()) copyTree(src + '/' + entry, dst + '/' + entry);
  }

  function copyOrMove(verb, argv) {
    const names = argv.filter((arg) => !arg.startsWith('-'));
    const recursive = verb === 'mv' || argv.some((arg) => arg.startsWith('-') && /[rR]/.test(arg));
    if (names.length < 2) return { code: 1, out: '', err: verb + ': missing file operand\n' };
    const target = names.pop();
    const targetPath = resolvePath(target);
    const toDir = host.stat(targetPath)?.dir === true;
    if (names.length > 1 && !toDir) return { code: 1, out: '', err: verb + ": target '" + target + "' is not a directory\n" };
    let err = '';
    let code = 0;
    for (const name of names) {
      const src = resolvePath(name);
      const info = host.stat(src);
      if (!info) {
        err += verb + ": cannot stat '" + name + "': No such file or directory\n";
        code = 1;
        continue;
      }
      if (info.dir && !recursive) {
        err += verb + ": -r not specified; omitting directory '" + name + "'\n";
        code = 1;
        continue;
      }
      const dst = toDir ? targetPath + '/' + basenameOf(name) : targetPath;
      if (dst === src && verb === 'mv') {
        err += "mv: '" + name + "' and '" + name + "' are the same file\n";
        code = 1;
        continue;
      }
      if (!host.stat(parentOf(dst))?.dir) {
        const failed = verb === 'mv' ? "mv: cannot move '" + name + "' to '" + dst + "'" : "cp: cannot create regular file '" + dst + "'";
        err += failed + ": No such file or directory\n";
        code = 1;
        continue;
      }
      if (info.dir && (dst === src || dst.startsWith(src + '/'))) {
        err += (verb === 'mv' ? "mv: cannot move '" + name + "' to a subdirectory of itself, '" + dst + "'" : "cp: cannot copy a directory, '" + name + "', into itself, '" + dst + "'") + "\n";
        code = 1;
        continue;
      }
      copyTree(src, dst);
      if (verb === 'mv') host.remove(src, info.dir);
    }
    return { code, out: '', err };
  }

  function commandKnown(name) {
    return functions.has(name) || Object.hasOwn(commands, name) || inPage.has(name);
  }

  async function dispatch(argv, stdin, signal, stream) {
    const name = argv[0];
    if (functions.has(name)) return callFunction(functions.get(name), argv.slice(1), stdin, signal, stream);
    if (Object.hasOwn(commands, name)) return commands[name]({ argv: argv.slice(1), stdin: stream && stream.text === stdin ? stream.text.slice(stream.pos) : stdin, signal, stream });
    if (inPage.has(name)) return host.external(name, argv.slice(1), state.cwd);
    return { code: 127, out: '', err: `${name}: command not found\n` };
  }

  async function runIf(node, stdin, sink) {
    const inner = sink;
    let code = 0;
    let taken = false;
    for (const { cond, body } of node.branches) {
      if ((await suspendErrexit(() => runSequence(cond, stdin, inner))) === 0) {
        code = await runSequence(body, stdin, inner);
        taken = true;
        break;
      }
    }
    if (!taken && node.elseBody) code = await runSequence(node.elseBody, stdin, inner);
    return { code, out: inner.out, err: inner.err };
  }

  async function runFor(node, stdin, sink) {
    const inner = sink;
    const values = node.words ? await expandWords(node.words, inner) : positional;
    let code = 0;
    loopDepth++;
    try {
      for (const value of values) {
        await yieldTurn();
        setVariable(node.name, value);
        vars.set('LINENO', String(node.line));
        if (xtrace) inner.err += (await tracePrefix(inner)) + 'for ' + node.name + ' in ' + (node.wordText ? node.wordText.join(' ') : '"$@"') + '\n';
        try {
          code = await runSequence(node.body, stdin, inner);
        } catch (err) {
          if (!(err instanceof LoopSignal)) throw err;
          if (err.levels > 1) throw new LoopSignal(err.kind, err.levels - 1);
          code = 0;
          if (err.kind === 'break') break;
        }
      }
    } finally {
      loopDepth--;
    }
    return { code, out: inner.out, err: inner.err };
  }

  const caseRegExp = (chars) => new RegExp(`^${chars.map((ch) => (isWildcard(ch) ? (ch.c === '*' ? '.*' : '.') : ch.c.replace(/[^A-Za-z0-9_]/g, (m) => String.fromCharCode(92) + m))).join('')}$`);

  async function runCase(node, stdin, sink) {
    const inner = sink;
    const value = (await expandChars(node.word, false, inner)).map((ch) => ch.c).join('');
    for (const arm of node.arms) {
      for (const pattern of arm.patterns) {
        if (caseRegExp(await expandChars(pattern, false, inner)).test(value)) {
          const code = await runSequence(arm.body, stdin, inner);
          return { code, out: inner.out, err: inner.err };
        }
      }
    }
    return { code: 0, out: inner.out, err: inner.err };
  }

  async function runConditional(node, stdin, sink) {
    const inner = sink;
    const code = await evalCond(node.expr, inner);
    return { code, out: inner.out, err: inner.err };
  }

  async function evalCond(expr, sink) {
    if (expr.type === 'and' || expr.type === 'or') {
      const left = await evalCond(expr.left, sink);
      return left === (expr.type === 'and' ? 0 : 1) ? evalCond(expr.right, sink) : left;
    }
    if (expr.type === 'not') {
      const code = await evalCond(expr.expr, sink);
      return code === 2 ? 2 : Number(code === 0);
    }
    if (expr.type === 'word') return (await bodyText(expr.parts, sink)) === '' ? 1 : 0;
    if (expr.type === 'unary') {
      const value = await bodyText(expr.parts, sink);
      try {
        return evaluateTest([expr.op, value]) ? 0 : 1;
      } catch (err) {
        sink.err += err.message + '\n';
        return 2;
      }
    }
    const leftText = await bodyText(expr.left, sink);
    const rightChars = await expandChars(expr.right, false, sink);
    const rightText = rightChars.map((ch) => ch.c).join('');
    if (expr.op === '==' || expr.op === '=') return caseRegExp(rightChars).test(leftText) ? 0 : 1;
    if (expr.op === '!=') return caseRegExp(rightChars).test(leftText) ? 1 : 0;
    if (expr.op === '=~') {
      try {
        const pattern = rightChars.map((ch) => (ch.q ? ch.c.replace(/[^A-Za-z0-9_]/g, (m) => String.fromCharCode(92) + m) : ch.c)).join('');
        const match = new RegExp(pattern).exec(leftText);
        arrays.set('BASH_REMATCH', new Map(match ? Array.from(match, (text, i) => [i, text ?? '']) : []));
        return match ? 0 : 1;
      } catch {
        sink.err += `[[: ${rightText}: invalid regular expression\n`;
        return 2;
      }
    }
    if (expr.op === '<') return collate(leftText, rightText) < 0 ? 0 : 1;
    if (expr.op === '>') return collate(leftText, rightText) > 0 ? 0 : 1;
    const values = [];
    for (const text of [leftText, rightText]) {
      try {
        values.push(text.trim() === '' ? 0 : evaluateArithmetic(text, (name) => variableValue(name) ?? '', setVariable));
      } catch {
        sink.err += '[[: ' + text + ': arithmetic syntax error\n';
        return 1;
      }
    }
    return INTEGER_COMPARE[expr.op](values[0], values[1]) ? 0 : 1;
  }

  async function runSelect(node, stdin, sink) {
    const inner = sink;
    const items = node.words ? await expandWords(node.words, inner) : positional;
    let input = stdin ?? '';
    let code = 0;
    let showMenu = true;
    loopDepth++;
    try {
      for (;;) {
        await yieldTurn();
        if (showMenu) inner.err += selectMenu(items, Number(variableValue('COLUMNS')));
        inner.err += variableValue('PS3') ?? '#? ';
        if (input === '') {
          inner.out += '\n';
          return { code: 1, out: inner.out, err: inner.err };
        }
        const end = input.indexOf('\n');
        const line = end < 0 ? input : input.slice(0, end);
        input = end < 0 ? '' : input.slice(end + 1);
        setVariable('REPLY', line);
        if (line === '') {
          showMenu = true;
          continue;
        }
        showMenu = false;
        const index = /^[0-9]+$/.test(line) ? Number(line) : 0;
        setVariable(node.name, index >= 1 && index <= items.length ? items[index - 1] : '');
        vars.set('LINENO', String(node.line));
        try {
          code = await runSequence(node.body, input, inner);
        } catch (err) {
          if (!(err instanceof LoopSignal)) throw err;
          if (err.levels > 1) throw new LoopSignal(err.kind, err.levels - 1);
          code = 0;
          if (err.kind === 'break') break;
        }
      }
    } finally {
      loopDepth--;
    }
    return { code, out: inner.out, err: inner.err };
  }

  async function runWhile(node, stdin, sink) {
    const inner = sink;
    let code = 0;
    loopDepth++;
    try {
      for (;;) {
        await yieldTurn();
        const status = await suspendErrexit(() => runSequence(node.cond, stdin, inner));
        if ((status === 0) === node.negate) break;
        try {
          code = await runSequence(node.body, stdin, inner);
        } catch (err) {
          if (!(err instanceof LoopSignal)) throw err;
          if (err.levels > 1) throw new LoopSignal(err.kind, err.levels - 1);
          code = 0;
          if (err.kind === 'break') break;
        }
      }
    } finally {
      loopDepth--;
    }
    return { code, out: inner.out, err: inner.err };
  }

  async function callFunction(body, args, stdin, signal, stream) {
    const savedPositional = positional;
    positional = args;
    frames.push(new Map());
    const bodySink = { out: '', err: '', signal, stream: stream ?? { text: stdin, pos: 0 } };
    let result;
    try {
      result = body.type === 'subshell' ? await runSubshell(body, stdin, bodySink) : await runGroup(body, stdin, bodySink);
    } catch (err) {
      if (err instanceof ShellExit) {
        err.output = { out: bodySink.out, err: bodySink.err };
        throw err;
      }
      if (!(err instanceof ReturnSignal)) throw err;
      result = { code: err.code, out: bodySink.out, err: bodySink.err };
    } finally {
      frames.pop();
      settleLocale();
      positional = savedPositional;
    }
    return result;
  }

  const runArithmeticCommand = (node) => {
    try {
      const value = evaluateArithmetic(node.src, (name) => variableValue(name) ?? '', setVariable);
      return { code: value === 0 ? 1 : 0, out: '', err: '' };
    } catch (error) {
      return { code: 1, out: '', err: error.message + '\n' };
    }
  };

  async function runStage(cmd, stdin, sink, stream) {
    if (cmd.type === 'arith') return withRedirects(cmd, stdin, sink, runArithmeticCommand, stream);
    if (cmd.type === 'funcdef') {
      functions.set(cmd.name, cmd.body);
      return ok('');
    }
    if (cmd.type === 'subshell') return withRedirects(cmd, stdin, sink, runSubshell, stream);
    if (cmd.type === 'group') return withRedirects(cmd, stdin, sink, runGroup, stream);
    if (cmd.type === 'if') return withRedirects(cmd, stdin, sink, runIf, stream);
    if (cmd.type === 'for') return withRedirects(cmd, stdin, sink, runFor, stream);
    if (cmd.type === 'select') return withRedirects(cmd, stdin, sink, runSelect, stream);
    if (cmd.type === 'while') return withRedirects(cmd, stdin, sink, runWhile, stream);
    if (cmd.type === 'case') return withRedirects(cmd, stdin, sink, runCase, stream);
    if (cmd.type === 'cond') return withRedirects(cmd, stdin, sink, runConditional, stream);
    return runSimple(cmd, stdin, sink, stream);
  }

  async function runPipeline(pipe, stdin, sink) {
    let input = stdin;
    let inputBytes = null;
    let code = 0;
    const saved = pipe.cmds.length > 1 ? { cwd: state.cwd, vars: new Map(vars) } : null;
    try {
      for (let i = 0; i < pipe.cmds.length; i++) {
        const cmd = pipe.cmds[i];
        const last = i === pipe.cmds.length - 1;
        const stream = i === 0 ? (sink.stream ??= { text: input, pos: 0 }) : { text: input, pos: 0, bytes: inputBytes };
        let result;
        try {
          result = await runStage(cmd, input, sink, stream);
        } catch (err) {
          if (err instanceof ShellExit && err.output && pipe.cmds.length > 1) {
            result = { code: err.code, out: err.output.out, err: err.output.err };
          } else {
            if (err && typeof err === 'object' && err.output) {
              const partial = err.output;
              delete err.output;
              sink.err += partial.err;
              if (last) sink.out += partial.out;
            }
            throw err;
          }
        }
        code = result.code;
        if (cmd.mergeStderr) {
          result.out += result.err;
          result.err = '';
        }
        sink.err += result.err;
        const text = result.out || (result.bytes ? new TextDecoder().decode(result.bytes) : '');
        if (last) {
          sink.out += text;
          if (result.bytes) sink.bytes = sink.bytes ? tarConcat([sink.bytes, result.bytes]) : result.bytes;
        } else {
          input = text;
          inputBytes = result.bytes ?? null;
        }
      }
    } finally {
      if (saved) {
        state.cwd = saved.cwd;
        vars.clear();
        for (const [name, value] of saved.vars) vars.set(name, value);
        settleLocale();
      }
    }
    return pipe.negate ? (code === 0 ? 1 : 0) : code;
  }

  async function suspendErrexit(work) {
    errexitSuspended++;
    try {
      return await work();
    } finally {
      errexitSuspended--;
    }
  }

  async function runSequence(list, stdin, sink) {
    let status = 0;
    for (let i = 0; i < list.items.length; i++) {
      const { op, pipe, background } = list.items[i];
      if (sink.signal?.aborted) throw sink.signal.reason;
      if (op === '&&' && status !== 0) continue;
      if (op === '||' && status === 0) continue;
      if (background) {
        startJob(pipe, stdin);
        status = 0;
        state.status = 0;
        continue;
      }
      const guarded = list.items[i + 1]?.op === '&&' || list.items[i + 1]?.op === '||';
      status = guarded ? await suspendErrexit(() => runPipeline(pipe, stdin, sink)) : await runPipeline(pipe, stdin, sink);
      state.status = status;
      if (status !== 0 && errexit && !guarded && errexitSuspended === 0) throw new ShellExit(status);
    }
    return status;
  }

  const toolContext = (stdin) => ({ host, cwd: state.cwd, stdin: stdin ?? '', resolve: resolvePath, format: formatPrintf });

  const stopJobs = async () => {
    const running = [...jobs.values()].filter((job) => !job.done);
    for (const job of running) job.control.abort(new Signalled(SIGNALS.HUP));
    await Promise.all(running.map((job) => job.promise));
    jobs.clear();
  };

  return {
    async run(script, { signal, timeoutMs = COMMAND_TIMEOUT_MS } = {}) {
      const control = new AbortController();
      const sink = { out: '', err: '', signal: control.signal };
      const cancel = () => control.abort(new Cancelled());
      if (signal?.aborted) cancel();
      else signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(() => control.abort(new TimedOut()), timeoutMs);
      runSink = sink;
      let code;
      try {
        const parsed = parseScriptPartial(script);
        code = await runSequence(parsed.list, '', sink);
        if (parsed.error) {
          code = 2;
          sink.err += syntaxReport(parsed.error, script);
        }
      } catch (err) {
        if (err instanceof ShellExit) code = err.code;
        else if (control.signal.aborted && control.signal.reason instanceof TimedOut) {
          code = 124;
          sink.err += 'timeout: command timed out\n';
        } else if (control.signal.aborted) {
          code = 130;
          sink.err += 'cancelled\n';
        } else {
          code = 2;
          sink.err += `${err.message}\n`;
        }
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
      }
      await stopJobs();
      runSink = null;
      state.status = code;
      return { ok: code === 0, exitCode: code, signal: null, stdout: sink.out, stderr: sink.err, output: sink.out + sink.err, bytes: sink.bytes ?? null };
    },
    async command(argv, stdin = '') {
      try {
        const { code, out, err } = await dispatch(argv, stdin, undefined, null);
        return { code, out, err };
      } catch (err) {
        return { code: 2, out: '', err: `${err.message}\n` };
      }
    },
    cwd: () => state.cwd,
    snapshot: () => ({ cwd: state.cwd, status: state.status, vars: [...vars], exported: [...exported], modes: [...modes], functions: [...functions], nextPid, lastPid, errexit, xtrace }),
  };
}
