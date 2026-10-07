// Componentes de interfaz que se adaptan al teléfono: Material Design 3 en Android y estilo iOS en iPhone.
// Las pantallas, hojas, diálogos y avisos tienen el mismo HTML; cambian la cabecera, las animaciones y el CSS.
// El botón «Atrás» de Android (y el gesto de volver) cierra la capa de arriba.
import { icon } from './icons.js';

/* ---------- plataforma: la decide index.html antes de pintar (?ui=ios|android para probar) ---------- */
export const isIOS = () => document.documentElement.classList.contains('ios');
export function setPlatform(p) {
  try {
    if (p === 'auto') localStorage.removeItem('ib-ui');
    else localStorage.setItem('ib-ui', p);
  } catch {
    /* sin almacenamiento */
  }
  location.reload();
}
export function platformPref() {
  try {
    return localStorage.getItem('ib-ui') || 'auto';
  } catch {
    return 'auto';
  }
}
export const detectedIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export function setTheme(t) {
  try {
    if (t === 'auto') localStorage.removeItem('ib-theme');
    else localStorage.setItem('ib-theme', t);
  } catch {
    /* sin almacenamiento */
  }
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}
export function themePref() {
  try {
    return localStorage.getItem('ib-theme') || 'auto';
  } catch {
    return 'auto';
  }
}

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}
export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

export function vibrate(ms = 12) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* sin vibración */
  }
}

/* ---------- historial: el botón Atrás de Android cierra capas ---------- */
const layers = [];
let skipPops = 0;
let queuedPushes = 0;
let noLayerBack = () => false;

export function histPush() {
  if (skipPops > 0) queuedPushes++;
  else history.pushState({ gp: 1 }, '');
}
export function histBack() {
  if (queuedPushes > 0) {
    queuedPushes--;
    return;
  }
  skipPops++;
  history.back();
}
/** Qué hacer con «Atrás» cuando no hay capas abiertas (p. ej. volver a Inicio). */
export const onBackWithoutLayer = (f) => (noLayerBack = f);

window.addEventListener('popstate', () => {
  if (skipPops > 0) {
    skipPops--;
    if (skipPops === 0) {
      while (queuedPushes > 0) {
        queuedPushes--;
        history.pushState({ gp: 1 }, '');
      }
    }
    return;
  }
  const top = layers[layers.length - 1];
  if (top) {
    if (top.dismissable === false) {
      history.pushState({ gp: 1 }, '');
      return;
    }
    top.dismiss(true);
    return;
  }
  noLayerBack();
});

function addLayer(layer) {
  layers.push(layer);
  histPush();
  syncScrim();
}
function removeLayer(layer, fromPop) {
  const i = layers.indexOf(layer);
  if (i < 0) return;
  layers.splice(i, 1);
  if (!fromPop) histBack();
  syncScrim();
}
function syncScrim() {
  document.documentElement.classList.toggle('has-layer', layers.length > 0);
  const pages = layers.filter((l) => l.kind === 'page');
  pages.forEach((p, i) => p.el.classList.toggle('behind', i < pages.length - 1));
}
export const openLayers = () => layers.length;

/* ---------- pantallas a pantalla completa (diálogos de formulario) ---------- */
export const pages = [];

/**
 * opts: { title, nav: 'close'|'back', action: {label, act, disabled} | (page)=>…, menu: (page)=>[...],
 *         render(page), footer(page), acts, onInput(page, el, ev), afterBind(page, key, el),
 *         onClose(page, result), data, live, cls, dismissable }
 */
