const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DIR = path.join(__dirname, '..', 'runtime', 'captcha-labeled');
const SAMPLES = path.join(__dirname, '..', 'runtime', 'captcha-samples');
const S = 32, H = 22;

function normAspect(cells) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (const c of cells) { if (c.x < x0) x0 = c.x; if (c.x > x1) x1 = c.x; if (c.y < y0) y0 = c.y; if (c.y > y1) y1 = c.y; }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const gw = Math.max(1, Math.round(w * H / h));
  const acc = new Float32Array(gw * H), cnt = new Float32Array(gw * H);
  for (const c of cells) {
    const gx = Math.min(gw - 1, Math.floor((c.x - x0) * gw / w));
    const gy = Math.min(H - 1, Math.floor((c.y - y0) * H / h));
    acc[gy * gw + gx] += c.ink; cnt[gy * gw + gx]++;
  }
  for (let i = 0; i < gw * H; i++) if (cnt[i]) acc[i] /= cnt[i];
  const out = new Float32Array(S * S);
  const ox = Math.floor((S - gw) / 2), oy = Math.floor((S - H) / 2);
  for (let y = 0; y < H; y++) for (let x = 0; x < gw; x++) {
    const xx = x + ox, yy = y + oy;
    if (xx >= 0 && yy >= 0 && xx < S && yy < S) out[yy * S + xx] = acc[y * gw + x];
  }
  return out;
}

function otsuBin(cells) {
  const hist = new Array(32).fill(0);
  for (const c of cells) hist[Math.min(31, Math.floor(c.ink * 32))]++;
  const total = cells.length;
  let sum = 0; for (let t = 0; t < 32; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, thr = 0.2;
  for (let t = 0; t < 32; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = (t + 0.5) / 32; }
  }
  const v = normAspect(cells);
  for (let i = 0; i < v.length; i++) v[i] = v[i] >= thr ? 1 : 0;
  return v;
}

function shiftL2(a, b) {
  let best = Infinity;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    let s = 0;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const yy = y + dy, xx = x + dx;
      const bv = (yy < 0 || xx < 0 || yy >= S || xx >= S) ? 0 : b[yy * S + xx];
      const d = a[y * S + x] - bv; s += d * d;
    }
    const v = Math.sqrt(s / (S * S)); if (v < best) best = v;
  }
  return best;
}

const segScript = async (page, samples) => page.evaluate(async (samples) => {
  async function load(b64) {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64;
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    return { w: c.width, h: c.height, d: ctx.getImageData(0, 0, c.width, c.height).data };
  }
  function inkMap({ w, h, d }) {
    const ink = new Float32Array(w * h), bin = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const lum = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3;
      ink[i] = lum < 235 ? Math.min(1, (240 - lum) / 150) : 0;
      bin[i] = lum < 150 ? 1 : 0;
    }
    return { w, h, ink, bin };
  }
  function glyphCells(ink, bin, w, h) {
    const label = new Int32Array(w * h).fill(-1), sizes = [], stack = [];
    let next = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (bin[i] && label[i] < 0) {
        let count = 0; label[i] = next; stack.push(i);
        while (stack.length) {
          const j = stack.pop(); count++;
          const yy = (j / w) | 0, xx = j % w;
          for (const [nx, ny] of [[xx + 1, yy], [xx - 1, yy], [xx, yy + 1], [xx, yy - 1]]) {
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const ni = ny * w + nx;
            if (bin[ni] && label[ni] < 0) { label[ni] = next; stack.push(ni); }
          }
        }
        sizes.push(count); next++;
      }
    }
    const keep = new Uint8Array(next);
    sizes.forEach((s, k) => { if (s >= 6) keep[k] = 1; });
    const col = new Array(w).fill(0);
    for (let i = 0; i < w * h; i++) if (bin[i] && keep[label[i]]) col[i % w]++;
    const spans = []; let start = -1;
    for (let x = 0; x < w; x++) {
      if (col[x] > 0 && start < 0) start = x;
      if (col[x] === 0 && start >= 0) { spans.push([start, x - 1]); start = -1; }
    }
    if (start >= 0) spans.push([start, w - 1]);
    const merged = [];
    for (const [a, b] of spans) if (merged.length && a - merged[merged.length - 1][1] <= 2) merged[merged.length - 1][1] = b; else merged.push([a, b]);
    const out = [];
    for (const [x0, x1] of merged) {
      let y0 = h, y1 = 0;
      for (let y = 0; y < h; y++) for (let x = x0; x <= x1; x++) { const i = y * w + x; if (bin[i] && keep[label[i]]) { if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      if (y0 > y1) continue;
      const cells = [];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * w + x; if (ink[i] > 0.05) cells.push({ x, y, ink: ink[i] }); }
      if (cells.length) out.push(cells);
    }
    return out;
  }
  const res = [];
  for (const s of samples) { const m = inkMap(await load(s.b64)); res.push({ name: s.name, glyphs: glyphCells(m.ink, m.bin, m.w, m.h) }); }
  return res;
}, samples);

