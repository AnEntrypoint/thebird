const jqKeywords = new Set(['if', 'then', 'elif', 'else', 'end', 'as', 'def', 'reduce', 'foreach', 'try', 'catch', 'label', 'import', 'include', 'and', 'or', '__loc__']);
const jqComparisonOps = new Set(['==', '!=', '<', '<=', '>', '>=']);
const jqTwoCharOps = new Set(['==', '!=', '<=', '>=', '//']);
const jqStringEscapes = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };
const jqIdentifier = /^[A-Za-z_][A-Za-z0-9_]*/;
const jqNumber = /^[0-9]+(\.[0-9]*)?([eE][+-]?[0-9]+)?/;
const jqNumericText = /^\s*-?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?\s*$/;
const jqLongOptions = new Map([['--raw-output', 'r'], ['--compact-output', 'c'], ['--null-input', 'n'], ['--slurp', 's']]);
const jqBuiltinArities = new Map([
  ['empty', [0]],
  ['error', [0, 1]],
  ['not', [0]],
  ['length', [0]],
  ['keys', [0]],
  ['type', [0]],
  ['tostring', [0]],
  ['tonumber', [0]],
  ['add', [0]],
  ['map', [1]],
  ['select', [1]],
  ['has', [1]],
  ['values', [0]],
  ['sort', [0]],
  ['unique', [0]],
  ['reverse', [0]],
  ['min', [0]],
  ['max', [0]],
  ['join', [1]],
  ['split', [1]],
  ['ascii_downcase', [0]],
  ['ascii_upcase', [0]],
  ['startswith', [1]],
  ['endswith', [1]],
  ['contains', [1]],
]);

function jqSyntaxError(message) {
  const error = new Error(message);
  error.jqSyntax = true;
  return error;
}

function jqFail(message) {
  const error = new Error(message);
  error.jqRuntime = true;
  return error;
}

function jqHasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function jqSetKey(object, key, value) {
  Object.defineProperty(object, key, { value, writable: true, enumerable: true, configurable: true });
}

function jqCopyObject(object) {
  const copy = {};
  for (const key of Object.keys(object)) jqSetKey(copy, key, object[key]);
  return copy;
}

function jqReadString(text, start) {
  let value = '';
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (c === '"') return { value, end: i + 1 };
    if (c !== '\\') {
      value += c;
      continue;
    }
    const escape = text[i + 1];
    if (escape === '(') throw jqSyntaxError('string interpolation is not supported');
    if (escape === 'u') {
      const hex = text.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw jqSyntaxError('invalid \\u escape in string literal');
      value += String.fromCharCode(parseInt(hex, 16));
      i += 5;
      continue;
    }
    if (escape === undefined || !jqHasOwn(jqStringEscapes, escape)) throw jqSyntaxError(`invalid escape \\${escape === undefined ? '' : escape} in string literal`);
    value += jqStringEscapes[escape];
    i++;
  }
  throw jqSyntaxError('syntax error, unterminated string literal');
}

function jqTokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const rest = text.slice(i);
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
    } else if (c === '#') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '"') {
      const literal = jqReadString(text, i);
      tokens.push({ type: 'str', value: literal.value });
      i = literal.end;
    } else if (c >= '0' && c <= '9') {
      const match = jqNumber.exec(rest);
      tokens.push({ type: 'num', value: Number(match[0]), text: match[0] });
      i += match[0].length;
    } else if (c === '.') {
      const next = text[i + 1];
      const name = jqIdentifier.exec(text.slice(i + 1));
      if (next === '.') {
        tokens.push({ type: 'op', value: '..' });
        i += 2;
      } else if (next === '"') {
        const literal = jqReadString(text, i + 1);
        tokens.push({ type: 'field', value: literal.value });
        i = literal.end;
      } else if (name) {
        tokens.push({ type: 'field', value: name[0] });
        i += 1 + name[0].length;
      } else {
        tokens.push({ type: 'dot' });
        i++;
      }
    } else if (jqIdentifier.test(rest)) {
      const word = jqIdentifier.exec(rest)[0];
      tokens.push({ type: 'ident', value: word });
      i += word.length;
    } else if (jqTwoCharOps.has(text.slice(i, i + 2))) {
      tokens.push({ type: 'op', value: text.slice(i, i + 2) });
      i += 2;
    } else {
      tokens.push({ type: 'op', value: c });
      i++;
    }
  }
  tokens.push({ type: 'eof' });
  return tokens;
}

