// Sincronización entre teléfonos (beta, opcional) y copias de seguridad automáticas.
//
// Cómo funciona:
// 1. Cada vez que se guarda, se compara con la versión anterior y a cada registro que cambió se le pone
//    la hora del cambio (upd) y quién lo hizo (by). Lo que se borra deja una «lápida» para que se borre en los demás.
// 2. Al sincronizar se descarga la copia compartida, se guarda una COPIA DE SEGURIDAD de este teléfono y se
//    fusionan las dos: de cada registro gana la versión más reciente. Luego se sube el resultado.
// 3. La copia compartida es un Gist secreto de GitHub, cifrado con AES-256 (la clave va en el código del grupo):
//    GitHub solo ve datos ilegibles.
import { state, local, COLLECTIONS, defaultSettings, replaceState, save, saveLocal, idbGet, idbPut, uid, today, fmtDate, fmtTime } from './store.js';

const FILE = 'import-business.json';
const SHARED_KEYS = Object.keys(defaultSettings());

/* ======================= seguimiento de cambios ======================= */
let snap = null; // {col: Map(id → json)}, settings: {key: json}

const body = (r) => {
  const { upd, by, ...rest } = r;
  return JSON.stringify(rest);
};
export function resetSnapshot() {
  snap = { settings: {} };
  for (const c of COLLECTIONS) snap[c] = new Map((state[c] || []).map((r) => [r.id, body(r)]));
  for (const k of SHARED_KEYS) snap.settings[k] = JSON.stringify(state.settings[k]);
}

/** Marca con fecha y autor lo que cambió desde la última vez. Devuelve cuántos cambios hubo. */
export function track() {
  if (!snap) resetSnapshot();
  const now = Date.now();
  const by = local.user || local.device || '';
  let n = 0;
  for (const c of COLLECTIONS) {
    const prev = snap[c];
    const seen = new Set();
    for (const r of state[c]) {
      seen.add(r.id);
      const b = body(r);
      if (prev.get(r.id) !== b) {
        r.upd = now;
        r.by = by;
        prev.set(r.id, b);
        n++;
        state.tombs = state.tombs.filter((t) => t.id !== r.id);
      }
    }
    for (const id of [...prev.keys()]) {
      if (seen.has(id)) continue;
      prev.delete(id);
      state.tombs = state.tombs.filter((t) => t.id !== id);
      state.tombs.push({ id, col: c, upd: now });
      n++;
    }
  }
  for (const k of SHARED_KEYS) {
    const v = JSON.stringify(state.settings[k]);
    if (snap.settings[k] !== v) {
      snap.settings[k] = v;
      state.meta.supd[k] = now;
      n++;
    }
  }
  if (n) state.meta.changed = now;
  return n;
}

/* ======================= fusión ======================= */
const newer = (a, b) => (a.upd || 0) - (b.upd || 0) || String(a.by || '').localeCompare(String(b.by || '')) || body(a).localeCompare(body(b));

/** Fusiona dos estados: de cada registro gana el más reciente; los borrados se respetan. No modifica las entradas. */
export function mergeStates(a, b) {
  const out = JSON.parse(JSON.stringify(a));
  const tomb = new Map();
  for (const t of [...(a.tombs || []), ...(b.tombs || [])]) {
    const x = tomb.get(t.id);
    if (!x || t.upd > x.upd) tomb.set(t.id, t);
  }
  for (const c of COLLECTIONS) {
    const m = new Map();
    for (const r of a[c] || []) m.set(r.id, r);
    for (const r of b[c] || []) {
      const x = m.get(r.id);
      if (!x || newer(r, x) > 0) m.set(r.id, r);
    }
    out[c] = JSON.parse(JSON.stringify([...m.values()].filter((r) => {
      const t = tomb.get(r.id);
      return !t || (r.upd || 0) > t.upd;
    })));
  }
  // Ajustes compartidos: cada ajuste por separado, gana el cambiado más tarde.
  const sa = a.meta?.supd || {};
  const sb = b.meta?.supd || {};
  out.meta = { ...(a.meta || {}), supd: { ...sa } };
  for (const k of SHARED_KEYS) {
    if ((sb[k] || 0) > (sa[k] || 0) && b.settings && k in b.settings) {
      out.settings[k] = JSON.parse(JSON.stringify(b.settings[k]));
      out.meta.supd[k] = sb[k];
    }
  }
  // Un solo cierre por día (si dos personas cerraron el mismo día, queda el último).
  const now = Date.now();
  const byDate = new Map();
  for (const c of out.closures) {
    const x = byDate.get(c.date);
    if (!x || newer(c, x) > 0) byDate.set(c.date, c);
  }
  const keep = new Set([...byDate.values()].map((c) => c.id));
  for (const c of out.closures) if (!keep.has(c.id)) tomb.set(c.id, { id: c.id, col: 'closures', upd: now });
  out.closures = out.closures.filter((c) => keep.has(c.id));
  out.moves = out.moves.filter((m) => {
    if (m.type !== 'cierre' || !m.ref || keep.has(m.ref)) return true;
    tomb.set(m.id, { id: m.id, col: 'moves', upd: now });
    return false;
  });
  // Las lápidas de más de 120 días ya no hacen falta.
  out.tombs = [...tomb.values()].filter((t) => now - t.upd < 120 * 864e5);
  return out;
}

