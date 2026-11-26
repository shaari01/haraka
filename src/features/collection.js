// «مجموعتي»: مكتبة شخصية لكل المشاريع، تضيف إليها وتحذف منها:
// خطوطك، وملصقاتك وصورك وصورك المتحركة (GIF)، وحركاتك الخاصة، وتخفي ما لا تريده من الجاهز.
import { h, btn, toast, modal, confirmBox, promptBox, pickFiles, clear } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { libraryCreators } from '../ui/library.js';
import { editorPlugins } from '../ui/editor.js';
import { propSections } from '../ui/props.js';
import { getMeta, setMeta, putBlob, getBlob, deleteBlob } from '../storage/db.js';
import { uid } from '../core/math.js';
import { KEY_PRESETS, MOD_TYPES } from '../core/motion.js';
import { captureMotion, applyMotion, hasMotion } from '../core/mymotion.js';
import { FONTS } from './phase4.js';

const KEY = 'my-collection', HKEY = 'hidden-builtins';
let items = [];
let hidden = new Set();
const fontFaces = new Map(); // id -> FontFace
const BUILTIN_FONTS = FONTS.map((f) => ({ ...f }));
let ready = null;

export const isHidden = (kind, id) => hidden.has(kind + ':' + id);
export const userMotions = () => items.filter((i) => i.kind === 'motion');

async function save() { await setMeta(KEY, items); }
async function saveHidden() { await setMeta(HKEY, [...hidden]); }

async function registerFont(it) {
  if (fontFaces.has(it.id)) return;
  const blob = await getBlob(it.blobKey);
  if (!blob) return;
  const face = new FontFace(it.family, await blob.arrayBuffer());
  await face.load();
  document.fonts.add(face);
  fontFaces.set(it.id, face);
  if (!FONTS.some((f) => f.id === it.family)) FONTS.push({ id: it.family, label: it.name, custom: true });
}

/** يعيد بناء قائمة الخطوط: الجاهزة غير المخفية ثم خطوطك */
function syncFonts() {
  const custom = FONTS.filter((f) => f.custom && items.some((i) => i.kind === 'font' && i.family === f.id));
  FONTS.length = 0;
  for (const f of BUILTIN_FONTS) if (!isHidden('font', f.id)) FONTS.push(f);
  FONTS.push(...custom);
}

export function loadCollection() {
  return (ready ||= (async () => {
    try {
      items = (await getMeta(KEY)) || [];
      hidden = new Set((await getMeta(HKEY)) || []);
      for (const it of items) if (it.kind === 'font') await registerFont(it).catch((e) => console.warn('font', e));
      syncFonts();
    } catch (e) { console.warn('collection', e); }
  })());
}
loadCollection();

export async function addFontFile(f) {
  const base = f.name.replace(/\.[^.]+$/, '').trim() || 'خط';
  let family = base;
  for (let n = 2; FONTS.some((x) => x.id === family) || BUILTIN_FONTS.some((x) => x.id === family); n++) family = `${base} ${n}`;
  const it = { id: uid('col'), kind: 'font', name: base, family, blobKey: uid('colblob') };
  await putBlob(it.blobKey, f);
  try { items.push(it); await registerFont(it); } catch (e) { items.pop(); await deleteBlob(it.blobKey).catch(() => {}); throw new Error('تعذر قراءة الخط: استخدم ملف TTF أو OTF أو WOFF'); }
  syncFonts();
  await save();
  return it;
}

export async function addMediaFile(f, name) {
  const kind = /gif$/i.test(f.type) || /\.gif$/i.test(f.name || '') ? 'gif' : /svg/i.test(f.type) || /\.svg$/i.test(f.name || '') ? 'svg' : 'image';
  const it = { id: uid('col'), kind: 'sticker', type: kind, name: name || (f.name || 'ملصق').replace(/\.[^.]+$/, ''), mime: f.type || (kind === 'gif' ? 'image/gif' : kind === 'svg' ? 'image/svg+xml' : 'image/png'), blobKey: uid('colblob') };
  await putBlob(it.blobKey, f);
  items.push(it);
  await save();
  return it;
}

export async function addMotion(name, motion) {
  const it = { id: uid('col'), kind: 'motion', name, motion };
  items.push(it);
  await save();
  return it;
}

export async function removeItem(id) {
  const it = items.find((i) => i.id === id);
  if (!it) return;
  items = items.filter((i) => i.id !== id);
  if (it.blobKey) await deleteBlob(it.blobKey).catch(() => {});
  if (it.kind === 'font') { const face = fontFaces.get(id); if (face) document.fonts.delete(face); fontFaces.delete(id); const i = FONTS.findIndex((f) => f.id === it.family); if (i >= 0) FONTS.splice(i, 1); }
  await save();
}

