// المرحلة 4: تحريك الخط العربي — الكتابة الحية، وظهور الحروف واحدًا واحدًا، واللمعان، والتوهج، والتحوّل
import '@fontsource/amiri/arabic-400.css';
import '@fontsource/amiri/arabic-700.css';
import '@fontsource/reem-kufi/arabic-400.css';
import '@fontsource/reem-kufi/arabic-700.css';
import '@fontsource/aref-ruqaa/arabic-400.css';
import '@fontsource/aref-ruqaa/arabic-700.css';
import { h, btn, modal, toast } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { libraryCreators } from '../ui/library.js';
import { propSections } from '../ui/props.js';
import { editorPlugins } from '../ui/editor.js';
import { registerLayerRenderer, registerDecorator, scratchCanvas } from '../core/renderer.js';
import { registerPrepare } from '../export/frames.js';
import { createAsset, createLayer, getAsset, instancesOf } from '../core/project.js';
import { getEase, EASES } from '../core/easing.js';
import { getGeometry, ensureGeometry, onGeometry, prepareMorph, invalidateGeometry } from '../core/svggeom.js';
import { getBlob } from '../storage/db.js';
import { multiply, scale as mScale, hexToRgb } from '../core/math.js';

export const FONTS = [
  { id: 'Amiri', label: 'أميري (نسخ)' },
  { id: 'Aref Ruqaa', label: 'عارف رقعة' },
  { id: 'Reem Kufi', label: 'ريم كوفي' },
  { id: 'Tajawal', label: 'تجوال (حديث)' }
];

// ——— عنصر النص ———
const measureCanvas = () => (measureCanvas.c ||= document.createElement('canvas').getContext('2d'));
const fontString = (a) => `${a.weight || 400} ${a.size}px "${a.font}", "Amiri", serif`;
const LINE = 1.75;

export function layoutText(a) {
  const g = measureCanvas();
  g.font = fontString(a);
  g.direction = 'rtl';
  const lines = String(a.text || ' ').split('\n');
  const pad = Math.round(a.size * 0.35) + (a.outlineWidth || 0);
  const widths = lines.map((l) => g.measureText(l || ' ').width);
  const w = Math.ceil(Math.max(...widths) + pad * 2);
  const hgt = Math.ceil(lines.length * a.size * LINE + pad);
  // حدود الحروف: كل حرف (مجموعة نطقية) ومداه الأفقي من اليمين
  const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ar', { granularity: 'grapheme' }) : null;
  const letters = [];
  lines.forEach((line, li) => {
    const gs = seg ? [...seg.segment(line)].map((s) => s.segment) : [...line];
    const right = w - pad - (Math.max(...widths) - widths[li]) * 0; // كل سطر محاذى لليمين
    let prefix = '', prevW = 0;
    for (const ch of gs) {
      prefix += ch;
      const pw = g.measureText(prefix).width;
      if (ch.trim()) letters.push({ line: li, x0: right - pw, x1: right - prevW, ch });
      prevW = pw;
    }
  });
  return { w, h: hgt, pad, lines, letters, lineH: a.size * LINE };
}

/** تخزين التخطيط خارج بيانات المشروع (لا يُحفظ ولا يدخل في التراجع) */
function setLayout(a, L) {
  Object.defineProperty(a, '_layout', { value: L, writable: true, configurable: true, enumerable: false });
  return L;
}

function drawTextAsset(c, a) {
  const L = a._layout || setLayout(a, layoutText(a));
  c.font = fontString(a);
  c.direction = 'rtl';
  c.textAlign = 'right';
  c.textBaseline = 'middle';
  L.lines.forEach((line, i) => {
    const y = L.pad / 2 + L.lineH * (i + 0.5);
    if (a.outlineWidth > 0) {
      c.lineJoin = 'round';
      c.lineWidth = a.outlineWidth * 2;
      c.strokeStyle = a.outline || '#000';
      c.strokeText(line, L.w - L.pad, y);
    }
    c.fillStyle = a.color || '#111';
    c.fillText(line, L.w - L.pad, y);
  });
}

registerLayerRenderer('text', (c, { asset }) => {
  if (!asset._layout || asset._layout.w !== asset.width) setLayout(asset, layoutText(asset));
  drawTextAsset(c, asset);
});

