// المكتبة: كل عنصر يُخزَّن مرة واحدة، وعلى المشهد نسخ مرتبطة منه
import { h, btn, clear, toast, menu, promptBox, confirmBox, pickFiles } from './dom.js';
import { icon } from './icons.js';
import { createAsset, createLayer, instancesOf, getAsset } from '../core/project.js';
import { probeFile } from '../core/assets.js';
import { putBlob, deleteBlob } from '../storage/db.js';
import { uid } from '../core/math.js';

export const libraryCreators = []; // أزرار إنشاء عناصر خاصة (نص، جزيئات...) تضيفها المراحل اللاحقة
export const importHandlers = []; // معالجات استيراد خاصة (مثل Lottie/مشروع طبقات)

export const ACCEPT = 'image/*,.gif,.svg,video/*,audio/*,.mp3,.wav,.m4a,.ogg,.json,.zip';

export class Library {
  constructor(ed) {
    this.ed = ed;
    this.el = h('aside.panel.library', { 'data-testid': 'library', 'aria-label': 'المكتبة' });
    this.list = h('div.lib-list');
    this.header = h('div.panel-head', h('h2', 'المكتبة'));
    this.tools = h('div.lib-tools');
    this.el.append(this.header, this.tools, this.list);
    this.buildTools();
    ed.on('change', () => this.render());
    ed.on('render', () => this.renderThumbs());
    this.render();
  }

  buildTools() {
    clear(this.tools);
    this.tools.append(btn('import', 'استيراد', () => this.importFiles(), { cls: 'primary', testid: 'import' }));
    for (const c of libraryCreators) this.tools.append(btn(c.icon, c.label, () => c.create(this.ed), { testid: c.testid }));
  }

  async importFiles(files) {
    files ||= await pickFiles(ACCEPT, true);
    if (!files?.length) return;
    let added = 0;
    this.ed.importing = (this.ed.importing || 0) + 1;
    try {
    for (const f of files) {
      try {
        let handled = false;
        for (const hnd of importHandlers) {
          if (hnd.match(f)) { await hnd.handle(this.ed, f); handled = true; added++; break; }
        }
        if (handled) continue;
        const info = await probeFile(f);
        if (info.type === 'json') { toast('ملف JSON غير معروف', 'error'); continue; }
        const blobKey = uid('blob');
        await putBlob(blobKey, info.blob);
        const asset = createAsset(info.type, { name: info.name, width: info.width, height: info.height, blobKey, duration: info.duration, mime: info.blob.type });
        this.ed.project.assets.push(asset);
        await this.ed.cache.ensure(asset);
        this.ed.emit('asset-added', asset);
        added++;
        // أضف نسخة مباشرة على المشهد عند استيراد عنصر واحد مرئي
        if (files.length === 1 && (info.type === 'image' || info.type === 'svg' || info.type === 'video')) this.addInstance(asset, false);
      } catch (e) {
        console.error(e);
        toast(e.message || 'تعذر الاستيراد', 'error');
      }
    }
    if (added) { this.ed.commit(); toast(`أُضيف ${added} إلى المكتبة`); }
    } finally { this.ed.importing--; }
  }

  addInstance(asset, commit = true) {
    const ed = this.ed;
    if (asset.type === 'audio') { ed.emit('audio-asset', asset); return; }
    const layer = createLayer(ed.project, asset, { start: 0 });
    // النسخ المتعددة تزاح قليلًا حتى لا تتطابق
    const n = instancesOf(ed.project, asset.id).length;
    layer.props.x += n * 30; layer.props.y += n * 30;
    if (n) layer.name = `${asset.name} ${n + 1}`;
    ed.project.layers.push(layer);
    ed.select(layer.id);
    if (commit) ed.commit();
    this.onAdded?.(layer);
    return layer;
  }

  async replaceAsset(asset) {
    const [f] = await pickFiles(asset.type === 'svg' ? '.svg,image/svg+xml' : asset.type === 'video' ? 'video/*' : 'image/*,.svg', false);
    if (!f) return;
    try {
      const info = await probeFile(f);
      const blobKey = uid('blob');
      await putBlob(blobKey, info.blob);
      const old = asset.blobKey;
      Object.assign(asset, { type: info.type, blobKey, width: info.width, height: info.height, mime: info.blob.type });
      this.ed.cache.invalidate(asset.id);
      await this.ed.cache.ensure(asset);
      if (old && !this.ed.project.assets.some((a) => a.blobKey === old)) deleteBlob(old).catch(() => {});
      this.ed.commit();
      toast(`تحدّث العنصر في ${instancesOf(this.ed.project, asset.id).length} نسخة`);
    } catch (e) { toast(e.message, 'error'); }
  }