export function openPage(opts) {
  const wrap = document.createElement('div');
  wrap.className = `page-wrap ${opts.nav === 'back' ? 'push' : 'modal'} ${opts.cls || ''}`;
  wrap.innerHTML = `<section class="page" role="dialog" aria-modal="true"><header class="appbar"></header><div class="page-body"></div><footer class="page-foot"></footer></section>`;
  const page = {
    kind: 'page',
    el: wrap,
    opts,
    data: opts.data || {},
    head: $('.appbar', wrap),
    body: $('.page-body', wrap),
    foot: $('.page-foot', wrap),
    dismissable: opts.dismissable,
    render() {
      const st = page.body.scrollTop;
      page.renderHead();
      page.body.innerHTML = opts.render(page);
      page.renderFoot();
      page.body.scrollTop = st;
      opts.afterRender?.(page);
    },
    renderHead() {
      const a = typeof opts.action === 'function' ? opts.action(page) : opts.action;
      const title = typeof opts.title === 'function' ? opts.title(page) : opts.title;
      const menuBtn = opts.menu ? `<button class="icon-btn" data-act="__menu" aria-label="Más opciones">${icon('more')}</button>` : '';
      const actBtn = a ? `<button class="text-btn ${a.tonal ? 'tonal' : ''} strong" data-act="${a.act}" ${a.disabled ? 'disabled' : ''}>${esc(a.label)}</button>` : '';
      if (isIOS()) {
        // iOS: «‹ Atrás» o «Cancelar» a la izquierda, título centrado y la acción en negrita a la derecha.
        const left = opts.nav === 'back' ? `${icon('chevL')}<span>${esc(opts.backLabel || 'Atrás')}</span>` : `<span>${a ? 'Cancelar' : 'Cerrar'}</span>`;
        page.head.innerHTML = `<button class="nav-l" data-act="__close">${left}</button><h2>${esc(title)}</h2><div class="nav-r">${menuBtn}${actBtn}</div>`;
        return;
      }
      page.head.innerHTML = `
        <button class="icon-btn" data-act="__close" aria-label="${opts.nav === 'back' ? 'Atrás' : 'Cerrar'}">${icon(opts.nav === 'back' ? 'back' : 'close')}</button>
        <h2>${esc(title)}</h2>${menuBtn}${actBtn}`;
    },
    renderFoot() {
      const f = opts.footer?.(page) || '';
      page.foot.innerHTML = f;
      page.foot.hidden = !f;
    },
    dismiss(fromPop = false) {
      page.close(undefined, fromPop);
    },
    close(result, fromPop = false) {
      if (page.closed) return;
      page.closed = true;
      wrap.classList.remove('open');
      const i = pages.indexOf(page);
      if (i >= 0) pages.splice(i, 1);
      removeLayer(page, fromPop);
      setTimeout(() => wrap.remove(), 300);
      opts.onClose?.(page, result);
    },
  };
  wrap.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || !wrap.contains(el) || el.disabled) return;
    const act = el.dataset.act;
    if (act === '__close') return page.close();
    if (act === '__menu') {
      const v = await menuSheet({ actions: opts.menu(page) });
      return v?.();
    }
    if (opts.acts?.[act]) opts.acts[act](el, ev, page);
  });
  const onInput = (ev) => {
    const el = ev.target;
    if (el.dataset.bind) {
      const v = el.type === 'checkbox' ? el.checked : el.value;
      setPath(page.data, el.dataset.bind, v);
      opts.afterBind?.(page, el.dataset.bind, el, ev);
    }
    opts.onInput?.(page, el, ev);
  };
  wrap.addEventListener('input', onInput);
  wrap.addEventListener('change', (ev) => {
    if (ev.target.type === 'checkbox' || ev.target.tagName === 'SELECT' || ev.target.type === 'date') onInput(ev);
  });
  if (isIOS()) enableSwipe(page);
  document.body.appendChild(wrap);
  pages.push(page);
  addLayer(page);
  page.render();
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
  return page;
}

export const topPage = () => pages[pages.length - 1];

/** iOS: deslizar desde el borde izquierdo vuelve atrás; en las hojas, bajar la cabecera las cierra. */
function enableSwipe(page) {
  const panel = $('.page', page.el);
  const push = page.opts.nav === 'back';
  let start = null;
  let d = 0;
  panel.addEventListener('touchstart', (e) => {
    if (page.dismissable === false) return;
    const t = e.touches[0];
    const ok = push ? t.clientX < 28 : !!e.target.closest('.appbar') && !e.target.closest('button');
    if (!ok) return;
    start = { x: t.clientX, y: t.clientY };
    d = 0;
    panel.style.transition = 'none';
  }, { passive: true });
  panel.addEventListener('touchmove', (e) => {
    if (!start) return;
    const t = e.touches[0];
    d = Math.max(0, push ? t.clientX - start.x : t.clientY - start.y);
    panel.style.transform = push ? `translateX(${d}px)` : `translateY(${d}px)`;
  }, { passive: true });
  panel.addEventListener('touchend', () => {
    if (!start) return;
    start = null;
    panel.style.transition = '';
    panel.style.transform = '';
    if (d > (push ? 90 : 120)) page.close();
  });
}

