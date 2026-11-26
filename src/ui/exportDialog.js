// نافذة التصدير
import { h, btn, modal, toast } from './dom.js';
import { exportMp4, canExportMp4 } from '../export/mp4.js';
import { sizeForResolution, downloadBlob } from '../export/frames.js';
import { sendToInbox } from '../export/share.js';

export const exportFormats = [
  {
    id: 'mp4', label: 'MP4 (واتساب، إنستغرام، تيك توك، X)', ext: 'mp4', mime: 'video/mp4',
    run: (p, o) => exportMp4(p, o),
    check: () => canExportMp4()
  }
];
export const exportOptionsExtras = []; // عناصر تحكم إضافية: fn(state) => Element

function isLowEndPhone() {
  const mem = navigator.deviceMemory || 4;
  const small = Math.min(screen.width, screen.height) < 500;
  return small && mem <= 4;
}

export function openExportDialog(ed) {
  const p = ed.project;
  const state = { format: 'mp4', res: isLowEndPhone() ? 720 : 1080, fps: p.fps, motionBlur: 0, transparent: false };
  let controller = null;
  const fmtSel = h('select', { 'aria-label': 'الصيغة', 'data-testid': 'export-format', onchange: () => { state.format = fmtSel.value; updateNote(); } },
    exportFormats.map((f) => h('option', { value: f.id }, f.label)));
  const resSel = h('select', { 'aria-label': 'الدقة', onchange: () => { state.res = +resSel.value; updateNote(); } },
    [[2160, '4K (بطيء)'], [1080, '1080 (اللابتوب والتابلت)'], [720, '720 (الجوال، أسرع)'], [480, '480 (صغير جدًا)']].map(([v, l]) => h('option', { value: v, selected: v === state.res }, l)));
  const fpsSel = h('select', { 'aria-label': 'الإطارات في الثانية', onchange: () => { state.fps = +fpsSel.value; updateNote(); } },
    [24, 30, 60].map((f) => h('option', { value: f, selected: f === state.fps }, `${f} إطارًا/ث`)));
  const note = h('p.muted.export-note');
  const bar = h('div.progress', h('div.progress-fill'));
  const status = h('p.export-status', { role: 'status' });
  const result = h('div.export-result');
  const extras = h('div', exportOptionsExtras.map((fn) => fn(state, ed)));
  function updateNote() {
    const { w, h: hh } = sizeForResolution(p, state.res);
    note.textContent = `الناتج: ${w}×${hh}، ${Math.round(p.duration * state.fps)} إطارًا. ${state.res >= 1080 ? 'على الجوال القديم اختر 720 ليكون أسرع.' : ''}`;
    const f = exportFormats.find((x) => x.id === state.format);
    for (const el of extras.querySelectorAll('[data-formats]')) el.hidden = !el.dataset.formats.split(',').includes(state.format);
  }
  const body = h('div.export',
    h('label.field', h('span', 'الصيغة'), fmtSel),
    h('label.field', h('span', 'الدقة'), resSel),
    h('label.field', h('span', 'السرعة'), fpsSel),
    extras, note, bar, status, result);
  updateNote();
  const m = modal('تصدير', body, [
    { label: 'إلغاء', icon: 'close', onClick: (close) => { controller?.abort(); close(); } },
    { label: 'تصدير', icon: 'export', primary: true, testid: 'do-export', onClick: () => run() }
  ], { sticky: true, onClose: () => controller?.abort() });

  async function run() {
    const f = exportFormats.find((x) => x.id === state.format);
    const { w, h: hh } = sizeForResolution(p, state.res);
    controller = new AbortController();
    body.classList.add('busy');
    result.innerHTML = '';
    status.textContent = 'جارٍ التحضير…';
    const fill = bar.firstChild;
    fill.style.width = '0%';
    const t0 = performance.now();
    try {
      ed.emit('export-start');
      await ed.cache.ensureAll(p);
      const blob = await f.run(JSON.parse(JSON.stringify(p)), {
        w, h: hh, fps: state.fps, cache: ed.cache, signal: controller.signal, motionBlur: state.motionBlur, state, ed,
        audio: ed.exportAudio?.(), transparent: state.transparent,
        onProgress: (x) => { fill.style.width = (x * 100).toFixed(1) + '%'; status.textContent = `جارٍ التصدير… ${Math.round(x * 100)}%`; }
      });
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      const name = `${safeName(p.name)}.${f.ext}`;
      status.textContent = `اكتمل في ${secs} ث — الحجم ${(blob.size / 1024 / 1024).toFixed(2)} م.ب`;
      fill.style.width = '100%';
      ed.lastExport = blob;
      const file = new File([blob], name, { type: blob.type || f.mime });
      const actions = [btn('import', 'تنزيل', () => downloadBlob(blob, name), { cls: 'primary', testid: 'download' })];
      if (/^(video\/webm|image\/(gif|webp|png)|video\/mp4)$/.test(blob.type)) actions.push(btn('video', 'أرسل إلى برنامج الفيديو', async () => {
        try { await sendToInbox({ name: p.name, blob, duration: p.duration }); toast('أُرسلت إلى صندوق برنامج الفيديو (مَشهد)'); } catch (e) { toast('تعذر الإرسال', 'error'); }
      }, { testid: 'send-video' }));
      if (navigator.canShare?.({ files: [file] })) actions.push(btn('share', 'مشاركة (واتساب…)', () => navigator.share({ files: [file], title: p.name }).catch(() => {})));
      result.append(h('div.btn-row', actions));
      if (blob.type.startsWith('video/') || blob.type.startsWith('image/')) {
        const url = URL.createObjectURL(blob);
        result.append(blob.type.startsWith('video/') ? h('video.export-preview', { src: url, controls: true, loop: true, muted: true, autoplay: true, playsInline: true }) : h('img.export-preview', { src: url, alt: 'معاينة' }));
      }
      ed.emit('export-done', { blob, format: f.id });
    } catch (e) {
      if (e.name === 'AbortError') status.textContent = 'أُلغي التصدير';
      else { console.error(e); status.textContent = 'تعذر التصدير: ' + (e.message || e); toast('تعذر التصدير', 'error'); }
    } finally {
      body.classList.remove('busy');
      ed.emit('export-end');
    }
  }
  return m;
}

export function safeName(s) { return (s || 'nabd').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'nabd'; }
