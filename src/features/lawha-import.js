// استيراد حزمة طبقات من برنامج الصور «لوحة» (ZIP غير مضغوط فيه manifest.json وطبقات PNG)
import { unzipSync, strFromU8 } from 'fflate';
import { importHandlers } from '../ui/library.js';
import { createAsset, createLayer } from '../core/project.js';
import { putBlob } from '../storage/db.js';
import { uid } from '../core/math.js';
import { toast } from '../ui/dom.js';

const BLENDS = new Set(['source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']);

/** يقرأ الحزمة ويعيد البيان والملفات، أو null إن لم تكن حزمة لوحة */
export function readLawha(bytes) {
  let files;
  try { files = unzipSync(bytes); } catch { return null; }
  const m = files['manifest.json'];
  if (!m) return null;
  const manifest = JSON.parse(strFromU8(m));
  if (manifest.format !== 'lawha-layers') return null;
  return { manifest, files };
}

/** موضع الطبقة في المشروع: تُحجَّم اللوحة كلها لتلائم المشهد وتتوسطه */
export function placeLayer(manifest, L, pw, ph) {
  const s = Math.min(pw / manifest.width, ph / manifest.height);
  const ox = (pw - manifest.width * s) / 2, oy = (ph - manifest.height * s) / 2;
  return { x: ox + (L.x + L.width / 2) * s, y: oy + (L.y + L.height / 2) * s, scale: s };
}

importHandlers.push({
  match: (f) => /\.zip$/i.test(f.name) || f.type === 'application/zip',
  async handle(ed, f) {
    const pkg = readLawha(new Uint8Array(await f.arrayBuffer()));
    if (!pkg) throw new Error('ملف ZIP ليس حزمة طبقات من برنامج الصور');
    const { manifest, files } = pkg;
    const p = ed.project;
    if (manifest.background && !p.layers.length) p.background = manifest.background;
    let n = 0;
    for (const L of manifest.layers || []) {
      const data = files[L.file];
      if (!data || !L.width || !L.height) continue;
      const blobKey = uid('blob');
      await putBlob(blobKey, new Blob([data], { type: 'image/png' }));
      const asset = createAsset('image', { name: L.name || `طبقة ${n + 1}`, width: L.width, height: L.height, blobKey, mime: 'image/png' });
      p.assets.push(asset);
      await ed.cache.ensure(asset);
      const layer = createLayer(p, asset, { start: 0, visible: L.visible !== false });
      Object.assign(layer.props, placeLayer(manifest, L, p.width, p.height));
      layer.props.opacity = L.opacity ?? 1;
      if (L.blend && L.blend !== 'source-over' && BLENDS.has(L.blend)) layer.blend = L.blend;
      if (L.group) layer.name = `${L.group} / ${layer.name}`;
      p.layers.push(layer);
      n++;
    }
    ed.commit();
    ed.emit('select');
    toast(`استُوردت ${n} طبقة من «${manifest.name || 'لوحة'}» وكل طبقة جاهزة للتحريك`);
  }
});
