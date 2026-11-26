// المرحلة 2: منحنيات السرعة، والحركات الجاهزة، والحلقة، وتصدير GIF وWebP
import { h, btn, toast } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { keySections, propSections, setVisibleProps } from '../ui/props.js';
import { exportFormats, exportOptionsExtras } from '../ui/exportDialog.js';
import { EASES, EASE_IDS, getEase, easeBezier, easeLabel } from '../core/easing.js';
import { KEY_PRESETS, MOD_TYPES, applyKeyPreset, registerMotion } from '../core/motion.js';
import { PROP_KEYS } from '../core/project.js';
import { findKeyIndex } from '../core/keyframes.js';
import { exportGif } from '../export/gif.js';
import { exportWebp } from '../export/webp.js';
import { uid } from '../core/math.js';
import { laneDecorators } from '../ui/timeline.js';

registerMotion();
setVisibleProps(PROP_KEYS);

/** المفاتيح المقصودة بالاختيار: مفتاح خاصية واحدة أو كل مفاتيح الطبقة في ذلك الزمن */
function selectedKeys(layer, sk) {
  const out = [];
  const props = sk.prop ? [sk.prop] : Object.keys(layer.tracks);
  for (const p of props) {
    const tr = layer.tracks[p];
    const i = findKeyIndex(tr, sk.t, 1e-4);
    if (i >= 0) out.push(tr[i]);
  }
  return out;
}

// ——— منحنيات السرعة ———
keySections.push((ed, layer, sk) => {
  const keys = selectedKeys(layer, sk);
  if (!keys.length) return null;
  const cur = keys[0].ease;
  const box = h('div.ease-box');
  box.append(h('p.muted', 'منحنى السرعة من هذا المفتاح إلى التالي:'));
  const chips = h('div.chips', { role: 'group', 'aria-label': 'منحنى السرعة' });
  for (const id of EASE_IDS) {
    const c = h('button.chip', { type: 'button', 'aria-pressed': cur === id, dataset: { ease: id } }, easeIcon(id), EASES[id].label);
    c.addEventListener('click', () => ed.tryChange('منحنى ' + EASES[id].label, () => { for (const k of selectedKeys(ed.layerById(layer.id), ed.selectedKey)) k.ease = id; }, { group: 'ease' }));
    chips.append(c);
  }
  box.append(chips);
  box.append(curveEditor(ed, keys));
  return box;
});

