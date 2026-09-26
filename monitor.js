const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = __dirname;
const RUNTIME = path.join(ROOT, 'runtime');
const PRIVATE = path.join(ROOT, '.private');
const PROFILE = path.join(RUNTIME, 'browser-profile');
const CONFIG_PATH = path.join(ROOT, 'PERTEMUAN-UJI.json');
const CREDENTIAL_PATH = path.join(PRIVATE, 'simkuliah.xml');
const ATTENDANCE_URL = 'https://simkuliah.usk.ac.id/index.php/absensi';
const LOGIN_POLL_MS = 2000;
const CHECK_INTERVAL_MS = 60_000;
const LOGIN_URL = 'https://simkuliah.usk.ac.id/index.php/login';
const OCR_MODEL_PATH = path.join(RUNTIME, 'ocr-model.json');
const AUTO_LOGIN_ATTEMPTS = 6;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const iso = () => new Date().toISOString();
const slugTime = () => iso().replace(/[-:.TZ]/g, '').slice(0, 14);

// ---- Notifikasi Telegram (format HTML) ----
const WIB = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta', weekday: 'long', day: '2-digit', month: 'long',
  year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
});
const esc = value => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const wib = (value = Date.now()) => `${WIB.format(new Date(value))} WIB`;
const RULE = '━━━━━━━━━━━━━━━';

function notification(emoji, title, body) {
  return `${emoji} <b>${title}</b>\n${RULE}\n${body}`;
}

function courseLine(config) {
  const code = esc(String(config.course_code || '').toUpperCase());
  const name = esc(config.course_name || '');
  return `<b>${code}</b>${name ? ` — ${name}` : ''}`;
}

function classLine(config) {
  const parts = [`🏫 Kelas ${esc(config.class || 'A')}`];
  if (config.room) parts.push(`Ruang ${esc(config.room)}`);
  if (config.window) parts.push(`⏰ ${esc(config.window)}`);
  return parts.join(' · ');
}

const wibDateTag = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date()).replace(/-/g, '');

const ATTENDANCE_LABEL = {
  open: 'Absensi terbuka',
  closed: 'Absensi sudah ditutup',
  waiting_lecturer: 'Menunggu dosen membuka absensi',
  outside_window: 'Di luar waktu absen',
  unknown: 'Status belum dapat dipastikan'
};

