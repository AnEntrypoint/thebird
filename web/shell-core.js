import { runSed } from './shell-sed.js';
import { runTar } from './shell-tar.js';
import { runJq } from './shell-jq.js';
import { runAwk } from './shell-awk.js';

export const COMMAND_TIMEOUT_MS = 900000;

const BREAKS = new Set([' ', '\t', '\r', '\n', ';', '&', '|', '<', '>', '(', ')']);
const OPERATORS = ['2>>', '2>&1', '2>', '&>>', '&>', '&&', '||', ';;', '>>', '>', '<<<', '<<', '<', '|', '(', ')', ';', '&'];
const REDIRECTS = new Set(['>', '>>', '<', '<<', '<<<', '&>', '&>>', '2>', '2>>', '2>&1']);
const OUTPUT_REDIRECTS = new Set(['>', '>>', '&>', '&>>', '2>', '2>>']);
const ESCAPES = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', e: '\x1b', '\\': '\\', '"': '"', "'": "'" };
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=/;
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

function unterminated(what) {
  return syntaxError(`unterminated ${what}`);
}

function skipDoubleQuote(src, start) {
  for (let j = start + 1; j < src.length; j++) {
    if (src[j] === '\\') j++;
    else if (src[j] === '"') return j;
  }
  throw unterminated('double quote');
}

function matchParen(src, start) {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') i++;
    else if (c === "'") {
      const end = src.indexOf("'", i + 1);
      if (end < 0) throw unterminated('single quote');
      i = end;
    } else if (c === '"') i = skipDoubleQuote(src, i);
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  throw unterminated('command substitution');
}

const SHELL_USER = 'user';
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
  const m = /^(#)?([A-Za-z_][A-Za-z0-9_]*|[0-9]|[?#@*$!])(?:(:?[-+=?])(.*))?$/s.exec(text);
  if (!m) throw syntaxError(`bad substitution ${text}`);
  if (m[1]) return { k: 'len', name: m[2] };
  return { k: 'param', name: m[2], op: m[3] ?? null, word: readParts(m[4] ?? '', 0, new Set()).parts };
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
    if (close < 0) throw unterminated('parameter expansion');
    return { part: parameterPart(src.slice(i + 2, close)), end: close + 1 };
  }
  if (next !== undefined && /[?#@*$!0-9]/.test(next)) return { part: { k: 'param', name: next, op: null, word: [] }, end: i + 2 };
  const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i + 1));
  if (name) return { part: { k: 'param', name: name[0], op: null, word: [] }, end: i + 1 + name[0].length };
  return { part: { k: 'sq', s: '$' }, end: i + 1 };
}

function readDouble(src, i) {
  const parts = [];
  let lit = '';
  let j = i + 1;
  while (src[j] !== '"') {
    if (j >= src.length) throw unterminated('double quote');
    const c = src[j];
    if (c === '\\' && '$`"\\\n'.includes(src[j + 1])) {
      lit += src[j + 1];
      j += 2;
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
      if (end < 0) throw unterminated('single quote');
      parts.push({ k: 'sq', s: src.slice(i + 1, end) });
      i = end + 1;
    } else if (c === '"') {
      flush();
      const r = readDouble(src, i);
      parts.push(r.part);
      i = r.end;
    } else if (c === '\\') {
      flush();
      parts.push({ k: 'sq', s: src[i + 1] ?? '' });
      i += 2;
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
    if (c === '\\' && '$`\\'.includes(text[i + 1] ?? '')) {
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
    if (line === doc.delim) break;
    lines.push(line);
  }
  const text = lines.map((line) => line + '\n').join('');
  doc.token.body = doc.quoted ? [{ k: 'sq', s: text }] : readBodyParts(text);
  return i;
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
      tokens.push({ op: ';', line: lineAt(i) });
      i++;
      while (heredocs.length) i = readHeredocBody(src, i, heredocs.shift());
    } else if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
    } else {
      const op = OPERATORS.find((candidate) => src.startsWith(candidate, i));
      if (op) {
        const opToken = { op, line: lineAt(i) };
        tokens.push(opToken);
        i += op.length;
        if (op === '<<') {
          while (src[i] === ' ' || src[i] === '\t') i++;
          const word = readParts(src, i, BREAKS);
          tokens.push({ parts: word.parts, line: lineAt(i) });
          heredocs.push({ token: opToken, delim: word.parts.map(textOf).join(''), quoted: word.parts.some(isQuoted) });
          i = word.end;
        }
      } else {
        const word = readParts(src, i, BREAKS);
        tokens.push({ parts: word.parts, text: src.slice(i, word.end), line: lineAt(i), endLine: lineAt(word.end) });
        i = word.end;
      }
    }
  }
  return tokens;
}

