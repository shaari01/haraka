// هندسة SVG: تحويل أشكال الخط (من برنامج الخط) إلى خطوط نقاط لكشف الكتابة والتحوّل
const geomCache = new Map(); // assetId -> geometry | Promise
const listeners = new Set();
export const onGeometry = (fn) => listeners.add(fn);

/**
 * يعيد هندسة العنصر إن كانت جاهزة، وإلا يبدأ تحميلها ويعيد null.
 * الهندسة: { items: [{ subpaths: [[x,y]...][], fill, right, bbox }], w, h }
 */
export function getGeometry(asset, blobGetter) {
  const g = geomCache.get(asset.id);
  if (g && !(g instanceof Promise)) return g;
  if (!g) {
    const p = loadGeometry(asset, blobGetter).then((geo) => { geomCache.set(asset.id, geo); for (const f of listeners) f(asset.id); return geo; })
      .catch((e) => { console.warn('svg geometry', e); geomCache.set(asset.id, { items: [], w: asset.width, h: asset.height }); });
    geomCache.set(asset.id, p);
  }
  return null;
}
export async function ensureGeometry(asset, blobGetter) {
  const g = geomCache.get(asset.id);
  if (g instanceof Promise) return g;
  if (g) return g;
  getGeometry(asset, blobGetter);
  return geomCache.get(asset.id);
}
export function invalidateGeometry(id) { geomCache.delete(id); }

async function loadGeometry(asset, blobGetter) {
  const blob = await blobGetter(asset);
  const text = await blob.text();
  return parseSvgGeometry(text, asset.width, asset.height);
}

export function parseSvgGeometry(text, w, h) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg') throw new Error('SVG غير صالح');
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;width:0;height:0;overflow:hidden;visibility:hidden';
  const live = document.importNode(svg, true);
  live.setAttribute('width', w); live.setAttribute('height', h);
  host.append(live);
  document.body.append(host);
  try {
    const items = [];
    const els = live.querySelectorAll('path, circle, ellipse, rect, polygon, polyline, line');
    const step = Math.max(1, Math.max(w, h) / 600);
    for (const el of els) {
      if (el.closest('defs, clipPath, mask, symbol')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none') continue;
      let len = 0;
      try { len = el.getTotalLength(); } catch { continue; }
      if (!len) continue;
      const ctm = el.getCTM() || live.createSVGMatrix();
      const n = Math.min(4000, Math.max(8, Math.ceil(len / step)));
      const subpaths = [];
      let cur = [];
      let prev = null;
      const jump = step * 4;
      for (let i = 0; i <= n; i++) {
        const p = el.getPointAtLength((i / n) * len);
        const x = ctm.a * p.x + ctm.c * p.y + ctm.e, y = ctm.b * p.x + ctm.d * p.y + ctm.f;
        if (prev && Math.hypot(x - prev[0], y - prev[1]) > jump * Math.max(1, Math.hypot(ctm.a, ctm.b))) { if (cur.length > 1) subpaths.push(cur); cur = []; }
        cur.push([x, y]);
        prev = [x, y];
      }
      if (cur.length > 1) subpaths.push(cur);
      if (!subpaths.length) continue;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const sp of subpaths) for (const [x, y] of sp) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      const fill = cs.fill && cs.fill !== 'none' ? cs.fill : (cs.stroke && cs.stroke !== 'none' ? cs.stroke : '#000');
      items.push({ subpaths, fill, bbox: [minX, minY, maxX, maxY], right: maxX });
    }
    // الكتابة العربية من اليمين إلى اليسار: رتّب الأشكال بحافتها اليمنى
    items.sort((a, b) => b.right - a.right);
    return { items, w, h };
  } finally {
    host.remove();
  }
}

/** طول خط النقاط */
export function polyLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

/** إعادة تقسيم خط مغلق إلى n نقطة */
export function resampleClosed(pts, n) {
  const ring = pts.concat([pts[0]]);
  const c = [0];
  for (let i = 1; i < ring.length; i++) c.push(c[i - 1] + Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]));
  const L = c[c.length - 1] || 1;
  const out = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const d = (i / n) * L;
    while (j < c.length - 2 && c[j + 1] < d) j++;
    const u = (d - c[j]) / ((c[j + 1] - c[j]) || 1);
    out.push([ring[j][0] + (ring[j + 1][0] - ring[j][0]) * u, ring[j][1] + (ring[j + 1][1] - ring[j][1]) * u]);
  }
  return out;
}

/** يجهز شكلين للتحوّل: نفس عدد الأشكال الفرعية ونفس عدد النقاط، مع محاذاة نقطة البداية */
export function prepareMorph(geoA, geoB, n = 96) {
  const flat = (g) => g.items.flatMap((it) => it.subpaths.map((sp) => ({ pts: sp, fill: it.fill, len: polyLength(sp) })))
    .filter((s) => s.len > 2).sort((a, b) => b.len - a.len);
  let A = flat(geoA), B = flat(geoB);
  const count = Math.max(A.length, B.length, 1);
  const pad = (arr, other) => {
    // الأشكال الناقصة تولد كنقطة صغيرة في مركز أقرب شكل
    while (arr.length < count) {
      const src = arr[arr.length % Math.max(1, arr.length)] || other[0];
      const [cx, cy] = centroid(src.pts);
      arr.push({ pts: [[cx, cy], [cx + 0.1, cy], [cx, cy + 0.1]], fill: src.fill, len: 0.3 });
    }
    return arr;
  };
  A = pad(A.slice(), B); B = pad(B.slice(), A);
  // مطابقة الأشكال بترتيب مواقعها من اليمين لليسار
  const order = (arr) => arr.map((s, i) => [i, centroid(s.pts)[0]]).sort((a, b) => b[1] - a[1]).map(([i]) => arr[i]);
  A = order(A); B = order(B);
  const pairs = [];
  for (let i = 0; i < count; i++) {
    const a = resampleClosed(A[i].pts, n);
    let b = resampleClosed(B[i].pts, n);
    // دوّر نقاط الشكل الثاني لأقل مسافة كلية
    let best = 0, bestD = Infinity;
    for (let s = 0; s < n; s += 2) {
      let d = 0;
      for (let k = 0; k < n; k += 4) { const q = b[(k + s) % n]; d += (a[k][0] - q[0]) ** 2 + (a[k][1] - q[1]) ** 2; }
      if (d < bestD) { bestD = d; best = s; }
    }
    b = b.slice(best).concat(b.slice(0, best));
    pairs.push({ a, b, fillA: A[i].fill, fillB: B[i].fill });
  }
  return pairs;
}

export function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}
