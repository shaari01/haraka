// المرحلة 3: مسار الحركة المرسوم، والتسجيل الحي، والربط (Parenting)، والعنصر المركّب
import { h, btn, toast, promptBox } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { stageTools, overlays } from '../ui/stage.js';
import { toolbarTools, editorPlugins, playbackHooks } from '../ui/editor.js';
import { propSections, sceneSections } from '../ui/props.js';
import { libraryCreators } from '../ui/library.js';
import { evalHooks, getLayer, getAsset, worldMatrix, evalLayer, createAsset, createLayer } from '../core/project.js';
import { registerLayerRenderer, drawLayer } from '../core/renderer.js';
import { getEase, EASES } from '../core/easing.js';
import { simplify, smoothPath, pointAt, samplesToKeys } from '../core/path.js';
import { invert, apply, multiply, translate, decompose, uid } from '../core/math.js';
import { snapToFrame } from '../core/keyframes.js';

// ——— حساب مسار الحركة: يتقدم العنصر على المسار بين زمن البداية والنهاية ———
evalHooks.unshift((layer, t, out) => {
  const p = layer.path;
  if (!p?.pts?.length || p.enabled === false) return;
  const span = Math.max(1e-3, p.end - p.start);
  const raw = Math.max(0, Math.min(1, (t - p.start) / span));
  const u = getEase(p.ease || 'easeInOut')(raw);
  const [x, y, a] = pointAt(p.pts, u);
  out.x = x; out.y = y;
  if (p.orient) out.rotation += a;
});

/** مصفوفة فضاء الأم (لتحويل نقاط المشهد إلى إحداثيات الطبقة) */
function parentSpace(project, layer, t) {
  if (!layer.parentId) return [1, 0, 0, 1, 0, 0];
  const parent = getLayer(project, layer.parentId);
  if (!parent) return [1, 0, 0, 1, 0, 0];
  const pa = getAsset(project, parent.assetId);
  return multiply(worldMatrix(project, parent, t), translate(parent.anchorX * (pa?.width || 100), parent.anchorY * (pa?.height || 100)));
}

// ——— أداة رسم المسار ———
toolbarTools.push({ id: 'path', icon: 'path', label: 'رسم مسار حركة', help: 'ارسم بإصبعك المسار الذي يسير عليه العنصر المختار' });
stageTools.path = {
  down(e, pt, stage) {
    const ed = stage.ed;
    if (!ed.layer) { toast('اختر عنصرًا أولًا، ثم ارسم مساره', 'error'); return; }
    stage.drawing = [[pt.x, pt.y]];
  },
  move(e, pt, stage) {
    if (!stage.drawing) return;
    const last = stage.drawing[stage.drawing.length - 1];
    if (Math.hypot(pt.x - last[0], pt.y - last[1]) > 2 / stage.view[0]) { stage.drawing.push([pt.x, pt.y]); stage.invalidate(); }
  },
  up(e, pt, stage) {
    const ed = stage.ed, l = ed.layer, pts = stage.drawing;
    stage.drawing = null;
    if (!l || !pts || pts.length < 3) { stage.invalidate(); return; }
    const inv = invert(parentSpace(ed.project, l, ed.time));
    const local = pts.map(([x, y]) => apply(inv, x, y));
    const smooth = smoothPath(simplify(local, 1.5 / stage.view[0]), 160);
    const start = l.path?.start ?? ed.time;
    l.path = { pts: smooth, start, end: l.path?.end ?? Math.min(ed.project.duration, start + 2), ease: l.path?.ease || 'easeInOut', orient: !!l.path?.orient };
    if (l.path.end <= l.path.start) l.path.end = Math.min(ed.project.duration, l.path.start + 1);
    ed.commit();
    ed.emit('select');
    toast('سيسير العنصر على المسار. عدّل التوقيت من «الخصائص»');
  },
  overlay(ctx, stage) {
    stage.drawSelection(ctx);
    if (stage.drawing) {
      ctx.save();
      ctx.setTransform(...stage.view);
      ctx.strokeStyle = '#4cc9f0'; ctx.lineWidth = 4 / stage.view[0]; ctx.lineJoin = ctx.lineCap = 'round';
      ctx.beginPath();
      stage.drawing.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.restore();
    }
  }
};

