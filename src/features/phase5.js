// المرحلة 5: تحريك جزء من صورة ثابتة (Cinemagraph)، ودبابيس الدمية (Puppet Pins) وشبكة التشويه
import { h, btn, toast } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { stageTools } from '../ui/stage.js';
import { toolbarTools } from '../ui/editor.js';
import { propSections } from '../ui/props.js';
import { registerDecorator, fullMatrix } from '../core/renderer.js';
import { getAsset, worldMatrix, layerTime } from '../core/project.js';
import { valueAt, setKey } from '../core/keyframes.js';
import { invert, apply, multiply, uid } from '../core/math.js';
import { buildMesh, drawMesh, flowField, segDist } from '../core/warp.js';
import { renderCine, cineSupported } from '../core/cinegl.js';

const toLocal = (ed, layer, pt) => apply(invert(fullMatrix(ed.project, layer, ed.time)), pt.x, pt.y);
const isImage = (a) => a && (a.type === 'image' || a.type === 'svg');

// ——— الصورة الحية ———
const fieldCache = new Map(); // layerId -> {key, field}
function getField(layer, asset) {
  const c = layer.cine;
  const key = JSON.stringify([c.arrows, c.anchors, c.mask?.data?.length, c.mask?.v, c.speed, asset.width, asset.height]);
  const hit = fieldCache.get(layer.id);
  if (hit && hit.key === key) return hit.field;
  const gw = 96, gh = Math.max(8, Math.round(96 * asset.height / asset.width));
  const mask = c.mask ? maskBytes(c.mask, gw, gh) : null;
  const sp = c.speed ?? 1;
  const arrows = c.arrows.map((a) => ({ x0: a.x0, y0: a.y0, x1: a.x0 + (a.x1 - a.x0) * sp, y1: a.y0 + (a.y1 - a.y0) * sp }));
  const data = flowField(asset.width, asset.height, gw, gh, arrows, c.anchors || [], mask, Math.max(asset.width, asset.height) * 0.06);
  const field = { data, gw, gh, key: layer.id + key };
  fieldCache.set(layer.id, { key, field });
  return field;
}

function maskBytes(mask, gw, gh) {
  if (!mask.bytes || mask.bytes.length !== gw * gh) {
    const raw = mask.data ? Uint8Array.from(atob(mask.data), (c) => c.charCodeAt(0)) : new Uint8Array(gw * gh);
    Object.defineProperty(mask, 'bytes', { value: raw.length === gw * gh ? raw : new Uint8Array(gw * gh), writable: true, configurable: true, enumerable: false });
  }
  return mask.bytes;
}
function saveMask(mask) {
  let s = '';
  for (let i = 0; i < mask.bytes.length; i++) s += String.fromCharCode(mask.bytes[i]);
  mask.data = btoa(s);
  mask.v = (mask.v || 0) + 1;
}

registerDecorator((ctx, { layer, asset, src, t, w, h: hh }) => {
  const c = layer.cine;
  if (!c?.on || !c.arrows?.length || !src || !isImage(asset)) return false;
  const T = Math.max(0.5, c.cycle || 3);
  const phase = (((t / T) % 1) + 1) % 1;
  const field = getField(layer, asset);
  const out = renderCine(src, asset.id + ':' + (asset.blobKey || ''), w, hh, field, phase);
  if (!out) return false;
  ctx.drawImage(out, 0, 0, w, hh);
  return true;
});

