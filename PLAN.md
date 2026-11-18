# Rencana implementasi: demo 27 Okt 2026

Disetujui 24 Okt 2026 · acuan: `SPEC.md`, `docs/Buku-Panduan-OLT-C320-Pt1.pdf`

## Konteks

Repo baru berisi dokumen. `SPEC.md` sudah menetapkan lingkup demo untuk Selasa 27 Okt. Waktumu ±39,5 jam: Jumat malam 3 jam, Sabtu–Senin ±11,5 jam per hari, dan Selasa pagi 2 jam untuk gladi. Semua pekerjaan berjalan dalam satu jalur: satu sesi Claude Code, sementara kamu me-review dan menjalankan verifikasi. Rencana ini memecah SPEC menjadi tugas ≤ 3 jam sesuai urutanmu, menetapkan demo per hari, memasang gerbang Fase 1 sebelum Fase 2, dan menyusun daftar potongan. Keputusan di SPEC tidak diubah. Usulan tambahan dari saya diberi tanda **[usulan]**.

## Neraca waktu

| Bagian | Jam |
| --- | --- |
| Fase 1: A–H dan gerbangnya | 35,5 |
| Fase 2, lapis generator: I1–I3 dan gerbangnya | 3 |
| Hardening, deploy, gladi: J1, J2, J4 | 4,5 |
| **Jadwal dasar** | **43** |
| OLT asli: J3 dan K5, bersyarat pada akses | +2,5 |
| Lapis eksekusi Fase 2: I4–I7, di luar jadwal dasar | +5 |
| **Kapasitas** | **39,5** |

Estimasi di atas sudah termasuk waktu review dan verifikasi, dan totalnya sejalan dengan catatan SPEC §12 (44–56 jam untuk lingkup penuh). Jadwal dasar kekurangan ±3,5 jam, atau ±6 jam bila OLT asli ikut. Kekurangan itu menumpuk di Senin: 16 jam kerja, dari 08:00 sampai sekitar tengah malam. Cara menutupnya: kecepatan nyata dikalibrasi Sabtu pukul 20:00, lalu potongan bersyarat dipakai (lihat bagian akhir).

## Jadwal dan demo harian

| Hari | Rencana / kapasitas (jam) | Tugas | Demo akhir hari |
| --- | --- | --- | --- |
| Jum 23, malam | 3 / 3 | A1–A2 | `docker compose --profile dev up -d --wait` sehat; `https://localhost/api/health` → 200 |
| Sab 24 | 11 / 11,5 | B1–B4, C1–C3, D1, E1–E2 | SSH dan snmpwalk ke mock (127.0.0.1) menampilkan output seperti buku panduan; `scenario los-mass` mengubah keduanya; `parse` mengubah fixture panduan menjadi JSON; DB termigrasi |
| Min 25 | 11,5 / 11,5 | E3–E7, F1–F3 | 3 mock dipolling ke DB; `los-mass` → 1 pesan Telegram, `onu-los` → tanpa pesan; login per peran; admin dari luar LAN → 403; `GET /api/dashboard` ±210 ONU |
| Sen 26 | **16** / 11,5 | G1–G4, H1–H3, gerbang Fase 1, I1–I3, J1–J2 | Dashboard live; host key diputar → karantina → admin menerima; preview registrasi ONU; aplikasi jalan di VPS |
| Sel 27, pagi | 1,5 / 2 | J4 | Gladi penuh §14 E, lalu demo |

## Aturan kerja

- Tugas dianggap selesai bila verifikasinya lulus dan `pnpm check` hijau. Setelah itu commit (pesan dalam bahasa Inggris), centang tugasnya, dan catat jam aktual.
- Cara menjalankan: "Kerjakan <ID> dari PLAN.md". Satu sesi boleh untuk satu tugas atau satu blok.
- **∥** artinya tugas itu tidak bergantung pada tugas sebelumnya di bloknya. Urutannya boleh ditukar saat buntu (misalnya menunggu build), atau tugas itu dikerjakan sesi kedua bila nanti ada. Jalur K (kamu) berjalan sungguh-sungguh paralel.
- Semua perintah verifikasi hanya menuju mock (127.0.0.1 atau subnet `oltnet`). Claude tidak menyentuh OLT asli. J2, K4, dan K5 kamu jalankan sendiri.
- Nama paket: `@olt/shared`, `@olt/olt-spec`, `@olt/db`, `api`, `worker`, `ui`, `mock-olt`. Skrip root: `pnpm check` (lint, typecheck, unit), `pnpm test:int` (integrasi: Testcontainers dan mock in-process), `pnpm e2e` (Playwright, stack dev harus menyala).

## Tugas

### A. Scaffolding + Docker Compose (Jumat malam)

- [x] **A1 · Monorepo, tooling, CI** · 1,5 j · aktual: _isi_
  - Tujuan: workspace pnpm berisi kerangka semua paket dan app. Aturan keras 1 sudah ditegakkan lint sejak awal.
  - File: `git init`, `package.json`, `pnpm-workspace.yaml` (Node 24 LTS, `minimumReleaseAge` 7 hari), `tsconfig.base.json` (strict), `eslint.config.js` (`net-snmp` dan `ssh2` hanya boleh di `apps/worker` dan `apps/mock-olt`; `apps/api` dilarang mengimpor decryptor), `vitest.workspace.ts` (unplugin-swc untuk api dan worker), `.github/workflows/ci.yml`, kerangka `packages/*` dan `apps/*`, bagian "Perintah" di `CLAUDE.md`.
  - Verifikasi: `pnpm install --frozen-lockfile && pnpm check` exit 0. Tes DI di `apps/api` berhasil me-resolve service, membuktikan metadata dekorator berjalan. Tes aturan lint (lewat ESLint API) melaporkan error untuk `import 'ssh2'` di `apps/api`.