function refreshText(asset) {
  const L = setLayout(asset, layoutText(asset));
  asset.width = L.w; asset.height = L.h;
}

// ——— الحوار: إنشاء أو تعديل نص ———
function textDialog(ed, asset) {
  const st = asset ? { ...asset } : { text: 'بسم الله الرحمن الرحيم', font: 'Aref Ruqaa', size: 140, color: '#1d1a25', weight: 400, outline: '#ffffff', outlineWidth: 0 };
  const ta = h('textarea.text.area', { dir: 'rtl', rows: 3, 'aria-label': 'النص', 'data-testid': 'text-input' }, st.text);
  const fonts = h('div.chips', FONTS.map((f) => h('button.chip', { type: 'button', 'aria-pressed': st.font === f.id, style: { fontFamily: `"${f.id}"` }, onclick: (e) => { st.font = f.id; for (const b of fonts.children) b.setAttribute('aria-pressed', b === e.currentTarget); preview(); } }, f.label)));
  const size = h('input.num', { type: 'number', min: 20, max: 600, value: st.size, 'aria-label': 'الحجم', oninput: () => { st.size = +size.value || 140; preview(); } });
  const color = h('input.color', { type: 'color', value: st.color, 'aria-label': 'لون الخط', oninput: () => { st.color = color.value; preview(); } });
  const bold = h('input', { type: 'checkbox', checked: st.weight >= 700, onchange: () => { st.weight = bold.checked ? 700 : 400; preview(); } });
  const ow = h('input.num', { type: 'number', min: 0, max: 40, value: st.outlineWidth, 'aria-label': 'سماكة الإطار', oninput: () => { st.outlineWidth = +ow.value || 0; preview(); } });
  const oc = h('input.color', { type: 'color', value: st.outline, 'aria-label': 'لون الإطار', oninput: () => { st.outline = oc.value; preview(); } });
  const pv = h('canvas.text-preview', { width: 600, height: 200 });
  ta.addEventListener('input', () => { st.text = ta.value; preview(); });
  function preview() {
    const a = { ...st }; const L = layoutText(a);
    const k = Math.min(1, 560 / L.w, 180 / L.h);
    const g = pv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, 600, 200);
    g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, 600, 200);
    g.setTransform(k, 0, 0, k, (600 - L.w * k) / 2, (200 - L.h * k) / 2);
    setLayout(a, L); drawTextAsset(g, a);
  }
  document.fonts?.ready.then(preview);
  for (const f of FONTS) document.fonts?.load(`400 40px "${f.id}"`).then(preview).catch(() => {});
  modal(asset ? 'تعديل الخط' : 'خط جديد', h('div',
    h('label.field', h('span', 'النص (يمكن عدة أسطر)'), ta),
    h('p.field-label', 'نوع الخط'), fonts,
    h('div.mod-ctl', h('label.field', h('span', 'الحجم'), size), h('label.field', h('span', 'اللون'), color)),
    h('label.field.row', bold, h('span', 'عريض')),
    h('div.mod-ctl', h('label.field', h('span', 'إطار حول الحروف'), ow), h('label.field', h('span', 'لون الإطار'), oc)),
    pv
  ), [{ label: asset ? 'حفظ (يتغير في كل النسخ)' : 'إضافة إلى المشهد', icon: 'check', primary: true, testid: 'text-ok', onClick: async (close) => {
    await document.fonts?.load(`${st.weight} ${st.size}px "${st.font}"`).catch(() => {});
    if (asset) {
      Object.assign(asset, { text: st.text, font: st.font, size: st.size, color: st.color, weight: st.weight, outline: st.outline, outlineWidth: st.outlineWidth, name: st.text.slice(0, 24) });
      refreshText(asset);
      ed.commit();
    } else {
      const a = createAsset('text', { name: st.text.slice(0, 24), text: st.text, font: st.font, size: st.size, color: st.color, weight: st.weight, outline: st.outline, outlineWidth: st.outlineWidth, icon: 'text' });
      refreshText(a);
      ed.project.assets.push(a);
      ed.editor.library.addInstance(a);
    }
    close();
  } }], { wide: true });
  preview();
}

libraryCreators.push({ icon: 'text', label: 'خط عربي', testid: 'new-text', create: (ed) => textDialog(ed) });