const MESSAGES = {
  loginManual: () => notification('🔐', 'PERLU LOGIN MANUAL', [
    'CAPTCHA otomatis belum berhasil, jadi kode harus diketik manual.',
    '',
    'Chrome monitor sudah terbuka dengan NPM dan password terisi. Ketik kode pada kolom CAPTCHA, lalu tekan tombol Login.',
    RULE, `🕒 ${wib()}`
  ].join('\n')),
  loginRecovered: () => notification('✅', 'LOGIN BERHASIL', [
    'Login berhasil. Pemantauan dilanjutkan otomatis.',
    RULE, `🕒 ${wib()}`
  ].join('\n')),
  open: (config, when) => notification('🟢', 'ABSENSI DIBUKA', [
    courseLine(config),
    classLine(config),
    `🕒 ${wib(when)}`,
    RULE,
    'Absensi sudah bisa diisi. Segera buka halaman absensi dan isi kehadiran sebelum waktunya habis.',
    `🔗 <a href="${esc(config.attendance_url || ATTENDANCE_URL)}">Buka halaman Absensi</a>`
  ].join('\n')),
  waiting: config => notification('🟡', 'SUDAH MASUK JADWAL ABSEN', [
    courseLine(config),
    classLine(config),
    `🕒 ${wib()}`,
    RULE,
    'Waktu absen sudah masuk, tetapi dosen belum membuka presensi.',
    'Kamu akan diberi tahu lagi begitu dosen sudah absen dan tombol absen aktif.'
  ].join('\n')),
  scheduled: config => notification('🟡', 'SUDAH MASUK JADWAL ABSEN', [
    courseLine(config),
    classLine(config),
    `🕒 ${wib()}`,
    RULE,
    'Waktu absen sudah masuk. Monitor sedang menunggu absensi dibuka.',
    'Kamu akan diberi tahu lagi saat tombol absen sudah aktif.'
  ].join('\n')),
  interrupted: kind => notification('⚠️', 'PEMANTAUAN TERGANGGU', [
    kind === 'HTTP_500' ? 'Server layanan absensi mengembalikan HTTP 500.' : 'Tidak dapat menghubungi layanan absensi (gangguan jaringan).',
    '',
    'Monitor akan mencoba lagi pada siklus berikutnya; tidak ada tindakan yang perlu dilakukan sekarang.',
    RULE, `🕒 ${wib()}`
  ].join('\n')),
  recovered: () => notification('✅', 'PEMANTAUAN PULIH', [
    'Akses layanan absensi kembali normal dan pemantauan dilanjutkan.',
    RULE, `🕒 ${wib()}`
  ].join('\n')),
  finished: (config, checks, lastAttendance) => notification('🏁', 'PEMANTAUAN SELESAI', [
    courseLine(config),
    classLine(config),
    `🕒 ${wib()}`,
    RULE,
    `Status terakhir: ${ATTENDANCE_LABEL[lastAttendance] || ATTENDANCE_LABEL.unknown}`,
    `Total pemeriksaan: ${checks} kali`,
    'Rincian waktu dan status tersimpan di D:\\Absen\\runtime\\observations.jsonl'
  ].join('\n')),
  allFinished: count => notification('🏁', 'PEMANTAUAN SELESAI', [
    `Selesai memantau ${count} kelas hari ini.`,
    RULE, `🕒 ${wib()}`
  ].join('\n')),
  missed: config => notification('⏰', 'PEMANTAUAN TERLEWAT', [
    `Kelas ${courseLine(config)} sudah berakhir sebelum monitor dijalankan.`,
    '',
    'Tidak ada pemantauan yang dilakukan untuk pertemuan ini.',
    RULE, `🕒 ${wib()}`
  ].join('\n')),
  idleDone: state => notification('📊', 'PENGUKURAN IDLE SELESAI', [
    `Sesi masih diterima sampai <b>${state.lower_bound_seconds}</b> detik.`,
    `Sesi ditolak pada <b>${state.upper_bound_seconds}</b> detik.`,
    RULE, `🕒 ${wib()}`
  ].join('\n')),
  idleInterrupted: target => notification('⚠️', 'Uji idle terganggu', [
    `Target ${target} detik dibatalkan dan akan diulang dengan sesi baru.`,
    RULE, `🕒 ${wib()}`
  ].join('\n')),
  activeDone: state => notification('📊', 'UJI SESI 180 MENIT SELESAI', state.status === 'expired'
    ? [`Sesi berakhir lebih cepat pada ${wib(state.expired_at)}.`, RULE, `🕒 ${wib()}`].join('\n')
    : [`Sesi bertahan selama uji refresh aktif 180 menit.`, RULE, `🕒 ${wib()}`].join('\n')),
  fatal: message => notification('🛑', 'MONITOR BERHENTI', [
    esc(message),
    '',
    'Monitor tidak lagi berjalan. Periksa log, lalu jalankan ulang bila perlu.',
    RULE, `🕒 ${wib()}`
  ].join('\n'))
};

function ensureDirectories() {
  for (const dir of [RUNTIME, PRIVATE, PROFILE]) fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
}

function appendObservation(mode, status, details = {}) {
  fs.appendFileSync(path.join(RUNTIME, 'observations.jsonl'), `${JSON.stringify({ at: iso(), mode, status, ...details })}\n`);
}

function acquireLock() {
  const file = path.join(RUNTIME, 'monitor.lock');
  if (fs.existsSync(file)) {
    const previous = Number(fs.readFileSync(file, 'utf8'));
    try { process.kill(previous, 0); throw new Error(`Monitor already running (PID ${previous}).`); } catch (error) {
      if (error.message.startsWith('Monitor already')) throw error;
    }
  }
  fs.writeFileSync(file, String(process.pid), { flag: 'w' });
  const release = () => { try { if (fs.readFileSync(file, 'utf8') === String(process.pid)) fs.unlinkSync(file); } catch {} };
  process.once('exit', release);
  process.once('SIGINT', () => { release(); process.exit(130); });
  process.once('SIGTERM', () => { release(); process.exit(143); });
}