- [x] **A2 · Compose, Dockerfile, Caddy, konfigurasi** · 1,5 j
  - Tujuan: stack dev naik dengan satu perintah. Container sudah aman sejak awal supaya J1 tidak menjadi pekerjaan ulang.
  - File: `compose.yaml` berisi caddy, api, worker, postgres, dan redis, dengan jaringan `edge`, `internal`, dan `oltnet` (subnet tetap). Hanya caddy yang mempublikasikan port. Semua container non-root, `read_only` dengan tmpfs, `cap_drop: ALL`, dan `no-new-privileges`; caddy dan worker diberi sysctl port rendah. File lain: Dockerfile multi-stage per app (image caddy membawa hasil build UI), `deploy/Caddyfile` (`tls internal` untuk dev, fallback SPA, proxy `/api` dan `/socket.io`), `packages/shared/src/env.ts` (skema Zod; `APP_TIMEZONE` wajib tanpa default), `/api/health`, heartbeat worker, `.env.example` berisi nilai palsu, `deploy/smoke/` (Caddy statis untuk K3).
  - Verifikasi: `docker compose --profile dev up -d --wait` exit 0. `curl -fsk https://localhost/api/health` → 200. `docker compose run --rm -e APP_TIMEZONE= api` keluar dengan kode ≠ 0 dan pesannya menyebut `APP_TIMEZONE`.

### B. Mock OLT + fixtures (Sabtu)

- [x] **B1 · Fixtures buku panduan + seed** · 0,5 j · ∥ C1, D1
  - Tujuan: semua contoh output panduan tersimpan persis, ditambah data ±70 ONU per instance.
  - File: `apps/mock-olt/fixtures/manual/*.txt`, disalin apa adanya beserta keanehannya: prompt `OLT_ZTE_C320#`, cause `LOSi`, OfflineTime `0000-00-00 00:00:00`, `no signal`, dan `N/A`. Isinya: `show card` (hlm. 7), `write` (hlm. 10), `show gpon onu uncfg` (hlm. 13), `show run interface gpon-onu` (hlm. 20), `show gpon onu state` dan `show pon power attenuation` (hlm. 21), `show interface gpon-onu` (hlm. 22), `show gpon onu detail-info` (hlm. 22–23), `show onu running config` (hlm. 25). Ditambah `fixtures/manual/README.md` yang memetakan file ke halaman, dan `src/seed.ts` yang membuat `fixtures/seed/mock-{1,2,3}.json` secara deterministik (sebagian Rx dekat −25 dan −27 dBm).
  - Verifikasi: `pnpm --filter mock-olt test fixtures`. Semua file di README ada. Tiap seed berisi 60–80 ONU dengan (slot, port, onuId) dan SN unik. Regenerasi menghasilkan hash yang sama.

- [x] **B2 · Profil OID hipotesis + agent SNMP mock** · 2 j
  - Tujuan: mock menjawab SNMP v2c dan v3 authPriv dengan tabel yang dirender dari state.
  - File: `packages/olt-spec/src/oid-profiles/` berisi profil v2.1 (basis 1012) dan v2.2 (1082) sesuai hipotesis brief, ditandai `verified: false`, lengkap dengan decode dan encode index, `phaseState`, `rxDbm` beserta kebalikannya, dan deteksi profil dari `sysDescr`. `apps/mock-olt/src/{state,snmp-agent,log}.ts` berisi system group, `snmpEngineID` yang bisa diatur, tabel status, inventaris, dan optik, community dan user v3 palsu, serta log request. Buka tugas ini dengan spike v3 selama 30 menit. Bila v3 bermasalah lebih dari 1 jam, lanjutkan dengan v2c dulu dan kejar v3 sebelum H1.
  - Verifikasi: `pnpm --filter @olt/olt-spec test oid`: fast-check decode(encode(x)) = x, nilai 65535 → null, kedua profil `verified === false`. `pnpm --filter mock-olt test:int snmp`: walk v2c dan v3 menghasilkan baris yang sama dengan state, kunci v3 salah → error autentikasi, dan log mencatat request.

- [x] **B3 · Server SSH mock (perintah baca)** · 1,5 j · ∥ B2
  - Tujuan: mock bisa di-SSH dan menjawab perintah `show` di §6.2 dalam format panduan, baik bentuk per port maupun bentuk dengan ID ONU (hlm. 21).
  - File: `apps/mock-olt/src/ssh-server.ts` dan `src/cli/{router,render,pager}.ts`. Isinya: host key dari file (dua slot), password palsu, prompt yang bisa diatur, pager `--More--`, `%Error` untuk perintah tak dikenal, batas sesi VTY, serta log autentikasi dan perintah.
  - Verifikasi: `pnpm --filter mock-olt test:int ssh`. `show gpon onu state gpon-olt_1/1/1` punya header yang sama dengan fixture hlm. 21 dan memuat semua ONU port itu. Output panjang memuat `--More--`. Perintah asing menghasilkan baris berawalan `%`. Sesi yang melebihi batas ditolak. Fingerprint host key tetap sama setelah restart.

- [x] **B4 · Skenario + 3 instance di compose** · 1 j
  - Tujuan: setiap gangguan bisa dipicu dengan satu perintah, di laptop maupun di VPS.
  - File: `apps/mock-olt/src/scenarios/*.ts` berisi 13 skenario §6.7 (`flap` dan `rx-degrade` berjalan bertahap sesuai §14 B8–B9), `src/control.ts` sebagai kanal kontrol lokal, dan perintah `scenario`. Di `compose.yaml`, `mock-olt-1..3` dibuat dari satu image dengan IP statis di `oltnet` (profil `dev` dan `demo`). Khusus profil `dev`, SNMP dan SSH `mock-olt-1` dipetakan hanya ke `127.0.0.1:1161` dan `:2222`.
  - Verifikasi: ada unit test state sebelum dan sesudah untuk tiap skenario. Setelah `docker compose exec mock-olt-1 scenario los-mass`, `snmpbulkwalk` ke `127.0.0.1:1161` menunjukkan 5 ONU di satu port berfase LOS. `scenario reset` memulihkannya. Setelah `scenario hostkey-rotate`, fingerprint dari `ssh-keyscan -p 2222 127.0.0.1` berubah.

