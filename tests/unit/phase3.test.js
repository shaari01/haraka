import { describe, it, expect } from 'vitest';
import { simplify, smoothPath, pointAt, samplesToKeys, resample } from '../../src/core/path.js';
import { createProject, createAsset, createLayer, evalLayer, worldMatrix } from '../../src/core/project.js';
import { apply, decompose, multiply, rotate, translate, scale } from '../../src/core/math.js';
import '../../src/core/motion.js';

describe('المسارات', () => {
  it('التبسيط يحذف النقاط على خط مستقيم', () => {
    const pts = Array.from({ length: 50 }, (_, i) => [i, i * 2]);
    expect(simplify(pts, 0.5).length).toBe(2);
  });
  it('التنعيم يعيد نقاطًا متساوية البعد تبدأ وتنتهي بالأصل', () => {
    const s = smoothPath([[0, 0], [100, 0], [100, 100]], 50);
    expect(s.length).toBe(50);
    expect(s[0]).toEqual([0, 0]);
    expect(s[49][0]).toBeCloseTo(100); expect(s[49][1]).toBeCloseTo(100);
  });
  it('السير على المسار بالطول والاتجاه', () => {
    const pts = resample([[0, 0], [100, 0]], 11);
    const [x, y, a] = pointAt(pts, 0.5);
    expect(x).toBeCloseTo(50); expect(y).toBeCloseTo(0); expect(a).toBeCloseTo(0);
    const [, , a2] = pointAt(resample([[0, 0], [0, 100]], 5), 0.5);
    expect(a2).toBeCloseTo(90);
  });
  it('التسجيل الحي يتحول إلى مفاتيح قليلة', () => {
    const samples = Array.from({ length: 120 }, (_, i) => ({ t: i / 60, x: 100 + i * 5, y: 300 + Math.sin(i / 10) * 50 }));
    const k = samplesToKeys(samples);
    expect(k.x.length).toBeLessThan(40);
    expect(k.x.length).toBeGreaterThan(2);
    expect(k.x[0].t).toBe(0);
  });
});

describe('تفكيك المصفوفات', () => {
  it('يستعيد الموضع والدوران والحجم', () => {
    const m = multiply(multiply(translate(10, 20), rotate(30)), scale(2));
    const d = decompose(m);
    expect(d.x).toBeCloseTo(10); expect(d.y).toBeCloseTo(20); expect(d.rotation).toBeCloseTo(30); expect(d.scale).toBeCloseTo(2);
  });
});
