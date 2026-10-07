// Pantallas principales (pestañas), navegación y arranque.
import { icon } from './icons.js';
import {
  state, local, init, today, fmtDate, fmtDateLong, fmtTime, usd, lbs, pct, num, round2, norm, digits, parseDate, addDays, sum,
  ACCOUNTS, ACC_SHORT, STATUS_LABEL, balance, moneyEntries, pending, upcoming, orderCalc, orderTitle, clientLabel, transitStats,
  isOpen, activeRemits, pendingRemits, remitCalc, stats, buckets, periodRange, closureOutdated, APP_VERSION, BIZ, saveLocal,
} from './store.js';
import { $, esc, seg, chips, li, kv, secTitle, emptyState, menuSheet, histPush, histBack, onBackWithoutLayer, openLayers, snackbar, isIOS } from './ui.js';
import { ctx, onRefresh, refresh, onCommit, shareText } from './core.js';
import { resetSnapshot, onSyncChange, syncStatus, lastSyncLabel } from './sync.js';
import { orderEditor, orderDetail, orderRow, bulkShipPage, clientsPage, statusBadge, etaLine } from './orders.js';
import { remitEditor, remitDetail, remitRow, pendingText } from './remit.js';
import { expenseEditor, expenseRow, payrollEditor, payrollList, workersPage, accountPage, entryRow, entryActs, ACC_ICON } from './money.js';
import { closurePage } from './closure.js';
import { settingsPage, welcomePage, exportBackup, installApp, canInstall, onInstallChange, syncPage, runSync, checkNotifications } from './settings.js';

const TABS = [
  ['inicio', 'Inicio', 'home'],
  ['encargos', 'Encargos', 'pkg'],
  ['remesas', 'Remesas', 'send'],
  ['dinero', 'Dinero', 'wallet'],
  ['informes', 'Informes', 'chart'],
];
const vs = {
  encargos: { q: '', filter: 'activos' },
  remesas: { filter: 'pendientes', q: '' },
  dinero: { mode: 'gastos', month: today() },
  informes: { kind: 'mes', anchor: today(), tip: null },
};
const scrollPos = {};

/* ---------- piezas comunes ---------- */
function appbar(title, actions = '') {
  return `<header class="topbar"><h1>${esc(title)}</h1><div class="tb-actions">${actions}</div></header>`;
}
const tbBtn = (ic, act, label, cls = '') => `<button class="icon-btn ${cls}" data-act="${act}" aria-label="${esc(label)}">${icon(ic)}</button>`;
/** En iPhone el botón «+» va arriba; en Android, el botón flotante abajo. */
const addBtn = (act, label) => tbBtn('plus', act, label, 'ios-only');
const fab = (act, label) => `<button class="fab extended android-only" data-act="${act}">${icon('plus')}<span>${esc(label)}</span></button>`;
function syncChip() {
  if (!local.sync.enabled) return '';
  const err = !!local.sync.lastError;
  return `<button class="sync-chip ${syncStatus.busy ? 'busy' : err ? 'err' : ''}" data-act="syncNow" aria-label="Sincronizar">${icon(err ? 'cloudOff' : syncStatus.busy ? 'sync' : 'cloud')}</button>`;
}
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

