// مساحة المعاينة: عرض المشهد، واختيار العناصر وتحريكها بالإصبع أو الفأرة
import { renderFrame, layerCorners } from '../core/renderer.js';
import { getLayer, getAsset, evalLayer, worldMatrix, isLayerActive } from '../core/project.js';
import { invert, apply, multiply, translate } from '../core/math.js';
import { h } from './dom.js';

export const stageTools = {}; // أدوات إضافية تسجلها المراحل اللاحقة: {down, move, up, overlay, cursor}
export const overlays = []; // رسومات فوق المشهد (مسار الحركة...)

export class Stage {
  constructor(ed) {
    this.ed = ed;
    this.el = h('div.stage', { 'data-testid': 'stage' });
    this.canvas = h('canvas.stage-canvas');
    this.el.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.dpr = 1;
    this.view = [1, 0, 0, 1, 0, 0];
    this.pointers = new Map();
    this.drag = null;
    this.dirty = true;
    this.zoom = 1; // تكبير المعاينة فوق الملاءمة
    this.pan = [0, 0];
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.el);
    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onUp(e));
    this.canvas.addEventListener('pointercancel', (e) => this.onUp(e));
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    for (const ev of ['change', 'time', 'select', 'render', 'tool']) ed.on(ev, () => this.invalidate());
    const loop = () => { if (this.dirty) { this.dirty = false; this.draw(); } this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }
  destroy() { cancelAnimationFrame(this.raf); }
  invalidate() { this.dirty = true; }

  resize() {
    const r = this.el.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    this.invalidate();
  }

  fit() { this.zoom = 1; this.pan = [0, 0]; this.invalidate(); }

  computeView() {
    const p = this.ed.project;
    const W = this.canvas.width, H = this.canvas.height;
    const margin = 16 * this.dpr;
    const k = Math.min((W - margin * 2) / p.width, (H - margin * 2) / p.height) * this.zoom;
    const ox = (W - p.width * k) / 2 + this.pan[0] * this.dpr;
    const oy = (H - p.height * k) / 2 + this.pan[1] * this.dpr;
    this.view = [k, 0, 0, k, ox, oy];
    return this.view;
  }

  draw() {
    const { ed, ctx } = this;
    const p = ed.project;
    const view = this.computeView();
    const W = this.canvas.width, H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // لوحة شطرنجية تحت المشهد لإظهار الشفافية
    ctx.save();
    ctx.setTransform(...view);
    ctx.beginPath(); ctx.rect(0, 0, p.width, p.height); ctx.clip();
    ctx.fillStyle = checker(ctx);
    ctx.fillRect(0, 0, p.width, p.height);
    ctx.restore();
    // المشهد نفسه
    const off = this._scene ||= document.createElement('canvas');
    if (off.width !== W || off.height !== H) { off.width = W; off.height = H; }
    const octx = off.getContext('2d');
    renderFrame(octx, p, ed.time, { cache: ed.cache, viewMatrix: view, outW: W, outH: H, preview: true, transparent: !p.background });
    ctx.save();
    ctx.setTransform(...view);
    ctx.beginPath(); ctx.rect(0, 0, p.width, p.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clip();
    ctx.drawImage(off, 0, 0);
    ctx.restore();
    // إطار المشهد
    ctx.save();
    ctx.setTransform(...view);
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.lineWidth = 1 / view[0];
    ctx.strokeRect(0, 0, p.width, p.height);
    ctx.restore();
    for (const o of overlays) o(ctx, this);
    const tool = stageTools[ed.tool];
    if (tool?.overlay) tool.overlay(ctx, this);
    else this.drawSelection(ctx);
  }

  drawSelection(ctx, outlineOnly = false) {
    const l = this.ed.layer;
    if (!l || !l.visible) return;
    const pts = layerCorners(this.ed.project, l, this.ed.time).map(([x, y]) => apply(this.view, x, y));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = '#ffb000';
    ctx.lineWidth = 2 * this.dpr;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    const hs = outlineOnly ? [] : this.handles();
    for (const hd of hs) {
      ctx.beginPath();
      ctx.arc(hd.x, hd.y, hd.r, 0, Math.PI * 2);
      ctx.fillStyle = hd.kind === 'rotate' ? '#4cc9f0' : '#ffb000';
      ctx.fill();
      ctx.lineWidth = 2 * this.dpr;
      ctx.strokeStyle = '#1b1822';
      ctx.stroke();
    }
    ctx.restore();
  }

  /** مقابض الحجم والدوران (بحجم مريح للمس) */
  handles() {
    const l = this.ed.layer;
    if (!l || l.locked) return [];
    const pts = layerCorners(this.ed.project, l, this.ed.time).map(([x, y]) => apply(this.view, x, y));
    const r = 13 * this.dpr;
    // العناصر الصغيرة على الشاشة: أبعد المقابض عن المركز حتى يبقى العنصر قابلًا للسحب
    const ccx = (pts[0][0] + pts[2][0]) / 2, ccy = (pts[0][1] + pts[2][1]) / 2;
    const minD = 46 * this.dpr;
    const spread = ([x, y]) => { const dx = x - ccx, dy = y - ccy, d = Math.hypot(dx, dy) || 1; return d >= minD ? [x, y] : [ccx + dx / d * minD, ccy + dy / d * minD]; };
    const out = pts.map((p0, i) => { const [x, y] = spread(p0); return { x, y, r, kind: 'scale', i }; });
    // مقبض الدوران فوق منتصف الحافة العليا
    const [a, b] = [pts[0], pts[1]];
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const cx = (pts[0][0] + pts[2][0]) / 2, cy = (pts[0][1] + pts[2][1]) / 2;
    let dx = mx - cx, dy = my - cy; const d = Math.hypot(dx, dy) || 1;
    const far = Math.max(d, minD) + 40 * this.dpr;
    out.push({ x: cx + (dx / d) * far, y: cy + (dy / d) * far, r, kind: 'rotate' });
    return out;
  }

  /** من إحداثيات الشاشة إلى إحداثيات المشروع */
  toProject(e) {
    const r = this.canvas.getBoundingClientRect();
    const sx = (e.clientX - r.left) * this.dpr, sy = (e.clientY - r.top) * this.dpr;
    const inv = invert(this.view);
    const [x, y] = apply(inv, sx, sy);
    return { x, y, sx, sy };
  }

  hitTest(x, y) {
    const p = this.ed.project;
    for (let i = p.layers.length - 1; i >= 0; i--) {
      const l = p.layers[i];
      if (!isLayerActive(l, this.ed.time, p.duration) || l.locked) continue;
      if (evalLayer(l, this.ed.time).opacity < 0.02 && l.id !== this.ed.selectedLayerId) continue;
      const pts = layerCorners(p, l, this.ed.time);
      if (pointInPoly(x, y, pts)) return l;
    }
    return null;
  }

  onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      this.zoom = Math.max(0.2, Math.min(8, this.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    } else {
      this.pan[0] -= e.deltaX; this.pan[1] -= e.deltaY;
    }
    this.invalidate();
  }

  onDown(e) {
    this.canvas.setPointerCapture(e.pointerId);
    const pt = this.toProject(e);
    this.pointers.set(e.pointerId, pt);
    const tool = stageTools[this.ed.tool];
    if (tool?.down) { tool.down(e, pt, this); return; }
    const ed = this.ed;
    if (this.pointers.size === 2) {
      // قرصة بإصبعين: تكبير وتدوير العنصر المختار
      const l = ed.layer;
      const [p1, p2] = [...this.pointers.values()];
      if (l && !l.locked) {
        const s = evalLayer(l, ed.time);
        this.drag = { kind: 'pinch', layer: l, start: s, d0: Math.hypot(p2.sx - p1.sx, p2.sy - p1.sy), a0: Math.atan2(p2.sy - p1.sy, p2.sx - p1.sx) };
      } else {
        this.drag = { kind: 'viewpinch', z0: this.zoom, d0: Math.hypot(p2.sx - p1.sx, p2.sy - p1.sy) };
      }
      return;
    }
    // المقابض
    for (const hd of this.handles()) {
      if (Math.hypot(hd.x - pt.sx, hd.y - pt.sy) <= hd.r * 1.8) {
        const l = ed.layer;
        const s = evalLayer(l, ed.time);
        const m = worldMatrix(ed.project, l, ed.time);
        const a = getAsset(ed.project, l.assetId);
        const [cx, cy] = apply(m, l.anchorX * (a?.width || 100), l.anchorY * (a?.height || 100));
        this.drag = { kind: hd.kind, layer: l, start: s, cx, cy, d0: Math.hypot(pt.x - cx, pt.y - cy), a0: Math.atan2(pt.y - cy, pt.x - cx) };
        return;
      }
    }
    const hit = this.hitTest(pt.x, pt.y);
    ed.select(hit ? hit.id : null);
    if (hit) {
      const s = evalLayer(hit, ed.time);
      this.drag = { kind: 'move', layer: hit, start: s, x0: pt.x, y0: pt.y, moved: false };
    } else {
      this.drag = { kind: 'pan', sx0: e.clientX, sy0: e.clientY, pan0: [...this.pan] };
    }
  }

  onMove(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const pt = this.toProject(e);
    this.pointers.set(e.pointerId, pt);
    const tool = stageTools[this.ed.tool];
    if (tool?.move) { tool.move(e, pt, this); return; }
    const d = this.drag;
    if (!d) return;
    const ed = this.ed;
    if (d.kind === 'move') {
      const [dx, dy] = worldDeltaToParent(ed.project, d.layer, ed.time, pt.x - d.x0, pt.y - d.y0);
      d.moved = true;
      ed.setProp(d.layer, 'x', round2(d.start.x + dx));
      ed.setProp(d.layer, 'y', round2(d.start.y + dy));
      ed.live();
    } else if (d.kind === 'scale') {
      const dist = Math.hypot(pt.x - d.cx, pt.y - d.cy);
      ed.setProp(d.layer, 'scale', round3(Math.max(0.01, d.start.scale * dist / (d.d0 || 1))));
      ed.live();
    } else if (d.kind === 'rotate') {
      const a = Math.atan2(pt.y - d.cy, pt.x - d.cx);
      let deg = d.start.rotation + (a - d.a0) * 180 / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      ed.setProp(d.layer, 'rotation', round2(deg));
      ed.live();
    } else if (d.kind === 'pinch' && this.pointers.size >= 2) {
      const [p1, p2] = [...this.pointers.values()];
      const dist = Math.hypot(p2.sx - p1.sx, p2.sy - p1.sy);
      const ang = Math.atan2(p2.sy - p1.sy, p2.sx - p1.sx);
      ed.setProp(d.layer, 'scale', round3(Math.max(0.01, d.start.scale * dist / (d.d0 || 1))));
      ed.setProp(d.layer, 'rotation', round2(d.start.rotation + (ang - d.a0) * 180 / Math.PI));
      ed.live();
    } else if (d.kind === 'viewpinch' && this.pointers.size >= 2) {
      const [p1, p2] = [...this.pointers.values()];
      this.zoom = Math.max(0.2, Math.min(8, d.z0 * Math.hypot(p2.sx - p1.sx, p2.sy - p1.sy) / (d.d0 || 1)));
      this.invalidate();
    } else if (d.kind === 'pan') {
      this.pan = [d.pan0[0] + (e.clientX - d.sx0), d.pan0[1] + (e.clientY - d.sy0)];
      this.invalidate();
    }
  }

  onUp(e) {
    const pt = this.pointers.get(e.pointerId) || this.toProject(e);
    this.pointers.delete(e.pointerId);
    const tool = stageTools[this.ed.tool];
    if (tool?.up) { tool.up(e, pt, this); return; }
    if (this.drag && this.drag.kind !== 'pan' && this.drag.kind !== 'viewpinch') this.ed.commit();
    if (this.pointers.size === 0) this.drag = null;
  }
}

function round2(v) { return Math.round(v * 100) / 100; }
function round3(v) { return Math.round(v * 1000) / 1000; }

/** يحوّل إزاحة في إحداثيات المشهد إلى إحداثيات الطبقة الأم */
export function worldDeltaToParent(project, layer, t, dx, dy) {
  if (!layer.parentId) return [dx, dy];
  const parent = getLayer(project, layer.parentId);
  if (!parent) return [dx, dy];
  const pm = worldMatrix(project, parent, t);
  const inv = invert([pm[0], pm[1], pm[2], pm[3], 0, 0]);
  return apply(inv, dx, dy);
}

export function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

let checkerPattern = null;
function checker(ctx) {
  if (checkerPattern) return checkerPattern;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#cfcfd6'; g.fillRect(0, 0, 32, 32);
  g.fillStyle = '#ececf1'; g.fillRect(0, 0, 16, 16); g.fillRect(16, 16, 16, 16);
  checkerPattern = ctx.createPattern(c, 'repeat');
  return checkerPattern;
}
export { multiply, translate };
