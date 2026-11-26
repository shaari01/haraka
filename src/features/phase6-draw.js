// المرحلة 6 (ب): الرسم إطارًا بإطار مع قشرة البصل
import { h, btn, toast } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { stageTools } from '../ui/stage.js';
import { toolbarTools, editorPlugins } from '../ui/editor.js';
import { propSections } from '../ui/props.js';
import { libraryCreators } from '../ui/library.js';
import { registerLayerRenderer, fullMatrix } from '../core/renderer.js';
import { registerPrepare } from '../export/frames.js';
import { createAsset, getAsset } from '../core/project.js';
import { invert, apply, multiply, uid, hexToRgb } from '../core/math.js';
import { putBlob, getBlob } from '../storage/db.js';

// إطارات الرسم في الذاكرة: blobKey -> canvas
const frameCanvases = new Map();
const loading = new Map();
let notify = () => {};

function blankCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

export function frameCanvas(asset, frame) {
  if (!frame.blobKey) {
    let c = frameCanvases.get(frame.tmp);
    if (!c) { frame.tmp ||= uid('tmp'); c = blankCanvas(asset.width, asset.height); frameCanvases.set(frame.tmp, c); }
    return c;
  }
  const c = frameCanvases.get(frame.blobKey);
  if (c) return c;
  if (!loading.has(frame.blobKey)) {
    const key = frame.blobKey;
    loading.set(key, getBlob(key).then(async (b) => {
      const c2 = blankCanvas(asset.width, asset.height);
      if (b) { const bm = await createImageBitmap(b); c2.getContext('2d').drawImage(bm, 0, 0); }
      frameCanvases.set(key, c2);
      loading.delete(key);
      notify();
    }));
  }
  return null;
}

/** الإطار المعروض عند الزمن t: كل إطار يدوم 1 أو 2 أو 3 إطارات من سرعة المشروع، ثم يتكرر */
export function frameIndexAt(asset, t, fps) {
  const frames = asset.frames || [];
  if (!frames.length) return -1;
  const total = frames.reduce((s, f) => s + (f.hold || 1), 0);
  let n = Math.floor(t * fps + 1e-6);
  n = asset.loop === false ? Math.min(n, total - 1) : ((n % total) + total) % total;
  for (let i = 0; i < frames.length; i++) { n -= frames[i].hold || 1; if (n < 0) return i; }
  return frames.length - 1;
}
export function frameStart(asset, i, fps) {
  let n = 0;
  for (let j = 0; j < i; j++) n += asset.frames[j].hold || 1;
  return n / fps;
}

registerLayerRenderer('drawing', (c, { asset, layer, t, project }) => {
  const i = frameIndexAt(asset, t - (layer.start || 0), project.fps);
  if (i < 0) return;
  const fc = frameCanvas(asset, asset.frames[i]);
  if (fc) c.drawImage(fc, 0, 0, asset.width, asset.height);
});

registerPrepare(async (project) => {
  const waits = [];
  for (const a of project.assets) if (a.type === 'drawing') for (const f of a.frames || []) { if (f.blobKey && !frameCanvases.has(f.blobKey)) { frameCanvas(a, f); waits.push(loading.get(f.blobKey)); } }
  await Promise.all(waits);
});

libraryCreators.push({ icon: 'brush', label: 'رسم إطارًا بإطار', testid: 'new-drawing', create: (ed) => {
  const p = ed.project;
  const a = createAsset('drawing', { name: 'رسم ' + (p.assets.filter((x) => x.type === 'drawing').length + 1), width: p.width, height: p.height, frames: [{ id: uid('frm'), hold: 2 }], icon: 'brush' });
  p.assets.push(a);
  const l = ed.editor.library.addInstance(a, false);
  l.props.scale = 1;
  ed.tool = 'draw'; ed.emit('tool');
  ed.commit();
  ed.editor.closePanels?.();
  toast('ارسم بإصبعك. أضف إطارًا جديدًا من «الخصائص»');
} });

// ——— أدوات الرسم ———
const brush = { mode: 'brush', color: '#1d1a25', size: 8, onion: true };
toolbarTools.push({ id: 'draw', icon: 'brush', label: 'الرسم إطارًا بإطار', help: 'ارسم على الإطار الحالي. الإطار السابق يظهر بالأحمر والتالي بالأخضر (قشرة البصل)' });

function currentFrame(ed) {
  const l = ed.layer;
  const a = l && getAsset(ed.project, l.assetId);
  if (a?.type !== 'drawing') return null;
  const i = frameIndexAt(a, ed.time - (l.start || 0), ed.project.fps);
  return { l, a, i, f: a.frames[i] };
}