/* ---------- INICIO ---------- */
function viewInicio() {
  const d = today();
  const st = stats(d, d);
  const pr = periodRange('mes', d);
  const mo = stats(pr.from, pr.to);
  const up = upcoming();
  const pend = pending();
  const closed = state.closures.find((c) => c.date === d);
  const backupOld = !local.sync.enabled && (!local.lastBackup || (parseDate(d) - parseDate(local.lastBackup)) / 864e5 >= 7);
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  const action = (ic, label, act, color) => `<button class="action" data-act="${act}"><span class="action-ic ${color}">${icon(ic)}</span><span>${label}</span></button>`;
  const card = balance('tarjeta');
  const cash = balance('efectivo');
  const late = [...up.toWarehouse, ...up.toCuba].filter((x) => x.days < 0);
  const soon = [...up.warehouseSoon, ...up.cubaSoon].filter((x) => x.days >= 0).sort((a, b) => a.date.localeCompare(b.date));
  const ts = transitStats();
  return `
    ${appbar(state.settings.business || 'Import Business', syncChip() + tbBtn('gear', 'settings', 'Ajustes'))}
    <div class="greet"><b>${hello}${local.user ? `, ${esc(local.user)}` : ''}</b><span>${fmtDateLong(d)}</span></div>
    ${canInstall() ? `<button class="banner blue" data-act="install">${icon('phone')}<span><b>Instala la app</b> en tu teléfono para abrirla desde un icono y usarla sin internet.</span>${icon('chevR')}</button>` : ''}
    ${local.sync.enabled && local.sync.lastError ? `<button class="banner red" data-act="sync">${icon('cloudOff')}<span><b>No se pudo sincronizar.</b> ${esc(local.sync.lastError)}</span>${icon('chevR')}</button>` : ''}
    <button class="card money-row" data-act="money">
      <span class="mr"><span>${icon('card')} Tarjeta</span><b>${usd(card)}</b></span>
      <span class="mr"><span>${icon('cash')} Efectivo</span><b>${usd(cash)}</b></span>
      <span class="mr total"><span>Total</span><b>${usd(card + cash)}</b></span>
    </button>
    <div class="actions">
      ${action('pkg', 'Encargo', 'newOrder', 'blue')}
      ${action('send', 'Remesa', 'newRemit', 'teal')}
      ${action('receipt', 'Gasto', 'newExpense', 'amber')}
      ${action('clipboard', 'Cierre', 'closure', 'purple')}
    </div>
    ${late.length ? `${secTitle(`<span class="red-t">Atrasados</span>`)}<div class="list">${late.map((x) => alertRow(x, true)).join('')}</div>` : ''}
    ${soon.length ? `${secTitle('Llegan pronto')}<div class="list">${soon.map((x) => alertRow(x)).join('')}</div>` : ''}
    ${up.inCuba.length || pend.remitsN || up.atWarehouse.length || pend.dueN ? `${secTitle('Pendiente')}<div class="list">
      ${up.inCuba.length ? li({ act: 'goFilter', attrs: 'data-f="cuba"', ic: 'pin', color: 'green', title: `${plural(up.inCuba.length, 'encargo', 'encargos')} en Cuba para entregar`, sub: esc(up.inCuba.slice(0, 4).map((x) => clientLabel(x.o.client)).join(', ')) }) : ''}
      ${pend.remitsN ? li({ act: 'goRemits', ic: 'send', color: 'teal', title: `${plural(pend.remitsN, 'remesa', 'remesas')} por entregar`, sub: cash < pend.remits ? `<span class="red-t">${icon('warning')}El efectivo (${usd(cash)}) no alcanza</span>` : 'Con dirección y teléfono', right: `<b>${usd(pend.remits)}</b>` }) : ''}
      ${up.atWarehouse.length ? li({ act: 'goFilter', attrs: 'data-f="almacen"', ic: 'store', color: 'purple', title: `${plural(up.atWarehouse.length, 'encargo', 'encargos')} en el almacén sin enviar`, sub: lbs(sum(up.atWarehouse, (o) => orderCalc(o).lb)) }) : ''}
      ${pend.dueN ? li({ act: 'goFilter', attrs: 'data-f="debe"', ic: 'cash', color: 'amber', title: 'Por cobrar a clientes', sub: plural(pend.dueN, 'encargo', 'encargos'), right: `<b>${usd(pend.due)}</b>` }) : ''}
    </div>` : ''}
    ${secTitle('Hoy')}
    <div class="kpis">
      <div class="kpi"><span>Ganancia neta</span><b class="${st.net < 0 ? 'red-t' : ''}">${usd(st.net)}</b><small class="dim">Encargos ${usd(st.netE)} · Remesas ${usd(st.netR)}</small></div>
      <div class="kpi"><span>Entró hoy</span><b>${usd(st.income.efectivo + st.income.tarjeta)}</b><small class="dim">Efectivo ${usd(st.income.efectivo)} · Tarjeta ${usd(st.income.tarjeta)}</small></div>
    </div>
    ${closed && closureOutdated(d)
      ? `<button class="banner amber" data-act="closure">${icon('warning')}<span>Hubo cambios después del cierre de las ${fmtTime(closed.ts)}. Toca para rehacerlo.</span>${icon('chevR')}</button>`
      : closed
      ? `<button class="banner green" data-act="closure">${icon('checkCircle')}<span>Cierre de hoy hecho a las ${fmtTime(closed.ts)}${closed.diff ? ` · ${closed.diff > 0 ? 'sobraron' : 'faltaron'} ${usd(Math.abs(closed.diff))}` : ''}.</span>${icon('chevR')}</button>`
      : `<button class="btn tonal block lg" data-act="closure">${icon('clipboard')} Hacer el cierre del día</button>`}
    ${secTitle(`Este mes · ${pr.label}`, '<button class="text-btn" data-act="goReports">Ver informes</button>')}
    <button class="card month-card" data-act="goReports">
      ${kv('Encargos', usd(mo.netE), mo.netE < 0 ? 'red' : '')}
      ${kv('Remesas', usd(mo.netR), mo.netR < 0 ? 'red' : '')}
      <div class="divider"></div>
      ${kv('Ganancia neta', usd(mo.net), mo.net < 0 ? 'red big' : 'green big')}
    </button>
    ${backupOld && (state.orders.length || state.remits.length) ? `<button class="banner" data-act="backup">${icon('shield')}<span>${local.lastBackup ? `Última copia de seguridad: ${fmtDate(local.lastBackup)}.` : 'Aún no has hecho una copia de seguridad.'} Toca para hacerla.</span>${icon('chevR')}</button>` : ''}
    <div class="spacer"></div>`;
}
function alertRow(x, late = false) {
  const toWh = x.o.status === 'comprado';
  return li({
    act: 'order', attrs: `data-id="${x.o.id}"`, ic: toWh ? 'store' : 'plane', color: late ? 'red' : x.days <= 0 ? 'green' : 'amber',
    title: `${toWh ? 'Al almacén' : 'A Cuba'}: ${esc(clientLabel(x.o.client))}`,
    sub: `${esc(orderTitle(x.o))} · ${esc(x.o.store)}`,
    right: `<b class="${late ? 'red-t' : ''}">${late ? `${-x.days} d tarde` : x.days === 0 ? 'hoy' : x.days === 1 ? 'mañana' : fmtDate(x.date)}</b>${x.auto ? '<small>aprox.</small>' : ''}`,
  });
}

