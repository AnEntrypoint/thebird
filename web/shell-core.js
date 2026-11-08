export const COMMAND_TIMEOUT_MS = 300000;

const BREAKS = new Set([' ', '\t', '\r', '\n', ';', '&', '|', '<', '>', '(', ')']);
const OPERATORS = ['2>>', '2>&1', '2>', '&&', '||', '>>', '>', '<', '|', '(', ')', ';', '&'];
const REDIRECTS = new Set(['>', '>>', '<', '2>', '2>>', '2>&1']);
const ESCAPES = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', e: '\x1b', '\\': '\\', '"': '"', "'": "'" };

class ShellExit {
  constructor(code) {
    this.code = code;
  }
}

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

function parameterPart(text) {
  const m = /^(#)?([A-Za-z_][A-Za-z0-9_]*|[0-9]|[?#@*$!])(?:(:?[-+=?])(.*))?$/s.exec(text);
  if (!m) throw syntaxError(`bad substitution ${text}`);
  if (m[1]) return { k: 'len', name: m[2] };
  return { k: 'param', name: m[2], op: m[3] ?? null, word: m[4] ?? '' };
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
  if (next !== undefined && /[?#@*$!0-9]/.test(next)) return { part: { k: 'param', name: next, op: null, word: '' }, end: i + 2 };
  const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i + 1));
  if (name) return { part: { k: 'param', name: name[0], op: null, word: '' }, end: i + 1 + name[0].length };
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

export function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r') i++;
    else if (c === '\n') {
      tokens.push({ op: ';' });
      i++;
    } else if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
    } else {
      const op = OPERATORS.find((candidate) => src.startsWith(candidate, i));
      if (op) {
        tokens.push({ op });
        i += op.length;
      } else {
        const word = readParts(src, i, BREAKS);
        tokens.push({ parts: word.parts });
        i = word.end;
      }
    }
  }
  return tokens;
}

