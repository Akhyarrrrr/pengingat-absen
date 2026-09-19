const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, '..', 'runtime', 'captcha-samples');
const COUNT = 80;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.goto('https://simkuliah.usk.ac.id/index.php/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  for (let i = 0; i < COUNT; i++) {
    const url = 'https://simkuliah.usk.ac.id/index.php/login/captcha_image?t=' + Date.now() + '_' + i;
    const buf = await (await page.request.get(url)).body();
    fs.writeFileSync(path.join(OUT, `sample-${String(i).padStart(3, '0')}.png`), buf);
    await page.waitForTimeout(150);
  }
  console.log(`Tersimpan ${fs.readdirSync(OUT).length} sampel di ${OUT}`);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });