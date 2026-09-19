const assert = require('assert');
const { classifyDocument, classifyClasses, nextIdleTarget, envCredential, launchOptions, telegramConfig, isNonInteractive, resolveEnd } = require('./monitor');

const auth = classifyDocument({ url: 'https://kampus.example/index.php/absensi', text: 'Nama Mahasiswa Belum masuk waktu absen.' });
assert.deepStrictEqual(auth, { session: 'authenticated', attendance: 'outside_window' });
assert.equal(classifyDocument({ url: 'https://kampus.example/', text: 'Login Dengan Akun CAPTCHA', hasPassword: true }).session, 'login_required');
assert.equal(classifyDocument({ text: 'HTTP ERROR 500' }).session, 'HTTP_500');
assert.equal(classifyDocument({ url: 'https://kampus.example/index.php/absensi', text: 'Nama Mahasiswa MMAI1003', controls: [{ text: 'Absen Sekarang', disabled: false }] }).attendance, 'open');
assert.equal(classifyDocument({ url: 'https://kampus.example/index.php/absensi', text: 'Nama Mahasiswa Dosen belum melakukan absensi' }).attendance, 'waiting_lecturer');
assert.equal(nextIdleTarget(503.588, null), 900);
assert.equal(nextIdleTarget(900, null), 1800);
assert.equal(nextIdleTarget(900, 960), null);
assert.equal(nextIdleTarget(900, 1100), 1000);

// Regresi: halaman /absensi asli kadang tak memuat teks nama/NPM di body.
assert.deepStrictEqual(
  classifyDocument({ url: 'https://kampus.example/index.php/absensi', text: 'ABSENSI KELAS A | MMAI1007 | PERTEMUAN KE-5' }),
  { session: 'authenticated', attendance: 'unknown' });
assert.equal(classifyDocument({ url: 'https://kampus.example/index.php/login', text: 'Absensi' }).session, 'unknown');

// courseCode: hanya kelas yang dimonitor boleh memicu 'open'.
const openControls = [{ text: 'Absen Sekarang', disabled: false }];
assert.equal(classifyDocument({ url: 'https://kampus.example/index.php/absensi', text: 'MMAI1007', controls: openControls, courseCode: 'MMAI1007' }).attendance, 'open');
assert.equal(classifyDocument({ url: 'https://kampus.example/index.php/absensi', text: 'MMAI1007', controls: openControls, courseCode: 'MMAI1001' }).attendance, 'unknown');

// Beberapa kelas di satu halaman: status kelas lain tak boleh bocor ke kelas yang dipantau.
const multi = [
  'Absensi Kelas A | MMAI1005 - PRAKTIKUM | Pertemuan ke-3 Info Absensi Batas Absen Dosen belum absen',
  'Absensi Kelas A | MMAI1007 - MANAJEMEN DAN PEMODELAN DATA | Pertemuan ke-5 Info Absensi Batas Absen Belum masuk waktu absen'
].join(' ');
assert.equal(classifyDocument({ url: 'https://kampus.example/index.php/absensi', text: multi, courseCode: 'MMAI1005' }).attendance, 'waiting_lecturer');
assert.equal(classifyDocument({ url: 'https://kampus.example/index.php/absensi', text: multi, courseCode: 'MMAI1007' }).attendance, 'outside_window');

// monitor-all: pisahkan kelas & baca status per kelas dari teks halaman.
const pageText = [
  'Absensi Kelas A | MMAI1005 - PRAKTIKUM PEMROGRAMAN UNTUK SAINS DATA DAN KECERDASAN ARTIFICIAL | Pertemuan ke-3 | SKS Mengajar : 1',
  'Info Absensi Mahasiswa hanya dapat melakukan presensi dalam rentang waktu 15 menit setelah dosen melakukan presensi.',
  'Anda belum absen',
  'Kelas Gedung Ruang Jam Batas Absen A Gedung MIPA Lab. Data Sains dan Kecerdasan Artifisial 09.50 - 11.30 Dosen belum absen',
  'Absensi Kelas A | MMAI1007 - MANAJEMEN DAN PEMODELAN DATA | Pertemuan ke-5 | SKS Mengajar : 3',
  'Info Absensi Batas Absen A Gedung MIPA Ruang B.01.01 08.00 - 10.30 Dosen belum absen'
].join(' ');
const pageClasses = classifyClasses(pageText);
assert.deepStrictEqual(pageClasses.map(item => item.code).sort(), ['MMAI1005', 'MMAI1007']);
assert.equal(pageClasses.find(item => item.code === 'MMAI1005').attendance, 'waiting_lecturer');
assert.equal(pageClasses.find(item => item.code === 'MMAI1005').window, '09.50-11.30');
assert.equal(pageClasses.find(item => item.code === 'MMAI1007').attendance, 'waiting_lecturer');

