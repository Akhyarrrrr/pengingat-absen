const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, '..', 'runtime', 'captcha-labeled');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.goto('https://simkuliah.usk.ac.id/index.php/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const N = Number(process.argv[2] || 6);
  const files = [];
  for (let i = 0; i < N; i++) {
    const src = await page.locator('#captcha-img').getAttribute('src');
    const img = await page.goto(src, { timeout: 30000 });
    const f = `labeled-${i}.png`;
    fs.writeFileSync(path.join(OUT, f), await img.body());
    files.push(f);
    await page.goto('https://simkuliah.usk.ac.id/index.php/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('#btn-refresh-captcha').click().catch(() => {});
    await page.waitForTimeout(900);
  }
  console.log('Tersimpan:');
  files.forEach(f => console.log('  ' + path.join(OUT, f)));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });