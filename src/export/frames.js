// حلقة توليد الإطارات للتصدير: ترسم كل إطار بالعارض نفسه ثم تمرره للمرمّز
import { renderFrame } from '../core/renderer.js';

const prepareHooks = [];
/** تسجيل دالة تُستدعى قبل رسم كل إطار (مثل ضبط زمن الفيديو) */
export function registerPrepare(fn) { prepareHooks.push(fn); }

export function evenSize(project, maxSide) {
  const k = Math.min(1, maxSide / Math.max(project.width, project.height));
  let w = Math.round(project.width * k), h = Math.round(project.height * k);
  w -= w % 2; h -= h % 2;
  return { w: Math.max(2, w), h: Math.max(2, h) };
}

/** يحسب الحجم من الدقة المطلوبة (الضلع الأقصر = 1080 أو 720 ...) */
export function sizeForResolution(project, shortSide) {
  const k = Math.min(4, shortSide / Math.min(project.width, project.height));
  let w = Math.round(project.width * k), h = Math.round(project.height * k);
  w -= w % 2; h -= h % 2;
  return { w: Math.max(2, w), h: Math.max(2, h) };
}

export async function* generateFrames(project, { fps, w, h, cache, transparent = false, signal, motionBlur = 0, duration, only }) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: false, alpha: true });
  const dur = duration ?? project.duration;
  const total = Math.max(1, Math.round(dur * fps));
  let acc = null, actx = null;
  if (motionBlur > 1) {
    acc = document.createElement('canvas'); acc.width = w; acc.height = h;
    actx = acc.getContext('2d');
  }
  for (let i = 0; i < total; i++) {
    if (signal?.aborted) throw new DOMException('أُلغي التصدير', 'AbortError');
    const t = i / fps;
    if (only && !only.has(i)) continue;
    if (!acc) {
      for (const p of prepareHooks) await p(project, t, cache);
      renderFrame(ctx, project, t, { cache, transparent, outW: w, outH: h, exporting: true });
      yield { canvas, i, t, total };
    } else {
      // ضبابية الحركة: متوسط عدة لقطات داخل زمن الإطار
      actx.setTransform(1, 0, 0, 1, 0, 0);
      actx.globalAlpha = 1;
      actx.clearRect(0, 0, w, h);
      const n = motionBlur;
      const shutter = 0.5 / fps;
      for (let j = 0; j < n; j++) {
        const st = t + (j / n - 0.5) * shutter;
        for (const p of prepareHooks) await p(project, Math.max(0, st), cache);
        renderFrame(ctx, project, Math.max(0, st), { cache, transparent, outW: w, outH: h, exporting: true });
        actx.globalAlpha = 1 / (j + 1);
        actx.drawImage(canvas, 0, 0);
      }
      yield { canvas: acc, i, t, total };
    }
    // اترك المتصفح يتنفس حتى لا تتجمد الواجهة
    if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
  }
}

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