function jqDescribeToken(token) {
  if (token.type === 'eof') return 'end of file';
  if (token.type === 'num') return token.text;
  if (token.type === 'str') return JSON.stringify(token.value);
  if (token.type === 'field') return `'.${token.value}'`;
  if (token.type === 'dot') return "'.'";
  if (token.type === 'ident') return `'${token.value}'`;
  return `'${token.value}'`;
}

function jqParse(text) {
  const tokens = jqTokenize(text);
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (value) => tokens[pos].type === 'op' && tokens[pos].value === value;
  const isWord = (value) => tokens[pos].type === 'ident' && tokens[pos].value === value;
  const unexpected = () => jqSyntaxError(`syntax error, unexpected ${jqDescribeToken(tokens[pos])}`);
  const expectOp = (value) => {
    if (!isOp(value)) throw unexpected();
    pos++;
  };
  const identity = () => ({ kind: 'identity' });

  function parsePipe(noComma) {
    const left = noComma ? parseAlternative() : parseComma();
    if (isOp('|')) {
      pos++;
      return { kind: 'pipe', left, right: parsePipe(noComma) };
    }
    return left;
  }

  function parseComma() {
    let left = parseAlternative();
    while (isOp(',')) {
      pos++;
      left = { kind: 'comma', left, right: parseAlternative() };
    }
    return left;
  }

  function parseAlternative() {
    const left = parseOr();
    if (isOp('//')) {
      pos++;
      return { kind: 'alt', left, right: parseAlternative() };
    }
    return left;
  }

  function parseOr() {
    let left = parseAnd();
    while (isWord('or')) {
      pos++;
      left = { kind: 'or', left, right: parseAnd() };
    }
    return left;
  }

  function parseAnd() {
    let left = parseComparison();
    while (isWord('and')) {
      pos++;
      left = { kind: 'and', left, right: parseComparison() };
    }
    return left;
  }

  function parseComparison() {
    const left = parseAdditive();
    const token = peek();
    if (token.type === 'op' && jqComparisonOps.has(token.value)) {
      pos++;
      return { kind: 'binary', op: token.value, left, right: parseAdditive() };
    }
    return left;
  }

  function parseAdditive() {
    let left = parseMultiplicative();
    while (isOp('+') || isOp('-')) {
      const op = peek().value;
      pos++;
      left = { kind: 'binary', op, left, right: parseMultiplicative() };
    }
    return left;
  }

  function parseMultiplicative() {
    let left = parseUnary();
    while (isOp('*') || isOp('/')) {
      const op = peek().value;
      pos++;
      left = { kind: 'binary', op, left, right: parseUnary() };
    }
    return left;
  }

  function parseUnary() {
    if (isOp('-')) {
      pos++;
      return { kind: 'neg', body: parseUnary() };
    }
    return parsePostfix();
  }

  function parsePostfix() {
    let node = parsePrimary();
    for (;;) {
      const token = peek();
      if (token.type === 'field') {
        pos++;
        node = { kind: 'field', target: node, name: token.value };
      } else if (isOp('[')) {
        node = parseBracket(node);
      } else if (token.type === 'dot' && tokens[pos + 1].type === 'op' && tokens[pos + 1].value === '[') {
        pos++;
        node = parseBracket(node);
      } else if (isOp('?')) {
        pos++;
        node = { kind: 'try', body: node };
      } else {
        return node;
      }
    }
  }

  function parseBracket(target) {
    expectOp('[');
    if (isOp(']')) {
      pos++;
      return { kind: 'iterate', target };
    }
    if (isOp(':')) {
      pos++;
      const to = parsePipe(false);
      expectOp(']');
      return { kind: 'slice', target, from: null, to };
    }
    const index = parsePipe(false);
    if (isOp(':')) {
      pos++;
      if (isOp(']')) {
        pos++;
        return { kind: 'slice', target, from: index, to: null };
      }
      const to = parsePipe(false);
      expectOp(']');
      return { kind: 'slice', target, from: index, to };
    }
    expectOp(']');
    return { kind: 'index', target, index };
  }

  function parsePrimary() {
    const token = peek();
    if (token.type === 'dot') {
      pos++;
      return identity();
    }
    if (token.type === 'field') {
      pos++;
      return { kind: 'field', target: identity(), name: token.value };
    }
    if (token.type === 'num' || token.type === 'str') {
      pos++;
      return { kind: 'literal', value: token.value };
    }
    if (isOp('(')) {
      pos++;
      const body = parsePipe(false);
      expectOp(')');
      return body;
    }
    if (isOp('[')) {
      pos++;
      if (isOp(']')) {
        pos++;
        return { kind: 'array', body: null };
      }
      const body = parsePipe(false);
      expectOp(']');
      return { kind: 'array', body };
    }
    if (isOp('{')) return parseObject();
    if (token.type === 'ident') return parseWord();
    throw unexpected();
  }

  function parseWord() {
    const name = peek().value;
    if (jqKeywords.has(name)) throw unexpected();
    pos++;
    if (name === 'true') return { kind: 'literal', value: true };
    if (name === 'false') return { kind: 'literal', value: false };
    if (name === 'null') return { kind: 'literal', value: null };
    const args = [];
    if (isOp('(')) {
      pos++;
      args.push(parsePipe(false));
      while (isOp(';')) {
        pos++;
        args.push(parsePipe(false));
      }
      expectOp(')');
    }
    const arities = jqBuiltinArities.get(name);
    if (!arities || !arities.includes(args.length)) throw jqSyntaxError(`${name}/${args.length} is not defined`);
    return { kind: 'call', name, args };
  }

  function parseObject() {
    expectOp('{');
    const entries = [];
    if (isOp('}')) {
      pos++;
      return { kind: 'object', entries };
    }
    for (;;) {
      const token = peek();
      let key;
      let shorthandName = null;
      if (token.type === 'ident' || token.type === 'str') {
        pos++;
        key = { kind: 'literal', value: token.value };
        shorthandName = token.value;
      } else if (isOp('(')) {
        pos++;
        key = parsePipe(false);
        expectOp(')');
      } else {
        throw unexpected();
      }
      let value;
      if (isOp(':')) {
        pos++;
        value = parsePipe(true);
      } else if (shorthandName !== null) {
        value = { kind: 'field', target: identity(), name: shorthandName };
      } else {
        throw unexpected();
      }
      entries.push({ key, value });
      if (isOp(',')) {
        pos++;
        continue;
      }
      expectOp('}');
      return { kind: 'object', entries };
    }
  }

  if (peek().type === 'eof') return identity();
  const program = parsePipe(false);
  if (peek().type !== 'eof') throw unexpected();
  return program;
}