(async () => {
  const labels = JSON.parse(fs.readFileSync(path.join(DIR, 'labels.json'), 'utf8'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();

  const lb = Object.keys(labels).map(f => ({ name: f, b64: fs.readFileSync(path.join(DIR, f)).toString('base64') }));
  const ul = fs.readdirSync(SAMPLES).filter(f => f.endsWith('.png')).sort().map(f => ({ name: f, b64: fs.readFileSync(path.join(SAMPLES, f)).toString('base64') }));
  const labeledRaw = await segScript(page, lb);
  const unlabeledRaw = await segScript(page, ul);
  await browser.close();

  const seeds = {};
  for (const s of labeledRaw) {
    const word = labels[s.name];
    if (s.glyphs.length !== word.length) { console.log('WARN', s.name, s.glyphs.length, word.length); continue; }
    s.glyphs.forEach((cells, i) => (seeds[word[i]] = seeds[word[i]] || []).push(otsuBin(cells)));
  }
  console.log('Seed per digit:', Object.fromEntries(Object.entries(seeds).map(([k, v]) => [k, v.length])));

  const aug = {};
  let augCount = 0;
  for (const s of unlabeledRaw) {
    if (s.glyphs.length !== 5) continue;
    for (const cells of s.glyphs) {
      const v = otsuBin(cells);
      let best = Infinity, bd = null;
      for (const d of Object.keys(seeds)) for (const sv of seeds[d]) { const dd = shiftL2(v, sv); if (dd < best) { best = dd; bd = d; } }
      if (bd !== null && best < 0.06) { (aug[bd] = aug[bd] || []).push(v); augCount++; }
    }
  }
  console.log('Augmentasi (d<0.06):', augCount, Object.fromEntries(Object.entries(aug).map(([k, v]) => [k, v.length])));

  const prototypes = {};
  const allByDigit = {};
  for (const d of '0123456789') allByDigit[d] = (seeds[d] || []).concat(aug[d] || []);
  for (const d of '0123456789') {
    const list = allByDigit[d] || [];
    if (!list.length) { console.log('PERINGATAN: digit tanpa sampel', d); continue; }
    const acc = new Float32Array(S * S);
    for (const v of list) for (let i = 0; i < v.length; i++) acc[i] += v[i];
    prototypes[d] = Array.from(acc, x => (x / list.length >= 0.5 ? 1 : 0));
  }
  console.log('Total sampel per digit (seed+aug):', Object.fromEntries(Object.entries(allByDigit).map(([k, v]) => [k, v.length])));

  // LOO: test tiap glyph berlabel, reference = prototipe (bukan dirinya) agar tidak bocor
  const test = [];
  for (const s of labeledRaw) {
    const word = labels[s.name];
    if (s.glyphs.length !== word.length) continue;
    s.glyphs.forEach((cells, i) => test.push({ digit: word[i], v: otsuBin(cells) }));
  }
  let ok = 0; const conf = {};
  for (const t of test) {
    let best = Infinity, bd = null;
    for (const d of Object.keys(prototypes)) { const dd = shiftL2(t.v, prototypes[d]); if (dd < best) { best = dd; bd = d; } }
    if (bd === t.digit) ok++; else { const k = `${t.digit}->${bd}`; conf[k] = (conf[k] || 0) + 1; }
  }
  console.log(`LOO (vs prototipe): ${(ok / test.length * 100).toFixed(1)}% (${ok}/${test.length})`, JSON.stringify(conf));

  fs.writeFileSync(path.join(__dirname, '..', 'runtime', 'ocr-model.json'), JSON.stringify({ S, H, prototypes }));
  console.log('Model tersimpan: runtime/ocr-model.json');
})().catch(e => { console.error(e); process.exit(1); });