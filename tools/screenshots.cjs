// Genera capturas de la app con datos de ejemplo inventados (vista previa y manual), en diseño Android e iPhone.
// Uso: npx http-server -p 8080 -c-1 . &  →  NODE_PATH=$(npm root -g) node tools/screenshots.cjs
// UI=android|ios (por defecto los dos). DARK=1 añade las capturas en modo oscuro.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.APP_URL || 'http://localhost:8080/';
const NOW = process.env.FAKE_NOW || '2026-10-28T18:30:00';
const UIS = process.env.UI ? [process.env.UI] : ['android', 'ios'];

/** Datos de ejemplo: unas semanas de encargos, remesas, gastos y pagos. */
async function seed(page) {
  await page.evaluate(async () => {
    const S = await import('/js/store.js');
    const st = S.state;
    const t = S.today();
    const D = (n) => S.addDays(t, n);
    const tsOf = (date, h, m = 0) => new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime();
    Object.assign(S.local, { user: 'Marco', onboarded: true, seenVersion: S.APP_VERSION, lastBackup: D(-2) });
    Object.assign(st.settings, { airPrice: 5, airCost: 2.5, seaPrice: 2.5, seaCost: 1.2, remitPct: 2 });
    st.moves.push({ id: S.uid(), ts: tsOf(D(-45), 9), date: D(-45), account: 'tarjeta', amount: 1000, type: 'inicial', note: 'Dinero al empezar a usar la app' });
    st.moves.push({ id: S.uid(), ts: tsOf(D(-45), 9), date: D(-45), account: 'efectivo', amount: 6000, type: 'inicial', note: 'Dinero al empezar a usar la app' });
    st.moves.push({ id: S.uid(), ts: tsOf(D(-14), 20), date: D(-14), account: 'efectivo', amount: -300, type: 'retiro', note: 'Reparto de ganancias' });

    const ord = (o) => {
      const r = S.newOrder({
        id: S.uid(), ts: tsOf(D(o.created ?? o.bought ?? 0), 10),
        client: { name: o.name, phone: o.phone || '' },
        items: o.items.map(([desc, price, qty = 1, url = '']) => ({ desc, price, qty, url })),
        store: o.store, storeOrder: o.storeOrder || '', tracking: o.tracking || '', carrier: S.guessCarrier(o.tracking || ''),
        method: o.method || 'aereo', ...S.withMethod(o.method || 'aereo'),
        status: o.status, weightLb: o.w ?? '', weightReal: o.real ?? o.w !== undefined, feeOn: !!o.fee, feePct: 10,
        extras: o.extras || [], etaWarehouse: o.etaWh ? D(o.etaWh) : '', note: o.note || '',
        dates: { created: D(o.created ?? o.bought ?? 0) },
      });
      for (const [k, key] of [['bought', 'bought'], ['wh', 'warehouse'], ['shipped', 'shipped'], ['cuba', 'cuba'], ['delivered', 'delivered'], ['cancelled', 'cancelled']]) if (o[k] !== undefined) r.dates[key] = D(o[k]);
      r.payments = (o.pay || []).map(([d, amount, account = 'efectivo']) => ({ id: S.uid(), ts: tsOf(D(d), 15), date: D(d), amount, account }));
      if (o.refund) r.refund = { amount: o.refund, date: D(o.cancelled), account: 'tarjeta' };
      // Entregados: el resto se cobra al entregar.
      if (o.status === 'entregado' && !o.owe) {
        const due = S.orderCalc(r).due;
        if (due > 0) r.payments.push({ id: S.uid(), ts: tsOf(D(o.delivered), 16), date: D(o.delivered), amount: due, account: 'efectivo' });
      }
      st.orders.push(r);
      return r;
    };
    // Entregados
    ord({ name: 'Yanelis Pérez', phone: '5 2345678', items: [['Zapatillas Nike Air Max talla 9', 89.99]], store: 'Amazon', bought: -44, wh: -40, shipped: -37, cuba: -30, delivered: -29, status: 'entregado', w: 3.1, pay: [[-44, 40]] });
    ord({ name: 'Osmany Rodríguez', phone: '5 3456789', items: [['Freidora de aire Ninja 4 qt', 79.99]], store: 'Amazon', method: 'maritimo', bought: -66, wh: -62, shipped: -60, cuba: -30, delivered: -28, fee: true, status: 'entregado', w: 11.2 });
    ord({ name: 'Dayana Fernández', phone: '5 4567890', items: [['Vestidos de verano', 12.5, 3], ['Sandalias', 9.9]], store: 'SHEIN', bought: -40, wh: -31, shipped: -30, cuba: -23, delivered: -22, status: 'entregado', w: 2.4, fee: true });
    ord({ name: 'Rolando García', phone: '5 5678901', items: [['Samsung Galaxy A15 128 GB', 139]], store: 'Walmart', bought: -35, wh: -30, shipped: -30, cuba: -24, delivered: -21, fee: true, status: 'entregado', w: 1.2, extras: [{ label: 'Protector y forro', amount: 8 }] });
    ord({ name: 'Yamilé Castro', phone: '5 6789012', items: [['Leche en polvo Nido 2 kg', 24.5, 2]], store: 'Amazon', method: 'maritimo', bought: -55, wh: -51, shipped: -48, cuba: -18, delivered: -17, status: 'entregado', w: 9.6 });
    ord({ name: 'Lisandra Hernández', phone: '5 7890123', items: [['Ropa de niño talla 4T', 6.5, 6]], store: 'SHEIN', bought: -28, wh: -19, shipped: -10, cuba: -3, delivered: -2, status: 'entregado', w: 2.8 });
    ord({ name: 'Yanelis Pérez', phone: '5 2345678', items: [['Perfume Carolina Herrera 212', 72]], store: 'Amazon', bought: -24, wh: -20, shipped: -11, cuba: -3, delivered: 0, fee: true, status: 'entregado', w: 1.5, pay: [[-24, 30]] });
    ord({ name: 'Alexei Martínez', phone: '5 8901234', items: [['Olla arrocera Aroma 8 tazas', 29.99]], store: 'Walmart', method: 'maritimo', bought: -50, wh: -45, shipped: -33, cuba: -3, delivered: -1, status: 'entregado', w: 6.4, owe: true, pay: [[-1, 30]] });
    // En Cuba para entregar
    ord({ name: 'Mabel Suárez', phone: '5 9012345', items: [['Juego de sábanas queen', 34.99], ['Toallas (paquete de 6)', 22]], store: 'Amazon', bought: -22, wh: -18, shipped: -8, cuba: -1, status: 'cuba', w: 7.3, pay: [[-22, 50]] });
    ord({ name: 'Yoandry López', phone: '5 0123456', items: [['Ventilador recargable 16"', 45.99]], store: 'Amazon', method: 'maritimo', bought: -45, wh: -41, shipped: -33, cuba: -1, status: 'cuba', w: 8.9 });
    // Enviados a Cuba
    ord({ name: 'Dania Ramírez', phone: '5 1122334', items: [['Mochila escolar', 24.99], ['Útiles escolares', 18.5]], store: 'Amazon', bought: -16, wh: -12, shipped: -5, status: 'enviado', w: 4.2, tracking: 'TBA318472059341' });
    ord({ name: 'Osmany Rodríguez', phone: '5 3456789', items: [['Batería portátil EcoFlow River 2', 189]], store: 'Amazon', method: 'maritimo', bought: -26, wh: -22, shipped: -20, fee: true, status: 'enviado', w: 17.6, pay: [[-12, 100]], tracking: '1Z999AA10123456784' });
    // En el almacén
    ord({ name: 'Rolando García', phone: '5 5678901', items: [['Tablet Amazon Fire HD 10', 109.99]], store: 'Amazon', bought: -7, wh: -3, fee: true, status: 'almacen', w: 2.1 });
    ord({ name: 'Yamilé Castro', phone: '5 6789012', items: [['Vitaminas Centrum mujer', 18.99, 2]], store: 'Walmart', method: 'maritimo', bought: -6, wh: -1, status: 'almacen', w: 1.3, real: true });
    // Hacia el almacén
    ord({ name: 'Lisandra Hernández', phone: '5 7890123', items: [['Conjuntos deportivos', 14.9, 2], ['Tenis de niña', 16.5]], store: 'SHEIN', bought: -5, status: 'comprado', w: 2.5, real: false, etaWh: 4, tracking: 'YT2412345678901234', storeOrder: 'GSUN8K4L00XYZ' });
    ord({ name: 'Mabel Suárez', phone: '5 9012345', items: [['Cafetera Oster 12 tazas', 39.99]], store: 'Amazon', bought: -3, status: 'comprado', w: 5, real: false, etaWh: 1, tracking: '9400111899223197428490', storeOrder: '112-4829137-5501827' });
    ord({ name: 'Alexei Martínez', phone: '5 8901234', items: [['Audífonos inalámbricos', 11.99, 2]], store: 'Temu', bought: -12, status: 'comprado', w: 0.8, real: false });
    // Por comprar
    ord({ name: 'Dayana Fernández', phone: '5 4567890', items: [['Secador de pelo Revlon', 34.99]], store: 'Amazon', created: 0, status: 'pendiente', w: 2, real: false, note: 'Lo quiere en color negro' });
    // Cancelado
    ord({ name: 'Yoandry López', phone: '5 0123456', items: [['Reloj Casio', 25]], store: 'Amazon', bought: -20, cancelled: -18, status: 'cancelado', w: 0.5, refund: 25 });

    // Remesas
    const recips = [
      ['Caridad Gómez', '5 2233445', 'Calle 23 #456 e/ F y G, Vedado, Plaza', 'Juan Gómez'],
      ['Mercedes Valdés', '5 3344556', 'San Lázaro #812 apto 4, Centro Habana', 'Lily Valdés'],
      ['Teresa Morales', '5 4455667', 'Ave. 51 #12406 e/ 124 y 126, Marianao', 'Pedro Morales'],
      ['Héctor Díaz', '5 5566778', 'Calle Martí #34, Guanabacoa', 'Ana Díaz'],
      ['Odalys Reyes', '5 6677889', 'Edificio 12 apto 8, Alamar, Habana del Este', 'Ernesto Reyes'],
      ['Nancy Pérez', '5 7788990', 'Calle 10 #215 e/ 5ta y 7ma, Playa', 'Lázaro Pérez'],
    ];
    let k = 0;
    const amounts = [100, 200, 150, 300, 100, 500, 250, 100, 200, 400, 150, 100, 300, 200, 120, 250];
    for (let d = -40; d <= -1; d += 1.6) {
      const day = Math.round(d);
      const [recipient, phone, address, sender] = recips[k % recips.length];
      const amount = amounts[k % amounts.length];
      const pct = [2, 3, 2, 1.5, 3][k % 5];
      st.remits.push({
        id: S.uid(), ts: tsOf(D(day), 11), date: D(day), sender, senderPhone: '+1 305 555 01' + String(10 + k).padStart(2, '0'), recipient, phone, address,
        amount, received: S.remitReceive(amount, pct), receivedAt: D(day), receivedTo: 'tarjeta', deliveredAt: D(day + (k % 3 === 0 ? 1 : 0)), deliverCost: k % 4 === 0 ? 2 : 0, paidFrom: 'efectivo', note: '',
      });
      k++;
    }
    const pend = [[0, 'Caridad Gómez', 300, 1, true], [0, 'Héctor Díaz', 150, 1.5, true], [-1, 'Nancy Pérez', 200, 1, false]];
    for (const [d, name, amount, pct, rec] of pend) {
      const r = recips.find((x) => x[0] === name);
      st.remits.push({ id: S.uid(), ts: tsOf(D(d), 12), date: D(d), sender: r[3], senderPhone: '', recipient: r[0], phone: r[1], address: r[2], amount, received: S.remitReceive(amount, pct), receivedAt: rec ? D(d) : null, receivedTo: 'tarjeta', deliveredAt: null, deliverCost: 0, paidFrom: 'efectivo', note: d === 0 ? 'Entregar por la tarde' : '' });
    }

    // Gastos
    const exp = (d, cat, amount, account, biz, note) => st.expenses.push({ id: S.uid(), ts: tsOf(D(d), 13), date: D(d), cat, amount, account, biz, note });
    exp(-38, 'Teléfono e internet', 20, 'efectivo', 'ambos', 'Recarga del teléfono del negocio');
    exp(-30, 'Embalaje', 15, 'tarjeta', 'encargos', 'Cajas y cinta para el almacén');
    exp(-25, 'Comisiones bancarias', 3.5, 'tarjeta', 'remesas', 'Comisión de transferencia');
    exp(-20, 'Publicidad', 25, 'efectivo', 'ambos', 'Anuncio en Revolico');
    exp(-12, 'Transporte', 10, 'efectivo', 'encargos', 'Taxi para recoger paquetes');
    exp(-8, 'Teléfono e internet', 20, 'efectivo', 'ambos', 'Recarga del teléfono del negocio');
    exp(-1, 'Transporte', 8, 'efectivo', 'remesas', 'Entrega en Alamar');
    exp(0, 'Mensajería', 5, 'efectivo', 'encargos', 'Llevar la freidora a domicilio');
    // Trabajadores
    const w1 = { id: S.uid(), ts: tsOf(D(-45), 9), name: 'Yuniel', role: 'Mensajero, entrega remesas', phone: '5 9988776', archived: false };
    const w2 = { id: S.uid(), ts: tsOf(D(-45), 9), name: 'Claudia', role: 'Ayudante de encargos', phone: '5 8877665', archived: false };
    st.workers.push(w1, w2);
    for (const d of [-35, -28, -21, -14, -7]) st.payroll.push({ id: S.uid(), ts: tsOf(D(d), 19), date: D(d), workerId: w1.id, amount: 15, account: 'efectivo', biz: 'remesas', note: 'Semana de entregas' });
    for (const d of [-30, -16, -2]) st.payroll.push({ id: S.uid(), ts: tsOf(D(d), 19), date: D(d), workerId: w2.id, amount: 25, account: 'efectivo', biz: 'encargos', note: 'Quincena' });
    // Cierres de días anteriores
    for (let d = -6; d <= -1; d++) {
      const date = D(d);
      const e = S.closureData(date).expected;
      const rec = S.saveClosure(date, d === -4 ? e - 5 : e, d === -4 ? 'Di 5 de más en una entrega' : '', '');
      rec.ts = tsOf(date, 21, 10);
      rec.by = d % 2 ? 'Marco' : 'Ale';
    }
    for (const acc of ['tarjeta', 'efectivo']) if (S.balance(acc) < 0) console.error('Saldo negativo en ' + acc + ': ' + S.balance(acc));
    await S.save();
  });
}

