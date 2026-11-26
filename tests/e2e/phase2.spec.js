import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { makePng, newProject, importFile, ed, accept } from './helpers.js';

async function openProps(page) {
  if ((page.viewportSize()?.width || 1000) < 900 && !(await page.locator('.props.open').count())) await page.getByTestId('m-props').click();
}

async function exportAs(page, fmt, info) {
  await page.getByTestId('export').click();
  await page.getByTestId('export-format').selectOption(fmt);
  await page.locator('select[aria-label="الدقة"]').selectOption('480');
  await page.getByTestId('do-export').click();
  await page.getByTestId('download').waitFor({ timeout: 90000 });
  const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await window.__editor.ed.lastExport.arrayBuffer())));
  const out = info.outputPath('out.' + fmt);
  fs.writeFileSync(out, Buffer.from(bytes));
  await page.locator('.modal [aria-label="إغلاق"]').first().click();
  return out;
}

test('المرحلة 2: منحنيات السرعة، والحركات الجاهزة، والحلقة، وGIF وWebP', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newProject(page);
  await importFile(page, { name: 'نجمة.png', mimeType: 'image/png', buffer: await makePng(page) });
  await openProps(page);

  // حركة جاهزة بالمفاتيح
  // معاينة قبل الاعتماد: ✕ يلغي، و✓ يعتمد
  await page.locator('[data-preset="fadeIn"]').click();
  await expect(page.getByTestId('trial-bar')).toBeVisible();
  expect(await ed(page, (e) => e.playing)).toBe(true);
  await page.getByTestId('try-cancel').click();
  await expect(page.getByTestId('trial-bar')).toBeHidden();
  expect(await ed(page, (e) => [e.playing, e.project.layers[0].tracks.opacity?.length || 0, e.history.canUndo()])).toEqual([false, 0, true]);
  await page.locator('[data-preset="fadeIn"]').click(); await accept(page);
  await expect(page.getByTestId('trial-bar')).toBeHidden();
  expect(await ed(page, (e) => e.project.layers[0].tracks.opacity.length)).toBe(2);
  // اختيار المفتاح الأول وتغيير منحنى السرعة إلى ارتداد
  await ed(page, (e) => { const l = e.project.layers[0]; e.selectKey({ layerId: l.id, prop: 'opacity', t: 0 }); });
  await page.locator('[data-ease="bounce"]').click(); await accept(page);
  expect(await ed(page, (e) => e.project.layers[0].tracks.opacity[0].ease)).toBe('bounce');
  // محرر المنحنى: سحب مقبض يحوّله إلى منحنى مخصص
  const c = page.locator('canvas.curve');
  await page.locator('[data-ease="easeInOut"]').click(); await accept(page);
  await c.scrollIntoViewIfNeeded();
  const b = await c.boundingBox();
  await page.mouse.move(b.x + b.width * 0.35, b.y + b.height * 0.85);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.2, { steps: 4 });
  await page.mouse.up();
  const ease = await ed(page, (e) => e.project.layers[0].tracks.opacity[0].ease);
  expect(Array.isArray(ease.bezier)).toBe(true);

  // حركة مستمرة وحلقة
  await ed(page, (e) => e.selectKey(null));
  await page.locator('[data-mod="pulse"]').click(); await accept(page);
  await page.locator('[data-loop="pingpong"]').click(); await accept(page);
  expect(await ed(page, (e) => [e.project.layers[0].mods.length, e.project.layers[0].loop.mode])).toEqual([1, 'pingpong']);
  await page.screenshot({ path: info.outputPath('phase2.png') });

  await ed(page, (e) => { e.project.duration = 1; e.commit(); });
  if ((page.viewportSize()?.width || 1000) < 900) await page.locator('.props [data-testid=panel-close]').click();

  const gif = await exportAs(page, 'gif', info);
  const g = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,nb_read_frames', '-of', 'json', gif]).toString()).streams[0];
  expect(g.codec_name).toBe('gif');
  expect(Number(g.nb_read_frames)).toBe(30);

  const webp = await exportAs(page, 'webp', info);
  const head = fs.readFileSync(webp).subarray(0, 16).toString('latin1');
  expect(head.startsWith('RIFF') && head.includes('WEBPVP8X')).toBe(true);
  // فك WebP المتحرك في المتصفح نفسه للتأكد من صلاحيته
  const ok = await page.evaluate(async () => {
    const b = window.__editor.ed.lastExport;
    const bmp = await createImageBitmap(b);
    return [bmp.width, bmp.height];
  });
  expect(ok[0]).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
