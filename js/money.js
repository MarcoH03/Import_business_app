// Dinero: tarjeta de EE. UU. y efectivo en Cuba, gastos del negocio, trabajadores y sus pagos, y movimientos.
import { icon } from './icons.js';
import {
  state, uid, num, round2, usd, today, fmtDate, fmtTime, fmtDateLong, ACCOUNTS, ACC_SHORT, BIZ, MOVE_TYPES, balance, moneyEntries, worker, workerName, sum,
} from './store.js';
import { $, esc, openPage, topPage, confirmDlg, promptDlg, snackbar, seg, chips, tf, inp, numInp, li, kv, secTitle, emptyState, contactBtns } from './ui.js';
import { commit } from './core.js';
import { orderDetail } from './orders.js';
import { remitDetail } from './remit.js';

export const ACC_ICON = { tarjeta: 'card', efectivo: 'cash' };
const BIZ_CHOICES = Object.entries({ encargos: 'Encargos', remesas: 'Remesas', ambos: 'Los dos' });

/* ======================= gastos ======================= */
export function expenseEditor(id = null, prefill = {}) {
  const S = state.settings;
  const ex = id ? state.expenses.find((e) => e.id === id) : null;
  const d = ex
    ? { date: ex.date, cat: ex.cat, amount: String(ex.amount), account: ex.account, biz: ex.biz, note: ex.note || '' }
    : { date: today(), cat: S.expenseCats[0], amount: '', account: 'efectivo', biz: 'ambos', note: '', ...prefill };
  openPage({
    title: ex ? 'Editar gasto' : 'Nuevo gasto',
    data: d,
    action: { label: 'Guardar', act: 'save' },
    menu: ex ? () => [{ label: 'Eliminar gasto', ic: 'trash', danger: true, value: () => deleteRec('expenses', ex.id, 'Gasto eliminado') }] : null,
    render: () => `
      <div class="form">
        <div class="lbl">¿En qué se gastó?</div>
        ${chips('cat', [...S.expenseCats.map((c) => [c, c]), ['__new', '+ Nueva']], d.cat)}
        ${tf('Importe', numInp('amount', d.amount, 'placeholder="0"'), { suffix: 'USD' })}
        <div class="lbl">¿Con qué se pagó?</div>
        ${seg('account', Object.entries(ACCOUNTS), d.account)}
        <div class="lbl">¿De qué negocio es?</div>
        ${seg('biz', BIZ_CHOICES, d.biz)}
        <div class="tf-help">«Los dos» se reparte a medias entre encargos y remesas.</div>
        ${tf('Fecha', `<input class="inp" type="date" data-bind="date" value="${d.date}">`)}
        ${tf('Detalle (opcional)', inp('note', d.note, 'placeholder="Ej. recarga del teléfono del negocio"'))}
      </div>`,
    acts: {
      chip: async (el, ev, pg) => {
        if (el.dataset.v === '__new') {
          const c = await promptDlg({ title: 'Nueva categoría de gasto', placeholder: 'Ej. Alquiler' });
          if (c && c.trim()) {
            if (!S.expenseCats.includes(c.trim())) S.expenseCats.push(c.trim());
            d.cat = c.trim();
          }
        } else d.cat = el.dataset.v;
        pg.render();
      },
      seg: (el, ev, pg) => {
        d[el.dataset.name] = el.dataset.v;
        pg.render();
      },
      save: async (el, ev, pg) => {
        if (num(d.amount) <= 0) return snackbar('Escribe el importe del gasto');
        const cur = ex ? state.expenses.find((e) => e.id === ex.id) : null;
        const rec = cur || { id: uid(), ts: Date.now() };
        Object.assign(rec, { date: d.date, cat: d.cat, amount: round2(num(d.amount)), account: d.account, biz: d.biz, note: d.note.trim() });
        if (!cur) state.expenses.push(rec);
        await commit();
        snackbar(`Gasto guardado · ${usd(rec.amount)}`);
        pg.close();
      },
    },
  });
}

