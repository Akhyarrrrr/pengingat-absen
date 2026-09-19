# Pengingat Absen

Alat kecil untuk Windows yang **mengawasi halaman absensi kuliah** dan
**mengirim pesan Telegram** begitu absensi dibuka. Cocok kalau kamu tidak mau
bolak-balik me-refresh halaman demi menunggu dosen membuka absensi.

Alat ini **hanya menonton**. Ia tidak mengisi kehadiran, tidak menekan tombol
absen, dan tidak mengubah data apa pun di akunmu.

Semua pesan dan catatan memakai Bahasa Indonesia dan waktu WIB.

---

## Apa yang dilakukan, apa yang tidak

**Dilakukan**

- Membuka halaman absensi memakai Chrome, lalu memeriksanya berkala (biasanya
  tiap 60 detik) selama jam kuliah.
- Mengirim notifikasi Telegram saat: absensi terbuka, perlu login, ada
  gangguan situs, atau pemantauan selesai.
- Menyimpan catatan status ke berkas log.

**Tidak dilakukan**

- Tidak mengirim atau mengisi kehadiran.
- Tidak mengklik tombol absen.
- Tidak menyimpan password dalam bentuk teks biasa.

---

## Istilah singkat (untuk yang belum terbiasa)

- **Node.js** — program yang dibutuhkan agar alat ini bisa dijalankan.
- **Chrome** — browser yang dipakai alat ini untuk membuka halaman absensi.
  Nanti ia terbuka sendiri.
- **Bot Telegram** — "pesuruh" yang mengantarkan pesan ke Telegram-mu.
- **Token bot** — kunci rahasia bot, seperti kata sandi.
- **Config** — berkas pengaturan berisi jadwal dan alamat halaman absensi.
- **DPAPI** — cara Windows mengunci kata sandi khusus untuk komputer & akun
  Windows kamu. Kata sandi tidak bisa dibuka di komputer lain.

---

## Kebutuhan

- Windows, dengan akun pengguna yang sama setiap kali.
- Node.js dan Google Chrome.
- Internet saat pemantauan berjalan.
- Bot Telegram dan chat tujuan.

---

## Cara memasang

```powershell
cd D:\Absen
npm install
```

Cek cepat tanpa internet:

```powershell
npm test
```

---

## Mengatur jadwal & alamat halaman

1. Salin berkas contoh menjadi berkas pengaturan:

   ```powershell
   Copy-Item '.\PERTEMUAN-UJI.example.json' '.\PERTEMUAN-UJI.json'
   ```

2. Buka `PERTEMUAN-UJI.json`, lalu isi sesuai kelasmu:

   ```json
   {
     "course_code": "MKU101",
     "course_name": "Contoh Mata Kuliah",
     "class": "A",
     "room": "Ruang 101",
     "start": "2027-01-01T08:00:00+07:00",
     "end": "2027-01-01T10:30:00+07:00",
     "attendance_url": "https://contoh-kampus.ac.id/absensi"
   }
   ```

   `start` dan `end` memakai jam WIB (`+07:00`). Pemantauan berhenti sendiri
   setelah `end`.

Untuk `monitor-all`, hanya `start`, `end`, dan `attendance_url` yang perlu
diisi — alat membaca seluruh kelas langsung dari halaman absensi. Bila `start`
atau `end` dikosongkan, `monitor-all` berjalan langsung dan terus sampai
dihentikan.

Berkas `PERTEMUAN-UJI.json` **tidak ikut diunggah** ke git (sudah diabaikan),
jadi isinya tetap pribadi.

---

## Menyiapkan kredensial

Semua kredensial disimpan **terenkripsi** di folder `.private/`. Folder ini
tidak pernah ikut git dan hanya bisa dibuka oleh akun Windows yang membuatnya.

**1. Akun absensi** (`<NPM>` diganti nomormu):

