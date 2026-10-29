// Encargos: formulario, ficha con la línea de tiempo, cambios de estado, cobros, seguimiento y clientes.
import { icon } from './icons.js';
import {
  state, num, round2, usd, lbs, pct, today, addDays, daysBetween, fmtDate, fmtDateLong, relDay, uid, norm, digits,
  STATUS, STATUS_LABEL, STATUS_DATE, ACCOUNTS, ACC_SHORT, order, newOrder, orderCalc, orderTitle, clientLabel, orderEta,
  transitStats, storeDays, cubaDays, reached, statusIdx, guessCarrier, trackingUrl, storeOrderUrl, parseArrival, icsEvent,
  clients, clientKey, ordersOfClient, isOpen, METHODS, methodOf, methodLabel, methodRates, withMethod,
  orderLbs, itemLbs, hasItemWeights, itemArrived, legacyShipped, flight, tripName, syncOrderStatus, WEEKDAY_NAMES, parseDate,
} from './store.js';
import {
  $, esc, openPage, topPage, dialog, confirmDlg, promptDlg, menuSheet, snackbar, pickFromList, chips, seg, tf, inp, numInp, toggle, li, kv,
  secTitle, emptyState, contactBtns, vibrate,
} from './ui.js';
import { commit, shareText, openCalendarFile } from './core.js';
import { flightEditor, flightDetail, arriveFlight, openTrips } from './flights.js';

export const STATUS_COLOR = { pendiente: 'amber', comprado: 'blue', almacen: 'purple', enviado: 'teal', cuba: 'green', entregado: 'gray', cancelado: 'red' };
export const STATUS_ICON = { pendiente: 'cart', comprado: 'card', almacen: 'store', enviado: 'plane', cuba: 'pin', entregado: 'checkCircle', cancelado: 'close' };
export const statusBadge = (s) => `<span class="badge ${STATUS_COLOR[s]}">${icon(STATUS_ICON[s])}${STATUS_LABEL[s]}</span>`;
const clone = (x) => JSON.parse(JSON.stringify(x));

/** Siguiente paso del encargo (o null si ya terminó). */
export function nextStatus(o) {
  if (!isOpen(o)) return null;
  return STATUS[statusIdx(o.status) + 1]?.[0] || null;
}
const NEXT_LABEL = { comprado: 'Ya lo compré', almacen: 'Llegó al almacén', enviado: 'Enviar a Cuba', cuba: 'Llegó a Cuba', entregado: 'Entregado al cliente' };

/** «hoy», «mañana» o «el jueves 29/10». */
export function departureLabel(date) {
  if (!date) return '';
  const n = daysBetween(today(), date);
  if (n <= 0) return 'hoy';
  if (n === 1) return 'mañana';
  return `el ${WEEKDAY_NAMES[parseDate(date).getDay()]} ${fmtDate(date).slice(0, 5)}`;
}
/** Vuelos o barcos en los que va el encargo. */
export const tripsOf = (o) => [...new Set(o.items.map((it) => it.flight).filter(Boolean))].map(flight).filter(Boolean);
const arrivedCount = (o) => o.items.filter((it) => itemArrived(o, it)).length;

/** Texto corto de dónde está y cuándo llega. */
export function etaLine(o, ts = transitStats()) {
  const e = orderEta(o, ts);
  const d = o.dates || {};
  const late = (date) => date < today();
  if (o.status === 'pendiente') return '<span class="amber-t">Falta comprarlo</span>';
  const part = arrivedCount(o);
  if (o.status === 'comprado') {
    const pre = part ? `${part} de ${o.items.length} en el almacén · ` : '';
    return late(e.warehouse) ? `${pre}<span class="red-t">${icon('warning')}Debió llegar al almacén ${relDay(e.warehouse)}</span>` : `${pre}Llega al almacén ${relDay(e.warehouse)}${e.whAuto ? ' (aprox.)' : ''}`;
  }
  if (o.status === 'almacen') {
    const flown = o.items.filter((it) => it.flight).length;
    return `En el almacén${flown ? ` (${flown} ya salieron)` : ''} · sale ${departureLabel(e.departure) || 'en el próximo envío'}`;
  }
  if (o.status === 'enviado') {
    const t = tripsOf(o).map(tripName).join(', ');
    return late(e.cuba) ? `${t ? `${t} · ` : ''}<span class="red-t">${icon('warning')}Debió llegar a Cuba ${relDay(e.cuba)}</span>` : `${t ? `${t} · ` : ''}Llega a Cuba ${relDay(e.cuba)}${e.cubaAuto ? ' (aprox.)' : ''}`;
  }
  if (o.status === 'cuba') return `<span class="green-t">En Cuba: listo para entregar</span>`;
  if (o.status === 'entregado') return `Entregado el ${fmtDate(d.delivered)}`;
  return 'Cancelado';
}

export function orderRow(o, ts) {
  const k = orderCalc(o);
  return li({
    act: 'order', attrs: `data-id="${o.id}"`, cls: 'order-li',
    ic: STATUS_ICON[o.status], color: STATUS_COLOR[o.status],
    title: esc(clientLabel(o.client)),
    sub: `${esc(orderTitle(o))} · ${esc(o.store)} · ${methodLabel(methodOf(o))}<br>${etaLine(o, ts)}`,
    right: `<b>${usd(k.total)}</b>${k.due > 0.004 && o.status !== 'pendiente' ? `<small class="amber-t">debe ${usd(k.due)}</small>` : k.paid && k.due <= 0.004 ? '<small class="green-t">pagado</small>' : ''}`,
  });
}

/* ======================= precio ======================= */
function priceRows(o) {
  const k = orderCalc(o);
  const extraSum = round2(k.total - k.subtotal);
  return `
    ${kv('Productos', usd(k.products))}
    ${kv(`Envío ${methodLabel(methodOf(o)).toLowerCase()}: ${lbs(k.lb)} × ${usd(o.lbPrice)}`, usd(k.weight))}
    ${o.feeOn ? kv(`Tarifa ${pct(o.feePct)} del producto`, usd(k.fee)) : ''}
    ${(o.extras || []).filter((e) => num(e.amount)).map((e) => kv(esc(e.label || 'Otro cargo'), usd(e.amount))).join('')}
    ${extraSum ? kv(o.priceOverride !== '' && o.priceOverride != null ? 'Ajuste al precio acordado' : 'Redondeo', usd(extraSum)) : ''}
    <div class="divider"></div>
    ${kv('Precio al cliente', usd(k.total), 'big')}
    ${secLabel('Lo que nos costó')}
    ${kv('Costo de los productos', usd(k.products))}
    ${k.shipFixed
    ? kv('Envío (costo fijo escrito a mano)', usd(k.shipCost))
    : kv(`Envío: ${lbs(k.shipLb)} × ${usd(o.lbCost)}/lb (nuestra tarifa ${methodLabel(methodOf(o)).toLowerCase()})`, usd(k.shipCost))}
    ${kv('= Costo del encargo', usd(k.cost), 'strong')}
    <div class="divider"></div>
    ${kv(`Ganancia: ${usd(k.total)} − ${usd(k.cost)}`, usd(k.profit), k.profit < 0 ? 'red strong' : 'green strong')}`;
}

