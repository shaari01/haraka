// التشويه الناعم: دبابيس الدمية (شبكة مثلثات) وحقل حركة الصورة الحية (Cinemagraph)

/** إزاحة نقطة حسب الدبابيس: وزن عكسي للمسافة يعطي انثناءً ناعمًا */
export function pinDisplace(x, y, pins, soft) {
  if (!pins.length) return [0, 0];
  let sw = 0, dx = 0, dy = 0;
  const s2 = soft * soft;
  for (const p of pins) {
    const d2 = (x - p.x) ** 2 + (y - p.y) ** 2;
    const w = 1 / Math.pow(d2 + s2, 1.5);
    sw += w; dx += w * p.dx; dy += w * p.dy;
  }
  return [dx / sw, dy / sw];
}

/** شبكة مشوهة: يعيد رؤوس المصدر والهدف */
export function buildMesh(w, h, pins, { cells = 18 } = {}) {
  const cols = Math.max(2, Math.round(cells * Math.min(1, w / h) + (w > h ? cells * (w / h - 1) * 0.3 : 0)));
  const rows = Math.max(2, Math.round(cells * Math.min(1, h / w) + (h > w ? cells * (h / w - 1) * 0.3 : 0)));
  const soft = Math.max(w, h) * 0.08;
  const src = [], dst = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const x = (i / cols) * w, y = (j / rows) * h;
      const [dx, dy] = pinDisplace(x, y, pins, soft);
      src.push([x, y]);
      dst.push([x + dx, y + dy]);
    }
  }
  return { cols, rows, src, dst };
}

/** رسم صورة مثلثًا مثلثًا بتحويل أفيني لكل مثلث */
export function drawMesh(ctx, img, mesh, iw, ih, expandPx = 0.6) {
  const { cols, rows, src, dst } = mesh;
  iwG = iw; ihG = ih;
  const sx = 1, sy = 1;
  const base = ctx.getTransform();
  const scale = Math.hypot(base.a, base.b) || 1;
  const e = expandPx / scale;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
      tri(ctx, img, src[a], src[b], src[d], dst[a], dst[b], dst[d], sx, sy, e, base);
      tri(ctx, img, src[a], src[d], src[c], dst[a], dst[d], dst[c], sx, sy, e, base);
    }
  }
  ctx.setTransform(base);
}

let iwG = 1, ihG = 1;
function tri(ctx, img, s0, s1, s2, d0, d1, d2, sx, sy, e, base) {
  // تكبير المثلث الهدف قليلًا لإخفاء الفواصل بين المثلثات
  const cx = (d0[0] + d1[0] + d2[0]) / 3, cy = (d0[1] + d1[1] + d2[1]) / 3;
  const grow = (p) => { const vx = p[0] - cx, vy = p[1] - cy, L = Math.hypot(vx, vy) || 1; return [p[0] + (vx / L) * e, p[1] + (vy / L) * e]; };
  const D0 = grow(d0), D1 = grow(d1), D2 = grow(d2);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(D0[0], D0[1]); ctx.lineTo(D1[0], D1[1]); ctx.lineTo(D2[0], D2[1]); ctx.closePath();
  ctx.clip();
  // التحويل من مثلث المصدر إلى مثلث الهدف
  const [x0, y0] = s0, [x1, y1] = s1, [x2, y2] = s2;
  const [u0, v0] = d0, [u1, v1] = d1, [u2, v2] = d2;
  const den = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1);
  if (Math.abs(den) < 1e-9) { ctx.restore(); return; }
  const a = (u0 * (y1 - y2) + u1 * (y2 - y0) + u2 * (y0 - y1)) / den;
  const b = (v0 * (y1 - y2) + v1 * (y2 - y0) + v2 * (y0 - y1)) / den;
  const c = (u0 * (x2 - x1) + u1 * (x0 - x2) + u2 * (x1 - x0)) / den;
  const d = (v0 * (x2 - x1) + v1 * (x0 - x2) + v2 * (x1 - x0)) / den;
  const ee = (u0 * (x1 * y2 - x2 * y1) + u1 * (x2 * y0 - x0 * y2) + u2 * (x0 * y1 - x1 * y0)) / den;
  const f = (v0 * (x1 * y2 - x2 * y1) + v1 * (x2 * y0 - x0 * y2) + v2 * (x0 * y1 - x1 * y0)) / den;
  ctx.transform(a, b, c, d, ee, f);
  ctx.drawImage(img, 0, 0, iwG, ihG);
  ctx.restore();
}

/**
 * حقل السرعة للصورة الحية بدقة منخفضة.
 * arrows: [{x0,y0,x1,y1}] بإحداثيات الصورة؛ anchors: [[x,y]]؛ mask: Uint8Array (255 = مجمد)
 * يعيد Float32Array بطول gw*gh*2 (بكسل لكل دورة)
 */
export function flowField(w, h, gw, gh, arrows, anchors, mask, anchorR) {
  const out = new Float32Array(gw * gh * 2);
  if (!arrows.length) return out;
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const x = ((i + 0.5) / gw) * w, y = ((j + 0.5) / gh) * h;
      let sw = 0, vx = 0, vy = 0;
      for (const a of arrows) {
        const d = segDist(x, y, a.x0, a.y0, a.x1, a.y1);
        const wt = 1 / (d * d + 400);
        sw += wt; vx += wt * (a.x1 - a.x0); vy += wt * (a.y1 - a.y0);
      }
      vx /= sw; vy /= sw;
      let f = 1;
      for (const [ax, ay] of anchors) {
        const d = Math.hypot(x - ax, y - ay);
        const k = Math.min(1, d / anchorR);
        f = Math.min(f, k * k * (3 - 2 * k));
      }
      if (mask) f *= 1 - mask[j * gw + i] / 255;
      out[(j * gw + i) * 2] = vx * f;
      out[(j * gw + i) * 2 + 1] = vy * f;
    }
  }
  return out;
}

export function segDist(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const L2 = dx * dx + dy * dy || 1e-9;
  const u = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / L2));
  return Math.hypot(px - (x0 + u * dx), py - (y0 + u * dy));
}