### C. Builder dan parser CLI (Sabtu)

- [x] **C1 · Skema parameter + builder perintah baca** · 0,5 j · ∥ B (cukup A1)
  - Tujuan: menyediakan satu-satunya jalan untuk membuat teks perintah (aturan keras 6).
  - File: `packages/olt-spec/src/params.ts` (Zod ketat per field; menolak CR, LF, dan karakter kontrol) dan `src/commands/{allowed,read}.ts` (`AllowedCommand` ber-brand, 8 builder baca §6.2, pemeriksaan karakter kontrol pada hasil akhir).
  - Verifikasi: `pnpm --filter @olt/olt-spec test commands`. Teks tiap builder sama persis dengan tabel §6.2. Fast-check: input acak ditolak Zod, atau hasilnya bebas `[\x00-\x1f\x7f]`. `onuId: 129` ditolak. `@ts-expect-error` memastikan objek biasa tidak bisa dipakai sebagai `AllowedCommand`.

- [x] **C2 · Parser output CLI** · 1 j
  - Tujuan: output `show` menjadi data yang sudah divalidasi Zod.
  - File: `packages/olt-spec/src/parsers/*.ts`, terdiri atas `normalize` (membuang kode kontrol terminal dan sisa pager), deteksi baris `%`, dan parser untuk state (banyak baris plus `ONU Number`), attenuation, detail-info (riwayat; OfflineTime bernilai nol berarti masih online; cause disimpan apa adanya), interface, running-config ONU, `onu running config`, `show card`, dan hasil `write`. Ditambah `src/bin/parse.ts` untuk demo.
  - Verifikasi: `pnpm --filter @olt/olt-spec test parsers` menghasilkan nilai persis dari fixture: 1/2/5:4 LOS dan 1/2/5:5 working; Rx −20,850 dan −18,210 dBm; atenuasi 23,718 dan 22,440 dB; `no signal` → null; 10 baris riwayat dengan baris ke-10 tanpa OfflineTime; jarak 3540 m; durasi 38 527 detik. Round-trip fast-check: hasil render mock lalu di-parse sama dengan state.

- [x] **C3 · Harness golden + redaksi rekaman** · 1 j
  - Tujuan: format rekaman dan alat redaksi sudah siap sebelum kamu merekam (K4), begitu pula tes yang membuktikan profil OID.
  - File: format `apps/mock-olt/fixtures/recordings/<nama>/` (`walk.txt` dari `snmpbulkwalk -On`, `show-*.txt`, `meta.json`); `apps/mock-olt/src/bin/redact.ts` (nama pelanggan diganti `Pelanggan-NN` secara konsisten; gagal bila menemukan string dari env `REDACT_SECRETS`); `packages/olt-spec/test/golden.test.ts` (status harus sama, selisih Rx ≤ 0,5 dB); `docs/runbook-golden.md` (perintah yang kamu jalankan di VPS).
  - Verifikasi: `pnpm --filter @olt/olt-spec test golden` hijau untuk rekaman sintetis dari mock dan merah untuk salinan yang Rx-nya digeser 1 dB. `redact` exit 1 pada file uji yang berisi string rahasia.

### D. Skema DB (Sabtu)

- [x] **D1 · Prisma + migrasi SQL + seed** · 1,5 j · ∥ B, C (cukup A1)
  - Tujuan: membuat semua tabel brief ditambah perubahan §7, termasuk tabel yang pengisinya ditunda, dengan aturan integritas ditegakkan di database.
  - File: `packages/db/prisma/schema.prisma`. Migrasi SQL tambahan: partial unique index untuk ONU aktif pada (OLT, port, index) dan (OLT, SN); trigger yang menolak perubahan `olt.is_mock`; role `app` tanpa hak UPDATE atau DELETE di `audit_log`; indeks `onu_metric(onu_id, ts DESC)`. `packages/db/src/seed.ts` membuat user admin, noc, dan teknisi dari env, serta `provision_allowlist` untuk mock. Ditambah helper Testcontainers.
  - Verifikasi: `pnpm --filter @olt/db test:int`. Migrasi di DB kosong sukses. ONU aktif ganda ditolak, tetapi lolos bila salah satunya diarsipkan. `UPDATE olt SET is_mock` ditolak. `DELETE FROM audit_log` oleh role `app` → permission denied. `prisma migrate diff` tidak menunjukkan drift.

### E. Worker (Sabtu–Minggu)

- [x] **E1 · Guard target + enkripsi amplop** · 1 j · ∥ B, C
  - Tujuan: worker tidak bisa menghubungi alamat di luar `OLT_TARGET_CIDRS`, dan kredensial hanya bisa dibuka worker (aturan keras 4 dan 5).
  - File: `apps/worker/src/guards/target.guard.ts`; `packages/shared/src/crypto/envelope.ts` (AES-256-GCM per record, kunci data dibungkus RSA-OAEP-SHA256); `apps/api/src/crypto/credential.encryptor.ts`; `apps/worker/src/crypto/credential.decryptor.ts` (private key dari file secret); `scripts/keys-generate.ts`; `packages/db/src/seed-mock.ts` (mock-1..3 dengan kredensial palsu terenkripsi dan pin identitas mock; khusus dev dan test).
  - Verifikasi: `pnpm --filter worker test guard crypto`. 10.0.0.1 ditolak dan IP mock diterima. Data yang dienkripsi di api didekripsi worker menjadi teks yang sama. Ciphertext yang diubah 1 bit → gagal.

