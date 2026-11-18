# CLAUDE.md

## Tujuan

Aplikasi web untuk memantau dan, di Fase 2, mengonfigurasi OLT ZTE ZXA10 C320 lewat SNMP dan CLI. Dibangun dari nol sebagai modul kerja praktik (demo 27 Okt 2026) dan berjalan di satu VPS kantor dengan Docker Compose.

Spesifikasi implementasi ada di `SPEC.md`. Latar belakang ada di `docs/project-brief.md`, desain awal di `docs/technical-brief.md`, dan perintah CLI C320 di `docs/Buku-Panduan-OLT-C320-Pt1.pdf`. Bila isinya bertentangan, yang berlaku berurutan: file ini, `SPEC.md`, lalu brief.

## Stack

- Backend: NestJS (TypeScript) dengan dua aplikasi, `api` dan `worker` (NestJS standalone)
- Data: PostgreSQL + Prisma; antrian dan event: BullMQ + Redis
- Akses OLT: net-snmp (SNMPv3; v2c hanya sementara) dan ssh2; Telnet tidak dipakai
- Frontend: Vite + React

## Aturan keras

Bila sebuah tugas tampaknya menuntut pelanggaran aturan di bawah, berhenti dan tanyakan dulu.

1. Hanya `worker` yang boleh berkomunikasi dengan OLT. `api` tidak pernah; tugasnya membuat job dan membaca data. net-snmp dan ssh2 hanya boleh dipakai di `worker` dan mock OLT.
2. Satu antrian BullMQ per OLT dengan concurrency 1, berlaku global lintas semua instance `worker`.
3. Perubahan ke OLT, asli maupun mock, hanya lewat template perintah di builder `olt-spec`: setiap job menampilkan preview yang di-hash, baru dijalankan setelah konfirmasi (pengajuan teknisi disetujui NOC), dan tercatat di audit log. Template baru hanya ditambahkan atas keputusan pemilik repo dan dicatat di `SPEC.md` §8.5 beserta tanggalnya. Dilarang: perintah di luar template, SNMP SET, dan perubahan OLT lewat jalur lain. Kerangka ini berlaku sejak 13 Nov 2026; daftar template yang berlaku ada di §8.5.
4. IMPORTANT: development dan test hanya ke mock OLT, tidak pernah ke OLT produksi. Ini termasuk perintah yang dijalankan Claude sendiri (`snmpwalk`, `ssh`, `nc`, skrip ad-hoc); anggap setiap alamat selain mock OLT sebagai produksi.
5. Kredensial OLT disimpan terenkripsi AES-256-GCM dengan kunci di luar repo dan database; hanya `worker` yang bisa mendekripsi. Kredensial tidak boleh muncul di repo, log, atau output apa pun; pengecualiannya hanya kredensial palsu untuk mock OLT.
6. Semua input, baik dari pengguna, database, maupun output OLT, divalidasi dengan Zod sebelum dirangkai menjadi perintah CLI: skema ketat per field (allowlist regex), tolak CR/LF dan karakter kontrol. Perintah hanya dibangun lewat builder template, tidak pernah dari string bebas.
7. Sebelum mengirim kredensial ke OLT, cocokkan identitasnya dengan pin: host key SSH (diperiksa saat handshake, sebelum autentikasi) dan engine ID SNMPv3. SNMP v2c hanya boleh sementara dan dicap "identitas lemah". Bila tidak cocok: berhenti, karantina OLT (tanpa SNMP maupun CLI sampai admin menerima perubahan), dan buat alarm.
8. Peran admin hanya boleh dipakai dari IP LAN kantor. Aturan ini ditegakkan di `api` pada setiap request, bukan di UI atau proxy.

## Perintah

Workspace pnpm (Node 24 LTS, `minimumReleaseAge` 7 hari). Jalankan dari root repo.

- Install: `pnpm install --frozen-lockfile`
- Build: `pnpm -r build` (libs, api, worker, ui); stack dev: `cp .env.example .env && pnpm keys:generate && docker compose --profile dev up -d --wait` (migrasi dan seed jalan otomatis)
- Test: `pnpm test` (unit), `pnpm test:int` (integrasi, file `*.int.test.ts`), `pnpm e2e` (Playwright, mulai G1). Per paket: `pnpm --filter <paket> test [filter]`
- Lint: `pnpm lint`
- Typecheck: `pnpm typecheck`
- Mock OLT: `pnpm --filter mock-olt scenario <nama>` (di container: `docker compose exec mock-olt-1 scenario <nama>`), `pnpm --filter mock-olt seed` (tulis ulang `fixtures/seed/`)
- Database: `pnpm --filter @olt/db migrate` (prisma migrate deploy), `pnpm --filter @olt/db seed` (user dari env `SEED_*`; admin memakai password default `DataUtama*26` bila `SEED_ADMIN_PASSWORD` kosong; allowlist OLT mock)
- Semua sebelum commit: `pnpm check` (lint, typecheck, unit)

## Bahasa

- Jawab pengguna dalam Bahasa Indonesia.
- Kode, komentar, commit message, dan pesan log dalam Bahasa Inggris.
- Teks UI dalam Bahasa Inggris (keputusan pemilik repo 14 Nov 2026). Label yang dikutip dalam Bahasa Indonesia di dokumen tampil dengan padanan Inggrisnya, mis. "identitas lemah" (aturan 7) menjadi "Weak identity"; daftar padanannya di `SPEC.md` §6.6. Pesan dari `api` dan `worker` yang ditampilkan UI, serta pesan Telegram, tetap Bahasa Indonesia.
- Dokumen proyek (`SPEC.md`, file ini) dalam Bahasa Indonesia.
