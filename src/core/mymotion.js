// «حركاتي»: حفظ حركة عنصر كمؤثر خاص يُطبَّق على أي عنصر آخر
import { setKey } from './keyframes.js';
import { evalLayer } from './project.js';

// خصائص تُحفظ فرقًا عن قيمتها الأولى (فتتحرك الحركة من مكان العنصر الجديد)
const RELATIVE = new Set(['x', 'y', 'rotation']);
const RATIO = new Set(['scale']);

/**
 * يلتقط مفاتيح الطبقة والحركات المستمرة والتكرار، والزمن يبدأ من الصفر.
 * القيم النسبية تُحسب من «موضع الراحة»: آخر مفتاح عادةً (حركات الدخول تنتهي في مكان العنصر)،
 * إلا إن كان آخر مفتاح خارج المشهد أو حجمه صفر (حركات الخروج) فيكون أول مفتاح.
 */
export function captureMotion(layer, project) {
  const tracks = {};
  let t0 = Infinity;
  for (const tr of Object.values(layer.tracks || {})) if (tr?.length) t0 = Math.min(t0, tr[0].t);
  if (!isFinite(t0)) t0 = 0;
  for (const [k, tr] of Object.entries(layer.tracks || {})) {
    if (!tr?.length || typeof tr[0].v !== 'number') continue;
    const first = tr[0].v, last = tr[tr.length - 1].v;
    const size = k === 'x' ? project?.width : k === 'y' ? project?.height : null;
    const off = (v) => (size != null && (v < 0 || v > size)) || (RATIO.has(k) && Math.abs(v) < 1e-6);
    const v0 = off(last) && !off(first) ? first : last;
    tracks[k] = tr.map((key) => {
      let v = key.v;
      if (RELATIVE.has(k)) v = key.v - v0;
      else if (RATIO.has(k)) v = v0 ? key.v / v0 : key.v;
      const out = { t: Math.round((key.t - t0) * 1000) / 1000, v };
      if (key.ease) out.ease = key.ease;
      if (key.bez) out.bez = [...key.bez];
      return out;
    });
  }
  const mods = (layer.mods || []).map(({ id, ...m }) => ({ ...m }));
  const loop = layer.loop ? { ...layer.loop } : null;
  const dur = Math.max(0, ...Object.values(tracks).map((tr) => tr[tr.length - 1].t));
  return { tracks, mods, loop, dur };
}

export function hasMotion(layer) {
  return Object.values(layer.tracks || {}).some((tr) => tr?.length > 1) || (layer.mods || []).length > 0;
}

/** يطبّق الحركة المحفوظة على طبقة ابتداءً من الزمن t */
export function applyMotion(layer, motion, t, newId = () => Math.random().toString(36).slice(2)) {
  const s = evalLayer(layer, t);
  for (const [k, tr] of Object.entries(motion.tracks || {})) {
    const base = s[k] ?? layer.props[k] ?? 0;
    const track = (layer.tracks[k] ||= []);
    for (const key of tr) {
      let v = key.v;
      if (RELATIVE.has(k)) v = base + key.v;
      else if (RATIO.has(k)) v = base * key.v;
      setKey(track, Math.round((t + key.t) * 1000) / 1000, v, key.ease);
      if (key.bez) { const i = track.findIndex((x) => Math.abs(x.t - (t + key.t)) < 1e-3); if (i >= 0) track[i].bez = [...key.bez]; }
    }
  }
  if (motion.mods?.length) (layer.mods ||= []).push(...motion.mods.map((m) => ({ ...m, id: 'mod' + newId() })));
  if (motion.loop) layer.loop = { ...motion.loop };
}
