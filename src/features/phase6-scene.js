// المرحلة 6 (أ): الكاميرا والعمق (Parallax)، وضبابية الحركة، والإضاءة المتحركة، والجزيئات، وطبقات الفيديو، وصيغ التصدير الباقية
import { h, btn, toast, menu } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { propSections, sceneSections } from '../ui/props.js';
import { libraryCreators } from '../ui/library.js';
import { timelineExtras } from '../ui/timeline.js';
import { editorPlugins, playbackHooks } from '../ui/editor.js';
import { exportFormats, exportOptionsExtras } from '../ui/exportDialog.js';
import { registerCamera, registerLayerRenderer, getLayerRenderer } from '../core/renderer.js';
import { registerPrepare, generateFrames } from '../export/frames.js';
import { createAsset, getAsset, evalLayer, worldMatrix, layerTime, isLayerActive, PROP_KEYS } from '../core/project.js';
import { valueAt, setKey, findKeyIndex, removeKey } from '../core/keyframes.js';
import { multiply, translate, rotate, scale as mScale, decompose, hexToRgb } from '../core/math.js';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';
import { zipSync } from 'fflate';

// ——— الكاميرا ———
export const CAM_PROPS = {
  x: { label: 'الكاميرا أفقيًا', step: 1 },
  y: { label: 'الكاميرا رأسيًا', step: 1 },
  zoom: { label: 'تكبير الكاميرا', step: 0.01, pct: true },
  rotation: { label: 'دوران الكاميرا', step: 1 }
};
function camDefaults(p) { return { x: p.width / 2, y: p.height / 2, zoom: 1, rotation: 0 }; }
export function cameraState(p, t) {
  const c = p.camera;
  if (!c) return null;
  const base = { ...camDefaults(p), ...(c.props || {}) };
  const out = {};
  for (const k of Object.keys(CAM_PROPS)) out[k] = valueAt(c.tracks?.[k], t, base[k]);
  return out;
}

registerCamera((p, t) => {
  const s = cameraState(p, t);
  if (!s) return null;
  if (s.x === p.width / 2 && s.y === p.height / 2 && s.zoom === 1 && s.rotation === 0) return null;
  const cx = p.width / 2, cy = p.height / 2;
  return {
    zoom: s.zoom,
    matrixFor(layer) {
      // العمق: 1 عادي، أكبر = أقرب (يتحرك أسرع)، أصغر = أبعد، 0 = ثابت على الشاشة
      const d = layer.depth ?? 1;
      const z = 1 + (s.zoom - 1) * d;
      const px = cx + (s.x - cx) * d, py = cy + (s.y - cy) * d;
      let m = translate(cx, cy);
      m = multiply(m, rotate(-s.rotation * Math.min(1, d)));
      m = multiply(m, mScale(z));
      m = multiply(m, translate(-px, -py));
      return m;
    }
  };
});

sceneSections.push((ed) => {
  const p = ed.project;
  const sec = h('section.sec', h('h3', icon('camera', 18), ' الكاميرا'));
  const enabled = !!p.camera;
  if (!enabled) {
    sec.append(h('p.muted', 'تكبير وتحريك ودوران على المشهد كله. أعطِ كل طبقة «عمقًا» فتتحرك القريبة أسرع من البعيدة.'),
      btn('camera', 'تفعيل الكاميرا', () => { p.camera = { props: camDefaults(p), tracks: {} }; ed.commit(); ed.emit('select'); }, { testid: 'camera-on' }));
    return sec;
  }
  const s = cameraState(p, ed.time);
  for (const [k, def] of Object.entries(CAM_PROPS)) {
    const tr = p.camera.tracks[k];
    const has = findKeyIndex(tr, ed.time, 1e-4) >= 0;
    const kb = h('button.keybtn' + (has ? '.on' : tr?.length ? '.anim' : ''), { type: 'button', 'aria-label': 'مفتاح ' + def.label, 'data-testid': 'camkey-' + k, html: icon(has ? 'keyFill' : 'key', 22), onclick: () => {
      p.camera.tracks[k] ||= [];
      const i = findKeyIndex(p.camera.tracks[k], ed.time, 1e-4);
      if (i >= 0) removeKey(p.camera.tracks[k], i); else setKey(p.camera.tracks[k], ed.time, cameraState(p, ed.time)[k], 'easeInOut');
      ed.commit(); ed.emit('select');
    } });
    const toUi = (v) => (def.pct ? Math.round(v * 1000) / 10 : Math.round(v * 100) / 100);
    const inp = h('input.num', { type: 'number', step: def.pct ? 1 : def.step, value: toUi(s[k]), 'aria-label': def.label, 'data-testid': 'cam-' + k, onchange: () => {
      let v = parseFloat(inp.value); if (isNaN(v)) return;
      if (def.pct) v /= 100;
      const t2 = p.camera.tracks[k];
      if (t2?.length) setKey(t2, ed.time, v, 'easeInOut'); else p.camera.props[k] = v;
      ed.commit();
    } });
    sec.append(h('div.prop-row', kb, h('label', h('span', def.label + (def.pct ? ' %' : '')), inp)));
  }
  sec.append(btn('close', 'إيقاف الكاميرا', () => { delete p.camera; ed.commit(); ed.emit('select'); }, { cls: 'danger' }));
  return sec;
});