editorPlugins.push((editor) => {
  const ed = editor.ed;
  ed.assetMenuExtras ||= [];
  ed.assetMenuExtras.push((a) => a.type === 'text' ? [{ icon: 'text', label: 'تعديل النص والخط (كل النسخ)', onClick: () => textDialog(ed, a) }] : []);
  // عند تحميل الخطوط أعد القياس
  const relayout = () => { for (const a of ed.project.assets) if (a.type === 'text') refreshText(a); ed.emit('render'); };
  document.fonts?.addEventListener?.('loadingdone', relayout);
  ed.on('destroy', () => document.fonts?.removeEventListener?.('loadingdone', relayout));
  onGeometry(() => ed.emit('render'));
  // الخطوط المستخدمة في المشروع: حمّلها مبكرًا
  for (const a of ed.project.assets) if (a.type === 'text') document.fonts?.load(fontString(a)).catch(() => {});
});

const blobOf = async (asset) => getBlob(asset.blobKey);

// قبل كل إطار تصدير: تأكد من الخطوط وهندسة SVG
registerPrepare(async (project, t, cache) => {
  if (project._fxReady) return;
  for (const a of project.assets) if (a.type === 'text') { await document.fonts?.load(fontString(a)).catch(() => {}); refreshText(a); }
  for (const l of project.layers) {
    const fx = l.fx; if (!fx) continue;
    const a = getAsset(project, l.assetId);
    if (a?.type === 'svg') await ensureGeometry(a, blobOf);
    if (fx.morph?.toAssetId) { const b = getAsset(project, fx.morph.toAssetId); if (b?.type === 'svg') await ensureGeometry(b, blobOf); }
  }
  project._fxReady = true;
});

// ——— الرسم بالمؤثرات ———
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const LETTER_ANIMS = { fade: 'تلاشي', pop: 'قفزة', rise: 'صعود', drop: 'سقوط', grow: 'نمو' };

function contentDrawer(project, asset, src) {
  return (c) => {
    if (asset.type === 'text') drawTextAsset(c, asset);
    else if (src) c.drawImage(src, 0, 0, asset.width, asset.height);
  };
}

registerDecorator((ctx, info) => {
  const { layer, asset, src, m, t, project } = info;
  const fx = layer.fx;
  if (!fx || !asset || !(fx.write?.on || fx.shine?.on || fx.glow?.on || fx.morph?.toAssetId)) return false;
  const w = asset.width, hh = asset.height;
  if (asset.type === 'text' && (!asset._layout || asset._layout.w !== w)) setLayout(asset, layoutText(asset));
  const pxScale = Math.hypot(m[0], m[1]);
  let k = Math.max(0.05, pxScale);
  const maxSide = 4096;
  if (w * k > maxSide || hh * k > maxSide) k = Math.min(maxSide / w, maxSide / hh);
  // هامش للتوهج والحركات الخارجة عن الصندوق
  const margin = Math.ceil(Math.max(w, hh) * 0.25);
  const W = Math.ceil((w + margin * 2) * k), H = Math.ceil((hh + margin * 2) * k);
  const off = scratchCanvas(W, H, 2);
  const o = off.getContext('2d');
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.globalAlpha = 1; o.globalCompositeOperation = 'source-over'; o.filter = 'none';
  o.clearRect(0, 0, W, H);
  const base = [k, 0, 0, k, margin * k, margin * k];
  o.setTransform(...base);
  const draw = contentDrawer(project, asset, src);

  // 1) المحتوى: تحوّل أو كتابة أو كامل
  const morphed = fx.morph?.toAssetId && drawMorph(o, base, project, layer, asset, src, t, info.opts);
  if (!morphed) {
    const wr = fx.write;
    if (wr?.on) drawWrite(o, base, asset, src, draw, wr, t, W, H, k, margin);
    else draw(o);
  }
  // 2) اللمعان يمر على الحروف
  if (fx.shine?.on) {
    const sh = fx.shine;
    const period = Math.max(0.3, sh.period || 2.5);
    const ph = (((t - (sh.start || 0)) / period) % 1 + 1) % 1;
    if (t >= (sh.start || 0)) {
      const travel = ph / 0.6; // يمر في 60% من الدورة ثم يرتاح
      if (travel <= 1) {
        const bw = (sh.width || 0.18) * w;
        const x = w + bw - travel * (w + bw * 2); // من اليمين إلى اليسار
        o.setTransform(...base);
        o.globalCompositeOperation = 'source-atop';
        const g = o.createLinearGradient(x - bw, 0, x + bw, hh * 0.3);
        const col = sh.color || '#ffffff';
        g.addColorStop(0, hexA(col, 0)); g.addColorStop(0.5, hexA(col, 0.85)); g.addColorStop(1, hexA(col, 0));
        o.fillStyle = g;
        o.fillRect(-margin, -margin, w + margin * 2, hh + margin * 2);
        o.globalCompositeOperation = 'source-over';
      }
    }
  }
  // 3) التركيب على المشهد مع التوهج النابض
  ctx.save();
  ctx.setTransform(...multiply(m, [1 / k, 0, 0, 1 / k, -margin, -margin]));
  if (fx.glow?.on) {
    const gl = fx.glow;
    const pulse = 0.55 + 0.45 * Math.sin((t - (gl.start || 0)) * (gl.speed || 1) * Math.PI * 2);
    ctx.shadowColor = gl.color || '#ffd166';
    ctx.shadowBlur = (gl.size || 30) * pxScale * pulse;
    ctx.drawImage(off, 0, 0);
    ctx.shadowBlur *= 0.5;
  }
  ctx.drawImage(off, 0, 0);
  ctx.restore();
  return true;
});