stageTools.draw = {
  down(e, pt, stage) {
    const ed = stage.ed;
    const cf = currentFrame(ed);
    if (!cf) { toast('اختر طبقة رسم أولًا (المكتبة ← رسم إطارًا بإطار)', 'error'); return; }
    const c = frameCanvas(cf.a, cf.f);
    if (!c) return;
    const inv = invert(fullMatrix(ed.project, cf.l, ed.time));
    const [x, y] = apply(inv, pt.x, pt.y);
    if (brush.mode === 'fill') { floodFill(c, Math.round(x), Math.round(y), brush.color); saveFrame(ed, cf); return; }
    stage.stroke = { cf, c, inv, last: [x, y], pts: [[x, y]] };
    dab(c, x, y, x, y);
    stage.invalidate(); ed.emit('render');
  },
  move(e, pt, stage) {
    const s = stage.stroke;
    if (!s) return;
    const [x, y] = apply(s.inv, pt.x, pt.y);
    // ضغط القلم إن وُجد (قلم سامسونج S Pen)
    const pr = e.pressure && e.pointerType === 'pen' ? 0.3 + e.pressure * 1.2 : 1;
    dab(s.c, s.last[0], s.last[1], x, y, pr);
    s.last = [x, y];
    stage.ed.emit('render');
  },
  up(e, pt, stage) {
    const s = stage.stroke;
    stage.stroke = null;
    if (s) saveFrame(stage.ed, s.cf);
  },
  overlay(ctx, stage) {
    stage.drawSelection(ctx, true);
    // قشرة البصل
    const ed = stage.ed, cf = currentFrame(ed);
    if (!cf || !brush.onion) return;
    const m = multiply(stage.view, fullMatrix(ed.project, cf.l, ed.time));
    for (const [j, col] of [[cf.i - 1, '#ff3b4e'], [cf.i + 1, '#2ec27e']]) {
      const f = cf.a.frames[j];
      if (!f) continue;
      const c = frameCanvas(cf.a, f);
      if (!c) continue;
      const tinted = tint(c, col);
      ctx.save(); ctx.setTransform(...m); ctx.globalAlpha = 0.3;
      ctx.drawImage(tinted, 0, 0, cf.a.width, cf.a.height);
      ctx.restore();
    }
  }
};

function tint(src, color) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
  return c;
}

function dab(c, x0, y0, x1, y1, pr = 1) {
  const g = c.getContext('2d');
  g.save();
  g.lineCap = g.lineJoin = 'round';
  g.lineWidth = brush.size * pr;
  if (brush.mode === 'eraser') { g.globalCompositeOperation = 'destination-out'; g.strokeStyle = '#000'; }
  else g.strokeStyle = brush.color;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1 + 0.01, y1); g.stroke();
  g.restore();
}

async function saveFrame(ed, cf) {
  const c = frameCanvas(cf.a, cf.f);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const key = uid('frmblob');
  await putBlob(key, blob);
  if (cf.f.tmp) frameCanvases.delete(cf.f.tmp);
  delete cf.f.tmp;
  cf.f.blobKey = key;
  frameCanvases.set(key, c);
  ed.commit();
}

/** تعبئة بالدلو (مسح سطري مع تسامح بسيط) */
export function floodFill(c, x, y, color) {
  const g = c.getContext('2d', { willReadFrequently: true });
  const W = c.width, H = c.height;
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  const i0 = (y * W + x) * 4;
  const target = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]];
  const [r, gg, b] = hexToRgb(color);
  const fill = [r, gg, b, 255];
  if (target.every((v, k) => Math.abs(v - fill[k]) < 3)) return;
  const tol = 40;
  const match = (i) => Math.abs(d[i] - target[0]) <= tol && Math.abs(d[i + 1] - target[1]) <= tol && Math.abs(d[i + 2] - target[2]) <= tol && Math.abs(d[i + 3] - target[3]) <= tol;
  const seen = new Uint8Array(W * H);
  const stack = [[x, y]];
  while (stack.length) {
    let [cx, cy] = stack.pop();
    while (cx >= 0 && match((cy * W + cx) * 4) && !seen[cy * W + cx]) cx--;
    cx++;
    let up = false, down = false;
    while (cx < W && match((cy * W + cx) * 4) && !seen[cy * W + cx]) {
      const k = cy * W + cx, i = k * 4;
      seen[k] = 1; d[i] = fill[0]; d[i + 1] = fill[1]; d[i + 2] = fill[2]; d[i + 3] = 255;
      if (cy > 0) { const m = match(((cy - 1) * W + cx) * 4) && !seen[(cy - 1) * W + cx]; if (m && !up) { stack.push([cx, cy - 1]); up = true; } else if (!m) up = false; }
      if (cy < H - 1) { const m = match(((cy + 1) * W + cx) * 4) && !seen[(cy + 1) * W + cx]; if (m && !down) { stack.push([cx, cy + 1]); down = true; } else if (!m) down = false; }
      cx++;
    }
  }
  g.putImageData(img, 0, 0);
}

