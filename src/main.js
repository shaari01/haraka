// نقطة البداية
import '@fontsource/tajawal/arabic-400.css';
import '@fontsource/tajawal/arabic-500.css';
import '@fontsource/tajawal/arabic-700.css';
import './styles.css';
import { renderHome } from './ui/home.js';
import { Editor } from './ui/editor.js';
import { requestPersist, loadProject } from './storage/db.js';
import { migrate, worldMatrix, evalLayer } from './core/project.js';
import { renderFrame } from './core/renderer.js';
import { toast } from './ui/dom.js';
import './features/index.js';

const root = document.getElementById('app');
let editor = null;

function openProject(p) {
  requestPersist();
  root.innerHTML = '';
  editor = new Editor(migrate(p), { onExit: () => { editor = null; history.replaceState(null, '', location.pathname); renderHome(root, { open: openProject }); } });
  root.append(editor.el);
  history.replaceState(null, '', '#p=' + p.id);
  window.__editor = editor; // للاختبارات الآلية
  window.__nabd = { worldMatrix, evalLayer, renderFrame };
}

async function start() {
  const m = location.hash.match(/p=([\w-]+)/);
  if (m) {
    const p = await loadProject(m[1]).catch(() => null);
    if (p) return openProject(p);
  }
  renderHome(root, { open: openProject });
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__installPrompt = e;
  window.dispatchEvent(new Event('nabd-install-ready'));
});

// احفظ قبل الإغلاق
document.addEventListener('visibilitychange', () => { if (document.hidden && editor) editor.ed.saveNow(); });

// العامل الخدمي للعمل بلا إنترنت
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({
      immediate: true,
      onOfflineReady() { toast('نَبض جاهز للعمل بلا إنترنت'); },
      onNeedRefresh() { toast('يوجد تحديث، سيُطبق عند إعادة الفتح'); }
    });
  }).catch(() => {});
}

start();