/** Huella del contenido: si dos estados tienen la misma, no hay nada que sincronizar. */
export function signature(s) {
  const parts = [];
  for (const c of COLLECTIONS) parts.push(c + ':' + (s[c] || []).map((r) => `${r.id}.${r.upd || 0}`).sort().join(','));
  parts.push('t:' + (s.tombs || []).map((t) => `${t.id}.${t.upd}`).sort().join(','));
  parts.push('s:' + Object.entries(s.meta?.supd || {}).sort().map(([k, v]) => `${k}.${v}`).join(','));
  return parts.join('|');
}

/** Qué trae una copia remota que este teléfono no tiene (para avisar). */
export function diffCounts(mine, other) {
  let added = 0;
  let changed = 0;
  let removed = 0;
  for (const c of COLLECTIONS) {
    const m = new Map((mine[c] || []).map((r) => [r.id, r]));
    for (const r of other[c] || []) {
      const x = m.get(r.id);
      if (!x) added++;
      else if ((r.upd || 0) > (x.upd || 0)) changed++;
    }
  }
  const mineIds = new Set(COLLECTIONS.flatMap((c) => (mine[c] || []).map((r) => r.id)));
  for (const t of other.tombs || []) if (mineIds.has(t.id)) removed++;
  return { added, changed, removed, total: added + changed + removed };
}

/* ======================= copias de seguridad automáticas ======================= */
const counts = (s) => ({ orders: (s.orders || []).length, remits: (s.remits || []).length, expenses: (s.expenses || []).length });

/** Guarda una copia de los datos actuales en el teléfono. Se conservan las 10 últimas y una por día de las 2 últimas semanas. */
export async function autoBackup(label) {
  const list = (await idbGet('backups')) || [];
  const rec = { id: uid(), ts: Date.now(), date: today(), label, json: JSON.stringify(state), counts: counts(state) };
  list.unshift(rec);
  const keep = [];
  const days = new Set();
  for (const [i, b] of list.entries()) {
    if (i < 10) keep.push(b);
    else if (Date.now() - b.ts < 14 * 864e5 && !days.has(b.date)) {
      days.add(b.date);
      keep.push(b);
    }
  }
  await idbPut('backups', keep);
  return rec;
}
export async function listBackups() {
  return ((await idbGet('backups')) || []).map(({ json, ...b }) => ({ ...b, size: json.length }));
}
export async function backupJson(id) {
  return ((await idbGet('backups')) || []).find((b) => b.id === id)?.json || null;
}
/** Vuelve a una copia (antes guarda otra con los datos actuales, por si acaso). */
export async function restoreBackup(id) {
  const json = await backupJson(id);
  if (!json) throw new Error('No se encontró la copia');
  await autoBackup('Antes de restaurar una copia');
  const s = JSON.parse(json);
  // Lo restaurado debe ganar en la próxima sincronización: se marca como cambiado ahora.
  await replaceState(s);
  resetSnapshot();
  await stampAll();
  return s;
}
/**
 * Marca todo como recién cambiado: lo restaurado se impone en la próxima sincronización
 * (lo que otros añadieron después de la copia vuelve a aparecer, no se pierde).
 */