// صف الكاميرا في الخط الزمني
timelineExtras.push((tl) => {
  const p = tl.ed.project;
  if (!p.camera) return null;
  const laneW = tl.xOf(p.duration) + 40;
  const lane = h('div.tl-lane', { style: { width: laneW + 'px' } });
  const times = new Map();
  for (const k in p.camera.tracks) for (const key of p.camera.tracks[k]) times.set(key.t.toFixed(4), key.t);
  for (const t of times.values()) lane.append(h('div.key.summary.cam', { style: { left: tl.xOf(t) + 'px' }, onpointerdown: (e) => { e.stopPropagation(); tl.ed.select(null); tl.ed.setTime(t); } }));
  lane.addEventListener('pointerdown', (e) => { tl.ed.select(null); tl.scrubAt(e, lane); });
  return h('div.tl-row.tl-camera', lane, h('div.tl-name', h('span.tl-label', '🎥 الكاميرا')));
});

// العمق لكل طبقة
propSections.push((ed, layer) => {
  if (!ed.project.camera) return null;
  const d = layer.depth ?? 1;
  const out = h('output', d.toFixed(2));
  const r = h('input.slider', { type: 'range', min: 0, max: 3, step: 0.05, value: d, 'aria-label': 'العمق', 'data-testid': 'depth', oninput: () => { layer.depth = +r.value; out.textContent = (+r.value).toFixed(2); ed.live(); }, onchange: () => ed.commit() });
  return h('section.sec', h('h3', icon('layers', 18), ' العمق (Parallax)'), h('div.row', r, out),
    h('p.muted', '1 = عادي، أكبر = أقرب يتحرك أسرع، أصغر = خلفية بعيدة، 0 = ثابت على الشاشة (كالعنوان).'));
});

// ——— الإضاءة المتحركة ———
registerLayerRenderer('light', (c, { asset }) => {
  const r = asset.width / 2;
  const [R, G, B] = hexToRgb(asset.color || '#ffd27a');
  const g = c.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, `rgba(${R},${G},${B},${asset.intensity ?? 0.9})`);
  g.addColorStop(0.4, `rgba(${R},${G},${B},${(asset.intensity ?? 0.9) * 0.35})`);
  g.addColorStop(1, `rgba(${R},${G},${B},0)`);
  c.fillStyle = g;
  c.fillRect(0, 0, asset.width, asset.height);
});

// ——— الجزيئات ———
const PARTICLES = { dust: { label: 'غبار', count: 80 }, sparkle: { label: 'لمعان', count: 40 }, snow: { label: 'ثلج', count: 120 } };
function rnd(seed) { const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); }
registerLayerRenderer('particles', (c, { asset, t }) => {
  const W = asset.width, H = asset.height, n = asset.count || 80;
  const [R, G, B] = hexToRgb(asset.color || '#ffffff');
  for (let i = 0; i < n; i++) {
    const a = rnd(i + 1), b = rnd(i + 101), sz = rnd(i + 201), ph = rnd(i + 301);
    let x, y, r, alpha;
    if (asset.kind === 'snow') {
      const sp = 40 + sz * 90;
      y = ((b * H + t * sp) % (H + 20)) - 10;
      x = a * W + Math.sin(t * (0.5 + ph) + i) * 25;
      r = 1.5 + sz * 4; alpha = 0.6 + sz * 0.4;
    } else if (asset.kind === 'sparkle') {
      x = a * W; y = b * H;
      const tw = Math.max(0, Math.sin((t * (1 + ph * 2) + ph * 6.28) * 2));
      r = (2 + sz * 6) * tw; alpha = tw;
      if (r > 0.3) {
        c.strokeStyle = `rgba(${R},${G},${B},${alpha})`; c.lineWidth = Math.max(1, r / 4);
        c.beginPath(); c.moveTo(x - r * 2, y); c.lineTo(x + r * 2, y); c.moveTo(x, y - r * 2); c.lineTo(x, y + r * 2); c.stroke();
      }
    } else {
      x = (a * W + t * (8 + sz * 20) + Math.sin(t * 0.7 + i) * 15) % W;
      y = (b * H + Math.cos(t * 0.5 + i * 1.3) * 20 - t * 6 * sz + H) % H;
      r = 0.8 + sz * 2.5; alpha = 0.25 + 0.5 * Math.abs(Math.sin(t * 0.8 + ph * 6));
    }
    c.fillStyle = `rgba(${R},${G},${B},${alpha})`;
    c.beginPath(); c.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2); c.fill();
  }
});

