// لوحة الخصائص: تظهر عند اختيار عنصر أو مفتاح
import { h, btn, clear, toast, confirmBox } from './dom.js';
import { icon } from './icons.js';
import { PROPS, PHASE1_PROPS, evalLayer, getAsset, createAsset, instancesOf } from '../core/project.js';
import { findKeyIndex, removeKey } from '../core/keyframes.js';
import { uid } from '../core/math.js';

export const propSections = []; // أقسام إضافية: fn(ed, layer, panel) => Element
export const keySections = []; // أقسام عند اختيار مفتاح
export const sceneSections = []; // أقسام إعدادات المشهد عند عدم اختيار شيء

export let visibleProps = [...PHASE1_PROPS];
export function setVisibleProps(list) { visibleProps = list; }

export class PropsPanel {
  constructor(ed) {
    this.ed = ed;
    this.el = h('aside.panel.props', { 'data-testid': 'props', 'aria-label': 'الخصائص' });
    this.body = h('div.props-body');
    this.el.append(h('div.panel-head', h('h2', 'الخصائص')), this.body);
    ed.on('select', () => this.render());
    ed.on('change', () => this.refresh());
    ed.on('time', () => this.refresh());
    this.render();
  }

  render() {
    const ed = this.ed;
    clear(this.body);
    this.inputs = [];
    const l = ed.layer;
    if (!l) { this.renderScene(); return; }
    const asset = getAsset(ed.project, l.assetId);
    const nameIn = h('input.text', { value: l.name, 'aria-label': 'اسم الطبقة', onchange: () => { l.name = nameIn.value; ed.commit(); } });
    this.body.append(h('label.field', h('span', 'اسم النسخة'), nameIn));

    // قسم المفتاح المختار
    if (ed.selectedKey && ed.selectedKey.layerId === l.id) {
      const sec = h('section.sec.key-sec', h('h3', icon('keyFill', 18), ' المفتاح المختار'));
      for (const fn of keySections) { const el = fn(ed, l, ed.selectedKey); if (el) sec.append(el); }
      sec.append(btn('trash', 'حذف المفتاح', () => this.deleteSelectedKey(), { cls: 'danger', testid: 'delete-key' }));
      this.body.append(sec);
    }

    const sec = h('section.sec', h('h3', 'الحركة والشكل'));
    const more = h('details.more', h('summary', 'الميل والضبابية والسطوع واللون'));
    for (const k of visibleProps) (PROPS[k].group === 'look' ? more : sec).append(this.propRow(l, k));
    if (more.children.length > 1) {
      if (visibleProps.some((k) => PROPS[k].group === 'look' && l.tracks[k]?.length)) more.open = true;
      sec.append(more);
    }
    this.body.append(sec);
    for (const fn of propSections) { const el = fn(ed, l, this); if (el) this.body.append(el); }

    // إجراءات النسخة
    const n = instancesOf(ed.project, l.assetId).length;
    const actions = h('section.sec', h('h3', 'النسخة'),
      h('p.muted', n > 1 ? `هذه نسخة مرتبطة من «${asset?.name}» (${n} نسخ). تعديل العنصر في المكتبة يغيرها كلها.` : `نسخة من «${asset?.name || '؟'}».`),
      h('div.btn-grid',
        btn('copy', 'تكرار', () => this.duplicate(l), { testid: 'duplicate' }),
        btn('unlink', 'فصل هذه النسخة', () => this.detach(l), { testid: 'detach', title: 'اجعل لهذه النسخة عنصرًا مستقلًا في المكتبة' }),
        btn('chevronUp', 'للأمام', () => this.reorder(l, 1)),
        btn('chevronDown', 'للخلف', () => this.reorder(l, -1)),
        btn('trash', 'حذف', () => this.remove(l), { cls: 'danger', testid: 'delete-layer' })
      ));
    this.body.append(actions);
    this.refresh();
  }

  renderScene() {
    const ed = this.ed, p = ed.project;
    const sec = h('section.sec', h('h3', 'المشهد'));
    const num = (label, key, min, max, step = 1) => {
      const inp = h('input.num', { type: 'number', min, max, step, value: p[key], 'aria-label': label, onchange: () => { const v = parseFloat(inp.value); if (!isNaN(v)) { p[key] = Math.max(min, Math.min(max, v)); ed.commit(); } } });
      return h('label.field', h('span', label), inp);
    };
    sec.append(num('المدة (ثوانٍ)', 'duration', 0.5, 600, 0.5));
    const fpsSel = h('select', { 'aria-label': 'الإطارات في الثانية', onchange: () => { p.fps = +fpsSel.value; ed.commit(); } },
      [24, 30, 60].map((f) => h('option', { value: f, selected: p.fps === f }, `${f} إطارًا/ث`)));
    sec.append(h('label.field', h('span', 'الإطارات في الثانية'), fpsSel));
    const bgOn = h('input', { type: 'checkbox', checked: !!p.background, onchange: () => { p.background = bgOn.checked ? (bg.value || '#ffffff') : null; ed.commit(); } });
    const bg = h('input.color', { type: 'color', value: p.background || '#ffffff', 'aria-label': 'لون الخلفية', oninput: () => { if (bgOn.checked) { p.background = bg.value; ed.live(); } }, onchange: () => ed.commit() });
    sec.append(h('label.field.row', h('span', 'خلفية ملونة'), bgOn, bg));
    sec.append(h('p.muted', `المقاس: ${p.width}×${p.height}. اختر عنصرًا على المشهد أو في الخط الزمني لتعديل حركته.`));
    this.body.append(sec);
    for (const fn of sceneSections) { const el = fn(ed, this); if (el) this.body.append(el); }
  }