export const expenseRow = (e) => li({
  act: 'expense', attrs: `data-id="${e.id}"`, ic: 'receipt', color: 'amber',
  title: esc(e.cat), sub: [fmtDate(e.date), e.note ? esc(e.note) : '', ACC_SHORT[e.account], BIZ[e.biz] || ''].filter(Boolean).join(' · '),
  right: `<b>−${usd(e.amount)}</b>`,
});

async function deleteRec(col, id, msg) {
  if (!(await confirmDlg('Eliminar', '¿Seguro que quieres eliminarlo?', 'Eliminar', true))) return;
  state[col] = state[col].filter((x) => x.id !== id);
  await commit();
  topPage()?.close();
  snackbar(msg);
}

/* ======================= trabajadores ======================= */
export function workersPage() {
  openPage({
    title: 'Trabajadores',
    nav: 'back',
    live: true,
    render: () => {
      const list = state.workers.filter((w) => !w.archived);
      const month = today().slice(0, 7);
      return `
        ${list.length ? `<div class="list">${list.map((w) => {
          const paid = sum(state.payroll.filter((p) => p.workerId === w.id && p.date.startsWith(month)), (p) => p.amount);
          return li({ act: 'worker', attrs: `data-id="${w.id}"`, ic: 'work', color: 'purple', title: esc(w.name), sub: esc([w.role, w.phone].filter(Boolean).join(' · ')), right: paid ? `<small>este mes</small><b>${usd(paid)}</b>` : '' });
        }).join('')}</div>` : emptyState('work', 'Añade a las personas que trabajan para el negocio (mensajeros, ayudantes…) para anotar lo que se les paga.')}
        <button class="btn tonal block" data-act="newWorker">${icon('plus')} Añadir trabajador</button>
        ${secTitle('Últimos pagos')}
        <div class="list">${payrollList(state.payroll, 30)}</div>`;
    },
    footer: () => (state.workers.some((w) => !w.archived) ? `<button class="btn filled block lg" data-act="pay">${icon('cash')} Pagar a un trabajador</button>` : ''),
    acts: {
      worker: (el) => workerPage(el.dataset.id),
      newWorker: () => workerEditor(),
      pay: () => payrollEditor(),
      payroll: (el) => payrollEditor(el.dataset.id),
    },
  });
}

export function payrollList(list, max = 50) {
  const l = [...list].sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts).slice(0, max);
  return l.length ? l.map(payrollRow).join('') : '<div class="empty-li">Sin pagos anotados</div>';
}
export const payrollRow = (p) => li({
  act: 'payroll', attrs: `data-id="${p.id}"`, ic: 'work', color: 'purple',
  title: esc(workerName(p.workerId)), sub: [fmtDate(p.date), p.note ? esc(p.note) : '', ACC_SHORT[p.account], BIZ[p.biz] || ''].filter(Boolean).join(' · '),
  right: `<b>−${usd(p.amount)}</b>`,
});

function workerPage(id) {
  openPage({
    title: 'Trabajador',
    nav: 'back',
    live: true,
    menu: () => [
      { label: 'Editar', ic: 'edit', value: () => workerEditor(id) },
      { label: 'Ya no trabaja con nosotros', ic: 'trash', danger: true, value: async () => {
        if (!(await confirmDlg('Quitar trabajador', 'Se oculta de la lista; sus pagos anteriores se conservan.', 'Quitar', true))) return;
        worker(id).archived = true;
        await commit();
        topPage()?.close();
      } },
    ],
    render: () => {
      const w = worker(id);
      if (!w) return emptyState('work', 'No existe.');
      const pays = state.payroll.filter((p) => p.workerId === id);
      const month = today().slice(0, 7);
      return `
        <div class="hero"><div class="hero-main"><span class="hero-n sm">${esc(w.name)}</span><span class="hero-u">${esc(w.role || 'Trabajador')}${w.phone ? ` · ${esc(w.phone)}` : ''}</span></div>
          <div class="hero-badges"><span class="badge">Este mes: ${usd(sum(pays.filter((p) => p.date.startsWith(month)), (p) => p.amount))}</span><span class="badge">Total: ${usd(sum(pays, (p) => p.amount))}</span></div>
          ${contactBtns(w.phone)}</div>
        <button class="btn filled block lg" data-act="pay">${icon('cash')} Pagarle</button>
        ${secTitle('Pagos')}<div class="list">${payrollList(pays, 100)}</div>`;
    },
    acts: { pay: () => payrollEditor(null, { workerId: id }), payroll: (el) => payrollEditor(el.dataset.id) },
  });
}

