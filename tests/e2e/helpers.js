// أدوات مشتركة للاختبارات الآلية في المتصفح
export async function makePng(page, { w = 300, h = 200, color = '#e63946', shape = 'star' } = {}) {
  const b64 = await page.evaluate(({ w, h, color, shape }) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = color;
    if (shape === 'star') {
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? Math.min(w, h) * 0.2 : Math.min(w, h) * 0.48;
        const a = -Math.PI / 2 + i * Math.PI / 5;
        g.lineTo(w / 2 + r * Math.cos(a), h / 2 + r * Math.sin(a));
      }
      g.fill();
    } else if (shape === 'photo') {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#87ceeb'); gr.addColorStop(0.6, '#2a6f97'); gr.addColorStop(1, '#013a63');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 200; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.5})`; g.fillRect(Math.random() * w, h * 0.55 + Math.random() * h * 0.45, 8, 2); }
    } else { g.fillRect(0, 0, w, h); }
    return c.toDataURL('image/png').split(',')[1];
  }, { w, h, color, shape });
  return Buffer.from(b64, 'base64');
}

export async function newProject(page, { size = '1:1' } = {}) {
  await page.goto('./');
  await page.getByTestId('new-project').click();
  await page.locator(`[data-size="${size}"]`).click();
  await page.getByTestId('create-project').click();
  await page.getByTestId('editor').waitFor();
}

export async function importFile(page, file) {
  const isPhone = (page.viewportSize()?.width || 1000) < 900;
  const before = await page.evaluate(() => window.__editor?.ed.project.assets.length || 0);
  if (isPhone && !(await page.locator('.library.open').count())) await page.getByTestId('m-library').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('import').click();
  await (await chooser).setFiles(file);
  await page.waitForFunction((n) => window.__editor?.ed.project.assets.length > n, before);
  if (isPhone && await page.locator('.library.open').count()) await page.locator('.library [data-testid=panel-close]').click();
}

export async function openLibrary(page) {
  if ((page.viewportSize()?.width || 1000) < 900 && !(await page.locator('.library.open').count())) await page.getByTestId('m-library').click();
}
export async function closePanels(page) {
  for (const sel of ['.library.open', '.props.open']) if (await page.locator(sel).count()) await page.locator(sel + ' [data-testid=panel-close]').click();
}

export const ed = (page, fn, arg) => page.evaluate(new Function('arg', `const ed = window.__editor.ed; return (${fn})(ed, arg);`), arg);

/** نسبة البكسلات المرسومة (غير الشفافة) في إطار عند الزمن t بخلفية شفافة */
export async function coverage(page, t) {
  return page.evaluate((t) => {
    const ed = window.__editor.ed, p = ed.project;
    const c = document.createElement('canvas'); c.width = 270; c.height = Math.round(270 * p.height / p.width);
    const g = c.getContext('2d', { willReadFrequently: true });
    window.__nabd.renderFrame(g, { ...p, background: null }, t, { cache: ed.cache, transparent: true });
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++;
    return n / (c.width * c.height);
  }, t);
}