// Kelas yang tombol absennya sudah tampil dianggap terbuka.
const openClass = classifyClasses('Absensi Kelas A | MKU101 - CONTOH MATA KULIAH | Pertemuan ke-1 Info Absensi 08.00 - 09.40 Absen Sekarang');
assert.equal(openClass.length, 1);
assert.equal(openClass[0].code, 'MKU101');
assert.equal(openClass[0].attendance, 'open');

// Regresi live 2026-09-19: layout terbuka memuat kalimat disclaimer "dosen ... presensi",
// "Anda belum absen", "Batas Absen" DAN tombol "Konfirmasi Kehadiran" — harus dibaca 'open',
// bukan terjebak aturan waiting (DOSEN.{0,80}BELUM.{0,80}ABSEN).
const liveOpen = [
  'Absensi Kelas A | MMAI1001 - KECERDASAN ARTIFICIAL | Pertemuan ke-5 | SKS Mengajar : 3',
  'Info Absensi Mahasiswa hanya dapat melakukan presensi dalam rentang waktu 15 menit setelah dosen melakukan presensi.',
  'Anda belum absen',
  'Kelas Gedung Ruang Jam Batas Absen A Gedung MIPA B.01.01 14.00 - 16.30 14:18',
  'LINK DARING Belum diinput oleh dosen',
  'Konfirmasi Kehadiran'
].join(' ');
const liveClasses = classifyClasses(liveOpen);
assert.equal(liveClasses.length, 1);
assert.equal(liveClasses[0].code, 'MMAI1001');
assert.equal(liveClasses[0].attendance, 'open');
assert.equal(liveClasses[0].window, '14.00-16.30');
assert.equal(classifyDocument({ url: 'https://kampus.example/index.php/absensi', text: liveOpen, controls: [{ text: 'Konfirmasi Kehadiran', disabled: false }] }).attendance, 'open');
// Layout menunggu (tombol belum muncul) tetap 'waiting_lecturer' walau memuat disclaimer.
const liveWaiting = liveOpen.replace('Konfirmasi Kehadiran', 'Dosen belum melakukan absensi');
assert.equal(classifyClasses(liveWaiting)[0].attendance, 'waiting_lecturer');

assert.equal(envCredential({}), null);
assert.equal(envCredential({ SIMKULIAH_ACCOUNT: 'x' }), null);
assert.deepStrictEqual(envCredential({ SIMKULIAH_ACCOUNT: ' 26082 ', SIMKULIAH_PASSWORD: 'rahasia' }), { account: '26082', password: 'rahasia' });
assert.equal(launchOptions({}).headless, false);
assert.equal(launchOptions({}).channel, 'chrome');
assert.equal(launchOptions({ CI: 'true' }).headless, true);
assert.equal(launchOptions({ CI: 'true' }).channel, undefined);
assert.equal(launchOptions({ HEADLESS: '1' }).headless, true);
assert.deepStrictEqual(telegramConfig({}), { mode: 'powershell' });
assert.deepStrictEqual(telegramConfig({ TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_CHAT_ID: '9' }), { mode: 'http', token: '123:abc', chatId: '9' });
assert.equal(isNonInteractive({}), false);
assert.equal(isNonInteractive({ CI: 'true' }), true);
assert.equal(isNonInteractive({ HEADLESS: '1' }), true);
assert.equal(resolveEnd({ MONITOR_END: '2026-09-19T11:45:00+07:00' }, {}), Date.parse('2026-09-19T11:45:00+07:00'));
assert.equal(resolveEnd({}, { end: '2026-09-19T11:45:00+07:00' }), Date.parse('2026-09-19T11:45:00+07:00'));
assert.equal(resolveEnd({}, {}), null);

console.log('monitor self-check passed');
