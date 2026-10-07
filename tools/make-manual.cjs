// Genera manual/Manual-Import-Business.pdf a partir de tools/manual.html y las capturas de preview/.
// Uso (con el servidor local en marcha): NODE_PATH=$(npm root -g) node tools/make-manual.cjs
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const url = (process.env.APP_URL || 'http://localhost:8080/') + 'tools/manual.html';
  const out = path.join(__dirname, '..', 'manual', 'Manual-Import-Business.pdf');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  await page.pdf({
    path: out,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: '<div style="width:100%;font-size:8px;color:#5a5e66;padding:0 15mm;display:flex;justify-content:space-between;font-family:Arial"><span>Import Business · Manual de uso</span><span class="pageNumber"></span></div>',
    margin: { top: '15mm', bottom: '17mm', left: '15mm', right: '15mm' },
  });
  await browser.close();
  console.log('PDF:', out, Math.round(fs.statSync(out).size / 1024), 'KB');
})();