function jqTypeOf(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  if (Array.isArray(value)) return 'array';
  return 'object';
}

function jqIsObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function jqTruthy(value) {
  return value !== null && value !== false;
}

function jqDescribe(value) {
  return `${jqTypeOf(value)} (${jqFormat(value, false, 0)})`;
}

function jqRank(value) {
  if (value === null) return 0;
  if (value === false) return 1;
  if (value === true) return 2;
  if (typeof value === 'number') return 3;
  if (typeof value === 'string') return 4;
  if (Array.isArray(value)) return 5;
  return 6;
}

function jqCompare(a, b) {
  const rankA = jqRank(a);
  const rankB = jqRank(b);
  if (rankA !== rankB) return rankA < rankB ? -1 : 1;
  if (rankA === 3 || rankA === 4) return a < b ? -1 : a > b ? 1 : 0;
  if (rankA === 5) {
    const shared = Math.min(a.length, b.length);
    for (let i = 0; i < shared; i++) {
      const order = jqCompare(a[i], b[i]);
      if (order !== 0) return order;
    }
    return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
  }
  if (rankA === 6) {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    const keyOrder = jqCompare(keysA, keysB);
    if (keyOrder !== 0) return keyOrder;
    for (const key of keysA) {
      const order = jqCompare(a[key], b[key]);
      if (order !== 0) return order;
    }
  }
  return 0;
}

