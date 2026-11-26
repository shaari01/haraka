import { test, expect } from '@playwright/test';
import { makePng, newProject, importFile, ed } from './helpers.js';

test('واجهة مدمجة: أزرار صغيرة، وأشرطة لا تتغير بالتمرير', async ({ page }) => {
  await newProject(page);
  await importFile(page, { name: 'a.png', mimeType: 'image/png', buffer: await makePng(page) });
  // أحجام الأزرار مدمجة (كما في فيفافيديو)
  const sizes = await page.evaluate(() => [...document.querySelectorAll('.toolbar .btn, .topbar .btn, .tl-transport .btn')].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect().height));
  expect(sizes.length).toBeGreaterThan(5);
  expect(Math.max(...sizes)).toBeLessThanOrEqual(40);

  // شريط: سحب رأسي (تمرير) لا يغيّره، وسحب أفقي مقصود يغيّره نسبيًا
  if ((page.viewportSize()?.width || 1000) < 900) { await page.getByTestId('m-props').click(); await page.waitForTimeout(400); } // انتظار انزلاق اللوحة
  const r = page.locator('.props input[type=range]').first();
  await r.scrollIntoViewIfNeeded();
  const v0 = await r.inputValue();
  const swipe = (dx, dy) => r.evaluate((el, [dx, dy]) => {
    const b = el.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2;
    const fire = (type, cx, cy) => document.elementFromPoint(x, y)?.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', pointerId: 7, clientX: cx, clientY: cy, bubbles: true }));
    fire('pointerdown', x, y);
    for (let i = 1; i <= 6; i++) fire('pointermove', x + dx * i / 6, y + dy * i / 6);
    fire('pointerup', x + dx, y + dy);
  }, [dx, dy]);
  await swipe(6, 80);
  expect(await r.inputValue()).toBe(v0);
  await swipe(0, 4); // لمسة خفيفة لا تقفز بالقيمة
  expect(await r.inputValue()).toBe(v0);
  await swipe(-60, 3);
  expect(await r.inputValue()).not.toBe(v0);
});
