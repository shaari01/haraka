import { describe, it, expect } from 'vitest';
import { valueAt, setKey, moveKey, removeKey, snapToFrame, interpolate } from '../../src/core/keyframes.js';

describe('محرك المفاتيح', () => {
  it('بلا مفاتيح يعيد القيمة الأساسية', () => {
    expect(valueAt(undefined, 1, 5)).toBe(5);
    expect(valueAt([], 1, 5)).toBe(5);
  });
  it('يحسب ما بين مفتاحين', () => {
    const tr = [];
    setKey(tr, 0, 0); setKey(tr, 2, 100);
    expect(valueAt(tr, 1, 0)).toBeCloseTo(50);
    expect(valueAt(tr, -1, 0)).toBe(0);
    expect(valueAt(tr, 5, 0)).toBe(100);
  });
  it('يحافظ على الترتيب ويستبدل المفتاح في نفس الزمن', () => {
    const tr = [];
    setKey(tr, 2, 20); setKey(tr, 0, 0); setKey(tr, 1, 10); setKey(tr, 1, 15);
    expect(tr.map((k) => k.t)).toEqual([0, 1, 2]);
    expect(tr[1].v).toBe(15);
  });
  it('ينقل المفتاح ويعيد ترتيبه', () => {
    const tr = [];
    setKey(tr, 0, 0); setKey(tr, 1, 10); setKey(tr, 2, 20);
    const i = moveKey(tr, 0, 3);
    expect(i).toBe(2);
    expect(tr.map((k) => k.t)).toEqual([1, 2, 3]);
    removeKey(tr, 0);
    expect(tr.length).toBe(2);
  });
  it('يستوفي الألوان', () => {
    expect(interpolate('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
  it('يلتصق بالإطارات', () => {
    expect(snapToFrame(0.51, 30)).toBeCloseTo(15 / 30);
  });
  it('مفاتيح كثيرة: بحث ثنائي صحيح', () => {
    const tr = [];
    for (let i = 0; i <= 100; i++) setKey(tr, i, i * 2);
    expect(valueAt(tr, 57.5, 0)).toBeCloseTo(115);
  });
});