function jqMergeShallow(a, b) {
  const merged = jqCopyObject(a);
  for (const key of Object.keys(b)) jqSetKey(merged, key, b[key]);
  return merged;
}

function jqMergeDeep(a, b) {
  const merged = jqCopyObject(a);
  for (const key of Object.keys(b)) {
    const current = jqHasOwn(merged, key) ? merged[key] : null;
    jqSetKey(merged, key, jqIsObject(current) && jqIsObject(b[key]) ? jqMergeDeep(current, b[key]) : b[key]);
  }
  return merged;
}

function jqBinary(op, a, b) {
  switch (op) {
    case '==': return jqCompare(a, b) === 0;
    case '!=': return jqCompare(a, b) !== 0;
    case '<': return jqCompare(a, b) < 0;
    case '<=': return jqCompare(a, b) <= 0;
    case '>': return jqCompare(a, b) > 0;
    case '>=': return jqCompare(a, b) >= 0;
    case '+':
      if (a === null) return b;
      if (b === null) return a;
      if (typeof a === 'number' && typeof b === 'number') return a + b;
      if (typeof a === 'string' && typeof b === 'string') return a + b;
      if (Array.isArray(a) && Array.isArray(b)) return a.concat(b);
      if (jqIsObject(a) && jqIsObject(b)) return jqMergeShallow(a, b);
      throw jqFail(`${jqDescribe(a)} and ${jqDescribe(b)} cannot be added`);
    case '-':
      if (typeof a === 'number' && typeof b === 'number') return a - b;
      if (Array.isArray(a) && Array.isArray(b)) return a.filter((item) => !b.some((removed) => jqCompare(item, removed) === 0));
      throw jqFail(`${jqDescribe(a)} and ${jqDescribe(b)} cannot be subtracted`);
    case '*': {
      if (typeof a === 'number' && typeof b === 'number') return a * b;
      const text = typeof a === 'string' ? a : b;
      const count = typeof a === 'string' ? b : a;
      if (typeof text === 'string' && typeof count === 'number') return count > 0 ? text.repeat(Math.max(1, Math.floor(count))) : null;
      if (jqIsObject(a) && jqIsObject(b)) return jqMergeDeep(a, b);
      throw jqFail(`${jqDescribe(a)} and ${jqDescribe(b)} cannot be multiplied`);
    }
    case '/':
      if (typeof a === 'number' && typeof b === 'number') {
        if (b === 0) throw jqFail(`${jqDescribe(a)} and ${jqDescribe(b)} cannot be divided because the divisor is zero`);
        return a / b;
      }
      if (typeof a === 'string' && typeof b === 'string') return a.split(b);
      throw jqFail(`${jqDescribe(a)} and ${jqDescribe(b)} cannot be divided`);
    default:
      throw new Error(`jq operator ${op} has no implementation`);
  }
}

function jqIterate(value) {
  if (Array.isArray(value)) return value;
  if (jqIsObject(value)) return Object.keys(value).map((key) => value[key]);
  if (value === null) throw jqFail('Cannot iterate over null');
  throw jqFail(`Cannot iterate over ${jqDescribe(value)}`);
}

function jqIndexField(base, name) {
  if (base === null) return null;
  if (jqIsObject(base)) return jqHasOwn(base, name) ? base[name] : null;
  throw jqFail(`Cannot index ${jqTypeOf(base)} with ${JSON.stringify(name)}`);
}

function jqIndexValue(base, key) {
  if (typeof key === 'string') return jqIndexField(base, key);
  if (base === null) return null;
  if (typeof key === 'number' && Array.isArray(base)) {
    let position = Math.floor(key);
    if (position < 0) position += base.length;
    return position >= 0 && position < base.length ? base[position] : null;
  }
  throw jqFail(`Cannot index ${jqTypeOf(base)} with ${jqTypeOf(key)}`);
}

