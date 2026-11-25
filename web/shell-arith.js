export class ArithmeticError extends Error {}

const OPEN_QUOTE = String.fromCharCode(96);
const IDENTIFIER = /^[A-Za-z_]\w*$/;
const NUMBER = /^(?:\d+#[0-9A-Za-z@_]+|0[xX][0-9A-Fa-f]+|\d+)$/;
const TOKEN = /\s*(\d+#[0-9A-Za-z@_]+|0[xX][0-9A-Fa-f]+|\d+|[A-Za-z_]\w*|<<=|>>=|\*\*=|\*\*|<<|>>|<=|>=|==|!=|&&|\|\||\+\+|--|[-+*/%&|^]=|[-+*/%<>=!~^&|?:,()])/y;
const ASSIGNMENTS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=', '**=']);
const BINARY = new Map([
  ['||', 1], ['&&', 2], ['|', 3], ['^', 4], ['&', 5],
  ['==', 6], ['!=', 6], ['<', 7], ['<=', 7], ['>', 7], ['>=', 7],
  ['<<', 8], ['>>', 8], ['+', 9], ['-', 9], ['*', 10], ['/', 10], ['%', 10], ['**', 12],
]);
const MAX_DEPTH = 16;
const UNARY = new Set(['-', '+', '!', '~']);
const OPERAND_EXPECTED = 'arithmetic syntax error: operand expected';
const SYNTAX_IN_EXPRESSION = 'arithmetic syntax error in expression';
const DIVISION_BY_ZERO = 'division by 0';
const COLON_EXPECTED = OPEN_QUOTE + ":' expected for conditional expression";
const CLOSE_EXPECTED = OPEN_QUOTE + ")' expected";

const wrap = (value) => BigInt.asIntN(64, value);
const truth = (value) => value !== 0n;
const flag = (condition) => (condition ? 1n : 0n);

const digitValue = (char, base) => {
  if (char >= '0' && char <= '9') return BigInt(char.charCodeAt(0) - 48);
  if (char >= 'a' && char <= 'z') return BigInt(char.charCodeAt(0) - 97 + 10);
  if (char >= 'A' && char <= 'Z') return BigInt(char.charCodeAt(0) - 65 + (base <= 36 ? 10 : 36));
  return char === '@' ? 62n : 63n;
};

const numberValue = (token, failAt) => {
  const based = /^(\d+)#(.+)$/.exec(token.text);
  if (based) {
    const base = BigInt(based[1]);
    if (base < 2n || base > 64n) throw failAt('invalid arithmetic base', token.start, token.start + token.text.length);
    let value = 0n;
    for (const char of based[2]) {
      const digit = digitValue(char, Number(base));
      if (digit >= base) throw failAt('value too great for base', token.start, token.start + token.text.length);
      value = value * base + digit;
    }
    return value;
  }
  if (/^0[xX]/.test(token.text)) return BigInt(token.text);
  if (/^0\d/.test(token.text)) {
    if (/[89]/.test(token.text)) throw failAt('value too great for base', token.start, token.start + token.text.length);
    return BigInt('0o' + token.text.slice(1));
  }
  return BigInt(token.text);
};

const tokenize = (text) => {
  const tokens = [];
  let end = 0;
  for (;;) {
    TOKEN.lastIndex = end;
    const match = TOKEN.exec(text);
    if (match === null) {
      const at = end + (text.slice(end).length - text.slice(end).trimStart().length);
      if (at >= text.length) return tokens;
      tokens.push({ text: text[at], start: at });
      end = at + 1;
    } else {
      tokens.push({ text: match[1], start: TOKEN.lastIndex - match[1].length });
      end = TOKEN.lastIndex;
    }
  }
};

const parse = (context) => {
  const { tokens, failAt, failToken } = context;
  let pos = 0;
  const peek = () => tokens[pos]?.text;
  const take = () => tokens[pos++];
  const lastIndex = () => pos - 1;
  const operandStart = () => {
    let index = pos;
    while (UNARY.has(tokens[index]?.text)) index++;
    return index;
  };

  const expression = () => {
    let node = assignment();
    while (peek() === ',') {
      take();
      node = { k: 'seq', first: node, second: assignment() };
    }
    return node;
  };

  const assignment = () => {
    const node = ternary();
    if (!ASSIGNMENTS.has(peek())) return node;
    const op = take().text;
    if (node.k !== 'var') throw failToken('attempted assignment to non-variable', lastIndex());
    const start = operandStart();
    const value = assignment();
    return { k: 'assign', name: node.name, op, value, start };
  };

  const ternary = () => {
    const condition = binary(1);
    if (peek() !== '?') return condition;
    take();
    const yes = assignment();
    if (peek() !== ':') throw failToken(COLON_EXPECTED, lastIndex());
    take();
    return { k: 'cond', condition, yes, no: ternary() };
  };

  const binary = (minimum) => {
    let left = unary();
    for (;;) {
      const op = peek();
      const precedence = BINARY.get(op);
      if (precedence === undefined || precedence < minimum) return left;
      take();
      const start = operandStart();
      const right = binary(op === '**' ? precedence : precedence + 1);
      left = { k: 'bin', op, left, right, start };
    }
  };

  const unary = () => {
    const text = peek();
    if (text === '-' || text === '+' || text === '!' || text === '~') {
      take();
      return { k: 'unary', op: text, operand: unary() };
    }
    if (text === '++' || text === '--') {
      take();
      if (pos >= tokens.length) throw failToken(OPERAND_EXPECTED, lastIndex());
      if (!IDENTIFIER.test(peek())) throw failToken('attempted assignment to non-variable', pos);
      const name = take().text;
      return { k: 'step', name, delta: text === '++' ? 1n : -1n, prefix: true };
    }
    return postfix();
  };

  const postfix = () => {
    const node = primary();
    const text = peek();
    if (text === '++' || text === '--') {
      if (node.k !== 'var') throw failAt(OPERAND_EXPECTED, tokens[pos].start + 1);
      take();
      return { k: 'step', name: node.name, delta: text === '++' ? 1n : -1n, prefix: false };
    }
    return node;
  };

  const primary = () => {
    if (pos >= tokens.length) throw failToken(OPERAND_EXPECTED, lastIndex());
    const token = take();
    if (token.text === '(') {
      const node = expression();
      if (peek() !== ')') throw failToken(CLOSE_EXPECTED, lastIndex());
      take();
      return node;
    }
    if (IDENTIFIER.test(token.text)) return { k: 'var', name: token.text };
    if (NUMBER.test(token.text)) return { k: 'num', value: wrap(numberValue(token, failAt)) };
    throw failToken(OPERAND_EXPECTED, lastIndex());
  };

  const node = expression();
  if (pos < tokens.length) throw failToken(SYNTAX_IN_EXPRESSION, pos);
  return node;
};

const power = (base, exponent) => {
  let result = 1n;
  let factor = wrap(base);
  let rest = exponent;
  while (rest > 0n) {
    if (rest & 1n) result = wrap(result * factor);
    factor = wrap(factor * factor);
    rest >>= 1n;
  }
  return result;
};

const shiftLeft = (value, count) => {
  if (count < 0n) return shiftRight(value, -count);
  return count >= 64n ? 0n : value << count;
};

const shiftRight = (value, count) => {
  if (count < 0n) return shiftLeft(value, -count);
  if (count >= 64n) return value < 0n ? -1n : 0n;
  return value >> count;
};

const operate = (op, left, right, fail) => {
  switch (op) {
    case '+': return wrap(left + right);
    case '-': return wrap(left - right);
    case '*': return wrap(left * right);
    case '/':
    case '%':
      if (right === 0n) throw fail(DIVISION_BY_ZERO);
      return wrap(op === '/' ? left / right : left % right);
    case '**':
      if (right < 0n) throw fail('exponent less than 0');
      return power(left, right);
    case '<<': return wrap(shiftLeft(left, right));
    case '>>': return wrap(shiftRight(left, right));
    case '<': return flag(left < right);
    case '<=': return flag(left <= right);
    case '>': return flag(left > right);
    case '>=': return flag(left >= right);
    case '==': return flag(left === right);
    case '!=': return flag(left !== right);
    case '&': return wrap(left & right);
    case '^': return wrap(left ^ right);
    default: return wrap(left | right);
  }
};

const unaryValue = (op, value) => {
  if (op === '-') return wrap(-value);
  if (op === '+') return value;
  if (op === '!') return flag(!truth(value));
  return wrap(~value);
};

const readVariable = (name, env) => {
  const text = env.lookup(name);
  if (text === undefined || text.trim() === '') return 0n;
  return run(text, env.lookup, env.assign, env.depth + 1);
};

const binaryValue = (node, env) => {
  const left = evaluate(node.left, env);
  if (node.op === '&&') return truth(left) ? flag(truth(evaluate(node.right, env))) : 0n;
  if (node.op === '||') return truth(left) ? 1n : flag(truth(evaluate(node.right, env)));
  return operate(node.op, left, evaluate(node.right, env), (detail) => env.failToken(detail, node.start));
};

const evaluate = (node, env) => {
  switch (node.k) {
    case 'num': return node.value;
    case 'var': return readVariable(node.name, env);
    case 'unary': return unaryValue(node.op, evaluate(node.operand, env));
    case 'step': {
      const old = readVariable(node.name, env);
      const value = wrap(old + node.delta);
      env.assign(node.name, String(value));
      return node.prefix ? value : old;
    }
    case 'assign': {
      const old = node.op === '=' ? 0n : readVariable(node.name, env);
      const right = evaluate(node.value, env);
      const value = node.op === '=' ? right : operate(node.op.slice(0, -1), old, right, (detail) => env.failToken(detail, node.start));
      env.assign(node.name, String(value));
      return value;
    }
    case 'cond': return evaluate(truth(evaluate(node.condition, env)) ? node.yes : node.no, env);
    case 'seq':
      evaluate(node.first, env);
      return evaluate(node.second, env);
    default: return binaryValue(node, env);
  }
};

const run = (src, lookup, assign, depth) => {
  const text = src.replace(/\\\n/g, '');
  if (depth > MAX_DEPTH) throw new ArithmeticError(text.replace(/^\s+/, '') + ': expression recursion level exceeded');
  const tokens = tokenize(text);
  if (tokens.length === 0) return 0n;
  const failAt = (detail, start, end = text.length) => new ArithmeticError(text.slice(0, end).replace(/^\s+/, '') + ': ' + detail + ' (error token is "' + text.slice(start, end) + '")');
  const failToken = (detail, index) => failAt(detail, tokens[index].start);
  const context = { tokens, failAt, failToken, lookup, assign, depth, failToken };
  return evaluate(parse(context), context);
};

export function evaluateArithmetic(src, lookup, assign) {
  return run(src, lookup, assign, 0);
}