- [x] **E2 · Antrian per OLT + scheduler** · 1 j
  - Tujuan: menegakkan aturan keras 2.
  - File: `apps/worker/src/scheduler/olt-queues.ts`, berisi antrian `olt:{id}` dengan `setGlobalConcurrency(1)`, prioritas eksplisit sesuai §6.4, `upsertJobScheduler` untuk `poll.status` (offset per OLT) dan `poll.optical`, rekonsiliasi saat start dan saat status OLT berubah (OLT berstatus `pending_pin`, `quarantined`, atau `disabled` tidak punya scheduler), serta antrian `notify`.
  - Verifikasi: `pnpm --filter worker test:int scheduler`. Dua instance Worker dengan 10 job menghasilkan konkurensi maksimum terukur 1. Job prioritas 1 jalan sebelum job prioritas 3 yang sudah menunggu. Restart tidak menggandakan scheduler. OLT `pending_pin` tidak punya scheduler.

- [x] **E3 · OltSnmpClient + cek identitas SNMP** · 1 j
  - Tujuan: membaca identitas, status, dan optik sesuai §8.1, dengan identitas dicek sebelum walk (aturan keras 7).
  - File: `apps/worker/src/snmp/olt-snmp.client.ts` (v3 authPriv dan v2c; GETBULK 20, timeout 3 detik, 1 retry; tabel tidak lengkap → error; timeout dibedakan dari autentikasi gagal; guard target; log teredaksi) dan `apps/worker/src/identity/snmp-identity.ts` (engine ID untuk v3, sysName dan sysObjectID untuk v2c, dibandingkan dengan pin).
  - Verifikasi: `pnpm --filter worker test:int snmp`. v2c dan v3 menghasilkan baris yang sama dengan state mock. Kunci salah → `SnmpAuthError`. Skenario `olt-down` → `SnmpTimeoutError` dalam ≤ 7 detik. Engine ID yang berbeda dari pin → `IdentityMismatch`, dan log mock tidak berisi request walk. Target di luar CIDR → 0 request di log mock.

- [x] **E4 · Poller status dan optik → DB** · 2 j
  - Tujuan: data mock masuk ke DB setiap siklus, sesuai §7 dan §8.1.
  - File: `apps/worker/src/poller/{status,optical,inventory}.ts`, mencakup `onu_state`, `onu_event` yang dicatat hanya saat status berubah (dengan waktu observasi worker), `poll_run`, transisi OLT ok → stale → unreachable, `observed_after_gap`, inventaris dengan aturan riwayat ONU (§7), `onu_metric` untuk Rx sisi ONU dan sisi OLT, serta publish event ke Redis.
  - Verifikasi: `pnpm --filter worker test:int poller`. Siklus pertama mengisi `onu_state` untuk semua ONU. `onu-los` menghasilkan tepat 1 event, dan siklus berikutnya 0 event. `olt-down` selama 2 siklus membuat OLT `unreachable` dan state ONU tetap tersimpan. Walk yang terputus menghasilkan `poll_run.ok=false` tanpa perubahan state. Ganti nama → baris lama diarsipkan dan baris baru dibuat. Ganti SN → event `device_replaced`. Siklus optik menulis satu baris `onu_metric` per ONU, dengan Rx dalam ±0,01 dB dari mock.

- [x] **E5 · Aturan alarm (fungsi murni, clock palsu)** · 1 j · ∥ (cukup tipe di `@olt/shared`)
  - Tujuan: semua aturan §8.2 teruji tanpa I/O.
  - File: `apps/worker/src/alarms/rules/*.ts` untuk `onu_los`, `onu_flapping`, `onu_rx_low` (histeresis 1 dB), `pon_mass_los`, `pon_mass_power`, dan `olt_unreachable`, termasuk penahanan induk–anak dan `alarm_settings` per OLT dengan profil waktu cepat untuk mock.
  - Verifikasi: `pnpm --filter worker test rules` dengan kasus berikut:
    - 5 LOS dalam 90 detik → 1 alarm massal dengan 5 anak; 4 LOS tersebar dalam 3 menit → tidak massal.
    - Port 2 ONU: 1 LOS → tidak massal; 2 LOS → massal (tafsiran §2.2 no. 10).
    - Rx −26 → waspada; −27,5 → kritis; −25,5 → tetap aktif; −23,9 → selesai.
    - 3 putus dalam 59 menit → flapping; dalam 61 menit → tidak.
    - DyingGasp pada satu ONU → tanpa alarm.

- [x] **E6 · Mesin alarm + outbox Telegram** · 1,5 j
  - Tujuan: transisi dari poller menjadi alarm dan pesan Telegram sesuai kebijakan §2.1.
  - File: `apps/worker/src/alarms/alarm.engine.ts` dan `apps/worker/src/notify/telegram.outbox.ts` (`dedupe_key` per transisi, penggabungan jendela 10 detik, ≤ 20 pesan per menit, teks Indonesia dengan tautan UI, serta `TELEGRAM_API_BASE` supaya tes memakai server Telegram palsu).
  - Verifikasi: `pnpm --filter worker test:int alarms`. `los-mass` menghasilkan 1 `pon_mass_los` dengan 5 anak, dan server Telegram palsu menerima tepat 1 pesan. `onu-los` → 0 pesan. Restart di tengah pengiriman tidak menimbulkan pesan ganda.

- [x] **E7 · OltCliSession + job `cli.onu-detail`** · 2 j
  - Tujuan: sesi SSH sesuai §8.3, dengan host key dicek sebelum autentikasi.
  - File: `apps/worker/src/cli/olt-cli.session.ts`:
    - `open`: timeout 10 detik; `hostVerifier` membandingkan sha256 dengan pin (maksimal 2 slot).
    - Prompt dikenali dengan regex, termasuk `OLT_ZTE_C320#`, `(config…)`, dan `(gpon-onu-mng)`.
    - `run`: 30 detik dan 1 MB per perintah; `--More--` dijawab; baris `%` → `CliError`.
    - `close` dari `finally`; mode `read` menolak `kind: 'write'`; algoritma kex/cipher bisa diatur.

    `apps/worker/src/cli/jobs/onu-detail.ts`:
    - Maksimal 1 job per ONU per 30 detik.
    - Retry 30 detik, 2 menit, 5 menit lewat job tertunda, lalu `cli_unavailable`.
    - Password salah → `cli_auth_failed` tanpa retry; transkrip teredaksi.
  - Verifikasi: `pnpm --filter worker test:int cli`. Host key berbeda → koneksi diputus dan log auth mock 0. Output multi-halaman diterima utuh. Perintah tulis di sesi baca ditolak sebelum terkirim. `vty-full` → retry lalu `cli_unavailable` (jeda dipercepat di tes). Password salah → hanya 1 percobaan. Setelah job selesai, sesi aktif di mock 0.