const isWord = (token, text) => token?.parts?.length === 1 && token.parts[0].k === 'lit' && token.parts[0].s === text;

const isAssignment = (parts) => parts[0]?.k === 'lit' && ASSIGNMENT.test(parts[0].s);

function parseAssignment(parts) {
  const [, name] = ASSIGNMENT.exec(parts[0].s);
  const rest = parts[0].s.slice(name.length + 1);
  return { name, value: rest ? [{ k: 'lit', s: rest }, ...parts.slice(1)] : parts.slice(1) };
}

function parse(tokens) {
  let pos = 0;

  const parseRedirect = () => {
    const opToken = tokens[pos++];
    const { op } = opToken;
    if (op === '2>&1') return { op };
    const target = tokens[pos];
    if (!target?.parts) throw syntaxError(`expected a file after '${op}'`);
    pos++;
    return { op, target: target.parts, body: opToken.body };
  };

  const parseSimple = () => {
    const first = tokens[pos];
    const line = first?.endLine ?? first?.line;
    const assigns = [];
    const words = [];
    const redirects = [];
    while (pos < tokens.length) {
      const token = tokens[pos];
      if (token.parts && !words.length && isAssignment(token.parts)) {
        assigns.push(parseAssignment(token.parts));
        pos++;
      } else if (token.parts) {
        words.push(token.parts);
        pos++;
      } else if (REDIRECTS.has(token.op)) redirects.push(parseRedirect());
      else break;
    }
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

  const parseIf = () => {
    const branches = [];
    let elseBody = null;
    for (;;) {
      const cond = parseSequence(['then']);
      expectWord('then');
      branches.push({ cond, body: parseSequence(['elif', 'else', 'fi']) });
      if (isWord(tokens[pos], 'elif')) {
        pos++;
        continue;
      }
      if (isWord(tokens[pos], 'else')) {
        pos++;
        elseBody = parseSequence(['fi']);
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
    const body = parseSequence(['done']);
    expectWord('done');
    return { type: 'for', name, words, wordText, body, line, redirects: parseTrailingRedirects() };
  };

  const parseWhile = (negate) => {
    const cond = parseSequence(['do']);
    expectWord('do');
    const body = parseSequence(['done']);
    expectWord('done');
    return { type: 'while', negate, cond, body, redirects: parseTrailingRedirects() };
  };

  const parseCase = () => {
    const word = tokens[pos];
    if (!word?.parts) throw syntaxError("expected a word after 'case'");
    pos++;
    expectWord('in');
    const arms = [];
    while (pos < tokens.length && !isWord(tokens[pos], 'esac')) {
      if (tokens[pos].op === '(') pos++;
      const patterns = [];
      for (;;) {
        const token = tokens[pos];
        if (!token?.parts) throw syntaxError('expected a pattern');
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

  const parseCommand = () => {
    const token = tokens[pos];
    if (!token) throw syntaxError('unexpected end of input');
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
    if (token.op === '(') {
      pos++;
      const list = parseSequence([]);
      if (tokens[pos]?.op !== ')') throw syntaxError("expected ')'");
      pos++;
      return { type: 'subshell', list, redirects: parseTrailingRedirects() };
    }
    if (isWord(token, '{')) {
      pos++;
      const list = parseSequence(['}']);
      if (!isWord(tokens[pos], '}')) throw syntaxError("expected '}'");
      pos++;
      return { type: 'group', list, redirects: parseTrailingRedirects() };
    }
    if (token.op !== undefined) throw syntaxError(`unexpected '${token.op}'`);
    if (token.parts.length === 1 && token.parts[0].k === 'lit' && tokens[pos + 1]?.op === '(' && tokens[pos + 2]?.op === ')') {
      pos += 3;
      while (tokens[pos]?.op === ';') pos++;
      const body = parseCommand();
      if (body.type !== 'group' && body.type !== 'subshell') throw syntaxError('a function body must be a group or a subshell');
      return { type: 'funcdef', name: token.parts[0].s, body };
    }
    return parseSimple();
  };

  const parsePipeline = () => {
    const cmds = [parseCommand()];
    while (tokens[pos]?.op === '|') {
      pos++;
      cmds.push(parseCommand());
    }
    return { cmds };
  };

  const atCloser = (stops) => tokens[pos].op === ')' || tokens[pos].op === ';;' || stops.some((word) => isWord(tokens[pos], word));

  const parseSequence = (stops) => {
    const items = [];
    let op = null;
    while (pos < tokens.length && !atCloser(stops)) {
      if (tokens[pos].op === ';') {
        pos++;
        continue;
      }
      items.push({ op, pipe: parsePipeline(), background: false });
      const next = tokens[pos];
      if (next?.op === '&') {
        pos++;
        items.at(-1).background = true;
        op = ';';
      } else if (next?.op === ';') {
        pos++;
        op = ';';
      } else if (next?.op === '&&' || next?.op === '||') {
        pos++;
        op = next.op;
      } else break;
    }
    return { items };
  };

  const list = parseSequence([]);
  if (pos < tokens.length) throw syntaxError(`unexpected '${tokens[pos].op}'`);
  return list;
}

export function parseScript(src, firstLine, substitution = false) {
  return parse(tokenize(src, firstLine, substitution));
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
const equivalenceBase = (letter) => {
  const folded = letter.toLowerCase();
  return STROKED_BASE[folded] ?? Array.from(folded.normalize('NFD'))[0];
};
const equivalenceClasses = new Map();
const equivalenceItems = (letter) => {
  const base = equivalenceBase(letter);
  if (!equivalenceClasses.has(base)) {
    const members = new Set([base, base.toUpperCase()].filter((member) => Array.from(member).length === 1));
    for (const [start, end] of [[0xc0, 0x24f], [0x1e00, 0x1eff]]) {
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
  if (kind === '=' && symbol.length !== 1) throw new ExprFailure('Invalid collation character');
  if (kind === '.' && symbol.length !== 1) throw new ExprFailure('equivalence classes and collating symbols are not supported');
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

function exprEval(argv) {
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
    const points = Array.from(text);
    for (let i = 0; i < points.length; i++) if (chars.includes(points[i])) return String(i + 1);
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
    if (token === 'length') return String(Array.from(take()).length);
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
  return text.replace(/%([sd%])/g, (match, spec) => {
    if (spec === '%') return '%';
    const value = args[index++] ?? '';
    return spec === 'd' ? String(parseInt(value, 10) || 0) : value;
  });
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

export function evaluateArithmetic(src, lookup) {
  const compact = src.replace(/\s+/g, '');
  const tokens = compact.match(/\d+|[A-Za-z_]\w*|<=|>=|==|!=|&&|\|\||[-+*/%<>()!]/g) ?? [];
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
    if (/^\d+$/.test(token)) return Number(token);
    if (/^[A-Za-z_]/.test(token)) return Number(lookup(token)) || 0;
    throw new Error(`arithmetic: unexpected '${token}'`);
  };

  const unary = () => {
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

  const value = binary(0);
  if (pos < tokens.length) throw new Error(`arithmetic: unexpected '${tokens[pos]}'`);
  return value;
}

export function createShell({ host, cwd = '/workspace', builtins = [], saved = null } = {}) {
  const state = { cwd: saved?.cwd ?? cwd, status: saved?.status ?? 0 };
  const vars = new Map(saved?.vars ?? []);
  const exported = new Set(saved?.exported ?? []);
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
  const functions = new Map(saved?.functions ?? []);
  const inPage = new Set(builtins);
  const jobs = new Map();
  let nextPid = saved?.nextPid ?? SHELL_PID + 1;
  let lastPid = saved?.lastPid ?? null;
  let runSink = null;
  const frames = [];
  let positional = [];
  let loopDepth = 0;

  const statInfo = (path) => {
    const link = host.lstat(path);
    if (!link && !host.stat(path)) return null;
    if (link?.link) return { type: 'symbolic link', size: link.size ?? 0, mode: modes.get(path) ?? '777' };
    const info = host.stat(path);
    const dir = info?.dir === true;
    return { type: dir ? 'directory' : 'regular file', size: info?.size ?? 0, mode: modes.get(path) ?? (dir ? '755' : '644') };
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

  const expandStat = (format, name, info) => format.replace(/%(.)/g, (whole, code) => {
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
    const entries = new Map([...exported].filter((name) => vars.has(name)).map((name) => [name, vars.get(name)]));
    for (const [name, value] of extra) entries.set(name, value);
    return [...entries].sort(byName).map(([name, value]) => name + '=' + value + '\n').join('');
  };

  const resolvePath = (name) => normalize(name.startsWith('/') ? name : state.cwd + '/' + name);

  const loopControl = (kind, argv) => {
    if (loopDepth === 0) return { code: 0, out: '', err: `${kind}: only meaningful in a loop\n` };
    throw new LoopSignal(kind, Math.min(Number(argv[0] ?? 1) || 1, loopDepth));
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
      if (!argv.length) return { code: 1, out: '', err: 'touch: missing file operand\n' };
      let err = '';
      let code = 0;
      for (const name of argv) {
        const path = resolvePath(name);
        if (host.exists(path)) continue;
        if (!host.stat(parentOf(path))?.dir) {
          err += "touch: cannot touch '" + name + "': No such file or directory\n";
          code = 1;
        } else host.write(path, '');
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
        const prior = append && host.exists(path) ? host.read(path) : '';
        host.write(path, prior + (stdin ?? ''));
      }
      return { code, out: stdin ?? '', err };
    },
    head: ({ argv, stdin = '' }) => {
      const { flags, operands } = argsOf(argv, ['-n']);
      const count = Number(flags.get('-n') ?? 10);
      if (!Number.isInteger(count)) return { code: 1, out: '', err: 'head: invalid number of lines\n' };
      const input = textInputs('head', operands, stdin);
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
      const { flags, operands } = argsOf(argv, []);
      const input = textInputs('sort', operands, stdin);
      const compare = flags.has('-n') ? (a, b) => (Number.parseFloat(a) || 0) - (Number.parseFloat(b) || 0) : (a, b) => (a < b ? -1 : a > b ? 1 : 0);
      let lines = linesOf(input.text).sort(compare);
      if (flags.has('-r')) lines.reverse();
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
      const out = groups.map(({ line, count }) => (flags.has('-c') ? String(count).padStart(7) + ' ' : '') + line + '\n').join('');
      return { code: input.code, out, err: input.err };
    },
    cut: ({ argv, stdin = '' }) => {
      const { flags, operands } = argsOf(argv, ['-d', '-f']);
      if (!flags.has('-f')) return { code: 1, out: '', err: 'cut: you must specify the list of fields\n' };
      const delim = flags.get('-d') ?? '\t';
      const picks = fieldPicks(flags.get('-f'));
      if (picks.some(([from, to]) => !(from >= 1) || Number.isNaN(to))) return { code: 1, out: '', err: 'cut: fields are numbered from 1\n' };
      const input = textInputs('cut', operands, stdin);
      const out = joinLines(linesOf(input.text).map((line) => {
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
    find: ({ argv }) => {
      let i = 0;
      const roots = [];
      while (i < argv.length && !argv[i].startsWith('-')) roots.push(argv[i++]);
      if (!roots.length) roots.push('.');
      const predicates = [];
      for (; i < argv.length; i += 2) {
        const [flag, value] = [argv[i], argv[i + 1] ?? ''];
        if (flag === '-name') predicates.push((name) => globRegExp(value).test(name));
        else if (flag === '-iname') predicates.push((name) => globRegExp(value, true).test(name));
        else if (flag === '-type') predicates.push((_name, info) => (value === 'd' ? info.dir : !info.dir));
        else throw new Error(`find: unknown predicate '${flag}'`);
      }
      let out = '';
      let err = '';
      let code = 0;
      const visit = (display, path) => {
        const info = host.stat(path);
        if (!info) return;
        const base = display.slice(display.lastIndexOf('/') + 1) || display;
        if (predicates.every((test) => test(base, info))) out += display + '\n';
        if (info.dir) {
          for (const entry of host.list(path).sort()) visit(`${display.replace(/\/$/, '')}/${entry}`, `${path === '/' ? '' : path}/${entry}`);
        }
      };
      for (const root of roots) {
        const path = resolvePath(root);
        if (!host.stat(path)) {
          err += `find: '${root}': No such file or directory\n`;
          code = 1;
        } else visit(root, path);
      }
      return { code, out, err };
    },
    wc: ({ argv, stdin = '' }) => {
      const flags = argv.filter((arg) => arg.startsWith('-')).join('');
      const files = argv.filter((arg) => !arg.startsWith('-'));
      const selected = (counts) => {
        const pick = [];
        if (!flags || flags.includes('l')) pick.push(counts.lines);
        if (!flags || flags.includes('w')) pick.push(counts.words);
        if (!flags || flags.includes('c')) pick.push(counts.chars);
        return pick.join(' ');
      };
      const counts = (text) => ({ lines: (text.match(/\n/g) ?? []).length, words: text.split(/\s+/).filter(Boolean).length, chars: text.length });
      if (!files.length) return ok(selected(counts(stdin)) + '\n');
      let out = '';
      let err = '';
      let code = 0;
      for (const name of files) {
        try {
          out += `${selected(counts(host.read(resolvePath(name))))} ${name}\n`;
        } catch {
          err += `wc: ${name}: No such file or directory\n`;
          code = 1;
        }
      }
      return { code, out, err };
    },
    date: ({ argv }) => {
      const now = new Date();
      if (!argv[0]?.startsWith('+')) return ok(now.toUTCString() + '\n');
      const pad = (value, width = 2) => String(value).padStart(width, '0');
      const text = argv[0].slice(1).replace(/%([sNYmdHMS%])/g, (match, spec) => {
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
      if (!files.length) {
        const result = scan('', stdin);
        return { code: result.count ? 0 : 1, out: result.out, err: '' };
      }
      const labelled = files.length > 1;
      let out = '';
      let err = '';
      let code = 1;
      let matched = 0;
      for (const name of files) {
        let text;
        try {
          text = host.read(resolvePath(name));
        } catch {
          err += `grep: ${name}: No such file or directory\n`;
          code = 2;
          continue;
        }
        const result = scan(labelled ? name + ':' : '', text);
        matched += result.count;
        out += result.out;
      }
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
          texts.push(host.read(resolvePath(name)));
        } catch {
          err += 'diff: ' + name + ': No such file or directory\n';
        }
      }
      if (err) return { code: 2, out: '', err };
      const headers = [labels[0] ?? names[0], labels[1] ?? names[1]];
      const out = mode === 'unified' ? unifiedDiff(linesOf(texts[0]), linesOf(texts[1]), width, headers) : mode === 'context' ? contextDiff(linesOf(texts[0]), linesOf(texts[1]), width, headers) : lineDiff(linesOf(texts[0]), linesOf(texts[1]));
      return { code: out ? 1 : 0, out, err: '' };
    },
    expr: ({ argv }) => exprEval(argv),
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
    md5sum: ({ argv, stdin = '' }) => {
      const names = argv.filter((arg) => !arg.startsWith('-'));
      if (!names.length) return ok(md5Hex(utf8Bytes(stdin)) + '  -\n');
      let out = '';
      let err = '';
      let code = 0;
      for (const name of names) {
        if (name === '-') {
          out += md5Hex(utf8Bytes(stdin)) + '  -\n';
          continue;
        }
        try {
          out += md5Hex(utf8Bytes(host.read(resolvePath(name)))) + '  ' + name + '\n';
        } catch {
          err += 'md5sum: ' + name + ': No such file or directory\n';
          code = 1;
        }
      }
      return { code, out, err };
    },
    realpath: ({ argv }) => {
      let out = '';
      let err = '';
      let code = 0;
      for (const name of argv.filter((arg) => !arg.startsWith('-'))) {
        const path = resolvePath(name);
        if (!host.lstat(path) && !host.stat(path)) {
          err += 'realpath: ' + name + ': No such file or directory\n';
          code = 1;
          continue;
        }
        const resolved = realPath(path);
        if (resolved === null) {
          err += 'realpath: ' + name + ': Too many levels of symbolic links\n';
          code = 1;
        } else out += resolved + '\n';
      }
      return { code, out, err };
    },
    chmod: ({ argv }) => {
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
      if (referenceFile !== null && !statInfo(resolvePath(referenceFile))) return { code: 1, out: '', err: "chmod: failed to get attributes of '" + referenceFile + "': No such file or directory\n" };
      const positional = operands.filter((arg) => !/^(-[Rvch]+|--recursive|--verbose|--changes|--dereference|--no-dereference)$/.test(arg));
      const mode = referenceFile === null ? positional[0] : undefined;
      const names = referenceFile === null ? positional.slice(1) : positional;
      const referenceBits = referenceFile === null ? null : parseInt(modes.get(resolvePath(referenceFile)) ?? (host.stat(resolvePath(referenceFile))?.dir === true ? '755' : '644'), 8);
      const usage = "Try 'chmod --help' for more information.\n";
      if (referenceFile !== null ? !names.length : mode === undefined) return { code: 1, out: '', err: 'chmod: missing operand\n' + usage };
      if (!names.length) return { code: 1, out: '', err: "chmod: missing operand after '" + mode + "'\n" + usage };
      const octal = mode !== undefined && /^[0-7]{1,4}$/.test(mode);
      if (mode !== undefined && !octal && applySymbolicMode(0, mode, false).error) return { code: 1, out: '', err: "chmod: invalid mode: '" + mode + "'\n" + usage };
      const ownerBits = (path) => (parseInt(modes.get(path) ?? '755', 8) >> 6) & 7;
      const searchedDirectories = (path, followLast = true, depth = 0) => {
        const parts = path.split('/').filter((part) => part !== '' && part !== '.');
        const searched = [];
        let current = '/';
        for (let i = 0; i < parts.length; i++) {
          searched.push(current);
          if (parts[i] === '..') {
            current = parentOf(current);
            continue;
          }
          const candidate = (current === '/' ? '' : current) + '/' + parts[i];
          if (host.lstat(candidate)?.link && depth < 40 && (followLast || i < parts.length - 1)) {
            const target = host.readlink(candidate);
            const inner = searchedDirectories(target.startsWith('/') ? target : (current === '/' ? '' : current) + '/' + target, true, depth + 1);
            searched.push(...inner.searched);
            current = inner.real;
          } else current = candidate;
        }
        return { real: current, searched };
      };
      const blockedAncestor = (path) => searchedDirectories(path).searched.some((dir) => !(ownerBits(dir) & 1));
      const changeOne = (path) => {
        const dir = host.stat(path)?.dir === true;
        const before = parseInt(modes.get(path) ?? (dir ? '755' : '644'), 8);
        const after = referenceBits ?? (octal ? parseInt(mode, 8) : applySymbolicMode(before, mode, dir).bits);
        modes.set(path, formatMode(after));
        return { before, after };
      };
      const report = (shown, before, after) => {
        if (before !== after) return verbose || changes ? "mode of '" + shown + "' changed from " + octalModeText(before) + ' to ' + octalModeText(after) + '\n' : '';
        return verbose ? "mode of '" + shown + "' retained as " + octalModeText(after) + '\n' : '';
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
          err += "chmod: cannot read directory '" + shown + "': Permission denied\n";
          code = 1;
          if (verbose) out += "'" + shown + "' could not be accessed\n";
          return;
        }
        const searchable = ownerBits(path) & 1;
        for (const entry of host.list(path).sort()) {
          const child = (path === '/' ? '' : path) + '/' + entry;
          if (!searchable) {
            err += "chmod: cannot access '" + shown + '/' + entry + "': Permission denied\n";
            code = 1;
            if (verbose) out += "'" + shown + '/' + entry + "' could not be accessed\n";
          } else if (host.lstat(child)?.link && dereference && blockedAncestor(child)) {
            err += "chmod: cannot dereference '" + shown + '/' + entry + "': Permission denied\n";
            code = 1;
            if (verbose) out += "'" + shown + '/' + entry + "' could not be accessed\n";
          } else if (host.lstat(child)?.link && dereference && !statInfo(referentOf(child))) {
            err += "chmod: cannot dereference '" + shown + '/' + entry + "': No such file or directory\n";
            code = 1;
            if (verbose) out += "'" + shown + '/' + entry + "' could not be accessed\n";
          } else if (host.lstat(child)?.link && !dereference) {
            if (verbose) out += "neither symbolic link '" + shown + '/' + entry + "' nor referent has been changed\n";
          } else visit(referentOf(child), shown + '/' + entry);
        }
      };
      for (const name of names) {
        const rawPath = name.startsWith('/') ? name : state.cwd + '/' + name;
        const walk = searchedDirectories(rawPath, true);
        const named = searchedDirectories(rawPath, false).real;
        if (walk.searched.some((dir) => !(ownerBits(dir) & 1))) {
          if (verbose) out += "'" + name + "' could not be accessed\n";
          err += "chmod: cannot access '" + name + "': Permission denied\n";
          code = 1;
        } else if (noDereference && host.lstat(named)?.link) {
          if (verbose) out += "neither symbolic link '" + name + "' nor referent has been changed\n";
        } else if (!statInfo(walk.real)) {
          if (verbose) out += "'" + name + "' could not be accessed\n";
          err += host.lstat(named)?.link ? "chmod: cannot operate on dangling symlink '" + name + "'\n" : "chmod: cannot access '" + name + "': No such file or directory\n";
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
      const names = flagAt >= 0 ? argv.filter((arg, i) => i !== flagAt && i !== flagAt + 1) : argv;
      if (!names.length) return { code: 1, out: '', err: 'stat: missing operand\n' };
      let out = '';
      let err = '';
      let code = 0;
      for (const name of names) {
        const info = statInfo(resolvePath(name));
        if (!info) {
          err += "stat: cannot statx '" + name + "': No such file or directory\n";
          code = 1;
        } else if (format === null) out += '  File: ' + name + '\n  Size: ' + info.size + '\n  Type: ' + info.type + '\n';
        else out += expandStat(format, name, info) + '\n';
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
      if (at === argv.length) return ok(environmentLines(assigns));
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
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) exported.add(name);
      }
      return ok('');
    },
    local: ({ argv }) => {
      const frame = frames.at(-1);
      for (const arg of argv) {
        const eq = arg.indexOf('=');
        const name = eq < 0 ? arg : arg.slice(0, eq);
        frame?.set(name, eq < 0 ? '' : arg.slice(eq + 1));
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
    test: ({ argv }) => ({ code: evaluateTest(argv) ? 0 : 1, out: '', err: '' }),
    '[': ({ argv }) => {
      if (argv.at(-1) !== ']') return { code: 2, out: '', err: "[: missing ']'\n" };
      return { code: evaluateTest(argv.slice(0, -1)) ? 0 : 1, out: '', err: '' };
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
          out += host.read(resolvePath(name));
        } catch {
          err += `cat: ${name}: No such file or directory\n`;
          code = 1;
        }
      }
      return { code, out, err };
    },
    tr({ argv, stdin = '' }) {
      const from = expandSet(argv[0] ?? '');
      const to = expandSet(argv[1] ?? '');
      let out = '';
      for (const c of stdin) {
        const index = from.indexOf(c);
        out += index < 0 ? c : to[Math.min(index, to.length - 1)];
      }
      return ok(out);
    },
    sed: ({ argv, stdin }) => runSed(argv, toolContext(stdin)),
    tar: ({ argv, stdin }) => runTar(argv, toolContext(stdin)),
    jq: ({ argv, stdin }) => runJq(argv, toolContext(stdin)),
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
      throw new Error(`test: ${op}: unary operator not supported`);
    }
    if (args.length === 3) {
      const [a, op, b] = args;
      if (op === '=' || op === '==') return a === b;
      if (op === '!=') return a !== b;
      const numeric = { '-eq': (x, y) => x === y, '-ne': (x, y) => x !== y, '-lt': (x, y) => x < y, '-gt': (x, y) => x > y, '-le': (x, y) => x <= y, '-ge': (x, y) => x >= y };
      if (numeric[op]) return numeric[op](Number(a), Number(b));
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
      return;
    }
    vars.delete(name);
    exported.delete(name);
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

  const setVariable = (name, value) => {
    const frame = frames.at(-1);
    if (frame?.has(name)) frame.set(name, value);
    else vars.set(name, value);
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
      else if (part.k === 'param') add(await parameterText(part, sink), inDouble);
      else if (part.k === 'len') add(String((variableValue(part.name) ?? '').length), inDouble);
      else if (part.k === 'cmd') add(await commandText(part.src, sink), inDouble);
      else if (part.k === 'arith') add(String(evaluateArithmetic(part.src, (name) => variableValue(name) ?? '')), inDouble);
      else throw new Error(`${part.k} is not supported yet`);
    }
    return chars;
  }

  async function parameterText(part, sink) {
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
    for (const ch of chars) {
      if (ch.split && /[ \t\n]/.test(ch.c)) {
        if (current.length) fields.push(current);
        current = [];
      } else current.push(ch);
    }
    if (current.length) fields.push(current);
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
    if (!fields.length && parts.some((part) => part.k === 'sq' || part.k === 'dq')) return [''];
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
    for (const { name, value } of node.assigns) assigned.push([name, await expandText(value, sink)]);
    const trace = xtrace ? traceLines(assigned, argv, await tracePrefix(sink)) : '';
    sink.err += trace;
    if (!argv.length) {
      for (const [name, value] of assigned) setVariable(name, value);
      return ok('');
    }
    const saved = new Map(assigned.map(([name]) => [name, vars.get(name)]));
    for (const [name, value] of assigned) setVariable(name, value);
    try {
      return await runCommand(node, argv, stdin, sink, stream);
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) vars.delete(name);
        else setVariable(name, value);
      }
    }
  }

  function writeRedirect(path, text) {
    if (path !== NULL_DEVICE) host.write(path, text);
  }

  async function refuseMissingOutputDir(redirects, sink) {
    for (const redirect of redirects) {
      if (!OUTPUT_REDIRECTS.has(redirect.op)) continue;
      const path = await wordPath(redirect.target, sink);
      if (path !== NULL_DEVICE && host.stat(parentOf(resolvePath(path)))?.dir !== true) return { code: 2, out: '', err: 'thebird: cannot create ' + path + ': Directory nonexistent\n' };
    }
    return null;
  }

  async function withRedirects(node, stdin, sink, run, stream) {
    const refused = await refuseMissingOutputDir(node.redirects, sink);
    if (refused) return refused;
    let input = stdin;
    for (const redirect of node.redirects) {
      if (redirect.op !== '<') continue;
      const path = await wordPath(redirect.target, sink);
      if (path !== NULL_DEVICE && !host.exists(path)) return { code: 2, out: '', err: 'thebird: cannot open ' + path + ': No such file\n' };
      input = path === NULL_DEVICE ? '' : host.read(path);
    }
    const scratch = { out: '', err: '', signal: sink.signal, stream: node.redirects.some((redirect) => redirect.op === '<') ? { text: input, pos: 0 } : stream };
    let result;
    try {
      result = await run(node, input, scratch);
    } catch (err) {
      if (err && typeof err === 'object') err.output = await applyOutputRedirects(node.redirects, scratch.out, scratch.err, sink);
      throw err;
    }
    return { code: result.code, ...(await applyOutputRedirects(node.redirects, result.out, result.err, sink)) };
  }

  async function runCommand(node, argv, stdin, sink, stream) {
    const refused = await refuseMissingOutputDir(node.redirects, sink);
    if (refused) return refused;
    let input = stdin;
    for (const redirect of node.redirects) {
      if (redirect.op === '<<') input = await bodyText(redirect.body, sink);
      else if (redirect.op === '<<<') input = (await expandWord(redirect.target, sink)).join(' ') + '\n';
      else if (redirect.op === '<') {
        try {
          const path = await wordPath(redirect.target, sink);
          input = path === NULL_DEVICE ? '' : host.read(path);
        } catch {
          return { code: 1, out: '', err: `${argv[0]}: no such file\n` };
        }
      }
    }
    const result = await dispatch(argv, input, sink.signal, input === stdin ? stream : { text: input, pos: 0 });
    const applied = await applyOutputRedirects(node.redirects, result.out, result.err, sink);
    return { code: result.code, ...applied };
  }

  async function applyOutputRedirects(redirects, out, err, sink) {
    for (const redirect of redirects) {
      if (redirect.op === '2>&1') {
        out += err;
        err = '';
      } else if (redirect.op === '&>' || redirect.op === '&>>') {
        const path = await wordPath(redirect.target, sink);
        const prior = redirect.op === '&>>' && host.exists(path) ? host.read(path) : '';
        writeRedirect(path, prior + out + err);
        out = '';
        err = '';
      } else if (redirect.op === '>' || redirect.op === '>>') {
        const path = await wordPath(redirect.target, sink);
        const prior = redirect.op === '>>' && host.exists(path) ? host.read(path) : '';
        writeRedirect(path, prior + out);
        out = '';
      } else if (redirect.op === '2>' || redirect.op === '2>>') {
        const path = await wordPath(redirect.target, sink);
        const prior = redirect.op === '2>>' && host.exists(path) ? host.read(path) : '';
        writeRedirect(path, prior + err);
        err = '';
      }
    }
    return { out, err };
  }

  async function runSubshell(node, stdin, sink) {
    const savedCwd = state.cwd;
    const savedVars = new Map(vars);
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
    }
    return { code, out: inner.out, err: inner.err };
  }

  async function runGroup(node, stdin, sink) {
    const inner = sink;
    const code = await runSequence(node.list, stdin, inner);
    return { code, out: inner.out, err: inner.err };
  }

  function textInputs(verb, names, stdin) {
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
        text += host.read(resolvePath(name));
      } catch {
        err += verb + ': ' + name + ': No such file or directory\n';
        code = 1;
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
      host.write(dst, host.read(src));
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
      if (!(err instanceof ReturnSignal)) throw err;
      result = { code: err.code, out: bodySink.out, err: bodySink.err };
    } finally {
      frames.pop();
      positional = savedPositional;
    }
    return result;
  }

  async function runStage(cmd, stdin, sink, stream) {
    if (cmd.type === 'funcdef') {
      functions.set(cmd.name, cmd.body);
      return ok('');
    }
    if (cmd.type === 'subshell') return withRedirects(cmd, stdin, sink, runSubshell, stream);
    if (cmd.type === 'group') return withRedirects(cmd, stdin, sink, runGroup, stream);
    if (cmd.type === 'if') return withRedirects(cmd, stdin, sink, runIf, stream);
    if (cmd.type === 'for') return withRedirects(cmd, stdin, sink, runFor, stream);
    if (cmd.type === 'while') return withRedirects(cmd, stdin, sink, runWhile, stream);
    if (cmd.type === 'case') return withRedirects(cmd, stdin, sink, runCase, stream);
    return runSimple(cmd, stdin, sink, stream);
  }

  async function runPipeline(pipe, stdin, sink) {
    let input = stdin;
    let code = 0;
    const saved = pipe.cmds.length > 1 ? { cwd: state.cwd, vars: new Map(vars) } : null;
    try {
      for (let i = 0; i < pipe.cmds.length; i++) {
        const cmd = pipe.cmds[i];
        const last = i === pipe.cmds.length - 1;
        const stream = i === 0 ? (sink.stream ??= { text: input, pos: 0 }) : { text: input, pos: 0 };
        let result;
        try {
          result = await runStage(cmd, input, sink, stream);
        } catch (err) {
          if (err && typeof err === 'object' && err.output) {
            const partial = err.output;
            delete err.output;
            sink.err += partial.err;
            if (last) sink.out += partial.out;
          }
          throw err;
        }
        code = result.code;
        sink.err += result.err;
        if (last) sink.out += result.out;
        else input = result.out;
      }
    } finally {
      if (saved) {
        state.cwd = saved.cwd;
        vars.clear();
        for (const [name, value] of saved.vars) vars.set(name, value);
      }
    }
    return code;
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
        code = await runSequence(parseScript(script), '', sink);
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
      return { ok: code === 0, exitCode: code, signal: null, stdout: sink.out, stderr: sink.err, output: sink.out + sink.err };
    },
    cwd: () => state.cwd,
    snapshot: () => ({ cwd: state.cwd, status: state.status, vars: [...vars], exported: [...exported], modes: [...modes], functions: [...functions], nextPid, lastPid, errexit, xtrace }),
  };
}