function jqSlice(base, from, to) {
  if (base === null) return null;
  if ((from !== null && typeof from !== 'number') || (to !== null && typeof to !== 'number')) {
    throw jqFail('Start and end indices of an array slice must be numbers');
  }
  if (typeof base !== 'string' && !Array.isArray(base)) throw jqFail(`Cannot index ${jqTypeOf(base)} with object`);
  const length = base.length;
  let start = from === null ? 0 : from;
  let end = to === null ? length : to;
  if (start < 0) start += length;
  if (end < 0) end += length;
  start = Math.max(0, Math.min(length, Math.floor(start)));
  end = Math.max(0, Math.min(length, Math.ceil(end)));
  if (end < start) end = start;
  return base.slice(start, end);
}

function jqErrorValue(value) {
  return jqFail(typeof value === 'string' ? value : `${jqFormat(value, false, 0)} (not a string)`);
}

function jqLength(value) {
  if (value === null) return 0;
  if (typeof value === 'boolean') throw jqFail(`${jqDescribe(value)} has no length`);
  if (typeof value === 'number') return Math.abs(value);
  if (typeof value === 'string') return [...value].length;
  if (Array.isArray(value)) return value.length;
  return Object.keys(value).length;
}

function jqKeys(value) {
  if (jqIsObject(value)) return Object.keys(value).sort();
  if (Array.isArray(value)) return value.map((item, index) => index);
  throw jqFail(`${jqDescribe(value)} has no keys`);
}

function jqToNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (!jqNumericText.test(value)) throw jqFail(`Cannot parse '${value}' as JSON`);
    return Number(value);
  }
  throw jqFail(`${jqDescribe(value)} cannot be parsed as a number`);
}

function jqAdd(value) {
  if (value === null) return null;
  let total = null;
  for (const item of jqIterate(value)) total = jqBinary('+', total, item);
  return total;
}

function jqSorted(value) {
  if (!Array.isArray(value)) throw jqFail(`${jqDescribe(value)} cannot be sorted, as it is not an array`);
  return value.slice().sort(jqCompare);
}

function jqUnique(value) {
  const sorted = jqSorted(value);
  return sorted.filter((item, index) => index === 0 || jqCompare(item, sorted[index - 1]) !== 0);
}

function jqReverse(value) {
  if (value === null) return [];
  if (typeof value === 'string') return [...value].reverse().join('');
  if (Array.isArray(value)) return value.slice().reverse();
  throw jqFail(`Cannot reverse ${jqDescribe(value)}`);
}

function jqExtreme(value, wantMax) {
  if (!Array.isArray(value)) throw jqFail(`${jqDescribe(value)} cannot be sorted, as it is not an array`);
  let best = null;
  value.forEach((item, index) => {
    if (index === 0 || (wantMax ? jqCompare(item, best) >= 0 : jqCompare(item, best) < 0)) best = item;
  });
  return best;
}

function jqAsciiCase(name, value) {
  if (typeof value !== 'string') throw jqFail(`${name} input must be a string`);
  return name === 'ascii_downcase'
    ? value.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
    : value.replace(/[a-z]/g, (letter) => letter.toUpperCase());
}

function jqHas(value, key) {
  if (jqIsObject(value) && typeof key === 'string') return jqHasOwn(value, key);
  if (Array.isArray(value) && typeof key === 'number') return key >= 0 && key < value.length;
  throw jqFail(`Cannot check whether ${jqTypeOf(value)} has a ${jqTypeOf(key)} key`);
}

function jqJoin(value, separator) {
  const parts = [];
  for (const item of jqIterate(value)) {
    if (item === null) parts.push('');
    else if (typeof item === 'string') parts.push(item);
    else if (typeof item === 'number' || typeof item === 'boolean') parts.push(jqFormat(item, false, 0));
    else throw jqFail(`Cannot join with ${jqTypeOf(item)}`);
  }
  if (typeof separator !== 'string') throw jqFail(`${jqDescribe(separator)} is not a valid join separator`);
  return parts.join(separator);
}