function powershellEscape(value) { return value.replace(/'/g, "''"); }

function envCredential(env = process.env) {
  const account = String(env.SIMKULIAH_ACCOUNT || '').trim();
  const password = String(env.SIMKULIAH_PASSWORD || '');
  return account && password ? { account, password } : null;
}

function loadCredential() {
  const fromEnv = envCredential();
  if (fromEnv) return fromEnv;
  if (!fs.existsSync(CREDENTIAL_PATH)) {
    throw new Error(`Credential missing. Run: powershell -File "${path.join(ROOT, 'Setup-Account.ps1')}"`);
  }
  const file = powershellEscape(CREDENTIAL_PATH);
  const command = `$c=Import-Clixml -LiteralPath '${file}';[Console]::Out.Write($c.UserName+[Environment]::NewLine+$c.GetNetworkCredential().Password)`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('Encrypted account credential could not be read by this Windows account.');
  const split = result.stdout.indexOf('\n');
  if (split < 1) throw new Error('Encrypted account credential is invalid.');
  return { account: result.stdout.slice(0, split).trim(), password: result.stdout.slice(split + 1) };
}

function telegramConfig(env = process.env) {
  const token = String(env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = String(env.TELEGRAM_CHAT_ID || '').trim();
  return token && chatId ? { mode: 'http', token, chatId } : { mode: 'powershell' };
}

const receiptPath = eventKey => path.join(RUNTIME, `${eventKey}.json`);
const readReceipt = eventKey => readJson(receiptPath(eventKey), null);
const writeReceipt = (eventKey, data) => fs.writeFileSync(receiptPath(eventKey), JSON.stringify({ event: eventKey, ...data }, null, 2));

// ponytail: satu proses per job (concurrency dijaga workflow), jadi tanpa file lock.
async function sendTelegramHttp(eventKey, text, { token, chatId }) {
  if (readReceipt(eventKey)) return appendObservation('system', 'telegram_skipped', { event_key: eventKey });
  writeReceipt(eventKey, { status: 'uncertain', attempted_at: iso() });
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true })
    });
    const payload = await response.json();
    if (!payload.ok || !payload.result || !payload.result.message_id || String(payload.result.chat.id) !== String(chatId)) {
      throw new Error('delivery_not_confirmed');
    }
    writeReceipt(eventKey, { status: 'sent', attempted_at: iso(), message_id: payload.result.message_id });
  } catch (error) {
    appendObservation('system', 'telegram_error', { event_key: eventKey, error: error.message });
  }
}

function sendTelegram(eventKey, text) {
  const config = telegramConfig();
  if (config.mode === 'http') return void sendTelegramHttp(eventKey, text, config);
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'Send-Telegram.ps1'), '-EventKey', eventKey, '-Text', text], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) appendObservation('system', 'telegram_error', { event_key: eventKey, error: (result.stderr || result.stdout).trim() });
}

// Halaman /absensi memuat beberapa kelas sekaligus; batasi penilaian ke blok kelas
// yang dipantau agar status kelas lain tidak salah terbaca. Penanda blok: 'ABSENSI KELAS'.
function courseScope(normalized, courseCode) {
  if (!courseCode) return normalized;
  const code = courseCode.toUpperCase();
  const at = normalized.indexOf(code);
  if (at < 0) return normalized;
  const marker = 'ABSENSI KELAS';
  const start = normalized.lastIndexOf(marker, at);
  const after = normalized.indexOf(marker, at + code.length);
  return normalized.slice(start < 0 ? 0 : start, after < 0 ? normalized.length : after);
}

// Pisahkan halaman /absensi menjadi blok per kelas (penanda: 'Absensi Kelas'),
// lalu tentukan status tiap kelas dari teksnya. Dipakai mode monitor-all.
function classifyClassBlock(block) {
  const header = block.match(/Absensi Kelas\s+([A-Za-z0-9]+)\s*\|\s*([A-Z]{2,}\d{3,})\s*-\s*([^|]+)/i);
  const code = header ? header[2].toUpperCase() : (block.match(/\b([A-Z]{2,}\d{3,})\b/) || [])[1];
  const times = block.match(/(\d{1,2}[.:]\d{2})\s*-\s*(\d{1,2}[.:]\d{2})/);
  const upper = block.toUpperCase();
  let attendance = 'unknown';
  if (/KONFIRMASI KEHADIRAN|ABSEN SEKARANG|ISI ABSENSI|\bHADIR\b/.test(upper)) attendance = 'open';
  else if (/DOSEN.{0,80}BELUM.{0,80}ABSEN|DOSEN BELUM MELAKUKAN ABSENSI/.test(upper)) attendance = 'waiting_lecturer';
  else if (/BELUM MASUK WAKTU ABSEN/.test(upper)) attendance = 'outside_window';
  else if (/ABSENSI.{0,40}(DITUTUP|BERAKHIR)|WAKTU ABSEN.{0,40}(HABIS|BERAKHIR)/.test(upper)) attendance = 'closed';
  return {
    code: code || null,
    classCode: header ? header[1] : null,
    name: header ? header[3].trim() : '',
    window: times ? `${times[1]}-${times[2]}` : '',
    attendance
  };
}

function classifyClasses(text) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized
    .split(/(?=\bAbsensi Kelas\b)/i)
    .filter(block => /\bAbsensi Kelas\b/i.test(block))
    .map(classifyClassBlock)
    .filter(info => info.code);
}