- **E8 · Penerima trap**: tidak dijadwalkan, karena SPEC §3 dan §11 menundanya sampai setelah demo.

### F. API + auth (Minggu)

- [x] **F1 · Login, sesi, rate limit** · 1,5 j · ∥ E (cukup D1)
  - Tujuan: bagian autentikasi di §8.6.
  - File: `apps/api/src/auth/*` dan `apps/api/src/audit/*`. Isinya: Argon2id, tabel `session` dengan hash ID, cookie httpOnly/Secure/SameSite=Strict, batas idle 30 menit dan maksimal 12 jam, rate limit lewat Redis → 429, cek `Origin`, kepercayaan tepat satu hop proxy, dan audit login, logout, serta ganti password.
  - Verifikasi: `pnpm --filter api test:int auth`. Cookie membawa ketiga flag. Kegagalan ke-6 dari IP yang sama → 429. Idle 31 menit (clock palsu) → 401. Ganti password → sesi lain 401. `Origin` asing → 403. Audit tercatat.

- [x] **F2 · RBAC default-deny + AdminLanGuard** · 1 j
  - Tujuan: aturan keras 8 dan matriks peran §8.6.
  - File: `apps/api/src/auth/{roles.guard,admin-lan.guard}.ts` dan tes enumerasi rute.
  - Verifikasi: `pnpm --filter api test:int rbac`. Login admin dengan XFF 203.0.113.5 → 403 dan `admin_offlan_denied`. Cookie admin yang dipakai dari IP luar LAN → 403 dan sesinya dicabut. Semua rute punya `@Roles` atau `@Public`. NOC `POST /olts` → 403.

- [x] **F3 · Endpoint REST** · 1,5 j
  - Tujuan: data monitoring bisa dibaca dan OLT bisa didaftarkan tanpa kredensial bocor.
  - File: `apps/api/src/{dashboard,olts,onus,alarms,jobs,audit}/*` dan DTO Zod di `packages/shared/src/dto/*`. Endpoint:
    - `GET /dashboard`, `/olts`, `/olts/:id`.
    - `POST/PATCH /olts` (A): kredensial dienkripsi, status awal `pending_pin`, OLT non-mock ditolak selama profil OID-nya belum `verified`.
    - `/onus` dengan filter dan pencarian, `/onus/:id`, `/metrics`, `/events`.
    - `/alarms` dan ack (A, N).
    - `POST /onus/:id/refresh` (409 bila CLI belum aktif).
    - `GET /audit` (A).
  - Verifikasi: `pnpm --filter api test:int rest`.
    - Respons OLT tidak memuat kunci yang cocok dengan `/cred|password|community|secret/i` maupun string kredensial mock.
    - Ciphertext dari `POST /olts` bisa dibuka decryptor worker.
    - Teknisi ack → 403; refresh saat CLI nonaktif → 409.
    - OLT non-mock dengan profil belum terverifikasi → 422.

### G. Dashboard (Senin 08:00–12:30)

- [x] **G1 · Kerangka UI + login** · 1 j
  - Tujuan: SPA bisa login dan menavigasi sesuai peran.
  - File: `apps/ui/src/{main.tsx,router.tsx,api.ts}`, `routes/login.tsx`, `components/*`. Isinya React Router, TanStack Query dengan refetch tiap 10 detik, penanganan 401, shadcn/ui yang responsif, teks Indonesia, lencana MOCK, dan menu per peran.
  - Verifikasi: `pnpm --filter ui build` sukses. Playwright: NOC login diarahkan ke `/`; password salah menampilkan pesan berbahasa Indonesia; muat ulang `/onus/1` tidak menghasilkan 404.

- [x] **G2 · Dashboard + detail OLT** · 1 j
  - Tujuan: halaman `/` dan `/olts/:id` sesuai §6.6.
  - File: `routes/{dashboard,olt-detail}.tsx`, berisi kartu per OLT (online/offline, alarm, usia data, lencana identitas, status) dan tabel port PON.
  - Verifikasi: Playwright. Tampil 3 kartu mock berlencana MOCK dengan total ±210 ONU. Setelah `onu-los`, jumlah offline bertambah tanpa muat ulang dalam ≤ 2 menit.

- [x] **G3 · Daftar dan detail ONU + grafik Rx** · 1,5 j
  - Tujuan: halaman `/onus` dan `/onus/:id` dengan grafik Rx dasar.
  - File: `routes/{onus,onu-detail}.tsx` dan `components/rx-chart.tsx` (ECharts), dengan filter dan pencarian, status, Rx kedua sisi, riwayat event, riwayat offline, dan tombol refresh.
  - Verifikasi: Playwright. Mencari SN menghasilkan 1 baris. Grafik punya ≥ 1 titik. Refresh menampilkan riwayat offline dari mock.

- [x] **G4 · Alarm + ack + status "tidak diketahui"** · 1 j
  - Tujuan: halaman `/alarms` dan tampilan ONU saat OLT tak terjangkau.
  - File: `routes/alarms.tsx` dan `e2e/smoke.spec.ts`, mencakup tampilan induk–anak, ack yang hanya untuk A dan N, dan ONU berlabel "tidak diketahui (terakhir: working, 10:42)".
  - Verifikasi: Playwright. `los-mass` menampilkan 1 alarm induk dengan 5 anak. Ack oleh NOC tercatat. Teknisi tidak melihat tombol ack. Setelah `olt-down`, ONU tampil "tidak diketahui (terakhir: …)".