libraryCreators.push({ icon: 'sparkle', label: 'جزيئات وإضاءة', testid: 'new-fx', create: (ed) => {
  const p = ed.project;
  const pick = (asset, blend) => {
    ed.editor.closePanels?.();
    ed.tryChange(asset.name, () => { ed.project.assets.push(asset); const l = ed.editor.library.addInstance(asset, false); l.props.scale = 1; if (blend) l.blend = blend; }, { group: 'fx-add' });
  };
  menu(document.querySelector('[data-testid=new-fx]'), [
    ...Object.entries(PARTICLES).map(([kind, d]) => ({ icon: 'sparkle', label: 'جزيئات: ' + d.label, testid: 'fx-' + kind, onClick: () => pick(createAsset('particles', { name: d.label, kind, count: d.count, width: p.width, height: p.height, color: kind === 'sparkle' ? '#fff3b0' : '#ffffff', icon: 'sparkle' })) })),
    { icon: 'star', label: 'إضاءة متحركة (بقعة ضوء)', testid: 'fx-light', onClick: () => pick(createAsset('light', { name: 'إضاءة', width: Math.round(Math.max(p.width, p.height) * 0.7), height: Math.round(Math.max(p.width, p.height) * 0.7), color: '#ffd27a', intensity: 0.8, icon: 'star' }), 'screen') }
  ]);
} });

propSections.push((ed, layer) => {
  const a = getAsset(ed.project, layer.assetId);
  if (!a || !['light', 'particles'].includes(a.type)) return null;
  const sec = h('section.sec', h('h3', icon('sparkle', 18), a.type === 'light' ? ' الإضاءة' : ' الجزيئات'));
  const c = h('input.color', { type: 'color', value: a.color || '#ffffff', oninput: () => { a.color = c.value; ed.live(); }, onchange: () => ed.commit() });
  sec.append(h('label.field.row', h('span', 'اللون'), c));
  if (a.type === 'particles') {
    const n = h('input.num', { type: 'number', min: 1, max: 600, value: a.count, onchange: () => { a.count = Math.max(1, Math.min(600, +n.value || 50)); ed.commit(); } });
    sec.append(h('label.field', h('span', 'العدد'), n));
  } else {
    const blend = h('select', { onchange: () => { layer.blend = blend.value; ed.commit(); } }, [['screen', 'ضوء (Screen)'], ['lighter', 'إضافة (أقوى)'], ['overlay', 'تراكب'], ['normal', 'عادي']].map(([v, l]) => h('option', { value: v, selected: (layer.blend || 'normal') === v }, l)));
    sec.append(h('label.field', h('span', 'طريقة المزج'), blend), h('p.muted', 'حرّك الضوء بمفاتيح الموضع والشفافية والحجم.'));
  }
  return sec;
});

