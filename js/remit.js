// Remesas: alguien transfiere a la tarjeta de EE. UU. (con un % por encima) y aquí se entrega el efectivo.
// Para el negocio es un cambio de efectivo en Cuba por dinero en la tarjeta, y la comisión es la ganancia.
import { icon } from './icons.js';
import { state, num, round2, usd, pct, today, fmtDate, fmtDateLong, relDay, uid, ACC_SHORT, remit, remitCalc, remitReceive, clients, balance } from './store.js';
import { $, esc, openPage, topPage, dialog, confirmDlg, snackbar, pickFromList, seg, tf, inp, numInp, toggle, li, kv, secTitle, emptyState, contactBtns, vibrate } from './ui.js';
import { commit, shareText } from './core.js';

export function remitRow(r) {
  const k = remitCalc(r);
  const status = r.cancelled ? '<span class="red-t">Cancelada</span>'
    : r.deliveredAt ? `Entregada ${relDay(r.deliveredAt)}${r.receivedAt ? '' : ' · <span class="amber-t">falta la transferencia</span>'}`
    : `<span class="amber-t">Por entregar</span>${r.receivedAt ? ' · transferencia recibida' : ' · <span class="red-t">sin transferencia</span>'}`;
  return li({
    act: 'remit', attrs: `data-id="${r.id}"`, cls: r.cancelled ? 'void' : '',
    ic: r.deliveredAt ? 'checkCircle' : 'send', color: r.cancelled ? 'red' : r.deliveredAt ? 'green' : 'teal',
    title: esc(r.recipient || 'Sin nombre'),
    sub: `${r.address ? esc(r.address) + '<br>' : ''}${r.sender ? `De ${esc(r.sender)} · ` : ''}${status}`,
    right: `<b>${usd(k.amount)}</b><small class="green-t">+${usd(k.commission)}</small>`,
  });
}