function workerEditor(id = null) {
  const w = id ? worker(id) : null;
  const d = { name: w?.name || '', role: w?.role || '', phone: w?.phone || '' };
  openPage({
    title: w ? 'Editar trabajador' : 'Nuevo trabajador',
    data: d,
    action: { label: 'Guardar', act: 'save' },
    render: () => `<div class="form">
      ${tf('Nombre', inp('name', d.name, 'autocapitalize="words"'))}
      ${tf('Qué hace (opcional)', inp('role', d.role, 'placeholder="Ej. mensajero, entrega remesas"'))}
      ${tf('Teléfono (opcional)', inp('phone', d.phone, 'type="tel" inputmode="tel"'))}
    </div>`,
    acts: {
      save: async (el, ev, pg) => {
        if (!d.name.trim()) return snackbar('Escribe el nombre');
        const cur = id ? worker(id) : null;
        const rec = cur || { id: uid(), ts: Date.now(), archived: false };
        Object.assign(rec, { name: d.name.trim(), role: d.role.trim(), phone: d.phone.trim() });
        if (!cur) state.workers.push(rec);
        await commit();
        pg.close();
      },
    },
  });
}

export function payrollEditor(id = null, prefill = {}) {
  const ex = id ? state.payroll.find((p) => p.id === id) : null;
  const ws = state.workers.filter((w) => !w.archived || w.id === ex?.workerId);
  const d = ex
    ? { workerId: ex.workerId, amount: String(ex.amount), account: ex.account, biz: ex.biz, date: ex.date, note: ex.note || '' }
    : { workerId: ws[0]?.id || '', amount: '', account: 'efectivo', biz: 'ambos', date: today(), note: '', ...prefill };
  if (!ws.length) return workerEditor();
  openPage({
    title: ex ? 'Editar pago' : 'Pago a trabajador',
    data: d,
    action: { label: 'Guardar', act: 'save' },
    menu: ex ? () => [{ label: 'Eliminar pago', ic: 'trash', danger: true, value: () => deleteRec('payroll', ex.id, 'Pago eliminado') }] : null,
    render: () => `<div class="form">
      <div class="lbl">¿A quién?</div>
      ${chips('workerId', ws.map((w) => [w.id, w.name]), d.workerId)}
      ${tf('Importe', numInp('amount', d.amount, 'placeholder="0"'), { suffix: 'USD' })}
      <div class="lbl">¿Con qué se pagó?</div>
      ${seg('account', Object.entries(ACCOUNTS), d.account)}
      <div class="lbl">¿Para qué negocio trabajó?</div>
      ${seg('biz', BIZ_CHOICES, d.biz)}
      ${tf('Fecha', `<input class="inp" type="date" data-bind="date" value="${d.date}">`)}
      ${tf('Detalle (opcional)', inp('note', d.note, 'placeholder="Ej. semana del 1 al 7, 5 entregas"'))}
    </div>`,
    acts: {
      chip: (el, ev, pg) => {
        d.workerId = el.dataset.v;
        pg.render();
      },
      seg: (el, ev, pg) => {
        d[el.dataset.name] = el.dataset.v;
        pg.render();
      },
      save: async (el, ev, pg) => {
        if (num(d.amount) <= 0) return snackbar('Escribe el importe');
        const cur = ex ? state.payroll.find((p) => p.id === ex.id) : null;
        const rec = cur || { id: uid(), ts: Date.now() };
        Object.assign(rec, { workerId: d.workerId, amount: round2(num(d.amount)), account: d.account, biz: d.biz, date: d.date, note: d.note.trim() });
        if (!cur) state.payroll.push(rec);
        await commit();
        pg.close();
        snackbar(`Pagado ${usd(rec.amount)} a ${workerName(rec.workerId)}`);
      },
    },
  });
}