function classifyDocument({ url = '', text = '', hasPassword = false, controls = [], courseCode = null }) {  const normalized = text.replace(/\s+/g, ' ').trim().toUpperCase();
  if (/HTTP ERROR 500|INTERNAL SERVER ERROR/.test(normalized)) return { session: 'HTTP_500', attendance: 'unknown' };
  if (hasPassword || (/LOGIN DENGAN AKUN|MASUK/.test(normalized) && /CAPTCHA/.test(normalized))) return { session: 'login_required', attendance: 'unknown' };
  const onAttendance = /\/INDEX\.PHP\/ABSENSI/i.test(url);
  if (!onAttendance) return { session: 'unknown', attendance: 'unknown' };
  const scope = courseScope(normalized, courseCode);
  const courseVisible = courseCode
    ? scope.includes(courseCode.toUpperCase())
    : /MMAI\d{4}/.test(scope);
  const openControl = controls.some(control => !control.disabled && /^(ABSEN|ABSEN SEKARANG|ISI ABSENSI|HADIR|KONFIRMASI KEHADIRAN)$/.test(String(control.text).trim().toUpperCase()));
  if (courseVisible && openControl) return { session: 'authenticated', attendance: 'open' };
  if (/DOSEN.{0,80}BELUM.{0,80}ABSEN|DOSEN BELUM MELAKUKAN ABSENSI/.test(scope)) return { session: 'authenticated', attendance: 'waiting_lecturer' };
  if (/BELUM MASUK WAKTU ABSEN/.test(scope)) return { session: 'authenticated', attendance: 'outside_window' };
  if (/ABSENSI.{0,40}(DITUTUP|BERAKHIR)|WAKTU ABSEN.{0,40}(HABIS|BERAKHIR)/.test(scope)) return { session: 'authenticated', attendance: 'closed' };
  return { session: 'authenticated', attendance: 'unknown' };
}

async function classifyPage(page, courseCode = null) {
  try {
    const text = await page.locator('body').innerText({ timeout: 5000 });
    const hasPassword = await page.locator('input[type="password"]:visible').count() > 0;
    const controls = await page.locator('button, a, input[type="submit"]').evaluateAll(elements => elements.map(element => ({
      text: element.innerText || element.value || '',
      disabled: Boolean(element.disabled) || element.getAttribute('aria-disabled') === 'true'
    })));
    return classifyDocument({ url: page.url(), text, hasPassword, controls, courseCode });
  } catch (error) {
    return { session: 'network_error', attendance: 'unknown', error: error.message };
  }
}

async function firstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count() && await locator.isVisible().catch(() => false)) return locator;
  }
  return null;
}

function loadOcrModel() {
  const model = readJson(OCR_MODEL_PATH, null);
  if (!model || !model.prototypes || !model.S) return null;
  return model;
}

