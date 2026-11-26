// العارض: يرسم إطار المشهد عند زمن t. نفس العارض للمعاينة والتصدير، فما تراه هو ما يُصدَّر.
import { getAsset, evalLayer, worldMatrix, isLayerActive } from './project.js';
import { multiply, scale as mScale } from './math.js';

const layerRenderers = new Map(); // نوع العنصر -> دالة رسم خاصة (تضيفها المراحل اللاحقة)
const layerDecorators = []; // دوال تعدل طريقة رسم الطبقة (كشف الكتابة، التشويه...)
const sceneHooks = { camera: null, post: [] };

export function registerLayerRenderer(type, fn) { layerRenderers.set(type, fn); }
export const getLayerRenderer = (type) => layerRenderers.get(type);
export function registerDecorator(fn) { layerDecorators.push(fn); }
export function registerCamera(fn) { sceneHooks.camera = fn; }
export function registerPost(fn) { sceneHooks.post.push(fn); }

let scratch = null;
function scratchCanvas(w, h, i = 0) {
  scratch ||= [];
  let c = scratch[i];
  if (!c) { c = scratch[i] = document.createElement('canvas'); }
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
}
export { scratchCanvas };

/**
 * @param ctx سياق الرسم
 * @param project المشروع
 * @param t الزمن بالثواني
 * @param opts { cache, outW, outH, transparent, viewMatrix, quality }
 */
export function renderFrame(ctx, project, t, opts = {}) {
  const outW = opts.outW ?? ctx.canvas.width;
  const outH = opts.outH ?? ctx.canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, outW, outH);
  // مصفوفة العرض: من إحداثيات المشروع إلى بكسلات المخرج
  const view = opts.viewMatrix || mScale(outW / project.width, outH / project.height);
  if (!opts.transparent && project.background) {
    ctx.setTransform(...view);
    ctx.fillStyle = project.background;
    ctx.fillRect(0, 0, project.width, project.height);
  }
  const camera = sceneHooks.camera ? sceneHooks.camera(project, t) : null;
  const cache = new Map();
  const pxScale = Math.hypot(view[0], view[1]);
  for (const layer of project.layers) {
    if (!isLayerActive(layer, t, project.duration)) continue;
    if (layer.hidden || layer.isCamera) continue;
    const asset = getAsset(project, layer.assetId);
    const s = evalLayer(layer, t);
    if (s.opacity <= 0.001) continue;
    let m = worldMatrix(project, layer, t, cache);
    let base = view;
    if (camera) base = multiply(view, camera.matrixFor(layer));
    m = multiply(base, m);
    drawLayer(ctx, project, layer, asset, s, m, t, { ...opts, pxScale: pxScale * (camera?.zoom || 1) });
  }
  for (const fn of sceneHooks.post) fn(ctx, project, t, { view, outW, outH, ...opts });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
}

export function drawLayer(ctx, project, layer, asset, s, m, t, opts) {
  const custom = asset && layerRenderers.get(asset.type);
  const src = asset ? opts.cache?.get(asset.id) : null;
  const w = asset?.width || 100, h = asset?.height || 100;
  const filters = [];
  const k = Math.hypot(m[0], m[1]) || 1;
  if (s.blur > 0) filters.push(`blur(${(s.blur * k).toFixed(2)}px)`);
  if (s.brightness !== 1) filters.push(`brightness(${s.brightness})`);
  const tinted = s.tintAmount > 0.001;

  const paint = (c, mm) => {
    c.setTransform(...mm);
    let drawn = false;
    for (const dec of layerDecorators) {
      if (dec(c, { project, layer, asset, src, s, m: mm, t, opts, w, h })) { drawn = true; break; }
    }
    if (drawn) return;
    if (custom) custom(c, { project, layer, asset, src, s, m: mm, t, opts, w, h });
    else if (src) c.drawImage(src, 0, 0, w, h);
    else {
      // عنصر لم يُحمّل بعد: مستطيل مؤقت
      c.fillStyle = 'rgba(128,128,128,.35)';
      c.fillRect(0, 0, w, h);
    }
  };

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, s.opacity)) * (opts.alphaMul ?? 1);
  if (layer.blend && layer.blend !== 'normal') ctx.globalCompositeOperation = layer.blend;
  if (!tinted) {
    ctx.filter = filters.length ? filters.join(' ') : 'none';
    paint(ctx, m);
  } else {
    // التلوين: نرسم الطبقة في لوح جانبي ونصبغها ثم نركّبها
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    const off = scratchCanvas(cw, ch, 1);
    const o = off.getContext('2d');
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.globalAlpha = 1; o.filter = 'none'; o.globalCompositeOperation = 'source-over';
    o.clearRect(0, 0, cw, ch);
    paint(o, m);
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.globalCompositeOperation = 'source-atop';
    o.globalAlpha = s.tintAmount;
    o.fillStyle = s.tint;
    o.fillRect(0, 0, cw, ch);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = filters.length ? filters.join(' ') : 'none';
    ctx.drawImage(off, 0, 0);
  }
  ctx.restore();
}

export function cameraAt(project, t) { return sceneHooks.camera ? sceneHooks.camera(project, t) : null; }

/** مصفوفة الطبقة كما تظهر في المشهد (مع الكاميرا والعمق) */
export function fullMatrix(project, layer, t) {
  const w = worldMatrix(project, layer, t);
  const cam = cameraAt(project, t);
  return cam ? multiply(cam.matrixFor(layer), w) : w;
}

/** صندوق الطبقة في إحداثيات المشروع (أربع زوايا) */
export function layerCorners(project, layer, t) {
  const asset = getAsset(project, layer.assetId);
  const w = asset?.width || 100, h = asset?.height || 100;
  const m = fullMatrix(project, layer, t);
  return [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
}
