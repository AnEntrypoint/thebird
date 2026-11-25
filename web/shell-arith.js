export class ArithmeticError extends Error {}

const IDENTIFIER = /^[A-Za-z_]\w*$/;
const NUMBER = /^(?:\d+#.+|0[xX][0-9A-Fa-f]+|\d+)$/;
const TOKEN = /\s*(\d+#[0-9A-Za-z@_]+|0[xX][0-9A-Fa-f]+|\d+|[A-Za-z_]\w*|<<=|>>=|\*\*=|\*\*|<<|>>|<=|>=|==|!=|&&|\|\||\+\+|--|[-+*/%&|^]=|[-+*/%<>=!~^&|?:,()])/y;
const ASSIGNMENTS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=', '**=']);
const BINARY = new Map([
  ['||', 1], ['&&', 2], ['|', 3], ['^', 4], ['&', 5],
  ['==', 6], ['!=', 6], ['<', 7], ['<=', 7], ['>', 7], ['>=', 7],
  ['<<', 8], ['>>', 8], ['+', 9], ['-', 9], ['*', 10], ['/', 10], ['%', 10], ['**', 12],
]);
const MAX_DEPTH = 16;

const wrap = (value) => BigInt.asIntN(64, value);
const truth = (value) => value !== 0n;
const flag = (condition) => (condition ? 1n : 0n);

const digitValue = (char, base) => {
  if (char >= '0' && char <= '9') return BigInt(char.charCodeAt(0) - 48);
  if (char >= 'a' && char <= 'z') return BigInt(char.charCodeAt(0) - 97 + 10);
  if (char >= 'A' && char <= 'Z') return BigInt(char.charCodeAt(0) - 65 + (base <= 36 ? 10 : 36));
  return char === '@' ? 62n : 63n;
};

const numberValue = (token) => {
  const based = /^(\d+)#(.+)$/.exec(token);
  if (based) {
    const base = BigInt(based[1]);
    if (base < 2n || base > 64n) throw new ArithmeticError('arithmetic: invalid arithmetic base');
    let value = 0n;
    for (const char of based[2]) {
      const digit = digitValue(char, Number(base));
      if (digit >= base) throw new ArithmeticError('arithmetic: value too great for base');
      value = value * base + digit;
    }
    return value;
  }
  if (/^0[xX]/.test(token)) return BigInt(token);
  if (/^0\d/.test(token)) {
    if (/[89]/.test(token)) throw new ArithmeticError('arithmetic: value too great for base');
    return BigInt('0o' + token.slice(1));
  }
  return BigInt(token);
};

const tokenize = (text, src) => {
  const tokens = [];
  let end = 0;
  while (end < text.length) {
    TOKEN.lastIndex = end;
    const match = TOKEN.exec(text);
    if (match === null) {
      if (text.slice(end).trim() === '') break;
      throw new ArithmeticError("arithmetic: bad expression '" + src.trim() + "'");
    }
    tokens.push(match[1]);
    end = TOKEN.lastIndex;
  }
  return tokens;
};

const parse = (tokens) => {
  let pos = 0;
  const peek = () => tokens[pos];
  const take = () => tokens[pos++];

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
    const op = take();
    if (node.k !== 'var') throw new ArithmeticError('arithmetic: attempted assignment to non-variable');
    return { k: 'assign', name: node.name, op, value: assignment() };
  };

  const ternary = () => {
    const condition = binary(1);
    if (peek() !== '?') return condition;
    take();
    const yes = assignment();
    if (take() !== ':') throw new ArithmeticError("arithmetic: expected ':'");
    return { k: 'cond', condition, yes, no: ternary() };
  };

  const binary = (minimum) => {
    let left = unary();
    for (;;) {
      const op = peek();
      const precedence = BINARY.get(op);
      if (precedence === undefined || precedence < minimum) return left;
      take();
      left = { k: 'bin', op, left, right: binary(op === '**' ? precedence : precedence + 1) };
    }
  };

  const unary = () => {
    const token = peek();
    if (token === '-' || token === '+' || token === '!' || token === '~') {
      take();
      return { k: 'unary', op: token, operand: unary() };
    }
    if (token === '++' || token === '--') {
      take();
      const name = take();
      if (!IDENTIFIER.test(name ?? '')) throw new ArithmeticError('arithmetic: attempted assignment to non-variable');
      return { k: 'step', name, delta: token === '++' ? 1n : -1n, prefix: true };
    }
    return postfix();
  };

  const postfix = () => {
    const node = primary();
    const token = peek();
    if ((token === '++' || token === '--') && node.k === 'var') {
      take();
      return { k: 'step', name: node.name, delta: token === '++' ? 1n : -1n, prefix: false };
    }
    return node;
  };

  const primary = () => {
    const token = take();
    if (token === undefined) throw new ArithmeticError('arithmetic: unexpected end of expression');
    if (token === '(') {
      const node = expression();
      if (take() !== ')') throw new ArithmeticError('arithmetic: expected )');
      return node;
    }
    if (IDENTIFIER.test(token)) return { k: 'var', name: token };
    if (NUMBER.test(token)) return { k: 'num', value: wrap(numberValue(token)) };
    throw new ArithmeticError("arithmetic: unexpected '" + token + "'");
  };

  const node = expression();
  if (pos < tokens.length) throw new ArithmeticError("arithmetic: unexpected '" + tokens[pos] + "'");
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

const operate = (op, left, right) => {
  switch (op) {
    case '+': return wrap(left + right);
    case '-': return wrap(left - right);
    case '*': return wrap(left * right);
    case '/':
    case '%':
      if (right === 0n) throw new ArithmeticError('arithmetic: division by zero');
      return wrap(op === '/' ? left / right : left % right);
    case '**':
      if (right < 0n) throw new ArithmeticError('arithmetic: exponent less than 0');
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
  return operate(node.op, left, evaluate(node.right, env));
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
      const value = node.op === '=' ? right : operate(node.op.slice(0, -1), old, right);
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
  if (depth > MAX_DEPTH) throw new ArithmeticError('arithmetic: expression recursion level exceeded');
  const tokens = tokenize(src.replace(/\\\n/g, ''), src);
  if (tokens.length === 0) return 0n;
  return evaluate(parse(tokens), { lookup, assign, depth });
};

export function evaluateArithmetic(src, lookup, assign) {
  return run(src, lookup, assign, 0);
}
