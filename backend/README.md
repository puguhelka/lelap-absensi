# Backend Lelap Absensi

Backend MVP berbasis Node.js native tanpa dependency eksternal. Datastore disimpan di `backend/data/store.json` saat server pertama kali dijalankan.

## Menjalankan

```powershell
cd "C:\Users\user\Documents\lelap absen\backend"
npm start
```

Server berjalan di:

```text
http://127.0.0.1:3000
```

Dashboard statis tersedia dari backend:

```text
http://127.0.0.1:3000/absensi
```

Dashboard dilindungi login admin. Jika belum login, `/absensi` otomatis diarahkan ke:

```text
http://127.0.0.1:3000/absensi/login
```

Saat production di `https://lelap.web.id/absensi`, jalankan backend dengan:

```powershell
$env:COOKIE_SECURE="true"
npm start
```

Jika memakai Linux/VPS, contoh Nginx dan systemd ada di folder `deploy/`.

## Akun Seed

Admin:

- `puguh.legowo.k@gmail.com` / `Admin123!`
- `refinna.sari.86@gmail.com` / `Admin123!`
- `refinna.sar.86@gmail.com` / `Admin123!`

Karyawan contoh:

- `sari@lelap.web.id` / `Karyawan123!`
- `dinda@lelap.web.id` / `Karyawan123!`
- `maya@lelap.web.id` / `Karyawan123!`
- `rina@lelap.web.id` / `Karyawan123!`

## Endpoint Utama

Auth:

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Mobile:

- `GET /api/mobile/home`
- `GET /api/mobile/today-attendance`
- `GET /api/mobile/attendance/history`
- `GET /api/mobile/schedule`
- `POST /api/mobile/device/register`
- `POST /api/mobile/attendance/check-in`
- `POST /api/mobile/attendance/check-out`

Admin:

- `GET /api/admin/dashboard-summary?date=2026-06-30`
- `GET /api/admin/attendance/daily?date=2026-06-30`
- `GET /api/admin/attendance/monthly?month=6&year=2026`
- `GET /api/admin/attendance/:id`
- `PATCH /api/admin/attendance/:id/correction`
- `GET /api/admin/employees`
- `POST /api/admin/employees`
- `PATCH /api/admin/employees/:id`
- `PATCH /api/admin/employees/:id/reset-device`
- `GET /api/admin/shifts`
- `POST /api/admin/shifts`
- `PATCH /api/admin/shifts/:id`
- `GET /api/admin/reports/export-excel?type=daily&date=2026-06-30`
- `GET /api/admin/reports/export-pdf?type=monthly&month=6&year=2026`

Catatan: export Excel/PDF pada MVP ini menghasilkan CSV/text report agar bisa berjalan tanpa library tambahan. Saat pindah ke Laravel, endpoint yang sama bisa mengembalikan XLSX/PDF sungguhan.