  async deleteAsset(asset) {
    const n = instancesOf(this.ed.project, asset.id).length;
    if (!(await confirmBox('حذف من المكتبة', n ? `سيُحذف العنصر و${n} من نسخه على المشهد. متأكد؟` : 'حذف هذا العنصر من المكتبة؟', 'حذف'))) return;
    const p = this.ed.project;
    p.layers = p.layers.filter((l) => l.assetId !== asset.id);
    p.assets = p.assets.filter((a) => a.id !== asset.id);
    this.ed.cache.invalidate(asset.id);
    if (this.ed.selectedLayerId && !p.layers.find((l) => l.id === this.ed.selectedLayerId)) this.ed.select(null);
    this.ed.commit();
  }

  render() {
    const p = this.ed.project;
    clear(this.list);
    const visible = p.assets.filter((a) => !a.hidden);
    if (!visible.length) {
      this.list.append(h('div.empty', h('p', 'المكتبة فارغة.'), h('p.muted', 'استورد صورة PNG شفافة أو SVG أو فيديو أو صوتًا. كل عنصر يُخزّن هنا مرة واحدة، وتعديله يُطبَّق على كل نسخه.')));
      return;
    }
    for (const a of visible) {
      const n = instancesOf(p, a.id).length;
      const thumb = h('div.thumb', { dataset: { asset: a.id } });
      const card = h('div.asset', { dataset: { testid: 'asset' } },
        thumb,
        h('div.asset-info', h('strong', { title: a.name }, a.name), h('small', typeLabel(a) + (n ? ` · ${n} نسخة` : ''))),
        btn('plus', 'إلى المشهد', () => this.addInstance(a), { iconOnly: true, cls: 'primary', title: 'أضف نسخة إلى المشهد', testid: 'add-instance' }),
        btn('menu', 'خيارات', (e) => menu(e.currentTarget, [
          { icon: 'text', label: 'إعادة تسمية', onClick: async () => { const v = await promptBox('اسم العنصر', a.name); if (v) { a.name = v; this.ed.commit(); } } },
          ...(a.type === 'image' || a.type === 'svg' || a.type === 'video' ? [{ icon: 'image', label: 'استبدال الملف (يتغير في كل النسخ)', onClick: () => this.replaceAsset(a) }] : []),
          ...(this.assetMenuExtras(a)),
          '-',
          { icon: 'trash', label: 'حذف', danger: true, onClick: () => this.deleteAsset(a) }
        ]), { iconOnly: true })
      );
      this.list.append(card);
    }
    this.renderThumbs();
  }

  assetMenuExtras(a) {
    return (this.ed.assetMenuExtras || []).flatMap((fn) => fn(a, this.ed) || []);
  }

  renderThumbs() {
    for (const t of this.list.querySelectorAll('.thumb')) {
      const a = getAsset(this.ed.project, t.dataset.asset);
      if (!a) continue;
      const e = this.ed.cache.entry(a.id);
      if (t.dataset.done === (e ? '1' : '0') && t.firstChild) continue;
      clear(t);
      if (a.type === 'audio') t.innerHTML = icon('audio', 32);
      else if (e?.kind === 'image') { const img = new Image(); img.src = e.url; img.alt = ''; t.append(img); }
      else if (e?.kind === 'video') t.innerHTML = icon('video', 32);
      else if (a.thumb) { const img = new Image(); img.src = a.thumb; img.alt = ''; t.append(img); }
      else t.innerHTML = icon(a.icon || 'image', 32);
      t.dataset.done = e ? '1' : '0';
    }
  }
}

function typeLabel(a) {
  return { image: 'صورة', svg: 'SVG', video: 'فيديو', audio: 'صوت', text: 'خط', comp: 'عنصر مركّب', drawing: 'رسم', particles: 'جزيئات', light: 'إضاءة', cinemagraph: 'صورة حية', gif: 'صورة متحركة' }[a.type] || a.type;
}