### H. Identity pinning + deteksi MITM (Senin 12:30–18:00, termasuk gerbang)

- [x] **H1 · identity.probe + pin** · 1,5 j
  - Tujuan: OLT baru tidak dipolling sebelum admin mem-pin identitasnya (§8.4 langkah 1–2).
  - File: `apps/worker/src/identity/{probe,identity.verifier}.ts` dan `apps/api/src/identity/*`.
    - Probe: handshake SSH diputus sebelum autentikasi, lalu GET engine ID terautentikasi (atau sysName/sysObjectID untuk v2c); hasilnya menjadi kandidat.
    - API: `GET /olts/:id/identity` dan `POST .../pin` (A, LAN, tercatat di audit).
    - Setelah pin: status `pending_pin` → `ok` dan scheduler dibuat; tingkat identitas kuat, lemah, atau belum di-pin.
  - Verifikasi: `pnpm test:int identity`. OLT baru berstatus `pending_pin` tanpa job poll. Kandidat sama dengan fingerprint dan engine ID mock. Log auth mock 0 selama probe. Setelah pin, scheduler ada. OLT v2c bertingkat "lemah".

- [x] **H2 · Karantina + terima perubahan** · 1,5 j
  - Tujuan: identitas yang berubah menghentikan semua akses ke OLT itu sampai admin menerima perubahannya (§8.4 langkah 4–5).
  - File: `apps/worker/src/identity/quarantine.ts` dan `apps/api/src/identity/*`.
    - Pemicu: host key, engine ID, atau sysName/sysObjectID berbeda dari pin, atau auth v3 gagal 2 siklus.
    - Akibatnya: OLT `quarantined`, scheduler dihapus, job berjalan dibatalkan, `security_event` dan alarm `olt_identity_mismatch` dibuat, Telegram dikirim, ONU tampil "tidak diketahui".
    - `accept-change` (A, LAN, alasan wajib, ketik nama OLT): nilai lama `retired`, nilai baru `pinned`, audit tercatat, polling berjalan lagi.
  - Verifikasi: `pnpm test:int quarantine` (§14 B12–B13).
    - `hostkey-rotate` + refresh: koneksi diputus sebelum auth dan log auth mock 0; OLT `quarantined`; 1 pesan Telegram keamanan; log SNMP mock tanpa request selama 2 siklus.
    - `accept-change` ditolak: tanpa alasan → 400; nama salah → 400; NOC → 403; admin di luar LAN → 403. Permintaan yang valid → polling lanjut dan audit tercatat.
    - `engineid-change` → hasil yang sama.

- [x] **H3 · UI identitas + tambah OLT** · 1,5 j
  - Tujuan: admin bisa mendaftarkan OLT, mem-pin, dan menerima perubahan dari UI.
  - File: `apps/ui/src/routes/olt-detail.tsx` (panel kandidat, pinned, dan retired; tombol pin; dialog terima perubahan dengan mengetik nama), `routes/olt-new.tsx` (form admin, dipakai juga untuk OLT asli di K5), dan lencana di dashboard.
  - Verifikasi: Playwright. Admin mendaftarkan dan mem-pin mock-2 dari UI. Setelah `hostkey-rotate`, lencana "karantina" muncul, dan dialog menolak nama yang salah.

- [x] **Gerbang Fase 1** · 1 j, target Senin ±18:00 (lihat bagian Gerbang). Fase 2 tidak dimulai sebelum gerbang ini lulus.

### I. Fase 2: provisioning (Senin 18:00–21:00; mock saja)

Lapis generator, termasuk jadwal dasar:

- [x] **I1 · Builder registrasi + hash preview** · 0,5 j
  - Tujuan: template §8.5 hanya bisa dirender dari parameter yang sudah divalidasi.
  - File: `packages/olt-spec/src/commands/provision.ts` dan `src/preview.ts`, berisi template §8.5, `writeConfig`, skema validasi §8.5, dan sha256 preview.
  - Verifikasi: `pnpm --filter @olt/olt-spec test provision`. Snapshot sama dengan template §8.5 untuk contoh panduan (1/1/1:1, ZTEG-F620, ZTEG00000002, 10M, VLAN 100). Fast-check tanpa CR, LF, atau karakter kontrol. SN `ZTEG0000000\r\nreboot` dan nama yang memuat `;`, spasi, atau baris baru ditolak. Hash berubah bila satu parameter berubah.

- [x] **I2 · API draft → preview + guard tulis 1** · 1 j
  - Tujuan: preview perintah dibuat di `api`, dan hanya untuk OLT mock.
  - File: `apps/api/src/jobs/*`. `POST /jobs` (A, T) hanya menerima OLT dengan `is_mock = true`, memilih ID ONU kosong berikutnya, memakai nilai dari `provision_allowlist`, menyimpan `preview` dan `preview_sha256`, dan mencatat audit. Ditambah `GET /jobs/:id` (A, pemilik).
  - Verifikasi: `pnpm --filter api test:int jobs`. Preview teknisi sama dengan output builder. OLT non-mock ditolak, disertai `write_guard_denied` dan audit. VLAN di luar allowlist → 400. Payload §14 B17 → 400. NOC → 403.

- [x] **I3 · UI `/provision/new`** · 1 j
  - Tujuan: teknisi menyusun registrasi ONU dan melihat perintah yang akan dihasilkan.
  - File: `apps/ui/src/routes/provision-new.tsx`, berisi form dari allowlist, preview beserta hash, dan tombol salin. Tombol provisioning tidak muncul untuk OLT asli.
  - Verifikasi: Playwright. Teknisi mengisi form dan preview-nya sama dengan output builder. OLT non-mock tidak menampilkan tombol provisioning.

- [x] **Gerbang Fase 2** · 0,5 j