/* ---------- ENCARGOS ---------- */
const FILTERS = [
  ['activos', 'Activos', (o) => isOpen(o)],
  ['pendiente', 'Por comprar', (o) => o.status === 'pendiente'],
  ['comprado', 'Hacia el almacén', (o) => o.status === 'comprado'],
  ['almacen', 'En el almacén', (o) => o.status === 'almacen'],
  ['enviado', 'Hacia Cuba', (o) => o.status === 'enviado'],
  ['cuba', 'En Cuba', (o) => o.status === 'cuba'],
  ['debe', 'Deben dinero', (o) => o.status !== 'cancelado' && o.status !== 'pendiente' && orderCalc(o).due > 0.004],
  ['entregado', 'Entregados', (o) => o.status === 'entregado'],
  ['cancelado', 'Cancelados', (o) => o.status === 'cancelado'],
  ['todos', 'Todos', () => true],
];
const ORDER_RANK = { cuba: 0, enviado: 1, almacen: 2, comprado: 3, pendiente: 4, entregado: 5, cancelado: 6 };
function ordersList() {
  const { q, filter } = vs.encargos;
  const n = norm(q);
  const dq = digits(q);
  const f = FILTERS.find((x) => x[0] === filter)?.[2] || (() => true);
  const ts = transitStats();
  const list = state.orders
    .filter(f)
    .filter((o) => !n || norm(`${o.client?.name} ${orderTitle(o)} ${o.store} ${o.tracking} ${o.storeOrder}`).includes(n) || (dq.length >= 3 && digits(o.client?.phone).includes(dq)))
    .sort((a, b) => ORDER_RANK[a.status] - ORDER_RANK[b.status] || (b.dates.delivered || b.dates.created || '').localeCompare(a.dates.delivered || a.dates.created || '') || b.ts - a.ts);
  if (!state.orders.length) return emptyState('pkg', 'Anota aquí cada encargo: quién lo pidió, qué compraste, cuánto pagaste y cuánto pesa. La app calcula el precio y te avisa cuando debe llegar.', '<button class="btn filled" data-act="newOrder">Nuevo encargo</button>');
  if (!list.length) return '<div class="empty-li">No hay encargos en esta lista</div>';
  const total = round2(sum(list, (o) => orderCalc(o).total));
  return `${filter === 'almacen' ? `<button class="btn filled block" data-act="bulkShip">${icon('plane')} Enviar a Cuba (${list.length})</button>` : ''}
    <div class="list-head">${plural(list.length, 'encargo', 'encargos')} · ${usd(total)}</div>
    <div class="list">${list.map((o) => orderRow(o, ts)).join('')}</div>`;
}
function viewEncargos() {
  const counts = Object.fromEntries(FILTERS.map(([k, , f]) => [k, state.orders.filter(f).length]));
  return `
    ${appbar('Encargos', tbBtn('users', 'clients', 'Clientes') + addBtn('newOrder', 'Nuevo encargo'))}
    <div class="search"><span>${icon('search')}</span><input type="search" data-input="orderQ" placeholder="Cliente, teléfono, producto o seguimiento" value="${esc(vs.encargos.q)}"></div>
    ${chips('orderFilter', FILTERS.filter(([k]) => counts[k] || k === 'activos' || k === vs.encargos.filter || k === 'todos').map(([k, l]) => [k, `${l}${counts[k] && k !== 'todos' ? ` · ${counts[k]}` : ''}`]), vs.encargos.filter)}
    <div id="order-list">${ordersList()}</div>
    <div class="spacer"></div>
    ${fab('newOrder', 'Nuevo encargo')}`;
}

