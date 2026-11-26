import { test, expect } from '@playwright/test';
import { makePng, newProject, importFile, ed, openLibrary, closePanels } from './helpers.js';

async function stagePoint(page, x, y) {
  const box = await page.getByTestId('stage').boundingBox();
  const p = await ed(page, (e, [x, y]) => { const st = e.editor.stage; const v = st.computeView(); return [(x * v[0] + v[4]) / st.dpr, (y * v[3] + v[5]) / st.dpr]; }, [x, y]);
  return [box.x + p[0], box.y + p[1]];
}

test('المرحلة 3: مسار مرسوم، وتسجيل حي، وربط، وعنصر مركّب', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newProject(page);
  await importFile(page, { name: 'جسم.png', mimeType: 'image/png', buffer: await makePng(page, { shape: 'rect', w: 200, h: 200, color: '#2a9d8f' }) });
  await ed(page, (e) => { const l = e.project.layers[0]; l.props.scale = 0.5; e.commit(); e.setTime(0); });

  // رسم مسار
  await page.getByTestId('tool-path').click();
  const pts = [[150, 800], [400, 300], [700, 700], [950, 200]];
  const [sx, sy] = await stagePoint(page, ...pts[0]);
  await page.mouse.move(sx, sy); await page.mouse.down();
  for (const p of pts.slice(1)) { const [x, y] = await stagePoint(page, ...p); await page.mouse.move(x, y, { steps: 8 }); }
  await page.mouse.up();
  const path = await ed(page, (e) => { const l = e.project.layers[0]; return { n: l.path.pts.length, start: l.path.start, end: l.path.end }; });
  expect(path.n).toBe(160);
  expect(path.end).toBeCloseTo(2);
  // العنصر يسير على المسار: في البداية عند أول نقطة وفي النهاية عند آخرها
  const ends = await ed(page, (e) => { const l = e.project.layers[0]; const p = l.path.pts; return [p[0], p[p.length - 1]]; });
  expect(Math.abs(ends[0][0] - 150)).toBeLessThan(25);
  expect(Math.abs(ends[1][0] - 950)).toBeLessThan(25);
  await page.screenshot({ path: info.outputPath('path.png') });
  await page.getByTestId('tool-path').click(); // رجوع لأداة التحديد

  // نسخة ثانية تُربط بالأولى
  await openLibrary(page);
  await page.getByTestId('add-instance').first().click();
  await closePanels(page);
  const linked = await ed(page, (e) => e.project.layers.map((l) => l.id));
  // الربط عبر القائمة في الخصائص
  if ((page.viewportSize()?.width || 1000) < 900) await page.getByTestId('m-props').click();
  await page.getByTestId('parent-select').selectOption(linked[0]);
  const parented = await ed(page, (e) => e.project.layers[1].parentId);
  expect(parented).toBe(linked[0]);
  // الابن يتحرك مع الأم: موضعه العالمي يتغير بين البداية والنهاية رغم أنه بلا مفاتيح
  const moved = await ed(page, (e) => {
    const arm = e.project.layers[1];
    const w = (t) => { const m = window.__nabd.worldMatrix(e.project, arm, t); return [m[4], m[5]]; };
    return [w(0), w(2)];
  });
  expect(Math.hypot(moved[1][0] - moved[0][0], moved[1][1] - moved[0][1])).toBeGreaterThan(300);

  // العنصر المركّب: نختار الجسم فيُضم معه ابنه
  await ed(page, (e) => e.select(e.project.layers[0].id));
  await page.getByTestId('make-comp').click();
  await page.getByTestId('prompt-ok').click();
  const comp = await ed(page, (e) => ({ layers: e.project.layers.length, type: e.project.assets.at(-1).type, inner: e.project.assets.at(-1).layers.length }));
  expect(comp).toEqual({ layers: 1, type: 'comp', inner: 2 });
  if ((page.viewportSize()?.width || 1000) < 900) await closePanels(page);

  // التسجيل الحي على نسخة جديدة من الصورة
  await openLibrary(page);
  await page.getByTestId('add-instance').first().click();
  await closePanels(page);
  await ed(page, (e) => { e.setTime(0); });
  await page.getByTestId('tool-perform').click();
  const lp = await ed(page, (e) => { const l = e.layer; return [l.props.x, l.props.y]; });
  const [ax, ay] = await stagePoint(page, lp[0], lp[1]);
  await page.mouse.move(ax, ay); await page.mouse.down();
  for (let i = 1; i <= 30; i++) { await page.mouse.move(ax - i * 4, ay + Math.sin(i / 4) * 30); await page.waitForTimeout(25); }
  await page.mouse.up();
  const rec = await ed(page, (e) => { const l = e.layer; return { x: l.tracks.x?.length || 0, playing: e.playing }; });
  expect(rec.playing).toBe(false);
  expect(rec.x).toBeGreaterThan(2);
  expect(errors).toEqual([]);
});