Lapis eksekusi, di luar jadwal dasar. Hanya dikerjakan bila gerbang Fase 1 lulus sebelum Senin 13:00; bila tidak, setelah demo.

- [x] **I4 · Mode konfigurasi mock** · 1 j · ∥ (cukup B3). File: `apps/mock-olt/src/cli/config-mode.ts`. Perintah template mengubah running state, `write` → `[OK]`, ID yang sudah terpakai → `%Error`. Verifikasi: `pnpm --filter mock-olt test:int config`.
- [x] **I5 · Konfirmasi dan batal** · 0,5 j. `POST /jobs/:id/confirm|cancel`; hash wajib sama; teknisi hanya untuk `onu_register` miliknya. Verifikasi: hash salah → 409; job orang lain → 403 (§14 B18).
- [x] **I6 · Eksekutor worker** · 2 j. File: `apps/worker/src/provision/provision.executor.ts`, berisi guard tulis 2 dan 3, verifikasi identitas, validasi ulang, render ulang dengan cek hash, cek ID masih kosong, berhenti di error pertama, lalu verifikasi dan snapshot. Verifikasi: `pnpm --filter worker test:int provision`. Log perintah mock sama persis dengan preview. `is_mock` yang dipaksa false lewat DB ditolak sebelum sesi dibuka (§14 B16). Error di perintah ke-3 → `applied_commands` berisi 2, tanpa retry.
- [x] **I7 · `config.save` + panel perubahan belum disimpan + halaman job** · 1,5 j. Verifikasi: Playwright §14 B15.

### J. Hardening + deploy (Senin 21:00–24:00, gladi Selasa pagi)

- [x] **J1 · Hardening akses internet** · 1 j · ∥ (bisa kapan saja setelah A2; ditaruh di akhir sesuai urutanmu)
  - Tujuan: kontrol §9 untuk akses dari internet terpasang dan bisa dibuktikan.
  - File: `deploy/Caddyfile` (HSTS, CSP `default-src 'self'`, nosniff, Referrer-Policy, `frame-ancestors 'none'`); image dipin ke digest; private key sebagai Docker secret khusus worker; `deploy/env.sops.yaml` (sops + age); `deploy/firewall/docker-user.sh`; OSV-Scanner di CI; `deploy/check-compose.mjs`.
  - Verifikasi:
    - `node deploy/check-compose.mjs` exit 0: tiap service non-root, `read_only`, `cap_drop`, dan `no-new-privileges`; hanya caddy yang punya port.
    - `curl -skI https://localhost` memuat semua header di §9.
    - Playwright di belakang caddy tidak mencatat pelanggaran CSP.
    - `docker compose exec api ls /run/secrets` tidak memuat private key.
    - OSV-Scanner atas `pnpm-lock.yaml` tanpa temuan, atau pengecualiannya tercatat.

- [ ] **J2 · Deploy VPS profil `demo`** · 2 j. Kamu yang menjalankan perintahnya di VPS; Claude menyiapkan runbook dan file.
  - Tujuan: aplikasi berjalan di VPS dengan profil `demo`.
  - File: `docs/runbook-deploy.md`. Langkahnya:
    - Dekripsi sops dan buat kunci langsung di VPS (private key tidak pernah keluar dari VPS).
    - Isi `OLT_TARGET_CIDRS` dengan subnet mock dan IP OLT asli, `MOCK_OLT_CIDRS` dengan subnet mock.
    - `docker compose --profile demo up -d --wait`, firewall, seed user.
    - Daftarkan mock-1..3 dan pin.
  - Verifikasi: gerbang C (§14 C1–C6).

- [ ] **J3 · Profil OID vs rekaman asli** · timebox 1,5 j · mengambang (dikerjakan begitu K4 selesai)
  - Tujuan: membuktikan atau memperbaiki profil OID dengan rekaman OLT asli.
  - File: `apps/mock-olt/fixtures/recordings/<olt>/` dan `packages/olt-spec/src/oid-profiles/*`.
  - Verifikasi: `pnpm --filter @olt/olt-spec test golden` hijau untuk rekaman asli. `verified: true` hanya diubah dalam commit yang sama dengan rekaman yang lulus. Bila masih merah setelah timebox, berlaku potongan 1.

- [ ] **J4 · Gladi + dokumentasi** · 1,5 j (Selasa pagi)
  - Tujuan: alur demo §14 E berjalan mulus. Antarbagian dijalankan `scenario reset`. Catatan untuk laporan dan README disiapkan. Langkah "audit log" memakai `GET /api/audit` karena halaman audit ditunda.
  - Verifikasi: gladi selesai tanpa perbaikan manual di DB, dan setiap langkah demo lulus.

### K. Jalur kamu (paralel, di luar sesi Claude)

| ID | Kapan | Isi | Lulus bila |
| --- | --- | --- | --- |
| K1 | Jum malam | Kirim checklist §10 ke pembimbing: user SNMPv3, izin v2c tertulis, aktivasi SSH dan akun CLI, cek community rw, batas VTY, cara menampilkan engine ID dan fingerprint | Terkirim; jawabannya dicatat di PLAN.md |
| K2 | Sab pagi | Buat bot Telegram dan grup uji, simpan chat ID di `.env` lokal | `sendMessage` ke grup uji sukses |
| K3 | Sab–Min | Siapkan domain/DNS dan port forward 443, lalu jalankan Caddy statis dari `deploy/smoke/` di VPS | Dari HP lewat data seluler sertifikatnya valid; log Caddy mencatat IP publik HP, bukan IP router (bukti tanpa SNAT) |
| K4 | Segera setelah akses ada, di jam sepi | Rekam golden sesuai `docs/runbook-golden.md`, lalu redaksi | `redact` exit 0; file sudah ada di `fixtures/recordings/` |
| K5 | Senin malam di jam sepi, setelah J2 dan J3 lulus | Daftarkan OLT asli lewat form H3, cocokkan engine ID dengan konsol, pin, lalu pantau 1 jam | §14 D1–D5 (D6 bila SSH aktif) |
| K6 | Tiap malam | Demo harian dan isi jam aktual | — |

