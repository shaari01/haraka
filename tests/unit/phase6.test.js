import { describe, it, expect } from 'vitest';
import { snapToMarker, computePeaks } from '../../src/features/phase6-audio.js';
import { frameIndexAt, frameStart } from '../../src/features/phase6-draw.js';
import { cameraState } from '../../src/features/phase6-scene.js';

describe('المرحلة 6', () => {
  it('الالتصاق بأقرب علامة إيقاع ضمن المسافة فقط', () => {
    expect(snapToMarker(1.04, [0.5, 1, 2], 0.1)).toBe(1);
    expect(snapToMarker(1.5, [0.5, 1, 2], 0.1)).toBe(1.5);
    expect(snapToMarker(3, undefined, 0.1)).toBe(3);
  });
  it('قمم الموجة', () => {
    const data = new Float32Array(1000); data[12] = -0.8; data[600] = 0.5;
    const p = computePeaks({ getChannelData: () => data }, 2);
    expect(p[0]).toBeCloseTo(0.8); expect(p[1]).toBeCloseTo(0.5);
  });
  it('الإطار المعروض مع مدد التثبيت والتكرار', () => {
    const a = { frames: [{ hold: 2 }, { hold: 1 }, { hold: 3 }] };
    const at = (n) => frameIndexAt(a, n / 12, 12);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(at)).toEqual([0, 0, 1, 2, 2, 2, 0, 0]);
    expect(frameStart(a, 2, 12)).toBeCloseTo(3 / 12);
    expect(frameIndexAt({ ...a, loop: false }, 10, 12)).toBe(2);
    expect(frameIndexAt({ frames: [] }, 0, 12)).toBe(-1);
  });
  it('حالة الكاميرا من مفاتيحها', () => {
    const p = { width: 100, height: 50, camera: { tracks: { zoom: [{ t: 0, v: 1 }, { t: 1, v: 2 }] } } };
    const s = cameraState(p, 0.5);
    expect(s.x).toBe(50); expect(s.zoom).toBeGreaterThan(1); expect(s.zoom).toBeLessThan(2);
    expect(cameraState({ width: 1, height: 1 }, 0)).toBeNull();
  });
});
