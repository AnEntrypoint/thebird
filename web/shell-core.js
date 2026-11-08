export const COMMAND_TIMEOUT_MS = 300000;

const BREAKS = new Set([' ', '\t', '\r', '\n', ';', '&', '|', '<', '>', '(', ')']);
const OPERATORS = ['2>>', '2>&1', '2>', '&&', '||', '>>', '>', '<', '|', '(', ')', ';', '&'];
const REDIRECTS = new Set(['>', '>>', '<', '2>', '2>>', '2>&1']);
const ESCAPES = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', e: '\x1b', '\\': '\\', '"': '"', "'": "'" };
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=/;
const SHELL_BUILTINS = new Set(['echo', 'printf', 'true', 'false', 'exit', 'export', 'local', 'return', 'test', '[', 'command', 'type', 'which']);

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
    const { op } = tokens[pos++];
    if (op === '2>&1') return { op };
    const target = tokens[pos];
    if (!target?.parts) throw syntaxError(`expected a file after '${op}'`);
    pos++;
    return { op, target: target.parts };
  };

  const parseSimple = () => {
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
    return { type: 'simple', assigns, words, redirects };
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
    const token = tokens[pos++];
    if (!token?.parts || token.parts.length !== 1 || token.parts[0].k !== 'lit') throw syntaxError("expected a name after 'for'");
    const name = token.parts[0].s;
    let words = null;
    if (isWord(tokens[pos], 'in')) {
      pos++;
      words = [];
      while (tokens[pos]?.parts) words.push(tokens[pos++].parts);
    }
    while (tokens[pos]?.op === ';') pos++;
    expectWord('do');
    const body = parseSequence(['done']);
    expectWord('done');
    return { type: 'for', name, words, body, redirects: parseTrailingRedirects() };
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

  const atCloser = (stops) => tokens[pos].op === ')' || stops.some((word) => isWord(tokens[pos], word));

  const parseSequence = (stops) => {
    const items = [];
    let op = null;
    while (pos < tokens.length && !atCloser(stops)) {
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

  const list = parseSequence([]);
  if (pos < tokens.length) throw syntaxError(`unexpected '${tokens[pos].op}'`);
  return list;
}

export function parseScript(src) {
  return parse(tokenize(src));
}

const ok = (out) => ({ code: 0, out, err: '' });

function globRegExp(pattern, caseInsensitive = false) {
  const body = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${body}$`, caseInsensitive ? 'i' : '');
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

export function createShell({ host, cwd = '/workspace', builtins = [] } = {}) {
  const state = { cwd, status: 0 };
  const vars = new Map();
  const functions = new Map();
  const inPage = new Set(builtins);
  let runSignal = null;
  const frames = [];
  let positional = [];

  const resolvePath = (name) => normalize(name.startsWith('/') ? name : state.cwd + '/' + name);

  const commands = {
    echo: ({ argv }) => ok(argv.join(' ') + '\n'),
    printf: ({ argv }) => ok(formatPrintf(argv)),
    true: () => ok(''),
    sleep: ({ argv }) => sleepFor(Number(argv[0] ?? 0) * 1000),
    cd: ({ argv }) => {
      const target = resolvePath(argv[0] ?? '/workspace');
      if (!host.exists(target)) return { code: 1, out: '', err: `cd: ${argv[0]}: No such file or directory\n` };
      state.cwd = target;
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
        const info = host.stat(path);
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
        const info = host.stat(path);
        return `${info?.dir ? 'd' : '-'} ${info?.size ?? 0} ${name}\n`;
      };
      let out = '';
      let err = '';
      let code = 0;
      for (const name of targets.length ? targets : ['.']) {
        const path = resolvePath(name);
        const info = host.stat(path);
        if (!info) {
          err += `ls: cannot access '${name}': No such file or directory\n`;
          code = 2;
        } else if (!info.dir) out += long ? describe(path, name) : name + '\n';
        else {
          for (const entry of host.list(path).sort()) {
            if (!all && entry.startsWith('.')) continue;
            out += long ? describe(`${path === '/' ? '' : path}/${entry}`, entry) : entry + '\n';
          }
        }
      }
      return { code, out, err };
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
    whoami: () => ok('user\n'),
    false: () => ({ code: 1, out: '', err: '' }),
    exit: ({ argv }) => {
      throw new ShellExit(Number(argv[0] ?? state.status));
    },
    export: ({ argv }) => {
      for (const arg of argv) {
        const eq = arg.indexOf('=');
        if (eq > 0) setVariable(arg.slice(0, eq), arg.slice(eq + 1));
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
    test: ({ argv }) => ({ code: evaluateTest(argv) ? 0 : 1, out: '', err: '' }),
    '[': ({ argv }) => {
      if (argv.at(-1) !== ']') return { code: 2, out: '', err: "[: missing ']'\n" };
      return { code: evaluateTest(argv.slice(0, -1)) ? 0 : 1, out: '', err: '' };
    },
    which: ({ argv }) => lookupNames(argv),
    type: ({ argv }) => typeNames(argv),
    command: ({ argv, stdin }) => (argv[0] === '-v' ? lookupNames(argv.slice(1)) : dispatch(argv, stdin)),
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

  const sleepFor = (ms) =>
    new Promise((resolve, reject) => {
      const signal = runSignal;
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
    if (name === '!') return '';
    for (let i = frames.length - 1; i >= 0; i--) {
      if (frames[i].has(name)) return frames[i].get(name);
    }
    return vars.get(name);
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
    throw new Error(`${part.name}${part.op} is not supported yet`);
  }

  async function expandText(parts, sink) {
    return (await expandChars(parts, false, sink)).map((ch) => ch.c).join('');
  }

  async function commandText(src, sink) {
    const sub = { out: '', err: '' };
    try {
      await runSequence(parseScript(src), '', sub);
    } catch (err) {
      if (!(err instanceof ShellExit)) throw err;
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

  async function expandWords(words, sink) {
    const argv = [];
    for (const word of words) argv.push(...(await expandWord(word, sink)));
    return argv;
  }

  const wordPath = async (parts, sink) => resolvePath((await expandWord(parts, sink))[0] ?? '');

  async function runSimple(node, stdin, sink) {
    const argv = await expandWords(node.words, sink);
    const assigned = [];
    for (const { name, value } of node.assigns) assigned.push([name, await expandText(value, sink)]);
    if (!argv.length) {
      for (const [name, value] of assigned) setVariable(name, value);
      return ok('');
    }
    const saved = new Map(assigned.map(([name]) => [name, vars.get(name)]));
    for (const [name, value] of assigned) setVariable(name, value);
    try {
      return await runCommand(node, argv, stdin, sink);
    } finally {
      for (const [name, value] of saved) {
        if (value === undefined) vars.delete(name);
        else setVariable(name, value);
      }
    }
  }

  async function runCommand(node, argv, stdin, sink) {
    let input = stdin;
    for (const redirect of node.redirects) {
      if (redirect.op === '<') {
        try {
          input = host.read(await wordPath(redirect.target, sink));
        } catch {
          return { code: 1, out: '', err: `${argv[0]}: no such file\n` };
        }
      }
    }
    const result = await dispatch(argv, input);
    let { out, err } = result;
    for (const redirect of node.redirects) {
      if (redirect.op === '2>&1') {
        out += err;
        err = '';
      } else if (redirect.op === '>' || redirect.op === '>>') {
        const path = await wordPath(redirect.target, sink);
        const prior = redirect.op === '>>' && host.exists(path) ? host.read(path) : '';
        host.write(path, prior + out);
        out = '';
      } else if (redirect.op === '2>' || redirect.op === '2>>') {
        const path = await wordPath(redirect.target, sink);
        const prior = redirect.op === '2>>' && host.exists(path) ? host.read(path) : '';
        host.write(path, prior + err);
        err = '';
      }
    }
    return { code: result.code, out, err };
  }

  async function runSubshell(node, stdin, sink) {
    const savedCwd = state.cwd;
    const savedVars = new Map(vars);
    const inner = { out: '', err: '' };
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

  async function runGroup(node, stdin) {
    const inner = { out: '', err: '' };
    const code = await runSequence(node.list, stdin, inner);
    return { code, out: inner.out, err: inner.err };
  }

  async function dispatch(argv, stdin) {
    const name = argv[0];
    if (functions.has(name)) return callFunction(functions.get(name), argv.slice(1), stdin);
    if (!Object.hasOwn(commands, name)) return { code: 127, out: '', err: `${name}: command not found\n` };
    return commands[name]({ argv: argv.slice(1), stdin });
  }

  async function runIf(node, stdin) {
    const inner = { out: '', err: '' };
    let code = 0;
    let taken = false;
    for (const { cond, body } of node.branches) {
      if ((await runSequence(cond, stdin, inner)) === 0) {
        code = await runSequence(body, stdin, inner);
        taken = true;
        break;
      }
    }
    if (!taken && node.elseBody) code = await runSequence(node.elseBody, stdin, inner);
    return { code, out: inner.out, err: inner.err };
  }

  async function runFor(node, stdin) {
    const inner = { out: '', err: '' };
    const values = node.words ? await expandWords(node.words, inner) : positional;
    let code = 0;
    for (const value of values) {
      setVariable(node.name, value);
      code = await runSequence(node.body, stdin, inner);
    }
    return { code, out: inner.out, err: inner.err };
  }

  async function callFunction(body, args, stdin) {
    const savedPositional = positional;
    positional = args;
    frames.push(new Map());
    let result;
    try {
      result = body.type === 'subshell' ? await runSubshell(body, stdin, { out: '', err: '' }) : await runGroup(body, stdin);
    } catch (err) {
      if (!(err instanceof ReturnSignal)) throw err;
      result = { code: err.code, out: '', err: '' };
    } finally {
      frames.pop();
      positional = savedPositional;
    }
    return result;
  }

  async function runStage(cmd, stdin, sink) {
    if (cmd.type === 'funcdef') {
      functions.set(cmd.name, cmd.body);
      return ok('');
    }
    if (cmd.type === 'subshell') return runSubshell(cmd, stdin, sink);
    if (cmd.type === 'group') return runGroup(cmd, stdin);
    if (cmd.type === 'if') return runIf(cmd, stdin);
    if (cmd.type === 'for') return runFor(cmd, stdin);
    return runSimple(cmd, stdin, sink);
  }

  async function runPipeline(pipe, stdin, sink) {
    let input = stdin;
    let code = 0;
    for (let i = 0; i < pipe.cmds.length; i++) {
      const cmd = pipe.cmds[i];
      const result = await runStage(cmd, input, sink);
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
      if (runSignal?.aborted) throw runSignal.reason;
      if (op === '&&' && status !== 0) continue;
      if (op === '||' && status === 0) continue;
      status = await runPipeline(pipe, stdin, sink);
      state.status = status;
    }
    return status;
  }

  return {
    async run(script, { signal, timeoutMs = COMMAND_TIMEOUT_MS } = {}) {
      const sink = { out: '', err: '' };
      const control = new AbortController();
      const cancel = () => control.abort(new Cancelled());
      if (signal?.aborted) cancel();
      else signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(() => control.abort(new TimedOut()), timeoutMs);
      runSignal = control.signal;
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
        runSignal = null;
      }
      state.status = code;
      return { ok: code === 0, exitCode: code, signal: null, stdout: sink.out, stderr: sink.err, output: sink.out + sink.err };
    },
    cwd: () => state.cwd,
  };
}
