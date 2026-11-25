// الحركات الجاهزة: نوعان
// 1) حركات بالمفاتيح (ظهور، اختفاء، دخول من الجانب...) تُضاف مفاتيح حقيقية قابلة للتعديل
// 2) حركات مستمرة (نبض، اهتزاز، دوران، طفو...) تُحسب رياضيًا فوق المفاتيح، كتعبيرات After Effects
import { setKey } from './keyframes.js';
import { evalLayer, evalHooks } from './project.js';

export const KEY_PRESETS = {
  fadeIn: { label: 'ظهور تدريجي', icon: 'eye', dur: 0.6 },
  fadeOut: { label: 'اختفاء', icon: 'eyeOff', dur: 0.6, atEnd: true },
  popIn: { label: 'ظهور بارتداد', icon: 'sparkle', dur: 0.7 },
  zoomIn: { label: 'تكبير من بعيد', icon: 'zoomIn', dur: 0.8 },
  slideRight: { label: 'دخول من اليمين', icon: 'prev', dur: 0.8 },
  slideLeft: { label: 'دخول من اليسار', icon: 'next', dur: 0.8 },
  slideUp: { label: 'دخول من الأسفل', icon: 'chevronUp', dur: 0.8 },
  slideDown: { label: 'دخول من الأعلى', icon: 'chevronDown', dur: 0.8 },
  dropBounce: { label: 'سقوط وارتداد', icon: 'chevronDown', dur: 1 }
};

export const MOD_TYPES = {
  pulse: { label: 'نبض', amount: 0.08, speed: 1.5, unit: 'حجم' },
  shake: { label: 'اهتزاز (Wiggle)', amount: 12, speed: 4, unit: 'بكسل' },
  spin: { label: 'دوران مستمر', amount: 90, speed: 1, unit: 'درجة/ث' },
  float: { label: 'طفو', amount: 20, speed: 0.5, unit: 'بكسل' },
  swing: { label: 'تأرجح', amount: 10, speed: 0.8, unit: 'درجة' },
  blink: { label: 'وميض/توهج', amount: 0.5, speed: 1, unit: 'شفافية' }
};

/** يضيف حركة جاهزة بالمفاتيح للطبقة بدءًا من الزمن t */
export function applyKeyPreset(layer, id, t, project) {
  const p = KEY_PRESETS[id];
  if (!p) return;
  const s = evalLayer(layer, t);
  const d = p.dur;
  const tr = (k) => (layer.tracks[k] ||= []);
  const W = project.width, H = project.height;
  let t0 = t, t1 = t + d;
  if (p.atEnd) { t0 = Math.max(0, t - d); t1 = t; }
  const key = (k, time, v, ease = 'easeOut') => setKey(tr(k), round(time), v, ease);
  switch (id) {
    case 'fadeIn': key('opacity', t0, 0); key('opacity', t1, s.opacity || 1); break;
    case 'fadeOut': key('opacity', t0, s.opacity, 'easeIn'); key('opacity', t1, 0); break;
    case 'popIn': key('scale', t0, 0, 'back'); key('scale', t1, s.scale); key('opacity', t0, 0); key('opacity', t0 + d * 0.3, s.opacity || 1); break;
    case 'zoomIn': key('scale', t0, s.scale * 0.2, 'easeOut'); key('scale', t1, s.scale); key('opacity', t0, 0); key('opacity', t1, s.opacity || 1); break;
    case 'slideRight': key('x', t0, W + 200, 'easeOut'); key('x', t1, s.x); break;
    case 'slideLeft': key('x', t0, -200 - W * 0.1, 'easeOut'); key('x', t1, s.x); break;
    case 'slideUp': key('y', t0, H + 200, 'easeOut'); key('y', t1, s.y); break;
    case 'slideDown': key('y', t0, -200 - H * 0.1, 'easeOut'); key('y', t1, s.y); break;
    case 'dropBounce': key('y', t0, -H * 0.3, 'bounce'); key('y', t1, s.y); break;
  }
}

const round = (t) => Math.round(t * 1000) / 1000;

// ضوضاء ناعمة أحادية البعد (للاهتزاز الطبيعي)
function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
export function noise1(x, seed = 0) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash(i + seed * 101.3) * 2 - 1, b = hash(i + 1 + seed * 101.3) * 2 - 1;
  return a + (b - a) * u;
}
function seedOf(str) { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) | 0; return (h % 1000) / 7; }

/** يطبق الحركات المستمرة على القيم المحسوبة */
export function applyMods(layer, t, out) {
  const mods = layer.mods;
  if (!mods?.length) return;
  for (const m of mods) {
    if (m.enabled === false) continue;
    if (m.start != null && t < m.start) continue;
    if (m.end != null && t > m.end) continue;
    const lt = t - (m.start || 0);
    const A = m.amount, S = m.speed;
    switch (m.type) {
      case 'pulse': out.scale *= 1 + A * Math.sin(lt * S * Math.PI * 2); break;
      case 'shake': {
        const sd = seedOf(layer.id + m.id);
        out.x += A * noise1(lt * S, sd);
        out.y += A * noise1(lt * S, sd + 17.3);
        out.rotation += (A / 6) * noise1(lt * S, sd + 41.1);
        break;
      }
      case 'spin': out.rotation += A * S * lt; break;
      case 'float': out.y += A * Math.sin(lt * S * Math.PI * 2); out.x += A * 0.3 * Math.sin(lt * S * Math.PI); break;
      case 'swing': out.rotation += A * Math.sin(lt * S * Math.PI * 2); break;
      case 'blink': out.opacity *= 1 - A * (0.5 + 0.5 * Math.sin(lt * S * Math.PI * 2)); break;
    }
  }
}

let registered = false;
export function registerMotion() {
  if (registered) return;
  registered = true;
  evalHooks.push((layer, t, out) => applyMods(layer, t, out));
}
