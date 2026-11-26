import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;
import { makePng, newProject, importFile, openLibrary, closePanels, ed, accept } from './helpers.js';

const isPhone = (page) => (page.viewportSize()?.width || 1000) < 900;
async function openProps(page) { if (isPhone(page) && !(await page.locator('.props.open').count())) await page.getByTestId('m-props').click(); }

/** GIF من إطارين: أحمر ثم أزرق، كل إطار نصف ثانية */
function makeGif() {
  const w = 40, h = 40, enc = GIFEncoder();
  for (const [r, g, b] of [[255, 0, 0], [0, 0, 255]]) {
    const px = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) px.set([r, g, b, 255], i * 4);
    const pal = quantize(px, 4);
    enc.writeFrame(applyPalette(px, pal), w, h, { palette: pal, delay: 500 });
  }
  enc.finish();
  return Buffer.from(enc.bytes());
}

async function colAdd(page, testid, files) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId(testid).click();
  await (await chooser).setFiles(files);
}
async function openCollection(page, tab) {
  await openLibrary(page);
  await page.getByTestId('my-collection').click();
  await page.locator(`[data-coltab="${tab}"]`).click();
}
const closeModal = (page) => page.locator('.modal-back button[aria-label="إغلاق"]').first().click();

test('مجموعتي: ملصقات وGIF وخطوط وحركات، إضافة وحذف وإخفاء', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newProject(page);

  // ——— ملصقات وGIF ———
  await openCollection(page, 'stickers');
  await colAdd(page, 'col-add-sticker', [
    { name: 'قلب.png', mimeType: 'image/png', buffer: await makePng(page, { color: '#00aa00', w: 120, h: 120 }) },
    { name: 'وميض.gif', mimeType: 'image/gif', buffer: makeGif() }
  ]);
  await expect(page.locator('[data-testid=col-sticker]')).toHaveCount(2);
  // إدراج الـ GIF في المشهد
  await page.locator('[data-testid=col-sticker][title="وميض"]').click();
  await page.waitForFunction(() => window.__editor.ed.project.assets.some((a) => a.type === 'gif'));
  await closePanels(page);
  const colorAt = (t) => page.evaluate((t) => {
    const ed = window.__editor.ed, p = ed.project, c = document.createElement('canvas'); c.width = p.width / 4; c.height = p.height / 4;
    const g = c.getContext('2d', { willReadFrequently: true });
    window.__nabd.renderFrame(g, p, t, { cache: ed.cache });
    return Array.from(g.getImageData(c.width / 2, c.height / 2, 1, 1).data.slice(0, 3));
  }, t);
  await page.waitForFunction(() => { const ed = window.__editor.ed; const c = document.createElement('canvas'); c.width = 10; c.height = 10; window.__nabd.renderFrame(c.getContext('2d'), ed.project, 0.1, { cache: ed.cache }); return true; });
  await expect.poll(() => colorAt(0.1)).toEqual([255, 0, 0]);
  expect(await colorAt(0.7)).toEqual([0, 0, 255]);
  expect(await colorAt(1.2)).toEqual([255, 0, 0]); // يتكرر
  // حذف ملصق من المجموعة
  await openCollection(page, 'stickers');
  await page.locator('.col-cell', { has: page.locator('[title="قلب"]') }).getByTestId('col-del').click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.locator('[data-testid=col-sticker]')).toHaveCount(1);

  // ——— الخطوط ———
  await page.locator('[data-coltab="fonts"]').click();
  await colAdd(page, 'col-add-font', { name: 'خطي.woff2', mimeType: 'font/woff2', buffer: fs.readFileSync('node_modules/@fontsource/amiri/files/amiri-arabic-700-normal.woff2') });
  await expect(page.locator('[data-testid=col-font]')).toHaveCount(1);
  await page.getByTestId('col-eye').first().click(); // إخفاء «أميري» الجاهز
  await expect(page.locator('.col-row.off')).toHaveCount(1);
  await closeModal(page);
  await page.getByTestId('new-text').click();
  await expect(page.locator('.modal button.chip', { hasText: 'خطي' })).toHaveCount(1);
  await expect(page.locator('.modal button.chip', { hasText: 'أميري' })).toHaveCount(0);
  expect(await page.evaluate(() => document.fonts.check('40px "خطي"', 'بسم'))).toBe(true);
  await closeModal(page);

  // ——— حفظ حركة وتطبيقها على عنصر آخر ———
  await importFile(page, { name: 'نجمة.png', mimeType: 'image/png', buffer: await makePng(page) });
  await openProps(page);
  await page.locator('[data-preset="slideUp"]').click(); await accept(page);
  await page.getByTestId('save-motion').click();
  await page.locator('.modal input.text').fill('صعودي');
  await page.getByTestId('prompt-ok').click();
  await expect(page.locator('[data-mymotion]')).toHaveCount(1);
  await closePanels(page);
  // العنصر الأول (GIF) بلا حركة: نطبق عليه «صعودي» بمعاينة ثم ✓
  await ed(page, (e) => { e.select(e.project.layers[0].id); e.setTime(1); });
  await openProps(page);
  await page.locator('[data-mymotion]').click();
  await expect(page.getByTestId('trial-bar')).toBeVisible();
  await accept(page);
  const ys = await ed(page, (e) => e.project.layers[0].tracks.y.map((k) => [k.t, Math.round(k.v)]));
  expect(ys[0][0]).toBe(1);
  expect(ys.at(-1)[1]).toBe(await ed(page, (e) => Math.round(e.project.layers[0].props.y)));

  // ——— إخفاء حركة جاهزة، وحذف حركتي ———
  await closePanels(page);
  await openCollection(page, 'motions');
  await page.locator('.col-row', { hasText: 'ظهور تدريجي' }).getByTestId('col-eye').click();
  await page.getByTestId('col-motion').getByTestId('col-del').click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('col-motion')).toHaveCount(0);
  await closeModal(page);
  await closePanels(page);
  await openProps(page);
  await expect(page.locator('[data-preset="fadeIn"]')).toHaveCount(0);
  await expect(page.locator('[data-mymotion]')).toHaveCount(0);

  // ——— «حفظ في مجموعتي» من قائمة عنصر، والبقاء بعد إعادة التحميل ———
  await closePanels(page);
  await openLibrary(page);
  await page.locator('.asset', { hasText: 'نجمة' }).locator('button[aria-label="خيارات"]').click();
  await page.getByTestId('save-to-collection').click();
  await expect(page.locator('#toast')).toHaveText('حُفظ في مجموعتي');
  await page.reload();
  await page.getByTestId('editor').waitFor();
  await openCollection(page, 'stickers');
  await expect(page.locator('[data-testid=col-sticker]')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('أزرار − و + على الأشرطة', async ({ page }) => {
  await newProject(page);
  await importFile(page, { name: 'a.png', mimeType: 'image/png', buffer: await makePng(page) });
  await openProps(page);
  const wrap = page.locator('.props .slider-wrap').nth(2); // الحجم
  const v0 = await ed(page, (e) => e.layer.props.scale);
  await wrap.getByTestId('slider-plus').click();
  await wrap.getByTestId('slider-plus').click();
  const v1 = await ed(page, (e) => e.layer.props.scale);
  expect(v1).toBeGreaterThan(v0);
  await wrap.getByTestId('slider-minus').click();
  expect(await ed(page, (e) => e.layer.props.scale)).toBeLessThan(v1);
});
