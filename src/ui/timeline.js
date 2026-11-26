// الخط الزمني: لكل عنصر مسار، والمفاتيح معيّنات ◆. الزمن يسير من اليسار إلى اليمين كبرامج الفيديو.
import { h, btn, clear, fmtTime } from './dom.js';
import { icon } from './icons.js';
import { getAsset, PROPS, PHASE1_PROPS, PROP_KEYS } from '../core/project.js';
import { moveKey, snapToFrame } from '../core/keyframes.js';

export const timelineExtras = []; // صفوف إضافية (الصوت، العلامات) تضيفها المراحل اللاحقة
export const laneDecorators = []; // رسومات إضافية داخل مسار الطبقة
const NAME_W = 168;
const ROW_H = 44;

export class Timeline {
  constructor(ed) {
    this.ed = ed;
    this.expanded = new Set();
    this.pps = null; // بكسل لكل ثانية
    this.el = h('section.timeline', { 'data-testid': 'timeline' });
    this.handle = h('div.tl-handle', { title: 'اسحب لتكبير أو طي الخط الزمني', 'aria-label': 'مقبض الخط الزمني' }, h('span'));
    this.transport = h('div.tl-transport', { dir: 'ltr' });
    this.body = h('div.tl-body', { dir: 'ltr' });
    this.inner = h('div.tl-inner');
    this.playhead = h('div.tl-playhead');
    this.body.append(this.inner);
    this.el.append(this.handle, this.transport, this.body);
    this.buildTransport();
    this.setupHandle();
    ed.on('change', () => this.render());
    ed.on('select', () => this.render());
    ed.on('time', () => { this.updatePlayhead(); this.updateTransport(); });
    ed.on('play', () => this.updateTransport());
    this.body.addEventListener('wheel', (e) => {
      if (e.ctrlKey) { e.preventDefault(); this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15); }
    }, { passive: false });
    new ResizeObserver(() => { if (!this.userZoom) this.pps = null; this.render(); }).observe(this.body);
  }

  buildTransport() {
    const ed = this.ed;
    this.playBtn = btn('play', 'تشغيل', () => ed.emit('toggle-play'), { iconOnly: true, testid: 'play', cls: 'primary round' });
    this.timeLabel = h('output.tl-time', { 'data-testid': 'time' }, '0:00');
    this.keyBtn = btn('key', 'إضافة مفتاح', () => {
      const l = ed.layer;
      if (!l) return;
      ed.keyAll(l);
      ed.commit();
    }, { iconOnly: true, testid: 'add-key', title: 'إضافة مفتاح للعنصر المختار عند هذا الزمن' });
    this.transport.append(
      btn('first', 'إلى البداية', () => ed.setTime(0), { iconOnly: true, title: 'إلى البداية' }),
      btn('prev', 'الإطار السابق', () => ed.setTime(ed.time - 1 / ed.project.fps), { iconOnly: true, title: 'الإطار السابق' }),
      this.playBtn,
      btn('next', 'الإطار التالي', () => ed.setTime(ed.time + 1 / ed.project.fps), { iconOnly: true, title: 'الإطار التالي' }),
      this.timeLabel,
      h('span.grow'),
      this.keyBtn,
      btn('zoomOut', 'تصغير', () => this.zoomBy(1 / 1.4), { iconOnly: true, cls: 'tl-zoom' }),
      btn('zoomIn', 'تكبير', () => this.zoomBy(1.4), { iconOnly: true, cls: 'tl-zoom' }),
      btn('chevronDown', 'طي الخط الزمني', () => this.toggleCollapse(), { iconOnly: true, cls: 'collapse-btn', testid: 'tl-collapse' })
    );
    this.updateTransport();
  }

  toggleCollapse(force) {
    const c = force ?? !this.el.classList.contains('collapsed');
    this.el.classList.toggle('collapsed', c);
    this.el.style.height = '';
    const b = this.transport.querySelector('.collapse-btn');
    if (b) b.innerHTML = icon(c ? 'chevronUp' : 'chevronDown');
    this.ed.emit('layout');
  }

  setupHandle() {
    // سحب المقبض لأعلى يفتح الخط الزمني ولأسفل يطويه (مناسب للجوال)
    let startY = 0, startH = 0, moved = false;
    this.handle.addEventListener('pointerdown', (e) => {
      this.handle.setPointerCapture(e.pointerId);
      startY = e.clientY; startH = this.el.getBoundingClientRect().height; moved = false;
    });
    this.handle.addEventListener('pointermove', (e) => {
      if (!this.handle.hasPointerCapture(e.pointerId)) return;
      const dy = startY - e.clientY;
      if (Math.abs(dy) > 6) moved = true;
      if (!moved) return;
      const hgt = Math.max(64, Math.min(window.innerHeight * 0.75, startH + dy));
      this.el.classList.toggle('collapsed', hgt < 110);
      this.el.style.height = hgt < 110 ? '' : hgt + 'px';
    });
    this.handle.addEventListener('pointerup', () => {
      if (!moved) this.toggleCollapse();
      this.ed.emit('layout');
    });
  }

  zoomBy(f) {
    this.userZoom = true;
    this.pps = Math.max(8, Math.min(2000, (this.pps || this.fitPps()) * f));
    this.render();
  }
  fitPps() {
    const w = this.body.clientWidth - NAME_W - 24;
    return Math.max(8, w / Math.max(0.5, this.ed.project.duration));
  }
  xOf(t) { return 12 + t * this.pps; }
  tOf(x) { return (x - 12) / this.pps; }

  updateTransport() {
    const ed = this.ed;
    this.playBtn.innerHTML = icon(ed.playing ? 'pause' : 'play');
    this.playBtn.setAttribute('aria-label', ed.playing ? 'إيقاف' : 'تشغيل');
    this.timeLabel.textContent = `${fmtTime(ed.time, ed.project.fps)} / ${fmtTime(ed.project.duration, ed.project.fps)}`;
  }

  updatePlayhead() {
    if (!this.pps) return;
    this.playhead.style.transform = `translateX(${this.xOf(this.ed.time)}px)`;
  }

  rowsFor(layer) {
    const keyed = PROP_KEYS.filter((k) => layer.tracks[k]?.length);
    const base = PHASE1_PROPS.filter((k) => !keyed.includes(k));
    return [...keyed, ...base];
  }

  render() {
    const ed = this.ed;
    const p = ed.project;
    if (!this.pps) this.pps = this.fitPps();
    const laneW = this.xOf(p.duration) + 40;
    clear(this.inner);
    this.inner.style.width = laneW + NAME_W + 'px';
    // المسطرة
    const ruler = h('div.tl-row.tl-ruler', { 'data-testid': 'ruler' });
    const rlane = h('div.tl-lane', { style: { width: laneW + 'px' } });
    const step = niceStep(this.pps);
    for (let t = 0; t <= p.duration + 1e-6; t += step) {
      rlane.append(h('span.tick', { style: { left: this.xOf(t) + 'px' } }, formatTick(t, step)));
    }
    // نهاية المشهد
    rlane.append(h('div.tl-end', { style: { left: this.xOf(p.duration) + 'px' } }));
    ruler.append(rlane, h('div.tl-name.tl-corner', 'العناصر'));
    this.inner.append(ruler);
    this.scrub(rlane);
    for (const fn of timelineExtras) {
      const row = fn(this);
      if (row) this.inner.append(row);
    }
    // الطبقات: الأعلى أولًا
    const layers = [...p.layers].reverse();
    if (!layers.length) {
      this.inner.append(h('div.tl-empty', 'أضف عنصرًا من المكتبة ليظهر مساره هنا'));
    }
    for (const layer of layers) {
      const sel = layer.id === ed.selectedLayerId;
      const exp = this.expanded.has(layer.id);
      const asset = getAsset(p, layer.assetId);
      const row = h('div.tl-row.tl-layer' + (sel ? '.selected' : ''), { dataset: { layer: layer.id } });
      const lane = h('div.tl-lane', { style: { width: laneW + 'px' } });
      const s = layer.start || 0, e = layer.end == null ? p.duration : layer.end;
      lane.append(h('div.tl-bar', { style: { left: this.xOf(s) + 'px', width: Math.max(2, (e - s) * this.pps) + 'px' } }));
      // كل المفاتيح في صف الملخص
      const times = new Map();
      for (const k of PROP_KEYS) for (const key of layer.tracks[k] || []) times.set(key.t.toFixed(4), key.t);
      for (const t of times.values()) lane.append(this.diamond(layer, null, t, true));
      for (const dec of laneDecorators) dec(lane, layer, this);
      this.laneClick(lane, layer);
      const name = h('div.tl-name',
        h('button.tl-exp', { type: 'button', 'aria-label': exp ? 'طي الخصائص' : 'عرض الخصائص', html: icon(exp ? 'chevronUp' : 'chevronDown', 20), onclick: (ev) => { ev.stopPropagation(); exp ? this.expanded.delete(layer.id) : this.expanded.add(layer.id); this.render(); } }),
        h('span.tl-label', { title: layer.name }, layer.name + (asset ? '' : ' ⚠')),
        h('button.tl-vis', { type: 'button', 'aria-label': layer.visible ? 'إخفاء' : 'إظهار', html: icon(layer.visible ? 'eye' : 'eyeOff', 20), onclick: (ev) => { ev.stopPropagation(); layer.visible = !layer.visible; ed.commit(); } })
      );
      name.addEventListener('click', () => ed.select(layer.id));
      row.append(lane, name);
      this.inner.append(row);
      if (exp) {
        for (const prop of this.rowsFor(layer)) {
          const prow = h('div.tl-row.tl-prop', { dataset: { layer: layer.id, prop } });
          const plane = h('div.tl-lane', { style: { width: laneW + 'px' } });
          for (const key of layer.tracks[prop] || []) plane.append(this.diamond(layer, prop, key.t, false));
          this.laneClick(plane, layer);
          prow.append(plane, h('div.tl-name.sub', PROPS[prop]?.label || prop));
          this.inner.append(prow);
        }
      }
    }
    this.inner.append(this.playhead);
    this.playhead.style.height = this.inner.scrollHeight + 'px';
    this.updatePlayhead();
    this.updateTransport();
  }

  diamond(layer, prop, t, summary) {
    const ed = this.ed;
    const sk = ed.selectedKey;
    const selected = sk && sk.layerId === layer.id && Math.abs(sk.t - t) < 1e-4 && (summary ? !sk.prop || true : sk.prop === prop);
    const kobj = prop ? layer.tracks[prop]?.find((k) => Math.abs(k.t - t) < 1e-4) : null;
    const easeCls = kobj && kobj.ease && kobj.ease !== 'linear' ? (kobj.ease === 'hold' ? '.hold' : '.eased') : '';
    const d = h('div.key' + (summary ? '.summary' : '') + (selected ? '.selected' : '') + easeCls, {
      style: { left: this.xOf(t) + 'px' },
      role: 'button',
      'aria-label': `مفتاح عند ${fmtTime(t, ed.project.fps)}`,
      dataset: { t: t.toFixed(4), prop: prop || '' }
    });
    d.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      d.setPointerCapture(e.pointerId);
      ed.selectKey({ layerId: layer.id, prop, t });
      ed.setTime(t);
      const x0 = e.clientX;
      let moved = false;
      const onMove = (ev) => {
        const dt = (ev.clientX - x0) / this.pps;
        if (!moved && Math.abs(ev.clientX - x0) < 6) return;
        moved = true;
        const nt = Math.max(0, snapToFrame(t + dt, ed.project.fps));
        d.style.left = this.xOf(nt) + 'px';
        d.dataset.nt = nt;
      };
      const onUp = () => {
        d.removeEventListener('pointermove', onMove);
        d.removeEventListener('pointerup', onUp);
        d.removeEventListener('pointercancel', onUp);
        if (moved && d.dataset.nt != null) {
          const nt = parseFloat(d.dataset.nt);
          const props = prop ? [prop] : PROP_KEYS;
          for (const pr of props) {
            const tr = layer.tracks[pr];
            if (!tr) continue;
            const i = tr.findIndex((k) => Math.abs(k.t - t) < 1e-4);
            if (i >= 0) moveKey(tr, i, nt);
          }
          ed.selectedKey = { layerId: layer.id, prop, t: nt };
          ed.setTime(nt);
          ed.commit();
        }
      };
      d.addEventListener('pointermove', onMove);
      d.addEventListener('pointerup', onUp);
      d.addEventListener('pointercancel', onUp);
    });
    return d;
  }

  laneClick(lane, layer) {
    lane.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.key')) return;
      this.ed.select(layer.id);
      this.ed.selectKey(null);
      this.scrubAt(e, lane);
    });
  }

  scrubAt(e, lane) {
    const r = lane.getBoundingClientRect();
    this.ed.setTime(this.tOf(e.clientX - r.left));
  }

  scrub(lane) {
    lane.addEventListener('pointerdown', (e) => {
      lane.setPointerCapture(e.pointerId);
      if (this.ed.playing) this.ed.emit('toggle-play');
      this.scrubAt(e, lane);
      const mv = (ev) => this.scrubAt(ev, lane);
      const up = () => { lane.removeEventListener('pointermove', mv); lane.removeEventListener('pointerup', up); };
      lane.addEventListener('pointermove', mv);
      lane.addEventListener('pointerup', up);
    });
  }
}

function niceStep(pps) {
  const steps = [1 / 30, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60];
  for (const s of steps) if (s * pps >= 60) return s;
  return 60;
}
function formatTick(t, step) {
  if (step >= 1) return Math.round(t) + 'ث';
  return (Math.round(t * 100) / 100).toString();
}
