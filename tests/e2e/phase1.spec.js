import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { makePng, newProject, importFile, ed, openLibrary, closePanels } from './helpers.js';

test('المرحلة 1: مكتبة، ونسخ مرتبطة، ومفاتيح، وتصدير MP4', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newProject(page);
  const png = await makePng(page);
  await importFile(page, { name: 'نجمة.png', mimeType: 'image/png', buffer: png });
  // استيراد ملف واحد يضيف نسخة على المشهد
  expect(await ed(page, (e) => e.project.layers.length)).toBe(1);

  // مفتاحان: الموضع عند 0 ثم عند ثانيتين
  await ed(page, (e) => { const l = e.project.layers[0]; e.setTime(0); e.setProp(l, 'x', 200, { forceKey: true }); e.setProp(l, 'rotation', 0, { forceKey: true }); e.commit(); });
  await ed(page, (e) => { const l = e.project.layers[0]; e.setTime(2); e.setProp(l, 'x', 880); e.setProp(l, 'rotation', 180); e.commit(); });
  const keys = await page.locator('.tl-layer .key').count();
  expect(keys).toBeGreaterThanOrEqual(2);

  // نسخة ثانية مرتبطة من نفس العنصر
  await openLibrary(page);
  await page.getByTestId('add-instance').first().click();
  await closePanels(page);
  const counts = await ed(page, (e) => ({ layers: e.project.layers.length, assets: e.project.assets.length, same: e.project.layers[0].assetId === e.project.layers[1].assetId }));
  expect(counts).toEqual({ layers: 2, assets: 1, same: true });

  // تراجع وإعادة
  await page.getByTestId('undo').click();
  expect(await ed(page, (e) => e.project.layers.length)).toBe(1);
  await page.getByTestId('redo').click();
  expect(await ed(page, (e) => e.project.layers.length)).toBe(2);

  // سحب العنصر على المشهد يحركه
  await ed(page, (e) => { e.autoKey = false; e.select(e.project.layers[1].id); e.setTime(0); });
  const box = await page.getByTestId('stage').boundingBox();
  const before = await ed(page, (e) => e.project.layers[1].props.x);
  const pos = await ed(page, (e) => { const st = e.editor.stage; const l = e.project.layers[1]; const v = st.computeView(); return [(l.props.x * v[0] + v[4]) / st.dpr, (l.props.y * v[3] + v[5]) / st.dpr]; });
  await page.mouse.move(box.x + pos[0], box.y + pos[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + pos[0] - 40, box.y + pos[1] + 10, { steps: 5 });
  await page.mouse.up();
  const after = await ed(page, (e) => e.project.layers[1].props.x);
  expect(after).toBeLessThan(before - 20);

  await page.screenshot({ path: info.outputPath('editor.png') });

  // التصدير MP4
  const supported = await page.evaluate(() => typeof VideoEncoder !== 'undefined');
  expect(supported).toBe(true);
  await ed(page, (e) => { e.project.duration = 2; e.commit(); });
  await page.getByTestId('export').click();
  await page.getByTestId('export-format').selectOption('mp4');
  await page.locator('select[aria-label="الدقة"]').selectOption('480');
  await page.getByTestId('do-export').click();
  await page.getByTestId('download').waitFor({ timeout: 60000 });
  const buf = await page.evaluate(async () => { const b = window.__editor.ed.lastExport; return { size: b.size, type: b.type, head: Array.from(new Uint8Array(await b.slice(0, 12).arrayBuffer())) }; });
  expect(buf.type).toBe('video/mp4');
  expect(String.fromCharCode(...buf.head.slice(4, 8))).toBe('ftyp');
  const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await window.__editor.ed.lastExport.arrayBuffer())));
  const out = info.outputPath('out.mp4');
  fs.writeFileSync(out, Buffer.from(bytes));
  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=codec_name,width,height,nb_read_frames', '-of', 'json', out]).toString();
  const s = JSON.parse(probe).streams[0];
  expect(s.codec_name).toBe('h264');
  expect(Number(s.nb_read_frames)).toBe(60);
  expect(errors).toEqual([]);
});

test('الحفظ التلقائي: المشروع يبقى بعد إعادة الفتح', async ({ page }) => {
  await newProject(page, { size: '9:16' });
  const png = await makePng(page);
  await importFile(page, { name: 'a.png', mimeType: 'image/png', buffer: png });
  await ed(page, (e) => { e.project.name = 'اختبار الحفظ'; e.commit(); return e.saveNow(); });
  await page.reload();
  await page.getByTestId('editor').waitFor();
  expect(await ed(page, (e) => [e.project.name, e.project.layers.length, e.project.height])).toEqual(['اختبار الحفظ', 1, 1920]);
  await page.getByTestId('back').click();
  await expect(page.getByTestId('project-card').first()).toContainText('اختبار الحفظ');
});

test('لا تمرير أفقي في الصفحة (الجوال واللابتوب)', async ({ page }, info) => {
  await newProject(page);
  const png = await makePng(page);
  await importFile(page, { name: 'b.png', mimeType: 'image/png', buffer: png });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: info.outputPath('layout.png') });
});
