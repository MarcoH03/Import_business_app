// Vuelos (y barcos): los productos que salen juntos del almacén hacia Cuba.
// Al anotar un vuelo se pone su peso real (con cajas y embalaje) y lo que se pagó por todo el envío:
// ese precio es el que sale de la cuenta y se reparte entre los productos según sus libras.
// Así se ve la ganancia real de cada vuelta, que va subiendo a medida que se entregan los encargos.
import { icon } from './icons.js';
import {
  state, uid, num, round2, usd, lbs, today, addDays, fmtDate, fmtDateLong, ACCOUNTS, ACC_SHORT, METHODS, methodOf, methodLabel,
  flight, tripName, nextFlightNumber, readyItems, flightCalc, syncOrderStatus, nextDeparture, cubaDays, clientLabel, orderTitle,
  itemLbs, order, itemShares,
} from './store.js';
import { $, esc, openPage, topPage, dialog, confirmDlg, snackbar, seg, tf, inp, numInp, li, kv, secTitle, emptyState, vibrate } from './ui.js';
import { commit } from './core.js';
import { orderDetail, statusBadge, departureLabel } from './orders.js';

/** Vuelos o barcos de un método que todavía no llegaron a Cuba (los más recientes primero). */
export const openTrips = (method) => state.flights.filter((f) => f.method === method && !f.arrived).sort((a, b) => b.date.localeCompare(a.date));

const tripWord = (m) => METHODS[m]?.trip.toLowerCase() || 'vuelo';
const key = (o, i) => `${o.id}:${i}`;

export function flightRow(f) {
  const c = flightCalc(f);
  const where = f.arrived ? `llegó el ${fmtDate(f.arrived)}` : f.date > today() ? `sale ${departureLabel(f.date)}` : 'en camino';
  return li({
    act: 'flight', attrs: `data-id="${f.id}"`, ic: METHODS[f.method]?.ic || 'plane', color: f.arrived ? 'green' : 'teal',
    title: `${esc(tripName(f))} <span class="dim">· ${methodLabel(f.method).toLowerCase()}</span>`,
    sub: `${fmtDate(f.date)} · ${c.items.length} producto${c.items.length === 1 ? '' : 's'} de ${c.orders.length} encargo${c.orders.length === 1 ? '' : 's'} · ${num(f.weight) ? lbs(f.weight) : lbs(c.lbs)}${c.hasCost ? ` · ${usd(f.cost)}` : ' · <span class="amber-t">falta el precio</span>'}<br>${where} · ${c.doneOrders.length} de ${c.orders.length} entregados`,
    right: `<b class="${c.doneProfit < 0 ? 'red-t' : 'green-t'}">${usd(c.doneProfit)}</b><small>de ${usd(c.profit)}</small>`,
  });
}

/* ======================= lista de vuelos ======================= */
export function flightsPage() {
  openPage({
    title: 'Vuelos y barcos',
    nav: 'back',
    live: true,
    render: () => {
      const list = [...state.flights].sort((a, b) => b.date.localeCompare(a.date) || num(b.n) - num(a.n));
      const ready = Object.keys(METHODS).map((m) => [m, readyItems(m)]).filter(([, l]) => l.length);
      return `
        ${ready.map(([m, l]) => `<button class="banner blue" data-act="new" data-m="${m}">${icon(METHODS[m].ic)}<span><b>${l.length} producto${l.length === 1 ? '' : 's'} en el almacén</b> para el próximo ${tripWord(m)} (${methodLabel(m).toLowerCase()}, ${departureLabel(nextDeparture(m))}). Toca para anotarlo.</span>${icon('chevR')}</button>`).join('')}
        ${list.length ? `${secTitle('En camino')}<div class="list">${list.filter((f) => !f.arrived).map(flightRow).join('') || '<div class="empty-li">Ninguno en camino</div>'}</div>
          ${secTitle('Llegados')}<div class="list">${list.filter((f) => f.arrived).map(flightRow).join('') || '<div class="empty-li">Todavía ninguno</div>'}</div>`
          : emptyState('plane', 'Cada jueves, anota aquí el vuelo con lo que hay en el almacén, su peso real y lo que pagaste por él. La app reparte ese precio entre los productos y te dice cuánto ganaste en cada vuelta.')}
        <p class="hint">A la derecha: la ganancia ya hecha con los encargos entregados, y la prevista de todo el vuelo.</p>`;
    },
    footer: () => `<button class="btn filled block lg" data-act="new" data-m="aereo">${icon('plus')} Nuevo vuelo</button>`,
    acts: {
      new: (el) => flightEditor(null, { method: el.dataset.m }),
      flight: (el) => flightDetail(el.dataset.id),
    },
  });
}