// ——— طبقات الفيديو (مثل حركة مولّدة بالذكاء الاصطناعي) ———
function syncVideos(ed, play) {
  const p = ed.project;
  for (const l of p.layers) {
    const a = getAsset(p, l.assetId);
    if (a?.type !== 'video') continue;
    const v = ed.cache.get(a.id);
    if (!v) continue;
    const lt = Math.max(0, ed.time - (l.start || 0));
    const target = a.duration ? lt % a.duration : lt;
    if (play) { if (Math.abs(v.currentTime - target) > 0.25) v.currentTime = target; v.play().catch(() => {}); }
    else { v.pause(); if (Math.abs(v.currentTime - target) > 0.02) v.currentTime = target; }
  }
}
editorPlugins.push((editor) => {
  const ed = editor.ed;
  let raf = 0;
  ed.on('time', () => { if (!ed.playing) { syncVideos(ed, false); cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setTimeout(() => ed.emit('render'), 60)); } });
});
playbackHooks.start.push((ed) => syncVideos(ed, true));
playbackHooks.stop.push((ed) => syncVideos(ed, false));
playbackHooks.tick.push((ed) => { if (ed.project.layers.some((l) => getAsset(ed.project, l.assetId)?.type === 'video')) ed.emit('render'); });
registerPrepare(async (project, t, cache) => {
  for (const l of project.layers) {
    const a = getAsset(project, l.assetId);
    if (a?.type !== 'video') continue;
    const v = cache?.get(a.id);
    if (!v) continue;
    v.pause();
    const lt = Math.max(0, t - (l.start || 0));
    const target = Math.min(a.duration ? lt % a.duration : lt, (v.duration || 1e9) - 0.001);
    if (Math.abs(v.currentTime - target) < 1e-3) continue;
    await new Promise((res) => { const done = () => { v.removeEventListener('seeked', done); res(); }; v.addEventListener('seeked', done); v.currentTime = target; setTimeout(done, 1500); });
  }
});

// ——— خيارات التصدير: ضبابية الحركة ———
exportOptionsExtras.push((state) => {
  const cb = h('input', { type: 'checkbox', 'data-testid': 'motion-blur', onchange: () => { state.motionBlur = cb.checked ? 6 : 0; } });
  return h('label.field.row', { dataset: { formats: 'mp4,gif,webp,webm,png' } }, cb, h('span', 'ضبابية الحركة (أنعم للحركة السريعة، تصدير أبطأ)'));
});

// ——— WebM بخلفية شفافة ———
async function exportWebm(project, { w, h: hh, fps, cache, onProgress, signal, motionBlur, transparent = true }) {
  if (typeof VideoEncoder === 'undefined') throw new Error('هذا المتصفح لا يدعم ترميز WebM');
  const bitrate = Math.round(Math.min(30e6, Math.max(2e6, w * hh * fps * 0.12)));
  let config = null;
  for (const codec of ['vp09.00.10.08', 'vp8']) {
    for (const alpha of transparent ? ['keep', 'discard'] : ['discard']) {
      const c = { codec, width: w, height: hh, bitrate, framerate: fps, alpha };
      try { if ((await VideoEncoder.isConfigSupported(c)).supported) { config = c; break; } } catch {}
    }
    if (config) break;
  }
  if (!config) throw new Error('ترميز WebM غير مدعوم هنا');
  const target = new WebmTarget();
  const muxer = new WebmMuxer({ target, video: { codec: config.codec.startsWith('vp09') ? 'V_VP9' : 'V_VP8', width: w, height: hh, frameRate: fps, alpha: config.alpha === 'keep' }, firstTimestampBehavior: 'offset' });
  let err = null;
  const enc = new VideoEncoder({ output: (ch, meta) => muxer.addVideoChunk(ch, meta), error: (e) => { err = e; } });
  enc.configure(config);
  const fd = 1e6 / fps;
  for await (const { canvas, i, total } of generateFrames(project, { fps, w, h: hh, cache, signal, motionBlur, transparent })) {
    if (err) throw err;
    const fr = new VideoFrame(canvas, { timestamp: Math.round(i * fd), duration: Math.round(fd), alpha: config.alpha === 'keep' ? 'keep' : 'discard' });
    enc.encode(fr, { keyFrame: i % (fps * 2) === 0 });
    fr.close();
    while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 5));
    onProgress?.((i + 1) / total);
  }
  await enc.flush(); enc.close();
  if (err) throw err;
  muxer.finalize();
  if (transparent && config.alpha !== 'keep') toast('المتصفح لم يحفظ الشفافية في WebM؛ استخدم تسلسل PNG');
  return new Blob([target.buffer], { type: 'video/webm' });
}

// ——— تسلسل PNG في ملف ZIP ———
async function exportPngSeq(project, { w, h: hh, fps, cache, onProgress, signal, motionBlur, transparent = true }) {
  const files = {};
  for await (const { canvas, i, total } of generateFrames(project, { fps, w, h: hh, cache, signal, motionBlur, transparent })) {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    files[`frame_${String(i).padStart(5, '0')}.png`] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
    onProgress?.((i + 1) / total * 0.95);
  }
  const zip = zipSync(files);
  onProgress?.(1);
  return new Blob([zip], { type: 'application/zip' });
}