export async function toggleHidden(kind, id) {
  const k = kind + ':' + id;
  if (hidden.has(k)) hidden.delete(k); else hidden.add(k);
  if (kind === 'font') syncFonts();
  await saveHidden();
}

/** إدراج ملصق من المجموعة في المشروع (نسخة مستقلة من الملف) */
async function insertSticker(ed, it) {
  const blob = await getBlob(it.blobKey);
  if (!blob) return toast('الملف غير موجود', 'error');
  const ext = it.type === 'gif' ? '.gif' : it.type === 'svg' ? '.svg' : '.png';
  await ed.editor.library.importFiles([new File([blob], it.name + ext, { type: it.mime || blob.type })]);
}

// ——— النافذة ———
function openCollection(ed, tab = 'stickers') {
  const body = h('div.col-body');
  const tabs = h('div.seg.col-tabs', { role: 'tablist' });
  const content = h('div.col-content');
  body.append(tabs, content);
  const m = modal('مجموعتي', body, [], { wide: true });
  m.el.dataset.testid = 'collection';
  const TABS = [['stickers', 'ملصقات وصور', 'image'], ['fonts', 'الخطوط', 'font'], ['motions', 'الحركات', 'wand']];
  const show = (id) => {
    tab = id;
    clear(tabs);
    for (const [k, l, ic] of TABS) tabs.append(h('button', { type: 'button', role: 'tab', 'aria-pressed': k === id, dataset: { coltab: k }, onclick: () => show(k), html: icon(ic, 16) + `<span>${l}</span>` }));
    clear(content);
    if (id === 'stickers') renderStickers(ed, content, m, () => show('stickers'));
    else if (id === 'fonts') renderFonts(content, () => show('fonts'));
    else renderMotions(ed, content, () => show('motions'));
  };
  show(tab);
}

const delBtn = (label, onYes) => btn('trash', '', async () => { if (await confirmBox('حذف من مجموعتي', `حذف «${label}» نهائيًا من مجموعتك؟`, 'حذف')) onYes(); }, { iconOnly: true, cls: 'danger col-del', title: 'حذف', testid: 'col-del' });
const eyeBtn = (on, onClick) => btn(on ? 'eye' : 'eyeOff', '', onClick, { iconOnly: true, cls: 'col-eye' + (on ? '' : ' off'), title: on ? 'إخفاء من القوائم' : 'إظهار في القوائم', testid: 'col-eye' });

function renderStickers(ed, el, m, refresh) {
  const grid = h('div.col-grid');
  el.append(h('p.muted', 'ملصقاتك وصورك وصورك المتحركة (GIF) تبقى هنا لكل مشاريعك. انقر لإدراجها في المشهد.'),
    btn('plus', 'إضافة ملصق أو صورة أو GIF', async () => {
      const files = await pickFiles('image/*,.svg,.gif,.webp', true);
      for (const f of files || []) await addMediaFile(f);
      refresh();
    }, { cls: 'primary', testid: 'col-add-sticker' }), grid);
  const list = items.filter((i) => i.kind === 'sticker');
  if (!list.length) grid.append(h('p.muted', 'لا شيء بعد. أضف من هنا، أو من قائمة أي عنصر في المكتبة ← «حفظ في مجموعتي».'));
  for (const it of list) {
    const th = h('button.col-item', { type: 'button', title: it.name, 'aria-label': 'إدراج ' + it.name, dataset: { testid: 'col-sticker' }, onclick: async () => { m.close(); await insertSticker(ed, it); } });
    getBlob(it.blobKey).then((b) => { if (b) { const img = new Image(); img.src = URL.createObjectURL(b); img.alt = ''; th.append(img); } });
    grid.append(h('div.col-cell', th, h('small', it.name), delBtn(it.name, async () => { await removeItem(it.id); refresh(); })));
  }
}

