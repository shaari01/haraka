// الصور المتحركة GIF (وWebP المتحرك): تُفك إطاراتها وتتحرك على المشهد وفي التصدير
import { registerLayerRenderer } from '../core/renderer.js';
import { registerPrepare } from '../export/frames.js';
import { importHandlers } from '../ui/library.js';
import { editorPlugins } from '../ui/editor.js';
import { createAsset } from '../core/project.js';
import { putBlob, getBlob } from '../storage/db.js';
import { uid } from '../core/math.js';

const decoded = new Map(); // blobKey -> {frames: ImageBitmap[], starts: number[], total}
const loading = new Map();
let notify = () => {};

export const gifSupported = () => typeof ImageDecoder !== 'undefined';

/** يفك كل الإطارات ومدة كل منها (بالثواني) */
export async function decodeAnimated(blob) {
  const dec = new ImageDecoder({ data: blob.stream(), type: blob.type || 'image/gif' });
  await dec.tracks.ready;
  const n = dec.tracks.selectedTrack?.frameCount || 1;
  const frames = [], starts = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const { image } = await dec.decode({ frameIndex: i });
    frames.push(await createImageBitmap(image));
    starts.push(t);
    t += Math.max(0.02, (image.duration || 100000) / 1e6);
    image.close();
  }
  dec.close();
  return { frames, starts, total: t, width: frames[0]?.width || 1, height: frames[0]?.height || 1 };
}

/** رقم الإطار عند الزمن t (يتكرر بلا نهاية) */
export function gifFrameAt(starts, total, t) {
  if (!starts.length) return -1;
  let x = ((t % total) + total) % total;
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= x) lo = mid; else hi = mid - 1; }
  return lo;
}

function ensure(asset) {
  if (decoded.has(asset.blobKey)) return decoded.get(asset.blobKey);
  if (!loading.has(asset.blobKey) && gifSupported()) {
    loading.set(asset.blobKey, getBlob(asset.blobKey).then((b) => b && decodeAnimated(b)).then((d) => { if (d) decoded.set(asset.blobKey, d); loading.delete(asset.blobKey); notify(); }).catch((e) => { console.warn('gif', e); loading.delete(asset.blobKey); }));
  }
  return null;
}

registerLayerRenderer('gif', (c, { asset, layer, t }) => {
  const d = ensure(asset);
  if (!d) return;
  const i = gifFrameAt(d.starts, d.total, t - (layer.start || 0));
  if (i >= 0) c.drawImage(d.frames[i], 0, 0, asset.width, asset.height);
});

registerPrepare(async (project) => {
  const waits = [];
  for (const a of project.assets) if (a.type === 'gif') { ensure(a); if (loading.has(a.blobKey)) waits.push(loading.get(a.blobKey)); }
  await Promise.all(waits);
});

importHandlers.unshift({
  match: (f) => gifSupported() && (/\.gif$/i.test(f.name) || f.type === 'image/gif'),
  async handle(ed, f) {
    const blob = f.type ? f : new Blob([f], { type: 'image/gif' });
    const d = await decodeAnimated(blob);
    const blobKey = uid('blob');
    await putBlob(blobKey, blob);
    decoded.set(blobKey, d);
    const th = document.createElement('canvas'); th.width = 96; th.height = Math.max(1, Math.round(96 * d.height / d.width));
    th.getContext('2d').drawImage(d.frames[0], 0, 0, th.width, th.height);
    const asset = createAsset(d.frames.length > 1 ? 'gif' : 'image', { name: f.name.replace(/\.[^.]+$/, ''), width: d.width, height: d.height, blobKey, mime: 'image/gif', duration: d.total, thumb: th.toDataURL('image/png'), icon: 'image' });
    ed.project.assets.push(asset);
    await ed.cache.ensure(asset);
    ed.emit('asset-added', asset);
    ed.editor.library.addInstance(asset, false);
    ed.commit();
  }
});

editorPlugins.push((editor) => { notify = () => editor.ed.emit('render'); });
