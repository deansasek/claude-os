// The Calculator's logic, with no DOM: the keys (digits, the decimal point, + − × ÷, %, =, C, ⌫) move a state, and the
// expression is evaluated with normal precedence (× and ÷ before + and −). No eval: the text is read by a small parser.
export interface CalcState {
  expr: string;     // what is typed, with the signs shown as − × ÷
  done: boolean;    // the last key was = (the expression now holds its result)
  error: boolean;   // the last = failed (divide by zero, or an unfinished sum)
}

export const START: CalcState = { expr: '', done: false, error: false };

const OPS = '+−×÷';

/** The number being typed: the text after the last operator. */
const lastNumber = (expr: string): string => expr.slice(Math.max(...[...OPS, '%'].map(c => expr.lastIndexOf(c))) + 1);

/** The value of an expression, or null when it cannot be read or divides by zero. */
export function evaluate(expr: string): number | null {
  const src = expr.replace(/−/g, '-').replace(/×/g, '*').replace(/÷/g, '/');
  const toks: { t: string; v?: number }[] = [];
  for (let i = 0; i < src.length;) {
    if (src[i] === ' ') { i++; continue; }
    // a result too big or too small for plain digits is written with an exponent ("1e+21", "1e-7"): read it as one number
    const m = /^(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)/.exec(src.slice(i));
    if (m) { toks.push({ t: 'n', v: +m[1] }); i += m[1].length; continue; }
    if ('+-*/%'.includes(src[i])) { toks.push({ t: src[i] }); i++; continue; }
    return null;
  }
  let p = 0;
  const peek = (): string | undefined => toks[p]?.t;
  const factor = (): number | null => {   // a number (a leading minus, and a trailing % = divide by 100)
    const sign = peek() === '-' ? (p++, -1) : 1;
    const tk = toks[p];
    if (!tk || tk.t !== 'n') return null;
    p++;
    let v = tk.v as number;
    while (peek() === '%') { v /= 100; p++; }
    return sign * v;
  };
  const term = (): number | null => {
    let v = factor();
    while (v !== null && (peek() === '*' || peek() === '/')) {
      const op = peek();
      p++;
      const r = factor();
      if (r === null || (op === '/' && r === 0)) return null;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  let v = term();
  while (v !== null && (peek() === '+' || peek() === '-')) {
    const op = peek();
    p++;
    const r = term();
    if (r === null) return null;
    v = op === '+' ? v + r : v - r;
  }
  if (v === null || p !== toks.length || !Number.isFinite(v)) return null;
  return v;
}

/** A result as the screen shows it: whole numbers as they are, others to 12 significant digits. */
export function format(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(12)));
}

/** The text on the screen for a state. */
export const display = (s: CalcState): string => (s.error ? 'Error' : s.expr || '0');

/** One key press. Keys: 0-9, '.', '+', '−', '×', '÷', '%', '=', 'C' (clear) and '⌫' (backspace). */
export function step(s: CalcState, key: string): CalcState {
  if (key === 'C') return START;
  // after an error, or a finished =, a number starts a new calculation; an operator carries on from the result
  const base = s.error ? START : s;
  if (key === '⌫') return base.done ? START : { ...base, expr: base.expr.slice(0, -1) };
  if (key === '=') {
    const cleaned = base.expr.replace(/[+−×÷]+$/, '');   // a dangling operator is dropped, so 2+ = 2
    if (!cleaned) return base;
    const v = evaluate(cleaned);
    return v === null ? { expr: '', done: false, error: true } : { expr: format(v), done: true, error: false };
  }
  if (/^\d$/.test(key)) {
    if (base.expr.endsWith('%')) return base;   // a number cannot follow a percent sign
    const cur = base.done ? '' : base.expr;
    // a typed zero is replaced by the digit, so 0 then 7 shows 7, not 07 (as a real calculator does)
    if (lastNumber(cur) === '0') return { expr: cur.slice(0, -1) + key, done: false, error: false };
    return { expr: cur + key, done: false, error: false };
  }
  if (key === '.') {
    const cur = base.done ? '' : base.expr;
    if (cur.endsWith('%') || lastNumber(cur).includes('.')) return base;   // one point per number
    return { expr: cur === '' || /[+−×÷]$/.test(cur) ? cur + '0.' : cur + '.', done: false, error: false };
  }
  if (key === '%') {
    return /\d$/.test(base.expr) ? { expr: base.expr + '%', done: false, error: false } : base;
  }
  if (OPS.includes(key)) {
    if (base.expr === '') return key === '−' ? { expr: '−', done: false, error: false } : base;   // only a minus can start
    // a new operator replaces one just typed, and a fresh result carries on with the operator
    const expr = /[+−×÷]$/.test(base.expr) ? base.expr.slice(0, -1) + key : base.expr + key;
    return { expr, done: false, error: false };
  }
  return base;
}