(async () => {
  const browser = await chromium.launch({ args: ['--lang=es-ES'] });
  for (const UI of UIS) {
    for (const DARK of process.env.DARK === '1' ? [false, true] : [false]) {
      const OUT = path.join(__dirname, '..', 'preview', UI);
      fs.mkdirSync(OUT, { recursive: true });
      const ios = UI === 'ios';
      const context = await browser.newContext({
        viewport: ios ? { width: 390, height: 844 } : { width: 412, height: 915 }, deviceScaleFactor: ios ? 2 : 2, isMobile: true, hasTouch: true,
        colorScheme: DARK ? 'dark' : 'light', locale: 'es-ES', serviceWorkers: 'block',
        userAgent: ios
          ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
          : 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
      });
      // La app «instalada» (sin el aviso de instalar) salvo cuando se pide verla en el navegador.
      await context.addInitScript(() => {
        if (!sessionStorage.getItem('browser')) Object.defineProperty(navigator, 'standalone', { get: () => true });
      });
      const page = await context.newPage();
      await page.clock.setFixedTime(new Date(NOW));
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()));
      page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));

      // Barra de estado y barra de gestos dibujadas encima.
      const decorate = async () => {
        await page.addStyleTag({
          content: ios ? `
          :root, html.ios{--safe-t:47px !important;--safe-b:34px !important;}
          #sb{position:fixed;top:0;left:0;right:0;height:47px;z-index:999;display:flex;align-items:center;justify-content:space-between;padding:6px 30px 0 46px;font:600 16px -apple-system,Inter,sans-serif;color:var(--on-surface);pointer-events:none}
          #sb .r{display:flex;gap:6px;align-items:center}
          #sb svg{height:12px;fill:currentColor}
          #isl{position:fixed;top:11px;left:50%;width:120px;height:35px;margin-left:-60px;border-radius:20px;background:#000;z-index:999;pointer-events:none}
          #gb{position:fixed;left:50%;bottom:8px;width:134px;height:5px;margin-left:-67px;border-radius:3px;background:var(--on-surface);z-index:999;pointer-events:none}` : `
          :root{--safe-t:28px;--safe-b:16px;}
          #sb{position:fixed;top:0;left:0;right:0;height:28px;z-index:999;display:flex;align-items:center;justify-content:space-between;padding:0 18px 0 22px;font:500 13px Roboto,sans-serif;color:var(--on-surface);pointer-events:none}
          #sb .r{display:flex;gap:6px;align-items:center}
          #sb svg{width:15px;height:15px;fill:currentColor}
          #gb{position:fixed;left:50%;bottom:5px;width:108px;height:4px;margin-left:-54px;border-radius:2px;background:var(--on-surface);opacity:.55;z-index:999;pointer-events:none}`,
        });
        await page.evaluate((isIos) => {
          const sb = document.createElement('div');
          sb.id = 'sb';
          sb.innerHTML = isIos
            ? '<span>18:30</span><span class="r"><svg viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg><svg viewBox="0 0 16 12"><path d="M8 12 0 3.5a11.5 11.5 0 0 1 16 0z"/></svg><svg viewBox="0 0 27 12"><rect x="0.5" y="0.5" width="23" height="11" rx="3" fill="none" stroke="currentColor"/><rect x="2" y="2" width="17" height="8" rx="1.6"/><rect x="24.5" y="4" width="1.5" height="4" rx=".7"/></svg></span>'
            : '<span>18:30</span><span class="r"><svg viewBox="0 0 24 24"><path d="M12 21 1 9.5a15.6 15.6 0 0 1 22 0z"/></svg><svg viewBox="0 0 24 24"><path d="M2 22h20V2z"/></svg><svg viewBox="0 0 24 24"><path d="M8 3h8v2h2v17H6V5h2z"/></svg></span>';
          document.body.appendChild(sb);
          if (isIos) {
            const isl = document.createElement('div');
            isl.id = 'isl';
            document.body.appendChild(isl);
          }
          const gb = document.createElement('div');
          gb.id = 'gb';
          document.body.appendChild(gb);
        }, ios);
        await page.evaluate(() => document.fonts.ready);
      };
      const shot = async (name, keepSnack = false) => {
        await page.waitForTimeout(500);
        if (!keepSnack) {
          await page.evaluate(() => document.getElementById('snackbar')?.classList.remove('show'));
          await page.waitForTimeout(300);
        }
        await page.screenshot({ path: path.join(OUT, `${name}.png`) });
        console.log('✓', UI, name);
      };
      const top = (sel) => page.locator('.page-wrap.open').last().locator(sel).first();
      const dlgBtn = (i) => page.click(`.dialog-ov.open .dialog-btns button[data-i="${i}"]`);
      const back = async () => {
        await top('[data-act="__close"]').click();
        await page.waitForTimeout(450);
      };
      const tab = async (t) => {
        await page.click(`.navbar [data-tab="${t}"]`);
        await page.evaluate(() => window.scrollTo(0, 0));
      };
      const scrollPage = (y) => page.evaluate((yy) => { const b = [...document.querySelectorAll('.page-wrap.open .page-body')].pop(); b.scrollTop = yy; }, y);
      const scrollTo = (sel) => page.evaluate((s) => { const b = [...document.querySelectorAll('.page-wrap.open .page-body')].pop(); const el = b.querySelector(s); b.scrollTop = el.offsetTop - 70; }, sel);
      const orderId = (name, status) => page.evaluate(async ([n, s]) => (await import('/js/store.js')).state.orders.find((o) => o.client.name === n && (!s || o.status === s)).id, [name, status]);
      const q = `?ui=${UI}`;

      await page.goto(URL + q);
      await page.evaluate(() => new Promise((r) => { const x = indexedDB.deleteDatabase('import-business'); x.onsuccess = x.onerror = x.onblocked = () => r(); }));
      await page.reload();
      await decorate();

      if (DARK) {
        await seed(page);
        await page.reload();
        await decorate();
        await shot('70-inicio-oscuro');
        await tab('encargos');
        await shot('71-encargos-oscuro');
        await tab('informes');
        await shot('72-informes-oscuro');
        await context.close();
        continue;
      }

      // 0. Bienvenida
      await top('[data-bind="user"]').fill('Marco');
      await top('[data-bind="card"]').fill('1000');
      await top('[data-bind="cash"]').fill('6000');
      await shot('00-bienvenida');

      // Datos de ejemplo
      await seed(page);
      await page.reload();
      await decorate();

      // 1. Inicio
      await shot('01-inicio');
      await page.evaluate(() => window.scrollTo(0, 700));
      await shot('02-inicio-abajo');
      await page.evaluate(() => window.scrollTo(0, 0));

      // 2. Encargos
      await tab('encargos');
      await shot('10-encargos');
      // Nuevo encargo
      await page.click(ios ? '.topbar [data-act="newOrder"]' : '.fab[data-act="newOrder"]');
      await page.waitForTimeout(500);
      await top('[data-bind="client.name"]').fill('Yusleidy Navarro');
      await top('[data-bind="client.phone"]').fill('5 2468135');
      await top('[data-bind="items.0.desc"]').fill('Bocina JBL Flip 6');
      await top('[data-bind="items.0.price"]').fill('99.95');
      await top('[data-act="chip"][data-name="store"][data-v="Amazon"]').click();
      await top('[data-bind="tracking"]').fill('TBA329104857362');
      await top('[data-bind="weightLb"]').fill('2.5');
      await shot('11-nuevo-encargo');
      await scrollTo('[data-sum]');
      await page.waitForTimeout(200);
      await shot('12-nuevo-encargo-precio');
      await top('[data-act="save"]').click();
      await page.waitForTimeout(700);
      await shot('13-encargo-guardado', true);
      await back();
      // Ficha de un encargo en camino
      await page.click(`#order-list [data-act="order"][data-id="${await orderId('Mabel Suárez', 'comprado')}"]`);
      await page.waitForTimeout(500);
      await shot('14-encargo-ficha');
      await scrollPage(560);
      await shot('15-encargo-ficha-abajo');
      await scrollPage(0);
      // Llegó al almacén: peso real
      await top('[data-act="advance"]').click();
      await page.waitForTimeout(500);
      await top('[data-bind="weight"]').fill('4.6');
      await shot('16-llego-almacen');
      await back();
      await back();
      // Encargo en Cuba: cobrar y entregar
      await page.click(`#order-list [data-act="order"][data-id="${await orderId('Mabel Suárez', 'cuba')}"]`);
      await page.waitForTimeout(500);
      await top('[data-act="advance"]').click();
      await page.waitForTimeout(500);
      await shot('17-entregar-cobrar');
      await back();
      await back();
      // Enviar varios a Cuba
      await page.click('[data-act="chip"][data-name="orderFilter"][data-v="almacen"]');
      await page.waitForTimeout(300);
      await shot('18-en-el-almacen');
      await page.click('[data-act="bulkShip"]');
      await page.waitForTimeout(500);
      await shot('19-enviar-a-cuba');
      await back();
      await page.click('[data-act="chip"][data-name="orderFilter"][data-v="activos"]');
      // Clientes
      await page.click('.topbar [data-act="clients"]');
      await page.waitForTimeout(500);
      await shot('20-clientes');
      await top('[data-act="client"]').click();
      await page.waitForTimeout(500);
      await shot('21-cliente');
      await back();
      await back();

      // 3. Remesas
      await tab('remesas');
      await shot('30-remesas');
      await page.click(ios ? '.topbar [data-act="newRemit"]' : '.fab[data-act="newRemit"]');
      await page.waitForTimeout(500);
      await top('[data-bind="amount"]').fill('200');
      await top('[data-bind="pct"]').fill('2');
      await top('[data-bind="recipient"]').fill('Gisela Torres');
      await top('[data-bind="phone"]').fill('5 3692581');
      await top('[data-bind="address"]').fill('Calle 17 #1053 e/ 12 y 14, Vedado');
      await top('[data-bind="sender"]').fill('Raúl Torres (Miami)');
      await shot('31-nueva-remesa');
      await top('[data-act="save"]').click();
      await page.waitForTimeout(700);
      await shot('32-remesa-ficha');
      await top('[data-act="deliver"]').click();
      await page.waitForTimeout(500);
      await shot('33-entregar-remesa');
      await top('[data-act="save"]').click();
      await page.waitForTimeout(600);
      await shot('34-remesa-entregada', true);
      await back();

      // 4. Dinero
      await tab('dinero');
      await shot('40-dinero');
      await page.click('[data-act="account"][data-v="tarjeta"]');
      await page.waitForTimeout(500);
      await shot('41-cuenta-tarjeta');
      await back();
      await page.click(ios ? '.topbar [data-act="dineroAdd"]' : '.fab[data-act="dineroAdd"]');
      await page.waitForTimeout(500);
      await top('[data-act="chip"][data-name="cat"][data-v="Embalaje"]').click();
      await top('[data-bind="amount"]').fill('12');
      await top('[data-act="seg"][data-name="biz"][data-v="encargos"]').click();
      await top('[data-bind="note"]').fill('Cinta y cajas');
      await shot('42-nuevo-gasto');
      await top('[data-act="save"]').click();
      await page.waitForTimeout(500);
      await page.click('[data-act="seg"][data-name="dineroMode"][data-v="pagos"]');
      await page.waitForTimeout(300);
      await shot('43-trabajadores');
      await page.click(ios ? '.topbar [data-act="dineroAdd"]' : '.fab[data-act="dineroAdd"]');
      await page.waitForTimeout(500);
      await top('[data-bind="amount"]').fill('15');
      await top('[data-act="seg"][data-name="biz"][data-v="remesas"]').click();
      await top('[data-bind="note"]').fill('Semana de entregas');
      await shot('44-pago-trabajador');
      await back();

      // 5. Informes
      await tab('informes');
      await shot('50-informes');
      await page.evaluate(() => window.scrollTo(0, 560));
      await shot('51-informes-negocios');
      await page.evaluate(() => window.scrollTo(0, 1350));
      await shot('52-informes-tiempos');
      await page.evaluate(() => window.scrollTo(0, 0));

      // 6. Cierre
      await tab('inicio');
      await page.click('.actions [data-act="closure"]');
      await page.waitForTimeout(600);
      await shot('60-cierre');
      await scrollTo('[data-bind="counted"]');
      const expected = await page.evaluate(async () => { const S = await import('/js/store.js'); return S.closureData(S.today()).expected; });
      await top('[data-bind="counted"]').fill(String(expected));
      await page.waitForTimeout(250);
      await shot('61-cierre-efectivo');
      await scrollPage(99999);
      await shot('62-cierre-pendiente');
      await page.locator('.page-wrap.open .page-foot [data-act="save"]').click();
      await page.waitForTimeout(700);
      await shot('63-cierre-guardado');
      await dlgBtn(0);
      const text = await page.evaluate(async () => { const S = await import('/js/store.js'); return S.state.closures.find((c) => c.date === S.today()).text; });
      fs.writeFileSync(path.join(OUT, 'cierre-ejemplo.txt'), text);
      await back();

      // 7. Ajustes y sincronización
      await page.click('.topbar [data-act="settings"]');
      await page.waitForTimeout(500);
      await shot('70-ajustes');
      await scrollTo('[data-bind="airPrice"]');
      await page.waitForTimeout(200);
      await shot('69-ajustes-envios');
      await scrollPage(0);
      await scrollPage(1250);
      await shot('71-ajustes-abajo');
      await scrollPage(0);
      await top('[data-act="sync"]').click();
      await page.waitForTimeout(500);
      await shot('72-sincronizar');
      await top('[data-act="create"]').click();
      await page.waitForTimeout(500);
      await shot('73-crear-grupo');
      await back();
      await top('[data-act="join"]').click();
      await page.waitForTimeout(500);
      await top('[data-bind="code"]').fill('IB1-eyJnIjoiOGYzYTJjNGU5ZDFiNDdhYzk1ZTA2YjNkMmM4ZjE0YTciLCJ0IjoiZ2hwX19fX19fX19fXyIsImsiOiJ…');
      await shot('74-unirse');
      await back();
      // Simula un grupo ya activo para la captura del estado.
      await page.evaluate(async () => {
        const S = await import('/js/store.js');
        Object.assign(S.local.sync, { enabled: true, code: 'IB1-demo', lastSync: Date.now() - 4 * 60e3, lastError: '' });
      });
      await back();
      await top('[data-act="sync"]').click();
      await page.waitForTimeout(500);
      await shot('75-sincronizacion-activa');
      await top('[data-act="autoBackups"]').click();
      await page.waitForTimeout(500);
      await top('[data-act="now"]').click();
      await page.waitForTimeout(600);
      await page.evaluate(async () => {
        const S = await import('/js/store.js');
        const list = await S.idbGet('backups');
        list[0].label = 'Antes de sincronizar (6 cambios de otros)';
        list[0].ts -= 4 * 60e3;
        await S.idbPut('backups', list);
      });
      await back();
      await top('[data-act="autoBackups"]').click();
      await page.waitForTimeout(600);
      await shot('76-copias-automaticas');
      await back();
      await page.evaluate(async () => {
        const S = await import('/js/store.js');
        Object.assign(S.local.sync, { enabled: false, code: '' });
      });
      await back();
      await back();

      // 8. Instalar (en el navegador, sin instalar todavía)
      await page.evaluate(() => sessionStorage.setItem('browser', '1'));
      await page.reload();
      await decorate();
      await page.click('.topbar [data-act="settings"]');
      await page.waitForTimeout(500);
      await top('[data-act="install"]').click();
      await page.waitForTimeout(500);
      await shot('80-instalar');
      await dlgBtn(0);
      await page.evaluate(() => sessionStorage.removeItem('browser'));

      console.log(errors.length ? 'ERRORES:\n' + errors.join('\n') : 'Sin errores de consola');
      await context.close();
    }
  }
  await browser.close();
})();
