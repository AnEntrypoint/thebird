const awkKeywords = new Set([
  'BEGIN', 'END', 'print', 'printf', 'if', 'else', 'while', 'for', 'break', 'continue', 'next', 'exit',
  'do', 'nextfile', 'getline', 'function', 'func', 'delete', 'in', 'return',
  'split', 'sub', 'gsub', 'match', 'close', 'system', 'fflush', 'rand', 'srand',
  'sin', 'cos', 'atan2', 'exp', 'log', 'sqrt',
]);
const awkBuiltins = new Map([
  ['length', [0, 1]],
  ['substr', [2, 3]],
  ['index', [2, 2]],
  ['toupper', [1, 1]],
  ['tolower', [1, 1]],
  ['int', [1, 1]],
  ['sprintf', [1, Infinity]],
]);
const awkOperators = [
  '**=', '+=', '-=', '*=', '/=', '%=', '^=', '==', '<=', '>=', '!=', '++', '--', '&&', '||', '>>', '!~', '**',
  '{', '}', '(', ')', '[', ']', ';', ',', '+', '-', '*', '/', '%', '^', '!', '>', '<', '|', '?', ':', '~', '$', '=',
];
const awkOperandEnds = new Set(['number', 'string', 'ere', 'name', 'builtin', ')', ']', '++', '--']);
const awkAssignOps = new Set(['=', '+=', '-=', '*=', '/=', '%=', '^=']);
const awkComparisonOps = new Set(['<', '<=', '>', '>=', '==', '!=']);
const awkEscapes = new Map([
  ['n', '\n'], ['t', '\t'], ['r', '\r'], ['b', '\b'], ['f', '\f'], ['v', '\v'], ['a', '\x07'],
  ['"', '"'], ['\\', '\\'], ['/', '/'],
]);
const awkUninitialized = { s: '', n: 0 };
const awkNextSignal = { awkSignal: 'next' };
const awkBreakSignal = { awkSignal: 'break' };
const awkContinueSignal = { awkSignal: 'continue' };
const awkExitSignal = { awkSignal: 'exit' };
const awkNumericText = /^[ \t\n]*[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?[ \t\n]*$/;
const awkNumericPrefix = /^[ \t\n]*[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;
const awkNumberLiteral = /^(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;
const awkIdentifier = /^[A-Za-z_][A-Za-z0-9_]*/;
const awkAssignmentOperand = /^([A-Za-z_][A-Za-z0-9_]*)=/;

function awkError(message) {
  return { awkMessage: message };
}

function awkSyntaxError(line) {
  return awkError(`awk: syntax error at source line ${line}`);
}

function awkUnescape(text) {
  return text.replace(/\\([0-7]{1,3}|.)/gs, (match, escaped) => {
    if (/^[0-7]/.test(escaped)) return String.fromCharCode(parseInt(escaped, 8));
    return awkEscapes.get(escaped) ?? match;
  });
}

function awkTokenize(source) {
  const tokens = [];
  let line = 1;
  let i = 0;
  const push = (type, value) => tokens.push({ type, value, line });
  const regexAllowed = () => {
    const last = tokens[tokens.length - 1];
    return !last || !awkOperandEnds.has(last.type);
  };
  while (i < source.length) {
    const c = source[i];
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '\\' && source[i + 1] === '\n') {
      line++;
      i += 2;
      continue;
    }
    if (c === '\\' && source[i + 1] === '\r' && source[i + 2] === '\n') {
      line++;
      i += 3;
      continue;
    }
    if (c === '#') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (c === '\n') {
      push('newline', '\n');
      line++;
      i++;
      continue;
    }
    if (c === '"') {
      let value = '';
      let j = i + 1;
      for (;;) {
        const ch = source[j];
        if (ch === undefined || ch === '\n') throw awkSyntaxError(line);
        if (ch === '"') break;
        if (ch !== '\\') {
          value += ch;
          j++;
          continue;
        }
        const escaped = source[j + 1];
        if (escaped === '\n') {
          line++;
          j += 2;
          continue;
        }
        const octal = /^[0-7]{1,3}/.exec(source.slice(j + 1, j + 4));
        if (octal) {
          value += String.fromCharCode(parseInt(octal[0], 8));
          j += 1 + octal[0].length;
        } else if (escaped !== undefined && awkEscapes.has(escaped)) {
          value += awkEscapes.get(escaped);
          j += 2;
        } else {
          value += '\\';
          j++;
        }
      }
      push('string', value);
      i = j + 1;
      continue;
    }
    if (c === '/' && regexAllowed()) {
      let body = '';
      let j = i + 1;
      let inBracket = false;
      for (;;) {
        const ch = source[j];
        if (ch === undefined || ch === '\n') throw awkSyntaxError(line);
        if (ch === '/' && !inBracket) break;
        if (ch === '\\') {
          const escaped = source[j + 1];
          if (escaped === undefined || escaped === '\n') throw awkSyntaxError(line);
          body += escaped === '/' ? '/' : ch + escaped;
          j += 2;
          continue;
        }
        if (ch === '[' && !inBracket) {
          inBracket = true;
          body += ch;
          j++;
          if (source[j] === '^') {
            body += '^';
            j++;
          }
          if (source[j] === ']') {
            body += '\\]';
            j++;
          }
          continue;
        }
        if (ch === ']' && inBracket) inBracket = false;
        body += ch;
        j++;
      }
      push('ere', body);
      i = j + 1;
      continue;
    }
    const number = awkNumberLiteral.exec(source.slice(i));
    if (number) {
      push('number', Number(number[0]));
      i += number[0].length;
      continue;
    }
    const word = awkIdentifier.exec(source.slice(i));
    if (word) {
      const text = word[0];
      if (awkKeywords.has(text)) push('keyword', text);
      else if (awkBuiltins.has(text)) push('builtin', text);
      else push('name', text);
      i += text.length;
      continue;
    }
    const op = awkOperators.find((candidate) => source.startsWith(candidate, i));
    if (!op) throw awkSyntaxError(line);
    push(op === '**' ? '^' : op === '**=' ? '^=' : op, op);
    i += op.length;
  }
  push('eof', null);
  return tokens;
}

function awkParse(tokens) {
  let position = 0;
  let noGreater = false;
  let loopDepth = 0;
  const peek = () => tokens[position];
  const advance = () => tokens[position++];
  const at = (type) => peek().type === type;
  const atKeyword = (word) => peek().type === 'keyword' && peek().value === word;
  const fail = (token = peek()) => {
    throw awkSyntaxError(token.line);
  };
  const expect = (type) => {
    if (!at(type)) fail();
    return advance();
  };
  const skipNewlines = () => {
    while (at('newline')) advance();
  };
  const skipTerminators = () => {
    while (at('newline') || at(';')) advance();
  };
  const atSimpleEnd = () => at('newline') || at(';') || at('}') || at('eof') || atKeyword('else');
  const isLvalue = (node) => node.type === 'var' || node.type === 'field';
  const startsConcatenation = () => {
    const type = peek().type;
    return type === 'number' || type === 'string' || type === 'ere' || type === 'name' || type === 'builtin'
      || type === '$' || type === '(' || type === '++' || type === '--';
  };
  const withGreater = (parse) => {
    const outer = noGreater;
    noGreater = false;
    try {
      return parse();
    } finally {
      noGreater = outer;
    }
  };

  function parseProgram() {
    const program = { begin: [], end: [], main: [] };
    skipTerminators();
    while (!at('eof')) {
      if (atKeyword('BEGIN') || atKeyword('END')) {
        const word = advance().value;
        if (!at('{')) fail();
        (word === 'BEGIN' ? program.begin : program.end).push(parseBlock());
      } else if (at('{')) {
        program.main.push({ pattern: null, action: parseBlock() });
      } else {
        const pattern = parseExpression();
        if (at('{')) {
          program.main.push({ pattern, action: parseBlock() });
        } else {
          if (!(at('newline') || at(';') || at('eof'))) fail();
          program.main.push({ pattern, action: null });
        }
      }
      skipTerminators();
    }
    return program;
  }

  function parseBlock() {
    expect('{');
    const body = [];
    skipTerminators();
    while (!at('}')) {
      if (at('eof')) fail();
      body.push(parseStatement());
      skipTerminators();
    }
    advance();
    return { type: 'block', body };
  }

  function parseStatement() {
    if (at('{')) return parseBlock();
    if (at(';')) {
      advance();
      return { type: 'block', body: [] };
    }
    if (atKeyword('if')) return parseIf();
    if (atKeyword('while')) return parseWhile();
    if (atKeyword('for')) return parseFor();
    const statement = parseSimpleStatement();
    if (!atSimpleEnd()) fail();
    return statement;
  }

  function parseSimpleStatement() {
    const token = peek();
    if (token.type === 'keyword') {
      if (token.value === 'print' || token.value === 'printf') {
        advance();
        const args = parseOutputList();
        if (token.value === 'printf' && args.length === 0) fail(token);
        return { type: token.value, args };
      }
      if (token.value === 'next') {
        advance();
        return { type: 'next' };
      }
      if (token.value === 'exit') {
        advance();
        return { type: 'exit', value: atSimpleEnd() ? null : parseExpression() };
      }
      if (token.value === 'break' || token.value === 'continue') {
        if (loopDepth === 0) fail(token);
        advance();
        return { type: token.value };
      }
    }
    return { type: 'expression', expression: parseExpression() };
  }

  function parseOutputList() {
    if (atSimpleEnd()) return [];
    const saved = position;
    if (at('(')) {
      try {
        advance();
        const list = withGreater(parseExpressionList);
        expect(')');
        if (atSimpleEnd()) return list;
      } catch (error) {
        if (!error || typeof error.awkMessage !== 'string') throw error;
      }
      position = saved;
    }
    noGreater = true;
    try {
      return parseExpressionList();
    } finally {
      noGreater = false;
    }
  }

  function parseExpressionList() {
    const list = [parseExpression()];
    while (at(',')) {
      advance();
      skipNewlines();
      list.push(parseExpression());
    }
    return list;
  }

  function parseCondition() {
    expect('(');
    const test = withGreater(parseExpression);
    expect(')');
    skipNewlines();
    return test;
  }

  function parseLoopBody() {
    loopDepth++;
    try {
      return parseStatement();
    } finally {
      loopDepth--;
    }
  }

  function parseIf() {
    advance();
    const test = parseCondition();
    const yes = parseStatement();
    const saved = position;
    skipTerminators();
    if (atKeyword('else')) {
      advance();
      skipNewlines();
      return { type: 'if', test, yes, no: parseStatement() };
    }
    position = saved;
    return { type: 'if', test, yes, no: null };
  }

  function parseWhile() {
    advance();
    const test = parseCondition();
    return { type: 'while', test, body: parseLoopBody() };
  }

  function parseFor() {
    advance();
    expect('(');
    const init = at(';') ? null : withGreater(parseExpression);
    expect(';');
    skipNewlines();
    const test = at(';') ? null : withGreater(parseExpression);
    expect(';');
    skipNewlines();
    const step = at(')') ? null : withGreater(parseExpression);
    expect(')');
    skipNewlines();
    return { type: 'for', init, test, step, body: parseLoopBody() };
  }

  function parseExpression() {
    const left = parseTernary();
    if (!awkAssignOps.has(peek().type)) return left;
    if (!isLvalue(left)) fail();
    const op = advance().type;
    skipNewlines();
    return { type: 'assign', op, target: left, value: parseExpression() };
  }

  function parseTernary() {
    const test = parseOr();
    if (!at('?')) return test;
    advance();
    skipNewlines();
    const yes = parseExpression();
    expect(':');
    skipNewlines();
    return { type: 'cond', test, yes, no: parseExpression() };
  }

  function parseOr() {
    let left = parseAnd();
    while (at('||')) {
      advance();
      skipNewlines();
      left = { type: 'or', left, right: parseAnd() };
    }
    return left;
  }

  function parseAnd() {
    let left = parseMatch();
    while (at('&&')) {
      advance();
      skipNewlines();
      left = { type: 'and', left, right: parseMatch() };
    }
    return left;
  }

  function parseMatch() {
    let left = parseComparison();
    while (at('~') || at('!~')) {
      const negate = advance().type === '!~';
      left = { type: 'match', negate, left, right: parseComparison() };
    }
    return left;
  }

  function parseComparison() {
    const left = parseConcatenation();
    const op = peek().type;
    if (!awkComparisonOps.has(op) || (op === '>' && noGreater)) return left;
    advance();
    return { type: 'compare', op, left, right: parseConcatenation() };
  }

  function parseConcatenation() {
    let left = parseAdditive();
    while (startsConcatenation()) left = { type: 'concat', left, right: parseAdditive() };
    return left;
  }

  function parseAdditive() {
    let left = parseMultiplicative();
    while (at('+') || at('-')) {
      const op = advance().type;
      left = { type: 'binary', op, left, right: parseMultiplicative() };
    }
    return left;
  }

  function parseMultiplicative() {
    let left = parseUnary();
    while (at('*') || at('/') || at('%')) {
      const op = advance().type;
      left = { type: 'binary', op, left, right: parseUnary() };
    }
    return left;
  }

  function parseUnary() {
    if (at('!') || at('-') || at('+')) {
      const op = advance().type;
      return { type: 'unary', op, operand: parseUnary() };
    }
    return parsePower();
  }

  function parsePower() {
    const base = parsePostfix();
    if (!at('^')) return base;
    advance();
    return { type: 'binary', op: '^', left: base, right: parsePowerOperand() };
  }

  function parsePowerOperand() {
    if (at('!') || at('-') || at('+')) {
      const op = advance().type;
      return { type: 'unary', op, operand: parsePowerOperand() };
    }
    return parsePower();
  }

  function parsePrefixIncrement() {
    const token = advance();
    const target = parsePrimary();
    if (!isLvalue(target)) fail(token);
    return { type: 'incdec', op: token.type, prefix: true, target };
  }

  function parsePostfix() {
    if (at('++') || at('--')) return parsePrefixIncrement();
    const operand = parsePrimary();
    if (isLvalue(operand) && (at('++') || at('--'))) return { type: 'incdec', op: advance().type, prefix: false, target: operand };
    return operand;
  }

  function parseFieldIndex() {
    if (at('++') || at('--')) return parsePrefixIncrement();
    if (at('!') || at('-') || at('+')) {
      const op = advance().type;
      return { type: 'unary', op, operand: parseFieldIndex() };
    }
    return parsePrimary();
  }

  function parseCall() {
    const token = advance();
    const [least, most] = awkBuiltins.get(token.value);
    let args = [];
    if (at('(')) {
      advance();
      args = at(')') ? [] : withGreater(parseExpressionList);
      expect(')');
    } else if (token.value !== 'length') {
      fail();
    }
    if (args.length < least || args.length > most) fail(token);
    return { type: 'call', name: token.value, args };
  }

  function parsePrimary() {
    const token = peek();
    switch (token.type) {
      case 'number':
        advance();
        return { type: 'number', value: token.value };
      case 'string':
        advance();
        return { type: 'string', value: token.value };
      case 'ere':
        advance();
        try {
          return { type: 'regex', regex: new RegExp(token.value) };
        } catch {
          return fail(token);
        }
      case 'name':
        advance();
        return { type: 'var', name: token.value };
      case '$':
        advance();
        return { type: 'field', index: parseFieldIndex() };
      case '(': {
        advance();
        const expression = withGreater(parseExpression);
        expect(')');
        return { type: 'group', expression };
      }
      case 'builtin':
        return parseCall();
      default:
        return fail(token);
    }
  }

  return parseProgram();
}

function awkFormatGeneral(value) {
  if (Number.isNaN(value)) return 'nan';
  if (!Number.isFinite(value)) return value < 0 ? '-inf' : 'inf';
  const [mantissa, exponentText] = value.toExponential(5).split('e');
  const exponent = Number(exponentText);
  const stripZeros = (text) => (text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text);
  if (exponent < -4 || exponent >= 6) {
    const sign = exponent < 0 ? '-' : '+';
    return `${stripZeros(mantissa)}e${sign}${String(Math.abs(exponent)).padStart(2, '0')}`;
  }
  return stripZeros(value.toFixed(5 - exponent));
}

function awkNumberToString(value) {
  if (Number.isInteger(value) && Math.abs(value) < 1e21) return String(value);
  return awkFormatGeneral(value);
}

function awkToString(value) {
  if (typeof value === 'number') return awkNumberToString(value);
  if (typeof value === 'string') return value;
  return value.s;
}

function awkToNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const prefix = awkNumericPrefix.exec(value);
    return prefix ? Number(prefix[0]) : 0;
  }
  return value.n;
}

