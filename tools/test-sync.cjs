// Prueba de la sincronización entre dos teléfonos contra el Gist falso.
// Uso (con la app en :8080): node tools/mock-gist-server.cjs 8090 &  →  NODE_PATH=$(npm root -g) node tools/test-sync.cjs
const { chromium } = require('playwright');
const assert = require('assert/strict');
const URL = 'http://localhost:8080/?ui=android';
(async () => {
  const browser = await chromium.launch();
  const phone = async (name) => {
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(URL);
    await p.locator('.page-wrap.open [data-bind="user"]').fill(name);
    await p.click('.page-wrap.open [data-act="start"]');
    await p.waitForTimeout(300);
    await p.evaluate(async () => {
      const S = await import('/js/store.js');
      S.local.sync.api = 'http://localhost:8090';
      await S.saveLocal();
    });
    p.errs = errs;
    return p;
  };
  const run = (p, f, arg) => p.evaluate(f, arg);
  const A = await phone('Marco');
  const B = await phone('Ale');

  // A crea un encargo y el grupo.
  const code = await run(A, async () => {
    const S = await import('/js/store.js');
    const C = await import('/js/core.js');
    const Y = await import('/js/sync.js');
    S.state.orders.push(S.newOrder({ id: 'o1', client: { name: 'Yanelis', phone: '52345678' }, items: [{ desc: 'Zapatos', qty: 1, price: 40, url: '' }], weightLb: 3 }));
    await C.commit();
    const code = await Y.createGroup('ghp_prueba_valida_1234567890');
    Object.assign(S.local.sync, { enabled: true, code });
    await S.saveLocal();
    return code;
  });
  assert.ok(code.startsWith('IB1-'));
  // Token malo → error claro.
  const bad = await run(A, async () => { const Y = await import('/js/sync.js'); try { await Y.createGroup('ghp_mal'); return 'ok'; } catch (e) { return e.message; } });
  assert.match(bad, /token/);

  // B tiene una remesa propia y se une por la pantalla de unirse.
  await run(B, async () => {
    const S = await import('/js/store.js');
    const C = await import('/js/core.js');
    S.state.remits.push({ id: 'r1', ts: Date.now(), date: S.today(), recipient: 'Caridad', phone: '', address: 'Vedado', amount: 100, received: 101, receivedAt: S.today(), deliveredAt: null, deliverCost: 0, receivedTo: 'tarjeta', paidFrom: 'efectivo' });
    await C.commit();
  });
  await B.click('.topbar [data-act="settings"]');
  await B.click('.page-wrap.open [data-act="sync"]');
  await B.click('.page-wrap.open [data-act="join"]');
  await B.locator('.page-wrap.open [data-bind="code"]').last().fill(code);
  await B.locator('.page-wrap.open').last().locator('[data-act="save"]').click();
  await B.waitForSelector('.dialog-ov.open');
  const msg = await B.textContent('.dialog-ov.open .dialog');
  assert.match(msg, /1 encargos/);
  await B.click('.dialog-ov.open .dialog-btns button[data-i="1"]');
  await B.waitForTimeout(1500);
  let sb = await run(B, async () => { const S = await import('/js/store.js'); const Y = await import('/js/sync.js'); return { o: S.state.orders.length, r: S.state.remits.length, backups: (await Y.listBackups()).map((b) => b.label), on: S.local.sync.enabled }; });
  assert.deepEqual([sb.o, sb.r, sb.on], [1, 1, true]);
  assert.ok(sb.backups.some((l) => /unirme/.test(l)), 'copia antes de unirse');

  // A sincroniza y recibe la remesa de B (con copia de seguridad antes).
  const ra = await run(A, async () => { const Y = await import('/js/sync.js'); const S = await import('/js/store.js'); const r = await Y.syncNow(); return { r, rem: S.state.remits.length, backups: (await Y.listBackups()).map((b) => b.label) }; });
  assert.equal(ra.rem, 1);
  assert.ok(ra.r.changed);
  assert.ok(ra.backups[0].startsWith('Antes de sincronizar'));

  // Cambios a la vez: A marca la remesa como entregada y borra nada; B edita el encargo y cambia el precio de la libra.
  await run(A, async () => { const S = await import('/js/store.js'); const C = await import('/js/core.js'); S.remit('r1').deliveredAt = S.today(); await C.commit(); });
  await run(B, async () => { const S = await import('/js/store.js'); const C = await import('/js/core.js'); S.order('o1').note = 'talla 9'; S.state.settings.lbPrice = 6; await C.commit(); });
  await run(A, async () => (await import('/js/sync.js')).syncNow());
  await run(B, async () => (await import('/js/sync.js')).syncNow());
  await run(A, async () => (await import('/js/sync.js')).syncNow());
  const snap = (p) => run(p, async () => { const S = await import('/js/store.js'); return { note: S.order('o1').note, del: S.remit('r1').deliveredAt, lb: S.state.settings.lbPrice, cash: S.balance('efectivo'), card: S.balance('tarjeta') }; });
  const sa = await snap(A);
  const sbb = await snap(B);
  assert.deepEqual(sa, sbb);
  assert.equal(sa.note, 'talla 9');
  assert.ok(sa.del);
  assert.equal(sa.lb, 6);

  // Borrado en B se propaga a A.
  await run(B, async () => { const S = await import('/js/store.js'); const C = await import('/js/core.js'); S.state.orders = []; await C.commit(); await (await import('/js/sync.js')).syncNow(); });
  await run(A, async () => (await import('/js/sync.js')).syncNow());
  assert.equal(await run(A, async () => (await import('/js/store.js')).state.orders.length), 0);

  // Restaurar la copia de antes de sincronizar devuelve el encargo en A.
  const restored = await run(A, async () => {
    const Y = await import('/js/sync.js');
    const S = await import('/js/store.js');
    const list = await Y.listBackups();
    const b = list.find((x) => x.counts.orders === 1);
    await Y.restoreBackup(b.id);
    return S.state.orders.length;
  });
  assert.equal(restored, 1);
  assert.deepEqual([...A.errs, ...B.errs], []);
  console.log('✓ Sincronización: unirse, recibir, cambios a la vez, borrados, copias y restaurar');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
