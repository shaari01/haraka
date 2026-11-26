import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { readLawha, placeLayer } from '../../src/features/lawha-import.js';

describe('حزمة طبقات «لوحة»', () => {
  const manifest = { format: 'lawha-layers', version: 1, name: 'ب', width: 2000, height: 1000, background: null, layers: [{ id: 'a', name: 'س', type: 'image', file: 'layers/001.png', x: 0, y: 0, width: 200, height: 100, opacity: 1, blend: 'source-over', visible: true }] };
  it('تتعرف على الحزمة وترفض غيرها', () => {
    const z = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), 'layers/001.png': new Uint8Array([1, 2]) }, { level: 0 });
    const r = readLawha(z);
    expect(r.manifest.layers).toHaveLength(1);
    expect(r.files['layers/001.png']).toBeTruthy();
    expect(readLawha(zipSync({ 'x.txt': strToU8('a') }))).toBeNull();
    expect(readLawha(new Uint8Array([1, 2, 3]))).toBeNull();
  });
  it('تُحجَّم اللوحة لتلائم المشهد وتتوسطه', () => {
    const pos = placeLayer(manifest, manifest.layers[0], 1080, 1080);
    expect(pos.scale).toBeCloseTo(0.54);
    expect(pos.x).toBeCloseTo(100 * 0.54);
    expect(pos.y).toBeCloseTo((1080 - 540) / 2 + 50 * 0.54);
  });
});