function awkIsNumeric(value) {
  return typeof value !== 'string';
}

function awkTruthy(value) {
  if (typeof value === 'string') return value !== '';
  return awkToNumber(value) !== 0;
}

function awkFieldValue(text) {
  return awkNumericText.test(text) ? { s: text, n: Number(text) } : text;
}

function awkCompare(op, left, right) {
  const numeric = awkIsNumeric(left) && awkIsNumeric(right);
  const a = numeric ? awkToNumber(left) : awkToString(left);
  const b = numeric ? awkToNumber(right) : awkToString(right);
  switch (op) {
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    case '==':
      return a === b;
    default:
      return a !== b;
  }
}

function awkSubstring(text, start, count) {
  const characters = Array.from(text);
  const first = Math.round(start);
  if (Number.isNaN(first)) return '';
  const end = count === null ? Infinity : first + Math.round(count);
  const from = Math.max(first, 1);
  const to = Math.min(end, characters.length + 1);
  return to > from ? characters.slice(from - 1, to - 1).join('') : '';
}

function awkSplitRecord(text, separator, compileRegex) {
  if (text === '') return [];
  if (separator === ' ') {
    const trimmed = text.replace(/^[ \t\n]+|[ \t\n]+$/g, '');
    return trimmed === '' ? [] : trimmed.split(/[ \t\n]+/);
  }
  if (separator === '') return Array.from(text);
  if (separator.length === 1) return text.split(separator);
  return text.split(compileRegex(separator));
}

