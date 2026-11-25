// شاشة المحرر: تجمع المعاينة والمكتبة والخط الزمني ولوحة الخصائص
import { h, btn, toast, menu, promptBox } from './dom.js';
import { icon } from './icons.js';
import { EditorState } from './state.js';
import { Stage } from './stage.js';
import { Timeline } from './timeline.js';
import { Library } from './library.js';
import { PropsPanel } from './props.js';
import { openExportDialog } from './exportDialog.js';
import { renderFrame } from '../core/renderer.js';

export const editorPlugins = []; // دوال تُستدعى عند فتح المحرر: fn(editor)
export const toolbarTools = []; // أدوات شريط الأدوات: {id, icon, label}
export const playbackHooks = { start: [], stop: [], tick: [] };

export class Editor {
  constructor(project, { onExit }) {
    this.ed = new EditorState(project);
    this.ed.editor = this;
    this.onExit = onExit;
    this.el = h('div.editor', { 'data-testid': 'editor' });
    this.build();
    this.bindKeys();
    this.ed.on('toggle-play', () => this.togglePlay());
    this.ed.on('history', () => this.updateUndo());
    this.ed.cache.ensureAll(project);
    this.ed.makeThumb = () => this.makeThumb();
    for (const p of editorPlugins) p(this);
  }

  build() {
    const ed = this.ed;
    this.undoBtn = btn('undo', 'تراجع', () => ed.undo(), { iconOnly: true, testid: 'undo' });
    this.redoBtn = btn('redo', 'إعادة', () => ed.redo(), { iconOnly: true, testid: 'redo' });
    this.autoBtn = btn('record', 'تسجيل تلقائي للمفاتيح', () => this.toggleAutoKey(), { iconOnly: true, cls: 'autokey', testid: 'autokey', title: 'وضع التسجيل التلقائي: حرّك المؤشر الزمني ثم حرّك العنصر فيُنشأ مفتاح' });
    this.title = h('button.title-btn', { type: 'button', 'aria-label': 'اسم المشروع', onclick: async () => {
      const v = await promptBox('اسم المشروع', ed.project.name);
      if (v) { ed.project.name = v; ed.commit(); this.title.textContent = v; }
    } }, ed.project.name);
    this.saveDot = h('span.save-dot', { title: 'الحفظ تلقائي' });
    this.toolbar = h('div.toolbar', { role: 'toolbar', 'aria-label': 'الأدوات' });
    const top = h('header.topbar',
      btn('back', 'المشاريع', async () => { await ed.saveNow(); this.destroy(); this.onExit(); }, { iconOnly: true, testid: 'back', title: 'رجوع إلى المشاريع' }),
      this.title, this.saveDot,
      h('span.grow'),
      this.undoBtn, this.redoBtn, this.autoBtn,
      btn('export', 'تصدير', () => { this.stop(); openExportDialog(ed); }, { cls: 'primary', testid: 'export' })
    );
    this.stage = new Stage(ed);
    this.timeline = new Timeline(ed);
    this.library = new Library(ed);
    this.props = new PropsPanel(ed);
    // أزرار الجوال لفتح الألواح الجانبية
    this.mobileBar = h('nav.mobile-bar',
      btn('library', 'المكتبة', () => this.togglePanel('library'), { testid: 'm-library' }),
      btn('sliders', 'الخصائص', () => this.togglePanel('props'), { testid: 'm-props' }),
      btn('fit', 'ملاءمة', () => this.stage.fit(), {})
    );
    this.scrim = h('div.scrim', { onclick: () => this.closePanels(), 'aria-hidden': 'true' });
    const center = h('main.center', this.toolbar, this.stage.el, this.mobileBar);
    this.workspace = h('div.workspace', this.library.el, center, this.props.el, this.scrim);
    for (const panel of [this.library, this.props]) {
      panel.el.querySelector('.panel-head').append(btn('close', 'إغلاق', () => this.closePanels(), { iconOnly: true, cls: 'panel-close', testid: 'panel-close' }));
    }
    // على الجوال: بعد إضافة عنصر للمشهد تُغلق المكتبة لترى النتيجة
    this.library.onAdded = () => { if (window.innerWidth < 900) this.closePanels(); };
    this.el.append(top, this.workspace, this.timeline.el);
    this.renderToolbar();
    ed.on('saved', () => { this.saveDot.classList.add('pulse'); setTimeout(() => this.saveDot.classList.remove('pulse'), 600); });
    ed.on('tool', () => this.renderToolbar());
    ed.on('select', () => { if (ed.layer && window.innerWidth < 900 && ed.tool === 'select') {/* لا نفتح اللوحة تلقائيًا على الجوال */} });
    this.updateUndo();
    if (window.innerWidth < 900) this.timeline.toggleCollapse(false);
  }