// ——— لوحة الرسم: الفرشاة والإطارات ———
propSections.unshift((ed, layer) => {
  const a = getAsset(ed.project, layer.assetId);
  if (a?.type !== 'drawing') return null;
  const fps = ed.project.fps;
  const cur = frameIndexAt(a, ed.time - (layer.start || 0), fps);
  const sec = h('section.sec.draw-sec', h('h3', icon('brush', 18), ' الرسم إطارًا بإطار'));
  const modes = [['brush', 'فرشاة', 'brush'], ['eraser', 'ممحاة', 'eraser'], ['fill', 'تعبئة', 'bucket']];
  sec.append(h('div.chips', modes.map(([id, l, ic]) => h('button.chip', { type: 'button', 'aria-pressed': brush.mode === id, dataset: { brush: id }, onclick: () => { brush.mode = id; ed.tool = 'draw'; ed.emit('tool'); ed.emit('select'); } }, icon(ic, 18), l))));
  const col = h('input.color', { type: 'color', value: brush.color, onchange: () => { brush.color = col.value; } });
  const size = h('input.slider', { type: 'range', min: 1, max: 80, value: brush.size, 'aria-label': 'حجم الفرشاة', oninput: () => { brush.size = +size.value; } });
  const onion = h('input', { type: 'checkbox', checked: brush.onion, onchange: () => { brush.onion = onion.checked; ed.editor.stage.invalidate(); } });
  sec.append(h('div.row', col, size), h('label.field.row', onion, h('span', 'قشرة البصل (السابق بالأحمر والتالي بالأخضر)')));
  // شريط الإطارات
  const strip = h('div.frame-strip', { role: 'list' });
  a.frames.forEach((f, i) => {
    const th = h('button.frame-th' + (i === cur ? '.on' : ''), { type: 'button', role: 'listitem', 'aria-label': `الإطار ${i + 1}`, dataset: { frame: i }, onclick: () => { ed.setTime((layer.start || 0) + frameStart(a, i, fps)); ed.emit('select'); } }, h('span', String(i + 1)));
    const c = frameCanvas(a, f);
    if (c) { const tc = document.createElement('canvas'); tc.width = 64; tc.height = Math.round(64 * a.height / a.width); tc.getContext('2d').drawImage(c, 0, 0, tc.width, tc.height); th.prepend(tc); }
    strip.append(th);
  });
  sec.append(strip);
  const f = a.frames[cur];
  if (f) {
    sec.append(h('p.field-label', `مدة الإطار ${cur + 1}`), h('div.seg', [1, 2, 3].map((n) => h('button', { type: 'button', 'aria-pressed': (f.hold || 1) === n, onclick: () => { f.hold = n; ed.commit(); ed.emit('select'); } }, `${n} ${n === 1 ? 'إطار' : 'إطارات'}`))));
  }
  const addFrame = async (copy) => {
    const nf = { id: uid('frm'), hold: f?.hold || 2 };
    if (copy && f) {
      const src = frameCanvas(a, f);
      if (src) {
        const c = blankCanvas(a.width, a.height); c.getContext('2d').drawImage(src, 0, 0);
        const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
        nf.blobKey = uid('frmblob'); await putBlob(nf.blobKey, blob); frameCanvases.set(nf.blobKey, c);
      }
    }
    a.frames.splice(cur + 1, 0, nf);
    ed.commit();
    ed.setTime((layer.start || 0) + frameStart(a, cur + 1, fps));
    ed.emit('select');
  };
  sec.append(h('div.btn-grid',
    btn('plus', 'إطار جديد', () => addFrame(false), { testid: 'add-frame' }),
    btn('copy', 'تكرار الإطار', () => addFrame(true), { testid: 'dup-frame' }),
    btn('trash', 'حذف الإطار', () => { if (a.frames.length > 1) { a.frames.splice(cur, 1); ed.commit(); ed.emit('select'); } }, { cls: 'danger' }),
    btn('brush', 'أداة الرسم', () => { ed.tool = 'draw'; ed.emit('tool'); })));
  const total = a.frames.reduce((s, x) => s + (x.hold || 1), 0);
  sec.append(h('p.muted', `${a.frames.length} إطار، طول الدورة ${(total / fps).toFixed(2)} ث وتتكرر. الرسم مسار عادي في الخط الزمني يُدمج مع العناصر المتحركة.`));
  return sec;
});

editorPlugins.push((editor) => {
  notify = () => { editor.ed.emit('render'); };
});
