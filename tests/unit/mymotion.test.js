import { describe, it, expect } from 'vitest';
import { captureMotion, applyMotion, hasMotion } from '../../src/core/mymotion.js';

const layer = (props, tracks = {}, mods) => ({ props: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, skewX: 0, blur: 0, brightness: 1, tintAmount: 0, tint: '#ffffff', ...props }, tracks, mods, anchorX: 0.5, anchorY: 0.5 });

describe('حركاتي', () => {
  it('تلتقط الحركة نسبيًا وتطبقها من مكان العنصر الجديد', () => {
    const a = layer({}, { x: [{ t: 1, v: 100, ease: 'bounce' }, { t: 2, v: 300 }], scale: [{ t: 1, v: 2 }, { t: 2, v: 4 }], opacity: [{ t: 1, v: 0 }, { t: 1.5, v: 1 }] }, [{ id: 'm1', type: 'pulse', amount: 0.1, speed: 1 }]);
    expect(hasMotion(a)).toBe(true);
    const m = captureMotion(a);
    expect(m.tracks.x).toEqual([{ t: 0, v: -200, ease: 'bounce' }, { t: 1, v: 0 }]);
    expect(m.tracks.scale.map((k) => k.v)).toEqual([0.5, 1]);
    expect(m.dur).toBe(1);
    const b = layer({ x: 500, scale: 0.5 });
    applyMotion(b, m, 3);
    expect(b.tracks.x.map((k) => [k.t, k.v])).toEqual([[3, 300], [4, 500]]);
    expect(b.tracks.scale.map((k) => k.v)).toEqual([0.25, 0.5]);
    expect(b.tracks.opacity.map((k) => k.v)).toEqual([0, 1]);
    expect(b.mods).toHaveLength(1);
    expect(b.mods[0].id).not.toBe('m1');
  });
  it('حركة دخول من خارج المشهد تنتهي في مكان العنصر الجديد، وحركة الخروج تبدأ منه', () => {
    const P = { width: 1080, height: 1080 };
    const inn = captureMotion(layer({}, { y: [{ t: 0, v: 1280 }, { t: 0.8, v: 540 }] }), P);
    const b = layer({ y: 300 }); applyMotion(b, inn, 0);
    expect(b.tracks.y.map((k) => k.v)).toEqual([1040, 300]);
    const out = captureMotion(layer({}, { y: [{ t: 0, v: 540 }, { t: 0.8, v: -200 }] }), P);
    const c = layer({ y: 300 }); applyMotion(c, out, 0);
    expect(c.tracks.y.map((k) => k.v)).toEqual([300, -440]);
  });
  it('عنصر بلا مفاتيح ليس فيه حركة', () => {
    expect(hasMotion(layer({}))).toBe(false);
  });
});