  propRow(l, k) {
    const ed = this.ed;
    const def = PROPS[k];
    const keyBtn = h('button.keybtn', { type: 'button', 'aria-label': 'مفتاح ' + def.label, title: 'إضافة/حذف مفتاح عند هذا الزمن', dataset: { testid: 'key-' + k } });
    keyBtn.addEventListener('click', () => {
      const tr = l.tracks[k] ||= [];
      const t = ed.localTime(l);
      const i = findKeyIndex(tr, t, 1e-4);
      if (i >= 0) {
        tr.splice(i, 1);
        if (!tr.length) delete l.tracks[k];
      } else {
        ed.setProp(l, k, evalLayer(l, ed.time)[k], { forceKey: true });
      }
      ed.commit();
    });
    let input, slider;
    if (def.type === 'color') {
      input = h('input.color', { type: 'color', 'aria-label': def.label });
      input.addEventListener('input', () => { ed.setProp(l, k, input.value); ed.live(); });
      input.addEventListener('change', () => ed.commit());
    } else {
      const toUi = (v) => def.pct ? Math.round(v * 1000) / 10 : Math.round(v * 100) / 100;
      const fromUi = (v) => def.pct ? v / 100 : v;
      input = h('input.num', { type: 'number', step: def.pct ? 1 : def.step, 'aria-label': def.label, dataset: { testid: 'prop-' + k }, inputMode: 'decimal' });
      input.addEventListener('change', () => { const v = parseFloat(input.value); if (!isNaN(v)) { ed.setProp(l, k, fromUi(v)); ed.commit(); } });
      const range = sliderRange(k, ed.project);
      slider = h('input.slider', { type: 'range', min: range[0], max: range[1], step: def.pct ? 1 : def.step, 'aria-label': def.label + ' (منزلق)' });
      slider.addEventListener('input', () => { ed.setProp(l, k, fromUi(parseFloat(slider.value))); ed.live(); });
      slider.addEventListener('change', () => ed.commit());
      input._toUi = toUi;
    }
    this.inputs.push({ k, input, slider, keyBtn, l });
    return h('div.prop-row', keyBtn, h('label', h('span', def.label + (def.unit && !def.pct ? ` (${def.unit})` : def.pct ? ' %' : '')), h('div.prop-ctl', input, slider || '')));
  }

  refresh() {
    const ed = this.ed;
    const l = ed.layer;
    if (!l || !this.inputs) return;
    if (this.inputs[0] && this.inputs[0].l !== l) { this.render(); return; }
    const s = evalLayer(l, ed.time);
    for (const it of this.inputs) {
      const v = s[it.k];
      if (document.activeElement !== it.input) it.input.value = it.input._toUi ? it.input._toUi(v) : v;
      if (it.slider && document.activeElement !== it.slider) it.slider.value = it.input._toUi(v);
      const has = ed.hasKeyAt(l, it.k);
      const anim = !!l.tracks[it.k]?.length;
      it.keyBtn.innerHTML = icon(has ? 'keyFill' : 'key', 22);
      it.keyBtn.classList.toggle('on', has);
      it.keyBtn.classList.toggle('anim', anim);
    }
  }

  deleteSelectedKey() {
    const ed = this.ed, sk = ed.selectedKey;
    const l = ed.layer;
    if (!sk || !l) return;
    const props = sk.prop ? [sk.prop] : Object.keys(l.tracks);
    for (const p of props) {
      const tr = l.tracks[p];
      if (!tr) continue;
      const i = findKeyIndex(tr, sk.t, 1e-4);
      if (i >= 0) removeKey(tr, i);
      if (!tr.length) delete l.tracks[p];
    }
    ed.selectKey(null);
    ed.commit();
  }

  duplicate(l) {
    const ed = this.ed;
    const copy = JSON.parse(JSON.stringify(l));
    copy.id = uid('lyr');
    copy.name = l.name + ' (نسخة)';
    copy.props.x += 30; copy.props.y += 30;
    for (const k of ['x', 'y']) for (const key of copy.tracks[k] || []) key.v += 30;
    const i = ed.project.layers.indexOf(l);
    ed.project.layers.splice(i + 1, 0, copy);
    ed.select(copy.id);
    ed.commit();
  }

  detach(l) {
    const ed = this.ed;
    const a = getAsset(ed.project, l.assetId);
    if (!a) return;
    const copy = JSON.parse(JSON.stringify(a));
    copy.id = uid('ast');
    copy.name = a.name + ' (مستقل)';
    ed.project.assets.push(copy);
    l.assetId = copy.id;
    ed.cache.ensure(copy);
    ed.commit();
    toast('صارت هذه النسخة مستقلة، وتعديلها لا يؤثر في غيرها');
  }

  reorder(l, dir) {
    const arr = this.ed.project.layers;
    const i = arr.indexOf(l), j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    this.ed.commit();
  }

  async remove(l) {
    const ed = this.ed;
    ed.project.layers = ed.project.layers.filter((x) => x.id !== l.id);
    for (const o of ed.project.layers) if (o.parentId === l.id) o.parentId = null;
    ed.select(null);
    ed.commit();
    toast('حُذفت النسخة (يمكنك التراجع)');
  }
}

function sliderRange(k, p) {
  switch (k) {
    case 'x': return [-p.width * 0.5, p.width * 1.5];
    case 'y': return [-p.height * 0.5, p.height * 1.5];
    case 'scale': return [0, 400];
    case 'rotation': return [-360, 360];
    case 'opacity': return [0, 100];
    case 'skewX': return [-60, 60];
    case 'blur': return [0, 50];
    case 'brightness': return [0, 300];
    case 'tintAmount': return [0, 100];
    default: return [0, 100];
  }
}
export { createAsset };