export function runAwk(argv, ctx) {
  const vars = new Map([['FS', ' '], ['OFS', ' '], ['ORS', '\n'], ['RS', '\n'], ['NR', 0], ['FNR', 0], ['FILENAME', '']]);
  const usage = (message) => ({ code: 2, out: '', err: `awk: ${message}\n` });
  let index = 0;
  while (index < argv.length) {
    const word = argv[index];
    if (word === '--') {
      index++;
      break;
    }
    if (word.length < 2 || word[0] !== '-') break;
    const flag = word[1];
    if (flag !== 'F' && flag !== 'v') return usage(`unknown option ${word}`);
    const value = word.length > 2 ? word.slice(2) : argv[index + 1];
    if (value === undefined) return usage(`option -${flag} needs an argument`);
    index += word.length > 2 ? 1 : 2;
    if (flag === 'F') {
      vars.set('FS', awkUnescape(value));
    } else {
      const assignment = awkAssignmentOperand.exec(value);
      if (!assignment) return usage(`invalid -v argument ${value}`);
      vars.set(assignment[1], awkFieldValue(awkUnescape(value.slice(assignment[0].length))));
    }
  }
  if (index >= argv.length) return usage('no program text');
  const operands = argv.slice(index + 1);
  let program;
  try {
    program = awkParse(awkTokenize(argv[index]));
  } catch (error) {
    if (error && typeof error.awkMessage === 'string') return { code: 2, out: '', err: `${error.awkMessage}\n` };
    throw error;
  }

  const out = [];
  const err = [];
  const regexCache = new Map();
  let record = '';
  let fields = [];
  let status = 0;

  const compileRegex = (source) => {
    if (!regexCache.has(source)) {
      try {
        regexCache.set(source, new RegExp(source));
      } catch {
        throw awkError(`awk: syntax error in regular expression ${source}`);
      }
    }
    return regexCache.get(source);
  };
  const getVar = (name) => {
    if (name === 'NF') return fields.length;
    return vars.has(name) ? vars.get(name) : awkUninitialized;
  };
  const rebuildRecord = () => {
    record = fields.join(awkToString(getVar('OFS')));
  };
  const setRecord = (text) => {
    record = text;
    fields = awkSplitRecord(text, awkToString(getVar('FS')), compileRegex);
  };
  const setFieldCount = (count) => {
    const size = Math.max(0, Math.trunc(count) || 0);
    if (size < fields.length) fields.length = size;
    while (fields.length < size) fields.push('');
    rebuildRecord();
  };
  const setVar = (name, value) => {
    if (name === 'NF') setFieldCount(awkToNumber(value));
    else vars.set(name, value);
  };
  const getField = (fieldNumber) => {
    if (fieldNumber === 0) return awkFieldValue(record);
    return fieldNumber <= fields.length ? awkFieldValue(fields[fieldNumber - 1]) : awkUninitialized;
  };
  const setField = (fieldNumber, value) => {
    const text = awkToString(value);
    if (fieldNumber === 0) {
      setRecord(text);
      return;
    }
    while (fields.length < fieldNumber) fields.push('');
    fields[fieldNumber - 1] = text;
    rebuildRecord();
  };
  const arithmetic = (op, left, right) => {
    switch (op) {
      case '+':
        return left + right;
      case '-':
        return left - right;
      case '*':
        return left * right;
      case '/':
        if (right === 0) throw awkError('awk: division by zero');
        return left / right;
      case '%':
        if (right === 0) throw awkError('awk: division by zero');
        return left % right;
      default:
        return Math.pow(left, right);
    }
  };

  const fieldNumberOf = (node) => {
    const fieldNumber = Math.trunc(awkToNumber(evaluate(node.index)));
    if (!(fieldNumber >= 0)) throw awkError(`awk: trying to access out of range field ${fieldNumber}`);
    return fieldNumber;
  };
  const reference = (target) => {
    if (target.type === 'var') return { get: () => getVar(target.name), set: (value) => setVar(target.name, value) };
    const fieldNumber = fieldNumberOf(target);
    return { get: () => getField(fieldNumber), set: (value) => setField(fieldNumber, value) };
  };
  const regexFor = (node) => (node.type === 'regex' ? node.regex : compileRegex(awkToString(evaluate(node))));

  const callBuiltin = (node) => {
    const values = node.args.map(evaluate);
    switch (node.name) {
      case 'length':
        return Array.from(values.length ? awkToString(values[0]) : record).length;
      case 'substr':
        return awkSubstring(awkToString(values[0]), awkToNumber(values[1]), values.length > 2 ? awkToNumber(values[2]) : null);
      case 'index': {
        const text = awkToString(values[0]);
        const found = text.indexOf(awkToString(values[1]));
        return found < 0 ? 0 : Array.from(text.slice(0, found)).length + 1;
      }
      case 'toupper':
        return awkToString(values[0]).toUpperCase();
      case 'tolower':
        return awkToString(values[0]).toLowerCase();
      case 'int':
        return Math.trunc(awkToNumber(values[0]));
      default:
        return String(ctx.format(values.map(awkToString)));
    }
  };

  const evaluate = (node) => {
    switch (node.type) {
      case 'number':
      case 'string':
        return node.value;
      case 'regex':
        return node.regex.test(record) ? 1 : 0;
      case 'var':
        return getVar(node.name);
      case 'field':
        return getField(fieldNumberOf(node));
      case 'group':
        return evaluate(node.expression);
      case 'assign': {
        const target = reference(node.target);
        if (node.op === '=') {
          const value = evaluate(node.value);
          target.set(value);
          return value;
        }
        const right = awkToNumber(evaluate(node.value));
        const value = arithmetic(node.op.slice(0, -1), awkToNumber(target.get()), right);
        target.set(value);
        return value;
      }
      case 'cond':
        return awkTruthy(evaluate(node.test)) ? evaluate(node.yes) : evaluate(node.no);
      case 'or':
        return awkTruthy(evaluate(node.left)) || awkTruthy(evaluate(node.right)) ? 1 : 0;
      case 'and':
        return awkTruthy(evaluate(node.left)) && awkTruthy(evaluate(node.right)) ? 1 : 0;
      case 'match': {
        const text = awkToString(evaluate(node.left));
        return regexFor(node.right).test(text) !== node.negate ? 1 : 0;
      }
      case 'compare':
        return awkCompare(node.op, evaluate(node.left), evaluate(node.right)) ? 1 : 0;
      case 'concat':
        return awkToString(evaluate(node.left)) + awkToString(evaluate(node.right));
      case 'binary':
        return arithmetic(node.op, awkToNumber(evaluate(node.left)), awkToNumber(evaluate(node.right)));
      case 'unary': {
        const value = evaluate(node.operand);
        if (node.op === '!') return awkTruthy(value) ? 0 : 1;
        const number = awkToNumber(value);
        return node.op === '-' ? -number : number;
      }
      case 'incdec': {
        const target = reference(node.target);
        const before = awkToNumber(target.get());
        const after = node.op === '++' ? before + 1 : before - 1;
        target.set(after);
        return node.prefix ? after : before;
      }
      case 'call':
        return callBuiltin(node);
      default:
        throw new Error(`awk: unknown expression ${node.type}`);
    }
  };

  const runLoopBody = (body) => {
    try {
      execute(body);
      return false;
    } catch (signal) {
      if (signal === awkBreakSignal) return true;
      if (signal === awkContinueSignal) return false;
      throw signal;
    }
  };

  const execute = (statement) => {
    switch (statement.type) {
      case 'block':
        for (const inner of statement.body) execute(inner);
        return;
      case 'expression':
        evaluate(statement.expression);
        return;
      case 'print': {
        const text = statement.args.length
          ? statement.args.map((arg) => awkToString(evaluate(arg))).join(awkToString(getVar('OFS')))
          : record;
        out.push(text + awkToString(getVar('ORS')));
        return;
      }
      case 'printf':
        out.push(String(ctx.format(statement.args.map((arg) => awkToString(evaluate(arg))))));
        return;
      case 'if':
        if (awkTruthy(evaluate(statement.test))) execute(statement.yes);
        else if (statement.no) execute(statement.no);
        return;
      case 'while':
        while (awkTruthy(evaluate(statement.test))) {
          if (runLoopBody(statement.body)) break;
        }
        return;
      case 'for':
        if (statement.init) evaluate(statement.init);
        while (!statement.test || awkTruthy(evaluate(statement.test))) {
          if (runLoopBody(statement.body)) break;
          if (statement.step) evaluate(statement.step);
        }
        return;
      case 'next':
        throw awkNextSignal;
      case 'exit':
        if (statement.value) status = Math.trunc(awkToNumber(evaluate(statement.value))) & 255;
        throw awkExitSignal;
      case 'break':
        throw awkBreakSignal;
      case 'continue':
        throw awkContinueSignal;
      default:
        throw new Error(`awk: unknown statement ${statement.type}`);
    }
  };

  const runSpecialActions = (actions) => {
    try {
      for (const action of actions) execute(action);
      return false;
    } catch (signal) {
      if (signal === awkExitSignal) return true;
      if (signal === awkNextSignal) throw awkError('awk: next used in BEGIN or END');
      throw signal;
    }
  };

  const runMainItems = () => {
    for (const item of program.main) {
      if (item.pattern && !awkTruthy(evaluate(item.pattern))) continue;
      if (item.action) execute(item.action);
      else out.push(record + awkToString(getVar('ORS')));
    }
  };

  const processText = (text, name) => {
    vars.set('FILENAME', name);
    vars.set('FNR', 0);
    const records = text.split('\n');
    if (records[records.length - 1] === '') records.pop();
    for (const line of records) {
      vars.set('NR', awkToNumber(getVar('NR')) + 1);
      vars.set('FNR', awkToNumber(getVar('FNR')) + 1);
      setRecord(line);
      try {
        runMainItems();
      } catch (signal) {
        if (signal === awkNextSignal) continue;
        if (signal === awkExitSignal) return true;
        throw signal;
      }
    }
    return false;
  };

  const readInputs = () => {
    let sawFile = false;
    for (const operand of operands) {
      const assignment = awkAssignmentOperand.exec(operand);
      if (assignment) {
        setVar(assignment[1], awkFieldValue(awkUnescape(operand.slice(assignment[0].length))));
        continue;
      }
      sawFile = true;
      let text;
      if (operand === '-') {
        text = ctx.stdin ?? '';
      } else {
        try {
          text = ctx.host.read(ctx.resolve(operand));
        } catch (error) {
          if (!error || !error.code) throw error;
          err.push(`awk: can't open file ${operand}\n`);
          status = 2;
          continue;
        }
      }
      if (processText(String(text), operand === '-' ? '' : operand)) return;
    }
    if (!sawFile) processText(String(ctx.stdin ?? ''), '');
  };

  try {
    const exitedInBegin = runSpecialActions(program.begin);
    if (!exitedInBegin && (program.main.length || program.end.length)) readInputs();
    runSpecialActions(program.end);
  } catch (error) {
    if (error && typeof error.awkMessage === 'string') {
      return { code: 2, out: out.join(''), err: `${err.join('')}${error.awkMessage}\n` };
    }
    throw error;
  }
  return { code: status, out: out.join(''), err: err.join('') };
}
