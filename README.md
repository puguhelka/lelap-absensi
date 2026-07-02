# Lelap Absensi

Prototype awal dashboard absensi untuk Lelap Mom Baby Care Salatiga berdasarkan PRD.

## Isi Proyek

- `index.html` - aplikasi dashboard web statis.
- `styles.css` - tampilan dashboard operasional.
- `app.js` - data contoh, filter, modal detail, koreksi, audit log, dan export CSV.
- `database/schema.sql` - rancangan schema MySQL/MariaDB awal.

## Cara Membuka

Untuk dashboard tanpa backend, buka file `index.html` langsung di browser.

```text
C:\Users\user\Documents\lelap absen\index.html
```

Dashboard menggunakan data contoh di `app.js` agar alur utama bisa dicoba tanpa backend.

Untuk mode backend dengan proteksi admin, jalankan:

```powershell
cd "C:\Users\user\Documents\lelap absen\backend"
npm start
```

Lalu buka:

```text
http://127.0.0.1:3000/absensi
```

Di backend, dashboard hanya bisa diakses admin. Pengunjung tanpa sesi admin akan diarahkan ke `/absensi/login`.

## Fitur Prototype

- Ringkasan dashboard harian.
- Monitoring harian dengan filter tanggal, status, karyawan, shift, homecare, telat, dan review.
- Monitoring bulanan karyawan vs tanggal 1-31.
- Thumbnail foto masuk dan pulang.
- Modal detail absensi per hari.
- Koreksi status harian dengan alasan.
- Audit log koreksi.
- Data karyawan, shift, lokasi kantor, dan admin awal.
- Export CSV untuk laporan harian dan bulanan.

## Admin Awal

- `puguh.legowo.k@gmail.com`
- `refinna.sari.86@gmail.com`
- `refinna.sar.86@gmail.com`

Catatan: PRD menyebut dua variasi email Refinna. Prototype mencatat keduanya agar tidak ada yang hilang saat setup awal.

## Tahap Berikutnya

1. Upload proyek ke hosting/VPS untuk domain `lelap.web.id`.
2. Pasang reverse proxy Nginx dari `/absensi` dan `/api` ke backend port 3000.
3. Aktifkan HTTPS dan jalankan backend dengan `COOKIE_SECURE=true`.
4. Ganti data contoh dashboard di `app.js` menjadi panggilan API backend.
5. Buat aplikasi mobile Flutter untuk kamera, GPS, watermark, fake GPS check, dan device binding.
