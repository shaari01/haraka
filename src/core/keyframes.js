// محرك المفاتيح: البرنامج يحسب كل ما بين المفاتيح
import { lerp, lerpColor } from './math.js';
import { getEase } from './easing.js';

export const EPS = 1e-6;

/** يعيد قيمة المسار عند الزمن t، أو القيمة الأساسية إن لم توجد مفاتيح */
export function valueAt(track, t, base) {
  if (!track || track.length === 0) return base;
  if (track.length === 1 || t <= track[0].t) return track[0].v;
  const last = track[track.length - 1];
  if (t >= last.t) return last.v;
  let i = 0;
  // بحث ثنائي عن المقطع
  let lo = 0, hi = track.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track[mid].t <= t) lo = mid; else hi = mid;
  }
  i = lo;
  const k0 = track[i], k1 = track[i + 1];
  const span = k1.t - k0.t;
  const p = span <= EPS ? 1 : (t - k0.t) / span;
  const e = getEase(k0.ease)(p);
  return interpolate(k0.v, k1.v, e);
}

export function interpolate(a, b, p) {
  if (typeof a === 'number' && typeof b === 'number') return lerp(a, b, p);
  if (typeof a === 'string' && typeof b === 'string' && a[0] === '#' && b[0] === '#') return lerpColor(a, b, p);
  return p < 1 ? a : b;
}

export function findKeyIndex(track, t, tol = EPS) {
  if (!track) return -1;
  return track.findIndex((k) => Math.abs(k.t - t) <= tol);
}

/** يضع مفتاحًا (أو يحدّثه) ويحافظ على الترتيب الزمني */
export function setKey(track, t, v, ease) {
  const i = findKeyIndex(track, t, 1e-4);
  if (i >= 0) {
    track[i].v = v;
    if (ease !== undefined) track[i].ease = ease;
    return track[i];
  }
  const k = { t, v, ease: ease ?? 'linear' };
  track.push(k);
  track.sort((a, b) => a.t - b.t);
  return k;
}

export function removeKey(track, index) {
  track.splice(index, 1);
}

/** ينقل مفتاحًا إلى زمن جديد ويعيد فهرسه الجديد */
export function moveKey(track, index, newT) {
  const k = track[index];
  // إن وجد مفتاح في الزمن الجديد نستبدله
  const clash = track.findIndex((o, j) => j !== index && Math.abs(o.t - newT) < 1e-4);
  if (clash >= 0) track.splice(clash, 1);
  k.t = Math.max(0, newT);
  track.sort((a, b) => a.t - b.t);
  return track.indexOf(k);
}

export const snapToFrame = (t, fps) => Math.round(t * fps) / fps;