toolbarTools.push({ id: 'cine', icon: 'arrow', label: 'صورة حية: أسهم وتثبيت وتجميد', help: 'ارسم أسهمًا على ما يتحرك، وانقر لنقاط التثبيت، ولوّن ما يبقى ثابتًا (اختر الوضع من «الخصائص»)' });
stageTools.cine = {
  down(e, pt, stage) {
    const ed = stage.ed;
    const l = ed.layer;
    const a = l && getAsset(ed.project, l.assetId);
    if (!isImage(a)) { toast('اختر صورة على المشهد أولًا', 'error'); return; }
    l.cine ||= { on: true, arrows: [], anchors: [], speed: 1, cycle: 3 };
    l.cine.on = true;
    const [x, y] = toLocal(ed, l, pt);
    const mode = ed.cineMode || 'arrow';
    stage.cineDrag = { mode, x0: x, y0: y, x, y, layer: l, asset: a };
    if (mode === 'anchor') { l.cine.anchors.push([round(x), round(y)]); ed.live(); }
    else if (mode === 'erase') eraseNear(l.cine, x, y, Math.max(a.width, a.height) * 0.04);
    else if (mode === 'mask' || mode === 'unmask') paintMask(l, a, x, y, mode === 'mask');
    stage.invalidate();
  },
  move(e, pt, stage) {
    const d = stage.cineDrag;
    if (!d) return;
    const [x, y] = toLocal(stage.ed, d.layer, pt);
    d.x = x; d.y = y;
    if (d.mode === 'mask' || d.mode === 'unmask') paintMask(d.layer, d.asset, x, y, d.mode === 'mask');
    if (d.mode === 'erase') eraseNear(d.layer.cine, x, y, Math.max(d.asset.width, d.asset.height) * 0.04);
    stage.invalidate();
    if (d.mode !== 'arrow') stage.ed.live();
  },
  up(e, pt, stage) {
    const d = stage.cineDrag;
    stage.cineDrag = null;
    if (!d) return;
    const ed = stage.ed;
    if (d.mode === 'arrow') {
      const len = Math.hypot(d.x - d.x0, d.y - d.y0);
      if (len > 4) d.layer.cine.arrows.push({ x0: round(d.x0), y0: round(d.y0), x1: round(d.x), y1: round(d.y) });
    }
    if (d.mode === 'mask' || d.mode === 'unmask') saveMask(d.layer.cine.mask);
    ed.commit();
  },
  overlay(ctx, stage) {
    stage.drawSelection(ctx, true);
    drawCineOverlay(ctx, stage);
  }
};
const round = (v) => Math.round(v * 10) / 10;

function eraseNear(c, x, y, r) {
  c.arrows = c.arrows.filter((a) => segDist(x, y, a.x0, a.y0, a.x1, a.y1) > r);
  c.anchors = c.anchors.filter(([ax, ay]) => Math.hypot(ax - x, ay - y) > r);
}

function paintMask(layer, asset, x, y, on) {
  const gw = 96, gh = Math.max(8, Math.round(96 * asset.height / asset.width));
  const c = layer.cine;
  c.mask ||= { data: '', v: 0 };
  const bytes = maskBytes(c.mask, gw, gh);
  const gx = (x / asset.width) * gw, gy = (y / asset.height) * gh;
  const r = 3.5;
  for (let j = Math.floor(gy - r); j <= gy + r; j++) for (let i = Math.floor(gx - r); i <= gx + r; i++) {
    if (i < 0 || j < 0 || i >= gw || j >= gh) continue;
    const d = Math.hypot(i + 0.5 - gx, j + 0.5 - gy);
    if (d > r) continue;
    const v = Math.round(255 * Math.min(1, (r - d) / 1.5));
    const k = j * gw + i;
    bytes[k] = on ? Math.max(bytes[k], v) : Math.min(bytes[k], 255 - v);
  }
  c.mask.v = (c.mask.v || 0) + 1;
}