/* ======================= cuenta: movimientos ======================= */
export function accountPage(account = 'efectivo') {
  openPage({
    title: 'Dinero',
    nav: 'back',
    live: true,
    data: { account },
    render: (pg) => {
      const a = pg.data.account;
      const list = moneyEntries(a).slice(0, 120);
      return `
        <div class="money-cards">
          ${['tarjeta', 'efectivo'].map((x) => `<button class="money-card ${a === x ? 'on' : ''}" data-act="acc" data-v="${x}">${icon(ACC_ICON[x])}<span>${ACCOUNTS[x]}</span><b>${usd(balance(x))}</b></button>`).join('')}
        </div>
        <div class="btn-row wrap pad-h">
          <button class="btn tonal sm" data-act="mv" data-type="aporte">${icon('inbox')} Añadir</button>
          <button class="btn tonal sm" data-act="mv" data-type="retiro">${icon('outbox')} Retirar</button>
          <button class="btn tonal sm" data-act="mv" data-type="traspaso">${icon('swap')} Pasar</button>
          <button class="btn tonal sm" data-act="mv" data-type="ajuste">${icon('clipboard')} Contar</button>
        </div>
        ${secTitle(`Movimientos · ${ACCOUNTS[a]}`)}
        <div class="list">${list.length ? list.map(entryRow).join('') : '<div class="empty-li">Sin movimientos</div>'}</div>
        <p class="hint">Los saldos se calculan con todo lo anotado: compras, envíos, cobros, remesas, gastos y pagos. «Contar» corrige el saldo con lo que hay de verdad.</p>`;
    },
    acts: {
      acc: (el, ev, pg) => {
        pg.data.account = el.dataset.v;
        pg.render();
      },
      mv: (el, ev, pg) => moveEditor(pg.data.account, el.dataset.type),
      ...entryActs,
    },
  });
}

export const entryRow = (e) => li({
  act: `e_${e.kind}`, attrs: `data-id="${e.id}"`,
  ic: e.amount >= 0 ? 'inbox' : 'outbox', color: e.amount >= 0 ? 'green' : 'red',
  title: esc(e.label), sub: `${fmtDate(e.date)}${e.note ? ' · ' + esc(e.note) : ''}`,
  right: `<b class="${e.amount >= 0 ? 'green-t' : ''}">${e.amount >= 0 ? '+' : ''}${usd(e.amount)}</b>`,
});
export const entryActs = {
  e_order: (el) => orderDetail(el.dataset.id),
  e_remit: (el) => remitDetail(el.dataset.id),
  e_expense: (el) => expenseEditor(el.dataset.id),
  e_payroll: (el) => payrollEditor(el.dataset.id),
  e_move: (el) => {
    const m = state.moves.find((x) => x.id === el.dataset.id);
    if (m) moveEditor(m.account, m.type, m.id);
  },
};