## Gerbang (verifikasi end-to-end)

- **Gerbang Fase 1** (Senin ±18:00): `pnpm check && pnpm test:int && pnpm e2e` hijau, ditambah §14 B1–B14 dan B19 lulus di profil `dev` (`docker compose logs` tidak memuat kredensial mock). Bila satu saja gagal, perbaiki sebelum I1.
- **Gerbang Fase 2**: untuk lapis generator, §14 B16 (bagian api) dan B17 lulus, preview sama dengan output builder, dan tombol provisioning tidak muncul untuk OLT non-mock. Bila lapis eksekusi ikut dikerjakan, §14 B15–B18.
- **Gerbang C** (VPS): §14 C1–C6.
- **Gerbang D** (OLT asli, oleh kamu): §14 D1–D5.
- **Gladi**: §14 E.

## Tiga risiko terbesar

1. **Waktu kurang, dan kekurangannya menumpuk di Senin.** Jadwal dasar 43 jam sementara kapasitas 39,5 jam, sehingga Senin terjadwal 16 jam. Akibatnya Fase 2 dan deploy terdesak, dan kelelahan menaikkan peluang salah di kode keamanan. Mitigasi: lapis eksekusi Fase 2 sudah dikeluarkan dari jadwal dasar; kalibrasi dilakukan Sabtu 20:00; batas keras Senin 21:00 untuk mulai J1 dan J2; tugas bertanda ∥ dipakai untuk berpindah saat buntu. Tuas terbesar bila Sabtu molor: sesi kedua untuk blok F dan G.
2. **OLT asli: akses atau rekaman terlambat, atau profil OID tidak cocok dengan firmware.** Mock dan parser cocok satu sama lain karena dibuat dari sumber yang sama, jadi hanya rekaman asli yang bisa membuktikan profil. Akibatnya pembukaan demo (dashboard OLT asli) bisa gagal. Mitigasi: C3 dan runbook rekaman sudah siap Sabtu supaya K4 bisa dilakukan Sabtu atau Minggu malam; J3 diberi timebox; fallback ke mock sesuai SPEC §3.
3. **Deploy dan akses internet baru teruji Senin malam.** Masalah DNS, port forward, Let's Encrypt, atau firewall Docker baru akan ketahuan saat itu. Bila router melakukan SNAT, AdminLanGuard tidak lagi bermakna. Mitigasi: K3 dikerjakan Sabtu–Minggu; container sudah dikeraskan sejak A2; runbook disiapkan; fallback demo dari LAN dengan `tls internal`.

## Yang dipotong

**Sudah di luar jadwal dasar** dan masuk backlog setelah demo. Tabelnya tetap dibuat di D1.

- Sesuai SPEC §3: penerima trap (E8), trafik per ONU, metrik OLT, halaman dan endpoint kelola user (user dibuat lewat seed), halaman audit, rollup per jam, backup, polesan UI, dan grafik lanjutan.
- Sesuai SPEC §3, dipakai sejak awal karena pekerjaan berjalan satu jalur: lapis eksekusi Fase 2 (I4–I7). Fase 2 diperagakan sebagai mode generator perintah.
- **[usulan]** Socket.IO diganti refetch tiap 10 detik (worker tetap mem-publish event ke Redis).
- **[usulan]** `cli.port-sweep` per jam ditunda; refresh on-demand tetap ada.
- **[usulan]** Jendela pemeliharaan ditunda.
- **[usulan]** Flapping hanya dihitung dari transisi polling; sumber riwayat CLI menyusul.
- **[usulan]** Job retensi ditunda, karena belum ada data yang mencapai batasnya.

**Potongan bersyarat**, dipakai berurutan. Kalibrasi Sabtu 20:00: bila Hari 1 molor lebih dari 1,5 jam dari rencana, putuskan malam itu juga potongan mana yang dipakai sejak awal, jangan menunggu Senin.

| # | Yang dipotong | Pemicu | Hemat |
| --- | --- | --- | --- |
| 1 | Bagian OLT asli diperagakan di mock dan dicatat di laporan (SPEC §3) | Akses belum diberikan atau rekaman belum ada pada Senin 12:00, atau J3 masih merah setelah timebox | ±2,5 j |
| 2 | Fase 2 dihentikan apa pun statusnya, lalu pindah ke J1; minimal I1 + I2, sehingga preview diperagakan lewat API | Senin 21:00 dan Fase 2 belum selesai | ±1–2 j |
| 3 | **[usulan]** Akses internet ditunda: demo dari LAN; port forward dan §14 C setelah demo. Deploy VPS dan hardening tetap jalan | K3 gagal (SNAT/DNS), atau gerbang C belum lulus Senin 24:00 | ±1 j |
| 4 | **[usulan]** Demo dari laptop (profil `demo` lokal); deploy VPS setelah demo. Hanya bila potongan 1 sudah terjadi | Senin 22:00 dan J1 belum selesai | ±2 j |

**Tidak pernah dipotong:** aturan keras di `CLAUDE.md`; login, RBAC, admin hanya dari LAN, dan audit; poller beserta riwayat mentah; mesin alarm dan Telegram; identitas, karantina, dan terima perubahan; mock beserta skenarionya; hardening container.

## Asumsi yang berlaku

Ikut disetujui bersama rencana ini. Ubah di sini bila ada yang berubah.

- Senin 16 jam kerja, sampai sekitar tengah malam. Bila tidak bisa, potongan 2 dan 3 dipakai sejak awal.
- Tafsiran aturan 50% (§2.2 no. 10): perlu minimal 2 ONU yang LOS.
- Usulan potongan bertanda **[usulan]** berlaku.
- J2 dan K5 kamu yang menjalankan, karena VPS menjangkau OLT asli.
