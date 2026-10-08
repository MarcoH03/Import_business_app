// Pruebas de los cálculos y de la fusión de la sincronización (sin navegador).
// Uso: node tools/test-logic.mjs
import assert from 'node:assert/strict';
const S = await import('../js/store.js');
const Y = await import('../js/sync.js');
const ok = (m) => console.log('✓', m);

// Precio de un encargo
const o = S.newOrder({ items: [{ desc: 'Zapatos', qty: 1, price: 40 }, { desc: 'Pomos', qty: 2, price: 5 }], weightLb: 3.2, lbPrice: 4.5, lbCost: 2.5 });
let k = S.orderCalc(o);
assert.equal(k.products, 50); assert.equal(k.weight, 14.4); assert.equal(k.fee, 0); assert.equal(k.total, 64.4); assert.equal(k.shipCost, 8); assert.equal(k.profit, 6.4);
o.feeOn = true; o.feePct = 10; o.roundLb = true; o.roundTotal = 1;
k = S.orderCalc(o);
assert.equal(k.lb, 4); assert.equal(k.weight, 18); assert.equal(k.fee, 5); assert.equal(k.total, 73); assert.equal(k.shipCost, 10);
ok('precio del encargo');
// Remesa
assert.equal(S.remitReceive(100, 1), 101);
const r = { amount: 100, received: 101, deliverCost: 0, receivedAt: '2026-10-01', deliveredAt: '2026-10-02' };
assert.equal(S.remitCalc(r).profit, 1); assert.equal(S.remitCalc(r).doneDate, '2026-10-02');
ok('remesa');
// Métodos de envío: tarifas y días por separado
const air = S.newOrder({ method: 'aereo', weightLb: 10, items: [{ desc: 'x', qty: 1, price: 20 }] });
const sea = S.newOrder({ method: 'maritimo', weightLb: 10, items: [{ desc: 'x', qty: 1, price: 20 }] });
assert.equal(S.orderCalc(air).total, 65); assert.equal(S.orderCalc(air).shipCost, 25);
assert.equal(S.orderCalc(sea).total, 45); assert.equal(S.orderCalc(sea).shipCost, 12);
air.status = sea.status = 'enviado'; air.dates.shipped = sea.dates.shipped = '2026-10-01';
assert.equal(S.orderEta(air).cuba, '2026-10-08'); assert.equal(S.orderEta(sea).cuba, '2026-10-31');
ok('envío aéreo y marítimo');
// Lectura de fechas de llegada
const ref = '2026-10-07';
assert.equal(S.parseArrival('Arriving Tuesday, October 14', ref), '2026-10-14');
assert.equal(S.parseArrival('Llega el 9 de oct.', ref), '2026-10-09');
assert.equal(S.parseArrival('Estimated delivery: Oct 12 - Oct 16', ref), '2026-10-16');
assert.equal(S.parseArrival('Arriving tomorrow', ref), '2026-10-08');
assert.equal(S.parseArrival('Entrega estimada 10/15', ref), '2026-10-15');
assert.equal(S.parseArrival('Llega el 3 de enero', ref), '2027-01-03');
assert.equal(S.parseArrival('Arriving Friday', ref), '2026-10-09');
assert.equal(S.guessCarrier('1Z999AA10123456784'), 'UPS');
assert.equal(S.guessCarrier('TBA123456789012'), 'Amazon');
assert.equal(S.guessCarrier('9400111899223197428490'), 'USPS');
ok('fechas y transportistas');

// Seguimiento de cambios y fusión entre dos teléfonos
const st = S.state;
Y.resetSnapshot();
st.orders.push({ ...o, id: 'A' });
st.expenses.push({ id: 'E1', date: ref, amount: 5, cat: 'Otros', account: 'efectivo', biz: 'ambos' });
assert.equal(Y.track(), 2);
assert.ok(st.orders[0].upd > 0);
const phone1 = JSON.parse(JSON.stringify(st));
const phone2 = JSON.parse(JSON.stringify(st));
// teléfono 1 edita el encargo y borra el gasto; teléfono 2 añade una remesa y cambia la libra
await new Promise((res) => setTimeout(res, 5));
phone1.orders[0].note = 'editado'; phone1.orders[0].upd = Date.now();
phone1.expenses = []; phone1.tombs.push({ id: 'E1', col: 'expenses', upd: Date.now() });
phone2.remits.push({ id: 'R1', amount: 100, received: 101, upd: Date.now() });
phone2.settings.airPrice = 5; phone2.meta.supd.airPrice = Date.now();
phone1.settings.seaPrice = 3; phone1.meta.supd.seaPrice = Date.now();
const m12 = Y.mergeStates(phone1, phone2);
const m21 = Y.mergeStates(phone2, phone1);
assert.equal(Y.signature(m12), Y.signature(m21));
assert.equal(m12.orders[0].note, 'editado');
assert.equal(m12.expenses.length, 0);
assert.equal(m12.remits.length, 1);
assert.equal(m12.settings.airPrice, 5);
assert.equal(m12.settings.seaPrice, 3);
assert.equal(Y.signature(Y.mergeStates(m12, m21)), Y.signature(m12));
ok('fusión: conmutativa, idempotente, respeta borrados y ajustes');
// Dos cierres del mismo día → queda uno
const c1 = JSON.parse(JSON.stringify(m12)); c1.closures.push({ id: 'C1', date: ref, upd: 1 }); c1.moves.push({ id: 'C1-dif', type: 'cierre', ref: 'C1', date: ref, account: 'efectivo', amount: -2, upd: 1 });
const c2 = JSON.parse(JSON.stringify(m12)); c2.closures.push({ id: 'C2', date: ref, upd: 2 });
const mc = Y.mergeStates(c1, c2);
assert.equal(mc.closures.length, 1); assert.equal(mc.closures[0].id, 'C2'); assert.equal(mc.moves.filter((x) => x.type === 'cierre').length, 0);
ok('un solo cierre por día');
// Cifrado
const key = Y.newKey();
const sealed = await Y.seal({ hola: 'mundo', n: [1, 2, 3] }, key);
assert.deepEqual(await Y.unseal(sealed, key), { hola: 'mundo', n: [1, 2, 3] });
await assert.rejects(() => Y.unseal(sealed, Y.newKey()));
const code = Y.encodeCode({ g: 'abc123', t: 'ghp_x', k: key });
assert.deepEqual(Y.decodeCode(code), { g: 'abc123', t: 'ghp_x', k: key });
ok('cifrado y código del grupo');
// Datos de la versión 1.0 (una sola tarifa) se convierten al abrir
const ce = console.error;
console.error = () => {}; // en Node no hay IndexedDB: el guardado falla, pero la conversión se hace igual
await S.replaceState({ settings: { lbPrice: 5.5, lbCost: 3, cubaDays: 15 }, orders: [{ id: 'v1', items: [], dates: {}, lbPrice: 5.5, lbCost: 3 }] });
console.error = ce;
assert.equal(S.state.settings.airPrice, 5.5); assert.equal(S.state.settings.airCost, 3); assert.equal(S.state.settings.seaPrice, 2.5);
assert.equal(S.state.settings.lbPrice, undefined); assert.equal(S.state.orders[0].method, 'aereo');
ok('migración de la tarifa única a la aérea');
console.log('Todo bien');