// ——— Lottie (JSON) ———
async function exportLottie(project, { w, h: hh, fps, cache, onProgress }) {
  const sx = w / project.width, sy = hh / project.height;
  const frames = Math.max(1, Math.round(project.duration * fps));
  const assets = [], layers = [];
  let ind = 1;
  const imgData = (a) => {
    const c = document.createElement('canvas');
    const k = Math.min(1, 1024 / Math.max(a.width, a.height));
    c.width = Math.max(1, Math.round(a.width * k)); c.height = Math.max(1, Math.round(a.height * k));
    const g = c.getContext('2d');
    g.scale(k, k);
    const src = cache.get(a.id);
    if (src) g.drawImage(src, 0, 0, a.width, a.height);
    else { const r = getLayerRenderer(a.type); if (r) r(g, { asset: a, t: 0, project, layer: {}, s: {}, opts: {} }); }
    return c.toDataURL('image/png');
  };
  const skipped = new Set();
  // الطبقات بترتيب Lottie: الأعلى أولًا
  const list = [...project.layers].reverse();
  for (const l of list) {
    if (!l.visible) continue;
    const a = getAsset(project, l.assetId);
    if (!a || ['audio', 'comp', 'drawing', 'particles', 'video'].includes(a.type)) { if (a) skipped.add(a.type); continue; }
    const id = 'img_' + a.id;
    if (!assets.find((x) => x.id === id)) assets.push({ id, w: a.width, h: a.height, u: '', p: imgData(a), e: 1 });
    // نخبز التحويل الكامل في كل إطار (يشمل المنحنيات والحركات المستمرة والمسارات والربط)
    const P = [], R = [], S = [], O = [];
    for (let f = 0; f <= frames; f++) {
      const t = f / fps;
      const m = worldMatrix(project, l, t);
      const full = multiply(m, translate(l.anchorX * a.width, l.anchorY * a.height));
      const d = decompose(full);
      const s = evalLayer(l, t);
      P.push([d.x * sx, d.y * sy, 0]); R.push(d.rotation); S.push([d.scaleX * 100 * sx, d.scaleY * 100 * sy, 100]); O.push(isLayerActive(l, t, project.duration) ? s.opacity * 100 : 0);
    }
    const anim = (vals) => {
      const same = vals.every((v) => JSON.stringify(v) === JSON.stringify(vals[0]));
      if (same) return { a: 0, k: vals[0] };
      const k = [];
      vals.forEach((v, f) => {
        const prev = vals[f - 1], next = vals[f + 1];
        if (f > 0 && f < vals.length - 1 && JSON.stringify(prev) === JSON.stringify(v) && JSON.stringify(next) === JSON.stringify(v)) return;
        k.push({ t: f, s: Array.isArray(v) ? v : [v], i: { x: [1], y: [1] }, o: { x: [0], y: [0] } });
      });
      return { a: 1, k };
    };
    layers.push({ ddd: 0, ind: ind++, ty: 2, nm: l.name, refId: id, sr: 1, ks: { o: anim(O), r: anim(R), p: anim(P), a: { a: 0, k: [a.width * l.anchorX, a.height * l.anchorY, 0] }, s: anim(S) }, ao: 0, ip: 0, op: frames, st: 0, bm: 0 });
    onProgress?.(ind / (list.length + 1));
  }
  const json = { v: '5.7.4', fr: fps, ip: 0, op: frames, w, h: hh, nm: project.name, ddd: 0, assets, layers };
  if (skipped.size) toast('Lottie: تجاهلتُ ما لا يدعمه (الرسم إطارًا بإطار، والجزيئات، والفيديو، والعناصر المركّبة، ومؤثرات الخط)');
  onProgress?.(1);
  return new Blob([JSON.stringify(json)], { type: 'application/json' });
}

exportFormats.push(
  { id: 'webm', label: 'WebM بخلفية شفافة (فوق الفيديو)', ext: 'webm', mime: 'video/webm', run: (p, o) => exportWebm(p, { ...o, transparent: o.state.transparent ?? true }) },
  { id: 'png', label: 'تسلسل PNG شفاف (ملف ZIP)', ext: 'zip', mime: 'application/zip', run: (p, o) => exportPngSeq(p, { ...o, transparent: o.state.transparent ?? true }) },
  { id: 'lottie', label: 'Lottie JSON (للمواقع)', ext: 'json', mime: 'application/json', run: (p, o) => exportLottie(p, o) }
);

export { exportLottie, exportWebm, exportPngSeq };