// إظهار مسار العنصر المختار دائمًا
overlays.push((ctx, stage) => {
  const ed = stage.ed, l = ed.layer;
  if (!l?.path?.pts?.length) return;
  const m = multiply(stage.view, parentSpace(ed.project, l, ed.time));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = 'rgba(76,201,240,.9)';
  ctx.lineWidth = 2 * stage.dpr;
  ctx.setLineDash([8 * stage.dpr, 6 * stage.dpr]);
  ctx.beginPath();
  l.path.pts.forEach(([x, y], i) => { const [sx, sy] = apply(m, x, y); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
  ctx.stroke();
  ctx.setLineDash([]);
  const [ex, ey] = apply(m, ...l.path.pts[l.path.pts.length - 1]);
  ctx.fillStyle = '#4cc9f0';
  ctx.beginPath(); ctx.arc(ex, ey, 6 * stage.dpr, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
});

// ——— التسجيل الحي (أسلوب Procreate Dreams) ———
toolbarTools.push({ id: 'perform', icon: 'record', label: 'تسجيل حي', help: 'اضغط مطولًا وحرّك العنصر بإصبعك: تُسجَّل الحركة كما أديتها أثناء التشغيل' });
stageTools.perform = {
  down(e, pt, stage) {
    const ed = stage.ed;
    const l = ed.layer || stage.hitTest(pt.x, pt.y);
    if (!l) { toast('اختر العنصر الذي تريد تسجيل حركته', 'error'); return; }
    ed.select(l.id);
    const s = evalLayer(l, ed.time);
    const inv = invert(parentSpace(ed.project, l, ed.time));
    const [px, py] = apply(inv, pt.x, pt.y);
    stage.rec = { layer: l, t0: ed.time, off: [s.x - px, s.y - py], inv, samples: [], last: pt, lastT: ed.time, done: false };
    // احذف مسار الحركة لأن التسجيل يحدد الموضع
    if (l.path) l.path.enabled = false;
    stage.rec.samples.push({ t: ed.time, x: s.x, y: s.y });
    ed.editor.play();
  },
  move(e, pt, stage) { if (stage.rec) stage.rec.last = pt; },
  up(e, pt, stage) { finishRecording(stage); },
  overlay(ctx, stage) {
    stage.drawSelection(ctx);
    if (stage.rec) {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#ff3b4e';
      ctx.beginPath(); ctx.arc(24 * stage.dpr, 24 * stage.dpr, 10 * stage.dpr, 0, Math.PI * 2); ctx.fill();
      ctx.font = `${16 * stage.dpr}px Tajawal, sans-serif`; ctx.fillText('تسجيل', 40 * stage.dpr, 30 * stage.dpr);
      ctx.restore();
    }
  }
};
playbackHooks.tick.push((ed) => {
  const stage = ed.editor?.stage;
  const r = stage?.rec;
  if (!r || r.done) return;
  if (ed.time < r.lastT) { finishRecording(stage); return; } // وصلنا لنهاية المشهد
  r.lastT = ed.time;
  const [px, py] = apply(r.inv, r.last.x, r.last.y);
  const x = px + r.off[0], y = py + r.off[1];
  r.samples.push({ t: ed.time, x, y });
  // معاينة فورية للحركة
  r.layer.props.x = x; r.layer.props.y = y;
  const saved = r.layer.tracks;
  if (!r.hidTracks) { r.hidTracks = { x: saved.x, y: saved.y }; delete saved.x; delete saved.y; }
});

function finishRecording(stage) {
  const r = stage.rec;
  if (!r || r.done) return;
  r.done = true;
  stage.rec = null;
  const ed = stage.ed;
  ed.editor.stop();
  const l = r.layer;
  // أعد المفاتيح القديمة ثم استبدل الجزء المسجَّل فقط
  if (r.hidTracks) { if (r.hidTracks.x) l.tracks.x = r.hidTracks.x; if (r.hidTracks.y) l.tracks.y = r.hidTracks.y; }
  if (r.samples.length < 3) { ed.commit(); return; }
  const fps = ed.project.fps;
  const keys = samplesToKeys(r.samples, { smooth: 3, tol: 1.2 });
  const t0 = r.samples[0].t, t1 = r.samples[r.samples.length - 1].t;
  for (const k of ['x', 'y']) {
    const old = (l.tracks[k] || []).filter((key) => key.t < t0 - 1e-4 || key.t > t1 + 1e-4);
    const add = keys[k].map((key) => ({ ...key, t: snapToFrame(key.t, fps) }));
    const merged = [...old, ...add].sort((a, b) => a.t - b.t).filter((key, i, arr) => i === 0 || Math.abs(key.t - arr[i - 1].t) > 1e-4);
    l.tracks[k] = merged;
  }
  ed.setTime(t0);
  ed.commit();
  ed.emit('select');
  toast(`سُجّلت الحركة: ${keys.x.length} مفتاحًا خلال ${(t1 - t0).toFixed(1)} ث`);
}

// ——— لوحة الخصائص: المسار والربط ———
propSections.push((ed, layer) => {
  const sec = h('section.sec', h('h3', icon('path', 18), ' مسار الحركة'));
  const p = layer.path;
  if (!p || p.enabled === false) {
    sec.append(h('p.muted', 'اختر أداة «رسم مسار حركة» من شريط الأدوات وارسم بإصبعك الطريق الذي يسير عليه العنصر.'),
      btn('path', 'ارسم مسارًا الآن', () => { ed.tool = 'path'; ed.emit('tool'); }, { testid: 'draw-path' }));
    if (p) sec.append(btn('check', 'إعادة تفعيل المسار السابق', () => { p.enabled = true; ed.commit(); ed.emit('select'); }));
    return sec;
  }
  const num = (label, key) => {
    const i = h('input.num', { type: 'number', step: 0.1, min: 0, max: ed.project.duration, value: p[key], 'aria-label': label, onchange: () => { const v = parseFloat(i.value); if (!isNaN(v)) { p[key] = Math.max(0, Math.min(ed.project.duration, v)); ed.commit(); } } });
    return h('label.field', h('span', label), i);
  };
  const orient = h('input', { type: 'checkbox', checked: !!p.orient, 'data-testid': 'path-orient', onchange: () => { p.orient = orient.checked; ed.commit(); } });
  const ease = h('select', { 'aria-label': 'منحنى السرعة على المسار', onchange: () => { p.ease = ease.value; ed.commit(); } },
    Object.entries(EASES).map(([id, e]) => h('option', { value: id, selected: p.ease === id }, e.label)));
  sec.append(
    h('div.mod-ctl', num('يبدأ عند (ث)', 'start'), num('ينتهي عند (ث)', 'end')),
    h('label.field', h('span', 'منحنى السرعة'), ease),
    h('label.field.row', orient, h('span', 'اتجه مع المسار')),
    h('div.btn-grid',
      btn('path', 'أعد الرسم', () => { ed.tool = 'path'; ed.emit('tool'); }),
      btn('trash', 'احذف المسار', () => { delete layer.path; ed.commit(); ed.emit('select'); }, { cls: 'danger', testid: 'remove-path' }))
  );
  return sec;
});

function descendants(project, id) {
  const out = new Set();
  const walk = (pid) => { for (const l of project.layers) if (l.parentId === pid && !out.has(l.id)) { out.add(l.id); walk(l.id); } };
  walk(id);
  return out;
}

/** ربط طبقة بأم مع الحفاظ على مكانها الظاهر */
export function reparent(project, layer, parentId, t) {
  const asset = getAsset(project, layer.assetId);
  const w = asset?.width || 100, hh = asset?.height || 100;
  const before = evalLayer(layer, t);
  const W = worldMatrix(project, layer, t);
  layer.parentId = parentId;
  const P = parentSpace(project, layer, t);
  const L = multiply(multiply(invert(P), W), translate(layer.anchorX * w, layer.anchorY * hh));
  const d = decompose(L);
  const delta = { x: d.x - before.x, y: d.y - before.y, rotation: d.rotation - before.rotation, scale: before.scale ? d.scale / before.scale : 1 };
  // اضبط الحالة الثابتة والمفاتيح بنفس الفرق حتى لا يقفز العنصر
  for (const k of ['x', 'y', 'rotation']) {
    layer.props[k] += delta[k];
    for (const key of layer.tracks[k] || []) key.v += delta[k];
  }
  layer.props.scale *= delta.scale;
  for (const key of layer.tracks.scale || []) key.v *= delta.scale;
  for (const k of ['x', 'y', 'rotation', 'scale']) {
    const v = layer.props[k];
    layer.props[k] = Math.round(v * 1000) / 1000;
  }
}

propSections.push((ed, layer) => {
  const p = ed.project;
  const blocked = descendants(p, layer.id);
  const sel = h('select', { 'aria-label': 'اربط بعنصر', 'data-testid': 'parent-select', onchange: () => {
    reparent(p, layer, sel.value || null, ed.time);
    ed.commit();
    toast(sel.value ? 'صار العنصر يتبع أمه في الحركة' : 'فُك الربط');
  } },
  h('option', { value: '' }, '— بلا ربط —'),
  p.layers.filter((l) => l.id !== layer.id && !blocked.has(l.id)).map((l) => h('option', { value: l.id, selected: layer.parentId === l.id }, l.name)));
  return h('section.sec', h('h3', icon('link', 18), ' الربط (Parenting)'),
    h('p.muted', 'اربط الذراع بالجسم فتتبعه في الموضع والدوران والحجم، وتبقى حركتها الخاصة.'),
    h('label.field', h('span', 'يتبع'), sel),
    btn('group', 'حوّله مع أبنائه إلى عنصر مركّب', () => makeComposite(ed, layer), { testid: 'make-comp' }));
});

// ——— العنصر المركّب: مجموعة عناصر متحركة تُحفظ كعنصر واحد يُعاد استخدامه ———
registerLayerRenderer('comp', (ctx, { project, asset, src, m, t, opts, layer, s }) => {
  const lt = t - (layer.start || 0);
  const sub = { ...project, layers: asset.layers || [], width: asset.width, height: asset.height };
  const depth = (opts.compDepth || 0) + 1;
  if (depth > 6) return;
  const cache = new Map();
  for (const l of sub.layers) {
    if (!l.visible) continue;
    const a = getAsset(project, l.assetId);
    const st = evalLayer(l, lt);
    if (st.opacity <= 0.001) continue;
    const wm = multiply(m, worldMatrix(sub, l, lt, cache));
    drawLayer(ctx, sub, l, a, st, wm, lt, { ...opts, compDepth: depth, alphaMul: (opts.alphaMul ?? 1) * Math.max(0, Math.min(1, s.opacity)) });
  }
});

async function makeComposite(ed, layer) {
  const p = ed.project;
  const name = await promptBox('اسم العنصر المركّب', layer.name + ' (مركّب)');
  if (!name) return;
  const ids = new Set([layer.id, ...descendants(p, layer.id)]);
  const moved = p.layers.filter((l) => ids.has(l.id));
  const asset = createAsset('comp', { name, width: p.width, height: p.height, layers: moved, icon: 'group' });
  p.assets.push(asset);
  const idx = p.layers.findIndex((l) => ids.has(l.id));
  p.layers = p.layers.filter((l) => !ids.has(l.id));
  const inst = createLayer(p, asset);
  inst.props.scale = 1;
  inst.start = 0;
  p.layers.splice(Math.max(0, idx), 0, inst);
  ed.select(inst.id);
  ed.commit();
  toast(`صار «${name}» عنصرًا مركّبًا في المكتبة. أضف منه نسخًا كما تشاء`);
}

// تعديل العنصر المركّب: ندخل إليه فتصبح طبقاته هي طبقات المشهد مؤقتًا
editorPlugins.push((editor) => {
  const ed = editor.ed;
  ed.assetMenuExtras ||= [];
  ed.assetMenuExtras.push((a) => a.type === 'comp' && !ed.project.editingComp ? [{ icon: 'group', label: 'تعديل محتواه (يتغير في كل النسخ)', onClick: () => enterComp(ed, a) }] : []);
  const banner = h('div.comp-banner', { hidden: true });
  editor.stage.el.append(banner);
  const update = () => {
    const ec = ed.project.editingComp;
    banner.hidden = !ec;
    if (ec) {
      const a = getAsset(ed.project, ec.assetId);
      banner.replaceChildren(h('span', 'تعديل العنصر المركّب: ', h('strong', a?.name || '')), btn('check', 'إنهاء التعديل', () => exitComp(ed), { cls: 'primary', testid: 'exit-comp' }));
    }
  };
  ed.on('change', update);
  update();
});

function enterComp(ed, asset) {
  const p = ed.project;
  p.editingComp = { assetId: asset.id, mainLayers: p.layers };
  p.layers = asset.layers || [];
  delete asset.layers;
  ed.select(null);
  ed.commit();
}
function exitComp(ed) {
  const p = ed.project, ec = p.editingComp;
  if (!ec) return;
  const a = getAsset(p, ec.assetId);
  if (a) a.layers = p.layers;
  p.layers = ec.mainLayers;
  delete p.editingComp;
  ed.select(null);
  ed.commit();
}
export { enterComp, exitComp };