function renderFonts(el, refresh) {
  el.append(h('p.muted', 'أضف خطوطك (TTF أو OTF أو WOFF) فتظهر في «خط عربي» بكل المشاريع. وأخفِ ما لا تستعمله من الخطوط الجاهزة.'),
    btn('plus', 'إضافة خط', async () => {
      const files = await pickFiles('.ttf,.otf,.woff,.woff2,font/*', true);
      for (const f of files || []) { try { await addFontFile(f); } catch (e) { toast(e.message, 'error'); } }
      refresh();
    }, { cls: 'primary', testid: 'col-add-font' }));
  const list = h('div.col-list');
  for (const f of BUILTIN_FONTS) {
    const on = !isHidden('font', f.id);
    list.append(h('div.col-row' + (on ? '' : '.off'), h('span.col-sample', { style: { fontFamily: `"${f.id}"` } }, 'بسم الله'), h('span.grow', f.label, h('small', ' · جاهز')), eyeBtn(on, async () => { await toggleHidden('font', f.id); refresh(); })));
  }
  for (const it of items.filter((i) => i.kind === 'font')) {
    list.append(h('div.col-row', { dataset: { testid: 'col-font' } }, h('span.col-sample', { style: { fontFamily: `"${it.family}"` } }, 'بسم الله'), h('span.grow', it.name), delBtn(it.name, async () => { await removeItem(it.id); refresh(); })));
  }
  el.append(list);
}

function renderMotions(ed, el, refresh) {
  el.append(h('p.muted', 'احفظ حركة أي عنصر من «الخصائص» ← «حفظ حركته في مجموعتي»، فتظهر مع الحركات الجاهزة لكل عنصر. وأخفِ ما لا تستعمله من الجاهز.'));
  const list = h('div.col-list');
  for (const it of userMotions()) list.append(h('div.col-row', { dataset: { testid: 'col-motion' } }, icon('heart', 18), h('span.grow', it.name, h('small', ` · ${it.motion.dur.toFixed(1)} ث`)), delBtn(it.name, async () => { await removeItem(it.id); refresh(); ed.emit('select'); })));
  list.append(h('h4.col-h', 'الحركات الجاهزة'));
  for (const [id, p] of Object.entries(KEY_PRESETS)) {
    const on = !isHidden('preset', id);
    list.append(h('div.col-row' + (on ? '' : '.off'), icon(p.icon, 18), h('span.grow', p.label), eyeBtn(on, async () => { await toggleHidden('preset', id); refresh(); ed.emit('select'); })));
  }
  list.append(h('h4.col-h', 'الحركات المستمرة'));
  for (const [id, p] of Object.entries(MOD_TYPES)) {
    const on = !isHidden('mod', id);
    list.append(h('div.col-row' + (on ? '' : '.off'), icon('loop', 18), h('span.grow', p.label), eyeBtn(on, async () => { await toggleHidden('mod', id); refresh(); ed.emit('select'); })));
  }
  el.append(list);
}

libraryCreators.unshift({ icon: 'heart', label: 'مجموعتي', testid: 'my-collection', create: (ed) => loadCollection().then(() => openCollection(ed)) });

// «حركاتي» داخل الخصائص: تطبيق بمعاينة، وحفظ حركة العنصر الحالي
propSections.push((ed, layer) => {
  const mine = userMotions();
  const can = hasMotion(layer);
  if (!mine.length && !can) return null;
  const sec = h('section.sec', h('h3', icon('heart', 18), ' حركاتي'));
  if (mine.length) sec.append(h('div.chips', mine.map((it) => h('button.chip', { type: 'button', dataset: { mymotion: it.id }, onclick: () => {
    ed.tryChange(it.name, () => applyMotion(ed.layerById(layer.id), it.motion, ed.time, () => uid('')), { group: 'my-motion' });
  } }, icon('heart', 16), it.name))));
  if (can) sec.append(btn('heart', 'حفظ حركته في مجموعتي', async () => {
    const name = await promptBox('اسم الحركة', layer.name + ' — حركة');
    if (!name) return;
    await addMotion(name, captureMotion(ed.layerById(layer.id), ed.project));
    toast('حُفظت في مجموعتي، وتظهر الآن لكل العناصر وكل المشاريع');
    ed.emit('select');
  }, { testid: 'save-motion' }));
  return sec;
});

editorPlugins.push((editor) => {
  const ed = editor.ed;
  ed.assetMenuExtras ||= [];
  ed.assetMenuExtras.push((a) => ['image', 'svg', 'gif'].includes(a.type) ? [{ icon: 'heart', label: 'حفظ في مجموعتي (لكل المشاريع)', testid: 'save-to-collection', onClick: async () => {
    const blob = await getBlob(a.blobKey);
    if (!blob) return;
    await addMediaFile(blob instanceof File ? blob : new File([blob], a.name, { type: a.mime || blob.type }), a.name);
    toast('حُفظ في مجموعتي');
  } }] : []);
  loadCollection().then(() => ed.emit('select'));
});

