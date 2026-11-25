import { describe, it, expect } from 'vitest';
import { cubicBezier, getEase, EASE_IDS } from '../../src/core/easing.js';
import { valueAt } from '../../src/core/keyframes.js';
import { createProject, createAsset, createLayer, evalLayer, layerTime } from '../../src/core/project.js';
import { applyKeyPreset, registerMotion, noise1 } from '../../src/core/motion.js';
import { gifDelays } from '../../src/export/gif.js';
import { muxAnimatedWebp, extractFrameData } from '../../src/export/webp.js';

registerMotion();

describe('منحنيات السرعة', () => {
  it('كل القوالب تبدأ من 0 وتنتهي عند 1', () => {
    for (const id of EASE_IDS) {
      const f = getEase(id);
      expect(f(0)).toBeCloseTo(0, 3);
      expect(f(1)).toBeCloseTo(1, 3);
    }
  });
  it('بيزيه الخطي يساوي الخطي', () => {
    const f = cubicBezier(0, 0, 1, 1);
    for (const x of [0.1, 0.33, 0.5, 0.9]) expect(f(x)).toBeCloseTo(x, 4);
  });
  it('البداية الناعمة أبطأ في البداية والنهاية الناعمة أسرع', () => {
    expect(getEase('easeIn')(0.25)).toBeLessThan(0.25);
    expect(getEase('easeOut')(0.25)).toBeGreaterThan(0.25);
  });
  it('الارتداد والنابض يتجاوزان أو يرتدان', () => {
    let over = false;
    for (let i = 0; i <= 100; i++) if (getEase('spring')(i / 100) > 1.01) over = true;
    expect(over).toBe(true);
  });
  it('المنحنى المخصص يطبق على المفاتيح', () => {
    const tr = [{ t: 0, v: 0, ease: { bezier: [0.42, 0, 0.58, 1] } }, { t: 1, v: 100 }];
    expect(valueAt(tr, 0.5, 0)).toBeCloseTo(50, 1);
    expect(valueAt(tr, 0.2, 0)).toBeLessThan(20);
  });
  it('القفزة تبقي القيمة حتى المفتاح التالي', () => {
    const tr = [{ t: 0, v: 0, ease: 'hold' }, { t: 1, v: 100 }];
    expect(valueAt(tr, 0.99, 0)).toBe(0);
  });
});

describe('الحلقة والحركات الجاهزة', () => {
  const p = createProject();
  const a = createAsset('image', { width: 100, height: 100 });
  it('تكرار المقطع بين أول وآخر مفتاح', () => {
    const l = createLayer(p, a);
    l.tracks.x = [{ t: 1, v: 0, ease: 'linear' }, { t: 2, v: 100, ease: 'linear' }];
    l.loop = { mode: 'loop' };
    expect(evalLayer(l, 2.5).x).toBeCloseTo(50);
    expect(evalLayer(l, 3.25).x).toBeCloseTo(25);
    l.loop = { mode: 'pingpong' };
    expect(evalLayer(l, 2.25).x).toBeCloseTo(75);
    l.loop = { mode: 'loop', count: 2 };
    expect(layerTime(l, 10)).toBe(2);
  });
  it('ظهور تدريجي يضيف مفتاحين للشفافية', () => {
    const l = createLayer(p, a);
    applyKeyPreset(l, 'fadeIn', 1, p);
    expect(l.tracks.opacity.map((k) => [k.t, k.v])).toEqual([[1, 0], [1.6, 1]]);
    expect(evalLayer(l, 1.3).opacity).toBeGreaterThan(0.3);
  });
  it('دخول من اليمين يبدأ خارج المشهد وينتهي في مكانه', () => {
    const l = createLayer(p, a);
    applyKeyPreset(l, 'slideRight', 0, p);
    expect(evalLayer(l, 0).x).toBeGreaterThan(p.width);
    expect(evalLayer(l, 0.8).x).toBeCloseTo(p.width / 2);
  });
  it('الحركات المستمرة: نبض ودوران واهتزاز', () => {
    const l = createLayer(p, a);
    l.props.scale = 1;
    l.mods = [{ id: 'm1', type: 'pulse', amount: 0.1, speed: 1 }, { id: 'm2', type: 'spin', amount: 90, speed: 1 }];
    expect(evalLayer(l, 0.25).scale).toBeCloseTo(1.1);
    expect(evalLayer(l, 2).rotation).toBeCloseTo(180);
    l.mods = [{ id: 'm3', type: 'shake', amount: 10, speed: 3 }];
    const xs = [0.1, 0.5, 0.9, 1.3].map((t) => evalLayer(l, t).x);
    expect(new Set(xs.map((x) => x.toFixed(2))).size).toBeGreaterThan(1);
    expect(Math.abs(noise1(3.7))).toBeLessThanOrEqual(1);
  });
});

describe('ترميز GIF وWebP', () => {
  it('توقيت GIF يحافظ على المدة الكلية', () => {
    const d = gifDelays(30, 30);
    expect(d.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(Math.max(...d) - Math.min(...d)).toBeLessThanOrEqual(10);
  });
  it('جمع WebP المتحرك ينتج بنية RIFF صحيحة', () => {
    // إطار VP8L وهمي صغير
    const vp8l = new Uint8Array([86, 80, 56, 76, 5, 0, 0, 0, 0x2f, 1, 2, 3, 4, 0]);
    const still = new Uint8Array(12 + vp8l.length);
    still.set([82, 73, 70, 70]); new DataView(still.buffer).setUint32(4, 4 + vp8l.length, true); still.set([87, 69, 66, 80], 8); still.set(vp8l, 12);
    const fr = extractFrameData(still);
    expect(fr.alpha).toBe(true);
    const out = muxAnimatedWebp([{ data: fr.payload, duration: 40 }, { data: fr.payload, duration: 40 }], 10, 10);
    const s = String.fromCharCode(...out.slice(0, 4)) + String.fromCharCode(...out.slice(8, 16));
    expect(s).toBe('RIFFWEBPVP8X');
    expect(new DataView(out.buffer).getUint32(4, true)).toBe(out.length - 8);
    const txt = Array.from(out).map((c) => String.fromCharCode(c)).join('');
    expect(txt.split('ANMF').length - 1).toBe(2);
  });
});