function jqSplit(value, separator) {
  if (typeof value !== 'string' || typeof separator !== 'string') throw jqFail('split input and separator must be strings');
  return value.split(separator);
}

function jqAffix(name, value, affix) {
  if (typeof value !== 'string' || typeof affix !== 'string') throw jqFail(`${name}() requires string inputs`);
  return name === 'startswith' ? value.startsWith(affix) : value.endsWith(affix);
}

function jqContainsValue(a, b) {
  if (jqTypeOf(a) !== jqTypeOf(b)) return false;
  if (typeof a === 'string') return a.includes(b);
  if (Array.isArray(a)) return b.every((wanted) => a.some((item) => jqContainsValue(item, wanted)));
  if (jqIsObject(a)) return Object.keys(b).every((key) => jqHasOwn(a, key) && jqContainsValue(a[key], b[key]));
  return jqCompare(a, b) === 0;
}

function jqContains(a, b) {
  if (jqTypeOf(a) !== jqTypeOf(b)) throw jqFail(`${jqDescribe(a)} and ${jqDescribe(b)} cannot have their containment checked`);
  return jqContainsValue(a, b);
}

function jqApplyBuiltin(name, input) {
  switch (name) {
    case 'not': return !jqTruthy(input);
    case 'length': return jqLength(input);
    case 'keys': return jqKeys(input);
    case 'type': return jqTypeOf(input);
    case 'tostring': return typeof input === 'string' ? input : jqFormat(input, false, 0);
    case 'tonumber': return jqToNumber(input);
    case 'add': return jqAdd(input);
    case 'sort': return jqSorted(input);
    case 'unique': return jqUnique(input);
    case 'reverse': return jqReverse(input);
    case 'min': return jqExtreme(input, false);
    case 'max': return jqExtreme(input, true);
    case 'ascii_downcase':
    case 'ascii_upcase':
      return jqAsciiCase(name, input);
    default:
      throw new Error(`jq builtin ${name} has no implementation`);
  }
}

function* jqCall(node, input) {
  const argument = node.args[0];
  switch (node.name) {
    case 'empty':
      return;
    case 'error':
      if (!argument) throw jqErrorValue(input);
      for (const message of jqEval(argument, input)) throw jqErrorValue(message);
      return;
    case 'values':
      if (input !== null) yield input;
      return;
    case 'map': {
      const mapped = [];
      for (const item of jqIterate(input)) {
        for (const result of jqEval(argument, item)) mapped.push(result);
      }
      yield mapped;
      return;
    }
    case 'select':
      for (const condition of jqEval(argument, input)) {
        if (jqTruthy(condition)) yield input;
      }
      return;
    case 'has':
      for (const key of jqEval(argument, input)) yield jqHas(input, key);
      return;
    case 'join':
      for (const separator of jqEval(argument, input)) yield jqJoin(input, separator);
      return;
    case 'split':
      for (const separator of jqEval(argument, input)) yield jqSplit(input, separator);
      return;
    case 'startswith':
    case 'endswith':
      for (const affix of jqEval(argument, input)) yield jqAffix(node.name, input, affix);
      return;
    case 'contains':
      for (const wanted of jqEval(argument, input)) yield jqContains(input, wanted);
      return;
    default:
      yield jqApplyBuiltin(node.name, input);
  }
}

function* jqBuildObject(entries, index, input, partial) {
  if (index === entries.length) {
    yield partial;
    return;
  }
  const entry = entries[index];
  for (const key of jqEval(entry.key, input)) {
    if (typeof key !== 'string') throw jqFail(`Object keys must be strings, not ${jqTypeOf(key)}`);
    for (const value of jqEval(entry.value, input)) {
      const next = jqCopyObject(partial);
      jqSetKey(next, key, value);
      yield* jqBuildObject(entries, index + 1, input, next);
    }
  }
}

