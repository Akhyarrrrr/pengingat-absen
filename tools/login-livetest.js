const path = require('path');
const { chromium } = require('playwright');
const { autoLogin, classifyPage } = require('../monitor');

(async () => {
  const context = await chromium.launchPersistentContext(path.join(__dirname, '..', 'runtime', 'browser-profile'), {
    channel: 'chrome', headless: true, viewport: null,
  });
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://simkuliah.usk.ac.id/index.php/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const ok = await autoLogin(page, 'livetest');
  const status = await classifyPage(page);
  console.log('autoLogin =>', ok, '| classify:', JSON.stringify(status), '| url:', page.url());
  await context.close();
  process.exit(ok ? 0 : 2);
})().catch(e => { console.error(e); process.exit(1); });