// المرحلة 6 (ج): الصوت — شكل موجي على الخط الزمني، وتشغيل متزامن، وعلامات الإيقاع التي تلتصق بها المفاتيح
import { h, btn, toast } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { timelineExtras } from '../ui/timeline.js';
import { editorPlugins, playbackHooks } from '../ui/editor.js';
import { sceneSections } from '../ui/props.js';
import { getAsset } from '../core/project.js';
import { getBlob } from '../storage/db.js';

let actx = null;
const buffers = new Map(); // assetId -> AudioBuffer
const peaksCache = new Map();
function audioCtx() { return (actx ||= new (window.AudioContext || window.webkitAudioContext)()); }

export async function decodeAsset(asset) {
  if (buffers.has(asset.id)) return buffers.get(asset.id);
  const blob = await getBlob(asset.blobKey);
  const buf = await audioCtx().decodeAudioData(await blob.arrayBuffer());
  buffers.set(asset.id, buf);
  return buf;
}

/** قمم الموجة: لكل عمود أعلى قيمة مطلقة */
export function computePeaks(buf, n) {
  const ch = buf.getChannelData(0);
  const step = Math.max(1, Math.floor(ch.length / n));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = i * step, e = Math.min(ch.length, j + step); j < e; j += 4) m = Math.max(m, Math.abs(ch[j]));
    out[i] = m;
  }
  return out;
}

/** أقرب علامة إيقاع ضمن مسافة (بالثواني) */
export function snapToMarker(t, markers, tol) {
  let best = t, bd = tol;
  for (const m of markers || []) { const d = Math.abs(m - t); if (d < bd) { bd = d; best = m; } }
  return best;
}

// صف الصوت في الخط الزمني مع الشكل الموجي
timelineExtras.push((tl) => {
  const ed = tl.ed, p = ed.project;
  if (!p.audio) return null;
  const a = getAsset(p, p.audio.assetId);
  if (!a) return null;
  const laneW = tl.xOf(p.duration) + 40;
  const lane = h('div.tl-lane.audio-lane', { style: { width: laneW + 'px' } });
  const cv = h('canvas.wave');
  lane.append(cv);
  const draw = (buf) => {
    const off = p.audio.offset || 0;
    const x0 = tl.xOf(Math.max(0, off)), x1 = tl.xOf(Math.min(p.duration, off + buf.duration));
    const W = Math.max(1, Math.round(x1 - x0)), H = 40;
    cv.width = W * 2; cv.height = H * 2;
    cv.style.cssText = `position:absolute;left:${x0}px;top:2px;width:${W}px;height:${H}px`;
    const key = a.id + ':' + W;
    let peaks = peaksCache.get(key);
    if (!peaks) { peaks = computePeaks(buf, W * 2); peaksCache.set(key, peaks); }
    const g = cv.getContext('2d');
    g.fillStyle = '#4cc9f0';
    for (let i = 0; i < peaks.length; i++) { const v = peaks[i] * H * 0.95; g.fillRect(i, H - v, 1, v * 2); }
  };
  if (buffers.has(a.id)) draw(buffers.get(a.id)); else decodeAsset(a).then(draw).catch(() => {});
  lane.addEventListener('pointerdown', (e) => { tl.scrubAt(e, lane); });
  return h('div.tl-row.tl-audio', { 'data-testid': 'audio-row' }, lane, h('div.tl-name', h('span.tl-label', '♪ ' + a.name)));
});