/* ======================= anotar un vuelo ======================= */
/** opts: { method, add: id de un encargo para incluir en un vuelo ya anotado } */
export function flightEditor(id = null, opts = {}) {
  const ex = id ? flight(id) : null;
  const method = ex?.method || opts.method || 'aereo';
  const d = ex
    ? { method, n: String(ex.n), date: ex.date, weight: ex.weight === '' || ex.weight == null ? '' : String(ex.weight), cost: ex.cost === '' || ex.cost == null ? '' : String(ex.cost), paidFrom: ex.paidFrom || 'tarjeta', eta: ex.eta || '', note: ex.note || '', sel: {} }
    : { method, n: String(nextFlightNumber()), date: nextDeparture(method), weight: '', cost: '', paidFrom: state.settings.shipFrom || 'tarjeta', eta: '', note: '', sel: {} };
  // Lo que ya va en este vuelo, marcado; lo que espera en el almacén, marcado si el vuelo es nuevo.
  const candidates = () => {
    const inTrip = [];
    if (ex) for (const o of state.orders) o.items.forEach((it, i) => it.flight === ex.id && inTrip.push({ o, idx: i, it, lb: itemLbs(o)[i] }));
    return [...inTrip, ...readyItems(d.method)];
  };
  for (const x of candidates()) d.sel[key(x.o, x.idx)] = ex ? x.it.flight === ex.id || (opts.add && x.o.id === opts.add) : true;
  openPage({
    title: ex ? `Editar ${tripName(ex)}` : `Nuevo ${tripWord(d.method)}`,
    data: d,
    action: { label: 'Guardar', act: 'save' },
    render: () => {
      const list = candidates();
      const chosen = list.filter((x) => d.sel[key(x.o, x.idx)]);
      const groups = new Map();
      for (const x of list) {
        if (!groups.has(x.o.id)) groups.set(x.o.id, []);
        groups.get(x.o.id).push(x);
      }
      const declared = round2(chosen.reduce((a, x) => a + x.lb, 0));
      const charged = chargedFor(chosen);
      const est = round2(chosen.reduce((a, x) => a + x.lb * num(x.o.lbCost), 0));
      const nOrders = new Set(chosen.map((x) => x.o.id)).size;
      return `
      <div class="form">
        ${!ex ? `<div class="lbl">Método</div>${seg('method', Object.entries(METHODS).map(([m, x]) => [m, `${x.label} (${readyItems(m).length})`]), d.method)}` : ''}
        <div class="row2">
          ${tf('Número', numInp('n', d.n, 'inputmode="numeric"'))}
          ${tf('Fecha de salida', `<input class="inp" type="date" data-bind="date" value="${d.date}">`)}
        </div>
      </div>
      ${secTitle(`Productos que van (${chosen.length})`, list.length ? `<button class="text-btn" data-act="all">${chosen.length === list.length ? 'Quitar todos' : 'Marcar todos'}</button>` : '')}
      <div class="list">${list.length ? [...groups.values()].map((g) => `
        <div class="li group-li"><span class="grow"><span class="t">${esc(clientLabel(g[0].o.client))}</span></span><span class="r dim">${g.length} de ${g[0].o.items.length}</span></div>
        ${g.map((x) => `<label class="li check-li sub-li"><span class="cbox"><input type="checkbox" data-bind="sel.${key(x.o, x.idx)}" ${d.sel[key(x.o, x.idx)] ? 'checked' : ''}><span>${icon('check')}</span></span>
          <span class="grow"><span class="t">${esc(x.it.desc || 'Producto')}</span><span class="s">${x.lb ? lbs(x.lb) : 'sin peso'}${x.it.arrived ? ` · en el almacén desde ${fmtDate(x.it.arrived)}` : ''}</span></span></label>`).join('')}`).join('')
        : `<div class="empty-li">No hay productos ${methodLabel(d.method).toLowerCase()}s marcados como llegados al almacén.</div>`}</div>
      <div class="card" data-sum>
        ${kv('Encargos', nOrders)}
        ${kv('Peso de los productos', lbs(declared))}
        ${kv('Se cobra a los clientes por esas libras', usd(charged))}
        ${kv('Costo estimado (libras × costo por libra)', usd(est), 'dim')}
      </div>
      ${chosen.some((x) => !x.lb) ? `<div class="banner amber">${icon('warning')}<span>${chosen.filter((x) => !x.lb).length} producto(s) sin peso: no pagan parte del envío ni se les cobran libras. Pon su peso en el encargo.</span></div>` : ''}
      ${secTitle('Peso y precio reales del envío')}
      <div class="form">
        <div class="row2">
          ${tf('Peso total real', numInp('weight', d.weight, 'placeholder="0.0"'), { suffix: 'lb' })}
          ${tf('Pagaste por todo', numInp('cost', d.cost, 'placeholder="0.00"'), { suffix: 'USD' })}
        </div>
        <div class="tf-help" data-real>${realHelp(d, declared, charged)}</div>
        <div class="lbl">Se pagó con</div>
        ${seg('paidFrom', Object.entries(ACCOUNTS), d.paidFrom)}
        ${tf('Llegada prevista a Cuba (opcional)', `<input class="inp" type="date" data-bind="eta" value="${d.eta}">`, { help: `Si la dejas vacía: ${fmtDate(addDays(d.date || today(), cubaDays(d.method)))} (unos ${cubaDays(d.method)} días).` })}
        ${tf('Nota (opcional)', inp('note', d.note, 'placeholder="Ej. 3 cajas, guía 12345"'))}
        <p class="hint">${icon('info')} Hasta que pongas lo que pagaste, el envío no se descuenta de la cuenta y la ganancia se calcula con el costo estimado.</p>
      </div>`;
    },
    afterBind: (pg, k) => {
      if (k.startsWith('sel.') || k === 'date') return pg.render();
      if (k === 'weight' || k === 'cost') {
        const list = candidates().filter((x) => d.sel[key(x.o, x.idx)]);
        $('[data-real]', pg.body).innerHTML = realHelp(d, list.reduce((a, x) => a + x.lb, 0), chargedFor(list));
      }
    },
    acts: {
      seg: (el, ev, pg) => {
        d[el.dataset.name] = el.dataset.v;
        if (el.dataset.name === 'method') {
          d.date = nextDeparture(d.method);
          for (const x of readyItems(d.method)) d.sel[key(x.o, x.idx)] = true;
        }
        pg.render();
      },
      all: (el, ev, pg) => {
        const list = candidates();
        const on = !list.every((x) => d.sel[key(x.o, x.idx)]);
        for (const x of list) d.sel[key(x.o, x.idx)] = on;
        pg.render();
      },
      save: async (el, ev, pg) => {
        const list = candidates();
        const chosen = list.filter((x) => d.sel[key(x.o, x.idx)]);
        if (!chosen.length) return snackbar('Marca al menos un producto');
        if (!d.date) return snackbar('Escribe la fecha de salida');
        const cur = ex ? flight(ex.id) : null;
        const rec = cur || { id: uid(), ts: Date.now(), arrived: null };
        Object.assign(rec, {
          n: num(d.n) || nextFlightNumber(), method: d.method, date: d.date,
          weight: d.weight === '' ? '' : round2(num(d.weight)), cost: d.cost === '' ? '' : round2(num(d.cost)),
          paidFrom: d.paidFrom, eta: d.eta, note: d.note.trim(),
        });
        if (!cur) state.flights.push(rec);
        const touched = new Set();
        for (const x of list) {
          const o = order(x.o.id);
          const it = o?.items[x.idx];
          if (!it) continue;
          if (d.sel[key(o, x.idx)]) {
            it.flight = rec.id;
            it.arrived = it.arrived || rec.date;
          } else if (it.flight === rec.id) delete it.flight;
          touched.add(o);
        }
        for (const o of touched) syncOrderStatus(o);
        await commit();
        vibrate(25);
        pg.close();
        snackbar(`${tripName(rec)}: ${chosen.length} producto${chosen.length === 1 ? '' : 's'}${num(rec.cost) ? ` · ${usd(rec.cost)}` : ' · falta el precio'}`);
        if (!cur) flightDetail(rec.id);
      },
    },
  });
}

