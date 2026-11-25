// منحنيات السرعة: قوالب بأسماء واضحة، ومنحنى بيزيه مخصص لمن يريد الدقة
const linear = (p) => p;

/** منحنى بيزيه مكعب مثل CSS cubic-bezier(x1,y1,x2,y2) */
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  const solve = (x) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-6) return t;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1; t = x;
    for (let i = 0; i < 40; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-6) return t;
      if (x > v) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  return (p) => (p <= 0 ? 0 : p >= 1 ? 1 : sy(solve(p)));
}

function bounceOut(p) {
  const n = 7.5625, d = 2.75;
  if (p < 1 / d) return n * p * p;
  if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
  if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
  return n * (p -= 2.625 / d) * p + 0.984375;
}
function elasticOut(p) {
  if (p === 0 || p === 1) return p;
  return Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * (2 * Math.PI) / 3) + 1;
}
function springOut(p) {
  // نابض مخمَّد: يتجاوز الهدف قليلًا ثم يستقر
  if (p >= 1) return 1;
  return 1 - Math.exp(-6 * p) * Math.cos(p * 12);
}
function backOut(p) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
}

export const EASES = {
  linear: { label: 'ثابت', fn: linear, bezier: [0, 0, 1, 1] },
  easeIn: { label: 'بداية ناعمة', fn: cubicBezier(0.42, 0, 1, 1), bezier: [0.42, 0, 1, 1] },
  easeOut: { label: 'نهاية ناعمة', fn: cubicBezier(0, 0, 0.58, 1), bezier: [0, 0, 0.58, 1] },
  easeInOut: { label: 'ناعمة من الطرفين', fn: cubicBezier(0.42, 0, 0.58, 1), bezier: [0.42, 0, 0.58, 1] },
  back: { label: 'تجاوز ورجوع', fn: backOut },
  bounce: { label: 'ارتداد', fn: bounceOut },
  spring: { label: 'نابض', fn: springOut },
  elastic: { label: 'مرن', fn: elasticOut },
  hold: { label: 'قفزة (بلا انتقال)', fn: (p) => (p < 1 ? 0 : 1) }
};
export const EASE_IDS = Object.keys(EASES);

const bezierCache = new Map();
export function getEase(ease) {
  if (!ease) return linear;
  if (typeof ease === 'string') return EASES[ease]?.fn || linear;
  if (Array.isArray(ease.bezier)) {
    const k = ease.bezier.join(',');
    let f = bezierCache.get(k);
    if (!f) { f = cubicBezier(...ease.bezier); bezierCache.set(k, f); }
    return f;
  }
  return linear;
}

/** يعيد نقاط بيزيه لقالب (إن وُجدت) لاستخدامها في محرر المنحنى أو Lottie */
export function easeBezier(ease) {
  if (!ease) return [0, 0, 1, 1];
  if (typeof ease === 'string') return EASES[ease]?.bezier || null;
  return ease.bezier || null;
}

export function easeLabel(ease) {
  if (!ease) return EASES.linear.label;
  if (typeof ease === 'string') return EASES[ease]?.label || ease;
  return 'منحنى مخصص';
}
