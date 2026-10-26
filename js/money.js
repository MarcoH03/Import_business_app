// Dinero: tarjeta de EE. UU. y efectivo en Cuba, gastos del negocio, trabajadores y sus pagos, y movimientos.
import { icon } from './icons.js';
import {
  state, uid, num, round2, usd, today, fmtDate, fmtTime, fmtDateLong, ACCOUNTS, ACC_SHORT, BIZ, MOVE_TYPES, balance, moneyEntries, worker, workerName, sum,
  PERSON_KINDS, personKind, isWorker, personCapital, capitalTotals, CAPITAL_TYPES,
} from './store.js';
import { $, esc, openPage, topPage, confirmDlg, promptDlg, snackbar, seg, chips, tf, inp, numInp, li, kv, secTitle, emptyState, contactBtns } from './ui.js';
import { commit } from './core.js';
import { orderDetail } from './orders.js';
import { remitDetail } from './remit.js';
import { flightDetail } from './flights.js';

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
/* ======================= personas: trabajadores e inversionistas ======================= */
const KIND_ICON = { trabajador: 'work', inversionista: 'trendUp', ambos: 'users' };
export function workersPage() {
  openPage({
    title: 'Trabajadores e inversionistas',
    nav: 'back',
    live: true,
    render: () => {
      const list = state.workers.filter((w) => !w.archived);
      const month = today().slice(0, 7);
      const tot = capitalTotals();
      return `
        ${tot.put ? `<div class="card">${kv('Aportado al negocio', usd(tot.put))}${kv('Devuelto', usd(tot.back))}<div class="divider"></div>${kv('Falta por devolver', usd(tot.owed), tot.owed > 0 ? 'amber big' : 'green big')}</div>` : ''}
        ${list.length ? `<div class="list">${list.map((w) => {
          const paid = sum(state.payroll.filter((p) => p.workerId === w.id && p.date.startsWith(month)), (p) => p.amount);
          const cap = personCapital(w.id);
          return li({
            act: 'worker', attrs: `data-id="${w.id}"`, ic: KIND_ICON[personKind(w)], color: personKind(w) === 'trabajador' ? 'purple' : 'blue', title: esc(w.name),
            sub: esc([PERSON_KINDS[personKind(w)], w.role, w.phone].filter(Boolean).join(' · ')),
            right: cap.owed > 0.004 ? `<small>se le debe</small><b class="amber-t">${usd(cap.owed)}</b>` : paid ? `<small>pagado este mes</small><b>${usd(paid)}</b>` : '',
          });
        }).join('')}</div>` : emptyState('users', 'Añade a quienes trabajan para el negocio (mensajeros, ayudantes…) y a quienes ponen dinero en él, para llevar lo que se les paga y lo que hay que devolverles.')}
        <button class="btn tonal block" data-act="newWorker">${icon('plus')} Añadir persona</button>
        ${secTitle('Últimos pagos a trabajadores')}
        <div class="list">${payrollList(state.payroll, 20)}</div>
        ${state.capital.length ? `${secTitle('Últimos aportes y devoluciones')}<div class="list">${capitalList(state.capital, 20)}</div>` : ''}`;
    },
    footer: () => (state.workers.some((w) => !w.archived) ? `<div class="btn-row"><button class="btn tonal grow" data-act="capital">${icon('inbox')} Aporte</button><button class="btn filled grow" data-act="pay">${icon('cash')} Pagar</button></div>` : ''),
    acts: {
      worker: (el) => workerPage(el.dataset.id),
      newWorker: () => workerEditor(),
      pay: () => payrollEditor(),
      payroll: (el) => payrollEditor(el.dataset.id),
      capital: () => capitalEditor(),
      cap: (el) => capitalEditor(el.dataset.id),
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
export function capitalList(list, max = 50) {
  const l = [...list].sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts).slice(0, max);
  return l.length ? l.map(capitalRow).join('') : '<div class="empty-li">Sin aportes anotados</div>';
}
export const capitalRow = (c) => li({
  act: 'cap', attrs: `data-id="${c.id}"`, ic: c.type === 'devolucion' ? 'outbox' : 'inbox', color: c.type === 'devolucion' ? 'amber' : 'blue',
  title: `${c.type === 'devolucion' ? 'Devuelto a' : 'Aporte de'} ${esc(workerName(c.personId))}`, sub: [fmtDate(c.date), c.note ? esc(c.note) : '', ACC_SHORT[c.account]].filter(Boolean).join(' · '),
  right: `<b>${c.type === 'devolucion' ? '−' : '+'}${usd(c.amount)}</b>`,
});

function workerPage(id) {
  openPage({
    title: 'Persona',
    nav: 'back',
    live: true,
    menu: () => [
      { label: 'Editar', ic: 'edit', value: () => workerEditor(id) },
      { label: 'Ya no está en el negocio', sub: 'Se oculta; lo anotado se conserva', ic: 'trash', danger: true, value: async () => {
        if (!(await confirmDlg('Quitar persona', 'Se oculta de la lista; sus pagos y aportes anteriores se conservan.', 'Quitar', true))) return;
        worker(id).archived = true;
        await commit();
        topPage()?.close();
      } },
    ],
    render: () => {
      const w = worker(id);
      if (!w) return emptyState('users', 'No existe.');
      const pays = state.payroll.filter((p) => p.workerId === id);
      const month = today().slice(0, 7);
      const cap = personCapital(id);
      const showCap = personKind(w) !== 'trabajador' || cap.list.length;
      return `
        <div class="hero"><div class="hero-main"><span class="hero-n sm">${esc(w.name)}</span><span class="hero-u">${esc([PERSON_KINDS[personKind(w)], w.role, w.phone].filter(Boolean).join(' · '))}</span></div>
          <div class="hero-badges">${isWorker(w) ? `<span class="badge">Pagado este mes: ${usd(sum(pays.filter((p) => p.date.startsWith(month)), (p) => p.amount))}</span>` : ''}${cap.owed > 0.004 ? `<span class="badge amber">Se le debe ${usd(cap.owed)}</span>` : ''}</div>
          ${contactBtns(w.phone)}</div>
        ${showCap ? `${secTitle('Dinero que ha puesto en el negocio')}
          <div class="card">${kv('Aportado', usd(cap.put))}${kv('Devuelto', usd(cap.back))}<div class="divider"></div>${kv('Falta por devolverle', usd(cap.owed), cap.owed > 0.004 ? 'amber big' : 'green big')}</div>
          <div class="btn-row pad-h"><button class="btn tonal grow" data-act="put">${icon('inbox')} Anotar aporte</button><button class="btn tonal grow" data-act="back" ${cap.owed <= 0 ? 'disabled' : ''}>${icon('outbox')} Devolverle</button></div>
          <div class="list mt">${capitalList(cap.list, 100)}</div>` : ''}
        ${isWorker(w) ? `${secTitle('Pagos por su trabajo', `<button class="text-btn" data-act="pay">Pagarle</button>`)}<div class="list">${payrollList(pays, 100)}</div>` : ''}
        ${!showCap ? `<button class="btn text block" data-act="put">${icon('inbox')} Anotar dinero que puso en el negocio</button>` : ''}`;
    },
    acts: {
      pay: () => payrollEditor(null, { workerId: id }),
      payroll: (el) => payrollEditor(el.dataset.id),
      put: () => capitalEditor(null, { personId: id, type: 'aporte' }),
      back: () => capitalEditor(null, { personId: id, type: 'devolucion', amount: String(personCapital(id).owed) }),
      cap: (el) => capitalEditor(el.dataset.id),
    },
  });
}

function workerEditor(id = null, prefill = {}) {
  const w = id ? worker(id) : null;
  const d = { name: w?.name || '', role: w?.role || '', phone: w?.phone || '', kind: w ? personKind(w) : 'trabajador', ...prefill };
  openPage({
    title: w ? 'Editar persona' : 'Nueva persona',
    data: d,
    action: { label: 'Guardar', act: 'save' },
    render: () => `<div class="form">
      ${tf('Nombre', inp('name', d.name, 'autocapitalize="words"'))}
      <div class="lbl">¿Qué es en el negocio?</div>
      ${seg('kind', [['trabajador', 'Trabajador'], ['inversionista', 'Inversionista'], ['ambos', 'Los dos']], d.kind)}
      <div class="tf-help">A un trabajador se le pagan sus servicios; a un inversionista se le anota el dinero que pone para devolvérselo después.</div>
      ${tf('Qué hace (opcional)', inp('role', d.role, 'placeholder="Ej. mensajero, socio, mi tío en Miami"'))}
      ${tf('Teléfono (opcional)', inp('phone', d.phone, 'type="tel" inputmode="tel"'))}
    </div>`,
    acts: {
      seg: (el, ev, pg) => {
        d.kind = el.dataset.v;
        pg.render();
      },
      save: async (el, ev, pg) => {
        if (!d.name.trim()) return snackbar('Escribe el nombre');
        const cur = id ? worker(id) : null;
        const rec = cur || { id: uid(), ts: Date.now(), archived: false };
        Object.assign(rec, { name: d.name.trim(), role: d.role.trim(), phone: d.phone.trim(), kind: d.kind });
        if (!cur) state.workers.push(rec);
        await commit();
        pg.close();
      },
    },
  });
}

/** Aporte de dinero al negocio o devolución a quien lo puso. Entra o sale de la cuenta, pero no es ganancia ni gasto. */
export function capitalEditor(id = null, prefill = {}) {
  const ex = id ? state.capital.find((c) => c.id === id) : null;
  const people = state.workers.filter((w) => !w.archived || w.id === ex?.personId);
  if (!people.length) return workerEditor(null, { kind: 'inversionista' });
  const firstInv = people.find((w) => personKind(w) !== 'trabajador') || people[0];
  const d = ex
    ? { personId: ex.personId, type: ex.type, amount: String(ex.amount), account: ex.account, date: ex.date, note: ex.note || '' }
    : { personId: firstInv.id, type: 'aporte', amount: '', account: 'tarjeta', date: today(), note: '', ...prefill };
  openPage({
    title: ex ? 'Editar' : d.type === 'devolucion' ? 'Devolver dinero' : 'Aporte al negocio',
    data: d,
    action: { label: 'Guardar', act: 'save' },
    menu: ex ? () => [{ label: 'Eliminar', ic: 'trash', danger: true, value: () => deleteRec('capital', ex.id, 'Eliminado') }] : null,
    render: () => {
      const cap = personCapital(d.personId);
      return `<div class="form">
      ${seg('type', Object.entries({ aporte: 'Puso dinero', devolucion: 'Se le devolvió' }), d.type)}
      <div class="lbl">¿Quién?</div>
      ${chips('personId', people.map((w) => [w.id, w.name]), d.personId)}
      <div class="card">${kv('Ha puesto', usd(cap.put))}${kv('Se le ha devuelto', usd(cap.back))}${kv('Falta por devolverle', usd(cap.owed), 'strong')}</div>
      ${tf('Importe', numInp('amount', d.amount, 'placeholder="0"'), { suffix: 'USD' })}
      <div class="lbl">${d.type === 'devolucion' ? '¿De dónde salió?' : '¿Dónde entró?'}</div>
      ${seg('account', Object.entries(ACCOUNTS), d.account)}
      ${tf('Fecha', `<input class="inp" type="date" data-bind="date" value="${d.date}">`)}
      ${tf('Detalle (opcional)', inp('note', d.note, `placeholder="${d.type === 'devolucion' ? 'Ej. primera parte' : 'Ej. para comprar mercancía'}"`))}
      <p class="hint">No cuenta como ganancia ni como gasto: solo entra o sale de la cuenta y suma o resta a lo que se le debe.</p>
    </div>`;
    },
    acts: {
      chip: (el, ev, pg) => {
        d.personId = el.dataset.v;
        pg.render();
      },
      seg: (el, ev, pg) => {
        d[el.dataset.name] = el.dataset.v;
        pg.render();
      },
      save: async (el, ev, pg) => {
        if (num(d.amount) <= 0) return snackbar('Escribe el importe');
        const cur = ex ? state.capital.find((c) => c.id === ex.id) : null;
        const rec = cur || { id: uid(), ts: Date.now() };
        Object.assign(rec, { personId: d.personId, type: d.type, amount: round2(num(d.amount)), account: d.account, date: d.date, note: d.note.trim() });
        if (!cur) state.capital.push(rec);
        await commit();
        pg.close();
        const owed = personCapital(rec.personId).owed;
        snackbar(`${rec.type === 'devolucion' ? 'Devuelto' : 'Aporte de'} ${usd(rec.amount)} · se le debe ${usd(owed)}`);
      },
    },
  });
}

export function payrollEditor(id = null, prefill = {}) {
  const ex = id ? state.payroll.find((p) => p.id === id) : null;
  const ws = state.workers.filter((w) => (!w.archived && isWorker(w)) || w.id === ex?.workerId);
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
  e_flight: (el) => flightDetail(el.dataset.id),
  e_capital: (el) => capitalEditor(el.dataset.id),
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