// OCR di dalam halaman: baca #captcha-img, segmentasi, lalu cocokkan ke prototipe digit.
// ponytail: logika segmentasi/fitur diduplikasi dari tools/train-final.js; kalau berubah, ubah keduanya.
async function solveCaptcha(page) {
  const model = loadOcrModel();
  if (!model) return { ok: false, reason: 'model_missing' };
  if (!(await page.locator('#captcha-img').count())) return { ok: false, reason: 'captcha_image_missing' };
  const result = await page.evaluate(async (model) => {
    const el = document.querySelector('#captcha-img');
    const src = el.currentSrc || el.src;
    const im = new Image();
    im.src = src;
    await new Promise((res, rej) => { im.onload = res; im.onerror = () => rej(new Error('captcha image load failed')); });
    const w = im.naturalWidth, h = im.naturalHeight;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.drawImage(im, 0, 0);
    const d = ctx.getImageData(0, 0, w, h).data;
    const ink = new Float32Array(w * h), bin = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const lum = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3;
      ink[i] = lum < 235 ? Math.min(1, (240 - lum) / 150) : 0;
      bin[i] = lum < 150 ? 1 : 0;
    }
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
    const S = model.S, H = model.H;
    const features = [];
    for (const [x0, x1] of merged) {
      let y0 = h, y1 = 0;
      for (let y = 0; y < h; y++) for (let x = x0; x <= x1; x++) { const i = y * w + x; if (bin[i] && keep[label[i]]) { if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      if (y0 > y1) continue;
      const cells = [];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * w + x; if (ink[i] > 0.05) cells.push({ x, y, ink: ink[i] }); }
      if (!cells.length) continue;
      const hist = new Array(32).fill(0);
      for (const cc of cells) hist[Math.min(31, Math.floor(cc.ink * 32))]++;
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
      const wb = x1 - x0 + 1, hb = y1 - y0 + 1;
      const gw = Math.max(1, Math.round(wb * H / hb));
      const acc = new Float32Array(gw * H), cnt = new Float32Array(gw * H);
      for (const cc of cells) {
        const gx = Math.min(gw - 1, Math.floor((cc.x - x0) * gw / wb));
        const gy = Math.min(H - 1, Math.floor((cc.y - y0) * H / hb));
        acc[gy * gw + gx] += cc.ink; cnt[gy * gw + gx]++;
      }
      const v = new Float32Array(S * S);
      for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < gw; xx++) {
        const px = xx + Math.floor((S - gw) / 2), py = yy + Math.floor((S - H) / 2);
        if (px < 0 || py < 0 || px >= S || py >= S) continue;
        const a = cnt[yy * gw + xx] ? acc[yy * gw + xx] / cnt[yy * gw + xx] : 0;
        v[py * S + px] = a >= thr ? 1 : 0;
      }
      features.push(v);
    }
    const shiftL2 = (a, b) => {
      let best = Infinity;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        let s = 0;
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
          const yy = y + dy, xx = x + dx;
          const bv = (yy < 0 || xx < 0 || yy >= S || xx >= S) ? 0 : b[yy * S + xx];
          const dd = a[y * S + x] - bv; s += dd * dd;
        }
        const val = Math.sqrt(s / (S * S)); if (val < best) best = val;
      }
      return best;
    };
    const digits = Object.keys(model.prototypes);
    let answer = '', maxDistance = 0;
    for (const v of features) {
      let best = Infinity, bd = null;
      for (const dg of digits) { const dd = shiftL2(v, model.prototypes[dg]); if (dd < best) { best = dd; bd = dg; } }
      answer += bd; if (best > maxDistance) maxDistance = best;
    }
    return { ok: features.length === 5 && maxDistance <= 0.32, answer, glyphs: features.length, maxDistance: Number(maxDistance.toFixed(3)) };
  }, model);
  return result;
}

async function autoLogin(page, mode) {
  if (!loadOcrModel()) return false;
  const credential = loadCredential();
  const accountSelectors = [
    'input[autocomplete="username"]', 'input[name*="username" i]', 'input[name*="account" i]',
    'input[name*="npm" i]', 'input[id*="username" i]', 'input[id*="account" i]'
  ];
  const captchaSelectors = ['input[name*="captcha" i]', 'input[id*="captcha" i]', 'input[placeholder*="captcha" i]'];
  try {
    for (let attempt = 1; attempt <= AUTO_LOGIN_ATTEMPTS; attempt++) {
      if (!/\/login(\/|$)/i.test(page.url())) await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      const account = await firstVisible(page, accountSelectors);
      const password = await firstVisible(page, ['input[type="password"]']);
      const captcha = await firstVisible(page, captchaSelectors);
      if (!account || !password || !captcha) return false;
      const solved = await solveCaptcha(page);
      if (!solved.answer || solved.answer.length !== 5) {
        appendObservation(mode, 'captcha_unsolved', { attempt, glyphs: solved.glyphs, reason: solved.reason });
        if (attempt < AUTO_LOGIN_ATTEMPTS) await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        continue;
      }
      await account.fill(credential.account);
      await password.fill(credential.password);
      await captcha.fill(solved.answer);
      const submit = await firstVisible(page, ['button[type="submit"]', 'input[type="submit"]', 'button:has-text("Login")']);
      if (!submit) return false;
      appendObservation(mode, 'captcha_attempt', { attempt, answer: solved.answer, max_distance: solved.maxDistance, ok: solved.ok });
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {}),
        submit.click()
      ]);
      await sleep(1500);
      const status = await classifyPage(page);
      if (status.session === 'authenticated') return true;
      const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
      if (!/KODE VERIFIKASI SALAH|CAPTCHA/i.test(text)) return false;
    }
    return false;
  } finally {
    credential.password = '';
  }
}

function isNonInteractive(env = process.env) { return env.HEADLESS === '1' || Boolean(env.CI); }

function resolveEnd(env = process.env, config = {}) {
  if (env.MONITOR_END) return Date.parse(env.MONITOR_END);
  return config.end ? Date.parse(config.end) : null;
}

