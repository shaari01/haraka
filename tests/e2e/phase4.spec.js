import { test, expect } from '@playwright/test';
import { newProject, importFile, ed, coverage, openLibrary, closePanels, accept } from './helpers.js';

const svgA = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><path d="M360 60 C300 160 200 160 150 90 L140 100 C200 190 320 180 375 70 Z" fill="#1d3557"/><circle cx="90" cy="100" r="35" fill="#1d3557"/><path d="M40 40 h20 v120 h-20z" fill="#1d3557"/></svg>`;
const svgB = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><rect x="40" y="40" width="320" height="120" rx="60" fill="#e63946"/></svg>`;

async function openProps(page) {
  if ((page.viewportSize()?.width || 1000) < 900 && !(await page.locator('.props.open').count())) await page.getByTestId('m-props').click();
}

test('المرحلة 4: الخط العربي — كتابة حية، وحرفًا حرفًا، ولمعان، وتوهج، وتحوّل', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newProject(page, { size: '16:9' });

  // نص عربي جديد
  await openLibrary(page);
  await page.getByTestId('new-text').click();
  await page.getByTestId('text-input').fill('الحمد لله');
  await page.getByTestId('text-ok').click();
  await closePanels(page);
  const t = await ed(page, (e) => { const a = e.project.assets[0]; return { type: a.type, w: a.width, layers: e.project.layers.length, hasLayout: '_layout' in JSON.parse(JSON.stringify(a)) }; });
  expect(t.type).toBe('text');
  expect(t.layers).toBe(1);
  expect(t.hasLayout).toBe(false);

  // الكتابة الحية بالقلم
  await ed(page, (e) => e.setTime(0));
  await openProps(page);
  await page.getByTestId('fx-write').click(); await accept(page);
  const full = await coverage(page, 3);
  const mid = await coverage(page, 1);
  const none = await coverage(page, 0);
  expect(full).toBeGreaterThan(0.005);
  expect(none).toBeLessThan(full * 0.05);
  expect(mid).toBeGreaterThan(none);
  expect(mid).toBeLessThan(full);

  // حرفًا حرفًا
  await page.locator('[data-wmode="letters"]').click(); await accept(page);
  await page.locator('[data-lanim="pop"]').click(); await accept(page);
  const lmid = await coverage(page, 0.9);
  expect(lmid).toBeGreaterThan(0);
  expect(lmid).toBeLessThan(full * 1.05);
  expect(await coverage(page, 3)).toBeGreaterThan(full * 0.9);

  // لمعان وتوهج
  await page.getByTestId('fx-shine').click(); await accept(page);
  await page.getByTestId('fx-glow').click(); await accept(page);
  const glow = await coverage(page, 3);
  expect(glow).toBeGreaterThan(full); // التوهج يوسع المساحة المرسومة
  await ed(page, (e) => e.setTime(2.5));
  await page.screenshot({ path: info.outputPath('text.png') });
  await closePanels(page);

  // SVG: كتابة بالقلم على حدود الأشكال، ثم تحوّل إلى شكل آخر
  await importFile(page, { name: 'حرف.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svgA) });
  await importFile(page, { name: 'شكل.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svgB) });
  await ed(page, (e) => { e.project.layers = e.project.layers.filter((l) => e.project.assets.find((a) => a.id === l.assetId).name === 'حرف'); e.select(e.project.layers[0].id); e.setTime(0); e.commit(); });
  await openProps(page);
  await page.getByTestId('fx-write').click(); await accept(page);
  await page.waitForTimeout(300); // تحميل هندسة SVG
  const s0 = await coverage(page, 0.05), s1 = await coverage(page, 1), s2 = await coverage(page, 3);
  expect(s1).toBeGreaterThan(s0);
  expect(s2).toBeGreaterThan(s1);
  await page.getByTestId('fx-write').click(); await accept(page);
  const target = await ed(page, (e) => e.project.assets.find((a) => a.name === 'شكل').id);
  await page.getByTestId('fx-morph').selectOption(target); await accept(page);
  await ed(page, (e) => { const l = e.layer; l.fx.morph.start = 0; l.fx.morph.dur = 2; e.commit(); });
  await page.waitForTimeout(300);
  const m0 = await coverage(page, 0), m1 = await coverage(page, 1), m2 = await coverage(page, 2.5);
  await ed(page, (e) => e.setTime(1));
  await closePanels(page);
  await page.screenshot({ path: info.outputPath('morph.png') });

  // المستطيل الدائري أكبر مساحة من الحرف؛ المنتصف بينهما
  expect(m2).toBeGreaterThan(m0);
  // في المنتصف شكل وسيط يختلف عن البداية والنهاية
  expect(Math.abs(m1 - m0)).toBeGreaterThan(0.005);
  expect(Math.abs(m1 - m2)).toBeGreaterThan(0.005);
  expect(errors).toEqual([]);
});