async function stampAll() {
  const now = Date.now();
  for (const c of COLLECTIONS) for (const r of state[c]) r.upd = now;
  for (const k of SHARED_KEYS) state.meta.supd[k] = now;
  for (const t of state.tombs) t.upd = now;
  await save();
}

/* ======================= cifrado ======================= */
const b64u = {
  enc(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  },
};
const canZip = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
const aesKey = (k) => crypto.subtle.importKey('raw', b64u.dec(k), 'AES-GCM', false, ['encrypt', 'decrypt']);

export async function seal(obj, k) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  let bytes = new TextEncoder().encode(JSON.stringify(obj));
  const z = canZip() ? 1 : 0;
  if (z) bytes = await pipe(bytes, new CompressionStream('gzip'));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(k), bytes));
  return { iv: b64u.enc(iv), z, data: b64u.enc(ct) };
}
export async function unseal(p, k) {
  let bytes;
  try {
    bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64u.dec(p.iv) }, await aesKey(k), b64u.dec(p.data)));
  } catch {
    throw new SyncError('La clave del grupo no coincide con los datos compartidos. Vuelve a pegar el código del grupo.');
  }
  if (p.z) {
    if (!canZip()) throw new SyncError('Este navegador es muy antiguo para leer los datos compartidos. Actualiza Chrome o iOS.');
    bytes = await pipe(bytes, new DecompressionStream('gzip'));
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

/* ======================= código del grupo ======================= */
export class SyncError extends Error {}
const PREFIX = 'IB1-';
export function encodeCode({ g, t, k }) {
  return PREFIX + b64u.enc(new TextEncoder().encode(JSON.stringify({ g, t, k })));
}
export function decodeCode(code) {
  const c = String(code || '').trim().replace(/\s/g, '');
  if (!c.startsWith(PREFIX)) throw new SyncError('Ese no es un código de grupo de esta app (empieza por IB1-).');
  try {
    const o = JSON.parse(new TextDecoder().decode(b64u.dec(c.slice(PREFIX.length))));
    if (!o.g || !o.t || !o.k) throw new Error();
    return o;
  } catch {
    throw new SyncError('El código está incompleto. Cópialo entero otra vez.');
  }
}
export const newKey = () => b64u.enc(crypto.getRandomValues(new Uint8Array(32)));

/* ======================= GitHub Gist ======================= */
const api = () => local.sync.api || 'https://api.github.com';
async function gh(path, token, { method = 'GET', json } = {}) {
  let res;
  try {
    res = await fetch(api() + path, {
      method,
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(json ? { 'Content-Type': 'application/json' } : {}) },
      body: json ? JSON.stringify(json) : undefined,
    });
  } catch {
    throw new SyncError('Sin conexión con GitHub. Revisa internet (o la VPN) y vuelve a intentarlo.');
  }
  if (res.status === 401) throw new SyncError('GitHub rechazó el token: está mal copiado, caducó o lo borraron. Crea uno nuevo.');
  if (res.status === 403 || res.status === 429) throw new SyncError('GitHub no deja hacerlo ahora (permiso del token o demasiados intentos). Espera unos minutos.');
  if (res.status === 404) throw new SyncError('No se encontró el espacio compartido. Puede que se haya borrado o que el token no tenga permiso de «Gists».');
  if (!res.ok) throw new SyncError(`GitHub respondió con un error (${res.status}). Inténtalo más tarde.`);
  return res.json();
}

const envelope = async (k) => ({
  app: 'import-business', v: 1, updated: Date.now(), by: local.user || local.device || '',
  payload: await seal(shareable(state), k),
});
/** Lo que se comparte: todo menos los ajustes propios del teléfono. */
const shareable = (s) => ({ version: s.version, settings: s.settings, meta: { supd: s.meta.supd }, tombs: s.tombs, ...Object.fromEntries(COLLECTIONS.map((c) => [c, s[c]])) });

/** Crea el espacio compartido con los datos de este teléfono y devuelve el código para los demás. */
export async function createGroup(token) {
  token = token.trim();
  const k = newKey();
  const g = await gh('/gists', token, {
    method: 'POST',
    json: { description: 'Import Business · datos compartidos (cifrados)', public: false, files: { [FILE]: { content: JSON.stringify(await envelope(k)) } } },
  });
  return encodeCode({ g: g.id, t: token, k });
}