const secLabel = (t) => `<div class="kv-label">${t}</div>`;

/* ======================= formulario ======================= */
export function orderEditor(id = null, prefill = {}) {
  const existing = id ? order(id) : null;
  const d = existing ? clone(existing) : newOrder(prefill);
  d.items.forEach((it) => {
    it.qty = String(it.qty ?? 1);
    it.price = it.price === '' ? '' : String(it.price);
  });
  const S = state.settings;
  openPage({
    title: existing ? 'Editar encargo' : 'Nuevo encargo',
    data: d,
    action: { label: 'Guardar', act: 'save' },
    render: (pg) => {
      const ts = transitStats();
      const e = orderEta(d, ts);
      const carrier = guessCarrier(d.tracking);
      return `
      <div class="form">
        ${secTitle('Cliente', '<button class="text-btn" data-act="pickClient">Elegir uno anterior</button>')}
        ${tf('Nombre', inp('client.name', d.client.name, 'placeholder="Quién hizo el encargo" autocapitalize="words"'))}
        ${tf('Teléfono', inp('client.phone', d.client.phone, 'type="tel" inputmode="tel" placeholder="Ej. 5 1234567"'))}

        ${secTitle('Productos')}
        ${d.items.map((it, i) => `
          <div class="card item-card">
            <div class="ic-top"><span class="lbl">Producto ${d.items.length > 1 ? i + 1 : ''}</span>${d.items.length > 1 ? `<button class="icon-btn" data-act="delItem" data-i="${i}" aria-label="Quitar">${icon('trash')}</button>` : ''}</div>
            ${tf('Qué es', inp(`items.${i}.desc`, it.desc, 'placeholder="Ej. Zapatos Nike talla 9"'))}
            <div class="row3">
              ${tf('Precio pagado', numInp(`items.${i}.price`, it.price, 'placeholder="0.00"'), { suffix: 'USD' })}
              ${tf('Cantidad', numInp(`items.${i}.qty`, it.qty, 'inputmode="numeric"'))}
              ${tf('Peso', numInp(`items.${i}.w`, it.w ?? '', 'placeholder="—"'), { suffix: 'lb' })}
            </div>
            ${tf('Enlace (opcional)', inp(`items.${i}.url`, it.url, 'type="url" inputmode="url" placeholder="https://…"'))}
          </div>`).join('')}
        <div class="tf-help">El precio que pagaste en la tienda por cada unidad, con impuestos y envío hasta el almacén. El peso (de todas las unidades) es opcional: si lo pones en cada producto, el peso del encargo es la suma.</div>
        <button class="btn tonal" data-act="addItem">${icon('plus')} Otro producto</button>

        ${secTitle('Tienda y seguimiento')}
        ${chips('store', [...S.stores.map((x) => [x, x])], d.store)}
        ${tf('Nº de pedido en la tienda (opcional)', inp('storeOrder', d.storeOrder, 'placeholder="Ej. 112-1234567-1234567"'))}
        ${tf('Nº de seguimiento (opcional)', inp('tracking', d.tracking, 'placeholder="Ej. 1Z…, TBA…, 9400…" autocapitalize="characters"'), { help: `<span data-carrier>${carrier ? `Parece de <b>${carrier}</b>.` : 'Lo da la tienda cuando envía el paquete.'}</span>` })}

        ${secTitle('Estado')}
        ${existing && reached(existing, 'enviado') ? `<div class="card">${statusBadge(d.status)} <span class="dim">${tripsOf(existing).map(tripName).join(', ') || 'Se cambia desde la ficha del encargo'}</span></div>`
          : chips('status', STATUS.slice(0, 3).map(([k, l]) => [k, l]), d.status)}
        ${reached(d, 'comprado') ? tf('Fecha de compra', `<input class="inp" type="date" data-bind="dates.bought" value="${d.dates.bought || today()}">`) : ''}
        ${d.status === 'comprado' ? `
          ${tf('Llegada prevista al almacén', `<input class="inp" type="date" data-bind="etaWarehouse" value="${d.etaWarehouse || ''}">`, { help: d.etaWarehouse ? 'Escrita por ti.' : `Si la dejas vacía: ${fmtDate(e.warehouse)} (${esc(d.store)} suele tardar ${storeDays(d.store, ts)} días).` })}
          <button class="btn tonal sm" data-act="pasteEta">${icon('clipboard')} Pegar la fecha que da la tienda</button>` : ''}

        ${secTitle('Envío a Cuba')}
        ${seg('method', Object.entries(METHODS).map(([m, x]) => [m, x.label]), d.method)}
        <div class="tf-help">${methodHelp(d.method, e.cuba, e.cubaAuto)}</div>

        ${secTitle('Peso y precio')}
        <div class="row2" data-wrow>${weightRow(d)}</div>
        <label class="li check-li"><span class="grow"><span class="t">Es el peso real del almacén</span><span class="s">Si no, es un cálculo aproximado</span></span>${toggle('weightReal', d.weightReal)}</label>
        <label class="li check-li"><span class="grow"><span class="t">Cobrar un % del precio del producto</span><span class="s">Apagado por defecto</span></span>${toggle('feeOn', d.feeOn)}</label>
        ${d.feeOn ? tf('Porcentaje', numInp('feePct', d.feePct), { suffix: '%' }) : ''}
        ${(d.extras || []).map((x, i) => `
          <div class="row2 extra-row">
            ${tf('Otro cargo', inp(`extras.${i}.label`, x.label, 'placeholder="Ej. Mensajería"'))}
            <div class="row-del">${tf('Importe', numInp(`extras.${i}.amount`, x.amount, 'placeholder="0"'), { suffix: 'USD' })}<button class="icon-btn" data-act="delExtra" data-i="${i}" aria-label="Quitar">${icon('close')}</button></div>
          </div>`).join('')}
        <button class="btn tonal sm" data-act="addExtra">${icon('plus')} Otro cargo o descuento</button>
        <div class="card sum-card" data-sum>${priceRows(d)}</div>
        <details class="more" ${d.priceOverride !== '' || d.shipCost !== '' || d.lbCost !== methodRates(d.method).lbCost ? 'open' : ''}><summary>Precio acordado y costo del envío</summary>
          <div class="form inner">
            ${tf('Precio acordado (opcional)', numInp('priceOverride', d.priceOverride, `placeholder="${orderCalc({ ...d, priceOverride: '' }).total}"`), { suffix: 'USD', help: 'Si le cobras un precio cerrado, escríbelo aquí y se usa en lugar del calculado.' })}
            ${tf('Nos cuesta la libra', numInp('lbCost', d.lbCost), { suffix: 'USD' })}
            ${tf('Costo de envío fijo (opcional)', numInp('shipCost', d.shipCost, `placeholder="${round2(orderCalc({ ...d, shipCost: '' }).shipCost)}"`), { suffix: 'USD', help: 'Normalmente déjalo vacío: el envío se calcula con las libras × lo que nos cuesta la libra.' })}
          </div>
        </details>

        ${secTitle('Pagos')}
        <div class="lbl">La compra en la tienda se pagó con</div>
        ${seg('payFrom', Object.entries(ACC_SHORT), d.payFrom)}
        ${!existing ? `${tf('El cliente adelantó (opcional)', numInp('advance', d.advance || '', 'placeholder="0"'), { suffix: 'USD', help: 'Se anota como cobro en efectivo de hoy.' })}` : ''}
        ${tf('Nota (opcional)', inp('note', d.note, 'placeholder="Ej. color negro, regalo de cumpleaños"'))}
      </div>`;
    },
    afterBind: (pg, key) => {
      if (['feeOn', 'weightReal'].includes(key)) return pg.render();
      // Peso de cada producto: se actualiza el total sin perder el teclado.
      if (/^items\.\d+\.w$/.test(key) || key === 'lbPrice') {
        const wr = $('[data-wrow]', pg.body);
        const had = !!wr.querySelector('[data-bind="weightLb"]');
        if (had === hasItemWeights(d) || key === 'lbPrice') {
          if (!had) wr.querySelector('[data-wsum]').textContent = lbs(orderLbs(d));
        } else wr.innerHTML = weightRow(d);
      }
      const s = $('[data-sum]', pg.body);
      if (s) s.innerHTML = priceRows(d);
      if (key === 'tracking') {
        const c = guessCarrier(d.tracking);
        $('[data-carrier]', pg.body).innerHTML = c ? `Parece de <b>${c}</b>.` : 'Lo da la tienda cuando envía el paquete.';
      }
      if (key === 'dates.bought' || key === 'etaWarehouse') pg.render();
    },
    acts: {
      chip: (el, ev, pg) => {
        const { name, v } = el.dataset;
        d[name] = v;
        if (name === 'status') {
          // «En el almacén» al crear: todos los productos llegaron hoy. Volver atrás quita las llegadas.
          for (const it of d.items) {
            if (it.flight) continue;
            if (v === 'almacen') it.arrived = it.arrived || today();
            else it.arrived = '';
          }
          ensureDates(d);
        }
        pg.render();
      },
      seg: (el, ev, pg) => {
        d[el.dataset.name] = el.dataset.v;
        // Al cambiar de método se usan sus tarifas por libra.
        if (el.dataset.name === 'method') Object.assign(d, withMethod(el.dataset.v));
        pg.render();
      },
      addItem: (el, ev, pg) => {
        d.items.push({ desc: '', qty: '1', price: '', url: '' });
        pg.render();
      },
      delItem: (el, ev, pg) => {
        d.items.splice(+el.dataset.i, 1);
        pg.render();
      },
      addExtra: (el, ev, pg) => {
        (d.extras = d.extras || []).push({ label: '', amount: '' });
        pg.render();
      },
      delExtra: (el, ev, pg) => {
        d.extras.splice(+el.dataset.i, 1);
        pg.render();
      },
      pickClient: async (el, ev, pg) => {
        const list = clients().sort((a, b) => (b.last || '').localeCompare(a.last || ''));
        const k = await pickFromList({
          title: 'Elegir cliente',
          items: list.map((c) => ({ value: c.key, label: c.name || c.phone, sub: [c.phone, c.orders ? `${c.orders} encargo${c.orders === 1 ? '' : 's'}` : '', c.remits ? `${c.remits} remesa${c.remits === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') })),
          searchPlaceholder: 'Nombre o teléfono',
        });
        const c = list.find((x) => x.key === k);
        if (c) {
          d.client = { name: c.name, phone: c.phone };
          pg.render();
        }
      },
      pasteEta: async (el, ev, pg) => {
        const date = await askArrivalText();
        if (date) {
          d.etaWarehouse = date;
          pg.render();
        }
      },
      save: async (el, ev, pg) => {
        d.items = d.items.filter((it) => it.desc.trim() || num(it.price));
        if (!d.client.name.trim() && !d.client.phone.trim()) {
          if (!d.items.length) d.items.push({ desc: '', qty: '1', price: '', url: '' });
          return snackbar('Escribe el nombre o el teléfono del cliente');
        }
        if (!d.items.length) {
          d.items.push({ desc: '', qty: '1', price: '', url: '' });
          pg.render();
          return snackbar('Escribe al menos un producto');
        }
        if (reached(d, 'comprado') && d.items.some((it) => !num(it.price)) && !(await confirmDlg('Falta el precio', 'Algún producto no tiene precio de compra. ¿Guardar de todos modos?', 'Guardar'))) return;
        const rec = {
          ...d,
          client: { name: d.client.name.trim(), phone: d.client.phone.trim() },
          items: d.items.map((it) => ({ ...it, desc: it.desc.trim(), qty: num(it.qty) || 1, price: round2(num(it.price)), url: (it.url || '').trim(), w: it.w === '' || it.w == null ? '' : round2(num(it.w)) })),
          weightLb: hasItemWeights(d) ? orderLbs(d) : d.weightLb === '' ? '' : round2(num(d.weightLb)),
          lbPrice: num(d.lbPrice), lbCost: num(d.lbCost), feePct: num(d.feePct),
          extras: (d.extras || []).filter((x) => x.label.trim() || num(x.amount)).map((x) => ({ label: x.label.trim(), amount: round2(num(x.amount)) })),
          priceOverride: d.priceOverride === '' ? '' : round2(num(d.priceOverride)),
          shipCost: d.shipCost === '' ? '' : round2(num(d.shipCost)),
          tracking: d.tracking.trim(), storeOrder: d.storeOrder.trim(), note: d.note.trim(),
          carrier: guessCarrier(d.tracking),
        };
        delete rec.advance;
        ensureDates(rec);
        syncOrderStatus(rec);
        if (!existing && num(d.advance) > 0) rec.payments = [{ id: uid(), ts: Date.now(), date: today(), amount: round2(num(d.advance)), account: 'efectivo' }];
        const cur = order(rec.id);
        if (cur) Object.assign(cur, rec);
        else state.orders.push(rec);
        await commit();
        pg.close();
        snackbar(existing ? 'Encargo guardado' : `Encargo de ${clientLabel(rec.client)} · ${usd(orderCalc(rec).total)}`);
        if (!existing) orderDetail(rec.id);
      },
    },
  });
}

/** Peso del encargo: el total si no hay peso por producto; si lo hay, la suma (no se escribe). */
function weightRow(d) {
  const w = hasItemWeights(d)
    ? `<div class="tf"><span class="tf-l">Peso total</span><span class="inp ro"><span data-wsum>${lbs(orderLbs(d))}</span></span><span class="tf-suf">suma</span></div>`
    : tf('Peso del encargo', numInp('weightLb', d.weightLb, 'placeholder="0.0"'), { suffix: 'lb' });
  return `${w}${tf('Cobro por libra', numInp('lbPrice', d.lbPrice), { suffix: 'USD' })}`;
}

/** Tarifas y tiempo del método elegido, para el formulario. */
function methodHelp(m, cuba, auto) {
  const r = methodRates(m);
  const dep = r.depart >= 0 ? `sale los ${WEEKDAY_NAMES[r.depart]} y llega en unos ${cubaDays(m)} días` : `unos ${cubaDays(m)} días desde que sale`;
  return `${methodLabel(m)}: ${usd(r.lbPrice)}/lb al cliente · nos cuesta ${usd(r.lbCost)}/lb (estimado) · ${dep}${cuba ? ` (llegada ${auto ? 'aprox.' : 'prevista'} ${fmtDate(cuba)})` : ''}.`;
}

/** Pone fecha de hoy a los estados alcanzados que no la tengan (y quita las de estados posteriores). */
function ensureDates(o) {
  o.dates = o.dates || {};
  for (const [s] of STATUS.slice(1)) {
    const key = STATUS_DATE[s];
    if (reached(o, s)) o.dates[key] = o.dates[key] || today();
    else if (o.status !== 'cancelado') delete o.dates[key];
  }
}

/** Lee del portapapeles (o de lo que pegues) la fecha de llegada que da la tienda. */
async function askArrivalText() {
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch {
    /* sin permiso: se pide a mano */
  }
  let date = parseArrival(text);
  if (!date) {
    const v = await promptDlg({ title: 'Fecha de llegada', message: 'Pega aquí el texto de la tienda o del correo, por ejemplo «Arriving Tuesday, October 14» o «Llega el 14 de oct.».', placeholder: 'Pega el texto', ok: 'Leer' });
    if (v === null) return '';
    date = parseArrival(v);
  }
  if (!date) {
    snackbar('No encontré una fecha en ese texto');
    return '';
  }
  snackbar(`Llegada prevista: ${fmtDateLong(date)}`);
  return date;
}

/* ======================= ficha del encargo ======================= */
export function orderDetail(id) {
  openPage({
    title: 'Encargo',
    nav: 'back',
    live: true,
    menu: () => {
      const o = order(id);
      if (!o) return [];
      return [
        { label: 'Editar', ic: 'edit', value: () => orderEditor(id) },
        { label: 'Enviar resumen al cliente', ic: 'share', value: () => shareText(clientText(o), 'Tu encargo') },
        { label: 'Nuevo encargo para este cliente', ic: 'plus', value: () => orderEditor(null, { client: { ...o.client } }) },
        o.status === 'cancelado'
          ? { label: 'Recuperar encargo', ic: 'undo', value: () => uncancel(id) }
          : { label: 'Cancelar encargo', ic: 'close', value: () => cancelOrder(id) },
        { label: 'Eliminar', ic: 'trash', danger: true, value: () => deleteOrder(id) },
      ];
    },
    render: () => {
      const o = order(id);
      if (!o) return emptyState('pkg', 'Este encargo ya no existe.');
      const k = orderCalc(o);
      const ts = transitStats();
      const e = orderEta(o, ts);
      const nx = nextStatus(o);
      const tUrl = trackingUrl(o.tracking, o.carrier || guessCarrier(o.tracking));
      const sUrl = storeOrderUrl(o.store, o.storeOrder);
      return `
        ${o.status === 'cancelado' ? `<div class="banner red">${icon('close')}<span>Encargo cancelado el ${fmtDate(o.dates.cancelled)}. ${k.spent ? `Se gastaron ${usd(k.spent)}${k.refund ? ` y la tienda devolvió ${usd(k.refund)}` : ''}.` : ''}</span></div>` : ''}
        <div class="hero">
          <div class="hero-main"><span class="hero-u">${esc(clientLabel(o.client))}${o.client.phone && o.client.name ? ` · ${esc(o.client.phone)}` : ''}</span><span class="hero-n">${usd(k.total)}</span>
          <span class="hero-u">${esc(orderTitle(o))}</span></div>
          <div class="hero-badges">${statusBadge(o.status)}${k.due > 0.004 ? `<span class="badge amber">Debe ${usd(k.due)}</span>` : k.paid ? `<span class="badge green">${icon('check')}Pagado</span>` : ''}<span class="badge ${methodOf(o) === 'maritimo' ? 'teal' : 'blue'}">${icon(METHODS[methodOf(o)].ic)}${methodLabel(methodOf(o))}</span>${orderLbs(o) ? `<span class="badge">${icon('scale')}${lbs(orderLbs(o))}${o.weightReal ? '' : ' aprox.'}</span>` : ''}</div>
          ${contactBtns(o.client.phone)}
        </div>
        ${nx ? `<button class="btn filled block lg" data-act="advance" data-to="${nx}">${icon(nx === 'enviado' ? METHODS[methodOf(o)].ic : STATUS_ICON[nx])} ${nx === 'almacen' && arrivedCount(o) ? `Llegó el resto (${arrivedCount(o)} de ${o.items.length} ya están)` : nx === 'enviado' ? `Enviar a Cuba (${METHODS[methodOf(o)].trip.toLowerCase()})` : NEXT_LABEL[nx]}</button>` : ''}
        ${secTitle('Seguimiento')}
        <div class="list timeline">${timeline(o, e)}</div>
        ${o.tracking || sUrl ? `<div class="btn-row wrap pad-h">
          ${o.tracking ? `<a class="btn tonal sm" href="${esc(tUrl)}" target="_blank" rel="noopener">${icon('truck')} Rastrear ${esc(o.carrier || guessCarrier(o.tracking) || 'paquete')}</a>` : ''}
          ${sUrl ? `<a class="btn tonal sm" href="${esc(sUrl)}" target="_blank" rel="noopener">${icon('external')} Ver en ${esc(o.store)}</a>` : ''}
        </div>` : ''}
        ${o.tracking ? `<p class="hint">Nº de seguimiento: <b class="sel">${esc(o.tracking)}</b>${o.storeOrder ? ` · Pedido: <b class="sel">${esc(o.storeOrder)}</b>` : ''}</p>` : o.storeOrder ? `<p class="hint">Pedido en ${esc(o.store)}: <b class="sel">${esc(o.storeOrder)}</b></p>` : ''}
        ${o.status === 'comprado' || o.status === 'enviado' ? `<button class="btn tonal block" data-act="calendar">${icon('calPlus')} Recordármelo en el calendario</button>` : ''}
        ${o.status === 'comprado' ? `<button class="btn text block" data-act="pasteEta">${icon('clipboard')} Pegar la fecha de llegada que da la tienda</button>` : ''}
        ${secTitle('Productos', checkable(o) && o.items.length > 1 ? `<span>${arrivedCount(o)} de ${o.items.length} en el almacén</span>` : '')}
        <div class="list">${itemRows(o)}</div>
        ${checkable(o) ? '<p class="hint">Marca cada producto cuando llegue al almacén; el peso puede ponerse luego. Cuando estén todos, el encargo pasa a «En el almacén» y sale en el próximo envío.</p>' : ''}
        ${secTitle('Precio y ganancia')}
        <div class="card">${priceRows(o)}</div>
        ${secTitle('Cobros', o.status !== 'cancelado' ? '<button class="text-btn" data-act="pay">Registrar cobro</button>' : '')}
        <div class="list">${(o.payments || []).length ? o.payments.map((p) => li({ act: 'payment', attrs: `data-pid="${p.id}"`, ic: ACC_ICON[p.account], color: 'green', title: usd(p.amount), sub: `${fmtDateLong(p.date)} · ${ACC_SHORT[p.account]}`, chev: false })).join('') : '<div class="empty-li">Todavía no ha pagado nada.</div>'}
          ${k.due > 0.004 ? `<div class="li due-li"><span class="grow"><span class="t">Falta por cobrar</span></span><b class="amber-t">${usd(k.due)}</b></div>` : ''}</div>
        ${o.status === 'cancelado' ? `<button class="btn tonal block" data-act="refund">${icon('undo')} ${o.refund ? 'Cambiar la devolución' : 'Anotar devolución de la tienda'}</button>` : ''}
        ${o.note ? `<div class="card note-card">${icon('edit')}<span>${esc(o.note)}</span></div>` : ''}
        <p class="hint">${icon('info')} Compra pagada con ${ACC_SHORT[o.payFrom].toLowerCase()}. ${legacyShipped(o) ? `Envío pagado con ${ACC_SHORT[o.shipFrom].toLowerCase()}.` : 'El envío se paga al anotar el vuelo con su precio real.'}${o.by ? ` Último cambio: ${esc(o.by)}.` : ''}</p>`;
    },
    acts: {
      advance: (el) => advance(id, el.dataset.to),
      step: (el) => {
        const o = order(id);
        const t = tripsOf(o);
        if (t.length && ['enviado', 'cuba'].includes(el.dataset.s)) return flightDetail(t[0].id);
        editStepDate(id, el.dataset.s);
      },
      arrive: async (el) => {
        const o = order(id);
        const it = o.items[+el.dataset.i];
        if (!it || it.flight) return;
        // Un encargo antiguo (sin lista) que ya estaba en el almacén: se marcan todos antes de cambiar uno.
        if (!o.items.some((x) => x.arrived || x.flight) && reached(o, 'almacen')) for (const x of o.items) x.arrived = o.dates.warehouse || today();
        it.arrived = it.arrived ? '' : today();
        syncOrderStatus(o);
        await commit();
        vibrate();
        snackbar(o.status === 'almacen' ? 'Todo el encargo está en el almacén' : `${arrivedCount(o)} de ${o.items.length} productos en el almacén`);
      },
      trip: (el) => flightDetail(el.dataset.f),
      pay: () => paymentEditor(id),
      payment: (el) => paymentEditor(id, el.dataset.pid),
      refund: () => refundEditor(id),
      calendar: () => addToCalendar(order(id)),
      pasteEta: async () => {
        const date = await askArrivalText();
        if (!date) return;
        order(id).etaWarehouse = date;
        await commit();
      },
    },
  });
}
const ACC_ICON = { tarjeta: 'card', efectivo: 'cash' };

function timeline(o, e) {
  const d = o.dates || {};
  const rows = [];
  let prevDate = d.created;
  for (const [s, label] of STATUS) {
    if (s === 'pendiente') {
      rows.push(li({ ic: 'edit', color: 'gray', title: 'Encargo anotado', sub: d.created ? fmtDateLong(d.created) : '', cls: 'tl done' }));
      continue;
    }
    const key = STATUS_DATE[s];
    const date = d[key];
    const isDone = !!date && reached(o, s);
    let sub = '';
    let right = '';
    if (isDone) {
      sub = fmtDateLong(date);
      if (s === 'enviado' && tripsOf(o).length) sub += ` · ${tripsOf(o).map(tripName).join(', ')}`;
      if (prevDate && ['almacen', 'cuba'].includes(s)) {
        const from = s === 'almacen' ? d.bought : d.warehouse;
        if (from) right = `<small>${daysBetween(from, date)} días ${s === 'almacen' ? 'desde la compra' : 'desde el almacén'}</small>`;
      }
      prevDate = date;
    } else if (o.status !== 'cancelado') {
      if (s === 'almacen') sub = `${arrivedCount(o) ? `${arrivedCount(o)} de ${o.items.length} productos ya llegaron · ` : ''}Previsto: ${fmtDateLong(e.warehouse)}${e.whAuto ? ' (aprox.)' : ''}`;
      if (s === 'enviado' && e.departure) sub = `Sale ${departureLabel(e.departure)}`;
      if (s === 'cuba') sub = `Previsto: ${fmtDateLong(e.cuba)}${e.cubaAuto ? ' (aprox.)' : ''}`;
      if (s === 'almacen' && o.status === 'comprado' && e.warehouse < today()) right = '<small class="red-t">atrasado</small>';
      if (s === 'cuba' && o.status === 'enviado' && e.cuba < today()) right = '<small class="red-t">atrasado</small>';
    }
    rows.push(li({ act: isDone || (o.status === 'comprado' && s === 'almacen' && !arrivedCount(o)) ? 'step' : '', attrs: `data-s="${s}"`, ic: s === 'enviado' ? METHODS[methodOf(o)].ic : STATUS_ICON[s], color: isDone ? STATUS_COLOR[s] : 'gray', title: s === 'enviado' ? `${label} (${methodLabel(methodOf(o)).toLowerCase()})` : label, sub, right, cls: `tl ${isDone ? 'done' : 'todo'}`, chev: false }));
  }
  if (d.bought && d.cuba) rows.push(`<div class="li tl-total"><span class="grow">Tiempo total hasta Cuba</span><b>${daysBetween(d.bought, d.cuba)} días</b></div>`);
  return rows.join('');
}

/** ¿Se pueden marcar los productos al llegar al almacén? */
const checkable = (o) => ['comprado', 'almacen'].includes(o.status) && !legacyShipped(o);

function itemRows(o) {
  const w = itemLbs(o);
  const showW = hasItemWeights(o);
  return o.items.map((it, i) => {
    const f = it.flight ? flight(it.flight) : null;
    const arrived = itemArrived(o, it);
    const info = [
      `${usd(it.price)}${num(it.qty) > 1 ? ' c/u' : ''}`,
      showW && w[i] ? lbs(w[i]) : '',
      f ? `<a data-act="trip" data-f="${f.id}" class="link-t">${esc(tripName(f))}</a>${f.arrived ? ' · en Cuba' : ''}` : arrived && it.arrived ? `en el almacén desde ${fmtDate(it.arrived)}` : arrived ? 'en el almacén' : '',
      it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">ver enlace</a>` : '',
    ].filter(Boolean).join(' · ');
    const title = `${num(it.qty) > 1 ? `${num(it.qty)} × ` : ''}${esc(it.desc || 'Producto')}`;
    if (!checkable(o)) return li({ title, sub: info, right: usd(num(it.qty) * num(it.price)) });
    return `<button class="li check-li item-li ${arrived ? 'on' : ''}" data-act="arrive" data-i="${i}" ${it.flight ? 'disabled' : ''}>
      <span class="cbox"><input type="checkbox" tabindex="-1" ${arrived ? 'checked' : ''}><span>${icon('check')}</span></span>
      <span class="grow"><span class="t">${title}</span><span class="s">${info}</span></span><span class="r">${usd(num(it.qty) * num(it.price))}</span></button>`;
  }).join('');
}

/** El botón grande de la ficha: el siguiente paso del encargo. */
async function advance(id, to) {
  const o = order(id);
  if (to === 'almacen') return arrivalPage(id);
  if (to === 'enviado') {
    const m = methodOf(o);
    const open = openTrips(m).slice(0, 3);
    if (!open.length) return flightEditor(null, { method: m });
    const a = await menuSheet({
      title: `¿En qué ${METHODS[m].trip.toLowerCase()} sale?`,
      actions: [
        ...open.map((f) => ({ label: `Añadir al ${tripName(f)}`, sub: `Sale ${departureLabel(f.date)}`, ic: METHODS[m].ic, value: () => flightEditor(f.id, { add: id }) })),
        { label: `Nuevo ${METHODS[m].trip.toLowerCase()} con lo que hay en el almacén`, ic: 'plus', value: () => flightEditor(null, { method: m }) },
      ],
    });
    return a?.();
  }
  if (to === 'cuba') {
    const t = tripsOf(o).filter((f) => !f.arrived);
    if (!t.length) return statusPage(id, 'cuba');
    for (const f of t) await arriveFlight(f.id);
    return;
  }
  statusPage(id, to);
}

/** «Llegó al almacén»: marcar qué productos llegaron (el peso es opcional y puede ponerse después). */
function arrivalPage(id) {
  const o = order(id);
  const d = { date: today(), sel: {}, w: {} };
  o.items.forEach((it, i) => {
    d.sel[i] = !itemArrived(o, it);
    d.w[i] = it.w ?? '';
  });
  openPage({
    title: 'Llegó al almacén',
    data: d,
    action: { label: 'Guardar', act: 'save' },
    render: () => `
      <div class="form">
        <div class="card"><b>${esc(clientLabel(o.client))}</b><div class="dim">${esc(orderTitle(o))}</div></div>
        ${tf('Fecha de llegada', `<input class="inp" type="date" data-bind="date" value="${d.date}">`)}
      </div>
      ${secTitle('¿Qué llegó?')}
      <div class="list">${o.items.map((it, i) => {
        const already = itemArrived(o, it);
        return `<div class="li check-li arrive-li">
          <label class="cbox"><input type="checkbox" data-bind="sel.${i}" ${already || d.sel[i] ? 'checked' : ''} ${already ? 'disabled' : ''}><span>${icon('check')}</span></label>
          <span class="grow"><span class="t">${num(it.qty) > 1 ? `${num(it.qty)} × ` : ''}${esc(it.desc || 'Producto')}</span><span class="s">${already ? `Ya estaba${it.arrived ? ` desde ${fmtDate(it.arrived)}` : ''}` : usd(it.price)}</span></span>
          <label class="mini-w"><input class="inp" data-bind="w.${i}" inputmode="decimal" value="${esc(d.w[i])}" placeholder="peso"><span>lb</span></label>
        </div>`;
      }).join('')}</div>
      <p class="hint">El peso no hace falta ahora: lo que paga el cliente se calcula con él, pero el envío real se cuenta con el peso y el precio total del vuelo.</p>`,
    acts: {
      save: async (el, ev, pg) => {
        const cur = order(id);
        let n = 0;
        cur.items.forEach((it, i) => {
          if (d.sel[i] && !itemArrived(cur, it)) {
            it.arrived = d.date;
            n++;
          }
          if (d.w[i] !== '' && d.w[i] != null) it.w = round2(num(d.w[i]));
        });
        if (!cur.items.some((x) => x.arrived || x.flight) && !n) return pg.close();
        if (hasItemWeights(cur)) {
          cur.weightLb = orderLbs(cur);
          cur.weightReal = true;
        }
        syncOrderStatus(cur);
        await commit();
        vibrate(25);
        pg.close();
        snackbar(cur.status === 'almacen' ? 'Todo el encargo está en el almacén' : `${arrivedCount(cur)} de ${cur.items.length} productos en el almacén`);
      },
    },
  });
}

async function editStepDate(id, s) {
  const o = order(id);
  const key = STATUS_DATE[s];
  const done = !!o.dates[key] && reached(o, s);
  const v = await dialog({
    title: done ? `Fecha: ${STATUS_LABEL[s]}` : 'Llegada prevista al almacén',
    message: done ? 'Corrige el día si te equivocaste.' : 'Escribe la fecha que da la tienda (o déjala vacía para calcularla).',
    input: { type: 'date', value: done ? o.dates[key] : o.etaWarehouse || orderEta(o).warehouse },
    buttons: [{ label: 'Cancelar', value: null }, { label: 'Guardar', value: true }],
  });
  if (v === null) return;
  if (done) {
    if (!v) return;
    o.dates[key] = v;
    if (s === 'almacen') for (const it of o.items) if (it.arrived) it.arrived = v;
  } else o.etaWarehouse = v || '';
  await commit();
}

/* ---------- cambiar de estado ---------- */
export function statusPage(id, to) {
  const o = order(id);
  const k0 = orderCalc(o);
  const d = { date: today(), weight: o.weightLb === '' ? '' : String(o.weightLb), collect: String(Math.max(0, k0.due)), account: 'efectivo', shipCost: '', eta: '' };
  openPage({
    title: NEXT_LABEL[to] || STATUS_LABEL[to],
    data: d,
    action: { label: 'Guardar', act: 'save' },
    render: () => {
      const tmp = { ...o, weightLb: d.weight === '' ? o.weightLb : num(d.weight), weightReal: true };
      const k = orderCalc(tmp);
      return `
      <div class="form">
        <div class="card"><b>${esc(clientLabel(o.client))}</b><div class="dim">${esc(orderTitle(o))}</div></div>
        ${tf('Fecha', `<input class="inp" type="date" data-bind="date" value="${d.date}">`)}
        ${to === 'almacen' ? `${tf('Peso real (lo pesa el almacén)', numInp('weight', d.weight, 'placeholder="0.0"'), { suffix: 'lb', help: 'Con el peso real se recalcula lo que paga el cliente.' })}
          <div class="card" data-sum>${priceRows(tmp)}</div>
          <p class="hint">Tardó ${daysBetween(o.dates.bought || o.dates.created, d.date)} días desde la compra.</p>` : ''}
        ${to === 'enviado' ? `${o.weightLb === '' ? tf('Peso', numInp('weight', d.weight, 'placeholder="0.0"'), { suffix: 'lb' }) : ''}
          <div class="card">${kv('Método', methodLabel(methodOf(o)))}${kv(`Costo del envío (${lbs(k.shipLb)} × ${usd(o.lbCost)})`, usd(k.shipCost))}${kv('Se paga con', ACC_SHORT[o.shipFrom])}</div>
          ${tf('Llegada prevista a Cuba (opcional)', `<input class="inp" type="date" data-bind="eta" value="${d.eta}">`, { help: `Si la dejas vacía: unos ${cubaDays(methodOf(o))} días (${methodLabel(methodOf(o)).toLowerCase()}), ${fmtDate(addDays(d.date, cubaDays(methodOf(o))))}.` })}` : ''}
        ${to === 'cuba' && o.dates.shipped ? `<p class="hint">Tardó ${daysBetween(o.dates.shipped, d.date)} días desde que salió del almacén.</p>` : ''}
        ${to === 'entregado' ? `
          <div class="card">${kv('Precio', usd(k0.total))}${kv('Ya pagó', usd(k0.paid))}${kv('Falta', usd(k0.due), k0.due > 0 ? 'amber strong' : 'green strong')}</div>
          ${k0.due > 0.004 ? `${tf('Cobrar ahora', numInp('collect', d.collect), { suffix: 'USD', help: 'Pon 0 si te lo paga después.' })}
          ${seg('account', Object.entries(ACC_SHORT), d.account)}` : ''}` : ''}
      </div>`;
    },
    afterBind: (pg, key) => {
      if (key === 'weight' || key === 'date') {
        const s = $('[data-sum]', pg.body);
        if (s && key === 'weight') s.innerHTML = priceRows({ ...o, weightLb: d.weight === '' ? o.weightLb : num(d.weight) });
        if (key === 'date') pg.render();
      }
    },
    acts: {
      seg: (el, ev, pg) => {
        d.account = el.dataset.v;
        pg.render();
      },
      save: async (el, ev, pg) => {
        const cur = order(id);
        if (!cur) return pg.close();
        if (to === 'almacen' && d.weight === '' && !(await confirmDlg('Sin peso', '¿Guardar sin el peso? Lo puedes poner después en «Editar».', 'Guardar'))) return;
        cur.status = to;
        cur.dates[STATUS_DATE[to]] = d.date;
        ensureDates(cur);
        if (d.weight !== '' && (to === 'almacen' || to === 'enviado')) {
          cur.weightLb = round2(num(d.weight));
          cur.weightReal = to === 'almacen' ? true : cur.weightReal;
        }
        if (to === 'enviado' && d.eta) cur.etaCuba = d.eta;
        if (to === 'entregado' && num(d.collect) > 0) (cur.payments = cur.payments || []).push({ id: uid(), ts: Date.now(), date: d.date, amount: round2(num(d.collect)), account: d.account });
        await commit();
        vibrate(25);
        pg.close();
        const k = orderCalc(cur);
        snackbar(to === 'entregado' ? (k.due > 0.004 ? `Entregado · debe ${usd(k.due)}` : 'Entregado y cobrado') : `${STATUS_LABEL[to]} · ${clientLabel(cur.client)}`);
      },
    },
  });
}

/** Enviar a Cuba lo que hay en el almacén: se anota como un vuelo (o barco) con su peso y precio total. */
export function bulkShipPage(method = null) {
  return flightEditor(null, method ? { method } : {});
}

/* ---------- cobros ---------- */
export function paymentEditor(id, pid = null) {
  const o = order(id);
  const p = pid ? o.payments.find((x) => x.id === pid) : null;
  const k = orderCalc(o);
  const d = p ? { amount: String(p.amount), account: p.account, date: p.date } : { amount: String(Math.max(0, k.due) || ''), account: 'efectivo', date: today() };
  openPage({
    title: p ? 'Editar cobro' : 'Registrar cobro',
    data: d,
    action: { label: 'Guardar', act: 'save' },
    menu: p ? () => [{ label: 'Eliminar cobro', ic: 'trash', danger: true, value: async () => {
      if (!(await confirmDlg('Eliminar cobro', '¿Seguro?', 'Eliminar', true))) return;
      o.payments = o.payments.filter((x) => x.id !== pid);
      await commit();
      topPage()?.close();
    } }] : null,
    render: () => `
      <div class="form">
        <div class="card">${kv('Cliente', esc(clientLabel(o.client)))}${kv('Precio', usd(k.total))}${kv('Ya pagó', usd(k.paid - (p ? num(p.amount) : 0)))}</div>
        ${tf('Cobrado', numInp('amount', d.amount, 'placeholder="0"'), { suffix: 'USD' })}
        <div class="lbl">¿Dónde entró el dinero?</div>
        ${seg('account', Object.entries(ACCOUNTS), d.account)}
        <div class="tf-help">Normalmente el cliente paga en efectivo en Cuba. Si un familiar te lo pagó por transferencia, elige la tarjeta.</div>
        ${tf('Fecha', `<input class="inp" type="date" data-bind="date" value="${d.date}">`)}
      </div>`,
    acts: {
      seg: (el, ev, pg) => {
        d.account = el.dataset.v;
        pg.render();
      },
      save: async (el, ev, pg) => {
        if (num(d.amount) <= 0) return snackbar('Escribe lo que pagó');
        const cur = order(id);
        const rec = { id: p?.id || uid(), ts: p?.ts || Date.now(), date: d.date, amount: round2(num(d.amount)), account: d.account };
        cur.payments = (cur.payments || []).filter((x) => x.id !== rec.id).concat(rec);
        await commit();
        pg.close();
        const due = orderCalc(cur).due;
        snackbar(due > 0.004 ? `Cobrado ${usd(rec.amount)} · falta ${usd(due)}` : `Cobrado ${usd(rec.amount)} · ya está pagado`);
      },
    },
  });
}

async function refundEditor(id) {
  const o = order(id);
  const v = await promptDlg({ title: 'Devolución de la tienda', message: 'Lo que la tienda devolvió a la tarjeta (0 para quitarla).', value: o.refund ? String(o.refund.amount) : String(orderCalc(o).products), inputmode: 'decimal', suffix: 'USD', ok: 'Guardar' });
  if (v === null) return;
  o.refund = num(v) > 0 ? { amount: round2(num(v)), date: o.refund?.date || today(), account: 'tarjeta' } : null;
  await commit();
}

async function cancelOrder(id) {
  const o = order(id);
  const k = orderCalc(o);
  if (!(await confirmDlg('Cancelar encargo', k.spent ? `Ya se gastaron ${usd(k.spent)} en este encargo. Si la tienda te lo devuelve, anótalo después en la ficha.` : 'El encargo deja de contar en los pendientes.', 'Cancelar encargo', true))) return;
  o.prevStatus = o.status;
  o.status = 'cancelado';
  o.dates.cancelled = today();
  await commit();
  snackbar('Encargo cancelado');
}
async function uncancel(id) {
  const o = order(id);
  o.status = o.prevStatus || 'comprado';
  delete o.dates.cancelled;
  delete o.prevStatus;
  await commit();
  snackbar('Encargo recuperado');
}
async function deleteOrder(id) {
  if (!(await confirmDlg('Eliminar encargo', 'Se borrará por completo, con sus cobros. Si solo se canceló, mejor usa «Cancelar encargo».', 'Eliminar', true))) return;
  state.orders = state.orders.filter((o) => o.id !== id);
  await commit();
  topPage()?.close();
  snackbar('Encargo eliminado');
}

function addToCalendar(o) {
  const e = orderEta(o);
  const toWh = o.status === 'comprado';
  const date = toWh ? e.warehouse : e.cuba;
  const title = `${toWh ? 'Llega al almacén' : 'Llega a Cuba'}: ${clientLabel(o.client)}`;
  openCalendarFile(icsEvent({ date, title, description: `${orderTitle(o)} (${o.store})${o.tracking ? `\nSeguimiento: ${o.tracking}` : ''}`, alarmDays: num(state.settings.warnDays) || 1 }), `encargo-${date}.ics`);
  snackbar('Ábrelo para añadirlo a tu calendario');
}

/** Mensaje para el cliente con el estado y el precio. */
export function clientText(o) {
  const k = orderCalc(o);
  const e = orderEta(o);
  const L = [`📦 *Tu encargo* — ${orderTitle(o)}`];
  L.push(`Envío: ${methodLabel(methodOf(o))}`);
  L.push(`Estado: ${STATUS_LABEL[o.status]}${o.dates[STATUS_DATE[o.status]] ? ` (${fmtDate(o.dates[STATUS_DATE[o.status]])})` : ''}`);
  if (o.status === 'almacen' && e.departure) L.push(`Sale hacia Cuba ${departureLabel(e.departure)}`);
  if (o.status === 'comprado' || o.status === 'almacen' || o.status === 'enviado') L.push(`Llegada aproximada a Cuba: ${fmtDate(e.cuba)}`);
  L.push('');
  L.push(`💵 *Precio: ${usd(k.total)}*`);
  L.push(`  • Producto${o.items.length > 1 ? 's' : ''}: ${usd(k.products)}`);
  if (k.weight) L.push(`  • Envío ${methodLabel(methodOf(o)).toLowerCase()} ${lbs(k.lb)} × ${usd(o.lbPrice)}/lb: ${usd(k.weight)}${o.weightReal ? '' : ' (peso aproximado)'}`);
  if (k.fee) L.push(`  • Tarifa ${pct(o.feePct)}: ${usd(k.fee)}`);
  for (const x of o.extras || []) if (num(x.amount)) L.push(`  • ${x.label || 'Otro cargo'}: ${usd(x.amount)}`);
  if (k.paid) L.push(`Pagado: ${usd(k.paid)}${k.due > 0.004 ? ` · Falta: *${usd(k.due)}*` : ' ✅'}`);
  return L.join('\n');
}

/* ======================= clientes ======================= */
export function clientsPage() {
  openPage({
    title: 'Clientes',
    nav: 'back',
    live: true,
    data: { q: '' },
    render: (pg) => `
      <div class="search"><span>${icon('search')}</span><input type="search" data-search placeholder="Nombre o teléfono" value="${esc(pg.data.q)}" autocomplete="off"></div>
      <div data-results>${clientList(pg.data.q)}</div>`,
    onInput: (pg, el) => {
      if (!el.matches('[data-search]')) return;
      pg.data.q = el.value;
      $('[data-results]', pg.body).innerHTML = clientList(el.value);
    },
    acts: { client: (el) => clientPage(el.dataset.k) },
  });
}
function clientList(q) {
  const n = norm(q);
  const dq = digits(q);
  const list = clients().filter((c) => !n || norm(c.name).includes(n) || (dq && digits(c.phone).includes(dq))).sort((a, b) => b.due - a.due || (b.last || '').localeCompare(a.last || ''));
  if (!list.length) return emptyState('users', q ? 'Nadie con ese nombre o teléfono.' : 'Los clientes aparecen aquí al anotar encargos o remesas.');
  return `<div class="list">${list.map((c) => li({
    act: 'client', attrs: `data-k="${esc(c.key)}"`, ic: 'user', color: 'blue',
    title: esc(c.name || c.phone), sub: [c.name ? esc(c.phone) : '', c.orders ? `${c.orders} encargo${c.orders === 1 ? '' : 's'}` : '', c.remits ? `${c.remits} remesa${c.remits === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · '),
    right: c.due > 0.004 ? `<b class="amber-t">debe ${usd(c.due)}</b>` : c.spent ? usd(c.spent) : '',
  })).join('')}</div>`;
}
export function clientPage(key) {
  openPage({
    title: 'Cliente',
    nav: 'back',
    live: true,
    render: () => {
      const c = clients().find((x) => x.key === key);
      if (!c) return emptyState('user', 'Sin datos.');
      const ts = transitStats();
      const list = ordersOfClient(key).sort((a, b) => (b.dates.created || '').localeCompare(a.dates.created || ''));
      const rem = state.remits.filter((r) => clientKey(r.recipient, r.phone) === key);
      return `
        <div class="hero"><div class="hero-main"><span class="hero-n sm">${esc(c.name || c.phone)}</span><span class="hero-u">${esc(c.phone || '')}${c.address ? ` · ${esc(c.address)}` : ''}</span></div>
          <div class="hero-badges"><span class="badge">${c.orders} encargos · ${usd(c.spent)}</span>${c.due > 0.004 ? `<span class="badge amber">Debe ${usd(c.due)}</span>` : ''}</div>
          ${contactBtns(c.phone, c.address)}</div>
        <button class="btn tonal block" data-act="newFor">${icon('plus')} Nuevo encargo para ${esc(c.name || 'este cliente')}</button>
        ${list.length ? `${secTitle('Encargos')}<div class="list">${list.map((o) => orderRow(o, ts)).join('')}</div>` : ''}
        ${rem.length ? `${secTitle('Remesas que ha recibido')}<div class="list">${rem.map((r) => li({ act: 'remit', attrs: `data-id="${r.id}"`, ic: 'send', color: 'teal', title: usd(r.amount), sub: `${fmtDate(r.date)}${r.sender ? ` · de ${esc(r.sender)}` : ''}` })).join('')}</div>` : ''}`;
    },
    acts: {
      order: (el) => orderDetail(el.dataset.id),
      remit: (el) => import('./remit.js').then((m) => m.remitDetail(el.dataset.id)),
      newFor: () => {
        const c = clients().find((x) => x.key === key);
        orderEditor(null, { client: { name: c.name, phone: c.phone } });
      },
    },
  });
}

/** Elegir un encargo entre los abiertos (para buscar rápido). */
export async function pickOrder(title = 'Elegir encargo') {
  const list = state.orders.filter(isOpen);
  return pickFromList({ title, items: list.map((o) => ({ value: o.id, label: clientLabel(o.client), sub: `${esc(orderTitle(o))} · ${STATUS_LABEL[o.status]}`, right: usd(orderCalc(o).total) })) });
}