function* jqEval(node, input) {
  switch (node.kind) {
    case 'identity':
      yield input;
      return;
    case 'literal':
      yield node.value;
      return;
    case 'field':
      for (const base of jqEval(node.target, input)) yield jqIndexField(base, node.name);
      return;
    case 'index':
      for (const base of jqEval(node.target, input)) {
        for (const key of jqEval(node.index, input)) yield jqIndexValue(base, key);
      }
      return;
    case 'slice':
      for (const base of jqEval(node.target, input)) {
        const starts = node.from ? [...jqEval(node.from, input)] : [null];
        const ends = node.to ? [...jqEval(node.to, input)] : [null];
        for (const end of ends) {
          for (const start of starts) yield jqSlice(base, start, end);
        }
      }
      return;
    case 'iterate':
      for (const base of jqEval(node.target, input)) yield* jqIterate(base);
      return;
    case 'try':
      try {
        for (const value of jqEval(node.body, input)) yield value;
      } catch (error) {
        if (!error || !error.jqRuntime) throw error;
      }
      return;
    case 'pipe':
      for (const value of jqEval(node.left, input)) yield* jqEval(node.right, value);
      return;
    case 'comma':
      yield* jqEval(node.left, input);
      yield* jqEval(node.right, input);
      return;
    case 'array':
      yield node.body ? [...jqEval(node.body, input)] : [];
      return;
    case 'object':
      yield* jqBuildObject(node.entries, 0, input, {});
      return;
    case 'neg':
      for (const value of jqEval(node.body, input)) {
        if (typeof value !== 'number') throw jqFail(`${jqDescribe(value)} cannot be negated`);
        yield -value;
      }
      return;
    case 'binary':
      for (const right of jqEval(node.right, input)) {
        for (const left of jqEval(node.left, input)) yield jqBinary(node.op, left, right);
      }
      return;
    case 'and':
      for (const left of jqEval(node.left, input)) {
        if (!jqTruthy(left)) {
          yield false;
          continue;
        }
        for (const right of jqEval(node.right, input)) yield jqTruthy(right);
      }
      return;
    case 'or':
      for (const left of jqEval(node.left, input)) {
        if (jqTruthy(left)) {
          yield true;
          continue;
        }
        for (const right of jqEval(node.right, input)) yield jqTruthy(right);
      }
      return;
    case 'alt': {
      let produced = false;
      try {
        for (const value of jqEval(node.left, input)) {
          if (jqTruthy(value)) {
            produced = true;
            yield value;
          }
        }
      } catch (error) {
        if (!error || !error.jqRuntime) throw error;
      }
      if (!produced) yield* jqEval(node.right, input);
      return;
    }
    case 'call':
      yield* jqCall(node, input);
      return;
    default:
      throw new Error(`jq node ${node.kind} has no implementation`);
  }
}

function jqFormatNumber(value) {
  if (Number.isNaN(value)) return 'null';
  if (!Number.isFinite(value)) return value > 0 ? '1.7976931348623157e+308' : '-1.7976931348623157e+308';
  return JSON.stringify(value);
}

function jqFormat(value, pretty, depth) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return jqFormatNumber(value);
  if (typeof value === 'string') return JSON.stringify(value).replace(/\x7f/g, '\\u007f');
  const inner = '  '.repeat(depth + 1);
  const outer = '  '.repeat(depth);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((item) => jqFormat(item, pretty, depth + 1));
    return pretty ? `[\n${inner}${items.join(`,\n${inner}`)}\n${outer}]` : `[${items.join(',')}]`;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) return '{}';
  const separator = pretty ? ': ' : ':';
  const entries = keys.map((key) => `${jqFormat(key, false, 0)}${separator}${jqFormat(value[key], pretty, depth + 1)}`);
  return pretty ? `{\n${inner}${entries.join(`,\n${inner}`)}\n${outer}}` : `{${entries.join(',')}}`;
}

function jqIsSpace(c) {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r';
}

function jqScanStringEnd(text, start) {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '"') return i + 1;
  }
  return text.length;
}

