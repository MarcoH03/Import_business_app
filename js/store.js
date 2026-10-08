// Estado de la aplicación, guardado en el teléfono (IndexedDB) y todos los cálculos del negocio.
// Todo el dinero se lleva en USD, en dos cuentas: la tarjeta de EE. UU. y el efectivo en Cuba.
// GitHub solo aloja el código: los datos viven en cada teléfono (y, si se activa, en la sincronización).

export const APP_VERSION = '1.1.0';
const DB_NAME = 'import-business';
const DB_STORE = 'kv';
const LS_KEY = 'import-business-state';

/* ---------- utilidades ---------- */
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const pad = (n) => String(n).padStart(2, '0');
export const toDateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => toDateStr(new Date());
export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}
/** Días entre dos fechas (b − a). */
export const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 864e5);
export function fmtDate(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
export const fmtDateLong = (s) => cap(parseDate(s).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }));
export const fmtDateShort = (s) => parseDate(s).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '');
export function fmtTime(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** «hoy», «mañana», «en 3 días», «hace 2 días». */
export function relDay(s, ref = today()) {
  const n = daysBetween(ref, s);
  if (n === 0) return 'hoy';
  if (n === 1) return 'mañana';
  if (n === -1) return 'ayer';
  return n > 0 ? `en ${n} días` : `hace ${-n} días`;
}
export function num(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
  return isFinite(n) ? n : 0;
}
export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
/** Dólares: «1,234.50 USD», «−20 USD». */
export function usd(n, unit = true) {
  n = round2(num(n));
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return (n < 0 ? '−' : '') + (unit ? '$' : '') + s;
}
export const lbs = (n) => `${round2(num(n))} lb`;
export const pct = (n) => `${round2(num(n))}%`;
export function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
export const digits = (s) => String(s || '').replace(/\D/g, '');
export const sum = (arr, f) => arr.reduce((a, x) => a + num(f(x)), 0);
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* ---------- catálogos ---------- */
export const ACCOUNTS = { tarjeta: 'Tarjeta EE. UU.', efectivo: 'Efectivo Cuba' };
export const ACC_SHORT = { tarjeta: 'Tarjeta', efectivo: 'Efectivo' };
export const BIZ = { encargos: 'Encargos', remesas: 'Remesas', ambos: 'Los dos negocios' };
export const STATUS = [
  ['pendiente', 'Por comprar'],
  ['comprado', 'Comprado'],
  ['almacen', 'En el almacén'],
  ['enviado', 'Enviado a Cuba'],
  ['cuba', 'Llegó a Cuba'],
  ['entregado', 'Entregado'],
];
export const STATUS_LABEL = Object.fromEntries([...STATUS, ['cancelado', 'Cancelado']]);
export const STATUS_DATE = { comprado: 'bought', almacen: 'warehouse', enviado: 'shipped', cuba: 'cuba', entregado: 'delivered', cancelado: 'cancelled' };
export const STATUS_ORDER = STATUS.map(([k]) => k);
export const STORES = ['Amazon', 'SHEIN', 'Temu', 'Walmart', 'eBay', 'AliExpress', 'Otra tienda'];
export const EXPENSE_CATS = ['Mensajería', 'Transporte', 'Teléfono e internet', 'Comisiones bancarias', 'Embalaje', 'Aduana', 'Publicidad', 'Imprevistos', 'Otros'];
/**
 * Métodos de envío del almacén a Cuba. Cada uno tiene su cobro por libra al cliente,
 * lo que nos cuesta la libra y los días que tarda (claves planas en Ajustes: airPrice, seaCost…).
 */
export const METHODS = {
  aereo: { label: 'Aéreo', ic: 'plane', price: 'airPrice', cost: 'airCost', days: 'airDays' },
  maritimo: { label: 'Marítimo', ic: 'ship', price: 'seaPrice', cost: 'seaCost', days: 'seaDays' },
};
export const methodOf = (o) => (METHODS[o?.method] ? o.method : 'aereo');
export const methodLabel = (m) => METHODS[m]?.label || METHODS.aereo.label;
/** Tarifas actuales de un método según Ajustes. */
export function methodRates(m, S = state.settings) {
  const k = METHODS[m] || METHODS.aereo;
  return { lbPrice: num(S[k.price]), lbCost: num(S[k.cost]), days: num(S[k.days]) };
}
export const MOVE_TYPES = { inicial: 'Dinero inicial', aporte: 'Dinero añadido', retiro: 'Dinero retirado', ajuste: 'Ajuste por conteo', traspaso: 'Pasar dinero', cierre: 'Diferencia del cierre' };

/** Colecciones de registros que se sincronizan (cada registro tiene id, y la sincronización añade upd y by). */
export const COLLECTIONS = ['orders', 'remits', 'expenses', 'workers', 'payroll', 'moves', 'closures'];

export function defaultSettings() {
  return {
    business: 'Import Business',
    // Envío aéreo y marítimo: cobro por libra al cliente, lo que nos cuesta la libra y días del almacén a Cuba.
    airPrice: 4.5,
    airCost: 2.5,
    airDays: 7,
    seaPrice: 2.5,
    seaCost: 1.2,
    seaDays: 30,
    defaultMethod: 'aereo',
    roundLb: false, // cobrar libras completas (redondear hacia arriba)
    feeOn: false, // % sobre el precio del producto, apagado por defecto
    feePct: 10,
    roundTotal: 0, // redondear el precio final hacia arriba a 0.5, 1 o 5 USD (0 = no)
    remitPct: 1, // comisión de las remesas por defecto
    payFrom: 'tarjeta', // con qué se pagan las compras en la tienda
    shipFrom: 'tarjeta', // con qué se paga el envío a Cuba
    storeDays: { Amazon: 4, SHEIN: 9, Temu: 10, Walmart: 5, eBay: 6, AliExpress: 15, 'Otra tienda': 7 }, // días hasta el almacén
    warnDays: 2, // avisar con estos días de antelación
    warehouse: 'Almacén en Miami',
    expenseCats: [...EXPENSE_CATS],
    stores: [...STORES],
  };
}
/** Ajustes de este teléfono (no se sincronizan). */
export function defaultLocal() {
  return {
    user: '',
    device: '',
    onboarded: false,
    seenVersion: '',
    lastBackup: null,
    notify: false,
    sync: { enabled: false, code: '', auto: true, lastSync: null, lastError: '', lastRemote: null },
  };
}

export function defaultState() {
  return {
    version: 1,
    settings: defaultSettings(),
    orders: [], // encargos
    remits: [], // remesas: transferencia a la tarjeta → efectivo entregado en Cuba
    expenses: [], // {id, ts, date, cat, amount, account, biz, note}
    workers: [], // {id, name, phone, role, archived}
    payroll: [], // {id, ts, date, workerId, amount, account, biz, note}
    moves: [], // {id, ts, date, type, account, amount (con signo), to, note}
    closures: [], // {id, ts, date, counted, diff, note, text, summary}
    tombs: [], // registros borrados: {id, col, upd}
    meta: { supd: {} }, // fecha de cambio de cada ajuste compartido
  };
}

function migrate(s) {
  const d = defaultState();
  // Versión 1.0: una sola tarifa por libra → pasa a ser la del envío aéreo.
  const old = s.settings || {};
  if (old.lbPrice !== undefined && old.airPrice === undefined) {
    old.airPrice = old.lbPrice;
    old.airCost = old.lbCost ?? d.settings.airCost;
  }
  for (const k of ['lbPrice', 'lbCost', 'cubaDays']) delete old[k];
  for (const o of s.orders || []) if (!o.method) o.method = 'aereo';
  for (const k of Object.keys(d)) if (s[k] === undefined) s[k] = d[k];
  s.settings = { ...d.settings, ...s.settings, storeDays: { ...d.settings.storeDays, ...(s.settings?.storeDays || {}) } };
  s.meta = { supd: {}, ...s.meta };
  s.version = d.version;
  return s;
}

/* ---------- guardado: IndexedDB con respaldo en localStorage ---------- */
let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(DB_STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}
export async function idbGet(key) {
  if (useLS) {
    const v = localStorage.getItem(`${LS_KEY}:${key}`);
    return v === null ? undefined : JSON.parse(v);
  }
  const d = await db();
  return new Promise((res, rej) => {
    const r = d.transaction(DB_STORE).objectStore(DB_STORE).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function idbPut(key, val) {
  if (useLS) {
    localStorage.setItem(`${LS_KEY}:${key}`, JSON.stringify(val));
    return true;
  }
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(val, key);
    tx.oncomplete = () => res(true);
    tx.onerror = () => rej(tx.error);
  });
}

export let state = defaultState();
export let local = defaultLocal();
let useLS = false;

export async function init() {
  let raw = null;
  let loc = null;
  try {
    raw = await idbGet('state');
    loc = await idbGet('local');
  } catch (e) {
    console.warn('IndexedDB no disponible, se usa localStorage', e);
    useLS = true;
    raw = await idbGet('state');
    loc = await idbGet('local');
  }
  try {
    if (raw) state = migrate(typeof raw === 'string' ? JSON.parse(raw) : raw);
  } catch (e) {
    console.error(e);
  }
  if (loc) local = { ...defaultLocal(), ...loc, sync: { ...defaultLocal().sync, ...(loc.sync || {}) } };
  return state;
}

export async function save() {
  try {
    await idbPut('state', JSON.stringify(state));
    await idbPut('local', local);
    await idbPut('reminders', reminders());
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}
export const saveLocal = () => idbPut('local', local).catch(() => false);

export function replaceState(next) {
  state = migrate(next);
  return save();
}

/* ======================= encargos ======================= */
export const order = (id) => state.orders.find((o) => o.id === id);
export const isOpen = (o) => o.status !== 'entregado' && o.status !== 'cancelado';
export const statusIdx = (s) => STATUS_ORDER.indexOf(s);
/** ¿El encargo ya pasó por ese estado? */
export const reached = (o, s) => o.status !== 'cancelado' ? statusIdx(o.status) >= statusIdx(s) : !!o.dates?.[STATUS_DATE[s]];

/** Método de envío con sus tarifas actuales (para un encargo nuevo o al cambiar de método). */
export function withMethod(m, S = state.settings) {
  const r = methodRates(m, S);
  return { method: METHODS[m] ? m : 'aereo', lbPrice: r.lbPrice, lbCost: r.lbCost };
}

export function newOrder(prefill = {}) {
  const S = state.settings;
  return {
    id: uid(), ts: Date.now(),
    client: { name: '', phone: '' },
    items: [{ desc: '', qty: 1, price: '', url: '' }],
    store: S.stores[0] || 'Amazon', storeOrder: '', tracking: '', carrier: '',
    status: 'comprado',
    dates: { created: today(), bought: today() },
    etaWarehouse: '', etaCuba: '',
    weightLb: '', weightReal: false,
    ...withMethod(prefill.method || S.defaultMethod || 'aereo', S), roundLb: S.roundLb, feeOn: S.feeOn, feePct: S.feePct, roundTotal: S.roundTotal,
    extras: [], priceOverride: '', shipCost: '',
    payFrom: S.payFrom, shipFrom: S.shipFrom,
    payments: [], refund: null, note: '',
    ...prefill,
  };
}

/** Todos los importes de un encargo con sus precios guardados (cambiar los ajustes no altera encargos ya hechos). */
export function orderCalc(o) {
  const products = round2(sum(o.items, (it) => num(it.qty || 1) * num(it.price)));
  const w = num(o.weightLb);
  const lb = o.roundLb ? Math.ceil(w - 1e-9) : w;
  const weight = round2(lb * num(o.lbPrice));
  const fee = o.feeOn ? round2(products * num(o.feePct) / 100) : 0;
  const extras = round2(sum(o.extras || [], (e) => e.amount));
  const subtotal = round2(products + weight + fee + extras);
  const step = num(o.roundTotal);
  const auto = step > 0 ? round2(Math.ceil(round2(subtotal / step) - 1e-9) * step) : subtotal;
  const total = o.priceOverride !== '' && o.priceOverride !== null && o.priceOverride !== undefined ? round2(num(o.priceOverride)) : auto;
  const shipCost = o.shipCost !== '' && o.shipCost !== null && o.shipCost !== undefined ? round2(num(o.shipCost)) : round2(lb * num(o.lbCost));
  const cost = round2(products + shipCost);
  const paid = round2(sum(o.payments || [], (p) => p.amount));
  const refund = round2(num(o.refund?.amount));
  // Lo gastado de verdad hasta ahora: el producto si ya se compró y el envío si ya salió hacia Cuba.
  const spent = round2((reached(o, 'comprado') ? products : 0) + (reached(o, 'enviado') ? shipCost : 0));
  const profit = o.status === 'cancelado' ? round2(paid + refund - spent) : round2(total - cost);
  return {
    products, lb: round2(lb), weight, fee, extras, subtotal, auto, total, shipCost, cost, paid, refund, spent, profit,
    due: o.status === 'cancelado' ? 0 : round2(total - paid),
    units: sum(o.items, (it) => num(it.qty || 1)),
  };
}

export const orderTitle = (o) => o.items.map((it) => `${num(it.qty) > 1 ? `${num(it.qty)}× ` : ''}${it.desc || 'Producto'}`).join(', ') || 'Encargo';
export const clientLabel = (c) => c?.name || c?.phone || 'Sin nombre';

/* ---------- tiempos de llegada ---------- */
function avg(list) {
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
}
/** Días medidos en encargos reales: compra → almacén (por tienda) y envío → llegada a Cuba. */
export function transitStats() {
  const byStore = {};
  const toWh = [];
  const ship = [];
  const whToCuba = [];
  const total = [];
  const byMethod = Object.fromEntries(Object.keys(METHODS).map((m) => [m, { ship: [], whToCuba: [], total: [] }]));
  for (const o of state.orders) {
    const d = o.dates || {};
    const bm = byMethod[methodOf(o)];
    if (d.bought && d.warehouse) {
      const n = daysBetween(d.bought, d.warehouse);
      if (n >= 0) {
        (byStore[o.store] = byStore[o.store] || []).push(n);
        toWh.push(n);
      }
    }
    if (d.shipped && d.cuba) {
      const n = daysBetween(d.shipped, d.cuba);
      if (n >= 0) {
        ship.push(n);
        bm.ship.push(n);
      }
    }
    if (d.warehouse && d.cuba) {
      const n = daysBetween(d.warehouse, d.cuba);
      if (n >= 0) {
        whToCuba.push(n);
        bm.whToCuba.push(n);
      }
    }
    if (d.bought && d.cuba) {
      const n = daysBetween(d.bought, d.cuba);
      if (n >= 0) {
        total.push(n);
        bm.total.push(n);
      }
    }
  }
  return {
    stores: Object.entries(byStore).map(([store, l]) => ({ store, n: l.length, avg: avg(l), min: Math.min(...l), max: Math.max(...l) })).sort((a, b) => b.n - a.n),
    toWarehouse: { n: toWh.length, avg: avg(toWh) },
    transit: { n: ship.length, avg: avg(ship) },
    whToCuba: { n: whToCuba.length, avg: avg(whToCuba) },
    total: { n: total.length, avg: avg(total) },
    methods: Object.fromEntries(Object.entries(byMethod).map(([m, x]) => [m, {
      transit: { n: x.ship.length, avg: avg(x.ship) },
      whToCuba: { n: x.whToCuba.length, avg: avg(x.whToCuba) },
      total: { n: x.total.length, avg: avg(x.total) },
    }])),
  };
}
const MIN_SAMPLES = 3;
/** Días que suele tardar una tienda en llevar al almacén (aprendido con 3+ encargos; si no, el de Ajustes). */
export function storeDays(store, ts = transitStats()) {
  const s = ts.stores.find((x) => x.store === store);
  if (s && s.n >= MIN_SAMPLES) return Math.round(s.avg);
  return num(state.settings.storeDays[store] ?? state.settings.storeDays['Otra tienda'] ?? 7) || 7;
}
/** Días del almacén a Cuba de un método (aprendido con 3+ envíos de ese método; si no, el de Ajustes). */
export function cubaDays(method = 'aereo', ts = transitStats()) {
  const t = ts.methods[METHODS[method] ? method : 'aereo'].transit;
  return t.n >= MIN_SAMPLES ? Math.round(t.avg) : methodRates(method).days || (method === 'maritimo' ? 30 : 7);
}
/** Fecha prevista de llegada al almacén y a Cuba (la escrita a mano manda sobre la calculada). */
export function orderEta(o, ts = transitStats()) {
  const d = o.dates || {};
  const base = d.bought || d.created || today();
  const wh = d.warehouse || o.etaWarehouse || addDays(base, storeDays(o.store, ts));
  const whAuto = !d.warehouse && !o.etaWarehouse;
  // A Cuba: desde el envío; si todavía no salió del almacén, una estimación que se mueve cada día.
  let cuba = d.cuba || o.etaCuba;
  let cubaAuto = false;
  if (!cuba) {
    cubaAuto = true;
    const from = d.shipped || (d.warehouse ? (today() > d.warehouse ? today() : d.warehouse) : wh > today() ? wh : today());
    cuba = addDays(from, cubaDays(methodOf(o), ts));
  }
  return { warehouse: wh, cuba, whAuto, cubaAuto };
}

/** Lo que viene: llegadas al almacén y a Cuba, para avisar y para el cierre. */
export function upcoming(ref = today()) {
  const ts = transitStats();
  const warn = num(state.settings.warnDays);
  const toWarehouse = [];
  const toCuba = [];
  const inCuba = [];
  const toBuy = [];
  for (const o of state.orders) {
    if (!isOpen(o)) continue;
    const e = orderEta(o, ts);
    if (o.status === 'pendiente') toBuy.push({ o });
    else if (o.status === 'comprado') toWarehouse.push({ o, date: e.warehouse, auto: e.whAuto, days: daysBetween(ref, e.warehouse) });
    else if (o.status === 'enviado') toCuba.push({ o, date: e.cuba, auto: e.cubaAuto, days: daysBetween(ref, e.cuba) });
    else if (o.status === 'cuba') inCuba.push({ o });
  }
  const byDate = (a, b) => a.date.localeCompare(b.date);
  toWarehouse.sort(byDate);
  toCuba.sort(byDate);
  const soon = (x) => x.days <= warn;
  return {
    toBuy, toWarehouse, toCuba, inCuba,
    warehouseSoon: toWarehouse.filter(soon),
    cubaSoon: toCuba.filter(soon),
    atWarehouse: state.orders.filter((o) => o.status === 'almacen'),
  };
}

/** Recordatorios que el service worker puede mostrar aunque la app esté cerrada (Android). */
export function reminders() {
  const out = [];
  const warn = num(state.settings.warnDays);
  const ts = transitStats();
  for (const o of state.orders) {
    if (o.status !== 'comprado' && o.status !== 'enviado') continue;
    const e = orderEta(o, ts);
    const date = o.status === 'comprado' ? e.warehouse : e.cuba;
    const where = o.status === 'comprado' ? 'al almacén' : 'a Cuba';
    const who = clientLabel(o.client);
    out.push({ key: `${o.id}:${o.status}:${date}:pre`, date: addDays(date, -warn), title: `Pronto llega ${where}`, body: `${orderTitle(o)} · ${who} · previsto el ${fmtDate(date)}`, tag: o.id });
    out.push({ key: `${o.id}:${o.status}:${date}:day`, date, title: `Hoy debería llegar ${where}`, body: `${orderTitle(o)} · ${who}`, tag: o.id });
  }
  return out;
}

/* ---------- clientes (sacados de los encargos y remesas) ---------- */
export function clients() {
  const m = new Map();
  const add = (name, phone, extra = {}) => {
    if (!name && !phone) return null;
    const k = digits(phone).slice(-8) || norm(name);
    const c = m.get(k) || { key: k, name: '', phone: '', address: '', orders: 0, remits: 0, spent: 0, due: 0, last: '' };
    if (name) c.name = name;
    if (phone) c.phone = phone;
    if (extra.address) c.address = extra.address;
    m.set(k, c);
    return c;
  };
  for (const o of state.orders) {
    const c = add(o.client?.name, o.client?.phone);
    if (!c) continue;
    const k = orderCalc(o);
    c.orders++;
    if (o.status !== 'cancelado') {
      c.spent += k.total;
      c.due += k.due;
    }
    if ((o.dates.created || '') > c.last) c.last = o.dates.created;
  }
  for (const r of state.remits) {
    const c = add(r.recipient, r.phone, { address: r.address });
    if (!c) continue;
    c.remits++;
    if ((r.date || '') > c.last) c.last = r.date;
  }
  return [...m.values()].map((c) => ({ ...c, spent: round2(c.spent), due: round2(c.due) }));
}
export const clientKey = (name, phone) => digits(phone).slice(-8) || norm(name);
export const ordersOfClient = (key) => state.orders.filter((o) => clientKey(o.client?.name, o.client?.phone) === key);

/* ======================= remesas ======================= */
export const remit = (id) => state.remits.find((r) => r.id === id);
/** Lo que hay que recibir en la tarjeta para entregar `amount` con una comisión de `p` %. */
export const remitReceive = (amount, p) => round2(num(amount) * (1 + num(p) / 100));
export function remitCalc(r) {
  const amount = round2(num(r.amount));
  const received = round2(num(r.received));
  const cost = round2(num(r.deliverCost));
  return {
    amount, received, cost,
    commission: round2(received - amount),
    profit: round2(received - amount - cost),
    pct: amount ? round2(((received - amount) / amount) * 100) : 0,
    done: !!(r.receivedAt && r.deliveredAt),
    doneDate: r.receivedAt && r.deliveredAt ? (r.receivedAt > r.deliveredAt ? r.receivedAt : r.deliveredAt) : null,
  };
}
export const activeRemits = () => state.remits.filter((r) => !r.cancelled);
export const pendingRemits = () => activeRemits().filter((r) => !r.deliveredAt);

/* ======================= trabajadores ======================= */
export const worker = (id) => state.workers.find((w) => w.id === id);
export const workerName = (id) => worker(id)?.name || 'Trabajador';

/* ======================= dinero: tarjeta y efectivo ======================= */
/**
 * Todos los movimientos de una cuenta, ya calculados a partir de los registros:
 * [{date, ts, amount, label, note, kind, id, biz}]. Nada se guarda como saldo: así la sincronización no descuadra.
 */
export function moneyEntries(account, { from = null, to = null, skipClosureOf = null } = {}) {
  const inR = (d) => !!d && !((from && d < from) || (to && d > to));
  const out = [];
  const push = (e) => e.amount && out.push(e);
  for (const o of state.orders) {
    const k = orderCalc(o);
    const who = clientLabel(o.client);
    const d = o.dates || {};
    if (o.payFrom === account && reached(o, 'comprado') && inR(d.bought)) push({ date: d.bought, ts: o.ts, amount: -k.products, label: `Compra en ${o.store}`, note: `${orderTitle(o)} · ${who}`, kind: 'order', id: o.id, biz: 'encargos' });
    if (o.shipFrom === account && reached(o, 'enviado') && inR(d.shipped)) push({ date: d.shipped, ts: o.ts + 1, amount: -k.shipCost, label: 'Envío a Cuba', note: `${lbs(k.lb)} · ${who}`, kind: 'order', id: o.id, biz: 'encargos' });
    for (const p of o.payments || []) if (p.account === account && inR(p.date)) push({ date: p.date, ts: p.ts || o.ts, amount: num(p.amount), label: 'Cobro de encargo', note: `${who} · ${orderTitle(o)}`, kind: 'order', id: o.id, biz: 'encargos', income: true });
    if (o.refund && account === (o.refund.account || 'tarjeta') && inR(o.refund.date)) push({ date: o.refund.date, ts: o.ts + 2, amount: num(o.refund.amount), label: 'Devolución de la tienda', note: orderTitle(o), kind: 'order', id: o.id, biz: 'encargos', income: true });
  }
  for (const r of state.remits) {
    if (r.cancelled) continue;
    const k = remitCalc(r);
    if ((r.receivedTo || 'tarjeta') === account && r.receivedAt && inR(r.receivedAt)) push({ date: r.receivedAt, ts: r.ts, amount: k.received, label: 'Remesa recibida', note: `${r.sender ? r.sender + ' → ' : ''}${r.recipient}`, kind: 'remit', id: r.id, biz: 'remesas', income: true });
    if ((r.paidFrom || 'efectivo') === account && r.deliveredAt && inR(r.deliveredAt)) {
      push({ date: r.deliveredAt, ts: r.ts + 1, amount: -k.amount, label: 'Remesa entregada', note: `${r.recipient}${r.address ? ' · ' + r.address : ''}`, kind: 'remit', id: r.id, biz: 'remesas' });
      push({ date: r.deliveredAt, ts: r.ts + 2, amount: -k.cost, label: 'Costo de la entrega', note: r.recipient, kind: 'remit', id: r.id, biz: 'remesas' });
    }
  }
  for (const e of state.expenses) if (e.account === account && inR(e.date)) push({ date: e.date, ts: e.ts, amount: -num(e.amount), label: `Gasto · ${e.cat}`, note: e.note, kind: 'expense', id: e.id, biz: e.biz });
  for (const p of state.payroll) if (p.account === account && inR(p.date)) push({ date: p.date, ts: p.ts, amount: -num(p.amount), label: `Pago a ${workerName(p.workerId)}`, note: p.note, kind: 'payroll', id: p.id, biz: p.biz });
  for (const m of state.moves) {
    if (!inR(m.date)) continue;
    if (skipClosureOf && m.type === 'cierre' && m.date === skipClosureOf) continue;
    if (m.type === 'traspaso') {
      if (m.account === account) push({ date: m.date, ts: m.ts, amount: -Math.abs(num(m.amount)), label: `Pasado a ${ACC_SHORT[m.to]}`, note: m.note, kind: 'move', id: m.id });
      if (m.to === account) push({ date: m.date, ts: m.ts, amount: Math.abs(num(m.amount)), label: `Recibido de ${ACC_SHORT[m.account]}`, note: m.note, kind: 'move', id: m.id });
    } else if (m.account === account) push({ date: m.date, ts: m.ts, amount: num(m.amount), label: MOVE_TYPES[m.type] || m.type, note: m.note, kind: 'move', id: m.id, type: m.type });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts);
}
export const balance = (account, upTo = null, opts = {}) => round2(sum(moneyEntries(account, { to: upTo, ...opts }), (e) => e.amount));

/** Lo que falta por mover: cobros pendientes, remesas por entregar y envíos por pagar. */
export function pending() {
  let due = 0;
  let dueN = 0;
  let ship = 0;
  for (const o of state.orders) {
    if (o.status === 'cancelado') continue;
    const k = orderCalc(o);
    if (k.due > 0.004) {
      due += k.due;
      dueN++;
    }
    if (!reached(o, 'enviado')) ship += k.shipCost;
  }
  const pr = pendingRemits();
  return {
    due: round2(due), dueN,
    remits: round2(sum(pr, (r) => r.amount)), remitsN: pr.length,
    toReceive: round2(sum(activeRemits().filter((r) => !r.receivedAt), (r) => r.received)),
    ship: round2(ship),
  };
}

/* ======================= periodos y estadísticas ======================= */
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export function weekStart(s) {
  const d = parseDate(s);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toDateStr(d);
}
/** kind: 'dia' | 'semana' | 'mes' | 'ano' */
export function periodRange(kind, anchor) {
  const d = parseDate(anchor);
  if (kind === 'dia') return { from: anchor, to: anchor, label: fmtDateLong(anchor), prev: addDays(anchor, -1), next: addDays(anchor, 1) };
  if (kind === 'semana') {
    const from = weekStart(anchor);
    const to = addDays(from, 6);
    const a = parseDate(from);
    const b = parseDate(to);
    const label = a.getMonth() === b.getMonth()
      ? `${a.getDate()} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]} ${b.getFullYear()}`
      : `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]} ${b.getFullYear()}`;
    return { from, to, label, prev: addDays(from, -7), next: addDays(from, 7) };
  }
  if (kind === 'mes') {
    const from = toDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
    const to = toDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    return { from, to, label: cap(`${MONTHS[d.getMonth()]} ${d.getFullYear()}`), prev: toDateStr(new Date(d.getFullYear(), d.getMonth() - 1, 1)), next: toDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 1)) };
  }
  return { from: `${d.getFullYear()}-01-01`, to: `${d.getFullYear()}-12-31`, label: String(d.getFullYear()), prev: `${d.getFullYear() - 1}-01-01`, next: `${d.getFullYear() + 1}-01-01` };
}

/** Gastos y pagos de un periodo repartidos por negocio («los dos» va a medias). */
function costsByBiz(list) {
  const out = { encargos: 0, remesas: 0, ambos: 0 };
  for (const x of list) out[x.biz in out ? x.biz : 'ambos'] += num(x.amount);
  return { encargos: round2(out.encargos), remesas: round2(out.remesas), ambos: round2(out.ambos) };
}

/**
 * Resumen de un periodo. Un encargo cuenta su ganancia el día que se entrega (o se cancela);
 * una remesa, el día en que ya se recibió la transferencia y se entregó el efectivo.
 */
export function stats(from, to) {
  const inR = (d) => !!d && d >= from && d <= to;
  const delivered = state.orders.filter((o) => o.status === 'entregado' && inR(o.dates.delivered));
  const cancelled = state.orders.filter((o) => o.status === 'cancelado' && inR(o.dates.cancelled));
  const E = { count: delivered.length, revenue: 0, products: 0, shipCost: 0, weight: 0, fee: 0, extras: 0, profit: 0, lb: 0, cancelled: cancelled.length, cancelLoss: 0 };
  const byMethod = Object.fromEntries(Object.keys(METHODS).map((m) => [m, { count: 0, lb: 0, weight: 0, shipCost: 0, profit: 0 }]));
  for (const o of delivered) {
    const k = orderCalc(o);
    const bm = byMethod[methodOf(o)];
    bm.count++;
    bm.lb += k.lb;
    bm.weight += k.weight;
    bm.shipCost += k.shipCost;
    bm.profit += k.profit;
    E.revenue += k.total;
    E.products += k.products;
    E.shipCost += k.shipCost;
    E.weight += k.weight;
    E.fee += k.fee;
    E.extras += k.total - k.products - k.weight - k.fee;
    E.profit += k.profit;
    E.lb += k.lb;
  }
  for (const o of cancelled) {
    const k = orderCalc(o);
    E.cancelLoss += k.profit;
    E.profit += k.profit;
  }
  const remits = activeRemits().filter((r) => inR(remitCalc(r).doneDate));
  const R = { count: remits.length, volume: 0, received: 0, commission: 0, cost: 0, profit: 0 };
  for (const r of remits) {
    const k = remitCalc(r);
    R.volume += k.amount;
    R.received += k.received;
    R.commission += k.commission;
    R.cost += k.cost;
    R.profit += k.profit;
  }
  for (const o of [E, R]) for (const k of Object.keys(o)) o[k] = round2(o[k]);
  for (const x of Object.values(byMethod)) for (const k of Object.keys(x)) x[k] = round2(x[k]);
  E.byMethod = byMethod;
  const expenses = state.expenses.filter((e) => inR(e.date));
  const payroll = state.payroll.filter((p) => inR(p.date));
  const ex = costsByBiz(expenses);
  const pay = costsByBiz(payroll);
  const shared = round2(ex.ambos + pay.ambos);
  const netE = round2(E.profit - ex.encargos - pay.encargos - shared / 2);
  const netR = round2(R.profit - ex.remesas - pay.remesas - shared / 2);
  const byCat = new Map();
  for (const e of expenses) byCat.set(e.cat, (byCat.get(e.cat) || 0) + num(e.amount));
  // Dinero que entró de clientes en cada cuenta.
  const income = { tarjeta: 0, efectivo: 0 };
  const out = { tarjeta: 0, efectivo: 0 };
  for (const acc of ['tarjeta', 'efectivo']) {
    for (const e of moneyEntries(acc, { from, to })) {
      if (e.kind === 'move') continue;
      if (e.amount > 0) income[acc] += e.amount;
      else out[acc] -= e.amount;
    }
    income[acc] = round2(income[acc]);
    out[acc] = round2(out[acc]);
  }
  const bought = state.orders.filter((o) => reached(o, 'comprado') && inR(o.dates.bought));
  return {
    E, R, ex, pay, shared, netE, netR,
    net: round2(netE + netR),
    expenses: round2(sum(expenses, (e) => e.amount)),
    payroll: round2(sum(payroll, (p) => p.amount)),
    expenseList: expenses, payrollList: payroll,
    byCat: [...byCat.entries()].map(([cat, v]) => ({ cat, v: round2(v) })).sort((a, b) => b.v - a.v),
    income, out,
    delivered, cancelled, remits,
    bought, boughtTotal: round2(sum(bought, (o) => orderCalc(o).products)),
    newRemits: state.remits.filter((r) => !r.cancelled && inR(r.date)),
  };
}

/** Barras del gráfico: [{label, from, to, e, r}] con la ganancia de cada negocio. */
export function buckets(kind, from, to) {
  const out = [];
  if (kind === 'ano') {
    const y = from.slice(0, 4);
    for (let m = 0; m < 12; m++) out.push({ label: MONTHS_SHORT[m], from: `${y}-${pad(m + 1)}-01`, to: toDateStr(new Date(+y, m + 1, 0)) });
  } else if (kind === 'dia') {
    out.push({ label: fmtDateShort(from), from, to });
  } else {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const dd = parseDate(d);
      out.push({ label: kind === 'semana' ? ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'][dd.getDay()] : String(dd.getDate()), from: d, to: d });
    }
  }
  return out.map((b) => {
    const s = stats(b.from, b.to);
    return { ...b, e: s.netE, r: s.netR, net: s.net };
  });
}

/* ======================= cierre del día ======================= */
export function closureData(date) {
  const st = stats(date, date);
  const day = (acc) => moneyEntries(acc, { from: date, to: date, skipClosureOf: date });
  const cashDay = day('efectivo');
  const cardDay = day('tarjeta');
  const opening = balance('efectivo', addDays(date, -1));
  const moves = round2(sum(cashDay.filter((e) => e.kind === 'move'), (e) => e.amount));
  const cashIn = round2(sum(cashDay.filter((e) => e.kind !== 'move' && e.amount > 0), (e) => e.amount));
  const cashOut = round2(sum(cashDay.filter((e) => e.kind !== 'move' && e.amount < 0), (e) => -e.amount));
  const ev = (key) => state.orders.filter((o) => o.dates?.[key] === date);
  return {
    date, st, opening, moves, cashIn, cashOut,
    expected: round2(opening + cashIn - cashOut + moves),
    cardOpening: balance('tarjeta', addDays(date, -1)),
    cardIn: round2(sum(cardDay.filter((e) => e.amount > 0 && e.kind !== 'move'), (e) => e.amount)),
    cardOut: round2(sum(cardDay.filter((e) => e.amount < 0 && e.kind !== 'move'), (e) => -e.amount)),
    card: balance('tarjeta', date),
    collected: round2(sum(state.orders.flatMap((o) => o.payments || []).filter((p) => p.date === date), (p) => p.amount)),
    events: { bought: ev('bought'), warehouse: ev('warehouse'), shipped: ev('shipped'), cuba: ev('cuba'), delivered: ev('delivered') },
    remitsIn: state.remits.filter((r) => !r.cancelled && r.receivedAt === date),
    remitsOut: state.remits.filter((r) => !r.cancelled && r.deliveredAt === date),
    up: upcoming(date),
    pend: pending(),
    saved: state.closures.find((c) => c.date === date) || null,
  };
}

/** ¿Se anotó algo de ese día después de guardar su cierre? */
export function closureOutdated(date) {
  const c = state.closures.find((x) => x.date === date);
  if (!c) return false;
  const changed = (x) => (x.upd || x.ts) > c.ts;
  return state.orders.some((o) => changed(o) && Object.values(o.dates || {}).includes(date))
    || state.remits.some((r) => changed(r) && (r.receivedAt === date || r.deliveredAt === date))
    || state.expenses.some((x) => x.date === date && changed(x))
    || state.payroll.some((x) => x.date === date && changed(x))
    || state.moves.some((x) => x.date === date && changed(x) && x.type !== 'cierre');
}

export function saveClosure(date, counted, note, text) {
  const d = closureData(date);
  const has = counted !== '' && counted !== null && counted !== undefined;
  const diff = has ? round2(num(counted) - d.expected) : 0;
  const prev = state.closures.find((c) => c.date === date);
  state.moves = state.moves.filter((m) => !(m.type === 'cierre' && m.date === date));
  const id = prev?.id || uid();
  if (diff) state.moves.push({ id: `${id}-dif`, ts: Date.now(), date, account: 'efectivo', amount: diff, type: 'cierre', note: diff > 0 ? 'Sobró efectivo al contar' : 'Faltó efectivo al contar', ref: id });
  const rec = {
    id, ts: Date.now(), date, expected: d.expected, counted: has ? round2(num(counted)) : null, diff, note, text,
    summary: { net: d.st.net, netE: d.st.netE, netR: d.st.netR, cash: round2(d.expected + diff), card: d.card, income: round2(d.st.income.tarjeta + d.st.income.efectivo) },
  };
  state.closures = state.closures.filter((c) => c.date !== date);
  state.closures.push(rec);
  return rec;
}

/* ======================= seguimiento de paquetes ======================= */
/** Adivina la empresa de transporte por el número de seguimiento. */
export function guessCarrier(t) {
  const s = String(t || '').replace(/\s/g, '').toUpperCase();
  if (!s) return '';
  if (/^1Z[0-9A-Z]{16}$/.test(s)) return 'UPS';
  if (/^TBA\d{9,}$/.test(s)) return 'Amazon';
  if (/^(94|93|92|95)\d{18,20}$/.test(s) || /^[A-Z]{2}\d{9}US$/.test(s) || /^420\d{5}(91|92|93|94|95)\d{18,20}$/.test(s)) return 'USPS';
  if (/^\d{12}$/.test(s) || /^\d{15}$/.test(s) || /^\d{20}$/.test(s)) return 'FedEx';
  if (/^(JD|JJD)\d{16,18}$/.test(s) || /^\d{10}$/.test(s)) return 'DHL';
  if (/^(YT|LP|UUS|LB|SF)\w{10,}$/.test(s)) return 'China';
  return '';
}
/** Página donde ver el paquete: la de la empresa si se conoce; si no, el buscador universal 17TRACK. */
export function trackingUrl(t, carrier = guessCarrier(t)) {
  const s = encodeURIComponent(String(t || '').replace(/\s/g, ''));
  if (!s) return '';
  switch (carrier) {
    case 'UPS': return `https://www.ups.com/track?tracknum=${s}`;
    case 'USPS': return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${s}`;
    case 'FedEx': return `https://www.fedex.com/fedextrack/?trknbr=${s}`;
    case 'DHL': return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${s}`;
    case 'Amazon': return `https://track.amazon.com/tracking/${s}`;
    default: return `https://t.17track.net/es#nums=${s}`;
  }
}
/** Página del pedido en la tienda. */
export function storeOrderUrl(store, id) {
  const s = encodeURIComponent(String(id || '').trim());
  if (store === 'Amazon') return s ? `https://www.amazon.com/gp/your-account/order-details?orderID=${s}` : 'https://www.amazon.com/gp/css/order-history';
  if (store === 'SHEIN') return s ? `https://us.shein.com/user/orders/detail/${s}` : 'https://us.shein.com/user/orders/list';
  if (store === 'Temu') return 'https://www.temu.com/bgt_orders.html';
  if (store === 'Walmart') return s ? `https://www.walmart.com/orders/${s}` : 'https://www.walmart.com/orders';
  if (store === 'eBay') return 'https://www.ebay.com/mye/myebay/purchase';
  if (store === 'AliExpress') return s ? `https://www.aliexpress.com/p/order/detail.html?orderId=${s}` : 'https://www.aliexpress.com/p/order/index.html';
  return '';
}

const MONTH_WORDS = {
  ene: 0, enero: 0, jan: 0, january: 0, feb: 1, febrero: 1, february: 1, mar: 2, marzo: 2, march: 2, abr: 3, abril: 3, apr: 3, april: 3,
  may: 4, mayo: 4, jun: 5, junio: 5, june: 5, jul: 6, julio: 6, july: 6, ago: 7, agosto: 7, aug: 7, august: 7,
  sep: 8, sept: 8, septiembre: 8, setiembre: 8, september: 8, oct: 9, octubre: 9, october: 9, nov: 10, noviembre: 10, november: 10,
  dic: 11, diciembre: 11, dec: 11, december: 11,
};
const WEEKDAYS = { sun: 0, sunday: 0, domingo: 0, mon: 1, monday: 1, lunes: 1, tue: 2, tuesday: 2, martes: 2, wed: 3, wednesday: 3, miercoles: 3, thu: 4, thursday: 4, jueves: 4, fri: 5, friday: 5, viernes: 5, sat: 6, saturday: 6, sabado: 6 };

/**
 * Saca la fecha de llegada de un texto copiado de la app o el correo de la tienda:
 * «Arriving Tuesday, October 14», «Llega el 14 de oct.», «Delivered Oct 9», «Estimated delivery: Oct 12 - Oct 16» (se toma la última),
 * «Arriving tomorrow», «Llega mañana». Devuelve 'AAAA-MM-DD' o ''.
 */
export function parseArrival(text, ref = today()) {
  const t = norm(text);
  if (!t) return '';
  if (/\b(today|hoy)\b/.test(t)) return ref;
  if (/\b(tomorrow|manana)\b/.test(t)) return addDays(ref, 1);
  const r = parseDate(ref);
  const found = [];
  const re = /\b(\d{1,2})\s*(?:de\s+)?([a-z]{3,10})\b|\b([a-z]{3,10})\s+(\d{1,2})\b/g;
  let m;
  while ((m = re.exec(t))) {
    const day = +(m[1] || m[4]);
    const mon = MONTH_WORDS[m[2] || m[3]];
    if (mon === undefined || day < 1 || day > 31) continue;
    let y = r.getFullYear();
    // Si el mes ya pasó hace mucho, será del año siguiente.
    if (new Date(y, mon, day) < new Date(r.getFullYear(), r.getMonth() - 2, 1)) y++;
    found.push(toDateStr(new Date(y, mon, day)));
  }
  const nums = [...String(text).matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)];
  for (const n of nums) {
    // 10/14 (EE. UU.) o 14/10: se elige la que tenga sentido.
    let a = +n[1];
    let b = +n[2];
    let mon;
    let day;
    if (a > 12) [day, mon] = [a, b];
    else if (b > 12) [mon, day] = [a, b];
    else [mon, day] = [a, b];
    let y = n[3] ? (+n[3] < 100 ? 2000 + +n[3] : +n[3]) : r.getFullYear();
    if (mon < 1 || mon > 12 || day < 1 || day > 31) continue;
    if (!n[3] && new Date(y, mon - 1, day) < new Date(r.getFullYear(), r.getMonth() - 2, 1)) y++;
    found.push(toDateStr(new Date(y, mon - 1, day)));
  }
  if (found.length) return found.sort().pop();
  for (const [w, dow] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${w}\\b`).test(t)) {
      const n = (dow - r.getDay() + 7) % 7 || 7;
      return addDays(ref, n);
    }
  }
  return '';
}

/** Archivo de calendario (.ics) con un recordatorio; lo abren el Calendario del iPhone y Google Calendar. */
export function icsEvent({ date, title, description = '', alarmDays = 1 }) {
  const d = date.replace(/-/g, '');
  const next = addDays(date, 1).replace(/-/g, '');
  const escI = (s) => String(s).replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Import Business//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${uid()}@import-business`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next}`, `SUMMARY:${escI(title)}`, `DESCRIPTION:${escI(description)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escI(title)}`, `TRIGGER:-P${Math.max(0, alarmDays)}DT0H0M0S`, 'END:VALARM',
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escI(title)}`, 'TRIGGER;RELATED=START:PT9H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}
