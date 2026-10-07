// Ajustes, bienvenida, copias de seguridad, avisos, instalación y sincronización (beta).
import { icon } from './icons.js';
import {
  state, local, num, usd, today, fmtDate, fmtTime, uid, replaceState, defaultState, saveLocal, APP_VERSION, idbGet, idbPut, reminders,
} from './store.js';
import {
  esc, openPage, topPage, dialog, confirmDlg, promptDlg, snackbar, tf, inp, numInp, chips, seg, toggle, li, kv, secTitle,
  isIOS, detectedIOS, setPlatform, platformPref, setTheme, themePref,
} from './ui.js';
import { commit, refresh, shareText, shareFile, copyText } from './core.js';
import {
  createGroup, peekGroup, decodeCode, syncNow, mergeFromFile, listBackups, backupJson, restoreBackup, autoBackup, lastSyncLabel, syncStatus,
  resetSnapshot, mergeStates,
} from './sync.js';

/* ======================= instalar ======================= */
let installEvt = null;
const installListeners = new Set();
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvt = e;
  installListeners.forEach((f) => f());
});
window.addEventListener('appinstalled', () => {
  installEvt = null;
  installListeners.forEach((f) => f());
  snackbar('¡App instalada! Ábrela desde el icono de tu pantalla de inicio.');
});
export const onInstallChange = (f) => installListeners.add(f);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
/** En Android se puede instalar con un botón; en iPhone hay que hacerlo desde Safari. */
export const canInstall = () => !isStandalone() && (!!installEvt || detectedIOS());

export async function installApp() {
  if (installEvt) {
    installEvt.prompt();
    const r = await installEvt.userChoice.catch(() => null);
    if (r?.outcome === 'accepted') installEvt = null;
    installListeners.forEach((f) => f());
    return;
  }
  dialog({
    title: 'Instalar en el teléfono',
    ic: 'phone',
    message: isStandalone()
      ? 'La app ya está instalada en este teléfono.'
      : detectedIOS()
        ? '1. Abre esta página en Safari.\n2. Toca el botón Compartir (el cuadrado con la flecha hacia arriba).\n3. Elige «Añadir a pantalla de inicio» y toca «Añadir».\n4. Ábrela siempre desde el icono.'
        : '1. Abre esta página en Google Chrome.\n2. Toca el menú ⋮ (arriba a la derecha).\n3. Elige «Instalar aplicación» o «Añadir a pantalla de inicio».\n4. Ábrela siempre desde el icono.',
  });
}

/* ======================= copias de seguridad (archivo) ======================= */
const fileName = (kind) => `import-business-${kind}-${today()}${local.user ? '-' + local.user.toLowerCase().replace(/[^a-z0-9]+/g, '') : ''}.json`;

export async function exportBackup(kind = 'copia') {
  const json = JSON.stringify({ app: 'import-business', version: APP_VERSION, exported: new Date().toISOString(), by: local.user, state }, null, 1);
  const shared = await shareFile(json, fileName(kind), 'application/json', kind === 'datos' ? 'Datos de Import Business' : 'Copia de seguridad Import Business');
  if (shared === null) return;
  local.lastBackup = today();
  await saveLocal();
  refresh();
  snackbar(shared ? 'Listo: guárdala en Drive, Archivos o WhatsApp' : 'Copia guardada en Descargas');
}

function pickJson() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return resolve(null);
      try {
        resolve(JSON.parse(await f.text()));
      } catch {
        dialog({ title: 'No se pudo leer', message: 'El archivo no es de esta app.', ic: 'warning' });
        resolve(null);
      }
    };
    input.click();
  });
}