/* ---------- REMESAS ---------- */
function remitList() {
  const R = vs.remesas;
  const n = norm(R.q);
  let list = R.filter === 'pendientes' ? pendingRemits() : R.filter === 'entregadas' ? activeRemits().filter((r) => r.deliveredAt) : state.remits;
  list = list.filter((r) => !n || norm(`${r.recipient} ${r.sender} ${r.address} ${r.phone}`).includes(n));
  list = [...list].sort((a, b) => (R.filter === 'pendientes' ? a.date.localeCompare(b.date) || a.ts - b.ts : (b.deliveredAt || b.date).localeCompare(a.deliveredAt || a.date) || b.ts - a.ts));
  if (list.length) return `<div class="list">${list.map(remitRow).join('')}</div>`;
  if (state.remits.length) return '<div class="empty-li">No hay remesas en esta lista</div>';
  return emptyState('send', 'Cuando alguien te transfiera a la tarjeta para que entregues efectivo en Cuba, anótalo aquí con la dirección. Al entregarlo, márcalo y la app pasa el dinero del efectivo a la tarjeta.', '<button class="btn filled" data-act="newRemit">Nueva remesa</button>');
}
function viewRemesas() {
  const R = vs.remesas;
  const pend = pendingRemits();
  const cash = balance('efectivo');
  const pendTotal = round2(sum(pend, (r) => r.amount));
  const pr = periodRange('mes', today());
  const mo = stats(pr.from, pr.to).R;
  return `
    ${appbar('Remesas', (pend.length ? tbBtn('share', 'sharePending', 'Compartir pendientes') : '') + addBtn('newRemit', 'Nueva remesa'))}
    <div class="kpis">
      <div class="kpi ${pendTotal > cash ? 'warn' : ''}"><span>Por entregar</span><b>${usd(pendTotal)}</b><small class="dim">${plural(pend.length, 'remesa', 'remesas')} · efectivo ${usd(cash)}</small></div>
      <div class="kpi"><span>Comisiones del mes</span><b>${usd(mo.commission)}</b><small class="dim">${plural(mo.count, 'entregada', 'entregadas')} · ${usd(mo.volume)}</small></div>
    </div>
    ${pendTotal > cash ? `<div class="banner amber">${icon('warning')}<span>El efectivo no alcanza para todas las entregas pendientes: faltan ${usd(pendTotal - cash)}.</span></div>` : ''}
    <div class="pad-h">${seg('remitFilter', [['pendientes', `Pendientes${pend.length ? ` (${pend.length})` : ''}`], ['entregadas', 'Entregadas'], ['todas', 'Todas']], R.filter)}</div>
    <div class="search mt"><span>${icon('search')}</span><input type="search" data-input="remitQ" placeholder="Nombre, dirección o teléfono" value="${esc(R.q)}"></div>
    <div id="remit-list">${remitList()}</div>
    <div class="spacer"></div>
    ${fab('newRemit', 'Nueva remesa')}`;
}

/* ---------- DINERO ---------- */
function viewDinero() {
  const g = vs.dinero;
  const p = pending();
  const pr = periodRange('mes', g.month);
  const inR = (x) => x.date >= pr.from && x.date <= pr.to;
  let body = '';
  if (g.mode === 'gastos') {
    const list = state.expenses.filter(inR).sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts);
    body = `${monthNav(pr, `Gastos: ${usd(sum(list, (e) => e.amount))}`)}
      ${list.length ? `<div class="list">${list.map(expenseRow).join('')}</div>` : emptyState('receipt', 'No hay gastos este mes. Anota recargas, transporte, embalaje, comisiones del banco o cualquier imprevisto.')}`;
  } else if (g.mode === 'pagos') {
    const list = state.payroll.filter(inR);
    body = `${monthNav(pr, `Pagado: ${usd(sum(list, (x) => x.amount))}`)}
      <div class="btn-row wrap pad-h"><button class="btn tonal sm" data-act="workers">${icon('users')} Trabajadores</button></div>
      <div class="list">${payrollList(list, 200)}</div>`;
  } else {
    const all = [...moneyEntries('tarjeta').map((e) => ({ ...e, acc: 'tarjeta' })), ...moneyEntries('efectivo').map((e) => ({ ...e, acc: 'efectivo' }))].filter(inR).sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts);
    body = `${monthNav(pr, `${all.length} movimientos`)}
      <div class="list">${all.length ? all.slice(0, 200).map((e) => entryRow({ ...e, label: `${e.label} · ${ACC_SHORT[e.acc]}` })).join('') : '<div class="empty-li">Sin movimientos</div>'}</div>`;
  }
  return `
    ${appbar('Dinero', addBtn('dineroAdd', 'Añadir'))}
    <div class="money-cards">
      ${['tarjeta', 'efectivo'].map((x) => `<button class="money-card" data-act="account" data-v="${x}">${icon(ACC_ICON[x])}<span>${ACCOUNTS[x]}</span><b>${usd(balance(x))}</b></button>`).join('')}
    </div>
    <div class="card">
      ${kv('Por cobrar a clientes', usd(p.due))}
      ${kv('Remesas por entregar (sale del efectivo)', usd(p.remits))}
      ${p.toReceive ? kv('Transferencias por llegar a la tarjeta', usd(p.toReceive)) : ''}
      ${kv('Envíos a Cuba aún por pagar (aprox.)', usd(p.ship), 'dim')}
    </div>
    <div class="pad-h">${seg('dineroMode', [['gastos', 'Gastos'], ['pagos', 'Trabajadores'], ['movs', 'Movimientos']], g.mode)}</div>
    ${body}
    <div class="spacer"></div>
    ${fab('dineroAdd', g.mode === 'pagos' ? 'Pagar' : g.mode === 'movs' ? 'Movimiento' : 'Nuevo gasto')}`;
}
function monthNav(pr, sub) {
  return `<div class="period-nav">
      <button class="icon-btn" data-act="month" data-d="prev" aria-label="Mes anterior">${icon('chevL')}</button>
      <div class="pn-l"><b>${pr.label}</b><span>${sub}</span></div>
      <button class="icon-btn" data-act="month" data-d="next" aria-label="Mes siguiente" ${pr.to >= today() ? 'disabled' : ''}>${icon('chevR')}</button>
    </div>`;
}

