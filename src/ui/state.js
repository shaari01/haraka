// حالة المحرر: المشروع، والزمن، والاختيار، والتراجع، والحفظ التلقائي
import { History } from '../core/history.js';
import { AssetCache } from '../core/assets.js';
import { saveProject } from '../storage/db.js';
import { getLayer, getAsset, evalLayer, PROPS } from '../core/project.js';
import { setKey, findKeyIndex, snapToFrame } from '../core/keyframes.js';

export class EditorState {
  constructor(project) {
    this.project = project;
    this.cache = new AssetCache();
    this.history = new History();
    this.history.reset(project);
    this.time = 0;
    this.playing = false;
    this.selectedLayerId = null;
    this.selectedKey = null; // {layerId, prop, t}
    this.autoKey = false;
    this.listeners = {};
    this.saveTimer = null;
    this.saving = Promise.resolve();
    this.cache.onChange(() => this.emit('render'));
    this.tool = 'select';
  }

  on(ev, fn) { (this.listeners[ev] ||= new Set()).add(fn); return () => this.listeners[ev].delete(fn); }
  emit(ev, data) {
    for (const fn of this.listeners[ev] || []) fn(data);
    if (ev !== 'render' && ev !== 'any') for (const fn of this.listeners.any || []) fn(ev);
  }

  get layer() { return this.selectedLayerId ? getLayer(this.project, this.selectedLayerId) : null; }
  get asset() { const l = this.layer; return l ? getAsset(this.project, l.assetId) : null; }

  /** يسجل تغييرًا في التاريخ ويحفظ تلقائيًا */
  commit() {
    if (this.trial) { this.trial = null; this.emit('trial'); } // أي تعديل آخر يعتمد المعاينة الجارية
    this.project.updated = Date.now();
    if (this.history.push(this.project)) {
      this.scheduleSave();
      this.emit('history');
    }
    this.emit('change');
  }
  /**
   * معاينة قبل الاعتماد: يطبّق التغيير ويشغّله على المعاينة، ولا يُسجَّل إلا بـ ✓.
   * fn تُستدعى بعد إلغاء أي معاينة سابقة، فيجب أن تبحث عن الطبقة بمعرّفها من ed.project.
   */
  tryChange(label, fn, { play = true, group = label } = {}) {
    let prev = this.trial;
    // تجربة بديل من المجموعة نفسها تستبدل السابقة؛ أما أداة أخرى فتعتمد السابقة أولًا
    if (prev && prev.group !== group) { this.acceptTry(); prev = null; }
    const t0 = prev ? prev.t0 : this.time;
    if (prev) { this.emit('trial-stop'); this.revertTrial(); this.setTime(t0); }
    fn(this);
    this.trial = { label, t0, group };
    this.emit('change');
    this.emit('select');
    this.emit('trial');
    if (play) this.emit('trial-play');
  }
  acceptTry() {
    if (!this.trial) return;
    const t0 = this.trial.t0;
    this.emit('trial-stop');
    this.trial = null;
    this.commit();
    this.setTime(t0);
    this.emit('trial');
  }
  cancelTry() {
    if (!this.trial) return;
    const t0 = this.trial.t0;
    this.emit('trial-stop');
    this.revertTrial();
    this.trial = null;
    this.setTime(t0);
    this.emit('trial');
  }
  revertTrial() {
    const p = JSON.parse(this.history.current);
    this.project = p;
    if (this.selectedLayerId && !getLayer(p, this.selectedLayerId)) this.selectedLayerId = null;
    this.cache.ensureAll(p);
    this.emit('change');
    this.emit('select');
  }
  /** الطبقة بمعرّفها في المشروع الحالي (آمن بعد إلغاء معاينة) */
  layerById(id) { return getLayer(this.project, id); }

  /** تحديث مؤقت أثناء السحب (بلا تسجيل) */
  live() { this.emit('change'); }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 700);
  }
  saveNow() {
    clearTimeout(this.saveTimer);
    const copy = JSON.parse(JSON.stringify(this.project));
    try { copy.thumb = this.makeThumb?.() || copy.thumb; } catch {}
    this.saving = this.saving.then(() => saveProject(copy)).catch((e) => console.error('save failed', e));
    this.emit('saved');
    return this.saving;
  }

  undo() {
    if (this.trial) return this.cancelTry();
    const s = this.history.undo();
    if (s) this.replaceProject(s);
  }
  redo() {
    const s = this.history.redo();
    if (s) this.replaceProject(s);
  }
  replaceProject(p) {
    this.project = p;
    if (this.selectedLayerId && !getLayer(p, this.selectedLayerId)) this.selectedLayerId = null;
    this.selectedKey = null;
    this.cache.ensureAll(p);
    this.scheduleSave();
    this.emit('history');
    this.emit('change');
    this.emit('select');
  }

  setTime(t, { snap = true } = {}) {
    const d = this.project.duration;
    t = Math.max(0, Math.min(d, t));
    if (snap) t = snapToFrame(t, this.project.fps);
    if (t === this.time) return;
    this.time = t;
    this.emit('time');
  }

  select(layerId) {
    if (this.selectedLayerId === layerId) return;
    this.selectedLayerId = layerId;
    if (this.selectedKey && this.selectedKey.layerId !== layerId) this.selectedKey = null;
    this.emit('select');
  }
  selectKey(k) {
    this.selectedKey = k;
    if (k) this.selectedLayerId = k.layerId;
    this.emit('select');
  }

  /**
   * تغيير خاصية: إن كان لها مفاتيح أو كان التسجيل التلقائي مفعّلًا يُنشأ/يُحدَّث مفتاح عند الزمن الحالي،
   * وإلا تتغير القيمة الثابتة.
   */
  setProp(layer, prop, value, { forceKey = false } = {}) {
    const def = PROPS[prop];
    if (def && typeof value === 'number') {
      if (def.min != null) value = Math.max(def.min, value);
      if (def.max != null) value = Math.min(def.max, value);
    }
    const track = layer.tracks[prop];
    const lt = this.localTime(layer);
    if (forceKey || this.autoKey || (track && track.length)) {
      // أول مفتاح عند التسجيل التلقائي: احفظ القيمة القديمة في البداية حتى تظهر حركة
      if (this.autoKey && (!track || !track.length) && lt > 0 && !forceKey) {
        layer.tracks[prop] = [];
        setKey(layer.tracks[prop], 0, layer.props[prop]);
      }
      layer.tracks[prop] ||= [];
      setKey(layer.tracks[prop], lt, value);
    } else {
      layer.props[prop] = value;
    }
  }

  /** زمن المفتاح بالنسبة للطبقة (للحلقات يبقى الزمن العام نفسه) */
  localTime(layer) { return this.time; }

  /** يضع مفتاحًا لكل خصائص التحويل الأساسية عند الزمن الحالي */
  keyAll(layer, props = ['x', 'y', 'scale', 'rotation', 'opacity']) {
    const s = evalLayer(layer, this.time);
    for (const p of props) {
      layer.tracks[p] ||= [];
      setKey(layer.tracks[p], this.localTime(layer), s[p]);
    }
  }

  hasKeyAt(layer, prop) {
    return findKeyIndex(layer.tracks[prop], this.localTime(layer), 1e-4) >= 0;
  }
}
