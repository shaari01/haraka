// نموذج البيانات: مشروع ← عناصر في المكتبة (تُخزَّن مرة واحدة) ← طبقات هي نسخ مرتبطة منها
import { uid, multiply, translate, rotate, scale, skewX, identity } from './math.js';
import { valueAt } from './keyframes.js';

export const PROJECT_VERSION = 1;

/** تعريف الخصائص القابلة للتحريك */
export const PROPS = {
  x: { label: 'الموضع أفقيًا', def: 0, step: 1, unit: 'px', group: 'transform' },
  y: { label: 'الموضع رأسيًا', def: 0, step: 1, unit: 'px', group: 'transform' },
  scale: { label: 'الحجم', def: 1, step: 0.01, min: 0, max: 20, unit: '×', group: 'transform', pct: true },
  rotation: { label: 'الدوران', def: 0, step: 1, unit: '°', group: 'transform' },
  opacity: { label: 'الشفافية', def: 1, step: 0.01, min: 0, max: 1, unit: '', group: 'transform', pct: true },
  skewX: { label: 'الميل', def: 0, step: 1, min: -80, max: 80, unit: '°', group: 'look' },
  blur: { label: 'الضبابية', def: 0, step: 0.5, min: 0, max: 100, unit: 'px', group: 'look' },
  brightness: { label: 'السطوع', def: 1, step: 0.01, min: 0, max: 3, unit: '', group: 'look', pct: true },
  tintAmount: { label: 'قوة اللون', def: 0, step: 0.01, min: 0, max: 1, unit: '', group: 'look', pct: true },
  tint: { label: 'اللون', def: '#ffc857', type: 'color', group: 'look' }
};
export const PROP_KEYS = Object.keys(PROPS);
export const PHASE1_PROPS = ['x', 'y', 'scale', 'rotation', 'opacity'];

export const SIZE_PRESETS = [
  { id: '1:1', label: 'مربع 1:1', w: 1080, h: 1080 },
  { id: '9:16', label: 'طولي 9:16', w: 1080, h: 1920 },
  { id: '16:9', label: 'عرضي 16:9', w: 1920, h: 1080 },
  { id: '4:5', label: 'إنستغرام 4:5', w: 1080, h: 1350 }
];

export function createProject(opts = {}) {
  const preset = SIZE_PRESETS.find((p) => p.id === opts.preset) || SIZE_PRESETS[0];
  return {
    v: PROJECT_VERSION,
    id: uid('prj'),
    name: opts.name || 'مشروع جديد',
    width: opts.width || preset.w,
    height: opts.height || preset.h,
    fps: opts.fps || 30,
    duration: opts.duration || 5,
    background: opts.background ?? '#ffffff',
    assets: [],
    layers: [], // من الأسفل إلى الأعلى
    markers: [],
    created: Date.now(),
    updated: Date.now()
  };
}

export function createAsset(type, props = {}) {
  return { id: uid('ast'), type, name: props.name || 'عنصر', width: props.width || 100, height: props.height || 100, ...props };
}

export function createLayer(project, asset, overrides = {}) {
  const props = {};
  for (const k of PROP_KEYS) props[k] = PROPS[k].def;
  props.x = project.width / 2;
  props.y = project.height / 2;
  // اجعل العنصر يتسع في المشهد إن كان أكبر منه
  const fit = Math.min(1, (project.width * 0.8) / (asset.width || 1), (project.height * 0.8) / (asset.height || 1));
  props.scale = Math.round(fit * 1000) / 1000;
  return {
    id: uid('lyr'),
    assetId: asset.id,
    name: asset.name,
    visible: true,
    locked: false,
    parentId: null,
    anchorX: 0.5,
    anchorY: 0.5,
    start: 0, // بداية ظهور الطبقة
    end: null, // null = حتى النهاية
    props,
    tracks: {},
    ...overrides
  };
}