export async function importBackup() {
  const data = await pickJson();
  if (!data) return;
  const s = data.state || data;
  if (!s.settings || !Array.isArray(s.orders)) return dialog({ title: 'No se pudo leer', message: 'El archivo no es una copia de esta app.', ic: 'warning' });
  const when = data.exported ? new Date(data.exported).toLocaleString('es-ES') : 'fecha desconocida';
  const choice = await dialog({
    title: 'Restaurar copia',
    message: `Copia del ${when}${data.by ? ` (${data.by})` : ''}: ${s.orders.length} encargos y ${(s.remits || []).length} remesas.\n\n«Reemplazar» deja este teléfono igual que la copia. «Combinar» junta la copia con lo que ya tienes.`,
    buttons: [{ label: 'Cancelar', value: null }, { label: 'Combinar', value: 'merge' }, { label: 'Reemplazar', value: 'replace', style: 'danger' }],
  });
  if (!choice) return;
  if (choice === 'merge') {
    const r = await mergeFromFile(data);
    await commit();
    return snackbar(`Combinado: ${r.total} cambio${r.total === 1 ? '' : 's'} nuevos`);
  }
  await autoBackup('Antes de reemplazar con un archivo');
  await replaceState(s);
  location.reload();
}

/* ======================= avisos ======================= */
const canNotify = () => 'Notification' in window && 'serviceWorker' in navigator;

export async function enableNotifications(on) {
  if (!on) {
    local.notify = false;
    await saveLocal();
    return;
  }
  if (!canNotify()) {
    dialog({ title: 'Avisos', ic: 'bell', message: detectedIOS() && !isStandalone() ? 'En iPhone, primero instala la app en la pantalla de inicio (desde Safari) y ábrela desde el icono; luego activa los avisos.' : 'Este navegador no permite avisos. La app te seguirá mostrando las llegadas en la pantalla de Inicio.' });
    return;
  }
  const p = await Notification.requestPermission();
  if (p !== 'granted') {
    dialog({ title: 'Avisos desactivados', ic: 'bell', message: 'No diste permiso para mostrar avisos. Puedes darlo en los ajustes del navegador o del teléfono.' });
    return;
  }
  local.notify = true;
  await saveLocal();
  await registerPeriodic();
  checkNotifications(true);
}

async function registerPeriodic() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('periodicSync' in reg) await reg.periodicSync.register('ib-avisos', { minInterval: 6 * 3600e3 });
  } catch {
    /* no disponible: se avisa al abrir la app */
  }
}