function drawCineOverlay(ctx, stage) {
  const ed = stage.ed, l = ed.layer;
  if (!l?.cine) return;
  const a = getAsset(ed.project, l.assetId);
  if (!a) return;
  const m = multiply(stage.view, fullMatrix(ed.project, l, ed.time));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // القناع: لون أحمر شفاف فوق المجمَّد
  const c = l.cine;
  if (c.mask && ed.tool === 'cine') {
    const gw = 96, gh = Math.max(8, Math.round(96 * a.height / a.width));
    const bytes = maskBytes(c.mask, gw, gh);
    const mc = stage._maskCanvas ||= document.createElement('canvas');
    mc.width = gw; mc.height = gh;
    const g = mc.getContext('2d');
    const im = g.createImageData(gw, gh);
    for (let i = 0; i < gw * gh; i++) { im.data[i * 4] = 255; im.data[i * 4 + 1] = 59; im.data[i * 4 + 2] = 78; im.data[i * 4 + 3] = bytes[i] * 0.45; }
    g.putImageData(im, 0, 0);
    ctx.setTransform(...m);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(mc, 0, 0, a.width, a.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  const arrow = (x0, y0, x1, y1, color) => {
    const [sx, sy] = apply(m, x0, y0), [ex, ey] = apply(m, x1, y1);
    const ang = Math.atan2(ey - sy, ex - sx), hl = 12 * stage.dpr;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 3 * stage.dpr; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ex, ey);
    ctx.lineTo(ex - hl * Math.cos(ang - 0.45), ey - hl * Math.sin(ang - 0.45));
    ctx.lineTo(ex - hl * Math.cos(ang + 0.45), ey - hl * Math.sin(ang + 0.45));
    ctx.closePath(); ctx.fill();
  };
  for (const ar of c.arrows) arrow(ar.x0, ar.y0, ar.x1, ar.y1, '#4cc9f0');
  const d = stage.cineDrag;
  if (d?.mode === 'arrow') arrow(d.x0, d.y0, d.x, d.y, '#ffb000');
  for (const [x, y] of c.anchors) {
    const [sx, sy] = apply(m, x, y);
    ctx.fillStyle = '#ff3b4e'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * stage.dpr;
    ctx.beginPath(); ctx.arc(sx, sy, 7 * stage.dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

propSections.push((ed, layer) => {
  const a = getAsset(ed.project, layer.assetId);
  if (!isImage(a)) return null;
  const c = layer.cine;
  const sec = h('section.sec', h('h3', icon('arrow', 18), ' صورة حية (تحريك جزء من الصورة)'));
  if (!cineSupported()) sec.append(h('p.muted', 'هذا المتصفح لا يدعم WebGL2، فلن تتحرك الصورة.'));
  const modes = [['arrow', 'أسهم التدفق', 'arrow'], ['anchor', 'نقاط تثبيت', 'pin'], ['mask', 'قناع التجميد', 'brush'], ['unmask', 'مسح القناع', 'eraser'], ['erase', 'حذف سهم/نقطة', 'trash']];
  sec.append(h('p.muted', 'ارسم أسهمًا على الماء أو الغيم أو الدخان، وثبّت ما لا يجب أن يتحرك. الحلقة سلسة تلقائيًا.'));
  sec.append(h('div.chips', modes.map(([id, label, ic]) => h('button.chip', { type: 'button', 'aria-pressed': ed.tool === 'cine' && (ed.cineMode || 'arrow') === id, dataset: { cmode: id }, onclick: () => {
    ed.cineMode = id; ed.tool = 'cine'; ed.emit('tool'); ed.emit('select');
  } }, icon(ic, 18), label))));
  if (c) {
    const num = (key, label, step, min) => { const i = h('input.num', { type: 'number', step, min, value: c[key], 'aria-label': label, onchange: () => { const v = parseFloat(i.value); if (!isNaN(v)) { c[key] = Math.max(min, v); ed.commit(); } } }); return h('label.field', h('span', label), i); };
    const on = h('input', { type: 'checkbox', checked: c.on !== false, onchange: () => { c.on = on.checked; ed.commit(); } });
    sec.append(h('div.mod-ctl', num('speed', 'قوة الحركة', 0.1, 0), num('cycle', 'طول الحلقة (ث)', 0.5, 0.5)),
      h('label.field.row', on, h('span', `مفعّلة (${c.arrows.length} سهم، ${c.anchors.length} نقطة)`)),
      btn('trash', 'مسح الكل', () => { delete layer.cine; fieldCache.delete(layer.id); ed.commit(); ed.emit('select'); }, { cls: 'danger' }));
  }
  return sec;
});

// ——— دبابيس الدمية ———
const pinTrack = (id, axis) => `pin_${id}_${axis}`;
function currentPins(layer, t) {
  const lt = layerTime(layer, t);
  return (layer.puppet?.pins || []).map((p) => ({ ...p, dx: valueAt(layer.tracks[pinTrack(p.id, 'x')], lt, 0), dy: valueAt(layer.tracks[pinTrack(p.id, 'y')], lt, 0) }));
}

registerDecorator((ctx, { layer, asset, src, t, w, h: hh }) => {
  const pp = layer.puppet;
  if (!pp?.pins?.length || !src || !isImage(asset) || pp.on === false) return false;
  const pins = currentPins(layer, t);
  if (!pins.some((p) => Math.abs(p.dx) > 0.01 || Math.abs(p.dy) > 0.01)) return false;
  const mesh = buildMesh(w, hh, pins, { cells: pp.cells || 18 });
  drawMesh(ctx, src, mesh, w, hh);
  return true;
});

toolbarTools.push({ id: 'puppet', icon: 'pin', label: 'دبابيس الدمية', help: 'انقر على الصورة لوضع دبوس، واسحب الدبوس لثني الصورة (يُنشأ مفتاح عند الزمن الحالي)' });
stageTools.puppet = {
  down(e, pt, stage) {
    const ed = stage.ed, l = ed.layer;
    const a = l && getAsset(ed.project, l.assetId);
    if (!isImage(a)) { toast('اختر صورة على المشهد أولًا', 'error'); return; }
    l.puppet ||= { pins: [] };
    const [x, y] = toLocal(ed, l, pt);
    // هل لمسنا دبوسًا (في مكانه المشوَّه)؟
    const pins = currentPins(l, ed.time);
    const tol = 22 * stage.dpr / (Math.hypot(...stage.view.slice(0, 2)) * Math.hypot(...fullMatrix(ed.project, l, ed.time).slice(0, 2)));
    let hit = pins.find((p) => Math.hypot(p.x + p.dx - x, p.y + p.dy - y) < tol);
    if (!hit) {
      const p = { id: uid('pin').slice(0, 10), x: round(x), y: round(y) };
      l.puppet.pins.push(p);
      hit = { ...p, dx: 0, dy: 0 };
      ed.commit();
    }
    ed.selectedPin = hit.id;
    stage.pinDrag = { layer: l, pin: hit, x0: x, y0: y, dx0: hit.dx, dy0: hit.dy, moved: false };
    stage.invalidate();
    ed.emit('select');
  },
  move(e, pt, stage) {
    const d = stage.pinDrag;
    if (!d) return;
    const ed = stage.ed;
    // نحسب الإزاحة في فضاء الصورة غير المشوَّه
    const [x, y] = toLocal(ed, d.layer, pt);
    if (!d.moved && Math.hypot(x - d.x0, y - d.y0) < 2) return;
    d.moved = true;
    const lt = ed.time;
    const tx = (d.layer.tracks[pinTrack(d.pin.id, 'x')] ||= []);
    const ty = (d.layer.tracks[pinTrack(d.pin.id, 'y')] ||= []);
    // إن كان هذا أول تحريك للدبوس بعد الزمن 0 فاحفظ وضع الراحة في البداية
    if (!tx.length && lt > 0) { setKey(tx, 0, 0); setKey(ty, 0, 0); }
    setKey(tx, lt, round(d.dx0 + x - d.x0), 'easeInOut');
    setKey(ty, lt, round(d.dy0 + y - d.y0), 'easeInOut');
    ed.live();
  },
  up(e, pt, stage) {
    const d = stage.pinDrag;
    stage.pinDrag = null;
    if (d?.moved) stage.ed.commit();
  },
  overlay(ctx, stage) {
    stage.drawSelection(ctx, true);
    const ed = stage.ed, l = ed.layer;
    if (!l?.puppet) return;
    const m = multiply(stage.view, fullMatrix(ed.project, l, ed.time));
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const p of currentPins(l, ed.time)) {
      const [sx, sy] = apply(m, p.x + p.dx, p.y + p.dy);
      ctx.fillStyle = p.id === ed.selectedPin ? '#ffb000' : '#ffd23f';
      ctx.strokeStyle = '#1b1822'; ctx.lineWidth = 3 * stage.dpr;
      ctx.beginPath(); ctx.arc(sx, sy, 11 * stage.dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }
};

propSections.push((ed, layer) => {
  const a = getAsset(ed.project, layer.assetId);
  if (!isImage(a)) return null;
  const pp = layer.puppet;
  const sec = h('section.sec', h('h3', icon('pin', 18), ' دبابيس الدمية والتشويه'));
  sec.append(h('p.muted', 'ضع دبابيس على الغصن أو القماش، ثم انقل المؤشر الزمني واسحب أحدها فينثني بنعومة. كل سحبة تصنع مفتاحًا.'));
  sec.append(h('div.btn-grid',
    btn('pin', 'أداة الدبابيس', () => { ed.tool = 'puppet'; ed.emit('tool'); }, { testid: 'puppet-tool' }),
    btn('layers', 'شبكة تشويه 3×3', () => {
      layer.puppet ||= { pins: [] };
      for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) layer.puppet.pins.push({ id: uid('pin').slice(0, 10), x: round(a.width * (0.1 + 0.4 * i)), y: round(a.height * (0.1 + 0.4 * j)) });
      ed.tool = 'puppet'; ed.emit('tool'); ed.commit(); ed.emit('select');
    }, { testid: 'mesh-grid' })));
  if (pp?.pins?.length) {
    sec.append(h('p.muted', `${pp.pins.length} دبوس.`));
    sec.append(h('div.btn-grid',
      btn('trash', 'حذف الدبوس المختار', () => {
        const id = ed.selectedPin;
        if (!id) return toast('اختر دبوسًا بلمسه');
        pp.pins = pp.pins.filter((p) => p.id !== id);
        delete layer.tracks[pinTrack(id, 'x')]; delete layer.tracks[pinTrack(id, 'y')];
        ed.commit(); ed.emit('select');
      }),
      btn('close', 'إزالة كل الدبابيس', () => {
        for (const p of pp.pins) { delete layer.tracks[pinTrack(p.id, 'x')]; delete layer.tracks[pinTrack(p.id, 'y')]; }
        delete layer.puppet; ed.commit(); ed.emit('select');
      }, { cls: 'danger' })));
  }
  return sec;
});