```powershell
& '.\Setup-Account.ps1' -Account <NPM>
```

**2. Bot Telegram** (`<CHAT_ID>` dari bot `@userinfobot`):

```powershell
& '.\Setup-Telegram.ps1' -ChatId <CHAT_ID>
```

Uji jalur Telegram tanpa internet:

```powershell
& '.\Test-Notification.ps1'
```

Kirim pesan uji sungguhan:

```powershell
& '.\Send-Telegram.ps1' -EventKey 'tes-20270101120000' -Text 'Halo, ini uji.'
```

---

## Menjalankan pemantauan

```powershell
# Memantau SEMUA kelas yang tampil di halaman absensi (disarankan):
& '.\Start-Monitor.ps1' -Mode monitor-all

# Memantau satu kelas tertentu sesuai PERTEMUAN-UJI.json:
& '.\Start-Monitor.ps1' -Mode monitor-class

# Mengukur berapa lama sesi login bertahan saat diam:
& '.\Start-Monitor.ps1' -Mode measure-idle

# Menguji sesi dengan refresh tiap 60 detik selama 180 menit:
& '.\Start-Monitor.ps1' -Mode measure-active
```

**Penting:** hanya satu mode boleh berjalan pada satu waktu. Mode kedua akan
langsung berhenti dengan pesan kesalahan.

Saat login diperlukan, jendela Chrome akan terbuka. Kode CAPTCHA (5 angka)
diisi otomatis oleh alat; jika alat tidak yakin, kamu akan diminta mengisinya
manual melalui Telegram.

Pilihan mode:

| Mode | Kegunaan |
| --- | --- |
| `monitor-all` | Memantau semua kelas di halaman absensi sekaligus. |
| `monitor-class` | Memantau satu kelas (dari config). |
| `measure-idle` | Mengukur ketahanan sesi login. |
| `measure-active` | Menguji sesi sambil di-refresh berkala. |

---

## Menjalankan otomatis di GitHub Actions

Repo ini bisa memantau sendiri pada jam kuliah tanpa PC menyala. Isi dulu
empat secret di **Settings → Secrets and variables → Actions**:

| Secret | Isi |
| --- | --- |
| `SIMKULIAH_ACCOUNT` | NPM/akun layanan absensi |
| `SIMKULIAH_PASSWORD` | Password akun |
| `TELEGRAM_BOT_TOKEN` | Token bot Telegram |
| `TELEGRAM_CHAT_ID` | ID chat tujuan |

Alur `.github/workflows/monitor.yml` berjalan tiap sesi kuliah (Kamis, Jumat,
dan Sabtu) memakai Chromium headless, lalu berhenti sendiri di akhir sesi.
Tombol **Run workflow** bisa dipakai untuk uji coba kapan saja.

Catatan: jadwal workflow bersifat publik (jam kuliahmu bisa terlihat), cron
GitHub bisa telat beberapa menit, dan penjadwalan dinonaktifkan otomatis
setelah 60 hari tanpa aktivitas repo. Kredensial tidak pernah masuk ke repo —
hanya lewat Secrets.

---

## Contoh pesan notifikasi

```html
🟢 <b>ABSENSI DIBUKA</b>
━━━━━━━━━━━━━━━
<b>MKU101</b> — Contoh Mata Kuliah
🏫 Kelas A · Ruang 101
🕒 Jumat, 01 Januari 2027, 08.05 WIB
━━━━━━━━━━━━━━━
Absensi sudah bisa diisi. Segera buka halaman absensi dan isi kehadiran sebelum waktunya habis.
🔗 <a href="https://contoh-kampus.ac.id/absensi">Buka halaman Absensi</a>
```

Notifikasi lain yang mungkin masuk:

