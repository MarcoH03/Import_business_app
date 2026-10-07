// Cierre del día: ganancia de cada negocio, dinero que entró, efectivo contado y lo que está por llegar.
import { icon } from './icons.js';
import {
  state, num, round2, usd, lbs, today, addDays, fmtDate, fmtDateLong, fmtTime, closureData, saveClosure, closureOutdated,
  orderTitle, clientLabel, orderCalc,
} from './store.js';
import { $, esc, openPage, dialog, snackbar, tf, inp, numInp, li, kv, secTitle } from './ui.js';
import { commit, shareText } from './core.js';
import { orderDetail } from './orders.js';
import { remitDetail } from './remit.js';

const n = (x, one, many) => `${x} ${x === 1 ? one : many}`;

export function closureText(d, counted = '', note = '') {
  const S = state.settings;
  const st = d.st;
  const L = [];
  L.push(`📦 *${S.business || 'Import Business'}* — Cierre del día`);
  L.push(fmtDateLong(d.date));
  L.push('');
  L.push(`📈 *Ganancia neta: ${usd(st.net)}*`);
  L.push(`  • Encargos: ${usd(st.netE)}${st.E.count ? ` (${n(st.E.count, 'entregado', 'entregados')})` : ''}`);
  L.push(`  • Remesas: ${usd(st.netR)}${st.R.count ? ` (${n(st.R.count, 'entregada', 'entregadas')}, ${usd(st.R.volume)})` : ''}`);
  if (st.expenses) L.push(`  Gastos: −${usd(st.expenses)}`);
  if (st.payroll) L.push(`  Trabajadores: −${usd(st.payroll)}`);
  L.push('');
  L.push('💰 *Entró hoy*');
  L.push(`  Efectivo: ${usd(st.income.efectivo)} · Tarjeta: ${usd(st.income.tarjeta)}`);
  const ev = d.events;
  const act = [];
  if (ev.bought.length) act.push(`${n(ev.bought.length, 'compra', 'compras')} (${usd(ev.bought.reduce((a, o) => a + orderCalc(o).products, 0))})`);
  if (ev.warehouse.length) act.push(`${ev.warehouse.length} al almacén`);
  if (ev.shipped.length) act.push(`${n(ev.shipped.length, 'enviado', 'enviados')} a Cuba`);
  if (ev.cuba.length) act.push(`${ev.cuba.length} llegaron a Cuba`);
  if (ev.delivered.length) act.push(`${n(ev.delivered.length, 'entregado', 'entregados')}`);
  if (act.length) L.push(`🛍️ Encargos: ${act.join(' · ')}`);
  if (d.remitsIn.length || d.remitsOut.length) L.push(`💸 Remesas: ${n(d.remitsIn.length, 'recibida', 'recibidas')} · ${n(d.remitsOut.length, 'entregada', 'entregadas')}`);
  L.push('');
  L.push('💵 *Efectivo en Cuba*');
  L.push(`  Al empezar: ${usd(d.opening)}`);
  if (d.cashIn) L.push(`  + Entró: ${usd(d.cashIn)}`);
  if (d.cashOut) L.push(`  − Salió: ${usd(d.cashOut)}`);
  if (d.moves) L.push(`  ${d.moves > 0 ? '+' : '−'} Movimientos: ${usd(Math.abs(d.moves))}`);
  L.push(`  Debería haber: *${usd(d.expected)}*`);
  if (counted !== '' && counted !== null && counted !== undefined) {
    const diff = round2(num(counted) - d.expected);
    L.push(`  Contado: ${usd(counted)}`);
    L.push(Math.abs(diff) < 0.01 ? '  ✅ Cuadra' : diff > 0 ? `  ⬆️ Sobran ${usd(diff)}` : `  ⚠️ Faltan ${usd(-diff)}`);
  }
  L.push(`💳 Tarjeta EE. UU.: *${usd(d.card)}*`);
  const up = d.up;
  const p = d.pend;
  L.push('');
  L.push('⏳ *Pendiente*');
  if (up.toWarehouse.length) {
    L.push(`  Por llegar al almacén: ${up.toWarehouse.length}`);
    for (const x of up.toWarehouse.slice(0, 8)) L.push(`   – ${clientLabel(x.o.client)}: ${orderTitle(x.o)} · ${fmtDate(x.date)}${x.days < 0 ? ' (atrasado)' : ''}`);
  }
  if (up.atWarehouse.length) L.push(`  En el almacén sin enviar: ${up.atWarehouse.length} (${lbs(up.atWarehouse.reduce((a, o) => a + orderCalc(o).lb, 0))})`);
  if (up.toCuba.length) {
    L.push(`  Por llegar a Cuba: ${up.toCuba.length}`);
    for (const x of up.toCuba.slice(0, 8)) L.push(`   – ${clientLabel(x.o.client)}: ${orderTitle(x.o)} · ${fmtDate(x.date)}${x.days < 0 ? ' (atrasado)' : ''}`);
  }
  if (up.inCuba.length) L.push(`  En Cuba por entregar: ${up.inCuba.length}`);
  if (up.toBuy.length) L.push(`  Por comprar: ${up.toBuy.length}`);
  if (p.remitsN) L.push(`  Remesas por entregar: ${p.remitsN} · ${usd(p.remits)}`);
  if (p.dueN) L.push(`  Por cobrar a clientes: ${usd(p.due)} (${p.dueN})`);
  if (!up.toWarehouse.length && !up.toCuba.length && !up.inCuba.length && !p.remitsN && !p.dueN) L.push('  Nada pendiente 🎉');
  if (note) {
    L.push('');
    L.push(`📝 ${note}`);
  }
  return L.join('\n');
}

