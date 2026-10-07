// Contexto compartido: pestaña actual, refresco de pantallas, guardado y compartir.
import { save, local } from './store.js';
import { track } from './sync.js';
import { pages, dialog, snackbar } from './ui.js';

export const ctx = { tab: 'inicio' };

let renderView = () => {};
export const onRefresh = (f) => (renderView = f);

/** Vuelve a pintar la pestaña y las pantallas abiertas marcadas como «vivas». */
export function refresh(except = null) {
  renderView();
  for (const p of pages) if (p.opts.live && !p.closed && p !== except) p.render();
}

let afterCommit = () => {};
export const onCommit = (f) => (afterCommit = f);

/** Guarda: marca lo que cambió (para la sincronización), lo escribe en el teléfono y repinta. */
export async function commit() {
  track();
  refresh();
  if (!(await save())) {
    dialog({ title: 'No se pudo guardar', message: 'El almacenamiento del teléfono está lleno o bloqueado. Exporta una copia de seguridad desde Ajustes.', ic: 'warning' });
    return;
  }
  afterCommit();
}

/** Quién hace los cambios en este teléfono. */
export const me = () => local.user || 'Yo';

export async function copyText(text, msg = 'Copiado') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  snackbar(msg);
}

export async function shareText(text, title = '') {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  await copyText(text, 'Copiado: pégalo en WhatsApp');
}

/** Comparte un archivo (o lo descarga si el teléfono no puede compartir). Devuelve true si se compartió. */
export async function shareFile(content, name, type, title = '') {
  const file = new File([content], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return null;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1500);
  return false;
}

/** Abre un archivo .ics para que el teléfono lo añada al calendario con su recordatorio. */
export function openCalendarFile(ics, name) {
  const blob = new Blob([ics], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 3000);
}