/* ---------- superposiciones: diálogos y hojas inferiores ---------- */
function overlay(cls, html, dismissable = true, onDismiss = () => {}) {
  const el = document.createElement('div');
  el.className = 'overlay ' + cls;
  el.innerHTML = html;
  document.body.appendChild(el);
  const layer = {
    kind: 'overlay',
    el,
    dismissable,
    dismiss: (fromPop) => {
      close(fromPop);
      onDismiss();
    },
  };
  const close = (fromPop = false) => {
    if (layer.closed) return;
    layer.closed = true;
    removeLayer(layer, fromPop);
    el.classList.remove('open');
    setTimeout(() => el.remove(), 250);
  };
  layer.close = close;
  addLayer(layer);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('open')));
  return layer;
}

/** buttons: [{label, value, style: 'text'|'filled'|'danger'}] (la primera con value null/false = cancelar) */
export function dialog({ title, message = '', html = '', ic = null, input = null, buttons = [{ label: 'Aceptar', value: true }], dismissable = true }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const layer = overlay(
      'dialog-ov',
      `<div class="scrim" data-scrim></div>
      <div class="dialog" role="alertdialog">
        ${ic ? `<div class="dialog-ic">${icon(ic)}</div>` : ''}
        <h3 class="${ic ? 'center' : ''}">${esc(title)}</h3>
        ${message ? `<p>${esc(message).replace(/\n/g, '<br>')}</p>` : ''}
        ${html}
        ${input ? `<label class="tf dialog-tf">${input.label ? `<span class="tf-l">${esc(input.label)}</span>` : ''}<input class="inp" type="${input.type || 'text'}" inputmode="${input.inputmode || 'text'}" placeholder="${esc(input.placeholder || '')}" value="${esc(input.value ?? '')}" autocomplete="off">${input.suffix ? `<span class="tf-suf">${esc(input.suffix)}</span>` : ''}</label>${input.help ? `<div class="tf-help">${esc(input.help)}</div>` : ''}` : ''}
        <div class="dialog-btns">
          ${buttons.map((b, i) => `<button data-i="${i}" class="${b.style === 'filled' ? 'btn filled sm' : b.style === 'danger' ? 'text-btn danger' : 'text-btn'}">${esc(b.label)}</button>`).join('')}
        </div>
      </div>`,
      dismissable,
      () => finish(input ? null : buttons[0]?.value ?? null),
    );
    const el = layer.el;
    const inp = $('.dialog input', el);
    if (inp) setTimeout(() => { inp.focus(); inp.select(); }, 260);
    el.addEventListener('click', (ev) => {
      if (ev.target.dataset.scrim !== undefined) {
        if (dismissable) layer.dismiss(false);
        return;
      }
      const b = ev.target.closest('button[data-i]');
      if (!b) return;
      const btn = buttons[+b.dataset.i];
      layer.close();
      finish(input ? (btn.value === null || btn.value === false ? null : inp.value) : btn.value);
    });
    inp?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        const okIdx = buttons.findIndex((b) => b.value !== null && b.value !== false);
        el.querySelector(`button[data-i="${okIdx}"]`)?.click();
      }
    });
  });
}

export const confirmDlg = (title, message, ok = 'Aceptar', danger = false) =>
  dialog({ title, message, buttons: [{ label: 'Cancelar', value: false }, { label: ok, value: true, style: danger ? 'danger' : 'text' }] });

export const promptDlg = ({ title, message = '', value = '', label = '', placeholder = '', inputmode = 'text', suffix = '', help = '', ok = 'Aceptar' }) =>
  dialog({ title, message, input: { value, label, placeholder, inputmode, suffix, help }, buttons: [{ label: 'Cancelar', value: null }, { label: ok, value: true }] });