function easeIcon(id) {
  // رسم صغير لشكل المنحنى داخل الزر
  const f = getEase(id);
  let d = '';
  for (let i = 0; i <= 20; i++) { const x = i / 20; const y = f(x); d += `${i ? 'L' : 'M'}${(2 + x * 20).toFixed(1)},${(22 - y * 16 - 2).toFixed(1)}`; }
  const s = document.createElement('span');
  s.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="${d}"/></svg>`;
  return s.firstChild;
}

/** محرر منحنى بيزيه بمقبضين يُسحبان بالإصبع */
function curveEditor(ed, keys) {
  const wrap = h('div.curve-wrap');
  const S = 220, pad = 30;
  const c = h('canvas.curve', { width: S * 2, height: S * 2, style: { width: S + 'px', height: S + 'px' }, 'aria-label': 'محرر منحنى السرعة' });
  const label = h('small.muted');
  let bz = easeBezier(keys[0].ease) || [0.25, 0.1, 0.25, 1];
  bz = [...bz];
  const fn = () => (typeof keys[0].ease === 'object' || EASES[keys[0].ease]?.bezier ? null : getEase(keys[0].ease));
  const toPx = (x, y) => [(pad + x * (S - pad * 2)) * 2, (S - pad - y * (S - pad * 2)) * 2];
  const fromPx = (px, py) => [(px - pad) / (S - pad * 2), (S - pad - py) / (S - pad * 2)];
  function draw() {
    const g = c.getContext('2d');
    g.clearRect(0, 0, S * 2, S * 2);
    g.fillStyle = '#110f17'; g.fillRect(0, 0, S * 2, S * 2);
    g.strokeStyle = '#352f42'; g.lineWidth = 2;
    const [x0, y0] = toPx(0, 0), [x1, y1] = toPx(1, 1);
    g.strokeRect(x0, y1, x1 - x0, y0 - y1);
    const custom = fn();
    g.lineWidth = 5; g.strokeStyle = '#ffb000'; g.beginPath();
    if (custom) {
      for (let i = 0; i <= 60; i++) { const x = i / 60; const [px, py] = toPx(x, custom(x)); i ? g.lineTo(px, py) : g.moveTo(px, py); }
    } else {
      g.moveTo(x0, y0);
      const [a, b] = toPx(bz[0], bz[1]), [cc, d] = toPx(bz[2], bz[3]);
      g.bezierCurveTo(a, b, cc, d, x1, y1);
    }
    g.stroke();
    if (!custom) {
      g.lineWidth = 2; g.strokeStyle = '#4cc9f0';
      const [a, b] = toPx(bz[0], bz[1]), [cc, d] = toPx(bz[2], bz[3]);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(a, b); g.moveTo(x1, y1); g.lineTo(cc, d); g.stroke();
      for (const [px, py] of [[a, b], [cc, d]]) { g.beginPath(); g.arc(px, py, 18, 0, Math.PI * 2); g.fillStyle = '#4cc9f0'; g.fill(); }
      label.textContent = `cubic-bezier(${bz.map((v) => v.toFixed(2)).join(', ')})`;
    } else label.textContent = `${easeLabel(keys[0].ease)} — اسحب أي مقبض لتحويله إلى منحنى مخصص`;
  }
  let drag = -1;
  c.addEventListener('pointerdown', (e) => {
    const r = c.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const p1 = toPx(bz[0], bz[1]).map((v) => v / 2), p2 = toPx(bz[2], bz[3]).map((v) => v / 2);
    const d1 = Math.hypot(px - p1[0], py - p1[1]), d2 = Math.hypot(px - p2[0], py - p2[1]);
    drag = d1 < d2 ? 0 : 2;
    c.setPointerCapture(e.pointerId);
    move(e);
  });
  const move = (e) => {
    if (drag < 0) return;
    const r = c.getBoundingClientRect();
    let [x, y] = fromPx(e.clientX - r.left, e.clientY - r.top);
    x = Math.max(0, Math.min(1, x)); y = Math.max(-0.6, Math.min(1.6, y));
    bz[drag] = Math.round(x * 100) / 100; bz[drag + 1] = Math.round(y * 100) / 100;
    for (const k of keys) k.ease = { bezier: [...bz] };
    draw();
    ed.live();
  };
  c.addEventListener('pointermove', move);
  c.addEventListener('pointerup', () => { if (drag >= 0) { drag = -1; ed.commit(); } });
  wrap.append(c, label);
  draw();
  return wrap;
}

// ——— الحركات الجاهزة والمستمرة والحلقة ———
propSections.unshift((ed, layer) => {
  const sec = h('section.sec', h('h3', icon('wand', 18), ' حركات جاهزة بضغطة'));
  const grid = h('div.chips');
  for (const [id, p] of Object.entries(KEY_PRESETS)) {
    grid.append(h('button.chip', { type: 'button', dataset: { preset: id }, onclick: () => {
      ed.tryChange(p.label, () => applyKeyPreset(ed.layerById(layer.id), id, ed.time, ed.project), { group: 'preset' });
    } }, icon(p.icon, 18), p.label));
  }
  sec.append(h('p.muted', 'تُضاف كمفاتيح عند المؤشر الزمني:'), grid);

  // حركات مستمرة
  const modsBox = h('div.mods');
  const addRow = h('div.chips');
  for (const [type, m] of Object.entries(MOD_TYPES)) {
    addRow.append(h('button.chip', { type: 'button', dataset: { mod: type }, onclick: () => {
      ed.tryChange(m.label, () => { (ed.layerById(layer.id).mods ||= []).push({ id: uid('mod'), type, amount: m.amount, speed: m.speed }); }, { group: 'mod' });
    } }, icon('plus', 18), m.label));
  }
  for (const m of layer.mods || []) modsBox.append(modRow(ed, layer, m));
  sec.append(h('p.muted', 'حركات مستمرة طوال الوقت (تجتمع مع المفاتيح):'), addRow, modsBox);

  // التكرار والحلقة
  const lp = layer.loop || { mode: 'none', count: 0 };
  const modes = [['none', 'مرة واحدة'], ['loop', 'تكرار (حلقة)'], ['pingpong', 'ذهاب وإياب']];
  const seg = h('div.seg', { role: 'group', 'aria-label': 'التكرار' }, modes.map(([id, label]) => h('button', { type: 'button', 'aria-pressed': lp.mode === id, dataset: { loop: id }, onclick: () => {
    ed.tryChange(label, () => { const L = ed.layerById(layer.id); if (id === 'none') delete L.loop; else L.loop = { mode: id, count: lp.count || 0 }; }, { group: 'loop' });
  } }, label)));
  const count = h('input.num', { type: 'number', min: 0, max: 999, value: lp.count || 0, 'aria-label': 'عدد مرات التكرار (0 = بلا نهاية)', onchange: () => { if (layer.loop) { layer.loop.count = Math.max(0, parseInt(count.value) || 0); ed.commit(); } } });
  sec.append(h('h3', icon('loop', 18), ' تكرار الحركة'), seg);
  if (lp.mode !== 'none') sec.append(h('label.field', h('span', 'عدد المرات (0 = بلا نهاية)'), count));
  sec.append(h('p.muted', 'التكرار يعيد المقطع بين أول مفتاح وآخر مفتاح.'));
  return sec;
});

function modRow(ed, layer, m) {
  const def = MOD_TYPES[m.type];
  const num = (key, label, step) => {
    const i = h('input.num', { type: 'number', step, value: m[key], 'aria-label': label, onchange: () => { const v = parseFloat(i.value); if (!isNaN(v)) { m[key] = v; ed.commit(); } } });
    return h('label.field', h('span', label), i);
  };
  return h('div.mod-row', { dataset: { modrow: m.type } },
    h('strong', def.label),
    h('div.mod-ctl', num('amount', `المقدار (${def.unit})`, m.type === 'pulse' || m.type === 'blink' ? 0.01 : 1), num('speed', 'السرعة', 0.1)),
    btn('trash', 'إزالة', () => { layer.mods = layer.mods.filter((x) => x !== m); ed.commit(); ed.emit('select'); }, { iconOnly: true, cls: 'danger' })
  );
}

// إظهار الحركات المستمرة على مسار الطبقة في الخط الزمني
laneDecorators.push((lane, layer, tl) => {
  if (layer.mods?.length) lane.append(h('div.tl-mod', { title: layer.mods.map((m) => MOD_TYPES[m.type]?.label).join('، ') }, '∿ ' + layer.mods.map((m) => MOD_TYPES[m.type]?.label).join('، ')));
  if (layer.loop) lane.append(h('div.tl-loop', { title: 'تكرار' }, '⟳'));
});

// ——— التصدير ———
exportFormats.push(
  { id: 'gif', label: 'GIF (توافق قديم)', ext: 'gif', mime: 'image/gif', run: (p, o) => exportGif(p, { ...o, colors: o.state.gifColors || 256 }) },
  { id: 'webp', label: 'WebP متحرك (أصغر من GIF وأجود)', ext: 'webp', mime: 'image/webp', run: (p, o) => exportWebp(p, { ...o, quality: o.state.webpQuality ?? 0.85 }) }
);
exportOptionsExtras.push((state) => {
  state.gifColors = 256;
  const sel = h('select', { 'aria-label': 'عدد الألوان', 'data-testid': 'gif-colors', onchange: () => { state.gifColors = +sel.value; } },
    [256, 128, 64, 32, 16].map((n) => h('option', { value: n }, `${n} لونًا${n === 256 ? ' (أجود)' : n <= 32 ? ' (أصغر حجمًا)' : ''}`)));
  return h('label.field', { dataset: { formats: 'gif' } }, h('span', 'عدد الألوان'), sel);
});
exportOptionsExtras.push((state) => {
  state.webpQuality = 0.85;
  const r = h('input.slider', { type: 'range', min: 40, max: 100, value: 85, 'aria-label': 'الجودة', oninput: () => { state.webpQuality = r.value / 100; out.textContent = r.value + '%'; } });
  const out = h('output', '85%');
  return h('label.field', { dataset: { formats: 'webp' } }, h('span', 'الجودة'), h('div.row', r, out));
});
exportOptionsExtras.push((state) => {
  const cb = h('input', { type: 'checkbox', onchange: () => { state.transparent = cb.checked; } });
  return h('label.field.row', { dataset: { formats: 'gif,webp,webm,png' } }, cb, h('span', 'خلفية شفافة (يتجاهل لون الخلفية)'));
});
