// الشاشة الرئيسية: قائمة المشاريع وإنشاء مشروع جديد
import { h, btn, clear, modal, confirmBox, toast, menu, promptBox } from './dom.js';
import { icon } from './icons.js';
import { listProjects, saveProject, deleteProject, loadProject } from '../storage/db.js';
import { createProject, SIZE_PRESETS, migrate } from '../core/project.js';
import { uid } from '../core/math.js';

export const homeExtras = []; // أزرار إضافية في الشاشة الرئيسية (مثل الأمثلة)

export async function renderHome(root, { open }) {
  clear(root);
  const grid = h('div.projects', { 'data-testid': 'projects' });
  const head = h('header.home-head',
    h('div.brand', h('img', { src: 'icons/icon.svg', alt: '', width: 56, height: 56 }), h('div', h('h1', 'نَبض'), h('p', 'حرّك تصميماتك وخطوطك بالمفاتيح، لا بمئات الطبقات'))),
    h('div.home-actions',
      btn('plus', 'مشروع جديد', () => newProjectDialog(open), { cls: 'primary big', testid: 'new-project' }),
      ...homeExtras.map((x) => btn(x.icon, x.label, () => x.onClick(open), { cls: 'big', testid: x.testid }))
    )
  );
  root.append(h('div.home', head, h('h2.section-title', 'مشاريعي'), grid, installHint()));
  const list = await listProjects();
  if (!list.length) {
    grid.append(h('div.empty.big', h('p', 'لا توجد مشاريع بعد.'), h('p.muted', 'اضغط «مشروع جديد» واختر المقاس، ثم استورد صورة وحرّكها بمفتاحين.')));
  }
  for (const p of list) {
    const card = h('div.project-card', { dataset: { testid: 'project-card' } },
      h('button.project-open', { type: 'button', onclick: () => open(migrate(p)), 'aria-label': 'فتح ' + p.name },
        h('div.project-thumb', { style: { aspectRatio: `${p.width}/${p.height}` } }, p.thumb ? h('img', { src: p.thumb, alt: '' }) : h('span', { html: icon('image', 40) })),
        h('strong', p.name),
        h('small', `${p.width}×${p.height} · ${p.duration} ث · ${new Date(p.updated).toLocaleDateString('ar')}`)
      ),
      btn('menu', 'خيارات', (e) => menu(e.currentTarget, [
        { icon: 'text', label: 'إعادة تسمية', onClick: async () => { const v = await promptBox('اسم المشروع', p.name); if (v) { p.name = v; await saveProject(p); renderHome(root, { open }); } } },
        { icon: 'copy', label: 'نسخة مكررة', onClick: async () => { const c = JSON.parse(JSON.stringify(p)); c.id = uid('prj'); c.name += ' (نسخة)'; c.updated = Date.now(); await saveProject(c); renderHome(root, { open }); } },
        { icon: 'trash', label: 'حذف', danger: true, onClick: async () => { if (await confirmBox('حذف المشروع', `حذف «${p.name}» نهائيًا؟`, 'حذف')) { await deleteProject(p); renderHome(root, { open }); } } }
      ]), { iconOnly: true })
    );
    grid.append(card);
  }
}

function newProjectDialog(open) {
  const st = { preset: '9:16', fps: 30, duration: 5, name: 'مشروع ' + new Date().toLocaleDateString('ar') };
  const sizes = h('div.size-grid', SIZE_PRESETS.map((s) => {
    const b = h('button.size-opt', { type: 'button', 'aria-pressed': s.id === st.preset, dataset: { size: s.id }, onclick: () => {
      st.preset = s.id;
      for (const x of sizes.children) x.setAttribute('aria-pressed', x.dataset.size === s.id);
    } }, h('span.size-box', { style: { aspectRatio: `${s.w}/${s.h}` } }), h('span', s.label), h('small', `${s.w}×${s.h}`));
    return b;
  }));
  const fps = h('div.seg', [24, 30, 60].map((f) => h('button', { type: 'button', 'aria-pressed': f === st.fps, onclick: (e) => { st.fps = f; for (const x of fps.children) x.setAttribute('aria-pressed', x === e.currentTarget); } }, `${f}`)));
  const dur = h('input.num', { type: 'number', min: 1, max: 600, step: 0.5, value: st.duration, 'aria-label': 'المدة بالثواني' });
  const name = h('input.text', { value: st.name, 'aria-label': 'اسم المشروع' });
  modal('مشروع جديد', h('div',
    h('label.field', h('span', 'الاسم'), name),
    h('p.field-label', 'المقاس'), sizes,
    h('p.field-label', 'الإطارات في الثانية'), fps,
    h('label.field', h('span', 'المدة (ثوانٍ)'), dur)
  ), [
    { label: 'إنشاء', icon: 'check', primary: true, testid: 'create-project', onClick: async (close) => {
      const p = createProject({ preset: st.preset, fps: st.fps, duration: Math.max(1, +dur.value || 5), name: name.value || st.name });
      await saveProject(p);
      close();
      open(p);
    } }
  ]);
}

function installHint() {
  const standalone = matchMedia('(display-mode: standalone)').matches;
  if (standalone) return '';
  const box = h('div.install-hint');
  const show = () => {
    clear(box);
    if (window.__installPrompt) {
      box.append(btn('import', 'ثبّت نَبض على هذا الجهاز', async () => {
        window.__installPrompt.prompt();
        await window.__installPrompt.userChoice;
        window.__installPrompt = null; show();
      }, { cls: 'primary', testid: 'install' }));
    } else {
      box.append(h('p.muted', 'للتثبيت: من قائمة المتصفح ⋮ اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية». يعمل بعدها بلا إنترنت.'));
    }
  };
  window.addEventListener('nabd-install-ready', show);
  show();
  return box;
}
export { loadProject };