export function closurePage(date = today()) {
  const saved = state.closures.find((c) => c.date === date);
  const d = { date, counted: saved?.counted != null ? String(saved.counted) : '', note: saved?.note || '' };
  openPage({
    title: 'Cierre del día',
    nav: 'back',
    data: d,
    render: (pg) => {
      const c = closureData(d.date);
      const st = c.st;
      const s = c.saved;
      const up = c.up;
      const pend = c.pend;
      return `
        <div class="day-nav">
          <button class="icon-btn" data-act="day" data-d="-1" aria-label="Día anterior">${icon('chevL')}</button>
          <label class="date-btn">${icon('calendar')}<span>${fmtDateLong(d.date)}</span><input type="date" data-bind="date" value="${d.date}"></label>
          <button class="icon-btn" data-act="day" data-d="1" aria-label="Día siguiente" ${d.date >= today() ? 'disabled' : ''}>${icon('chevR')}</button>
        </div>
        ${s ? (closureOutdated(d.date) ? `<div class="banner amber">${icon('warning')}<span>Hubo cambios después del cierre de las ${fmtTime(s.ts)}. Vuelve a guardarlo.</span></div>` : `<div class="banner green">${icon('checkCircle')}<span>Cierre guardado a las ${fmtTime(s.ts)}${s.by ? ` por ${esc(s.by)}` : ''}.</span></div>`) : ''}
        <div class="kpis">
          <div class="kpi hero-kpi ${st.net < 0 ? 'neg' : ''}"><span>Ganancia neta del día</span><b>${usd(st.net)}</b></div>
          <div class="kpi"><span>Encargos</span><b class="${st.netE < 0 ? 'red-t' : ''}">${usd(st.netE)}</b><small class="dim">${n(st.E.count, 'entregado', 'entregados')}</small></div>
          <div class="kpi"><span>Remesas</span><b class="${st.netR < 0 ? 'red-t' : ''}">${usd(st.netR)}</b><small class="dim">${n(st.R.count, 'entregada', 'entregadas')}</small></div>
        </div>
        ${secTitle('Ingresos del día')}
        <div class="card">
          ${kv('En efectivo (cobros a clientes)', usd(st.income.efectivo))}
          ${kv('En la tarjeta (remesas y otros)', usd(st.income.tarjeta))}
          ${st.expenses ? kv('Gastos', `−${usd(st.expenses)}`) : ''}
          ${st.payroll ? kv('Pagos a trabajadores', `−${usd(st.payroll)}`) : ''}
        </div>
        ${secTitle('Lo que pasó hoy')}
        <div class="list">
          ${evRow('card', 'blue', 'Compras hechas', c.events.bought, usd(c.events.bought.reduce((a, o) => a + orderCalc(o).products, 0)))}
          ${evRow('store', 'purple', 'Llegaron al almacén', c.events.warehouse)}
          ${evRow('plane', 'teal', 'Enviados a Cuba', c.events.shipped)}
          ${evRow('pin', 'green', 'Llegaron a Cuba', c.events.cuba)}
          ${evRow('checkCircle', 'green', 'Entregados', c.events.delivered, usd(st.E.revenue))}
          ${li({ ic: 'send', color: 'teal', title: 'Remesas', sub: `${n(c.remitsIn.length, 'transferencia recibida', 'transferencias recibidas')} · ${n(c.remitsOut.length, 'entregada', 'entregadas')}`, right: c.remitsOut.length ? usd(c.remitsOut.reduce((a, r) => a + num(r.amount), 0)) : '' })}
        </div>
        ${secTitle('Efectivo en Cuba')}
        <div class="card">
          ${kv('Al empezar el día', usd(c.opening))}
          ${kv('+ Entró', usd(c.cashIn))}
          ${kv('− Salió (remesas, gastos, pagos…)', usd(c.cashOut))}
          ${c.moves ? kv('± Añadido, retirado o pasado', usd(c.moves)) : ''}
          <div class="divider"></div>
          ${kv('Debería haber', usd(c.expected), 'big')}
        </div>
        <div class="form">
          ${tf('Efectivo contado (opcional)', numInp('counted', d.counted, `placeholder="${c.expected}"`), { suffix: 'USD' })}
          <div class="result-slot" data-result>${resultHtml(d.counted, c.expected)}</div>
        </div>
        <div class="card">${kv('Saldo de la tarjeta EE. UU.', usd(c.card), 'big')}${kv('Hoy entró / salió', `+${usd(c.cardIn)} / −${usd(c.cardOut)}`, 'dim')}</div>
        ${secTitle('Pendiente')}
        <div class="list">
          ${up.toWarehouse.length ? up.toWarehouse.slice(0, 6).map((x) => pendRow(x, 'store', 'Al almacén')).join('') : ''}
          ${up.toCuba.length ? up.toCuba.slice(0, 6).map((x) => pendRow(x, 'plane', 'A Cuba')).join('') : ''}
          ${up.atWarehouse.length ? li({ ic: 'store', color: 'purple', title: `${up.atWarehouse.length} en el almacén sin enviar`, sub: lbs(up.atWarehouse.reduce((a, o) => a + orderCalc(o).lb, 0)) }) : ''}
          ${up.inCuba.length ? li({ ic: 'pin', color: 'green', title: `${up.inCuba.length} en Cuba por entregar`, sub: esc(up.inCuba.map((x) => clientLabel(x.o.client)).join(', ')) }) : ''}
          ${pend.remitsN ? li({ ic: 'send', color: 'teal', title: `${pend.remitsN} remesa${pend.remitsN === 1 ? '' : 's'} por entregar`, right: `<b>${usd(pend.remits)}</b>` }) : ''}
          ${pend.dueN ? li({ ic: 'cash', color: 'amber', title: 'Por cobrar a clientes', sub: `${pend.dueN} encargo${pend.dueN === 1 ? '' : 's'}`, right: `<b>${usd(pend.due)}</b>` }) : ''}
          ${!up.toWarehouse.length && !up.toCuba.length && !up.inCuba.length && !pend.remitsN && !pend.dueN ? '<div class="empty-li">Nada pendiente</div>' : ''}
        </div>
        <div class="form">${tf('Nota del día (opcional)', inp('note', d.note, 'placeholder="Ej. el almacén cerró temprano"'))}</div>
        <p class="hint">${icon('info')} La ganancia de un encargo cuenta el día que se entrega; la de una remesa, cuando ya se recibió la transferencia y se entregó el efectivo. Los gastos marcados «los dos» van a medias.</p>`;
    },
    footer: () => `<div class="btn-row"><button class="btn tonal grow" data-act="share">${icon('share')} Compartir</button><button class="btn filled grow" data-act="save">${icon('check')} Guardar cierre</button></div>`,
    afterBind: (pg, key) => {
      if (key === 'date') {
        const sv = state.closures.find((x) => x.date === d.date);
        d.counted = sv?.counted != null ? String(sv.counted) : '';
        d.note = sv?.note || '';
        pg.render();
      }
      if (key === 'counted') $('[data-result]', pg.body).innerHTML = resultHtml(d.counted, closureData(d.date).expected);
    },
    acts: {
      day: (el, ev, pg) => {
        d.date = addDays(d.date, +el.dataset.d);
        const sv = state.closures.find((x) => x.date === d.date);
        d.counted = sv?.counted != null ? String(sv.counted) : '';
        d.note = sv?.note || '';
        pg.render();
      },
      order: (el) => orderDetail(el.dataset.id),
      remit: (el) => remitDetail(el.dataset.id),
      share: () => shareText(closureText(closureData(d.date), d.counted, d.note.trim()), 'Cierre del día'),
      save: async (el, ev, pg) => {
        const text = closureText(closureData(d.date), d.counted, d.note.trim());
        const rec = saveClosure(d.date, d.counted, d.note.trim(), text);
        await commit();
        pg.render();
        const go = await dialog({
          title: 'Cierre guardado',
          ic: 'checkCircle',
          message: rec.counted === null ? `Ganancia neta: ${usd(rec.summary.net)}.` : rec.diff ? `${rec.diff > 0 ? 'Sobraron' : 'Faltaron'} ${usd(Math.abs(rec.diff))} de efectivo. Se anotó la diferencia para que el saldo coincida con lo contado.` : 'El efectivo cuadra.',
          buttons: [{ label: 'Listo', value: false }, { label: 'Compartir', value: true, style: 'filled' }],
        });
        if (go) shareText(rec.text, 'Cierre del día');
      },
    },
  });
}

