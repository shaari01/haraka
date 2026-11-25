// تصدير GIF بلوحة ألوان موحدة (بلا وميض بين الإطارات) وخيارات عدد الألوان
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { generateFrames } from './frames.js';

/** تقسيم المدة على وحدات GIF (1/100 ث) مع توزيع الكسور */
export function gifDelays(count, fps) {
  const out = [];
  let acc = 0;
  for (let i = 0; i < count; i++) {
    const target = Math.round(((i + 1) * 100) / fps);
    out.push(Math.max(2, target - acc) * 10);
    acc = Math.max(acc + 2, target);
  }
  return out;
}

export async function exportGif(project, { w, h, fps, cache, onProgress, signal, colors = 256, transparent = false, loop = 0 }) {
  // GIF لا يُعرض جيدًا فوق 50 إطارًا/ث؛ المتصفحات تبطئ ما دون 2/100 ث
  const gfps = Math.min(fps, 50);
  const total = Math.max(1, Math.round(project.duration * gfps));
  const delays = gifDelays(total, gfps);
  // 1) لوحة ألوان موحدة من عينات موزعة على المدة (تمرير أول خفيف)
  const only = new Set();
  const nSamples = Math.min(total, 12);
  for (let j = 0; j < nSamples; j++) only.add(Math.floor((j * total) / nSamples));
  const step = Math.max(1, Math.floor((nSamples * w * h) / 400000));
  const sample = new Uint8ClampedArray(Math.ceil((w * h) / step) * 4 * nSamples + 4);
  let k = 0, n = 0;
  for await (const { canvas } of generateFrames(project, { fps: gfps, w, h, cache, signal, transparent, only })) {
    const s = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    for (let p = 0; p < s.length; p += 4 * step) { sample[k++] = s[p]; sample[k++] = s[p + 1]; sample[k++] = s[p + 2]; sample[k++] = s[p + 3]; }
    onProgress?.((++n / nSamples) * 0.15);
  }
  const format = transparent ? 'rgba4444' : 'rgb565';
  const palette = quantize(sample.subarray(0, k), colors, { format, oneBitAlpha: transparent ? 128 : false, clearAlpha: transparent, clearAlphaThreshold: 128 });
  const tIndex = transparent ? palette.findIndex((c) => c[3] === 0) : -1;
  // 2) الترميز إطارًا إطارًا دون تخزين كل الإطارات في الذاكرة
  const gif = GIFEncoder();
  for await (const { canvas, i } of generateFrames(project, { fps: gfps, w, h, cache, signal, transparent })) {
    const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const index = applyPalette(data, palette, format);
    gif.writeFrame(index, w, h, {
      palette: i === 0 ? palette : undefined,
      delay: delays[i],
      repeat: i === 0 ? loop : undefined,
      transparent: tIndex >= 0,
      transparentIndex: Math.max(0, tIndex),
      dispose: transparent ? 2 : -1
    });
    onProgress?.(0.15 + ((i + 1) / total) * 0.85);
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}