/* ---------- INFORMES ---------- */
function niceStep(max) {
  if (max <= 0) return 1;
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw);
}
const shortNum = (v) => (Math.abs(v) >= 1e3 ? `${+(v / 1e3).toFixed(1)}k` : String(Math.round(v)));

/** Columnas agrupadas: ganancia neta de encargos y de remesas por día o por mes. */
function chartSvg(bk) {
  const W = 360;
  const H = 190;
  const L = 34;
  const B = 22;
  const T = 8;
  const max = Math.max(0, ...bk.map((b) => Math.max(b.e, b.r)));
  const min = Math.min(0, ...bk.map((b) => Math.min(b.e, b.r)));
  const step = niceStep(Math.max(max, -min, 1));
  const top = Math.ceil(max / step) * step || step;
  const bot = min < 0 ? Math.floor(min / step) * step : 0;
  const y = (v) => T + ((top - v) / (top - bot)) * (H - T - B);
  const slot = (W - L) / bk.length;
  const bw = Math.max(2, Math.min(12, (slot - 4) / 2 - 1));
  const ticks = [];
  for (let v = bot; v <= top + 1e-9; v += step) ticks.push(v);
  const bar = (x, v, cls) => {
    if (!v) return '';
    const y0 = y(0);
    const y1 = y(v);
    const h = Math.abs(y0 - y1);
    const r = Math.min(4, h, bw / 2);
    if (v > 0) return `<path class="${cls}" d="M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + bw - r} Q${x + bw},${y1} ${x + bw},${y1 + r} V${y0} Z"/>`;
    return `<path class="${cls}" d="M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + bw - r} Q${x + bw},${y1} ${x + bw},${y1 - r} V${y0} Z"/>`;
  };
  const every = Math.ceil(bk.length / 12);
  const tip = vs.informes.tip;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ganancia neta de encargos y remesas">
    ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 5}" y="${y(v) + 3.5}" text-anchor="end">${shortNum(v)}</text>`).join('')}
    ${bk.map((b, i) => {
      const x = L + i * slot + (slot - (bw * 2 + 2)) / 2;
      return `<g>
        ${tip === i ? `<rect class="hl" x="${L + i * slot}" y="${T}" width="${slot}" height="${H - T - B}" rx="4"/>` : ''}
        ${bar(x, b.e, 's1')}${bar(x + bw + 2, b.r, 's2')}
        ${i % every === 0 ? `<text class="axis" x="${L + i * slot + slot / 2}" y="${H - 7}" text-anchor="middle">${esc(b.label)}</text>` : ''}
        <rect class="hit" data-act="tip" data-i="${i}" x="${L + i * slot}" y="0" width="${slot}" height="${H}"/>
      </g>`;
    }).join('')}
    <line class="base" x1="${L}" x2="${W}" y1="${y(0)}" y2="${y(0)}"/>
  </svg>`;
}

function viewInformes() {
  const I = vs.informes;
  const pr = periodRange(I.kind, I.anchor);
  const st = stats(pr.from, pr.to);
  const bk = I.kind === 'dia' ? [] : buckets(I.kind, pr.from, pr.to);
  const current = pr.from <= today() && pr.to >= today();
  const tip = I.tip !== null && bk[I.tip] ? bk[I.tip] : null;
  const E = st.E;
  const R = st.R;
  const ts = transitStats();
  const days = (x) => (x === null ? '—' : `${Math.round(x * 10) / 10} días`);
  const maxCat = Math.max(1, ...st.byCat.map((c) => c.v));
  const closures = state.closures.filter((c) => c.date >= pr.from && c.date <= pr.to).sort((a, b) => b.date.localeCompare(a.date));
  const hasData = E.count || R.count || st.expenses || st.payroll || E.cancelled;
  return `
    ${appbar('Informes')}
    <div class="pad-h">${seg('kind', [['dia', 'Día'], ['semana', 'Semana'], ['mes', 'Mes'], ['ano', 'Año']], I.kind)}</div>
    <div class="period-nav">
      <button class="icon-btn" data-act="period" data-d="prev" aria-label="Anterior">${icon('chevL')}</button>
      <label class="pn-l date-pick"><b>${esc(pr.label)}</b><span>${current ? { dia: 'Hoy', semana: 'Esta semana', mes: 'Este mes', ano: 'Este año' }[I.kind] : 'Toca para elegir fecha'}</span><input type="date" data-input="anchor" value="${I.anchor}"></label>
      <button class="icon-btn" data-act="period" data-d="next" aria-label="Siguiente" ${pr.to >= today() ? 'disabled' : ''}>${icon('chevR')}</button>
    </div>
    <div class="kpis">
      <div class="kpi hero-kpi ${st.net < 0 ? 'neg' : ''}"><span>Ganancia neta de los dos negocios</span><b>${usd(st.net)}</b></div>
      <div class="kpi"><span>Encargos</span><b class="${st.netE < 0 ? 'red-t' : ''}">${usd(st.netE)}</b><small class="dim">${plural(E.count, 'entregado', 'entregados')}</small></div>
      <div class="kpi"><span>Remesas</span><b class="${st.netR < 0 ? 'red-t' : ''}">${usd(st.netR)}</b><small class="dim">${plural(R.count, 'entregada', 'entregadas')}</small></div>
      <div class="kpi"><span>Entró en efectivo</span><b>${usd(st.income.efectivo)}</b></div>
      <div class="kpi"><span>Entró en la tarjeta</span><b>${usd(st.income.tarjeta)}</b></div>
    </div>
    ${bk.length ? `${secTitle(I.kind === 'ano' ? 'Ganancia neta por mes' : 'Ganancia neta por día')}
    <div class="card chart-card">
      <div class="legend"><span><i class="sw s1"></i>Encargos</span><span><i class="sw s2"></i>Remesas</span></div>
      <div class="chart-tip">${tip ? `<b>${esc(I.kind === 'ano' ? tip.label : fmtDateLong(tip.from))}</b> · Encargos ${usd(tip.e)} · Remesas ${usd(tip.r)}` : '<span class="dim">Toca una columna para ver sus cifras</span>'}</div>
      ${hasData ? chartSvg(bk) : '<div class="empty-li">No hay movimientos en este periodo</div>'}
      ${hasData ? `<details class="tbl-details"><summary>Ver como tabla</summary><table class="tbl"><thead><tr><th></th><th>Encargos</th><th>Remesas</th><th>Total</th></tr></thead><tbody>${bk.filter((b) => b.e || b.r).map((b) => `<tr><td>${esc(I.kind === 'ano' ? b.label : fmtDate(b.from))}</td><td>${usd(b.e)}</td><td>${usd(b.r)}</td><td>${usd(b.net)}</td></tr>`).join('')}</tbody></table></details>` : ''}
    </div>` : ''}
    ${secTitle('Encargos')}
    <div class="card">
      ${kv(`Cobrado por ${plural(E.count, 'encargo entregado', 'encargos entregados')}`, usd(E.revenue))}
      ${kv('− Precio de los productos', usd(E.products))}
      ${kv(`− Envío a Cuba (${lbs(E.lb)})`, usd(E.shipCost))}
      ${E.cancelled ? kv(`${plural(E.cancelled, 'cancelado', 'cancelados')}`, usd(E.cancelLoss), E.cancelLoss < 0 ? 'red' : '') : ''}
      ${kv('= Ganancia de los encargos', usd(E.profit), 'strong')}
      ${kv('   de ella: libras / % / otros cargos', `${usd(round2(E.weight - E.shipCost))} / ${usd(E.fee)} / ${usd(E.extras)}`, 'dim')}
      ${st.ex.encargos ? kv('− Gastos de encargos', usd(st.ex.encargos)) : ''}
      ${st.pay.encargos ? kv('− Trabajadores de encargos', usd(st.pay.encargos)) : ''}
      ${st.shared ? kv('− Mitad de lo compartido', usd(st.shared / 2)) : ''}
      <div class="divider"></div>
      ${kv('= Ganancia neta de encargos', usd(st.netE), st.netE >= 0 ? 'green big' : 'red big')}
    </div>
    ${secTitle('Remesas')}
    <div class="card">
      ${kv(`Entregado en efectivo (${plural(R.count, 'remesa', 'remesas')})`, usd(R.volume))}
      ${kv('Recibido en la tarjeta', usd(R.received))}
      ${kv('= Comisiones', usd(R.commission), 'strong')}
      ${R.cost ? kv('− Costo de las entregas', usd(R.cost)) : ''}
      ${st.ex.remesas ? kv('− Gastos de remesas', usd(st.ex.remesas)) : ''}
      ${st.pay.remesas ? kv('− Trabajadores de remesas', usd(st.pay.remesas)) : ''}
      ${st.shared ? kv('− Mitad de lo compartido', usd(st.shared / 2)) : ''}
      <div class="divider"></div>
      ${kv('= Ganancia neta de remesas', usd(st.netR), st.netR >= 0 ? 'green big' : 'red big')}
      ${R.volume ? kv('Comisión media', pct((R.commission / R.volume) * 100), 'dim') : ''}
    </div>
    ${secTitle('Dinero del periodo')}
    <div class="card">
      ${kv('Entró en la tarjeta', usd(st.income.tarjeta))}
      ${kv('Salió de la tarjeta', usd(st.out.tarjeta))}
      ${kv('Entró en efectivo', usd(st.income.efectivo))}
      ${kv('Salió del efectivo', usd(st.out.efectivo))}
      ${kv('Gastos / trabajadores', `${usd(st.expenses)} / ${usd(st.payroll)}`, 'dim')}
      ${st.bought.length ? kv(`Compras hechas (${st.bought.length})`, usd(st.boughtTotal), 'dim') : ''}
    </div>
    ${secTitle('Tiempos de llegada (todos los encargos)')}
    <div class="card">
      ${kv('Compra → almacén', days(ts.toWarehouse.avg), '')}
      ${kv('Almacén → Cuba', days(ts.whToCuba.avg))}
      ${kv('Envío → llegada a Cuba', days(ts.transit.avg))}
      ${kv('Compra → Cuba (total)', days(ts.total.avg), 'strong')}
      ${ts.stores.length ? `<div class="divider"></div>${ts.stores.map((s) => kv(`${esc(s.store)} → almacén (${s.n})`, `${Math.round(s.avg * 10) / 10} días <small class="dim">(${s.min}–${s.max})</small>`)).join('')}` : '<div class="dim">Aún no hay encargos con fechas de llegada.</div>'}
    </div>
    ${st.byCat.length ? `${secTitle('Gastos por tipo')}<div class="card">${st.byCat.map((c) => `<div class="hbar"><div class="hb-top"><span>${esc(c.cat)}</span><b>${usd(c.v)}</b></div><div class="hb-track"><i style="width:${(c.v / maxCat) * 100}%"></i></div></div>`).join('')}</div>` : ''}
    ${closures.length ? `${secTitle('Cierres del día')}<div class="list">${closures.map((c) => li({ act: 'closureOf', attrs: `data-date="${c.date}"`, ic: c.diff ? 'warning' : 'checkCircle', color: c.diff ? (c.diff < 0 ? 'red' : 'amber') : 'green', title: fmtDateLong(c.date), sub: `Neta ${usd(c.summary?.net || 0)}${c.diff ? ` · ${c.diff > 0 ? `sobraron ${usd(c.diff)}` : `faltaron ${usd(-c.diff)}`}` : ''}${c.by ? ` · ${esc(c.by)}` : ''}`, right: usd(c.summary?.cash ?? 0) })).join('')}</div>` : ''}
    <p class="hint">La ganancia de un encargo cuenta el día que se entrega; la de una remesa, cuando ya se recibió la transferencia y se entregó el efectivo. Los gastos y pagos de «los dos negocios» se reparten a medias.</p>
    <div class="spacer"></div>`;
}

/* ---------- render ---------- */
const VIEWS = { inicio: viewInicio, encargos: viewEncargos, remesas: viewRemesas, dinero: viewDinero, informes: viewInformes };

function render() {
  const v = $('#view');
  v.innerHTML = VIEWS[ctx.tab]();
  v.dataset.tab = ctx.tab;
  for (const b of document.querySelectorAll('.navbar button')) b.classList.toggle('on', b.dataset.tab === ctx.tab);
  const badge = $('.navbar [data-tab="remesas"] .nb-badge');
  if (badge) {
    const n = pendingRemits().length;
    badge.textContent = n || '';
    badge.hidden = !n;
  }
  onScroll();
}

let tabEntry = false;
function setTab(t, fromPop = false) {
  scrollPos[ctx.tab] = window.scrollY;
  if (t === ctx.tab) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  // En Android, «Atrás» desde otra pestaña vuelve a Inicio.
  if (t !== 'inicio' && !tabEntry) {
    histPush();
    tabEntry = true;
  } else if (t === 'inicio' && tabEntry) {
    tabEntry = false;
    if (!fromPop) histBack();
  }
  ctx.tab = t;
  render();
  window.scrollTo(0, scrollPos[t] || 0);
}
onBackWithoutLayer(() => {
  if (ctx.tab !== 'inicio') setTab('inicio', true);
});

function onScroll() {
  const tb = $('.topbar');
  if (tb) tb.classList.toggle('scrolled', window.scrollY > 4);
}

/* ---------- acciones ---------- */
const acts = {
  settings: () => settingsPage(),
  install: () => installApp(),
  backup: () => exportBackup(),
  sync: () => syncPage(),
  syncNow: () => (local.sync.lastError ? syncPage() : runSync({ manual: true })),
  money: () => setTab('dinero'),
  account: (el) => accountPage(el.dataset.v),
  newOrder: () => orderEditor(),
  newRemit: () => remitEditor(),
  newExpense: () => expenseEditor(),
  closure: () => closurePage(),
  closureOf: (el) => closurePage(el.dataset.date),
  order: (el) => orderDetail(el.dataset.id),
  remit: (el) => remitDetail(el.dataset.id),
  expense: (el) => expenseEditor(el.dataset.id),
  payroll: (el) => payrollEditor(el.dataset.id),
  workers: () => workersPage(),
  clients: () => clientsPage(),
  bulkShip: () => bulkShipPage(),
  goReports: () => setTab('informes'),
  goRemits: () => {
    vs.remesas.filter = 'pendientes';
    setTab('remesas');
  },
  goFilter: (el) => {
    vs.encargos.filter = el.dataset.f;
    vs.encargos.q = '';
    setTab('encargos');
  },
  sharePending: () => shareText(pendingText(pendingRemits()), 'Remesas por entregar'),
  dineroAdd: async () => {
    const m = vs.dinero.mode;
    if (m === 'gastos') return expenseEditor();
    if (m === 'pagos') return payrollEditor();
    const a = await menuSheet({
      title: 'Movimiento de dinero',
      actions: [
        { label: 'Añadir dinero', sub: 'Dinero que ponen los socios', ic: 'inbox', value: () => import('./money.js').then((x) => x.moveEditor('efectivo', 'aporte')) },
        { label: 'Retirar dinero', sub: 'Reparto de ganancias u otros', ic: 'outbox', value: () => import('./money.js').then((x) => x.moveEditor('efectivo', 'retiro')) },
        { label: 'Pasar entre tarjeta y efectivo', ic: 'swap', value: () => import('./money.js').then((x) => x.moveEditor('efectivo', 'traspaso')) },
        { label: 'Contar el dinero', sub: 'Corregir el saldo con lo que hay', ic: 'clipboard', value: () => import('./money.js').then((x) => x.moveEditor('efectivo', 'ajuste')) },
      ],
    });
    a?.();
  },
  ...entryActs,
  chip: (el) => {
    const { name, v } = el.dataset;
    if (name === 'orderFilter') vs.encargos.filter = v;
    render();
  },
  seg: (el) => {
    const { name, v } = el.dataset;
    if (name === 'remitFilter') vs.remesas.filter = v;
    if (name === 'dineroMode') vs.dinero.mode = v;
    if (name === 'kind') {
      vs.informes.kind = v;
      vs.informes.tip = null;
    }
    render();
  },
  month: (el) => {
    const pr = periodRange('mes', vs.dinero.month);
    vs.dinero.month = el.dataset.d === 'prev' ? pr.prev : pr.next;
    render();
  },
  period: (el) => {
    const pr = periodRange(vs.informes.kind, vs.informes.anchor);
    vs.informes.anchor = el.dataset.d === 'prev' ? pr.prev : pr.next;
    vs.informes.tip = null;
    render();
  },
  tip: (el) => {
    const i = +el.dataset.i;
    vs.informes.tip = vs.informes.tip === i ? null : i;
    render();
  },
};

function bindEvents() {
  document.addEventListener('click', (ev) => {
    if (ev.target.closest('.page-wrap, .overlay')) return;
    const tabBtn = ev.target.closest('.navbar button');
    if (tabBtn) return setTab(tabBtn.dataset.tab);
    const el = ev.target.closest('[data-act]');
    if (el && !el.disabled && acts[el.dataset.act]) acts[el.dataset.act](el, ev);
  });
  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.closest('.page-wrap, .overlay')) return;
    const k = el.dataset.input;
    if (k === 'orderQ') {
      vs.encargos.q = el.value;
      $('#order-list').innerHTML = ordersList();
    } else if (k === 'remitQ') {
      vs.remesas.q = el.value;
      $('#remit-list').innerHTML = remitList();
    }
  });
  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.input === 'anchor' && el.value) {
      vs.informes.anchor = el.value;
      vs.informes.tip = null;
      render();
    }
  });
  window.addEventListener('scroll', onScroll, { passive: true });
}

function buildShell() {
  document.getElementById('app').innerHTML = '<main id="view"></main>';
  const nav = document.createElement('nav');
  nav.className = 'navbar';
  nav.innerHTML = TABS.map(([id, label, ic]) => `<button data-tab="${id}"><span class="nb-ic">${icon(ic)}${id === 'remesas' ? '<i class="nb-badge" hidden></i>' : ''}</span><span>${label}</span></button>`).join('');
  document.body.appendChild(nav);
}

/* ---------- service worker (uso sin conexión y avisos) ---------- */
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(nw);
      });
    });
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    location.reload();
  });
}
function showUpdate(worker) {
  const el = document.createElement('button');
  el.className = 'update-bar';
  el.innerHTML = `${icon('download')}<span>Hay una nueva versión de la app. Toca para actualizar.</span>`;
  el.onclick = () => worker.postMessage('skipWaiting');
  document.body.appendChild(el);
}

/* ---------- sincronización automática ---------- */
let syncTimer = null;
function autoSync(delay = 0) {
  if (!local.sync.enabled || !local.sync.auto) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => runSync({
    // No se cambian los datos mientras alguien está rellenando un formulario: se reintenta luego.
    beforeApply: () => {
      if (openLayers()) {
        autoSync(30e3);
        return false;
      }
      return true;
    },
  }), delay);
}

/* ---------- arranque ---------- */
(async () => {
  await init();
  resetSnapshot();
  buildShell();
  onRefresh(render);
  onCommit(() => autoSync(4000));
  onSyncChange(() => {
    const c = $('.sync-chip');
    if (c) c.outerHTML = syncChip();
  });
  bindEvents();
  render();
  registerSW();
  onInstallChange(() => ctx.tab === 'inicio' && render());
  navigator.storage?.persist?.().catch(() => {});
  if (!local.onboarded) welcomePage();
  autoSync(800);
  checkNotifications();
  setInterval(() => document.visibilityState === 'visible' && autoSync(), 3 * 60e3);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refresh();
      autoSync(500);
      checkNotifications();
    }
  });
  window.addEventListener('online', () => autoSync(1000));
  window.__ib = { state: () => state, local: () => local, ctx, refresh, version: APP_VERSION, ios: isIOS() };
})();