export function moveEditor(account, type, id = null) {
  const ex = id ? state.moves.find((m) => m.id === id) : null;
  const base = (acc) => balance(acc) - (ex && ex.account === acc && ex.type !== 'traspaso' ? num(ex.amount) : 0);
  const d = ex
    ? { account: ex.account, to: ex.to || (ex.account === 'tarjeta' ? 'efectivo' : 'tarjeta'), type: ex.type, amount: String(Math.abs(ex.amount)), counted: String(round2(base(ex.account) + num(ex.amount))), note: ex.note || '', date: ex.date }
    : { account, to: account === 'tarjeta' ? 'efectivo' : 'tarjeta', type, amount: '', counted: '', note: '', date: today() };
  const TITLES = { aporte: 'Añadir dinero', retiro: 'Retirar dinero', traspaso: 'Pasar dinero', ajuste: 'Contar el dinero', inicial: 'Dinero inicial', cierre: 'Diferencia del cierre' };
  openPage({
    title: TITLES[d.type] || 'Movimiento',
    data: d,
    action: d.type === 'cierre' ? null : { label: 'Guardar', act: 'save' },
    menu: ex ? () => [{ label: 'Eliminar movimiento', ic: 'trash', danger: true, value: () => deleteRec('moves', ex.id, 'Movimiento eliminado') }] : null,
    render: () => `
      <div class="form">
        <div class="lbl">${d.type === 'traspaso' ? 'Sale de' : 'Cuenta'}</div>
        ${seg('account', Object.entries(ACCOUNTS), d.account)}
        ${d.type === 'traspaso' ? `<div class="tf-help">Llega a: <b>${ACCOUNTS[d.account === 'tarjeta' ? 'efectivo' : 'tarjeta']}</b>. Úsalo si alguien lleva efectivo a EE. UU. y lo deposita, o al revés. Las remesas ya hacen este cambio solas.</div>` : ''}
        ${d.type === 'ajuste' ? `
          <div class="card">${kv('La app calcula', usd(base(d.account)))}</div>
          ${tf('Dinero que hay de verdad', numInp('counted', d.counted, 'placeholder="0"'), { suffix: 'USD' })}
          <div class="tf-help" data-adj></div>`
        : d.type === 'cierre' ? `<div class="card">${kv('Diferencia', usd(ex.amount))}</div><p class="hint">Se anotó al guardar el cierre del ${fmtDate(ex.date)}. Para cambiarla, vuelve a hacer ese cierre.</p>`
        : tf('Importe', numInp('amount', d.amount, 'placeholder="0"'), { suffix: 'USD' })}
        ${tf('Fecha', `<input class="inp" type="date" data-bind="date" value="${d.date}">`)}
        ${tf('Motivo (opcional)', inp('note', d.note, `placeholder="${{ retiro: 'Ej. reparto de ganancias', aporte: 'Ej. dinero puesto por los socios', traspaso: 'Ej. lo depositó mi hermano' }[d.type] || ''}"`))}
      </div>`,
    afterRender: (pg) => showAdj(pg),
    afterBind: (pg, key) => key === 'counted' && showAdj(pg),
    acts: {
      seg: (el, ev, pg) => {
        d[el.dataset.name] = el.dataset.v;
        pg.render();
      },
      save: async (el, ev, pg) => {
        let amount;
        if (d.type === 'ajuste') {
          if (d.counted === '') return snackbar('Escribe el dinero que hay');
          amount = round2(num(d.counted) - base(d.account));
          if (!amount && !ex) {
            snackbar('Coincide, no hace falta ajustar');
            return pg.close();
          }
        } else {
          if (num(d.amount) <= 0) return snackbar('Escribe el importe');
          amount = d.type === 'retiro' ? -Math.abs(num(d.amount)) : Math.abs(num(d.amount));
        }
        const cur = ex ? state.moves.find((m) => m.id === ex.id) : null;
        const rec = cur || { id: uid(), ts: Date.now() };
        Object.assign(rec, { date: d.date, account: d.account, type: d.type, amount: round2(amount), note: d.note.trim() });
        if (d.type === 'traspaso') rec.to = d.account === 'tarjeta' ? 'efectivo' : 'tarjeta';
        if (!cur) state.moves.push(rec);
        await commit();
        snackbar('Guardado');
        pg.close();
      },
    },
  });
  function showAdj(pg) {
    const el = $('[data-adj]', pg.body);
    if (!el) return;
    const diff = round2(num(d.counted) - base(d.account));
    el.innerHTML = d.counted === '' ? '' : !diff ? 'Coincide con lo calculado' : diff > 0 ? `Sobran ${usd(diff)}` : `<span class="red-t">Faltan ${usd(-diff)}</span>`;
  }
}