/** Hoja inferior con acciones: [{label, value, ic, danger, sub}] → value | null */
export function menuSheet({ title = '', actions = [] }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const layer = overlay(
      'bs-ov',
      `<div class="scrim" data-scrim></div>
      <div class="bsheet"><div class="handle"></div>
        ${title ? `<div class="bs-title">${esc(title)}</div>` : ''}
        <div class="bs-group">${actions.map((a, i) => `<button class="bs-item ${a.danger ? 'danger' : ''}" data-i="${i}">${a.ic ? icon(a.ic) : ''}<span class="grow"><span class="t">${esc(a.label)}</span>${a.sub ? `<span class="s">${esc(a.sub)}</span>` : ''}</span></button>`).join('')}</div>
        <button class="bs-cancel" data-cancel>Cancelar</button>
      </div>`,
      true,
      () => finish(null),
    );
    layer.el.addEventListener('click', (ev) => {
      if (ev.target.dataset.scrim !== undefined || ev.target.closest('[data-cancel]')) return layer.dismiss(false);
      const b = ev.target.closest('button[data-i]');
      if (!b) return;
      layer.close();
      finish(actions[+b.dataset.i].value);
    });
  });
}

let snackTimer;
export function snackbar(msg, { action = '', onAction = null, duration = 3200 } = {}) {
  let el = $('#snackbar');
  if (!el) {
    el = document.createElement('div');
    el.id = 'snackbar';
    document.body.appendChild(el);
  }
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="text-btn inv">${esc(action)}</button>` : ''}`;
  el.classList.add('show');
  const b = $('button', el);
  if (b) {
    b.onclick = () => {
      el.classList.remove('show');
      onAction?.();
    };
  }
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => el.classList.remove('show'), action ? duration + 1800 : duration);
}

/* ---------- selector con búsqueda ---------- */
/** items: [{value, label, sub, right}], addNew: {label, handler(query) → value|null} */
export function pickFromList({ title, items, addNew = null, selected = null, searchPlaceholder = 'Buscar' }) {
  return new Promise((resolve) => {
    let done = false;
    const strip = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const listHtml = (q) => {
      const n = strip(q.trim());
      const vis = items.filter((it) => !n || strip(`${it.label} ${it.sub || ''}`).includes(n));
      return `
        ${addNew ? `<button class="li link" data-act="new">${icon('plus')}<span class="grow"><span class="t">${esc(addNew.label)}${q ? ` «${esc(q)}»` : ''}</span></span></button>` : ''}
        ${vis.length ? vis.map((it) => `
          <button class="li" data-act="pick" data-v="${esc(it.value)}">
            <span class="grow"><span class="t">${esc(it.label)}</span>${it.sub ? `<span class="s">${it.sub}</span>` : ''}</span>
            ${it.right ? `<span class="r">${it.right}</span>` : ''}
            ${selected === it.value ? `<span class="ok">${icon('check')}</span>` : ''}
          </button>`).join('') : '<div class="empty-li">Sin resultados</div>'}`;
    };
    openPage({
      title,
      nav: 'back',
      data: { q: '' },
      render: (p) => `
        <div class="search"><span>${icon('search')}</span><input type="search" data-search placeholder="${esc(searchPlaceholder)}" value="${esc(p.data.q)}" autocomplete="off"></div>
        <div class="list-flat" data-results>${listHtml(p.data.q)}</div>`,
      onInput: (p, el) => {
        if (el.matches('[data-search]')) {
          p.data.q = el.value;
          $('[data-results]', p.body).innerHTML = listHtml(el.value);
        }
      },
      acts: {
        pick: (el, ev, p) => {
          const it = items.find((x) => String(x.value) === el.dataset.v);
          done = true;
          resolve(it ? it.value : null);
          p.close();
        },
        new: async (el, ev, p) => {
          const v = await addNew.handler(p.data.q.trim());
          if (v != null) {
            done = true;
            resolve(v);
            p.close();
          }
        },
      },
      onClose: () => {
        if (!done) resolve(null);
      },
    });
  });
}

