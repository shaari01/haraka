// تصدير WebP متحرك: يرمّز المتصفح كل إطار WebP ثابتًا، ثم نجمعها في ملف متحرك (RIFF/ANMF)
import { generateFrames } from './frames.js';

export async function exportWebp(project, { w, h, fps, cache, onProgress, signal, quality = 0.85, loop = 0, transparent = false, motionBlur = 0 }) {
  const frames = [];
  const dur = 1000 / fps;
  let acc = 0;
  for await (const { canvas, i, total } of generateFrames(project, { fps, w, h, cache, signal, transparent, motionBlur })) {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', quality));
    if (!blob || blob.type !== 'image/webp') throw new Error('هذا المتصفح لا يرمّز WebP. استخدم Chrome أو Edge.');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const data = extractFrameData(bytes);
    // مدة الإطار بالملّي ثانية مع توزيع الكسور حتى تبقى السرعة دقيقة
    const target = Math.round((i + 1) * dur);
    const d = target - acc; acc = target;
    const prev = frames[frames.length - 1];
    if (prev && equalBytes(prev.data, data.payload)) prev.duration += d; // دمج الإطارات المتطابقة لتصغير الحجم
    else frames.push({ data: data.payload, alpha: data.alpha, duration: d });
    onProgress?.((i + 1) / total);
  }
  return new Blob([muxAnimatedWebp(frames, w, h, loop)], { type: 'image/webp' });
}

function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const fourcc = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const u32 = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24) >>> 0;

/** يستخرج بيانات الإطار (ALPH + VP8 أو VP8L) من ملف WebP ثابت */
export function extractFrameData(bytes) {
  if (fourcc(bytes, 0) !== 'RIFF' || fourcc(bytes, 8) !== 'WEBP') throw new Error('ملف WebP غير صالح');
  let o = 12;
  const parts = [];
  let alpha = false;
  while (o + 8 <= bytes.length) {
    const id = fourcc(bytes, o);
    const size = u32(bytes, o + 4);
    const padded = size + (size & 1);
    if (id === 'ALPH' || id === 'VP8 ' || id === 'VP8L') {
      parts.push(bytes.subarray(o, o + 8 + padded));
      if (id === 'ALPH' || id === 'VP8L') alpha = true;
    }
    o += 8 + padded;
  }
  const len = parts.reduce((s, p) => s + p.length, 0);
  const payload = new Uint8Array(len);
  let k = 0;
  for (const p of parts) { payload.set(p, k); k += p.length; }
  return { payload, alpha };
}

function chunk(id, data) {
  const pad = data.length & 1;
  const out = new Uint8Array(8 + data.length + pad);
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}
const u24 = (arr, o, v) => { arr[o] = v & 255; arr[o + 1] = (v >> 8) & 255; arr[o + 2] = (v >> 16) & 255; };

export function muxAnimatedWebp(frames, w, h, loop = 0) {
  const anyAlpha = frames.some((f) => f.alpha);
  const vp8x = new Uint8Array(10);
  vp8x[0] = 0x02 | (anyAlpha ? 0x10 : 0); // متحرك + شفافية
  u24(vp8x, 4, w - 1); u24(vp8x, 7, h - 1);
  const anim = new Uint8Array(6); // لون الخلفية (4) + عدد التكرار (2)، 0 = بلا نهاية
  anim[4] = loop & 255; anim[5] = (loop >> 8) & 255;
  const chunks = [chunk('VP8X', vp8x), chunk('ANIM', anim)];
  for (const f of frames) {
    const head = new Uint8Array(16);
    u24(head, 0, 0); u24(head, 3, 0);
    u24(head, 6, w - 1); u24(head, 9, h - 1);
    u24(head, 12, Math.max(1, Math.min(0xffffff, f.duration)));
    head[15] = 0x02; // بلا مزج: كل إطار يحل محل السابق كاملًا
    const body = new Uint8Array(head.length + f.data.length);
    body.set(head, 0); body.set(f.data, head.length);
    chunks.push(chunk('ANMF', body));
  }
  const size = 4 + chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(8 + size);
  out.set([82, 73, 70, 70], 0); // RIFF
  new DataView(out.buffer).setUint32(4, size, true);
  out.set([87, 69, 66, 80], 8); // WEBP
  let o = 12;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