function evRow(ic, color, title, list, right = '') {
  return li({ ic, color: list.length ? color : 'gray', title: `${title}: ${list.length}`, sub: list.length ? esc(list.slice(0, 4).map((o) => clientLabel(o.client)).join(', ')) + (list.length > 4 ? '…' : '') : '', right: list.length ? right : '' });
}
function pendRow(x, ic, where) {
  const late = x.days < 0;
  return li({ act: 'order', attrs: `data-id="${x.o.id}"`, ic, color: late ? 'red' : x.days <= num(state.settings.warnDays) ? 'amber' : 'blue', title: `${where}: ${esc(clientLabel(x.o.client))}`, sub: esc(orderTitle(x.o)), right: `<small class="${late ? 'red-t' : ''}">${late ? 'atrasado' : fmtDate(x.date)}</small>` });
}
function resultHtml(counted, expected) {
  if (counted === '' || counted === null) return '';
  const diff = round2(num(counted) - expected);
  if (!diff) return `<div class="result ok">${icon('checkCircle')}<span>El efectivo cuadra</span></div>`;
  return diff > 0 ? `<div class="result amber">${icon('info')}<span>Sobran ${usd(diff)}</span></div>` : `<div class="result red">${icon('warning')}<span>Faltan ${usd(-diff)}</span></div>`;
}