function parse(tokens) {
  let pos = 0;

  const parseRedirect = () => {
    const { op } = tokens[pos++];
    if (op === '2>&1') return { op };
    const target = tokens[pos];
    if (!target?.parts) throw syntaxError(`expected a file after '${op}'`);
    pos++;
    return { op, target: target.parts };
  };

  const parseSimple = () => {
    const words = [];
    const redirects = [];
    while (pos < tokens.length) {
      const token = tokens[pos];
      if (token.parts) {
        words.push(token.parts);
        pos++;
      } else if (REDIRECTS.has(token.op)) redirects.push(parseRedirect());
      else break;
    }
    if (!words.length && !redirects.length) throw syntaxError(`unexpected '${tokens[pos]?.op ?? 'end of input'}'`);
    return { type: 'simple', words, redirects };
  };

  const parseCommand = () => {
    const token = tokens[pos];
    if (!token) throw syntaxError('unexpected end of input');
    if (token.op === '(') {
      pos++;
      const list = parseSequence();
      if (tokens[pos]?.op !== ')') throw syntaxError("expected ')'");
      pos++;
      const redirects = [];
      while (REDIRECTS.has(tokens[pos]?.op)) redirects.push(parseRedirect());
      return { type: 'subshell', list, redirects };
    }
    if (token.op !== undefined) throw syntaxError(`unexpected '${token.op}'`);
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

  const parseSequence = () => {
    const items = [];
    let op = null;
    while (pos < tokens.length && tokens[pos].op !== ')') {
      if (tokens[pos].op === ';') {
        pos++;
        continue;
      }
      items.push({ op, pipe: parsePipeline() });
      const next = tokens[pos];
      if (next?.op === '&') throw new Error('background jobs are not supported in the in-page shell; run the command in the foreground');
      if (next?.op === ';') {
        pos++;
        op = ';';
      } else if (next?.op === '&&' || next?.op === '||') {
        pos++;
        op = next.op;
      } else break;
    }
    return { items };
  };

  const list = parseSequence();
  if (pos < tokens.length) throw syntaxError(`unexpected '${tokens[pos].op}'`);
  return list;
}

export function parseScript(src) {
  return parse(tokenize(src));
}

const ok = (out) => ({ code: 0, out, err: '' });

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

export function createShell({ host, cwd = '/workspace' } = {}) {
  const state = { cwd, status: 0 };
  const vars = new Map();

  const resolvePath = (name) => normalize(name.startsWith('/') ? name : state.cwd + '/' + name);

  const commands = {
    echo: ({ argv }) => ok(argv.join(' ') + '\n'),
    printf: ({ argv }) => ok(formatPrintf(argv)),
    true: () => ok(''),
    false: () => ({ code: 1, out: '', err: '' }),
    exit: ({ argv }) => {
      throw new ShellExit(Number(argv[0] ?? state.status));
    },
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
  };

  const paramValue = (part) => {
    if (part.name === '?') return String(state.status);
    throw new Error(`$${part.name} is not supported yet`);
  };

  async function expandChars(parts, inDouble) {
    const chars = [];
    const add = (text, quoted) => {
      for (const c of text) chars.push({ c, q: quoted, split: !quoted });
    };
    for (const part of parts) {
      if (part.k === 'lit') add(part.s, false);
      else if (part.k === 'sq') add(part.s, true);
      else if (part.k === 'dq') chars.push(...(await expandChars(part.parts, true)));
      else if (part.k === 'param') add(paramValue(part), inDouble);
      else throw new Error(`${part.k} is not supported yet`);
    }
    return chars;
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

  async function expandWord(parts) {
    const fields = splitFields(await expandChars(parts, false));
    if (!fields.length && parts.some((part) => part.k === 'sq' || part.k === 'dq')) return [''];
    return fields.map((field) => field.map((ch) => ch.c).join(''));
  }

  async function expandWords(words) {
    const argv = [];
    for (const word of words) argv.push(...(await expandWord(word)));
    return argv;
  }

  const wordPath = async (parts) => resolvePath((await expandWord(parts))[0] ?? '');

  async function runSimple(node, stdin) {
    const argv = await expandWords(node.words);
    let input = stdin;
    for (const redirect of node.redirects) {
      if (redirect.op === '<') {
        try {
          input = host.read(await wordPath(redirect.target));
        } catch {
          return { code: 1, out: '', err: `${argv[0] ?? ''}: no such file\n` };
        }
      }
    }
    const name = argv[0];
    if (name === undefined) return ok('');
    if (!Object.hasOwn(commands, name)) return { code: 127, out: '', err: `${name}: command not found\n` };
    const result = await commands[name]({ argv: argv.slice(1), stdin: input });
    let { out, err } = result;
    for (const redirect of node.redirects) {
      if (redirect.op === '2>&1') {
        out += err;
        err = '';
      } else if (redirect.op === '>' || redirect.op === '>>') {
        const path = await wordPath(redirect.target);
        const prior = redirect.op === '>>' && host.exists(path) ? host.read(path) : '';
        host.write(path, prior + out);
        out = '';
      } else if (redirect.op === '2>' || redirect.op === '2>>') {
        const path = await wordPath(redirect.target);
        const prior = redirect.op === '2>>' && host.exists(path) ? host.read(path) : '';
        host.write(path, prior + err);
        err = '';
      }
    }
    return { code: result.code, out, err };
  }

  async function runSubshell(node, stdin) {
    const savedCwd = state.cwd;
    const savedVars = new Map(vars);
    const sink = { out: '', err: '' };
    let code;
    try {
      code = await runSequence(node.list, stdin, sink);
    } catch (err) {
      if (!(err instanceof ShellExit)) throw err;
      code = err.code;
    } finally {
      state.cwd = savedCwd;
      vars.clear();
      for (const [name, value] of savedVars) vars.set(name, value);
    }
    return { code, out: sink.out, err: sink.err };
  }

  async function runPipeline(pipe, stdin, sink) {
    let input = stdin;
    let code = 0;
    for (let i = 0; i < pipe.cmds.length; i++) {
      const cmd = pipe.cmds[i];
      const result = cmd.type === 'subshell' ? await runSubshell(cmd, input) : await runSimple(cmd, input);
      code = result.code;
      sink.err += result.err;
      if (i === pipe.cmds.length - 1) sink.out += result.out;
      else input = result.out;
    }
    return code;
  }

  async function runSequence(list, stdin, sink) {
    let status = 0;
    for (const { op, pipe } of list.items) {
      if (op === '&&' && status !== 0) continue;
      if (op === '||' && status === 0) continue;
      status = await runPipeline(pipe, stdin, sink);
      state.status = status;
    }
    return status;
  }

  return {
    async run(script) {
      const sink = { out: '', err: '' };
      let code;
      try {
        code = await runSequence(parseScript(script), '', sink);
      } catch (err) {
        if (err instanceof ShellExit) code = err.code;
        else {
          code = 2;
          sink.err += `${err.message}\n`;
        }
      }
      state.status = code;
      return { ok: code === 0, exitCode: code, signal: null, stdout: sink.out, stderr: sink.err, output: sink.out + sink.err };
    },
    cwd: () => state.cwd,
  };
}