/** Lo que se cobra a los clientes por las libras de esos productos (con el precio por libra de cada encargo). */
const chargedFor = (list) => round2(list.reduce((a, x) => a + itemShares(x.o)[x.idx].weightCharge, 0));

function realHelp(d, declared, charged) {
  const w = num(d.weight);
  const c = num(d.cost);
  const parts = [];
  if (w && declared) parts.push(`${w >= declared ? `+${lbs(w - declared)}` : `−${lbs(declared - w)}`} sobre el peso de los productos (cajas, embalaje…)`);
  if (c && declared) parts.push(`<b>${usd(c)} ÷ ${lbs(declared)} de productos = ${usd(c / declared)} por libra</b> (lo que paga cada libra de los encargos, cajas incluidas)`);
  if (c) parts.push(`<b class="${charged - c < 0 ? 'red-t' : 'green-t'}">Se cobra por las libras − envío pagado: ${usd(charged)} − ${usd(c)} = ${usd(charged - c)}</b>`);
  return parts.join(' · ') || 'Lo que pesó todo el envío (con cajas) y lo que pagaste por él. Puedes ponerlo ahora o cuando lo sepas.';
}

/* ======================= ficha del vuelo ======================= */
export function flightDetail(id) {
  openPage({
    title: 'Envío',
    nav: 'back',
    live: true,
    menu: () => [
      { label: 'Editar productos, peso y precio', ic: 'edit', value: () => flightEditor(id) },
      ...(flight(id)?.arrived ? [{ label: 'Todavía no ha llegado', ic: 'undo', value: () => unarrive(id) }] : []),
      { label: 'Eliminar', sub: 'Los productos vuelven al almacén', ic: 'trash', danger: true, value: () => deleteFlight(id) },
    ],
    render: () => {
      const f = flight(id);
      if (!f) return emptyState('plane', 'Este envío ya no existe.');
      const c = flightCalc(f);
      const eta = f.arrived || f.eta || addDays(f.date, cubaDays(f.method));
      return `
        <div class="hero">
          <div class="hero-main"><span class="hero-u">${methodLabel(f.method)} · sale ${fmtDateLong(f.date).toLowerCase()}</span><span class="hero-n sm">${esc(tripName(f))}</span>
          <span class="hero-u">${c.items.length} producto${c.items.length === 1 ? '' : 's'} de ${c.orders.length} encargo${c.orders.length === 1 ? '' : 's'}</span></div>
          <div class="hero-badges">${f.arrived ? `<span class="badge green">${icon('check')}Llegó el ${fmtDate(f.arrived)}</span>` : `<span class="badge teal">${icon(METHODS[f.method]?.ic || 'plane')}Llega ~${fmtDate(eta)}</span>`}
            ${c.hasCost ? `<span class="badge">${usd(f.cost)}${num(f.weight) ? ` · ${lbs(f.weight)}` : ''}</span>` : `<span class="badge amber">${icon('warning')}Falta el precio</span>`}</div>
        </div>
        ${!c.hasCost ? `<button class="btn filled block lg" data-act="edit">${icon('scale')} Poner peso y precio del envío</button>` : ''}
        ${!f.arrived ? `<button class="btn ${c.hasCost ? 'filled' : 'tonal'} block" data-act="arrive">${icon('pin')} Llegó a Cuba</button>` : ''}
        ${secTitle('Ganancia de esta vuelta')}
        <div class="card">
          ${kv('Se cobra por todo lo que lleva', usd(c.revenue))}
          ${kv('− Precio de los productos', usd(c.products))}
          ${kv(`− Envío ${c.hasCost ? 'pagado' : 'estimado'}`, usd(c.cost))}
          <div class="divider"></div>
          ${kv('= Ganancia prevista', usd(c.profit), c.profit >= 0 ? 'green big' : 'red big')}
          ${kv(`Ya hecha (${c.doneOrders.length} de ${c.orders.length} encargos entregados)`, usd(c.doneProfit), c.doneProfit >= 0 ? 'green strong' : 'red strong')}
          ${kv('Cobrado de esos encargos hasta ahora', usd(c.collected), 'dim')}
        </div>
        ${secTitle('Peso y envío')}
        <div class="card">
          ${kv('Peso de los productos (lo que pagan los clientes)', lbs(c.lbs))}
          ${num(f.weight) ? kv('Peso real del envío (con cajas)', lbs(f.weight)) : ''}
          ${c.extraLb !== null ? kv('Diferencia (cajas, embalaje…)', `${c.extraLb >= 0 ? '+' : '−'}${lbs(Math.abs(c.extraLb))}`, 'dim') : ''}
          <div class="divider"></div>
          ${kv(`Se cobra por las libras${c.lbPrices.length === 1 ? `: ${lbs(c.lbs)} × ${usd(c.lbPrices[0])}/lb` : ' (precio por libra de cada encargo)'}`, usd(c.weightCharge))}
          ${kv(`− Envío ${c.hasCost ? `pagado con ${ACC_SHORT[f.paidFrom || 'tarjeta'].toLowerCase()}` : 'estimado'}`, usd(c.cost))}
          ${kv('= Ganancia en las libras', usd(c.weightCharge - c.cost), c.weightCharge - c.cost >= 0 ? 'green strong' : 'red strong')}
          ${c.perLb ? `<div class="divider"></div>
          ${kv(`Costo por libra de producto: ${usd(c.cost)} ÷ ${lbs(c.lbs)}`, `${usd(c.perLb)}/lb`, 'strong')}
          ${c.perRealLb ? kv(`Costo por libra real del vuelo: ${usd(c.cost)} ÷ ${lbs(f.weight)}`, `${usd(c.perRealLb)}/lb`, 'dim') : ''}` : ''}
        </div>
        ${c.perLb ? `<p class="hint">${icon('info')} Cada producto paga sus libras × <b>${usd(c.perLb)}</b>: así el precio de las cajas y el embalaje queda repartido y la suma es justo lo que pagaste.</p>` : ''}
        ${secTitle('Encargos')}
        <div class="list">${c.orders.map((o) => {
          const its = c.items.filter((i) => i.o === o);
          const prof = round2(its.reduce((a, i) => a + i.profit, 0));
          const ship = round2(its.reduce((a, i) => a + i.ship, 0));
          return li({ act: 'order', attrs: `data-id="${o.id}"`, title: esc(clientLabel(o.client)), sub: `${esc(its.map((i) => i.it.desc || 'Producto').join(', '))}${its.length < o.items.length ? ` <span class="dim">(${its.length} de ${o.items.length})</span>` : ''}<br>${lbs(its.reduce((a, i) => a + i.lb, 0))} · envío ${usd(ship)} · ${statusBadge(o.status)}`, right: `<b class="${prof < 0 ? 'red-t' : ''}">${usd(prof)}</b><small>ganancia</small>` });
        }).join('')}</div>
        ${f.note ? `<div class="card note-card">${icon('edit')}<span>${esc(f.note)}</span></div>` : ''}
        <p class="hint">${icon('info')} El precio del envío se reparte entre los productos según sus libras. La ganancia «ya hecha» suma los encargos entregados; la de cada encargo cuenta el día que se entrega.</p>`;
    },
    acts: {
      edit: () => flightEditor(id),
      arrive: () => arriveFlight(id),
      order: (el) => orderDetail(el.dataset.id),
    },
  });
}

