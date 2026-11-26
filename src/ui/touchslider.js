// أشرطة التمرير لا تتغير بالخطأ: على اللمس لا يتغير الشريط إلا بسحب أفقي مقصود،
// والسحب الرأسي يبقى تمريرًا للوحة. والتغيير نسبي من القيمة الحالية (لا يقفز إلى مكان الإصبع).
const SLOP = 10;

function findRange(x, y) {
  for (const r of document.querySelectorAll('input[type=range]')) {
    if (r.disabled || !r.offsetParent) continue;
    const b = r.getBoundingClientRect();
    if (x >= b.left - 4 && x <= b.right + 4 && y >= b.top - 10 && y <= b.bottom + 10) return r;
  }
  return null;
}

export function installTouchSliders(root = document) {
  let s = null;
  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    const r = findRange(e.clientX, e.clientY);
    if (!r) return;
    s = { r, id: e.pointerId, x: e.clientX, y: e.clientY, v0: parseFloat(r.value), engaged: false };
  }, true);
  root.addEventListener('pointermove', (e) => {
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.engaged) {
      if (Math.abs(dy) > SLOP && Math.abs(dy) >= Math.abs(dx)) { s = null; return; } // تمرير رأسي
      if (Math.abs(dx) > SLOP && Math.abs(dx) > Math.abs(dy)) { s.engaged = true; s.x = e.clientX; s.r.classList.add('dragging'); }
      else return;
    }
    const r = s.r, min = parseFloat(r.min || 0), max = parseFloat(r.max || 100);
    const step = r.step === 'any' ? 0 : parseFloat(r.step || 1);
    const w = r.getBoundingClientRect().width || 1;
    const rtl = getComputedStyle(r).direction === 'rtl';
    let v = s.v0 + ((rtl ? -1 : 1) * (e.clientX - s.x) / w) * (max - min);
    if (step) v = Math.round((v - min) / step) * step + min;
    v = Math.max(min, Math.min(max, v));
    if (String(v) !== r.value) { r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); }
  }, true);
  const end = (e) => {
    if (!s || e.pointerId !== s.id) return;
    if (s.engaged) { s.r.classList.remove('dragging'); s.r.dispatchEvent(new Event('change', { bubbles: true })); }
    s = null;
  };
  root.addEventListener('pointerup', end, true);
  root.addEventListener('pointercancel', end, true);
}
