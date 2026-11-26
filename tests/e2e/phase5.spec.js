import { test, expect } from '@playwright/test';
import { makePng, newProject, importFile, ed } from './helpers.js';

async function toScreen(page, lx, ly) {
  const box = await page.getByTestId('stage').boundingBox();
  const p = await ed(page, (e, [lx, ly]) => {
    const st = e.editor.stage; const l = e.layer; const m = window.__nabd.worldMatrix(e.project, l, e.time);
    const x = m[0] * lx + m[2] * ly + m[4], y = m[1] * lx + m[3] * ly + m[5]; const v = st.computeView();
    return [(x * v[0] + v[4]) / st.dpr, (y * v[3] + v[5]) / st.dpr];
  }, [lx, ly]);
  return [box.x + p[0], box.y + p[1]];
}

/** بكسلات منطقة من إطار عند زمن t */
async function region(page, t, [x, y, w, h]) {
  return page.evaluate(({ t, r }) => {
    const ed = window.__editor.ed, p = ed.project;
    const c = document.createElement('canvas'); c.width = p.width / 4; c.height = p.height / 4;
    const g = c.getContext('2d', { willReadFrequently: true });
    window.__nabd.renderFrame(g, p, t, { cache: ed.cache });
    return Array.from(g.getImageData(r[0] / 4, r[1] / 4, r[2] / 4, r[3] / 4).data);
  }, { t, r: [x, y, w, h] });
}
const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };

test('المرحلة 5: صورة حية بحلقة سلسة، ودبابيس الدمية', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newProject(page);
  await importFile(page, { name: 'بحر.png', mimeType: 'image/png', buffer: await makePng(page, { shape: 'photo', w: 800, h: 800 }) });
  await ed(page, (e) => { e.project.layers[0].props.scale = 1.35; e.project.layers[0].props.x = 540; e.project.layers[0].props.y = 540; e.commit(); e.setTime(0); });

  // الصورة الحية: سهم على «الماء» في الأسفل، ونقطة تثبيت أعلى
  await page.getByTestId('tool-cine').click();
  const [ax, ay] = await toScreen(page, 100, 600), [bx, by] = await toScreen(page, 600, 600);
  await page.mouse.move(ax, ay); await page.mouse.down(); await page.mouse.move(bx, by, { steps: 6 }); await page.mouse.up();
  await ed(page, (e) => { e.cineMode = 'anchor'; });
  const [cx, cy] = await toScreen(page, 400, 150);
  await page.mouse.click(cx, cy);
  const cine = await ed(page, (e) => ({ arrows: e.layer.cine.arrows.length, anchors: e.layer.cine.anchors.length }));
  expect(cine).toEqual({ arrows: 1, anchors: 1 });

  const water = [300, 800, 480, 160], sky = [440, 120, 200, 120];
  const w0 = await region(page, 0, water), w1 = await region(page, 1.2, water), w3 = await region(page, 3, water);
  expect(diff(w0, w1)).toBeGreaterThan(0.5); // الماء يتحرك
  expect(diff(w0, w3)).toBeLessThan(0.6); // الحلقة تعود لنفس الصورة بلا قفزة
  const s0 = await region(page, 0, sky), s1 = await region(page, 1.2, sky);
  expect(diff(s0, s1)).toBeLessThan(diff(w0, w1) * 0.5); // المنطقة المثبتة شبه ثابتة
  await ed(page, (e) => e.setTime(1.2));
  await page.screenshot({ path: info.outputPath('cine.png') });

  // دبابيس الدمية على عنصر آخر
  await page.getByTestId('tool-cine').click();
  await importFile(page, { name: 'غصن.png', mimeType: 'image/png', buffer: await makePng(page, { shape: 'rect', w: 400, h: 80, color: '#6a994e' }) });
  await ed(page, (e) => { const l = e.layer; l.props.scale = 1; l.props.x = 540; l.props.y = 300; e.setTime(0); e.commit(); });
  await page.getByTestId('tool-puppet').click();
  const [p1x, p1y] = await toScreen(page, 20, 40), [p2x, p2y] = await toScreen(page, 380, 40);
  await page.mouse.click(p1x, p1y);
  await page.mouse.click(p2x, p2y);
  await ed(page, (e) => e.setTime(1));
  await page.mouse.move(p2x, p2y); await page.mouse.down(); await page.mouse.move(p2x, p2y + 80, { steps: 6 }); await page.mouse.up();
  const pins = await ed(page, (e) => ({ n: e.layer.puppet.pins.length, keys: Object.keys(e.layer.tracks).filter((k) => k.startsWith('pin_')).length }));
  expect(pins.n).toBe(2);
  expect(pins.keys).toBe(2);
  const branch = [600, 240, 200, 200];
  const b0 = await region(page, 0, branch), b1 = await region(page, 1, branch);
  expect(diff(b0, b1)).toBeGreaterThan(1); // الطرف انثنى
  await page.screenshot({ path: info.outputPath('puppet.png') });
  expect(errors).toEqual([]);
});
