import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { makePng, newProject, importFile, openLibrary, closePanels, ed, coverage } from './helpers.js';

const isPhone = (page) => (page.viewportSize()?.width || 1000) < 900;

/** ملف WAV قصير: نغمة مع نقرات كل نصف ثانية */
function makeWav(sec = 2, rate = 22050) {
  const n = sec * rate, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / rate, click = (t % 0.5) < 0.03 ? 0.9 : 0.2;
    buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * t) * click * 32000), 44 + i * 2);
  }
  return buf;
}

/** مركز البكسلات ذات لون معيّن في إطار عند t */
async function centroid(page, t, rgb) {
  return page.evaluate(({ t, rgb }) => {
    const ed = window.__editor.ed, p = ed.project;
    const c = document.createElement('canvas'); c.width = p.width / 4; c.height = p.height / 4;
    const g = c.getContext('2d', { willReadFrequently: true });
    window.__nabd.renderFrame(g, p, t, { cache: ed.cache });
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let sx = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - rgb[0]) < 40 && Math.abs(d[i + 1] - rgb[1]) < 40 && Math.abs(d[i + 2] - rgb[2]) < 40) { sx += (i / 4) % c.width; n++; }
    return n ? (sx / n) * 4 : null;
  }, { t, rgb });
}

async function exportAs(page, format) {
  await page.getByTestId('export').click();
  await page.getByTestId('export-format').selectOption(format);
  await page.locator('select[aria-label="الدقة"]').selectOption('480');
  await page.getByTestId('do-export').click();
  await page.getByTestId('download').waitFor({ timeout: 90000 });
  const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await window.__editor.ed.lastExport.arrayBuffer())));
  await page.locator('.modal-back button[aria-label="إغلاق"]').first().click();
  await page.locator('.modal-back').waitFor({ state: 'detached' });
  return Buffer.from(bytes);
}

test('المرحلة 6: الكاميرا والعمق، والرسم إطارًا بإطار، والصوت والإيقاع، وصيغ التصدير', async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newProject(page);
  await importFile(page, { name: 'خلفية.png', mimeType: 'image/png', buffer: await makePng(page, { shape: 'rect', color: '#0000ff', w: 200, h: 200 }) });
  await importFile(page, { name: 'نجمة.png', mimeType: 'image/png', buffer: await makePng(page, { color: '#ff0000', w: 200, h: 200 }) });

  // ——— الكاميرا من الواجهة ———
  await ed(page, (e) => { e.select(null); e.emit('select'); });
  if (isPhone(page)) await page.getByTestId('m-props').click();
  await page.getByTestId('camera-on').click();
  await expect(page.getByTestId('cam-x')).toBeVisible();
  await page.getByTestId('camkey-x').click();
  await closePanels(page);
  await ed(page, (e) => {
    const [bg, fg] = e.project.layers;
    bg.depth = 0.2; fg.depth = 1.5;
    bg.props.x = 400; fg.props.x = 680;
    e.project.camera.tracks.x.push({ t: 2, v: 540 + 200, ease: 'linear' });
    e.commit(); e.setTime(0);
  });
  await expect(page.getByTestId('timeline').locator('.tl-camera .key.cam')).toHaveCount(2);
  const b0 = await centroid(page, 0, [0, 0, 255]), b1 = await centroid(page, 2, [0, 0, 255]);
  const f0 = await centroid(page, 0, [255, 0, 0]), f1 = await centroid(page, 2, [255, 0, 0]);
  // الكاميرا تتحرك يمينًا فيتحرك المشهد يسارًا؛ الأقرب أسرع
  expect(b1).toBeLessThan(b0);
  expect(f0 - f1).toBeGreaterThan((b0 - b1) * 3);
  expect(f0 - f1).toBeGreaterThan(200);

  // ——— الرسم إطارًا بإطار ———
  await ed(page, (e) => { delete e.project.camera; e.project.layers.forEach((l) => { l.hidden = true; }); e.commit(); e.setTime(0); });
  await openLibrary(page);
  await page.getByTestId('new-drawing').click();
  await closePanels(page);
  expect(await ed(page, (e) => [e.tool, e.project.assets.at(-1).type])).toEqual(['draw', 'drawing']);
  const box = await page.getByTestId('stage').boundingBox();
  const stroke = async (y) => {
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * y, { steps: 8 });
    await page.mouse.up();
  };
  await stroke(0.3);
  await page.waitForFunction(() => !!window.__editor.ed.project.assets.at(-1).frames[0].blobKey);
  const c0 = await coverage(page, 0);
  expect(c0).toBeGreaterThan(0.002);
  if (isPhone(page)) await page.getByTestId('m-props').click();
  await page.getByTestId('add-frame').click();
  await expect(page.locator('.frame-th')).toHaveCount(2);
  await expect(page.locator('.frame-th.on')).toHaveAttribute('data-frame', '1');
  await closePanels(page);
  await stroke(0.7);
  await page.waitForFunction(() => !!window.__editor.ed.project.assets.at(-1).frames[1].blobKey);
  const fps = await ed(page, (e) => e.project.fps);
  // كل إطار يدوم إطارين؛ الإطار الثاني يبدأ عند 2/fps وتتكرر الدورة بعد 4/fps
  const top = async (t) => page.evaluate((t) => {
    const ed = window.__editor.ed, p = ed.project;
    const c = document.createElement('canvas'); c.width = p.width / 4; c.height = p.height / 4;
    const g = c.getContext('2d', { willReadFrequently: true });
    window.__nabd.renderFrame(g, { ...p, background: null }, t, { cache: ed.cache, transparent: true });
    const a = g.getImageData(0, 0, c.width, c.height / 2).data, b = g.getImageData(0, c.height / 2, c.width, c.height / 2).data;
    const cnt = (d) => { let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++; return n; };
    return [cnt(a), cnt(b)];
  }, t);
  const [ta, tb] = await top(0), [ua, ub] = await top(2 / fps + 0.001), [va] = await top(4 / fps + 0.001);
  expect(ta).toBeGreaterThan(50); expect(tb).toBe(0);
  expect(ub).toBeGreaterThan(50); expect(ua).toBe(0);
  expect(va).toBeGreaterThan(50);
  await page.screenshot({ path: info.outputPath('onion.png') });

  // ——— الصوت وعلامات الإيقاع ———
  await importFile(page, { name: 'إيقاع.wav', mimeType: 'audio/wav', buffer: makeWav(2) });
  await expect(page.getByTestId('audio-row')).toBeVisible();
  // الشكل الموجي مرسوم فعلًا (ننتظر لأن الخط الزمني قد يُعاد رسمه بعد فك الصوت)
  await page.waitForFunction(() => {
    const c = document.querySelector('[data-testid=audio-row] canvas.wave');
    if (!c || c.width < 10) return false;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
    return n > 100;
  });
  await ed(page, (e) => e.setTime(0.5));
  await page.getByTestId('beat').click();
  await ed(page, (e) => e.setTime(1));
  await page.keyboard.press('b');
  expect(await ed(page, (e) => e.project.markers)).toEqual([0.5, 1]);
  await expect(page.locator('.tl-ruler .marker')).toHaveCount(2);
  expect(await ed(page, (e) => e.editor.timeline.snapTime(0.52))).toBe(0.5);
  expect(await ed(page, (e) => !!e.exportAudio())).toBe(true);

  // ——— الإضاءة والجزيئات ———
  for (const fx of ['fx-light', 'fx-snow']) {
    const n = await ed(page, (e) => e.project.layers.length);
    await openLibrary(page);
    await page.getByTestId('new-fx').click();
    await page.getByTestId(fx).click();
    await closePanels(page);
    await page.getByTestId('try-ok').click();
    expect(await ed(page, (e) => e.project.layers.length)).toBe(n + 1);
  }
  expect(await ed(page, (e) => e.project.layers.slice(-2).map((l) => e.project.assets.find((a) => a.id === l.assetId).type))).toEqual(['light', 'particles']);

  // ——— التصدير ———
  await ed(page, (e) => { e.project.duration = 1; e.project.layers.forEach((l) => { l.hidden = false; }); e.commit(); });
  const mp4 = await exportAs(page, 'mp4');
  fs.writeFileSync(info.outputPath('a.mp4'), mp4);
  const streams = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', info.outputPath('a.mp4')]).toString()).streams;
  expect(streams.map((s) => s.codec_type).sort()).toEqual(['audio', 'video']);

  const webm = await exportAs(page, 'webm');
  fs.writeFileSync(info.outputPath('a.webm'), webm);
  const w = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=codec_name,nb_read_frames:stream_tags', '-of', 'json', info.outputPath('a.webm')]).toString()).streams[0];
  expect(w.codec_name).toBe('vp9');
  expect(Number(w.nb_read_frames)).toBeGreaterThan(20);

  const zip = await exportAs(page, 'png');
  expect(zip.slice(0, 2).toString()).toBe('PK');
  const names = zip.toString('latin1').match(/frame_?\d+\.png/g) || [];
  expect(new Set(names).size).toBeGreaterThan(20);

  const lottie = JSON.parse((await exportAs(page, 'lottie')).toString());
  expect(lottie.v).toBeTruthy();
  expect(lottie.layers.length).toBeGreaterThanOrEqual(2);
  expect(lottie.op).toBeGreaterThan(20);

  expect(errors).toEqual([]);
});