async function prepareManualLogin(page, mode) {
  if (await autoLogin(page, mode).catch(error => { appendObservation(mode, 'auto_login_error', { error: error.message }); return false; })) {
    appendObservation(mode, 'authenticated', { via: 'auto_captcha' });
    return;
  }
  if (isNonInteractive()) throw new Error('Auto login gagal; fallback CAPTCHA manual tidak tersedia di CI.');
  const credential = loadCredential();
  const account = await firstVisible(page, [
    'input[autocomplete="username"]', 'input[name*="username" i]', 'input[name*="account" i]',
    'input[name*="npm" i]', 'input[id*="username" i]', 'input[id*="account" i]'
  ]);
  const password = await firstVisible(page, ['input[type="password"]']);
  if (!account || !password) throw new Error('Login fields were not recognized; no form was submitted.');
  await account.fill(credential.account);
  await password.fill(credential.password);
  credential.password = '';
  const captcha = await firstVisible(page, [
    'input[name*="captcha" i]', 'input[id*="captcha" i]', 'input[placeholder*="captcha" i]'
  ]);
  if (captcha) await captcha.focus();
  const key = `simkuliah-auth-required-${slugTime()}`;
  sendTelegram(key, MESSAGES.loginManual());
  appendObservation(mode, 'login_ready_for_manual_captcha', { event_key: key });
}

async function ensureLogin(page, mode, notifyRecovery = false) {
  if (page.url() !== ATTENDANCE_URL) await page.goto(ATTENDANCE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  let status = await classifyPage(page);
  if (status.session === 'authenticated') return status;
  if (status.session !== 'login_required') {
    await page.goto(ATTENDANCE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    status = await classifyPage(page);
  }
  if (status.session !== 'login_required') throw new Error(`Cannot reach login form: ${status.session}`);
  await prepareManualLogin(page, mode);
  while (true) {
    await sleep(LOGIN_POLL_MS);
    status = await classifyPage(page);
    if (status.session === 'authenticated') {
      appendObservation(mode, 'authenticated');
      if (notifyRecovery) sendTelegram(`simkuliah-auth-recovered-${slugTime()}`, MESSAGES.loginRecovered());
      return status;
    }
  }
}

async function clearSession(context, page) {
  if (/simkuliah\.usk\.ac\.id/i.test(page.url())) {
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }).catch(() => {});
  }
  await context.clearCookies();
  await page.goto('about:blank');
}