export const getAsset = (project, id) => project.assets.find((a) => a.id === id);
export const getLayer = (project, id) => project.layers.find((l) => l.id === id);
export const instancesOf = (project, assetId) => project.layers.filter((l) => l.assetId === assetId);

/** مدى المفاتيح (أول وآخر مفتاح) في كل خصائص الطبقة */
export function keyRange(layer) {
  let a = Infinity, b = -Infinity;
  for (const k in layer.tracks) {
    const tr = layer.tracks[k];
    if (!tr?.length) continue;
    a = Math.min(a, tr[0].t);
    b = Math.max(b, tr[tr.length - 1].t);
  }
  return a < b ? [a, b] : null;
}

/**
 * الزمن المحلي للطبقة بعد تطبيق التكرار:
 * loop = {mode: 'loop' | 'pingpong', count: 0 (بلا نهاية) أو عدد المرات}
 */
export function layerTime(layer, t) {
  const lp = layer.loop;
  if (!lp || !lp.mode || lp.mode === 'none') return t;
  const r = keyRange(layer);
  if (!r || t <= r[1]) return t;
  const [a, b] = r, len = b - a;
  const n = Math.floor((t - a) / len);
  if (lp.count && n >= lp.count) {
    // انتهى عدد التكرار: يبقى على آخر حالة
    return lp.mode === 'pingpong' && lp.count % 2 === 0 ? a : b;
  }
  const f = (t - a) - n * len;
  if (lp.mode === 'pingpong' && n % 2 === 1) return b - f;
  return a + f;
}

/** معدّلات تضاف بعد المفاتيح (حركات مستمرة مثل النبض والاهتزاز، ومسار الحركة) */
export const evalHooks = [];

/** قيم كل الخصائص للطبقة عند الزمن t */
export function evalLayer(layer, t) {
  const lt = layerTime(layer, t);
  const out = {};
  for (const k of PROP_KEYS) out[k] = valueAt(layer.tracks[k], lt, layer.props[k]);
  for (const fn of evalHooks) fn(layer, t, out, lt);
  return out;
}

export function localMatrix(layer, asset, s) {
  const w = asset?.width || 100, h = asset?.height || 100;
  let m = translate(s.x, s.y);
  m = multiply(m, rotate(s.rotation));
  if (s.skewX) m = multiply(m, skewX(s.skewX));
  m = multiply(m, scale(s.scale));
  m = multiply(m, translate(-layer.anchorX * w, -layer.anchorY * h));
  return m;
}

/** المصفوفة العالمية مع اتباع الطبقة الأم (الربط) */
export function worldMatrix(project, layer, t, cache = new Map(), depth = 0) {
  const key = layer.id;
  if (cache.has(key)) return cache.get(key);
  const asset = getAsset(project, layer.assetId);
  const s = evalLayer(layer, t);
  let m = localMatrix(layer, asset, s);
  if (layer.parentId && depth < 32) {
    const parent = getLayer(project, layer.parentId);
    if (parent) {
      const pa = getAsset(project, parent.assetId);
      // الابن يتبع تحويل الأم دون إزاحة نقطة ارتكازها
      const pm = worldMatrix(project, parent, t, cache, depth + 1);
      const unAnchor = translate(parent.anchorX * (pa?.width || 100), parent.anchorY * (pa?.height || 100));
      m = multiply(multiply(pm, unAnchor), m);
    }
  }
  cache.set(key, m);
  return m;
}

export function isLayerActive(layer, t, duration) {
  if (!layer.visible) return false;
  const end = layer.end == null ? duration + 1 : layer.end;
  return t >= (layer.start || 0) - 1e-6 && t <= end + 1e-6;
}

/** ترحيل المشاريع القديمة إن تغير شكل البيانات */
export function migrate(p) {
  p.markers ||= [];
  for (const l of p.layers) {
    for (const k of PROP_KEYS) if (l.props[k] === undefined) l.props[k] = PROPS[k].def;
    l.tracks ||= {};
  }
  return p;
}

export { identity };