test('استيراد حزمة طبقات من برنامج الصور', async ({ page }) => {
  const { zipSync, strToU8 } = await import('fflate');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newProject(page);
  const red = new Uint8Array(await makePng(page, { shape: 'rect', color: '#ff0000', w: 400, h: 200 }));
  const star = new Uint8Array(await makePng(page, { color: '#00aa00', w: 200, h: 200 }));
  const manifest = { format: 'lawha-layers', version: 1, name: 'بطاقة', width: 1000, height: 1000, background: '#112233', layers: [
    { id: 'l1', name: 'شريط', type: 'image', group: 'خلفية', file: 'layers/001.png', x: 0, y: 0, width: 400, height: 200, opacity: 0.5, blend: 'multiply', visible: true },
    { id: 'l2', name: 'نجمة', type: 'image', file: 'layers/002.png', x: 600, y: 600, width: 200, height: 200, opacity: 1, blend: 'source-over', visible: true }
  ] };
  const zip = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), 'layers/001.png': red, 'layers/002.png': star }, { level: 0 });
  await importFile(page, { name: 'بطاقة.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });
  await page.waitForFunction(() => window.__editor.ed.project.layers.length === 2);
  const r = await ed(page, (e) => ({ bg: e.project.background, layers: e.project.layers.map((l) => ({ n: l.name, x: Math.round(l.props.x), y: Math.round(l.props.y), s: l.props.scale, o: l.props.opacity, b: l.blend || null })) }));
  expect(r.bg).toBe('#112233');
  expect(r.layers).toEqual([
    { n: 'خلفية / شريط', x: 216, y: 108, s: 1.08, o: 0.5, b: 'multiply' },
    { n: 'نجمة', x: 756, y: 756, s: 1.08, o: 1, b: null }
  ]);
  expect(await coverage(page, 0)).toBeGreaterThan(0.05);
  expect(errors).toEqual([]);
});
