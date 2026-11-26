import { test, expect } from '@playwright/test';

test('يعمل بلا إنترنت بعد أول زيارة', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('new-project')).toBeVisible();
  await page.getByTestId('new-project').click();
  await page.locator('[data-size="1:1"]').click();
  await page.getByTestId('create-project').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  const fontOk = await page.evaluate(async () => { await document.fonts.load('400 20px "Amiri"', 'بسم'); return document.fonts.check('400 20px "Amiri"', 'بسم'); });
  expect(fontOk).toBe(true);
  await context.setOffline(false);
});