| Kejadian | Isi singkat |
| --- | --- |
| `ABSENSI DIBUKA` | Absensi terdeteksi bisa diisi (sekali per pertemuan). |
| `SUDAH MASUK JADWAL ABSEN` | Waktu absen masuk, dosen belum membuka presensi. |
| `PERLU LOGIN MANUAL` | Kode CAPTCHA harus diketik manual di Chrome. |
| `LOGIN BERHASIL` | Login pulih, pemantauan lanjut. |
| `PEMANTAUAN TERGANGGU` | Situs error atau jaringan bermasalah. |
| `PEMANTAUAN PULIH` | Gangguan selesai. |
| `PEMANTAUAN SELESAI` | Ringkasan setelah jam kuliah berakhir. |
| `PEMANTAUAN TERLEWAT` | Alat baru dijalankan setelah kelas selesai. |

---

## Cara alat ini menilai status

Penilaian melihat teks dan tombol pada halaman absensi:

- **Sudah login** bila berada di halaman absensi dan tidak ada kolom password.
- **Masuk jadwal absen** bila kelas terlihat dan keterangan dosen belum absen.
- **Absensi terbuka** hanya bila kelas yang dimonitor terlihat **dan** tombol
  absen benar-benar aktif.
- Status lain: di luar waktu absen, absensi ditutup, error server, atau
  gangguan jaringan.

Halaman absensi bisa memuat beberapa kelas sekaligus; penilaian dibatasi ke
blok kelas yang sedang dipantau agar status kelas lain tidak salah terbaca.

Pemeriksaan dilakukan sekali per 60 detik. Tidak ada permintaan tersembunyi
dan tidak ada pengulangan cepat.

---

## Isi folder `runtime`

Folder ini dibuat otomatis dan umumnya tidak ikut git; hanya
`runtime/ocr-model.json` yang ikut di-commit agar pembaca CAPTCHA tersedia di
runner GitHub Actions.

| Berkas / folder | Isi |
| --- | --- |
| `runtime/browser-profile` | Profil Chrome khusus alat ini. |
| `runtime/observations.jsonl` | Catatan status baris-per-baris (tanpa password). |
| `runtime/ocr-model.json` | Model pembaca angka CAPTCHA. |
| `runtime/captcha-samples` | Gambar contoh untuk melatih model. |
| `runtime/captcha-labeled` | Gambar CAPTCHA berlabel + `labels.json`. |
| `SESSION-RESULTS.md` | Ringkasan hasil pengukuran, ditulis ulang otomatis. |

---

## Pengujian

```powershell
npm test                              # klasifikasi & logika dasar (tanpa internet)
node tools/solve-selftest.js          # pembaca CAPTCHA pada 6 gambar berlabel
& '.\Test-Notification.ps1'           # logika kirim Telegram (tanpa internet)
```

Melatih ulang model pembaca CAPTCHA:

1. `node tools/snap-captchas.js` — menangkap gambar CAPTCHA baru.
2. Isi jawabannya di `runtime/captcha-labeled/labels.json`.
3. `node tools/train-final.js` — menulis ulang `runtime/ocr-model.json`.
4. `node tools/solve-selftest.js` — memastikan akurasi belum turun.

---

## Batasan & catatan

- CAPTCHA hanya berisi **5 angka**. Model kecil dilatih dari contoh berlabel;
  akurasi sekitar 5 dari 6, sisanya ditutup percobaan ulang dan isi manual.
- Beberapa menu tertentu di situs absensi bisa menampilkan error dari
  servernya sendiri. Alat ini menganggapnya sebagai status, bukan bug alat.
- Kata sandi dienkripsi khusus akun Windows. Jangan salin folder `.private`
  ke komputer atau cloud lain; di sana isinya tidak bisa dibuka.
- **Hosting:** selain Windows, alat ini bisa berjalan otomatis di GitHub
  Actions (Chromium headless, kredensial di Secrets). Lihat bagian
  "Menjalankan otomatis di GitHub Actions".

Catatan teknis untuk pengembang ada di `AGENTS.md` (berkas ini tidak ikut git).