/* ======================= formulario ======================= */
export function remitEditor(id = null, prefill = {}) {
  const ex = id ? remit(id) : null;
  const S = state.settings;
  const d = ex
    ? { mode: 'entregar', date: ex.date, sender: ex.sender || '', senderPhone: ex.senderPhone || '', recipient: ex.recipient || '', phone: ex.phone || '', address: ex.address || '', amount: String(ex.amount), pct: String(remitCalc(ex).pct), received: String(ex.received), recvTyped: true, receivedYes: !!ex.receivedAt, receivedAt: ex.receivedAt || today(), deliverCost: ex.deliverCost ? String(ex.deliverCost) : '', note: ex.note || '' }
    : { mode: 'entregar', date: today(), sender: '', senderPhone: '', recipient: '', phone: '', address: '', amount: '', pct: String(S.remitPct), received: '', recvTyped: false, receivedYes: true, receivedAt: today(), deliverCost: '', note: '', ...prefill };
  const calc = () => {
    if (d.mode === 'recibido') {
      const rec = num(d.received);
      const amount = round2(rec / (1 + num(d.pct) / 100));
      return { amount, received: rec };
    }
    return { amount: num(d.amount), received: d.recvTyped && d.received !== '' ? num(d.received) : remitReceive(d.amount, d.pct) };
  };
  const sumHtml = () => {
    const c = calc();
    return `${kv('Entregar en efectivo', usd(c.amount), 'strong')}${kv('Transferencia a la tarjeta', usd(c.received), 'strong')}${kv('Comisión', `${usd(c.received - c.amount)}${c.amount ? ` · ${pct(((c.received - c.amount) / c.amount) * 100)}` : ''}`, 'green strong')}`;
  };
  openPage({
    title: ex ? 'Editar remesa' : 'Nueva remesa',
    data: d,
    action: { label: 'Guardar', act: 'save' },
    render: () => `
      <div class="form">
        ${secTitle('Dinero')}
        ${seg('mode', [['entregar', 'Sé cuánto entregar'], ['recibido', 'Sé cuánto transfirieron']], d.mode)}
        ${d.mode === 'entregar' ? `
          <div class="row2">
            ${tf('Entregar en Cuba', numInp('amount', d.amount, 'placeholder="100"'), { suffix: 'USD' })}
            ${tf('Comisión', numInp('pct', d.pct), { suffix: '%' })}
          </div>
          ${tf('Transferencia que debe llegar', numInp('received', d.recvTyped ? d.received : '', 'placeholder="Automática"'), { suffix: 'USD', help: 'Se calcula sola; cámbiala si acordaron otra cantidad.' })}`
        : `<div class="row2">
            ${tf('Transfirieron', numInp('received', d.received, 'placeholder="101"'), { suffix: 'USD' })}
            ${tf('Comisión', numInp('pct', d.pct), { suffix: '%' })}
          </div>`}
        <div class="card" data-sum>${sumHtml()}</div>

        ${secTitle('Quién recibe en Cuba', '<button class="text-btn" data-act="pickRecipient">Elegir uno anterior</button>')}
        ${tf('Nombre', inp('recipient', d.recipient, 'placeholder="A quién se le entrega" autocapitalize="words"'))}
        ${tf('Teléfono', inp('phone', d.phone, 'type="tel" inputmode="tel"'))}
        ${tf('Dirección', `<textarea class="inp ta" data-bind="address" rows="2" placeholder="Calle, número, entre calles, reparto, municipio">${esc(d.address)}</textarea>`)}

        ${secTitle('Quién envía')}
        ${tf('Nombre (opcional)', inp('sender', d.sender, 'placeholder="Quién hizo la transferencia"'))}
        ${tf('Teléfono (opcional)', inp('senderPhone', d.senderPhone, 'type="tel" inputmode="tel"'))}

        ${secTitle('Transferencia')}
        <label class="li check-li"><span class="grow"><span class="t">Ya llegó a la tarjeta</span><span class="s">Si no, queda pendiente de comprobar</span></span>${toggle('receivedYes', d.receivedYes)}</label>
        ${d.receivedYes ? tf('Fecha en que llegó', `<input class="inp" type="date" data-bind="receivedAt" value="${d.receivedAt}">`) : ''}
        ${tf('Fecha de la remesa', `<input class="inp" type="date" data-bind="date" value="${d.date}">`)}
        ${tf('Nota (opcional)', inp('note', d.note, 'placeholder="Ej. entregar por la tarde"'))}
      </div>`,
    afterBind: (pg, key) => {
      if (key === 'received' && d.mode === 'entregar') d.recvTyped = d.received !== '';
      if (key === 'receivedYes') return pg.render();
      const s = $('[data-sum]', pg.body);
      if (s) s.innerHTML = sumHtml();
    },
    acts: {
      seg: (el, ev, pg) => {
        const c = calc();
        d.mode = el.dataset.v;
        // Al cambiar de modo se conservan las cantidades.
        d.amount = c.amount ? String(c.amount) : '';
        d.received = c.received ? String(c.received) : '';
        d.recvTyped = d.mode === 'entregar' ? false : true;
        pg.render();
      },
      pickRecipient: async (el, ev, pg) => {
        const seen = new Map();
        for (const r of [...state.remits].sort((a, b) => b.ts - a.ts)) {
          const key = `${r.recipient}|${r.phone}`;
          if (!seen.has(key)) seen.set(key, r);
        }
        for (const c of clients()) if (c.name && !seen.has(`${c.name}|${c.phone}`)) seen.set(`${c.name}|${c.phone}`, { recipient: c.name, phone: c.phone, address: c.address });
        const list = [...seen.values()];
        const v = await pickFromList({ title: 'Elegir persona', items: list.map((r, i) => ({ value: String(i), label: r.recipient || r.phone, sub: esc([r.phone, r.address].filter(Boolean).join(' · ')) })), searchPlaceholder: 'Nombre o teléfono' });
        if (v === null) return;
        const r = list[+v];
        Object.assign(d, { recipient: r.recipient || '', phone: r.phone || '', address: r.address || '' });
        if (r.sender) Object.assign(d, { sender: r.sender, senderPhone: r.senderPhone || '' });
        pg.render();
      },
      save: async (el, ev, pg) => {
        const c = calc();
        if (c.amount <= 0) return snackbar('Escribe cuánto hay que entregar');
        if (!d.recipient.trim() && !d.phone.trim()) return snackbar('Escribe a quién se le entrega');
        const cur = ex ? remit(ex.id) : null;
        const rec = cur || { id: uid(), ts: Date.now(), deliveredAt: null, deliverCost: 0, receivedTo: 'tarjeta', paidFrom: 'efectivo' };
        Object.assign(rec, {
          date: d.date, sender: d.sender.trim(), senderPhone: d.senderPhone.trim(), recipient: d.recipient.trim(), phone: d.phone.trim(), address: d.address.trim(),
          amount: round2(c.amount), received: round2(c.received), receivedAt: d.receivedYes ? d.receivedAt : null, note: d.note.trim(),
        });
        if (!cur) state.remits.push(rec);
        S.remitPct = num(d.pct) || S.remitPct;
        await commit();
        pg.close();
        snackbar(cur ? 'Remesa guardada' : `Remesa para ${rec.recipient} · entregar ${usd(rec.amount)}`);
        if (!cur) remitDetail(rec.id);
      },
    },
  });
}

