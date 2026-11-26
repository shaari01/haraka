// أدوات المسارات: تبسيط وتنعيم خط مرسوم بالإصبع، والسير عليه بالطول
/** تبسيط رامر-دوغلاس-بوكر */
export function simplify(points, tol = 2) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = -1, idx = -1;
    const [x1, y1] = points[a], [x2, y2] = points[b];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = points[i];
      const d = Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / len;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

/** تنعيم بمنحنى كاتمول-روم ثم إعادة توزيع النقاط بالتساوي */
export function smoothPath(points, samples = 120) {
  if (points.length < 2) return points.slice();
  const dense = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    for (let j = 0; j < 12; j++) {
      const t = j / 12, t2 = t * t, t3 = t2 * t;
      dense.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
      ]);
    }
  }
  dense.push(points[points.length - 1].slice());
  return resample(dense, samples);
}

export function cumulative(points) {
  const c = [0];
  for (let i = 1; i < points.length; i++) c.push(c[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  return c;
}

export function resample(points, n) {
  const c = cumulative(points);
  const L = c[c.length - 1];
  if (L === 0) return [points[0].slice()];
  const out = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const d = (i / (n - 1)) * L;
    while (j < c.length - 2 && c[j + 1] < d) j++;
    const seg = c[j + 1] - c[j] || 1e-9;
    const u = (d - c[j]) / seg;
    out.push([points[j][0] + (points[j + 1][0] - points[j][0]) * u, points[j][1] + (points[j + 1][1] - points[j][1]) * u].map((v) => Math.round(v * 100) / 100));
  }
  return out;
}

const lenCache = new WeakMap();
/** نقطة على المسار عند نسبة u من طوله (0..1) مع زاوية الاتجاه بالدرجات */
export function pointAt(points, u) {
  if (!points?.length) return [0, 0, 0];
  if (points.length === 1) return [points[0][0], points[0][1], 0];
  let c = lenCache.get(points);
  if (!c) { c = cumulative(points); lenCache.set(points, c); }
  const L = c[c.length - 1];
  const d = Math.max(0, Math.min(1, u)) * L;
  let lo = 0, hi = c.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= d) lo = m; else hi = m; }
  const seg = c[hi] - c[lo] || 1e-9;
  const f = (d - c[lo]) / seg;
  const [x0, y0] = points[lo], [x1, y1] = points[hi];
  return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI];
}

/** تنعيم سلسلة قيم بمتوسط متحرك (للتسجيل الحي) */
export function movingAverage(vals, radius = 2) {
  return vals.map((_, i) => {
    let s = 0, n = 0;
    for (let k = -radius; k <= radius; k++) { const j = i + k; if (j >= 0 && j < vals.length) { s += vals[j]; n++; } }
    return s / n;
  });
}

/** يحول عينات تسجيل حي [{t,x,y}] إلى مفاتيح قليلة ناعمة */
export function samplesToKeys(samples, { smooth = 2, tol = 1.5 } = {}) {
  if (samples.length < 2) return { x: samples.map((s) => ({ t: s.t, v: s.x })), y: samples.map((s) => ({ t: s.t, v: s.y })) };
  const xs = movingAverage(samples.map((s) => s.x), smooth);
  const ys = movingAverage(samples.map((s) => s.y), smooth);
  // التبسيط في فضاء (الزمن، الموضع) يبقي نقاط تغير الاتجاه والسرعة فقط
  const scaleT = 200; // بكسل لكل ثانية لموازنة البعدين
  const pts = samples.map((s, i) => [s.t * scaleT, xs[i], ys[i], i]);
  const keepIdx = new Set([0, samples.length - 1]);
  for (const dim of [1, 2]) {
    const simp = simplify(pts.map((p) => [p[0], p[dim], p[3]]), tol);
    for (const p of simp) keepIdx.add(p[2]);
  }
  const idx = [...keepIdx].sort((a, b) => a - b);
  const r = (v) => Math.round(v * 100) / 100;
  return {
    x: idx.map((i) => ({ t: r(samples[i].t * 1000) / 1000, v: r(xs[i]), ease: 'linear' })),
    y: idx.map((i) => ({ t: r(samples[i].t * 1000) / 1000, v: r(ys[i]), ease: 'linear' }))
  };
}