async function readGist(cfg) {
  const g = await gh(`/gists/${cfg.g}`, cfg.t);
  const f = g.files?.[FILE];
  if (!f) throw new SyncError('El espacio compartido no tiene datos de esta app.');
  let text = f.content;
  if (f.truncated) {
    try {
      text = await (await fetch(f.raw_url, { cache: 'no-store' })).text();
    } catch {
      throw new SyncError('No se pudo descargar la copia compartida completa.');
    }
  }
  const env = JSON.parse(text);
  return { env, rev: g.updated_at, remote: await unseal(env.payload, cfg.k) };
}

/** Comprueba un código antes de unirse: devuelve qué hay compartido. */
export async function peekGroup(code) {
  const cfg = decodeCode(code);
  const { env, remote } = await readGist(cfg);
  return { by: env.by, updated: env.updated, counts: counts(remote), remote };
}

/* ======================= sincronizar ======================= */
let running = null;
const listeners = new Set();
export const onSyncChange = (f) => listeners.add(f);
export const syncStatus = { busy: false };
const notify = () => listeners.forEach((f) => f());

/**
 * Descarga → copia de seguridad → fusiona → sube. Devuelve {changed, pushed, incoming}.
 * `beforeApply(incoming)` puede devolver false para no aplicar (p. ej. si hay un formulario abierto).
 */
export function syncNow(opts = {}) {
  if (running) return running;
  running = (async () => {
    syncStatus.busy = true;
    notify();
    try {
      const cfg = decodeCode(local.sync.code);
      let result = { changed: false, pushed: false, incoming: { total: 0 } };
      for (let attempt = 0; attempt < 3; attempt++) {
        const { remote, rev } = await readGist(cfg);
        const incoming = diffCounts(state, remote);
        const mineSig = signature(state);
        let merged = state;
        if (signature(remote) !== mineSig) {
          merged = mergeStates(state, remote);
          if (signature(merged) !== mineSig) {
            if (opts.beforeApply && (await opts.beforeApply(incoming)) === false) return { skipped: true };
            // Antes de traer datos nuevos: copia de lo que hay en este teléfono.
            await autoBackup(`Antes de sincronizar (${incoming.total} cambio${incoming.total === 1 ? '' : 's'} de otros)`);
            await replaceState({ ...merged, meta: { ...state.meta, ...merged.meta } });
            resetSnapshot();
            result.changed = true;
          }
        }
        result.incoming = incoming;
        if (signature(shareable(state)) === signature(remote)) break;
        // Si alguien subió algo mientras tanto, se vuelve a fusionar antes de subir.
        const now = await gh(`/gists/${cfg.g}`, cfg.t);
        if (now.updated_at !== rev) continue;
        await gh(`/gists/${cfg.g}`, cfg.t, { method: 'PATCH', json: { files: { [FILE]: { content: JSON.stringify(await envelope(cfg.k)) } } } });
        result.pushed = true;
        break;
      }
      local.sync.lastSync = Date.now();
      local.sync.lastError = '';
      await saveLocal();
      return result;
    } catch (e) {
      local.sync.lastError = e instanceof SyncError ? e.message : `Error inesperado: ${e.message}`;
      await saveLocal();
      throw e;
    } finally {
      syncStatus.busy = false;
      running = null;
      notify();
    }
  })();
  return running;
}

/** Fusiona con los datos de un archivo (otro teléfono sin internet). Hace antes una copia de seguridad. */
export async function mergeFromFile(data) {
  const remote = data.state || data;
  if (!remote || !Array.isArray(remote.orders)) throw new SyncError('El archivo no tiene datos de esta app.');
  const incoming = diffCounts(state, remote);
  await autoBackup(`Antes de combinar un archivo (${incoming.total} cambio${incoming.total === 1 ? '' : 's'})`);
  const merged = mergeStates(state, remote);
  await replaceState({ ...merged, meta: { ...state.meta, ...merged.meta } });
  resetSnapshot();
  return incoming;
}

export const lastSyncLabel = () => {
  const t = local.sync.lastSync;
  if (!t) return 'Nunca';
  const d = new Date(t);
  const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return ds === today() ? `Hoy a las ${fmtTime(t)}` : `${fmtDate(ds)} a las ${fmtTime(t)}`;
};