/* ---------- fragmentos de HTML reutilizables ---------- */
export function seg(name, options, value, act = 'seg') {
  return `<div class="seg ${options.length > 3 ? 'many' : ''}" role="radiogroup">${options
    .map(([v, label]) => `<button type="button" class="${String(v) === String(value) ? 'on' : ''}" data-act="${act}" data-name="${name}" data-v="${esc(v)}">${String(v) === String(value) ? icon('check') : ''}<span>${esc(label)}</span></button>`)
    .join('')}</div>`;
}

export function chips(name, options, value, act = 'chip') {
  return `<div class="chips">${options
    .map(([v, label]) => `<button type="button" class="chip ${String(v) === String(value) ? 'on' : ''}" data-act="${act}" data-name="${name}" data-v="${esc(v)}">${String(v) === String(value) ? icon('check') : ''}${esc(label)}</button>`)
    .join('')}</div>`;
}

/** Campo de texto con contorno (Material). */
export const tf = (label, control, { help = '', suffix = '', cls = '' } = {}) =>
  `<label class="tf ${cls}"><span class="tf-l">${label}</span>${control}${suffix ? `<span class="tf-suf">${suffix}</span>` : ''}</label>${help ? `<div class="tf-help">${help}</div>` : ''}`;

export const inp = (bind, value, attrs = '') =>
  `<input class="inp" data-bind="${bind}" value="${esc(value ?? '')}" autocomplete="off" ${attrs}>`;

export const numInp = (bind, value, attrs = '') => inp(bind, value, `inputmode="decimal" ${attrs}`);

export function stepper(act, key, value) {
  return `<div class="stepper"><button type="button" data-act="${act}" data-k="${key}" data-d="-1" aria-label="Menos">${icon('minus')}</button><span>${esc(value)}</span><button type="button" data-act="${act}" data-k="${key}" data-d="1" aria-label="Más">${icon('plus')}</button></div>`;
}

export const toggle = (bind, checked) =>
  `<label class="switch"><input type="checkbox" data-bind="${bind}" ${checked ? 'checked' : ''}><span></span></label>`;

/** Elemento de lista. */
export function li({ act = '', attrs = '', ic = '', color = '', title, sub = '', right = '', chev = !!act, cls = '' }) {
  const tag = act ? 'button' : 'div';
  return `<${tag} class="li ${cls}" ${act ? `data-act="${act}"` : ''} ${attrs}>
    ${ic ? `<span class="li-ic ${color}">${icon(ic)}</span>` : ''}
    <span class="grow"><span class="t">${title}</span>${sub ? `<span class="s">${sub}</span>` : ''}</span>
    ${right ? `<span class="r">${right}</span>` : ''}
    ${chev ? icon('chevR', 'chev') : ''}
  </${tag}>`;
}

export const kv = (label, value, cls = '') => `<div class="kv ${cls}"><span>${label}</span><b>${value}</b></div>`;
export const secTitle = (t, right = '') => `<div class="sec-t"><span>${t}</span>${right ? `<span class="sec-r">${right}</span>` : ''}</div>`;
export const emptyState = (ic, text, btn = '') => `<div class="empty">${icon(ic)}<p>${text}</p>${btn}</div>`;

/** Botones para llamar, escribir por WhatsApp o abrir el mapa. */
export function contactBtns(phone, address = '') {
  const d = String(phone || '').replace(/[^\d+]/g, '');
  const wa = d.replace(/^\+/, '');
  // Números cubanos de 8 cifras: se añade el 53 para WhatsApp.
  const waNum = /^5\d{7}$/.test(wa) ? '53' + wa : wa;
  const out = [];
  if (d) out.push(`<a class="btn tonal sm" href="tel:${esc(d)}">${icon('phoneCall')} Llamar</a>`, `<a class="btn tonal sm" href="https://wa.me/${esc(waNum)}" target="_blank" rel="noopener">${icon('chat')} WhatsApp</a>`);
  if (address) out.push(`<a class="btn tonal sm" href="https://maps.google.com/?q=${encodeURIComponent(address + ', Cuba')}" target="_blank" rel="noopener">${icon('pin')} Mapa</a>`);
  return out.length ? `<div class="btn-row wrap">${out.join('')}</div>` : '';
}
