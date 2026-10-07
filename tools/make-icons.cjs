// Genera los iconos PNG de la app a partir de tools/icon.svg.
// Uso: NODE_PATH=$(npm root -g) node tools/make-icons.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
  const out = path.join(__dirname, '..', 'icons');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const shot = async (size, file, { pad = 0, bg = '#1f5fa8', html = null, transparent = false } = {}) => {
    await page.setViewportSize({ width: size, height: size });
    const inner = size - pad * 2;
    const s = svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `);
    // El icono «maskable» lleva margen: Android lo recorta en círculo o en la forma del lanzador.
    await page.setContent(html || `<html><body style="margin:0;background:${bg}"><div style="padding:${pad}px;width:${size}px;height:${size}px;box-sizing:border-box">${s}</div></body></html>`);
    await page.screenshot({ path: path.join(out, file), omitBackground: transparent });
  };
  await shot(192, 'icon-192.png');
  await shot(512, 'icon-512.png');
  await shot(180, 'apple-touch-icon.png');
  await shot(512, 'icon-maskable-512.png', { pad: 70 });
  // Icono pequeño de la barra de avisos de Android: silueta blanca sobre transparente.
  await shot(96, 'badge-96.png', {
    transparent: true,
    html: '<html><body style="margin:0;background:transparent"><svg width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/></svg></body></html>',
  });
  await browser.close();
  console.log('Iconos generados en', out);
})();