function hexA(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function drawWrite(o, base, asset, src, draw, wr, t, W, H, k, margin) {
  const w = asset.width, hh = asset.height;
  const dur = Math.max(0.1, wr.dur || 2);
  const start = wr.start || 0;
  const ease = getEase(wr.ease || 'easeInOut');
  if (wr.mode === 'letters') {
    const units = letterUnits(asset);
    if (!units) { draw(o); return; }
    const n = units.length;
    const stagger = wr.stagger ?? Math.max(0.03, (dur * 0.6) / Math.max(1, n));
    const each = Math.max(0.1, dur - stagger * (n - 1));
    units.forEach((u, i) => {
      const p = clamp01((t - start - i * stagger) / each);
      if (p <= 0) return;
      const e = ease(p);
      o.save();
      o.setTransform(...base);
      const [cx, cy] = u.center;
      let alpha = 1, sc = 1, dy = 0;
      switch (wr.anim || 'rise') {
        case 'fade': alpha = e; break;
        case 'pop': sc = getEase('back')(p); alpha = clamp01(p * 3); break;
        case 'rise': dy = (1 - e) * hh * 0.35; alpha = e; break;
        case 'drop': dy = -(1 - getEase('bounce')(p)) * hh * 0.6; alpha = clamp01(p * 4); break;
        case 'grow': sc = e; alpha = e; break;
      }
      o.globalAlpha = alpha;
      o.translate(cx, cy + dy); o.scale(sc, sc); o.translate(-cx, -cy);
      o.beginPath();
      u.clip(o);
      o.clip(u.rule || 'nonzero');
      draw(o);
      o.restore();
    });
    return;
  }
  // وضع القلم
  const P = ease(clamp01((t - start) / dur));
  if (P <= 0) return;
  if (P >= 1) { draw(o); return; }
  const geo = asset.type === 'svg' ? getGeometry(asset, blobOf) : null;
  if (geo && geo.items.length) {
    // كشف حقيقي على مسار الأشكال بقلم عريض
    const mask = scratchCanvas(W, H, 3);
    const mc = mask.getContext('2d');
    mc.setTransform(1, 0, 0, 1, 0, 0); mc.clearRect(0, 0, W, H);
    mc.setTransform(...base);
    mc.lineCap = mc.lineJoin = 'round';
    mc.strokeStyle = '#000';
    const all = geo.items.flatMap((it) => it.subpaths.map((sp) => ({ sp, it })));
    const lens = all.map(({ sp }) => { let L = 0; for (let i = 1; i < sp.length; i++) L += Math.hypot(sp[i][0] - sp[i - 1][0], sp[i][1] - sp[i - 1][1]); return L; });
    const total = lens.reduce((a, b) => a + b, 0);
    let remain = P * total;
    const maxPen = Math.max(w, hh) * 0.12;
    for (let j = 0; j < all.length && remain > 0; j++) {
      const { sp, it } = all[j];
      const [x0, y0, x1, y1] = it.bbox;
      mc.lineWidth = Math.max(3, Math.min(maxPen, Math.min(x1 - x0, y1 - y0) * 0.7));
      mc.beginPath();
      mc.moveTo(sp[0][0], sp[0][1]);
      let acc = 0;
      for (let i = 1; i < sp.length; i++) {
        const seg = Math.hypot(sp[i][0] - sp[i - 1][0], sp[i][1] - sp[i - 1][1]);
        if (acc + seg > remain) { const f = (remain - acc) / seg; mc.lineTo(sp[i - 1][0] + (sp[i][0] - sp[i - 1][0]) * f, sp[i - 1][1] + (sp[i][1] - sp[i - 1][1]) * f); acc = remain; break; }
        mc.lineTo(sp[i][0], sp[i][1]);
        acc += seg;
      }
      mc.stroke();
      remain -= lens[j];
    }
    draw(o);
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.globalCompositeOperation = 'destination-in';
    o.drawImage(mask, 0, 0);
    o.globalCompositeOperation = 'source-over';
    o.setTransform(...base);
    return;
  }
  // نص أو صورة: كشف من اليمين إلى اليسار بحافة ناعمة، سطرًا بعد سطر
  draw(o);
  const L = asset.type === 'text' ? asset._layout : null;
  const lines = L ? L.lines.length : 1;
  const lineH = L ? L.lineH : hh;
  const top0 = L ? L.pad / 2 : 0;
  const feather = w * 0.08;
  o.globalCompositeOperation = 'destination-in';
  for (let i = 0; i < lines; i++) {
    const lp = clamp01(P * lines - i);
    const y0 = i === 0 ? -1e4 : top0 + lineH * i;
    const y1 = i === lines - 1 ? 1e4 : top0 + lineH * (i + 1);
    if (lp <= 0) { o.fillStyle = 'rgba(0,0,0,0)'; o.clearRect(-margin, y0, w + margin * 2, y1 - y0); continue; }
    const edge = w + feather - lp * (w + feather * 2);
    const g = o.createLinearGradient(edge - feather, 0, edge + feather, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
    o.fillStyle = g;
    o.fillRect(-margin, y0, w + margin * 2, y1 - y0);
  }
  o.globalCompositeOperation = 'source-over';
}

/** وحدات «الحرف» للظهور واحدًا واحدًا: حروف النص، أو أشكال SVG */
function letterUnits(asset) {
  if (asset.type === 'text') {
    const L = asset._layout;
    return L.letters.map((l) => {
      const y0 = L.pad / 2 + L.lineH * l.line, y1 = y0 + L.lineH;
      return { center: [(l.x0 + l.x1) / 2, (y0 + y1) / 2], clip: (o) => o.rect(l.x0, y0 - L.lineH * 0.3, l.x1 - l.x0, L.lineH * 1.6) };
    });
  }
  if (asset.type === 'svg') {
    const geo = getGeometry(asset, blobOf);
    if (!geo || !geo.items.length) return null;
    return geo.items.map((it) => ({
      center: [(it.bbox[0] + it.bbox[2]) / 2, (it.bbox[1] + it.bbox[3]) / 2],
      rule: 'evenodd',
      clip: (o) => { const pad = 1.5; o.rect(it.bbox[0] - pad, it.bbox[1] - pad, it.bbox[2] - it.bbox[0] + pad * 2, it.bbox[3] - it.bbox[1] + pad * 2); }
    }));
  }
  // صورة عادية: شرائح عمودية من اليمين
  const n = 8;
  return Array.from({ length: n }, (_, i) => {
    const x1 = asset.width * (1 - i / n), x0 = asset.width * (1 - (i + 1) / n);
    return { center: [(x0 + x1) / 2, asset.height / 2], clip: (o) => o.rect(x0, 0, x1 - x0, asset.height) };
  });
}

// التحوّل: شكل حرف يتحول إلى شكل آخر بنعومة
const morphCache = new Map();
function drawMorph(o, base, project, layer, asset, src, t, opts) {
  const mo = layer.fx.morph;
  const target = getAsset(project, mo.toAssetId);
  if (!target) return false;
  const start = mo.start || 0, dur = Math.max(0.1, mo.dur || 1.5);
  const q = getEase(mo.ease || 'easeInOut')(clamp01((t - start) / dur));
  const w = asset.width, hh = asset.height;
  // الهدف يوضع داخل صندوق العنصر مع الحفاظ على نسبته
  const fk = Math.min(w / target.width, hh / target.height);
  const fx = (w - target.width * fk) / 2, fy = (hh - target.height * fk) / 2;
  const tsrc = opts.cache?.get(target.id);
  const drawTarget = (c) => { c.save(); c.translate(fx, fy); c.scale(fk, fk); contentDrawer(project, target, tsrc)(c); c.restore(); };
  if (q <= 0) { contentDrawer(project, asset, src)(o); return true; }
  if (q >= 1) { drawTarget(o); return true; }
  const ga = asset.type === 'svg' ? getGeometry(asset, blobOf) : null;
  const gb = target.type === 'svg' ? getGeometry(target, blobOf) : null;
  if (ga?.items.length && gb?.items.length) {
    const key = asset.id + '>' + target.id;
    let pairs = morphCache.get(key);
    if (!pairs) {
      const gbFit = { items: gb.items.map((it) => ({ ...it, subpaths: it.subpaths.map((sp) => sp.map(([x, y]) => [fx + x * fk, fy + y * fk])) })) };
      pairs = prepareMorph(ga, gbFit, 120);
      morphCache.set(key, pairs);
    }
    o.beginPath();
    for (const p of pairs) {
      for (let i = 0; i < p.a.length; i++) {
        const x = p.a[i][0] + (p.b[i][0] - p.a[i][0]) * q, y = p.a[i][1] + (p.b[i][1] - p.a[i][1]) * q;
        i ? o.lineTo(x, y) : o.moveTo(x, y);
      }
      o.closePath();
    }
    o.fillStyle = mixCss(pairs[0]?.fillA, pairs[0]?.fillB, q);
    o.fill('evenodd');
    return true;
  }
  // للنصوص والصور: ذوبان ناعم مع ضبابية
  o.save();
  o.globalAlpha = 1 - q; o.filter = `blur(${(q * 10).toFixed(1)}px)`;
  contentDrawer(project, asset, src)(o);
  o.globalAlpha = q; o.filter = `blur(${((1 - q) * 10).toFixed(1)}px)`;
  drawTarget(o);
  o.restore();
  return true;
}

function parseCss(c) {
  if (!c) return [0, 0, 0];
  if (c[0] === '#') return hexToRgb(c);
  const m = c.match(/\d+(\.\d+)?/g);
  return m ? m.slice(0, 3).map(Number) : [0, 0, 0];
}
function mixCss(a, b, q) {
  const A = parseCss(a), B = parseCss(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * q)).join(',')})`;
}

// ——— لوحة «تحريك الخط» ———
propSections.splice(1, 0, (ed, layer) => {
  const asset = getAsset(ed.project, layer.assetId);
  if (!asset || !['text', 'svg', 'image'].includes(asset.type)) return null;
  const fx = layer.fx ||= {};
  const sec = h('section.sec.fx-sec', h('h3', icon('text', 18), ' تحريك الخط'));
  const commit = () => { ed.commit(); ed.emit('select'); };
  // معاينة قبل الاعتماد: التعديل على نسخة الطبقة الحالية في المشروع
  const tryFx = (label, mut, group) => ed.tryChange(label, () => { const L = ed.layerById(layer.id); mut(L.fx ||= {}); }, { group: group || label });
  const toggle = (key, label, defaults, testid) => {
    const on = !!fx[key]?.on;
    const cb = h('input', { type: 'checkbox', checked: on, 'data-testid': testid, onchange: () => {
      const v = cb.checked;
      tryFx(label, (f) => {
        f[key] = { ...defaults, ...(f[key] || {}), on: v };
        if (v && f[key].start == null) f[key].start = ed.time;
      });
    } });
    return h('label.field.row', cb, h('strong', label));
  };
  const num = (obj, key, label, step = 0.1, min = 0) => {
    const i = h('input.num', { type: 'number', step, min, value: obj[key] ?? '', 'aria-label': label, onchange: () => { const v = parseFloat(i.value); if (!isNaN(v)) { obj[key] = Math.max(min, v); ed.commit(); } } });
    return h('label.field', h('span', label), i);
  };
  const startHere = (obj) => btn('first', 'ابدأ من المؤشر', () => { obj.start = Math.round(ed.time * 1000) / 1000; commit(); });

  // الكتابة الحية
  sec.append(toggle('write', 'الكتابة الحية', { mode: 'pen', dur: 2, anim: 'rise', ease: 'easeInOut' }, 'fx-write'));
  if (fx.write?.on) {
    const wr = fx.write;
    const modes = h('div.seg', [['pen', 'بالقلم'], ['letters', 'حرفًا حرفًا']].map(([id, l]) => h('button', { type: 'button', 'aria-pressed': (wr.mode || 'pen') === id, dataset: { wmode: id }, onclick: () => tryFx(l, (f) => { f.write.mode = id; }, 'wmode') }, l)));
    sec.append(modes, h('div.mod-ctl', num(wr, 'start', 'يبدأ (ث)'), num(wr, 'dur', 'المدة (ث)')), startHere(wr));
    if (wr.mode === 'letters') {
      sec.append(h('div.chips', Object.entries(LETTER_ANIMS).map(([id, l]) => h('button.chip', { type: 'button', 'aria-pressed': (wr.anim || 'rise') === id, dataset: { lanim: id }, onclick: () => tryFx(l, (f) => { f.write.anim = id; }, 'lanim') }, l))));
    }
    sec.append(h('p.muted', asset.type === 'svg' ? 'في SVG يسير القلم على حدود الأشكال من اليمين إلى اليسار.' : 'يُكشف الخط من اليمين إلى اليسار باتجاه الكتابة.'));
  }
  // اللمعان
  sec.append(toggle('shine', 'لمعان يمر على الحروف', { period: 2.5, color: '#ffffff', width: 0.18 }, 'fx-shine'));
  if (fx.shine?.on) {
    const c = h('input.color', { type: 'color', value: fx.shine.color || '#ffffff', onchange: () => { fx.shine.color = c.value; ed.commit(); } });
    sec.append(h('div.mod-ctl', num(fx.shine, 'period', 'كل (ث)'), h('label.field', h('span', 'اللون'), c)));
  }
  // التوهج
  sec.append(toggle('glow', 'توهج نابض', { size: 30, speed: 1, color: '#ffd166' }, 'fx-glow'));
  if (fx.glow?.on) {
    const c = h('input.color', { type: 'color', value: fx.glow.color || '#ffd166', onchange: () => { fx.glow.color = c.value; ed.commit(); } });
    sec.append(h('div.mod-ctl', num(fx.glow, 'size', 'الحجم', 1), num(fx.glow, 'speed', 'السرعة')), h('label.field', h('span', 'اللون'), c));
  }
  // التحوّل
  const others = ed.project.assets.filter((a) => a.id !== asset.id && ['text', 'svg', 'image'].includes(a.type));
  if (others.length) {
    const mo = fx.morph || {};
    const sel = h('select', { 'aria-label': 'يتحوّل إلى', 'data-testid': 'fx-morph', onchange: () => {
      const v = sel.value;
      tryFx('التحوّل', (f) => { if (!v) delete f.morph; else f.morph = { ...mo, toAssetId: v, start: mo.start ?? ed.time, dur: mo.dur || 1.5 }; });
    } }, h('option', { value: '' }, '— بلا تحوّل —'), others.map((a) => h('option', { value: a.id, selected: mo.toAssetId === a.id }, a.name)));
    sec.append(h('label.field', h('strong', 'التحوّل إلى شكل آخر (Morph)'), sel));
    if (fx.morph) sec.append(h('div.mod-ctl', num(fx.morph, 'start', 'يبدأ (ث)'), num(fx.morph, 'dur', 'المدة (ث)')), startHere(fx.morph),
      h('p.muted', asset.type === 'svg' && getAsset(ed.project, fx.morph.toAssetId)?.type === 'svg' ? 'تحوّل حقيقي بين أشكال SVG.' : 'بين النصوص والصور يكون التحوّل ذوبانًا ناعمًا؛ للتحوّل الحقيقي استخدم ملفي SVG.'));
  }
  return sec;
});

export { refreshText, invalidateGeometry };