  renderToolbar() {
    const ed = this.ed;
    this.toolbar.innerHTML = '';
    const tools = [{ id: 'select', icon: 'hand', label: 'تحديد وتحريك' }, ...toolbarTools];
    if (tools.length < 2) { this.toolbar.hidden = true; return; }
    this.toolbar.hidden = false;
    for (const t of tools) {
      const b = btn(t.icon, t.label, () => { ed.tool = ed.tool === t.id && t.id !== 'select' ? 'select' : t.id; ed.emit('tool'); this.stage.invalidate(); }, { iconOnly: !t.showLabel, testid: 'tool-' + t.id, title: t.label });
      b.classList.toggle('active', ed.tool === t.id);
      b.setAttribute('aria-pressed', ed.tool === t.id);
      this.toolbar.append(b);
    }
    const help = toolbarTools.find((t) => t.id === ed.tool)?.help;
    if (help) this.toolbar.append(h('span.tool-help', help));
  }

  makeThumb() {
    const p = this.ed.project;
    const k = 240 / Math.max(p.width, p.height);
    const c = document.createElement('canvas');
    c.width = Math.round(p.width * k); c.height = Math.round(p.height * k);
    renderFrame(c.getContext('2d'), p, Math.min(p.duration, this.ed.time || p.duration / 2), { cache: this.ed.cache });
    return c.toDataURL('image/jpeg', 0.7);
  }

  togglePanel(which) {
    const el = which === 'library' ? this.library.el : this.props.el;
    const other = which === 'library' ? this.props.el : this.library.el;
    other.classList.remove('open');
    el.classList.toggle('open');
    this.workspace.classList.toggle('drawer-open', el.classList.contains('open'));
  }
  closePanels() {
    this.library.el.classList.remove('open');
    this.props.el.classList.remove('open');
    this.workspace.classList.remove('drawer-open');
  }

  toggleAutoKey() {
    this.ed.autoKey = !this.ed.autoKey;
    this.autoBtn.classList.toggle('on', this.ed.autoKey);
    this.autoBtn.setAttribute('aria-pressed', this.ed.autoKey);
    this.el.classList.toggle('recording', this.ed.autoKey);
    toast(this.ed.autoKey ? 'التسجيل التلقائي مفعّل: كل تحريك يصنع مفتاحًا' : 'أُوقف التسجيل التلقائي');
  }

  updateUndo() {
    this.undoBtn.disabled = !this.ed.history.canUndo();
    this.redoBtn.disabled = !this.ed.history.canRedo();
  }

  togglePlay() { this.ed.playing ? this.stop() : this.play(); }
  play() {
    const ed = this.ed;
    if (ed.playing) return;
    ed.playing = true;
    if (ed.time >= ed.project.duration - 1e-3) ed.setTime(0);
    let last = performance.now();
    let t = ed.time;
    for (const f of playbackHooks.start) f(ed, t);
    const step = (now) => {
      if (!ed.playing) return;
      const dt = (now - last) / 1000; last = now;
      t += dt;
      if (t >= ed.project.duration) {
        t = 0; // المعاينة تعيد التشغيل في حلقة
        for (const f of playbackHooks.start) f(ed, 0);
      }
      ed.setTime(t, { snap: false });
      for (const f of playbackHooks.tick) f(ed, t);
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
    ed.emit('play');
  }
  stop() {
    const ed = this.ed;
    if (!ed.playing) return;
    ed.playing = false;
    cancelAnimationFrame(this.raf);
    for (const f of playbackHooks.stop) f(ed);
    ed.setTime(ed.time);
    ed.emit('play');
  }

  bindKeys() {
    this.keyHandler = (e) => {
      if (e.target.closest?.('input, textarea, select')) return;
      const ed = this.ed;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? ed.redo() : ed.undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); ed.redo(); }
      else if (e.key === ' ') { e.preventDefault(); this.togglePlay(); }
      else if (e.key === 'ArrowRight') { ed.setTime(ed.time + 1 / ed.project.fps); }
      else if (e.key === 'ArrowLeft') { ed.setTime(ed.time - 1 / ed.project.fps); }
      else if (e.key === 'Home') ed.setTime(0);
      else if ((e.key === 'Delete' || e.key === 'Backspace') && ed.layer) {
        if (ed.selectedKey) this.props.deleteSelectedKey(); else this.props.remove(ed.layer);
      } else if (e.key.toLowerCase() === 'k' && ed.layer) { ed.keyAll(ed.layer); ed.commit(); }
      else this.ed.emit('key', e);
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  destroy() {
    this.stop();
    window.removeEventListener('keydown', this.keyHandler);
    this.stage.destroy();
    this.ed.cache.clear();
    this.ed.emit('destroy');
    this.el.remove();
  }
}