// علامات الإيقاع في المسطرة
editorPlugins.push((editor) => {
  const ed = editor.ed;
  const tl = editor.timeline;
  const origRender = tl.render.bind(tl);
  tl.render = () => {
    origRender();
    const ruler = tl.inner.querySelector('.tl-ruler .tl-lane');
    if (ruler) for (const m of ed.project.markers || []) ruler.append(h('div.marker', { style: { left: tl.xOf(m) + 'px' }, title: 'علامة إيقاع' }));
  };
  // التصاق المفاتيح بالعلامات عند السحب
  tl.snapTime = (t) => snapToMarker(t, ed.project.markers, 10 / tl.pps);
  // زر علامة الإيقاع في شريط التشغيل
  const beat = btn('drum', 'علامة إيقاع', () => addMarker(ed), { iconOnly: true, testid: 'beat', title: 'انقر مع الموسيقى لوضع علامة إيقاع (المفتاح B)' });
  tl.transport.insertBefore(beat, tl.keyBtn);
  ed.on('key', (e) => { if (e.key?.toLowerCase() === 'b') addMarker(ed); });
  // صوت من المكتبة
  ed.on('audio-asset', (asset) => { ed.project.audio = { assetId: asset.id, offset: 0, volume: 1 }; ed.commit(); toast('أُضيف الصوت إلى الخط الزمني'); decodeAsset(asset).then(() => tl.render()).catch(() => toast('تعذر فك الصوت', 'error')); });
  // صوت مستورد مباشرة: اجعله صوت المشروع إن لم يكن هناك صوت
  ed.on('asset-added', (asset) => { if (asset.type === 'audio' && !ed.project.audio) ed.emit('audio-asset', asset); });
  ed.exportAudio = () => {
    const p = ed.project;
    if (!p.audio) return null;
    const buf = buffers.get(p.audio.assetId);
    return buf ? { buffer: buf, offset: p.audio.offset || 0 } : null;
  };
  if (ed.project.audio) { const a = getAsset(ed.project, ed.project.audio.assetId); if (a) decodeAsset(a).then(() => tl.render()).catch(() => {}); }
});

function addMarker(ed) {
  const t = Math.round(ed.time * 1000) / 1000;
  ed.project.markers ||= [];
  if (ed.project.markers.some((m) => Math.abs(m - t) < 0.05)) return;
  ed.project.markers.push(t);
  ed.project.markers.sort((a, b) => a - b);
  ed.commit();
}

// التشغيل المتزامن
let source = null, gain = null;
playbackHooks.start.push((ed, t) => {
  stopAudio();
  const p = ed.project;
  if (!p.audio) return;
  const buf = buffers.get(p.audio.assetId);
  if (!buf) return;
  const c = audioCtx();
  c.resume?.();
  source = c.createBufferSource();
  source.buffer = buf;
  gain = c.createGain();
  gain.gain.value = p.audio.volume ?? 1;
  source.connect(gain).connect(c.destination);
  const off = p.audio.offset || 0;
  const into = t - off;
  if (into >= 0) source.start(0, into); else source.start(c.currentTime - into, 0);
});
playbackHooks.stop.push(() => stopAudio());
function stopAudio() { try { source?.stop(); } catch {} source = null; }

sceneSections.push((ed) => {
  const p = ed.project;
  const sec = h('section.sec', h('h3', icon('audio', 18), ' الصوت والإيقاع'));
  if (!p.audio) {
    sec.append(h('p.muted', 'استورد موسيقى أو مؤثرًا من المكتبة (MP3 أو WAV أو M4A) فيظهر شكله الموجي على الخط الزمني.'));
  } else {
    const a = getAsset(p, p.audio.assetId);
    const off = h('input.num', { type: 'number', step: 0.1, value: p.audio.offset || 0, 'aria-label': 'بداية الصوت', onchange: () => { p.audio.offset = parseFloat(off.value) || 0; ed.commit(); } });
    const vol = h('input.slider', { type: 'range', min: 0, max: 100, value: Math.round((p.audio.volume ?? 1) * 100), 'aria-label': 'مستوى الصوت', onchange: () => { p.audio.volume = vol.value / 100; ed.commit(); } });
    sec.append(h('p', '♪ ', a?.name || ''), h('label.field', h('span', 'يبدأ عند (ث)'), off), h('label.field', h('span', 'مستوى الصوت'), vol),
      btn('trash', 'إزالة الصوت', () => { delete p.audio; ed.commit(); ed.emit('select'); }, { cls: 'danger' }));
  }
  sec.append(h('p.muted', `علامات الإيقاع: ${(p.markers || []).length}. شغّل وانقر زر الطبل (أو المفتاح B) مع الضربات؛ المفاتيح تلتصق بالعلامات عند سحبها.`));
  if (p.markers?.length) sec.append(btn('trash', 'مسح العلامات', () => { p.markers = []; ed.commit(); ed.emit('select'); }));
  return sec;
});
