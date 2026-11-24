// Formulas for dimensions: "length - 30", "2 * wall + 0.5", "pitch * (count - 1)",
// "max(10, width / 4)". A small parser of its own: nothing is ever passed to eval, so a
// design file can't run code.
//
// Numbers, + − * / ^ (power), parentheses, unary minus, named parameters, and functions:
// abs, min, max, round, floor, ceil, sqrt, sin, cos, tan (degrees), and the constant pi.

export class ExpressionError extends Error {}

const FUNCTIONS = {
  abs: [1, Math.abs],
  min: [-1, Math.min],
  max: [-1, Math.max],
  round: [1, Math.round],
  floor: [1, Math.floor],
  ceil: [1, Math.ceil],
  sqrt: [1, Math.sqrt],
  sin: [1, (d) => Math.sin((d * Math.PI) / 180)],
  cos: [1, (d) => Math.cos((d * Math.PI) / 180)],
  tan: [1, (d) => Math.tan((d * Math.PI) / 180)],
};
const CONSTANTS = { pi: Math.PI };

export const RESERVED_NAMES = new Set([...Object.keys(FUNCTIONS), ...Object.keys(CONSTANTS)]);

function tokenize(text) {
  const tokens = [];
  const pattern = /\s*(?:(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?|([A-Za-z_][A-Za-z0-9_]*)|(\*\*|[-+*/^(),]))/y;
  let index = 0;
  while (index < text.length) {
    if (/^\s*$/.test(text.slice(index))) break;
    pattern.lastIndex = index;
    const match = pattern.exec(text);
    if (!match) throw new ExpressionError(`Unexpected “${text.slice(index).trim()[0]}”`);
    index = pattern.lastIndex;
    if (match[1] !== undefined) tokens.push({ type: 'number', value: Number(match[1]) * 10 ** Number(match[2] ?? 0) });
    else if (match[3] !== undefined) tokens.push({ type: 'name', value: match[3] });
    else tokens.push({ type: 'op', value: match[4] === '**' ? '^' : match[4] });
  }
  return tokens;
}

// Recursive descent over:  sum := product (('+'|'-') product)*
//                          product := unary (('*'|'/') unary)*
//                          unary := '-' unary | power
//                          power := atom ('^' unary)?
//                          atom := number | name | name '(' args ')' | '(' sum ')'
function parse(text) {
  const tokens = tokenize(text);
  let i = 0;
  const peek = () => tokens[i];
  const take = (value) => {
    const token = tokens[i];
    if (token?.type === 'op' && token.value === value) {
      i += 1;
      return true;
    }
    return false;
  };

  function sum() {
    let node = product();
    for (;;) {
      if (take('+')) node = { op: '+', a: node, b: product() };
      else if (take('-')) node = { op: '-', a: node, b: product() };
      else return node;
    }
  }
  function product() {
    let node = unary();
    for (;;) {
      if (take('*')) node = { op: '*', a: node, b: unary() };
      else if (take('/')) node = { op: '/', a: node, b: unary() };
      else return node;
    }
  }
  function unary() {
    if (take('-')) return { op: 'neg', a: unary() };
    if (take('+')) return unary();
    return power();
  }
  function power() {
    const base = atom();
    return take('^') ? { op: '^', a: base, b: unary() } : base;
  }
  function atom() {
    const token = peek();
    if (!token) throw new ExpressionError('Incomplete formula');
    i += 1;
    if (token.type === 'number') return { num: token.value };
    if (token.type === 'name') {
      if (take('(')) {
        const args = [];
        if (!take(')')) {
          do args.push(sum());
          while (take(','));
          if (!take(')')) throw new ExpressionError(`Missing “)” after ${token.value}(…`);
        }
        return { call: token.value, args };
      }
      return { name: token.value };
    }
    if (token.value === '(') {
      const inner = sum();
      if (!take(')')) throw new ExpressionError('Missing “)”');
      return inner;
    }
    throw new ExpressionError(`Unexpected “${token.value}”`);
  }

  if (!tokens.length) throw new ExpressionError('Empty formula');
  const tree = sum();
  if (i < tokens.length) throw new ExpressionError(`Unexpected “${tokens[i].value}”`);
  return tree;
}

function run(node, scope) {
  if ('num' in node) return node.num;
  if ('name' in node) {
    if (Object.hasOwn(CONSTANTS, node.name)) return CONSTANTS[node.name];
    // Own properties only: "constructor" or "toString" must not reach the object machinery.
    if (!Object.hasOwn(scope, node.name)) throw new ExpressionError(`Unknown parameter “${node.name}”`);
    return scope[node.name];
  }
  if ('call' in node) {
    const fn = Object.hasOwn(FUNCTIONS, node.call) ? FUNCTIONS[node.call] : null;
    if (!fn) throw new ExpressionError(`Unknown function “${node.call}”`);
    const [arity, impl] = fn;
    if (arity >= 0 && node.args.length !== arity) {
      throw new ExpressionError(`${node.call}() takes ${arity} value${arity === 1 ? '' : 's'}`);
    }
    if (!node.args.length) throw new ExpressionError(`${node.call}() needs values`);
    return impl(...node.args.map((arg) => run(arg, scope)));
  }
  const a = run(node.a, scope);
  switch (node.op) {
    case 'neg':
      return -a;
    case '+':
      return a + run(node.b, scope);
    case '-':
      return a - run(node.b, scope);
    case '*':
      return a * run(node.b, scope);
    case '/': {
      const b = run(node.b, scope);
      if (b === 0) throw new ExpressionError('Division by zero');
      return a / b;
    }
    case '^':
      return a ** run(node.b, scope);
    default:
      throw new ExpressionError('Bad formula');
  }
}

// → number. Throws ExpressionError with a message for the user.
export function evaluate(text, scope = {}) {
  const value = run(parse(String(text)), scope);
  if (!Number.isFinite(value)) throw new ExpressionError('The result is not a finite number');
  return value;
}

// Parameter names a formula uses (unknown functions are not names).
export function namesIn(text) {
  const names = new Set();
  const walk = (node) => {
    if (!node) return;
    if ('name' in node && !Object.hasOwn(CONSTANTS, node.name)) names.add(node.name);
    if ('call' in node) node.args.forEach(walk);
    if ('a' in node) walk(node.a);
    if ('b' in node) walk(node.b);
  };
  try {
    walk(parse(String(text)));
  } catch {
    // A formula that doesn't parse depends on nothing yet.
  }
  return [...names];
}

export function isValidName(name) {
  return /^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(name) && !RESERVED_NAMES.has(name);
}
