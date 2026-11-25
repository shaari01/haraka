// أدوات بناء الواجهة بلا مكتبات
import { icon } from './icons.js';

/** h('div.cls#id', {attrs}, children...) */
export function h(tag, attrs, ...children) {
  const m = tag.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m?.[1] || 'div');
  if (m?.[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g) || []) {
      if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
    }
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && k !== 'list' && k !== 'type') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** زر بأيقونة كبيرة ونص */
export function btn(iconName, label, onclick, opts = {}) {
  const b = h('button.btn' + (opts.cls ? '.' + opts.cls.split(' ').join('.') : ''), {
    type: 'button', title: opts.title || label, 'aria-label': opts.title || label, onclick, ...(opts.attrs || {})
  });
  b.innerHTML = (iconName ? icon(iconName, opts.size || 24) : '') + (label && !opts.iconOnly ? `<span>${label}</span>` : '');
  if (opts.iconOnly) b.classList.add('icon-only');
  if (opts.testid) b.dataset.testid = opts.testid;
  return b;
}

export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }

let toastTimer;
export function toast(msg, kind = 'info', ms = 2600) {
  let t = document.getElementById('toast');
  if (!t) { t = h('div#toast', { role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.textContent = msg;
  t.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, ms);
}

/** نافذة حوار. يعيد {el, close} */
export function modal(title, body, actions = [], opts = {}) {
  const back = h('div.modal-back');
  const box = h('div.modal' + (opts.wide ? '.wide' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const close = () => { back.remove(); opts.onClose?.(); };
  const head = h('div.modal-head', h('h2', title), btn('close', 'إغلاق', close, { iconOnly: true }));
  const foot = h('div.modal-foot', actions.map((a) => {
    const b = btn(a.icon, a.label, () => a.onClick?.(close), { cls: a.primary ? 'primary' : '', testid: a.testid });
    return b;
  }));
  box.append(head, h('div.modal-body', body), actions.length ? foot : '');
  back.append(box);
  back.addEventListener('pointerdown', (e) => { if (e.target === back && !opts.sticky) close(); });
  document.body.append(back);
  return { el: box, close, back };
}

export function confirmBox(title, text, okLabel = 'نعم') {
  return new Promise((resolve) => {
    let done = false;
    const m = modal(title, h('p', text), [
      { label: 'إلغاء', icon: 'close', onClick: (c) => { done = true; resolve(false); c(); } },
      { label: okLabel, icon: 'check', primary: true, testid: 'confirm-ok', onClick: (c) => { done = true; resolve(true); c(); } }
    ], { onClose: () => { if (!done) resolve(false); } });
    return m;
  });
}

export function promptBox(title, value = '', label = '') {
  return new Promise((resolve) => {
    let done = false;
    const input = h('input.text', { value, 'aria-label': label || title });
    const m = modal(title, h('label.field', label ? h('span', label) : '', input), [
      { label: 'إلغاء', icon: 'close', onClick: (c) => { done = true; resolve(null); c(); } },
      { label: 'موافق', icon: 'check', primary: true, testid: 'prompt-ok', onClick: (c) => { done = true; resolve(input.value); c(); } }
    ], { onClose: () => { if (!done) resolve(null); } });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { done = true; resolve(input.value); m.close(); } });
    setTimeout(() => input.select(), 30);
  });
}

/** قائمة اختيار منبثقة بأزرار كبيرة */
export function menu(anchor, items) {
  const back = h('div.menu-back');
  const box = h('div.menu', { role: 'menu' });
  for (const it of items) {
    if (it === '-') { box.append(h('hr')); continue; }
    const b = btn(it.icon, it.label, () => { back.remove(); it.onClick(); }, { cls: (it.danger ? 'danger ' : '') + 'menu-item', testid: it.testid });
    if (it.disabled) b.disabled = true;
    box.append(b);
  }
  back.append(box);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) back.remove(); });
  document.body.append(back);
  const r = anchor.getBoundingClientRect();
  const bw = box.offsetWidth, bh = box.offsetHeight;
  let left = Math.min(window.innerWidth - bw - 8, Math.max(8, r.right - bw));
  let top = r.bottom + 6;
  if (top + bh > window.innerHeight - 8) top = Math.max(8, r.top - bh - 6);
  box.style.left = left + 'px';
  box.style.top = top + 'px';
  return back;
}

export function fmtTime(t, fps) {
  const s = Math.floor(t);
  const f = Math.round((t - s) * fps);
  return `${s}:${String(Math.min(f, fps - 1)).padStart(2, '0')}`;
}

export function pickFiles(accept, multiple = true) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    inp.addEventListener('change', () => { resolve([...inp.files]); inp.remove(); });
    document.body.append(inp);
    inp.click();
  });
}