/* ======================= ficha ======================= */
export function remitDetail(id) {
  openPage({
    title: 'Remesa',
    nav: 'back',
    live: true,
    menu: () => {
      const r = remit(id);
      if (!r) return [];
      return [
        { label: 'Editar', ic: 'edit', value: () => remitEditor(id) },
        { label: 'Enviar datos de la entrega', sub: 'Para el mensajero o quien la entregue', ic: 'share', value: () => shareText(deliveryText(r), 'Entrega') },
        { label: 'Repetir para la misma persona', ic: 'plus', value: () => remitEditor(null, { recipient: r.recipient, phone: r.phone, address: r.address, sender: r.sender, senderPhone: r.senderPhone, pct: String(remitCalc(r).pct) }) },
        { label: r.cancelled ? 'Recuperar remesa' : 'Cancelar remesa', ic: r.cancelled ? 'undo' : 'close', value: () => toggleCancel(id) },
        { label: 'Eliminar', ic: 'trash', danger: true, value: () => deleteRemit(id) },
      ];
    },
    render: () => {
      const r = remit(id);
      if (!r) return emptyState('send', 'Esta remesa ya no existe.');
      const k = remitCalc(r);
      return `
        ${r.cancelled ? `<div class="banner red">${icon('close')}<span>Remesa cancelada: no cuenta en el dinero ni en las ganancias.</span></div>` : ''}
        <div class="hero">
          <div class="hero-main"><span class="hero-u">Entregar a ${esc(r.recipient || 'Sin nombre')}</span><span class="hero-n">${usd(k.amount)}</span>
          <span class="hero-u">${r.address ? esc(r.address) : 'Sin dirección'}</span></div>
          <div class="hero-badges">${r.deliveredAt ? `<span class="badge green">${icon('check')}Entregada ${fmtDate(r.deliveredAt)}</span>` : '<span class="badge amber">Por entregar</span>'}
            ${r.receivedAt ? `<span class="badge blue">${icon('card')}Transferencia recibida</span>` : `<span class="badge red">${icon('warning')}Falta la transferencia</span>`}</div>
          ${contactBtns(r.phone, r.address)}
        </div>
        ${!r.cancelled && !r.deliveredAt ? `<button class="btn filled block lg" data-act="deliver">${icon('hand')} Ya se entregó</button>` : ''}
        ${!r.cancelled && !r.receivedAt ? `<button class="btn tonal block" data-act="received">${icon('card')} Ya llegó la transferencia</button>` : ''}
        ${secTitle('Cambio de dinero')}
        <div class="card">
          ${kv(`Entra en la tarjeta${r.receivedAt ? ` (${fmtDate(r.receivedAt)})` : ''}`, `+${usd(k.received)}`, r.receivedAt ? 'green' : '')}
          ${kv(`Sale del efectivo${r.deliveredAt ? ` (${fmtDate(r.deliveredAt)})` : ''}`, `−${usd(k.amount)}`)}
          ${k.cost ? kv('Costo de la entrega', `−${usd(k.cost)}`) : ''}
          <div class="divider"></div>
          ${kv(`Ganancia (comisión ${pct(k.pct)})`, usd(k.profit), 'green big')}
        </div>
        ${secTitle('Datos')}
        <div class="list">
          ${li({ ic: 'user', title: esc(r.recipient || '—'), sub: esc(r.phone || 'Sin teléfono') })}
          ${r.sender || r.senderPhone ? li({ ic: 'globe', title: `Envía: ${esc(r.sender || '—')}`, sub: esc(r.senderPhone || '') }) : ''}
          ${li({ ic: 'calendar', title: fmtDateLong(r.date), sub: 'Fecha de la remesa' })}
        </div>
        ${r.note ? `<div class="card note-card">${icon('edit')}<span>${esc(r.note)}</span></div>` : ''}
        ${r.by ? `<p class="hint">Último cambio: ${esc(r.by)}.</p>` : ''}`;
    },
    acts: {
      deliver: () => deliverDialog(id),
      received: async () => {
        const v = await dialog({ title: 'Transferencia recibida', message: '¿Qué día llegó a la tarjeta?', input: { type: 'date', value: today() }, buttons: [{ label: 'Cancelar', value: null }, { label: 'Guardar', value: true }] });
        if (!v) return;
        remit(id).receivedAt = v;
        await commit();
        snackbar('Transferencia anotada en la tarjeta');
      },
    },
  });
}