function jqScanValueEnd(text, start) {
  const first = text[start];
  if (first === '"') return jqScanStringEnd(text, start);
  if (first === '[' || first === '{') {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        i = jqScanStringEnd(text, i) - 1;
      } else if (c === '[' || c === '{') {
        depth++;
      } else if (c === ']' || c === '}') {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
    return text.length;
  }
  let end = start;
  while (end < text.length && !/[ \t\n\r[\]{}"]/.test(text[end])) end++;
  return end === start ? start + 1 : end;
}

function jqParseInputs(text) {
  const values = [];
  let i = 0;
  for (;;) {
    while (i < text.length && jqIsSpace(text[i])) i++;
    if (i >= text.length) return { values, failure: null };
    const end = jqScanValueEnd(text, i);
    const slice = text.slice(i, end);
    try {
      values.push(JSON.parse(slice));
    } catch (error) {
      return { values, failure: slice };
    }
    i = end;
  }
}

function jqTruncate(text) {
  return text.length > 40 ? `${text.slice(0, 40)}...` : text;
}

function jqReadFile(ctx, name) {
  try {
    return { text: ctx.host.read(ctx.resolve(name)) };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { error: `jq: error: Could not open ${name}: No such file or directory\n` };
    if (error && error.code === 'EISDIR') return { error: `jq: error: Could not open ${name}: Is a directory\n` };
    throw error;
  }
}

export function runJq(argv, ctx) {
  const flags = { r: false, c: false, n: false, s: false };
  let filter = null;
  const files = [];
  let optionsEnded = false;
  for (const arg of argv) {
    if (!optionsEnded && arg === '--') {
      optionsEnded = true;
    } else if (!optionsEnded && arg.startsWith('--')) {
      const letter = jqLongOptions.get(arg);
      if (!letter) return { code: 2, out: '', err: `jq: Unknown option: ${arg}\n` };
      flags[letter] = true;
    } else if (!optionsEnded && arg.length > 1 && arg[0] === '-') {
      for (const letter of arg.slice(1)) {
        if (!jqHasOwn(flags, letter)) return { code: 2, out: '', err: `jq: Unknown option: ${arg}\n` };
        flags[letter] = true;
      }
    } else if (filter === null) {
      filter = arg;
    } else {
      files.push(arg);
    }
  }
  if (filter === null) return { code: 2, out: '', err: 'jq: error: no filter given\n' };

  let program;
  try {
    program = jqParse(filter);
  } catch (error) {
    if (!error || !error.jqSyntax) throw error;
    return { code: 3, out: '', err: `jq: error: ${error.message}\njq: 1 compile error\n` };
  }

  let out = '';
  let err = '';
  let inputFailed = false;
  let parseFailed = false;
  let runtimeFailed = false;
  const emit = (value) => {
    out += `${flags.r && typeof value === 'string' ? value : jqFormat(value, !flags.c, 0)}\n`;
  };
  const runOne = (input, location) => {
    try {
      for (const value of jqEval(program, input)) emit(value);
    } catch (error) {
      if (!error || !error.jqRuntime) throw error;
      err += `jq: error (at ${location}): ${error.message}\n`;
      runtimeFailed = true;
    }
  };

  if (flags.n) {
    runOne(null, '<unknown>');
  } else {
    const slurped = [];
    let index = 0;
    let lastName = '<stdin>';
    const sources = files.length > 0 ? files : [null];
    for (const file of sources) {
      const name = file === null ? '<stdin>' : file;
      let text;
      if (file === null) {
        text = ctx.stdin || '';
      } else {
        const read = jqReadFile(ctx, file);
        if (read.error) {
          err += read.error;
          inputFailed = true;
          continue;
        }
        text = read.text;
      }
      lastName = name;
      const parsed = jqParseInputs(text);
      for (const value of parsed.values) {
        index++;
        if (flags.s) slurped.push(value);
        else runOne(value, `${name}:${index}`);
      }
      if (parsed.failure !== null) {
        index++;
        err += `jq: error (at ${name}:${index}): Cannot parse '${jqTruncate(parsed.failure)}' as JSON\n`;
        inputFailed = true;
        parseFailed = true;
      }
    }
    if (flags.s && !parseFailed) runOne(slurped, `${lastName}:${index}`);
  }

  const code = inputFailed ? 2 : runtimeFailed ? 5 : 0;
  return { code, out, err };
}