async function probe(page, courseCode = null) {
  try {
    await page.goto(ATTENDANCE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return await classifyPage(page, courseCode);
  } catch (error) {
    return { session: 'network_error', attendance: 'unknown', error: error.message };
  }
}

function nextIdleTarget(lower, upper) {
  if (upper == null) return lower < 900 ? 900 : Math.ceil(lower * 2);
  if (upper - lower <= 60) return null;
  return Math.floor(lower + (upper - lower) / 2);
}

function writeReport() {
  const idle = readJson(path.join(RUNTIME, 'idle-measurement.json'), null);
  const active = readJson(path.join(RUNTIME, 'active-measurement.json'), null);
  const lines = ['# Hasil pengukuran sesi layanan absensi', '', `Diperbarui: ${iso()}`, ''];
  if (idle) {
    lines.push('## Idle timeout', '', `Status: **${idle.status}**`, `Batas bawah: ${idle.lower_bound_seconds} detik`, `Batas atas: ${idle.upper_bound_seconds == null ? 'belum ditemukan' : `${idle.upper_bound_seconds} detik`}`, '');
    lines.push('| Mulai | Target | Aktual | Hasil |', '| --- | ---: | ---: | --- |');
    for (const trial of idle.trials) lines.push(`| ${trial.started_at} | ${trial.target_seconds} detik | ${trial.actual_idle_seconds == null ? '-' : `${trial.actual_idle_seconds} detik`} | ${trial.result} |`);
    lines.push('');
  }
  if (active) lines.push('## Refresh aktif', '', `Status: **${active.status}**`, `Mulai: ${active.started_at || '-'}`, `Pemeriksaan berhasil: ${active.authenticated_checks || 0}`, `Pemeriksaan gagal: ${active.failed_checks || 0}`, `Jeda terpanjang: ${active.max_gap_seconds || 0} detik`, `Terakhir: ${active.last_check_at || '-'}`, '');
  fs.writeFileSync(path.join(ROOT, 'SESSION-RESULTS.md'), `${lines.join('\n')}\n`, 'utf8');
}

async function measureIdle(context, page) {
  const statePath = path.join(RUNTIME, 'idle-measurement.json');
  const state = readJson(statePath, { status: 'running', lower_bound_seconds: 503.588, upper_bound_seconds: null, trials: [] });
  while (state.status !== 'complete') {
    const target = nextIdleTarget(state.lower_bound_seconds, state.upper_bound_seconds);
    if (target == null) { state.status = 'complete'; break; }
    await clearSession(context, page);
    await page.goto(ATTENDANCE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await ensureLogin(page, 'measure-idle');
    const idleStarted = Date.now();
    const trial = { started_at: new Date(idleStarted).toISOString(), target_seconds: target, result: 'waiting' };
    state.trials.push(trial); writeJson(statePath, state); writeReport();
    await page.goto('about:blank');
    appendObservation('measure-idle', 'idle_wait_started', { target_seconds: target });
    await sleep(target * 1000);
    const result = await probe(page);
    const actual = Math.round((Date.now() - idleStarted) / 10) / 100;
    trial.checked_at = iso(); trial.actual_idle_seconds = actual; trial.result = result.session;
    appendObservation('measure-idle', result.session, { target_seconds: target, actual_idle_seconds: actual });
    if (result.session === 'authenticated') state.lower_bound_seconds = actual;
    else if (result.session === 'login_required') state.upper_bound_seconds = actual;
    else trial.result = `invalid_${result.session}`;
    writeJson(statePath, state); writeReport();
    if (trial.result.startsWith('invalid_')) sendTelegram(`simkuliah-idle-interrupted-${slugTime()}`, MESSAGES.idleInterrupted(target));
  }
  writeJson(statePath, state); writeReport();
  sendTelegram('simkuliah-idle-complete', MESSAGES.idleDone(state));
}

async function measureActive(context, page) {
  const statePath = path.join(RUNTIME, 'active-measurement.json');
  await clearSession(context, page);
  await page.goto(ATTENDANCE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await ensureLogin(page, 'measure-active');
  const started = Date.now();
  const end = started + 3 * 60 * 60 * 1000;
  const state = { status: 'running', started_at: new Date(started).toISOString(), target_minutes: 180, authenticated_checks: 0, failed_checks: 0, max_gap_seconds: 0 };
  writeJson(statePath, state); writeReport();
  let next = started + CHECK_INTERVAL_MS;
  let previousCheck = started;
  while (Date.now() < end) {
    await sleep(Math.max(0, next - Date.now()));
    const checkedAt = Date.now();
    state.max_gap_seconds = Math.max(state.max_gap_seconds, Math.round((checkedAt - previousCheck) / 1000));
    previousCheck = checkedAt;
    const result = await probe(page);
    state.last_check_at = iso(); state.last_status = result.session;
    appendObservation('measure-active', result.session, { scheduled_at: new Date(next).toISOString() });
    if (result.session === 'authenticated') state.authenticated_checks += 1;
    else if (result.session !== 'login_required') state.failed_checks += 1;
    if (result.session === 'login_required') { state.status = 'expired'; state.expired_at = iso(); break; }
    writeJson(statePath, state); writeReport();
    next = Math.max(next + CHECK_INTERVAL_MS, Date.now() + CHECK_INTERVAL_MS);
  }
  if (state.status === 'running') state.status = state.max_gap_seconds > 90 || state.failed_checks ? 'complete_180_minutes_with_gaps' : 'complete_180_minutes';
  writeJson(statePath, state); writeReport();
  sendTelegram('simkuliah-active-complete', MESSAGES.activeDone(state));
}

async function monitorClass(page) {
  const config = readJson(CONFIG_PATH, null);
  if (!config) throw new Error('PERTEMUAN-UJI.json is missing or invalid.');
  const code = String(config.course_code || 'MMAI1003').toUpperCase();
  const tag = `${String(config.start || '').slice(0, 10).replace(/-/g, '')}-${code}`;
  const start = Date.parse(config.start), end = Date.parse(config.end);
  if (Date.now() > end + 60_000) {
    appendObservation('monitor-class', 'missed', { configured_end: config.end });
    sendTelegram(`${tag}-summary`, MESSAGES.missed(config));
    return;
  }
  await ensureLogin(page, 'monitor-class');
  if (Date.now() < start) await sleep(start - Date.now());
  let previous = null, next = Math.max(Date.now(), start), checks = 0, lastAttendance = 'unknown';
  while (Date.now() <= end) {
    await sleep(Math.max(0, next - Date.now()));
    const result = await probe(page, code);
    checks += 1;
    if (result.attendance) lastAttendance = result.attendance;
    appendObservation('monitor-class', result.session, { attendance: result.attendance, scheduled_at: new Date(next).toISOString() });
    if (result.session === 'login_required') {
      await ensureLogin(page, 'monitor-class', true);
      previous = 'authenticated:unknown';
    } else {
      const current = `${result.session}:${result.attendance}`;
      if (current !== previous) {
        if (result.attendance === 'open') sendTelegram(`${tag}-open`, MESSAGES.open(config));
        else if (result.attendance === 'waiting_lecturer') sendTelegram(`${tag}-waiting`, MESSAGES.waiting(config));
        else if (['HTTP_500', 'network_error'].includes(result.session)) sendTelegram(`${tag}-error-${slugTime()}`, MESSAGES.interrupted(result.session));
        else if (previous && /HTTP_500|network_error/.test(previous) && result.session === 'authenticated') sendTelegram(`${tag}-recovered-${slugTime()}`, MESSAGES.recovered());
      }
      previous = current;
    }
    next = Math.max(next + CHECK_INTERVAL_MS, Date.now() + CHECK_INTERVAL_MS);
  }
  sendTelegram(`${tag}-summary`, MESSAGES.finished(config, checks, lastAttendance));
}

// Memantau SEMUA kelas yang tampil di halaman /absensi, tanpa perlu mengatur
// satu per satu. Notifikasi dikirim per kelas: 'waiting' lalu 'open', sekali
// per kelas per hari (event key memakai kode kelas).
async function monitorAll(page) {
  const config = readJson(CONFIG_PATH, {}) || {};
  const base = { attendance_url: config.attendance_url || ATTENDANCE_URL };
  const start = config.start ? Date.parse(config.start) : Date.now();
  const end = resolveEnd(process.env, config);
  await ensureLogin(page, 'monitor-all');
  if (Date.now() < start) await sleep(start - Date.now());
  let next = Math.max(Date.now(), start);
  const seen = new Set(), notified = new Set();
  while (!end || Date.now() <= end) {
    await sleep(Math.max(0, next - Date.now()));
    const status = await probe(page);
    if (status.session === 'login_required') {
      await ensureLogin(page, 'monitor-all', true);
    } else {
      const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
      const classes = classifyClasses(text);
      appendObservation('monitor-all', status.session, { classes: classes.map(item => `${item.code}:${item.attendance}`).join(',') });
      for (const info of classes) {
        const kind = info.attendance === 'open' ? 'open' : info.attendance === 'waiting_lecturer' ? 'waiting' : null;
        if (!kind) continue;
        const view = { ...base, course_code: info.code, course_name: info.name, class: info.classCode, window: info.window };
        // Jika pemeriksaan pertama sudah melihat status open, tetap kirim tahap
        // jadwal lebih dulu agar dua pengingat tidak hilang karena timing awal.
        const tag = `${wibDateTag()}-${info.code}`;
        if (kind === 'open' && !seen.has(`${tag}-waiting`)) {
          seen.add(`${tag}-waiting`);
          sendTelegram(`${tag}-waiting`, MESSAGES.scheduled(view));
        }
        const key = `${tag}-${kind}`;
        if (seen.has(key)) continue;
        seen.add(key);
        sendTelegram(key, kind === 'open' ? MESSAGES.open(view) : MESSAGES.waiting(view));
        notified.add(info.code);
      }
    }
    next = Math.max(next + CHECK_INTERVAL_MS, Date.now() + CHECK_INTERVAL_MS);
  }
  sendTelegram(`${wibDateTag()}-monitor-all-summary`, MESSAGES.allFinished(notified.size));
}

function launchOptions(env = process.env) {
  const headless = env.HEADLESS === '1' || Boolean(env.CI);
  return headless
    ? { headless: true, viewport: null }
    : { headless: false, channel: 'chrome', viewport: null, args: ['--start-maximized'] };
}

async function main() {
  const mode = process.argv[2];
  if (!['measure-idle', 'measure-active', 'monitor-class', 'monitor-all'].includes(mode)) throw new Error('Usage: node monitor.js <measure-idle|measure-active|monitor-class|monitor-all>');
  ensureDirectories(); acquireLock();
  const context = await chromium.launchPersistentContext(PROFILE, launchOptions());
  const page = context.pages()[0] || await context.newPage();
  try {
    if (mode === 'measure-idle') await measureIdle(context, page);
    if (mode === 'measure-active') await measureActive(context, page);
    if (mode === 'monitor-class') await monitorClass(page);
    if (mode === 'monitor-all') await monitorAll(page);
  } finally { await context.close(); }
}

module.exports = { classifyDocument, classifyClasses, nextIdleTarget, solveCaptcha, loadOcrModel, autoLogin, classifyPage, envCredential, launchOptions, telegramConfig, isNonInteractive, resolveEnd };
if (require.main === module) main().catch(error => {
  ensureDirectories(); appendObservation('system', 'fatal', { error: error.message });
  if (process.env.MONITOR_SUPPRESS_FATAL !== '1') {
    sendTelegram(`simkuliah-fatal-${slugTime()}`, MESSAGES.fatal(error.message));
  }
  console.error(error.message); process.exitCode = 1;
});