/** Muestra los avisos de llegadas que tocan hoy y aún no se han mostrado. */
export async function checkNotifications(test = false) {
  if (!local.notify || !canNotify() || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const done = new Set((await idbGet('notified')) || []);
    const due = reminders().filter((r) => r.date <= today() && !done.has(r.key));
    for (const r of due.slice(0, 5)) {
      await reg.showNotification(r.title, { body: r.body, tag: r.key, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', data: { url: './' } });
      done.add(r.key);
    }
    if (test && !due.length) await reg.showNotification('Avisos activados', { body: 'Te avisaremos cuando un encargo esté por llegar al almacén o a Cuba.', icon: 'icons/icon-192.png', tag: 'ib-test' });
    await idbPut('notified', [...done].slice(-400));
  } catch (e) {
    console.warn(e);
  }
}

/* ======================= ajustes ======================= */
export function settingsPage() {
  const S = state.settings;
  openPage({
    title: 'Ajustes',
    nav: 'back',
    live: true,
    data: { ...S, user: local.user },
    render: (pg) => `
      ${secTitle('Tú')}
      <div class="form">
        ${tf('Tu nombre', inp('user', pg.data.user, 'placeholder="Ej. Marco" autocapitalize="words"'), { help: 'Aparece en lo que anotas, para saber quién hizo cada cambio al sincronizar.' })}
        ${tf('Nombre del negocio', inp('business', pg.data.business))}
      </div>
      ${secTitle('Precio de los encargos')}
      <div class="form">
        <div class="row2">
          ${tf('Cobro por libra', numInp('lbPrice', pg.data.lbPrice), { suffix: 'USD' })}
          ${tf('Nos cuesta la libra', numInp('lbCost', pg.data.lbCost), { suffix: 'USD' })}
        </div>
        <div class="tf-help">Lo que se le cobra al cliente por libra y lo que nos cobra la agencia por enviarla a Cuba. La diferencia es ganancia.</div>
        <label class="li check-li"><span class="grow"><span class="t">Cobrar libras completas</span><span class="s">2.3 lb se cobran como 3 lb</span></span>${toggle('roundLb', S.roundLb)}</label>
        <label class="li check-li"><span class="grow"><span class="t">Sumar un % del precio del producto</span><span class="s">Apagado por defecto; se puede encender en cada encargo</span></span>${toggle('feeOn', S.feeOn)}</label>
        ${tf('Porcentaje', numInp('feePct', pg.data.feePct), { suffix: '%' })}
        <div class="lbl">Redondear el precio final hacia arriba</div>
        ${chips('roundTotal', [[0, 'No'], [0.5, 'A 0.50'], [1, 'A 1 USD'], [5, 'A 5 USD']], S.roundTotal)}
        <div class="lbl">Las compras en la tienda se pagan con</div>
        ${seg('payFrom', [['tarjeta', 'Tarjeta'], ['efectivo', 'Efectivo']], S.payFrom)}
        <div class="lbl">El envío a Cuba se paga con</div>
        ${seg('shipFrom', [['tarjeta', 'Tarjeta'], ['efectivo', 'Efectivo']], S.shipFrom)}
        <p class="hint">Cambiar estos valores solo afecta a los encargos nuevos.</p>
      </div>
      ${secTitle('Remesas')}
      <div class="form">${tf('Comisión por defecto', numInp('remitPct', pg.data.remitPct), { suffix: '%', help: 'Con 1%, para entregar 100 USD se cobran 101 en la tarjeta. Se puede cambiar en cada remesa.' })}</div>
      ${secTitle('Tiempos y avisos')}
      <div class="form">
        ${tf('Del almacén a Cuba', numInp('cubaDays', pg.data.cubaDays, 'inputmode="numeric"'), { suffix: 'días' })}
        ${tf('Avisar con', numInp('warnDays', pg.data.warnDays, 'inputmode="numeric"'), { suffix: 'días de antelación' })}
        ${tf('Nombre del almacén', inp('warehouse', pg.data.warehouse))}
      </div>
      <div class="list">
        ${li({ act: 'storeDays', ic: 'clock', title: 'Días que tarda cada tienda', sub: esc(S.stores.map((s) => `${s} ${S.storeDays[s] ?? 7}`).join(' · ')) })}
        ${li({ act: 'stores', ic: 'store', title: 'Tiendas', sub: esc(S.stores.join(', ')) })}
        ${li({ act: 'expCats', ic: 'receipt', title: 'Categorías de gastos', sub: esc(S.expenseCats.join(', ')) })}
      </div>
      <p class="hint">Cuando hay 3 o más encargos de una tienda que ya llegaron, la app usa el tiempo real que tardaron en lugar de estos números.</p>
      <div class="list">
        <label class="li check-li"><span class="li-ic amber">${icon('bell')}</span><span class="grow"><span class="t">Avisos en el teléfono</span><span class="s">Cuando un encargo esté por llegar al almacén o a Cuba</span></span>${toggle('__notify', local.notify)}</label>
      </div>
      ${secTitle('Trabajo en equipo')}
      <div class="list">
        ${li({ act: 'sync', ic: 'sync', color: 'blue', title: `Sincronizar entre teléfonos <span class="badge blue">beta</span>`, sub: local.sync.enabled ? `Activada · ${lastSyncLabel()}` : 'Desactivada' })}
      </div>
      ${secTitle('Diseño')}
      <div class="form">
        <div class="lbl">Estilo</div>
        ${seg('__ui', [['auto', 'Automático'], ['ios', 'iPhone'], ['android', 'Android']], platformPref())}
        <div class="lbl">Tema</div>
        ${seg('__theme', [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']], themePref())}
      </div>
      ${secTitle('Tus datos')}
      <div class="list">
        ${li({ act: 'backup', ic: 'download', color: 'green', title: 'Hacer copia de seguridad', sub: local.lastBackup ? `Última: ${fmtDate(local.lastBackup)}` : 'Nunca' })}
        ${li({ act: 'restore', ic: 'upload', title: 'Restaurar o combinar una copia' })}
        ${li({ act: 'autoBackups', ic: 'history', title: 'Copias automáticas', sub: 'Se hacen solas antes de sincronizar o restaurar' })}
        ${li({ act: 'install', ic: 'phone', title: isStandalone() ? 'App instalada' : 'Instalar en el teléfono', sub: isStandalone() ? 'Funciona sin internet' : 'Añade el icono a la pantalla de inicio' })}
        ${li({ act: 'manual', ic: 'book', title: 'Manual de uso (PDF)' })}
      </div>
      <div class="list">${li({ act: 'wipe', ic: 'trash', color: 'red', title: '<span class="red-t">Borrar todos los datos de este teléfono</span>' })}</div>
      <p class="hint center">Import Business · versión ${APP_VERSION}</p>`,
    afterBind: async (pg, key) => {
      if (key === 'user') {
        local.user = pg.data.user.trim();
        await saveLocal();
        return;
      }
      if (key === '__notify') {
        await enableNotifications(pg.data.__notify);
        return pg.render();
      }
      const NUM = ['lbPrice', 'lbCost', 'feePct', 'remitPct', 'cubaDays', 'warnDays'];
      if (NUM.includes(key)) S[key] = num(pg.data[key]);
      else S[key] = pg.data[key];
      clearTimeout(pg.t);
      pg.t = setTimeout(() => commit(), 500);
    },
    acts: {
      chip: (el) => {
        S.roundTotal = num(el.dataset.v);
        commit();
      },
      seg: (el, ev, pg) => {
        const { name, v } = el.dataset;
        if (name === '__ui') return setPlatform(v);
        if (name === '__theme') {
          setTheme(v);
          return pg.render();
        }
        S[name] = v;
        commit();
      },
      storeDays: () => storeDaysPage(),
      stores: async () => {
        const v = await promptDlg({ title: 'Tiendas', message: 'Sepáralas con comas.', value: S.stores.join(', '), ok: 'Guardar' });
        if (v === null) return;
        const list = v.split(',').map((x) => x.trim()).filter(Boolean);
        if (list.length) S.stores = [...new Set(list)];
        commit();
      },
      expCats: async () => {
        const v = await promptDlg({ title: 'Categorías de gastos', message: 'Sepáralas con comas.', value: S.expenseCats.join(', '), ok: 'Guardar' });
        if (v === null) return;
        const list = v.split(',').map((x) => x.trim()).filter(Boolean);
        if (list.length) S.expenseCats = [...new Set(list)];
        commit();
      },
      sync: () => syncPage(),
      backup: () => exportBackup(),
      restore: () => importBackup(),
      autoBackups: () => backupsPage(),
      install: () => installApp(),
      manual: () => window.open('manual/Manual-Import-Business.pdf', '_blank'),
      wipe: async () => {
        if (!(await confirmDlg('Borrar todos los datos', 'Se borrarán encargos, remesas, gastos y cierres de este teléfono. No se puede deshacer. Haz antes una copia de seguridad.', 'Continuar', true))) return;
        const v = await promptDlg({ title: 'Confirma', message: 'Escribe BORRAR para confirmar.', ok: 'Borrar' });
        if ((v || '').trim().toUpperCase() !== 'BORRAR') return;
        await autoBackup('Antes de borrar todo');
        Object.assign(local, { onboarded: false, sync: { ...local.sync, enabled: false } });
        await saveLocal();
        await replaceState(defaultState());
        location.reload();
      },
    },
  });
}

function storeDaysPage() {
  const S = state.settings;
  const d = Object.fromEntries(S.stores.map((s) => [s, String(S.storeDays[s] ?? 7)]));
  openPage({
    title: 'Días hasta el almacén',
    data: d,
    action: { label: 'Guardar', act: 'save' },
    render: () => `<div class="form">
      <p class="hint">Cuántos días suele tardar cada tienda desde que compras hasta que llega al almacén. Sirve para calcular la llegada cuando no la escribes.</p>
      ${S.stores.map((s) => tf(esc(s), `<input class="inp" data-bind="${esc(s)}" value="${esc(d[s])}" inputmode="numeric">`, { suffix: 'días' })).join('')}
    </div>`,
    acts: {
      save: async (el, ev, pg) => {
        S.storeDays = { ...S.storeDays, ...Object.fromEntries(Object.entries(d).map(([k, v]) => [k, num(v) || 7])) };
        await commit();
        pg.close();
      },
    },
  });
}

/* ======================= copias automáticas ======================= */
export function backupsPage() {
  const pg = openPage({
    title: 'Copias automáticas',
    nav: 'back',
    data: { list: null },
    render: (p) => {
      const list = p.data.list;
      if (!list) return '<div class="empty-li">Cargando…</div>';
      return `
        <div class="banner">${icon('shield')}<span>Antes de traer datos de otros teléfonos, de combinar un archivo o de restaurar, la app guarda aquí una copia de este teléfono. Si algo sale mal, vuelve a una de ellas.</span></div>
        <div class="list">${list.length ? list.map((b) => li({
          act: 'pick', attrs: `data-id="${b.id}"`, ic: 'history', color: 'blue',
          title: `${fmtDate(b.date)} · ${fmtTime(b.ts)}`,
          sub: `${esc(b.label)}<br>${b.counts.orders} encargos · ${b.counts.remits} remesas · ${b.counts.expenses} gastos`,
        })).join('') : '<div class="empty-li">Todavía no hay copias automáticas.</div>'}</div>
        <div class="btn-row pad-h"><button class="btn tonal" data-act="now">${icon('plus')} Hacer una copia ahora</button></div>`;
    },
    acts: {
      now: async (el, ev, p) => {
        await autoBackup('Hecha a mano');
        p.data.list = await listBackups();
        p.render();
        snackbar('Copia guardada en el teléfono');
      },
      pick: async (el, ev, p) => {
        const b = p.data.list.find((x) => x.id === el.dataset.id);
        const v = await dialog({
          title: 'Copia del ' + fmtDate(b.date) + ' · ' + fmtTime(b.ts),
          message: `${b.label}\n${b.counts.orders} encargos y ${b.counts.remits} remesas.\n\n«Restaurar» deja este teléfono como estaba entonces (antes guarda otra copia de lo actual).`,
          buttons: [{ label: 'Cancelar', value: null }, { label: 'Exportar', value: 'export' }, { label: 'Restaurar', value: 'restore', style: 'danger' }],
        });
        if (v === 'export') {
          const json = await backupJson(b.id);
          await shareFile(json, `import-business-copia-auto-${b.date}.json`, 'application/json');
        }
        if (v === 'restore') {
          await restoreBackup(b.id);
          location.reload();
        }
      },
    },
  });
  listBackups().then((l) => {
    pg.data.list = l;
    pg.render();
  });
}

/* ======================= sincronización (beta) ======================= */
const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=Import%20Business%20(sincronizar)';

export function syncPage() {
  openPage({
    title: 'Sincronizar (beta)',
    nav: 'back',
    live: true,
    render: () => {
      const on = local.sync.enabled && local.sync.code;
      return `
        <div class="banner blue">${icon('info')}<span><b>Función en pruebas.</b> Junta los cambios de todos los teléfonos del grupo para que todos vean el mismo dinero, encargos y remesas. Antes de traer datos nuevos, este teléfono guarda una copia de seguridad para poder volver atrás.</span></div>
        ${on ? `
          <div class="card sync-card ${local.sync.lastError ? 'err' : ''}">
            <div class="sc-top">${icon(local.sync.lastError ? 'cloudOff' : 'cloud')}<span class="grow"><b>${local.sync.lastError ? 'No se pudo sincronizar' : 'Sincronización activada'}</b><span class="dim">Última vez: ${lastSyncLabel()}</span></span></div>
            ${local.sync.lastError ? `<p class="red-t">${esc(local.sync.lastError)}</p>` : ''}
          </div>
          <button class="btn filled block lg" data-act="now" ${syncStatus.busy ? 'disabled' : ''}>${icon('sync')} ${syncStatus.busy ? 'Sincronizando…' : 'Sincronizar ahora'}</button>
          <div class="list">
            <label class="li check-li"><span class="grow"><span class="t">Automática</span><span class="s">Al abrir la app, al guardar algo y cada pocos minutos</span></span>${toggle('__auto', local.sync.auto)}</label>
            ${li({ act: 'shareCode', ic: 'users', color: 'blue', title: 'Añadir a otra persona', sub: 'Envíale el código del grupo' })}
            ${li({ act: 'autoBackups', ic: 'history', title: 'Copias automáticas', sub: 'Volver a como estaba antes de sincronizar' })}
            ${li({ act: 'leave', ic: 'cloudOff', color: 'red', title: 'Dejar de sincronizar', sub: 'Los datos se quedan en este teléfono' })}
          </div>`
        : `
          <div class="list">
            ${li({ act: 'join', ic: 'link', color: 'green', title: 'Unirme a un grupo', sub: 'Tengo el código que me mandaron' })}
            ${li({ act: 'create', ic: 'users', color: 'blue', title: 'Crear el grupo', sub: 'Lo hace UNA sola persona; luego manda el código a los demás' })}
          </div>`}
        ${secTitle('Sin internet: por archivo')}
        <div class="list">
          ${li({ act: 'sendFile', ic: 'share', title: 'Enviar mis datos', sub: 'Por WhatsApp, Bluetooth, etc.' })}
          ${li({ act: 'mergeFile', ic: 'upload', title: 'Combinar datos recibidos', sub: 'Junta el archivo de otro teléfono con los tuyos' })}
        </div>
        <p class="hint">${icon('lock')} Los datos compartidos se guardan cifrados en un Gist secreto de GitHub: sin el código del grupo no se pueden leer. GitHub guarda además el historial de versiones. Quien tenga el código puede ver y cambiar los datos: compártelo solo con el equipo.</p>
        ${!local.user ? `<div class="banner amber">${icon('user')}<span>Escribe tu nombre en Ajustes para que los demás sepan quién hizo cada cambio.</span></div>` : ''}`;
    },
    afterBind: async (pg, key) => {
      if (key === '__auto') {
        local.sync.auto = !!pg.data.__auto;
        await saveLocal();
      }
    },
    acts: {
      now: () => runSync({ manual: true }),
      shareCode: () => shareCode(local.sync.code),
      autoBackups: () => backupsPage(),
      leave: async () => {
        if (!(await confirmDlg('Dejar de sincronizar', 'Este teléfono dejará de enviar y recibir cambios. Tus datos se quedan aquí. Para volver necesitarás el código del grupo.', 'Dejar de sincronizar', true))) return;
        local.sync = { ...local.sync, enabled: false, code: '', lastError: '' };
        await saveLocal();
        refresh();
      },
      join: () => joinPage(),
      create: () => createPage(),
      sendFile: () => exportBackup('datos'),
      mergeFile: async () => {
        const data = await pickJson();
        if (!data) return;
        try {
          const r = await mergeFromFile(data);
          await commit();
          dialog({ title: 'Datos combinados', ic: 'checkCircle', message: r.total ? `Se añadieron o actualizaron ${r.total} registros${data.by ? ` de ${data.by}` : ''}. Antes se guardó una copia automática de tus datos.` : 'No había nada nuevo en ese archivo.' });
        } catch (e) {
          dialog({ title: 'No se pudo combinar', ic: 'warning', message: e.message });
        }
      },
    },
  });
}

async function shareCode(code) {
  const text = `Código del grupo de Import Business (no lo reenvíes a nadie más):\n\n${code}\n\nAbre la app → Ajustes → Sincronizar → Unirme a un grupo, y pégalo.`;
  const v = await dialog({ title: 'Código del grupo', message: 'Mándalo SOLO a las personas del negocio. Con él pueden ver y cambiar los datos.', html: `<div class="code-box">${esc(code)}</div>`, buttons: [{ label: 'Cerrar', value: null }, { label: 'Copiar', value: 'copy' }, { label: 'Compartir', value: 'share', style: 'filled' }] });
  if (v === 'copy') copyText(code, 'Código copiado');
  if (v === 'share') shareText(text, 'Código del grupo');
}

function createPage() {
  const d = { token: '' };
  openPage({
    title: 'Crear el grupo',
    data: d,
    action: { label: 'Crear', act: 'save' },
    render: () => `
      <div class="form">
        <p class="hint">Hace falta una cuenta de GitHub (la misma donde está la app) y un «token»: una llave que solo deja guardar Gists.</p>
        <ol class="steps">
          <li>Toca <b>Abrir GitHub</b> e inicia sesión.</li>
          <li>En «Expiration» elige <b>No expiration</b>. La casilla <b>gist</b> ya viene marcada.</li>
          <li>Baja y toca <b>Generate token</b>. Copia el código que empieza por <b>ghp_</b>.</li>
          <li>Vuelve aquí, pégalo abajo y toca <b>Crear</b>.</li>
        </ol>
        <a class="btn tonal" href="${TOKEN_URL}" target="_blank" rel="noopener">${icon('external')} Abrir GitHub</a>
        ${tf('Token de GitHub', inp('token', d.token, 'placeholder="ghp_…" autocapitalize="off" autocorrect="off" spellcheck="false"'))}
        <p class="hint">Se subirán los datos de este teléfono. Los demás, al unirse, combinan los suyos con estos.</p>
      </div>`,
    acts: {
      save: async (el, ev, pg) => {
        if (d.token.trim().length < 20) return snackbar('Pega el token completo');
        el.disabled = true;
        snackbar('Creando el grupo…');
        try {
          const code = await createGroup(d.token);
          local.sync = { ...local.sync, enabled: true, code, lastError: '', lastSync: Date.now() };
          await saveLocal();
          pg.close();
          refresh();
          shareCode(code);
        } catch (e) {
          el.disabled = false;
          dialog({ title: 'No se pudo crear', ic: 'warning', message: e.message });
        }
      },
    },
  });
}

function joinPage() {
  const d = { code: '' };
  openPage({
    title: 'Unirme a un grupo',
    data: d,
    action: { label: 'Unirme', act: 'save' },
    render: () => `
      <div class="form">
        <p class="hint">Pide el código a la persona que creó el grupo (empieza por <b>IB1-</b>) y pégalo aquí.</p>
        ${tf('Código del grupo', `<textarea class="inp ta" data-bind="code" rows="4" placeholder="IB1-…" autocapitalize="off" autocorrect="off" spellcheck="false">${esc(d.code)}</textarea>`)}
        <button class="btn tonal sm" data-act="paste">${icon('clipboard')} Pegar</button>
      </div>`,
    acts: {
      paste: async (el, ev, pg) => {
        try {
          d.code = (await navigator.clipboard.readText()).trim();
          pg.render();
        } catch {
          snackbar('Mantén pulsado el campo y elige «Pegar»');
        }
      },
      save: async (el, ev, pg) => {
        try {
          decodeCode(d.code);
        } catch (e) {
          return dialog({ title: 'Código no válido', ic: 'warning', message: e.message });
        }
        snackbar('Comprobando…');
        try {
          const info = await peekGroup(d.code);
          const mine = state.orders.length + state.remits.length + state.expenses.length;
          const ok = await dialog({
            title: 'Grupo encontrado',
            ic: 'users',
            message: `Hay ${info.counts.orders} encargos y ${info.counts.remits} remesas${info.by ? `, subidos por ${info.by}` : ''}.\n\n${mine ? `Tus datos (${state.orders.length} encargos, ${state.remits.length} remesas) se combinarán con los del grupo. Antes se guarda una copia automática de este teléfono.` : 'Se descargarán a este teléfono.'}`,
            buttons: [{ label: 'Cancelar', value: false }, { label: 'Unirme', value: true, style: 'filled' }],
          });
          if (!ok) return;
          await autoBackup('Antes de unirme al grupo');
          // Los ajustes del grupo mandan sobre los de un teléfono recién empezado.
          const remote = info.remote;
          if (!mine) remote.meta = { ...(remote.meta || {}), supd: Object.fromEntries(Object.keys(remote.settings || {}).map((k) => [k, Date.now()])) };
          const merged = mergeStates(state, remote);
          await replaceState({ ...merged, meta: { ...state.meta, ...merged.meta } });
          resetSnapshot();
          local.sync = { ...local.sync, enabled: true, code: d.code.trim(), lastError: '' };
          local.onboarded = true;
          await saveLocal();
          pg.close();
          topPage()?.close();
          await runSync({ manual: true });
          refresh();
        } catch (e) {
          dialog({ title: 'No se pudo unir', ic: 'warning', message: e.message });
        }
      },
    },
  });
}

/** Sincroniza y avisa del resultado. Con `manual` muestra errores; en automático solo los guarda. */
export async function runSync({ manual = false, beforeApply } = {}) {
  if (!local.sync.enabled || !local.sync.code) return;
  if (!manual && !navigator.onLine) return;
  refresh();
  try {
    const r = await syncNow({ beforeApply });
    if (r.skipped) return;
    if (r.changed) {
      refresh();
      snackbar(`Sincronizado: ${r.incoming.total} cambio${r.incoming.total === 1 ? '' : 's'} de otros teléfonos`);
    } else if (manual) snackbar(r.pushed ? 'Tus cambios ya están en el grupo' : 'Todo está al día');
  } catch (e) {
    if (manual) dialog({ title: 'No se pudo sincronizar', ic: 'cloudOff', message: e.message });
  }
  refresh();
}

/* ======================= bienvenida ======================= */
export function welcomePage() {
  const S = state.settings;
  const d = { user: local.user, business: S.business, lbPrice: String(S.lbPrice), lbCost: String(S.lbCost), remitPct: String(S.remitPct), card: '', cash: '' };
  openPage({
    title: 'Bienvenida',
    cls: 'welcome',
    dismissable: false,
    data: d,
    render: () => `
      <div class="welcome-hero">
        <img src="icons/icon-192.png" alt="" width="84" height="84">
        <h1>Import Business</h1>
        <p>Encargos de compras por internet con envío a Cuba, remesas, el dinero de la tarjeta y del efectivo, gastos y el cierre de cada día.</p>
      </div>
      <div class="form">
        ${tf('Tu nombre', inp('user', d.user, 'placeholder="Ej. Marco" autocapitalize="words"'))}
        <div class="row2">
          ${tf('Cobro por libra', numInp('lbPrice', d.lbPrice), { suffix: 'USD' })}
          ${tf('Nos cuesta la libra', numInp('lbCost', d.lbCost), { suffix: 'USD' })}
        </div>
        ${tf('Comisión de las remesas', numInp('remitPct', d.remitPct), { suffix: '%' })}
        <div class="row2">
          ${tf('Hay en la tarjeta', numInp('card', d.card, 'placeholder="0"'), { suffix: 'USD' })}
          ${tf('Efectivo en Cuba', numInp('cash', d.cash, 'placeholder="0"'), { suffix: 'USD' })}
        </div>
        <div class="tf-help">El dinero que tienen ahora, para que los saldos empiecen bien. Se puede cambiar luego.</div>
      </div>`,
    footer: () => '<button class="btn filled block lg" data-act="start">Empezar</button><button class="btn text block" data-act="join">Ya lo usamos en otro teléfono: unirme</button>',
    acts: {
      join: async (el, ev, pg) => {
        local.user = d.user.trim();
        await saveLocal();
        joinPage();
      },
      start: async (el, ev, pg) => {
        if (!d.user.trim()) return snackbar('Escribe tu nombre');
        local.user = d.user.trim();
        local.onboarded = true;
        local.seenVersion = APP_VERSION;
        Object.assign(S, { lbPrice: num(d.lbPrice), lbCost: num(d.lbCost), remitPct: num(d.remitPct) });
        for (const [acc, v] of [['tarjeta', d.card], ['efectivo', d.cash]]) {
          if (num(v)) state.moves.push({ id: uid(), ts: Date.now(), date: today(), account: acc, amount: num(v), type: 'inicial', note: 'Dinero al empezar a usar la app' });
        }
        await saveLocal();
        await commit();
        pg.close();
      },
    },
  });
}
