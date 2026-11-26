import { describe, it, expect } from 'vitest';
import { pinDisplace, buildMesh, flowField, segDist } from '../../src/core/warp.js';

describe('دبابيس الدمية', () => {
  it('دبوس واحد يحرك كل شيء بنفس المقدار', () => {
    expect(pinDisplace(50, 50, [{ x: 0, y: 0, dx: 10, dy: -5 }], 8)).toEqual([10, -5]);
  });
  it('دبوس ثابت ودبوس متحرك: الانثناء يتلاشى بالابتعاد', () => {
    const pins = [{ x: 0, y: 0, dx: 0, dy: 0 }, { x: 100, y: 0, dx: 0, dy: 40 }];
    const near = pinDisplace(95, 0, pins, 8)[1], mid = pinDisplace(50, 0, pins, 8)[1], far = pinDisplace(5, 0, pins, 8)[1];
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
    expect(mid).toBeCloseTo(20, 0);
  });
  it('الشبكة تغطي الصورة كلها', () => {
    const m = buildMesh(200, 100, []);
    expect(m.src.length).toBe((m.cols + 1) * (m.rows + 1));
    expect(m.dst[m.dst.length - 1]).toEqual([200, 100]);
  });
});

describe('حقل الصورة الحية', () => {
  it('السهم يحرك المنطقة ونقطة التثبيت توقفها', () => {
    const f = flowField(100, 100, 10, 10, [{ x0: 10, y0: 50, x1: 40, y1: 50 }], [[90, 50]], null, 15);
    const at = (i, j) => [f[(j * 10 + i) * 2], f[(j * 10 + i) * 2 + 1]];
    expect(at(2, 5)[0]).toBeGreaterThan(20);
    expect(Math.abs(at(9, 5)[0])).toBeLessThan(at(2, 5)[0] * 0.5);
  });
  it('قناع التجميد يصفّر الحركة', () => {
    const mask = new Uint8Array(100); mask[55] = 255;
    const f = flowField(100, 100, 10, 10, [{ x0: 0, y0: 0, x1: 10, y1: 0 }], [], mask, 10);
    expect(f[55 * 2]).toBe(0);
    expect(f[54 * 2]).toBeGreaterThan(0);
  });
  it('مسافة نقطة عن قطعة', () => {
    expect(segDist(5, 5, 0, 0, 10, 0)).toBe(5);
    expect(segDist(15, 0, 0, 0, 10, 0)).toBe(5);
  });
});
