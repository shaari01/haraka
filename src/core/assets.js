// تحميل مصادر العناصر (صور، SVG، فيديو) من التخزين إلى ذاكرة الرسم
import { getBlob } from '../storage/db.js';

export class AssetCache {
  constructor() {
    this.map = new Map(); // assetId -> {source, url, kind}
    this.pending = new Map();
    this.listeners = new Set();
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const f of this.listeners) f(); }

  get(id) { return this.map.get(id)?.source || null; }
  entry(id) { return this.map.get(id) || null; }

  async ensure(asset) {
    if (!asset || this.map.has(asset.id)) return this.map.get(asset?.id);
    if (this.pending.has(asset.id)) return this.pending.get(asset.id);
    const p = this._load(asset).then((e) => {
      this.pending.delete(asset.id);
      if (e) this.map.set(asset.id, e);
      this.emit();
      return e;
    }).catch((err) => {
      console.warn('asset load failed', asset.name, err);
      this.pending.delete(asset.id);
      return null;
    });
    this.pending.set(asset.id, p);
    return p;
  }

  async ensureAll(project) {
    await Promise.all(project.assets.map((a) => this.ensure(a)));
  }

  async _load(asset) {
    if (!asset.blobKey) return null;
    const blob = await getBlob(asset.blobKey);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    if (asset.type === 'image' || asset.type === 'svg') {
      const img = await loadImage(url);
      return { source: img, url, kind: 'image', blob };
    }
    if (asset.type === 'video') {
      const v = document.createElement('video');
      v.src = url; v.muted = true; v.playsInline = true; v.preload = 'auto';
      await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej; });
      return { source: v, url, kind: 'video', blob };
    }
    if (asset.type === 'audio') return { source: null, url, kind: 'audio', blob };
    return { source: null, url, kind: asset.type, blob };
  }

  invalidate(id) {
    const e = this.map.get(id);
    if (e?.url) URL.revokeObjectURL(e.url);
    this.map.delete(id);
  }
  clear() {
    for (const id of [...this.map.keys()]) this.invalidate(id);
  }
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('تعذر تحميل الصورة'));
    img.src = url;
  });
}

/** قراءة أبعاد ملف صورة/SVG/فيديو عند الاستيراد */
export async function probeFile(file) {
  const type = file.type || '';
  const name = file.name.replace(/\.[^.]+$/, '');
  if (type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
    const text = await file.text();
    const dims = svgSize(text);
    const blob = new Blob([ensureSvgSize(text, dims)], { type: 'image/svg+xml' });
    return { type: 'svg', name, width: dims.w, height: dims.h, blob, svgText: text };
  }
  if (type.startsWith('image/')) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      return { type: 'image', name, width: img.naturalWidth, height: img.naturalHeight, blob: file };
    } finally { URL.revokeObjectURL(url); }
  }
  if (type.startsWith('video/')) {
    const url = URL.createObjectURL(file);
    try {
      const v = document.createElement('video');
      v.muted = true; v.preload = 'metadata'; v.src = url;
      await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = rej; });
      return { type: 'video', name, width: v.videoWidth || 640, height: v.videoHeight || 360, duration: v.duration, blob: file };
    } finally { URL.revokeObjectURL(url); }
  }
  if (type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|opus)$/i.test(file.name)) {
    return { type: 'audio', name, width: 0, height: 0, blob: file };
  }
  if (/\.json$/i.test(file.name)) {
    return { type: 'json', name, blob: file };
  }
  throw new Error('صيغة غير مدعومة: ' + file.name);
}

export function svgSize(text) {
  const m = text.match(/<svg[^>]*>/i);
  const tag = m ? m[0] : '';
  const num = (s) => (s ? parseFloat(s) : NaN);
  let w = num(tag.match(/\swidth="([\d.]+)(px)?"/i)?.[1]);
  let h = num(tag.match(/\sheight="([\d.]+)(px)?"/i)?.[1]);
  const vb = tag.match(/viewBox="([^"]+)"/i)?.[1]?.trim().split(/[\s,]+/).map(Number);
  if ((!w || !h) && vb && vb.length === 4) { w = vb[2]; h = vb[3]; }
  if (!w || !h) { w = 512; h = 512; }
  // ارفع دقة SVG الصغيرة حتى تبقى حادة عند التكبير
  const k = Math.max(1, 1024 / Math.max(w, h));
  return { w: Math.round(w * k), h: Math.round(h * k), vb, ow: w, oh: h };
}

export function ensureSvgSize(text, dims) {
  return text.replace(/<svg([^>]*)>/i, (all, attrs) => {
    let a = attrs.replace(/\s(width|height)="[^"]*"/gi, '');
    if (!/viewBox=/i.test(a) && dims.vb == null) a += ` viewBox="0 0 ${dims.ow || dims.w} ${dims.oh || dims.h}"`;
    return `<svg${a} width="${dims.w}" height="${dims.h}">`;
  });
}