/** Marca el vuelo como llegado a Cuba: sus encargos pasan a «En Cuba» (si todo lo suyo llegó). */
export async function arriveFlight(id) {
  const f = flight(id);
  if (!f) return;
  const v = await dialog({
    title: `${tripName(f)} llegó a Cuba`,
    message: 'Sus encargos pasarán a «En Cuba: listo para entregar».',
    input: { type: 'date', value: today() },
    buttons: [{ label: 'Cancelar', value: null }, { label: 'Llegó', value: true }],
  });
  if (!v) return;
  flight(id).arrived = v;
  for (const o of state.orders) if (o.items.some((it) => it.flight === id)) syncOrderStatus(o);
  await commit();
  vibrate(25);
  snackbar(`${tripName(f)} en Cuba`);
}

async function unarrive(id) {
  flight(id).arrived = null;
  for (const o of state.orders) if (o.items.some((it) => it.flight === id)) syncOrderStatus(o);
  await commit();
}

async function deleteFlight(id) {
  const f = flight(id);
  if (!(await confirmDlg(`Eliminar ${tripName(f)}`, 'Sus productos vuelven a «En el almacén» y su precio deja de descontarse de la cuenta.', 'Eliminar', true))) return;
  for (const o of state.orders) {
    let hit = false;
    for (const it of o.items) {
      if (it.flight === id) {
        delete it.flight;
        hit = true;
      }
    }
    if (hit) syncOrderStatus(o);
  }
  state.flights = state.flights.filter((x) => x.id !== id);
  await commit();
  topPage()?.close();
  snackbar('Envío eliminado');
}