export function deliverDialog(id) {
  const r = remit(id);
  const d = { date: today(), deliverCost: '' };
  const cash = balance('efectivo');
  openPage({
    title: 'Entregar remesa',
    data: d,
    action: { label: 'Entregada', act: 'save' },
    render: () => `
      <div class="form">
        <div class="card">${kv('Entregar a', esc(r.recipient))}${kv('Efectivo', usd(r.amount), 'big')}</div>
        ${cash < num(r.amount) ? `<div class="banner amber">${icon('warning')}<span>En el efectivo hay ${usd(cash)}: no alcanza para esta entrega.</span></div>` : ''}
        ${tf('Fecha de entrega', `<input class="inp" type="date" data-bind="date" value="${d.date}">`)}
        ${tf('Costo de la entrega (opcional)', numInp('deliverCost', d.deliverCost, 'placeholder="0"'), { suffix: 'USD', help: 'Lo que cobró el mensajero, si lo hubo. Se resta de la ganancia de esta remesa.' })}
        ${!r.receivedAt ? `<div class="banner red">${icon('warning')}<span>Todavía no está anotada la transferencia. Cuando llegue, márcala en la ficha.</span></div>` : ''}
      </div>`,
    acts: {
      save: async (el, ev, pg) => {
        const cur = remit(id);
        cur.deliveredAt = d.date;
        cur.deliverCost = round2(num(d.deliverCost));
        await commit();
        vibrate(25);
        pg.close();
        snackbar(`Entregados ${usd(cur.amount)} a ${cur.recipient}`);
      },
    },
  });
}

async function toggleCancel(id) {
  const r = remit(id);
  if (!r.cancelled && !(await confirmDlg('Cancelar remesa', 'Deja de contar en el dinero y en los pendientes.', 'Cancelar remesa', true))) return;
  r.cancelled = !r.cancelled;
  await commit();
}
async function deleteRemit(id) {
  if (!(await confirmDlg('Eliminar remesa', 'Se borrará por completo.', 'Eliminar', true))) return;
  state.remits = state.remits.filter((r) => r.id !== id);
  await commit();
  topPage()?.close();
  snackbar('Remesa eliminada');
}

/** Datos para quien va a entregar el dinero. */
export function deliveryText(r) {
  return [
    `💵 *Entregar ${usd(r.amount)}*`,
    `👤 ${r.recipient}${r.phone ? ` · ${r.phone}` : ''}`,
    r.address ? `📍 ${r.address}` : '',
    r.sender ? `De parte de: ${r.sender}` : '',
    r.note ? `📝 ${r.note}` : '',
  ].filter(Boolean).join('\n');
}

/** Lista de todas las entregas pendientes para compartir. */
export function pendingText(list) {
  const L = [`📋 *Remesas por entregar* (${list.length}) — ${usd(list.reduce((a, r) => a + num(r.amount), 0))}`, ''];
  for (const r of list) L.push(deliveryText(r), '');
  return L.join('\n').trim();
}
