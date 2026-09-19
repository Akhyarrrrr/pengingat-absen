const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { solveCaptcha } = require('../monitor');

(async () => {
  const DIR = path.join(__dirname, '..', 'runtime', 'captcha-labeled');
  const labels = JSON.parse(fs.readFileSync(path.join(DIR, 'labels.json'), 'utf8'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  let pass = 0, fail = 0;
  for (const [file, word] of Object.entries(labels)) {
    const b64 = fs.readFileSync(path.join(DIR, file)).toString('base64');
    await page.setContent(`<img id="captcha-img" src="data:image/png;base64,${b64}">`);
    const r = await solveCaptcha(page);
    const ok = r.answer === word;
    ok ? pass++ : fail++;
    console.log(`${ok ? 'OK  ' : 'GAGAL'} ${file}: tebak='${r.answer}' harusnya='${word}' glyphs=${r.glyphs} dist=${r.maxDistance}`);
  }
  await browser.close();
  console.log(`\nHasil: ${pass}/${pass + fail} benar`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });