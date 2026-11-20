# Spesifikasi: monitoring dan konfigurasi OLT ZTE C320

23 Okt 2026 · disusun dari wawancara · acuan: `docs/project-brief.md`, `docs/technical-brief.md`, `docs/Buku-Panduan-OLT-C320-Pt1.pdf`

## 1. Ringkasan

Aplikasi web ini memantau OLT ZTE ZXA10 C320 secara read-only lewat SNMP, dan juga lewat CLI (SSH) setelah SSH diaktifkan. Alarm tampil di UI dan dikirim ke Telegram, dan identitas OLT diverifikasi sebelum kredensial dikirim. Fase 2 (registrasi ONU layanan internet) awalnya hanya diperagakan terhadap mock OLT; sejak 13 Nov 2026 dibuka untuk semua OLT asli (§8.5). Targetnya demo ke pembimbing lapangan pada Selasa 27 Okt 2026, dengan sisa waktu kerja ±40 jam. Repo saat ini baru berisi dokumen di `docs/`.

Dokumen ini menggantikan bagian brief yang bertentangan dengannya; bagian brief yang tidak disinggung tetap berlaku. Bila ada pertentangan, yang berlaku berurutan: `CLAUDE.md`, dokumen ini, lalu brief.

## 2. Keputusan

### 2.1 Dari wawancara

| Topik | Keputusan | Akibat pada desain |
| --- | --- | --- |
| Frontend | Vite + React | SPA statis di `caddy`, routing sisi klien, fallback ke `index.html` |
| Bahasa | UI berbahasa Inggris (keputusan pemilik repo 14 Nov 2026); dokumen, pesan error dari `api`/`worker`, dan pesan Telegram berbahasa Indonesia; kode, komentar, commit, dan log berbahasa Inggris | Padanan label UI di §6.6 |
| Waktu | ±40 jam sampai demo 27 Okt | Urutan tunda di §3 |
| Progres | VPS sudah menjangkau OLT (ping dan SNMP dengan community ro yang ada); belum ada kode, akun aplikasi, atau rekaman | Rekaman golden (§10) menjadi jalur kritis untuk OLT asli |
| OLT saat demo | OLT asli read-only untuk dashboard; mock untuk skenario gangguan dan Fase 2 | `mock-olt` ikut berjalan di VPS (profil `demo`) |
| Fase 2 | Dibuka untuk semua OLT asli (keputusan pemilik repo, 13 Nov 2026) | Template, preview ber-hash, persetujuan, dan audit (§8.5) |
| Akses OLT | Kredensial SNMP ro dan akun CLI aplikasi diberikan sebelum Senin 26 Okt | — |
| SNMP | SNMPv3 didukung dan boleh diaktifkan; sampai aktif, community v2c ro yang sudah ada boleh dipakai sementara dengan izin | v3 authPriv; v2c dicap "identitas lemah" |
| Firmware | Belum diketahui | Profil OID per OLT, dideteksi dari `sysDescr`, dibuktikan dengan golden test |
| SSH | Didukung, belum aktif; aktivasinya diminta; Telnet tidak dipakai | CLI ke OLT asli baru berjalan setelah SSH aktif dan host key di-pin |
| Jalur jaringan | Lewat router (L3), tanpa NAT; inband dan outband berbeda per OLT | netwatch dihapus; filter IP sumber trap tetap berlaku; `mgmt_path` dicatat per OLT |
| NMS lain | LibreNMS, di server lain | OLT dipolling dua sistem: jadwal diberi offset, uji pertama di jam sepi |
| Akses UI | Internet tanpa VPN, lewat domain dan port forward 443 | Sertifikat Let's Encrypt lewat `caddy`; kompensasi di §9 |
| Kompensasi | Sesi pendek; admin hanya dari LAN | Tanpa MFA (risiko diterima, §12) |
| DyingGasp | Alarm per ONU (`onu_dying_gasp`); bila massal per port digabung di bawah `pon_mass_power` (diubah 19 Nov 2026) | — |
| Flapping | ≥3 putus dalam 1 jam; selesai setelah stabil 1 jam | — |
| LOS massal | ≥4 ONU atau ≥50% ONU port sedang LOS (status saat ini) | — |
| OLT tak terjangkau | 2 siklus status gagal (±2 menit) | ONU tampil "tidak diketahui", tanpa alarm per ONU |
| Sesi CLI penuh | Retry 30 detik, 2 menit, 5 menit, lalu gagal; password salah tidak di-retry | — |
| Ambang Rx | Waspada < −25 dBm, kritis < −27 dBm, histeresis 1 dB | — |
| Telegram | OLT tak terjangkau, alarm massal, keamanan, flapping | LOS satu ONU dan alarm Rx hanya di UI |
| Data TA | Data mentah ≥ 1 tahun; ditambah trafik per ONU dan metrik OLT | Kedua tambahan boleh ditunda setelah demo |
| Backup | Setelah demo | Prasyarat go-live |
| Perubahan identitas | Dalam waktu dekat hanya aktivasi SSH dan SNMPv3 | Pin awal setelah aktivasi; dua slot host key per OLT |
| Riwayat ONU | Berlanjut bila posisi dan nama sama; nama berubah berarti pelanggan baru | §7 |
| Template Fase 2 | Bab IV-A panduan (internet, VLAN tunggal) | Berbeda dari konfigurasi lapangan di hlm. 20; diganti sebelum ke OLT asli |
| Konfirmasi Fase 2 | Teknisi mengajukan registrasi ONU miliknya, NOC atau admin menyetujui (job langsung jalan) atau menolak dengan alasan; job lain oleh admin | §8.6 |
| `write` | Aksi admin terpisah; dashboard menampilkan perubahan yang belum disimpan | Job `config.save` |
| Layanan Fase 2 | Internet saja | Multicast dan VoIP di luar lingkup |
| Uji Fase 2 di OLT asli (setelah KP) | ONU cadangan di port non-kritis | §10 |
| Boleh ditunda | Penerima trap, trafik dan metrik OLT, halaman kelola user dan audit, rollup | §3 |

### 2.2 Keputusan desain tambahan (belum ditanyakan; koreksi bila tidak setuju)

1. Kredensial OLT memakai enkripsi amplop. Data dienkripsi AES-256-GCM dengan kunci acak per record, dan kunci itu dibungkus public key milik `worker`. `api` hanya memegang public key, jadi `api` yang terbuka ke internet tidak bisa mendekripsi kredensial walau diambil alih.
2. Kode Telnet tidak dibuat sama sekali (bukan sekadar dimatikan), supaya tidak ada jalur fallback diam-diam.
3. Pengetahuan OLT yang murni (profil OID, builder perintah, parser output) ada di `packages/olt-spec` tanpa I/O jaringan. Paket ini dipakai `api` (preview), `worker`, dan `mock-olt`.
4. Konfirmasi Fase 2 membawa hash preview; `worker` merender ulang perintah dan hanya mengeksekusi bila hash-nya sama.
5. OLT berstatus `pending_pin` tidak dipolling. Hanya job probe identitas yang berjalan sampai admin atau NOC mem-pin.
6. Mock memutar rekaman OLT asli. OLT asli hanya boleh didaftarkan dengan profil OID yang lulus golden test.
7. Interval polling, jendela waktu alarm, dan jeda retry CLI disimpan per OLT. OLT mock memakai profil waktu cepat untuk demo tanpa mengubah perilaku OLT asli.
8. Sweep CLI per jam dipecah menjadi satu job per port PON supaya polling status tidak tertahan.
9. `worker` hanya boleh menghubungi alamat di `OLT_TARGET_CIDRS`. Di dev dan test isinya hanya jaringan mock, sebagai penegak aturan 4 di `CLAUDE.md`.
10. Aturan 50% untuk LOS massal hanya berlaku untuk port dengan minimal 2 ONU, supaya satu ONU dari dua tidak dianggap massal.
11. Autentikasi SNMPv3 yang gagal dua siklus berturut-turut dianggap ketidakcocokan identitas (karantina), sedangkan timeout dianggap OLT tak terjangkau.
12. Target ketersediaan 99% diukur oleh LibreNMS lewat cek HTTP ke `/api/health`.
13. Unit test memakai Vitest dengan `unplugin-swc`, karena DI NestJS butuh metadata dekorator yang tidak dihasilkan esbuild.

## 3. Lingkup demo 27 Okt

Wajib ada saat demo:

1. Login, sesi, RBAC, admin hanya dari LAN, dan audit log yang tercatat (halamannya boleh menyusul).
2. Poller SNMP: status tiap 1 menit, optik tiap 5 menit, dan riwayat mentah.
3. UI: dashboard, daftar dan detail OLT serta ONU, grafik Rx dasar, dan daftar alarm dengan ack.
4. Mesin alarm (§8.2) beserta notifikasi Telegram.
5. Identitas OLT: pin, verifikasi host key (di mock) dan SNMPv3, karantina, dan menerima perubahan.
6. `mock-olt` beserta skenario gangguan.
7. Fase 2: registrasi ONU internet ke OLT asli dan mock, disimpan dengan `write` otomatis setelah verifikasi.
8. Hardening untuk akses internet (§9).

Bila waktu habis, tunda dengan urutan ini:

1. Keputusan wawancara: penerima trap (WP5), trafik per ONU dan metrik OLT, halaman kelola user dan audit (user dibuat lewat skrip seed), dan rollup per jam. Tabelnya tetap dibuat dari awal.
2. Urutan brief: polesan UI, lalu grafik lanjutan, lalu eksekusi Fase 2 diturunkan menjadi mode generator perintah.

Bagian yang bergantung pada pihak lain: tampilan OLT asli di demo butuh akses sebelum Senin dan golden test yang lulus, sedangkan data CLI dari OLT asli butuh SSH aktif. Bila salah satunya belum ada, bagian itu diperagakan di mock dan dicatat di laporan.

## 4. Arsitektur

```
            HP / PC (internet atau LAN)
                       │  HTTPS 443, port forward tanpa SNAT
              ┌────────▼────────┐
              │   caddy + UI    │
              └────────┬────────┘
                       │ /api, /socket.io
              ┌────────▼────────┐        ┌────────────┐
              │       api       ├───────►│  postgres  │
              └────────┬────────┘        └─────▲──────┘
                       │ job ↓  event ↑        │
              ┌────────▼────────┐              │
              │      redis      │              │
              └────────┬────────┘              │
              ┌────────▼────────┐              │
              │     worker      ├──────────────┘
              └──┬──────┬────┬──┘
                 │      │    └──► api.telegram.org (HTTPS)
                 │      └───────► mock-olt (jaringan internal; profil dev dan demo)
                 └──────────────► OLT asli lewat router (SNMPv3 161, SSH 22; trap 162 masuk, ditunda)
```

| Komponen | Tanggung jawab | Perubahan dari brief |
| --- | --- | --- |
| `caddy` | TLS publik (Let's Encrypt), header keamanan, UI statis, proxy `/api` dan `/socket.io` | `tls internal` hanya untuk dev |
| `api` | Auth, sesi, RBAC, REST, Socket.IO, render preview, pembuatan job | Tidak memegang private key kredensial |
| `worker` | Semua akses OLT: scheduler per OLT, poller SNMP, sesi CLI SSH, verifikasi identitas, mesin alarm, eksekutor Fase 2, outbox Telegram, perawatan data, penerima trap (ditunda) | Tanpa Telnet |
| `postgres`, `redis` | Sesuai brief | Redis juga dipakai untuk rate limit login |
| `mock-olt` | Agent SNMP (v2c dan v3), server SSH, pengirim trap, skenario | Menggantikan server Telnet di brief; jalan di profil `dev` dan `demo` |
| `netwatch` | — | Dihapus: jalurnya L3, jadi MAC OLT tidak terlihat dari VPS |

Jaringan dan port (menggantikan tabel di technical brief):

| Dari | Ke | Port | Catatan |
| --- | --- | --- | --- |
| Internet dan LAN | `caddy` | TCP 443 | Port forward di router kantor, tanpa SNAT; IP publik statis atau DDNS |
| Internet | `caddy` | TCP 80 | Opsional untuk redirect dan ACME HTTP-01; TLS-ALPN-01 cukup lewat 443 |
| Admin | VPS | TCP 22 | Hanya dari IP admin, dengan kunci SSH |
| `worker` | OLT asli | UDP 161 | SNMPv3; v2c sementara |
| `worker` | OLT asli | TCP 22 | Setelah SSH aktif |
| OLT asli | `worker` | UDP 162 | Ditunda (WP5); hanya dari IP OLT lewat chain `DOCKER-USER` |
| `worker` | `api.telegram.org` | TCP 443 | Lalu lintas keluar lain ditutup |
| `worker` | `mock-olt` | UDP 161, TCP 22 | Hanya jaringan Docker internal |
| Siapa pun | `api`, `postgres`, `redis`, `mock-olt` | — | Tidak dipublikasikan |

## 5. Struktur repo dan modul

```
.
├── CLAUDE.md
├── SPEC.md
├── compose.yaml                 # layanan inti; mock-olt di profil dev dan demo
├── deploy/
│   ├── Caddyfile
│   ├── env.sops.yaml            # rahasia terenkripsi (sops + age)
│   └── firewall/docker-user.sh  # batasi UDP 162 ke IP OLT
├── docs/                        # brief, panduan, runbook
├── packages/
│   ├── shared/                  # skema Zod API, DTO, enum, tipe event
│   ├── olt-spec/                # profil OID, builder perintah, parser (tanpa I/O)
│   └── db/                      # skema Prisma, migrasi SQL, seed
└── apps/
    ├── api/                     # NestJS
    ├── worker/                  # NestJS standalone
    ├── ui/                      # Vite + React
    └── mock-olt/                # Node: SNMP, SSH, skenario, fixtures/
```

| Modul | Berkas kunci | Isi |
| --- | --- | --- |
| `packages/olt-spec` | `src/params.ts` | Skema Zod untuk referensi port dan ONU, SN, nama, VLAN, profil |
| | `src/commands/read.ts`, `src/commands/provision.ts` | Builder yang menghasilkan `AllowedCommand` (§6.2) |
| | `src/parsers/*.ts` | Parser output `show`: state, attenuation, detail-info, interface, running-config |
| | `src/oid-profiles/zte-c320-v2_1.ts`, `zte-c320-v2_2.ts` | Profil OID, decoder index, konversi nilai |
| `apps/worker` | `src/scheduler/olt-queues.ts` | Antrian per OLT, global concurrency 1, job scheduler, prioritas |
| | `src/snmp/olt-snmp.client.ts` | `OltSnmpClient` (v3 dan v2c) |
| | `src/cli/olt-cli.session.ts` | `OltCliSession` (ssh2) |
| | `src/identity/identity.verifier.ts` | Pemeriksaan pin dan karantina |
| | `src/poller/*.ts` | Siklus status dan optik; metrik dan trafik (ditunda) |
| | `src/alarms/alarm.engine.ts`, `src/alarms/rules/*.ts` | Aturan §8.2, dengan clock yang bisa disuntik |
| | `src/provision/provision.executor.ts` | Eksekusi Fase 2 dan `write` |
| | `src/guards/target.guard.ts` | `OLT_TARGET_CIDRS` dan guard tulis |
| | `src/crypto/credential.decryptor.ts` | Satu-satunya pemegang private key |
| | `src/notify/telegram.outbox.ts` | Pengirim outbox Telegram |
| | `src/trap/trap.receiver.ts` | Ditunda |
| `apps/api` | `src/auth/*` | Login, sesi, `RolesGuard`, `AdminLanGuard` |
| | `src/crypto/credential.encryptor.ts` | Enkripsi dengan public key |
| | `src/olts`, `src/onus`, `src/alarms`, `src/jobs`, `src/identity`, `src/audit` | Modul REST |
| | `src/realtime/events.gateway.ts` | Socket.IO; meneruskan event dari Redis |
| `apps/ui` | `src/routes/*` | Halaman di §6.6 |
| `apps/mock-olt` | `src/snmp-agent.ts`, `src/ssh-server.ts`, `src/state.ts`, `src/scenarios/*.ts`, `fixtures/` | §6.7 |

## 6. Antarmuka

### 6.1 Akses OLT di worker

```ts
// packages/olt-spec
export type AllowedCommand = {
  readonly text: string;
  readonly kind: 'read' | 'write' | 'session';
  readonly __brand: 'AllowedCommand'; // only builders in olt-spec create these
};

export interface OidProfile {
  id: 'zte-c320-v2.1' | 'zte-c320-v2.2';
  verified: boolean; // true only after the golden test passes
  indexArcs: Partial<Record<keyof OnuColumns, number[]>>; // extra index arcs per column; rxOnu = [1] (ponIfIndex.onuId.1)
  decodeOnuIndex(suffix: number[], column?: keyof OnuColumns): { slot: number; port: number; onuId: number };
  phaseState(raw: number): PhaseState; // working | los | dying_gasp | offline | syncing | auth_failed | unknown
  rxOnuDbm(raw: number): number | null; // raw * 0.002 - 30, 65535 = no signal (olt-a)
  rxOltDbm(raw: number): number | null; // milli-dBm, -80000 = no signal (olt-a); both: outside [-50, +10] dBm = null
}

// apps/worker
export interface OltSnmpClient {
  identity(): Promise<{ sysName: string; sysObjectId: string; sysDescr: string; engineId?: string }>;
  onuStatus(): Promise<OnuStatusRow[]>; // phase, admin, and OMCC state per ONU index
  onuOptical(): Promise<OnuOpticalRow[]>; // ONU-side and OLT-side Rx plus inventory (name, SN, type)
  close(): void;
}

export interface OltCliSession {
  open(mode: 'read' | 'write'): Promise<void>; // host key is checked during the handshake, before auth
  run(cmd: AllowedCommand, timeoutMs?: number): Promise<string>; // pages through --More--, throws CliError on lines starting with %
  close(): Promise<void>; // always called from finally; sends exit
}
```

### 6.2 Allowlist perintah CLI

Semua perintah dibangun oleh builder di `olt-spec`; tidak ada endpoint atau fungsi yang menerima string perintah bebas. `S`, `P`, dan `N` adalah slot, port, dan ID ONU yang sudah divalidasi.

| Builder | Perintah | Jenis | Dipakai untuk |
| --- | --- | --- | --- |
| `showOnuState` | `show gpon onu state gpon-olt_1/S/P` | baca | Cadangan status; cek ID ONU kosong |
| `showPortRunningConfig` | `show running-config interface gpon-olt_1/S/P` | baca | Cadangan inventaris (index, tipe, SN); perlu diverifikasi |
| `showOnuDetail` | `show gpon onu detail-info gpon-onu_1/S/P:N` | baca | Nama, riwayat offline, jarak, durasi online |
| `showAttenuation` | `show pon power attenuation gpon-onu_1/S/P:N` | baca | Tx, Rx, dan atenuasi on-demand |
| `showOnuInterface` | `show interface gpon-onu_1/S/P:N` | baca | Trafik sesaat on-demand |
| `showOnuRunningConfig` | `show running-config interface gpon-onu_1/S/P:N` | baca | Snapshot dan verifikasi Fase 2 |
| `showOnuMngConfig` | `show onu running config gpon-onu_1/S/P:N` | baca | Snapshot dan verifikasi Fase 2 |
| `showCard` | `show card` | baca | Firmware dan slot |
| `showVlanSummary` | `show vlan summary` | baca | VLAN yang dibuat di OLT, untuk daftar VLAN registrasi (§8.5) |
| `showOnuUncfg` | `show gpon onu uncfg` | baca | ONU yang terlihat di port PON tetapi belum terdaftar, untuk halaman registrasi (§8.5); jawaban `No related information` berarti kosong |
| `showTcontProfiles` | `show gpon profile tcont` | baca | Profil T-CONT di OLT, untuk daftar profil registrasi (§8.5); nama yang tidak lolos `^[A-Za-z0-9._-]{1,32}$` dilewati dan dilaporkan |
| `registerOnuInternet` | Template mode `default` di §8.5 | tulis | Fase 2 |
| `registerOnuBridge` | Template mode `bridge` di §8.5 | tulis | Fase 2 (14 Nov 2026) |
| `registerOnuPppoeMap` | Template mode `pppoe_map` di §8.5 | tulis | Fase 2 (15 Nov 2026) |
| `registerOnuBridgeStatic` | Template mode `bridge_static` di §8.5 | tulis | Fase 2 (17 Nov 2026) |
| `writeConfig` | `write` | tulis | Fase 2: otomatis setelah registrasi terverifikasi, atau manual oleh admin |

`show running-config` penuh sengaja tidak masuk allowlist karena memuat community SNMP dan password user OLT.

### 6.3 Sumber data

| Data | Sumber utama | Cadangan | Frekuensi | OLT asli saat demo |
| --- | --- | --- | --- | --- |
| Status fase, admin, OMCC | SNMP | `showOnuState` | 1 menit | Ya, bila OID terverifikasi |
| Inventaris ONU (index, nama, SN, tipe) | SNMP | `showPortRunningConfig` dan `showOnuDetail` | 5 menit | Ya |
| Rx sisi ONU dan sisi OLT | SNMP | `showAttenuation` | 5 menit | Ya |
| Tx dan atenuasi (dB) | CLI `showAttenuation` | — | On-demand | Setelah SSH aktif |
| Riwayat offline, penyebab, jarak, durasi online | CLI `showOnuDetail` | — | Per jam (satu job per port) dan on-demand | Setelah SSH aktif; sebelumnya di mock |
| Trafik per ONU | SNMP, bila OID-nya ada | `showOnuInterface` (rate sesaat, ditandai `source=cli`) | 5 menit | Ditunda |
| Metrik OLT (CPU, memori, suhu, optik port PON) | SNMP | — | 5 menit | Ditunda |
| Firmware | `sysDescr` | `showCard` | Saat registrasi | Ya |
| Identitas | Engine ID SNMPv3, atau sysName + sysObjectID untuk v2c; host key SSH | — | Tiap siklus; tiap sesi | Ya (SNMP) |

Cadangan CLI baru tersedia setelah SSH aktif. Bila SNMP di firmware kalian tidak menyediakan status ONU, status OLT asli tidak bisa ditampilkan sampai SSH aktif. Ini risiko terbesar untuk bagian OLT asli di demo.

### 6.4 Antrian dan job

Setiap OLT punya antrian `olt:{oltId}` dengan global concurrency 1 (`setGlobalConcurrency(1)` di BullMQ), dan `worker` dijalankan satu replika. Semua job diberi prioritas eksplisit (1 = tertinggi), supaya urutannya tidak bergantung pada cara BullMQ memperlakukan job tanpa prioritas.

| Job | Prioritas | Jadwal | Butuh |
| --- | --- | --- | --- |
| `identity.probe` | 1 | Saat registrasi dan atas permintaan admin | Handshake SSH tanpa autentikasi; GET identitas SNMP |
| `cli.onu-detail` | 1 | On-demand dari UI, maksimal 1 per ONU per 30 detik | SSH dengan pin |
| `cli.uncfg-scan` | 1 | On-demand dari halaman registrasi (tombol "Refresh"), maksimal 1 per OLT per 15 detik, satu percobaan | SSH dengan pin, sesi baca |
| `cli.list-sync` | 1 | On-demand oleh NOC/admin (tombol "Ambil dari OLT"), maksimal 1 per OLT per 30 detik, satu percobaan | SSH dengan pin, sesi baca: `show vlan summary` dan daftar profil T-CONT |
| `provision.onu-register`, `config.save` | 1 | On-demand | OLT mock |
| `poll.status` | 2 | `status_interval_s` (default 60) dengan offset per OLT | SNMP |
| `poll.optical` | 3 | 5 menit | SNMP |
| `poll.metrics`, `poll.traffic` | 4 | 5 menit | SNMP (ditunda) |
| `cli.port-sweep` | 5 | Per jam, satu job per port PON | SSH dengan pin |

Poll terjadwal (`poll.status`, `poll.optical`) mengalah ke job prioritas 1 yang sedang menunggu, mis. klik "Refresh" di UI (permintaan pemilik repo, 15 Nov 2026). Sebelum walk tiap kolom SNMP (sesudah pemeriksaan identitas), `worker` memeriksa antrian OLT itu. Bila ada job prioritas 1 yang menunggu, siklus dihentikan tanpa menulis apa pun, sama seperti siklus gagal, dan dicatat di `poll_run` dengan error `PollYieldedError`. Siklus itu lalu diantrekan ulang sekali dengan prioritasnya sendiri, sehingga berjalan tepat setelah job tersebut, dan run ulang itu tidak mengalah lagi. Karena bukan timeout, siklus yang mengalah tidak mengubah status OLT dan tidak dihitung untuk alarm `olt_unreachable` maupun karantina. Job yang sedang memakai CLI tidak pernah disela.

Antrian yang tidak menyentuh OLT: `notify` (outbox Telegram) dan `maintenance` (retensi, rollup). Penjadwalan memakai job scheduler BullMQ (`upsertJobScheduler`).

### 6.5 REST API

Semua endpoint berada di bawah `/api`. Peran: A = admin (hanya dari LAN), N = NOC, T = teknisi.

| Method dan path | Peran | Catatan |
| --- | --- | --- |
| `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | Semua | Login admin dari luar LAN ditolak |
| `POST /auth/password` | Semua | Mencabut semua sesi lain |
| `GET /dashboard` | Semua | Ringkasan per OLT dan alarm aktif |
| `GET /olts`, `GET /olts/:id` | Semua | Termasuk status, usia data, dan tingkat identitas |
| `POST /olts` | A, N | Kredensial dienkripsi di `api` dengan public key; status awal `pending_pin` dan `identity.probe` |
| `PATCH /olts/:id` | A | Mengaktifkan CLI butuh kredensial CLI (baru atau tersimpan); CLI yang baru aktif atau algoritma SSH yang berubah memicu `identity.probe` |
| `DELETE /olts/:id` | A, N | Status apa pun, beserta semua datanya (§8.4); konfirmasi dengan mengetik nama OLT; perubahan identitas yang belum diterima: A saja |
| `GET /olts/:id/identity` | A, N | Pin, kandidat, dan riwayat |
| `POST /olts/:id/identity/probe` | A, N | Ditolak selama karantina |
| `POST /olts/:id/identity/pin` | A, N | Kandidat menjadi pinned; mengganti nilai yang sudah di-pin hanya lewat `accept-change` |
| `POST /olts/:id/identity/accept-change` | A | Alasan wajib dan konfirmasi ulang dengan mengetik nama OLT |
| `POST /olts/:id/maintenance-windows` | A | Jendela pemeliharaan |
| `GET /olts/:id/unsaved-changes` | A | Fase 2 |
| `POST /olts/:id/save-config` | A | Membuat job `config.save` |
| `GET /olts/:id/vlans` | Semua | Daftar VLAN yang boleh dipakai registrasi di OLT itu |
| `POST /olts/:id/vlans` | A, N | Menambah VLAN (1–4094) ke daftar di aplikasi; OLT tidak diubah; tercatat di audit |
| `GET /olts/:id/uncfg` | Semua | `{ scan }`: hasil scan `show gpon onu uncfg` terakhir OLT itu, null bila belum pernah |
| `POST /olts/:id/uncfg/scan` | Semua | Job `cli.uncfg-scan`; 409 bila CLI OLT belum aktif |
| `GET /olts/:id/tcont-profiles` | Semua | Daftar profil T-CONT yang boleh dipakai registrasi di OLT itu |
| `POST /olts/:id/tcont-profiles` | A, N | Menambah nama profil T-CONT ke daftar di aplikasi; OLT tidak diubah; tercatat di audit |
| `POST /olts/:id/provision-lists/sync` | A, N | Job `cli.list-sync`: membaca VLAN dan profil T-CONT dari OLT lalu menambahkan yang belum ada; 409 bila CLI OLT belum aktif |
| `GET /onus`, `GET /onus/:id` | Semua | Filter OLT, port, status, pita Rx; cari nama, SN, index |
| `GET /onus/:id/metrics?from&to`, `GET /onus/:id/events` | Semua | — |
| `POST /onus/:id/refresh` | Semua | Job `cli.onu-detail`; 409 bila CLI OLT belum aktif |
| `GET /alarms`, `POST /alarms/:id/ack` | Semua; ack hanya A, N | — |
| `POST /jobs` | A, T | Draft ke preview |
| `GET /jobs/:id` | A, pemilik; N untuk `onu_register` | — |
| `POST /jobs/:id/confirm` | A; T untuk `onu_register` miliknya | Body wajib membawa `previewSha256`. A: langsung jalan; T: menjadi `pending_approval` |
| `GET /approvals` | A, N | Registrasi teknisi yang menunggu persetujuan |
| `POST /jobs/:id/approve` | A, N | `pending_approval` → `confirmed`; body membawa `previewSha256` yang dilihat penyetuju; job sendiri ditolak |
| `POST /jobs/:id/reject` | A, N | `pending_approval` → `rejected`; alasan wajib dan terlihat oleh teknisi |
| `POST /jobs/:id/cancel` | A, pemilik | — |
| `GET /users`, `POST /users/:id/password` | A | Ganti password akun NOC dan teknisi; semua sesinya dicabut. Password admin hanya lewat `POST /auth/password` |
| `GET /audit` | A | Halaman UI-nya ditunda |
| `GET /health` | Publik | Hanya status, tanpa detail |

### 6.6 Realtime dan UI

Socket.IO memeriksa cookie sesi saat handshake. Event: `olt.status`, `onu.state`, `alarm.raised`, `alarm.updated`, `alarm.cleared`, `job.updated`, dan `security.event` (khusus room admin). `worker` mem-publish event ke Redis, lalu `api` meneruskannya.

Halaman UI (responsif, berbahasa Inggris sejak 14 Nov 2026; tampilannya mengikuti prototipe `fiber-signal-command`):

- `/login`
- `/`: dashboard per OLT berisi jumlah online dan tidak online, kotak port PON, alarm aktif, usia data, dan lencana identitas
- `/olts`: daftar OLT dengan kartu yang sama
- `/olts/:id`: jumlah ONU per fase (online/working, LOS, dying gasp, offline), port PON, identitas, dan perubahan belum disimpan
- `/onus` dan `/onus/:id`: status, Rx, grafik, riwayat event, riwayat offline, tombol refresh
- `/alarms`
- `/provision/new` dan `/jobs/:id`: Fase 2
- `/admin/users` dan `/admin/audit`: ditunda

OLT mock diberi label "MOCK" yang jelas di semua halaman.

Kotak port PON dihitung dari daftar ONU OLT, jadi hanya port yang punya ONU yang tampil. Angkanya jumlah ONU terdaftar; warnanya merah bila ada ONU LOS dan kuning bila ada Rx di bawah −25 dBm. Selama status OLT bukan normal, kotak port dan jumlah per fase menampilkan nilai terakhir yang diketahui dan ditandai "last known".

Bagian bawah kartu OLT menampilkan kunci identitas OLT (host key SSH, engine ID SNMPv3, atau sysName dan sysObjectID untuk v2c), baik yang sudah di-pin maupun kandidat dari probe, supaya bisa dibandingkan dengan konsol OLT. Admin dan NOC mendapat tombol "Pin…" di samping lencana identitas selama masih ada jenis identitas yang belum di-pin. Tombol itu baru aktif bila ada kandidat dan meminta konfirmasi, lalu memanggil endpoint pin yang sama dengan panel identitas (§8.4 langkah 2). Untuk OLT yang dikarantina tidak ada tombol pin; perubahan tetap diterima admin di halaman OLT. Teknisi melihat kunci sebagai N/A.

Slot data dari desain yang tidak dikumpulkan atau tidak diekspos sistem (mis. CPU, memori, suhu, uptime, dan uplink OLT; lokasi OLT; ID pelanggan, alamat, profil layanan, dan firmware ONU; email user) tetap ditampilkan dengan nilai "N/A". Aksi dari desain yang tidak didukung (reboot ONU, clear alarm, tambah user, ubah peran, aktif/nonaktif user, riwayat registrasi) tampil nonaktif dan tidak pernah dijalankan. Field yang didukung tetapi belum bernilai tampil "—".

Padanan label UI untuk istilah yang dikutip dalam Bahasa Indonesia di dokumen ini:

| Di dokumen | Di UI |
| --- | --- |
| identitas kuat / lemah / belum di-pin | Strong identity / Weak identity / Not pinned |
| tidak diketahui (terakhir: working, 10:42) | Unknown (last: working, 10:42) |
| status OLT normal / data tertunda / tidak terjangkau / karantina / menunggu pin / nonaktif | Operational / Stale data / Unreachable / Quarantined / Pending pin / Disabled |
| di-ack | Acknowledged |
| halaman Ganti password / Pengguna | Change password / Users |

### 6.7 mock-olt

- Agent SNMP v2c dan v3 yang memutar tabel dari `fixtures/`, yaitu rekaman OLT asli yang sudah diredaksi. Sebelum rekaman ada, mock memakai contoh output di panduan.
- Server SSH (ssh2) dengan host key yang bisa diganti, prompt yang bisa diatur (`ZXAN#`, `OLT-ZTE_C320#`, `OLT-DUD@JGL#`), pager `--More--`, batas sesi, error `%Error ...`, serta state yang berubah oleh perintah Fase 2 dan `write`.
- Mencatat setiap percobaan autentikasi dan setiap perintah sebagai bukti di tes.
- Skenario dijalankan lewat `pnpm --filter mock-olt scenario <nama>` (di VPS: `docker compose exec mock-olt ...`): `onu-los`, `onu-dying-gasp`, `los-mass`, `dying-gasp-mass`, `flap`, `rx-degrade`, `olt-down`, `olt-up`, `vty-full`, `vty-free`, `hostkey-rotate`, `engineid-change`, dan `reset`.
- Tiga instance untuk demo (`mock-1` sampai `mock-3`, masing-masing ±70 ONU).

### 6.8 Konfigurasi

| Variabel | Dipakai oleh | Isi |
| --- | --- | --- |
| `DATABASE_URL`, `REDIS_URL` | api, worker | — |
| `APP_TIMEZONE` | api, worker, ui | Zona waktu kantor; wajib, tanpa default |
| `PUBLIC_DOMAIN` | caddy | Domain publik |
| `ADMIN_ALLOWED_CIDRS` | api | CIDR LAN kantor untuk peran admin |
| `OLT_TARGET_CIDRS` | worker | Alamat yang boleh dihubungi; di dev dan test hanya jaringan mock |
| `MOCK_OLT_CIDRS` | worker | Jaringan `mock-olt` (sejak 13 Nov 2026 bukan lagi syarat job tulis) |
| `OLT_CRED_PUBLIC_KEY` | api | Public key untuk enkripsi kredensial |
| `OLT_CRED_PRIVATE_KEY_FILE` | worker | Path Docker secret |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | worker | — |
| `SESSION_IDLE_MINUTES=30`, `SESSION_MAX_HOURS=12` | api | — |

## 7. Model data

Model di technical brief tetap menjadi dasar, dengan perubahan berikut.

| Tabel | Perubahan |
| --- | --- |
| `user` | Tambah `password_changed_at` |
| `session` (baru) | Hash ID sesi, `user_id`, `ip`, `user_agent`, `created_at`, `last_seen_at`, `expires_at`, `revoked_at` |
| `olt` | Tambah `is_mock` (tidak bisa diubah setelah dibuat), `oid_profile`, `firmware`, `mgmt_path` (inband, outband, unknown), `snmp_version` (v3, v2c), `cli_enabled`, `ssh_algorithms` (JSON, §8.3), `status_interval_s`, `alarm_settings` (JSON). `status`: pending_pin, ok, stale, unreachable, quarantined, disabled. `cli_proto` dihapus karena hanya SSH |
| `olt_identity` | `kind`: ssh_hostkey, snmp_engine_id, snmp_sysinfo. `status`: candidate, pinned, retired. Tambah `label` (mis. kartu kontrol slot 3 atau 4) dan `reason` |
| `maintenance_window` (baru) | `olt_id`, `starts_at`, `ends_at`, `reason`, `created_by` |
| `onu` | Tambah `description`, `archived_at`, `removed_at`. Unik (OLT, port, index) hanya untuk baris aktif, lewat partial unique index di migrasi SQL. SN tidak unik: OLT asli bisa menyimpan satu SN di dua posisi (golden `olt-a`: 4 dari 133 SN) |
| `onu_state` | Tambah `omcc_state`, `olt_rx_dbm`, `last_change_at` |
| `onu_event` | `kind` ditambah `device_replaced` dan `archived`; tambah `observed_after_gap` |
| `poll_run` (baru) | `olt_id`, `kind`, `started_at`, `finished_at`, `ok`, `error`; dasar "terakhir polling" dan deteksi celah |
| `alarm` | Tambah `severity`, `onu_id`, `parent_alarm_id` (penahanan), `ack_by`, `ack_at`, `cleared_at` |
| `notification` (baru) | Outbox Telegram: `dedupe_key` unik, `payload`, `status`, `attempts`, `sent_at` |
| `security_event` | `kind` ditambah `snmp_auth_failure`, `cli_auth_failed`, `admin_offlan_denied`, `write_guard_denied`, `trap_unknown_source` |
| `job` | `kind`: identity_probe, onu_detail, port_sweep, onu_register, config_save. Tambah `preview_sha256`, `applied_commands`, `before_snapshot`, `after_snapshot`, `saved_by_job_id` |
| `provision_allowlist` (baru) | Per OLT: tipe ONU, profil T-CONT, dan VLAN yang boleh dipakai Fase 2 |
| `onu_traffic`, `olt_metric`, `onu_metric_hourly` (baru) | Dibuat sejak awal; pengisinya ditunda |

Aturan riwayat ONU: baris aktif diidentifikasi oleh (OLT, port, index). Bila SN berubah dan nama tetap, baris yang sama dilanjutkan dan event `device_replaced` dicatat. Bila nama juga berubah, baris lama diarsipkan (`archived_at`) dan baris baru dibuat. ONU yang hilang dari OLT diberi `removed_at`, dan riwayatnya tidak dihapus.

Retensi: `onu_metric` mentah disimpan 400 hari dan `poll_run` 90 hari; sesi kedaluwarsa dihapus harian. Event, alarm, audit, security event, dan job tidak dihapus selama KP, kecuali milik OLT yang dihapus (§8.4); audit dan security event tetap ada. Menurut estimasi brief, data optik untuk 3 OLT sekitar 2–3 GB per tahun.

## 8. Perilaku

### 8.1 Polling

- Siklus status dimulai dengan pemeriksaan identitas (§8.4), lalu walk tabel status dengan GETBULK (max-repetitions 20), timeout 3 detik, dan 1 retry, dengan satu request berjalan per OLT. Siklus dianggap sukses hanya bila tabel status lengkap; hasil parsial dibuang.
- Perubahan status menjadi `onu_event` dengan waktu observasi `worker`, bukan jam OLT. Waktu dari output OLT, seperti OfflineTime, disimpan apa adanya dan dibaca dengan `APP_TIMEZONE`.
- Usia data per OLT dihitung dari `poll_run` sukses terakhir dan tampil di dashboard, dengan target status ≤ 2 menit dan optik ≤ 10 menit.
- Jadwal tiap OLT diberi offset supaya tidak serentak. Uji pertama di OLT asli dilakukan di jam sepi sambil memantau CPU OLT di LibreNMS.

### 8.2 Alarm

| Alarm | Pemicu | Selesai | Ditahan saat | Telegram |
| --- | --- | --- | --- | --- |
| `onu_los` | Fase ONU berubah ke LOS | Kembali `working` | LOS massal di port, flapping, OLT tak terjangkau, karantina | Tidak |
| `onu_dying_gasp` | Fase ONU sedang DyingGasp | Keluar dari DyingGasp | DyingGasp massal di port, OLT tak terjangkau, karantina | Tidak |
| `onu_flapping` | ≥3 kali putus (working ke LOS atau offline; DyingGasp tidak dihitung) dalam 1 jam | 1 jam tanpa putus | OLT tak terjangkau | Ya, saat mulai dan selesai |
| `onu_rx_low` | Rx sisi ONU < −25 dBm (waspada) atau < −27 dBm (kritis) | Rx naik ≥ 1 dB di atas ambang | OLT tak terjangkau | Tidak |
| `pon_mass_los` | ≥4 ONU, atau ≥50% ONU port (minimal 2 ONU), sedang LOS; dihitung dari status saat ini, termasuk ONU yang sudah LOS sebelum polling dimulai | Jumlah ONU LOS di port turun di bawah ambang | OLT tak terjangkau | Ya, saat mulai dan selesai |
| `pon_mass_power` | Aturan yang sama untuk DyingGasp, dengan teks "kemungkinan listrik padam" | Sama | OLT tak terjangkau | Ya, saat mulai dan selesai |
| `olt_unreachable` | 2 siklus status berturut-turut timeout | 1 siklus sukses | Karantina | Ya, saat mulai dan pulih (dengan ringkasan) |
| `olt_identity_mismatch` | Host key, engine ID, atau sysName/sysObjectID (v2c) berbeda dari pin; atau autentikasi SNMPv3 gagal 2 siklus | Admin menerima perubahan | — | Ya |
| `cli_unavailable` | Job CLI gagal setelah 3 retry | Job CLI berikutnya sukses | — | Tidak (peringatan rendah) |

- DyingGasp pada satu ONU memicu `onu_dying_gasp` tanpa Telegram (diubah 19 Nov 2026; sebelumnya hanya status).
- Di UI, kartu ringkasan halaman Alarms: OLT Unreachable, Dying Gasp (`onu_dying_gasp`), Loss (`onu_los`), Low Rx, dan Mass outage (`pon_mass_los` + `pon_mass_power`, ditandai merah).
- Sumber data putus untuk flapping: transisi dari polling, riwayat detail-info (bila CLI tersedia), dan trap (bila WP5 sudah ada). Ketiganya dideduplikasi dengan toleransi 60 detik.
- Alarm yang ditahan tetap tercatat sebagai anak (`parent_alarm_id`) dari alarm yang menahannya.
- Ack oleh NOC atau admin tidak menyelesaikan alarm; alarm selesai otomatis saat kondisinya pulih.
- Notifikasi dikirim lewat outbox dengan `dedupe_key` per transisi alarm, sehingga restart tidak menggandakan pesan. Alarm dalam jendela 10 detik digabung menjadi satu pesan agar tidak melewati batas Telegram (±20 pesan per menit per grup). Pesan berbahasa Indonesia dan memuat tautan ke UI.
- OLT tak terjangkau: setelah 1 siklus gagal, status OLT menjadi `stale`; setelah 2 siklus, `unreachable`. ONU tampil "tidak diketahui (terakhir: working, 10:42)". Saat OLT pulih, satu siklus penuh dibandingkan dengan keadaan terakhir sebelum gangguan. Event-nya ditandai `observed_after_gap`, aturan massal tetap berlaku, dan Telegram hanya menerima satu pesan pulih berisi jumlah ONU yang masih offline.

### 8.3 Sesi CLI

- Hanya SSH, satu sesi per job: buka, jalankan, tutup. Tidak ada sesi persisten, dan aplikasi tidak pernah memutus sesi orang lain.
- `open`: timeout koneksi 60 detik, karena pertukaran kunci di C320 saja memakan sekitar 16 detik. `hostVerifier` ssh2 membandingkan sha256 host key dengan pin, dan bila tidak cocok koneksi diputus sebelum autentikasi. Setelah itu login.
- Prompt pertama setelah login dikenali dari bentuknya, `<hostname>#` atau `<hostname>(<mode>)#`, apa pun hostname OLT-nya. Hostname boleh berisi karakter ASCII tercetak apa pun selain spasi, `#`, dan tanda kurung, mis. `ZXAN#`, `OLT-ZTE_C320#`, `OLT-DUD@JGL#`, atau `ZXAN(config-if)#`. Sejak saat itu, akhir output setiap perintah hanya ditandai prompt dengan hostname yang sama, dalam mode apa pun. Baris output yang kebetulan diakhiri `#` tidak dikira prompt. Aturan ini berlaku sejak 14 Nov 2026. Sebelumnya hanya huruf, angka, `_`, dan `-` yang diterima, sehingga OLT jangli (`OLT-DUD@JGL#`) selalu gagal dengan `cli_unavailable` "no prompt".
- `run`: timeout 30 detik per perintah, batas output 1 MB, `--More--` dijawab dengan spasi, kode kontrol terminal dibuang, dan baris yang diawali `%` dianggap error.
- Algoritma per OLT (`ssh_algorithms`): firmware lama hanya menawarkan algoritma yang tidak aktif secara default di ssh2, mis. cipher `aes128-cbc` (golden `olt-a`). Admin memilih tambahan dari allowlist (kex `diffie-hellman-group14-sha1`, `diffie-hellman-group-exchange-sha1`, `diffie-hellman-group1-sha1`; host key `ssh-dss`; cipher `aes128-cbc`, `aes192-cbc`, `aes256-cbc`, `3des-cbc`; MAC `hmac-sha1-96`, `hmac-md5`, `hmac-md5-96`). Pilihan itu ditambahkan di belakang default ssh2 menurut urutan allowlist (terkuat dulu, mis. `aes128-cbc` sebelum `3des-cbc`), bukan urutan simpanan, sehingga algoritma modern tetap dipilih bila OLT menawarkannya. Urutan kex mengikuti OpenSSH: `diffie-hellman-group14-sha256` diletakkan di belakang grup SHA-512. Dengan urutan ini C320 asli (`ZTE_SSH.1.0`) menyepakati `group16-sha512`, sama seperti OpenSSH. Pertukaran kunci 4096-bit itu memakan sekitar 16 detik di CPU OLT per koneksi. Host key `ssh-rsa` sudah diterima tanpa pengaturan. Nilainya divalidasi Zod di `api` dan divalidasi ulang di `worker`. Bila tidak ada algoritma yang sama, job gagal dengan `ssh_negotiation_failed` beserta langkah yang gagal, tanpa retry, dan tanpa autentikasi.
- `close`: kirim `exit` lalu tutup socket, selalu dari `finally`.
- Login mengikuti urutan OpenSSH: metode `none` dulu (OLT menjawab dengan metode yang diizinkan), lalu `password`. Setiap paket SSH dikirim bersama MAC-nya dalam satu tulis ke socket, seperti OpenSSH. ssh2 menulis badan paket dan MAC secara terpisah, dan C320 asli memutus koneksi (`ECONNRESET`) bila satu paket tiba terpecah di dua segmen TCP. Ini terbukti lewat proxy pencatat pada Nov 2026, dan setelah paket dikirim utuh login berhasil.
- Retry hanya untuk kegagalan mendapatkan sesi (koneksi ditolak, timeout, atau sesi ditutup sebelum prompt muncul): 30 detik, 2 menit, 5 menit, lalu job gagal dan `cli_unavailable` dibuat. Hasil job itu menyimpan alasan beserta tahapnya, teks terakhir di layar OLT, dan jejak protokol SSH dengan cap waktu, tanpa kredensial. Log worker hanya mencatat alasannya. Retry memakai job tertunda, jadi antrian tidak terblokir. Password salah tidak di-retry dan menghasilkan `cli_auth_failed`. Job tulis tidak pernah di-retry setelah ada perintah yang terkirim.
- Transkrip disimpan di `job.result` setelah diredaksi; fase autentikasi tidak pernah dicatat.

### 8.4 Identitas OLT

| Sinyal | Cara memeriksa | Kekuatan | Kapan berlaku |
| --- | --- | --- | --- |
| Host key SSH (sha256), maksimal 2 per OLT (kartu kontrol aktif dan standby) | `hostVerifier` saat handshake | Kuat | Setelah SSH aktif |
| Engine ID SNMPv3 dan respons terautentikasi (authPriv) | GET `snmpEngineID` (1.3.6.1.6.3.10.2.1.1.0) tiap siklus status | Kuat: penyamar tanpa kunci tidak bisa memberi respons yang sah | Setelah SNMPv3 aktif |
| sysName dan sysObjectID | GET tiap siklus | Lemah, hanya pemeriksaan konsistensi | v2c sementara |

1. Registrasi (admin dari LAN, atau NOC): OLT dibuat berstatus `pending_pin`, lalu job `identity.probe` mengambil kandidat. Host key diambil lewat handshake yang diputus sebelum autentikasi. Engine ID dibaca lewat GET terautentikasi; ini aman karena passphrase acak ≥ 24 karakter tidak bisa ditebak dari satu respons.
2. Pin (admin dari LAN, atau NOC): pengguna membandingkan kandidat dengan konsol OLT bila firmware menampilkannya, lalu mem-pin, dan audit tercatat. Sebelum di-pin, OLT tidak dipolling. Pin hanya menambah jenis identitas yang belum pernah di-pin, mis. host key setelah CLI diaktifkan pada OLT yang SNMP-nya sudah di-pin. Kandidat yang berbeda dari nilai yang sudah di-pin ditolak (409), karena itu perubahan identitas (langkah 4–5).
   Probe ulang pada OLT yang sudah di-pin hanya mengonfirmasi nilai yang cocok, tanpa membuat kandidat baru. Bila nilainya berbeda, probe berhenti dan OLT dikarantina (langkah 4); SSH tidak dihubungi bila engine ID sudah berbeda.
3. Verifikasi: dilakukan di setiap siklus SNMP dan setiap sesi CLI. Timeout berarti OLT tak terjangkau, bukan ketidakcocokan.
4. Tidak cocok: OLT menjadi `quarantined`, semua job OLT itu berhenti dan job yang sedang berjalan dibatalkan. `security_event` dan alarm dibuat, Telegram dikirim, dan ONU-nya tampil "tidak diketahui".
5. Menerima perubahan (admin, LAN): alasan wajib dan konfirmasi ulang dengan mengetik nama OLT. Nilai lama menjadi `retired`, nilai baru `pinned`, dan audit tercatat.
6. Jendela pemeliharaan (admin, LAN): selama jendela aktif, perubahan dicatat sebagai kandidat lalu diterima otomatis dengan audit, sesuai brief.

Menghapus OLT (admin dari LAN, atau NOC; keputusan pemilik repo 11 Nov 2026): berlaku untuk OLT dengan status apa pun, dalam satu langkah dengan mengetik ulang nama OLT. Semua yang disimpan aplikasi untuk OLT itu ikut terhapus permanen: ONU beserta riwayat status, event, dan metrik, alarm, `poll_run`, job, allowlist, serta identitas yang di-pin. Yang tersisa hanya audit log dan `security_event` (tanpa `olt_id`). Tidak ada perintah yang dikirim ke OLT. Antrian OLT dibuang lebih dulu; bila ada job yang sedang berjalan, penghapusan ditolak (409) dan bisa diulang. Worker membuang ulang scheduler OLT yang sudah terhapus pada reconcile berikutnya. Audit `olt.deleted` mencatat nama, IP, status, jumlah ONU, alarm, dan job, serta identitas yang di-pin, supaya pendaftaran ulang bisa dibandingkan. OLT yang dikarantina atau masih punya alarm `olt_identity_mismatch` aktif (mis. dinonaktifkan saat karantina) hanya bisa dihapus admin, karena hapus lalu daftar ulang sama dengan menerima perubahan identitas (aturan keras 7).

Tingkat identitas di UI:

- "kuat": SNMPv3 sudah di-pin, dan host key juga sudah di-pin bila CLI aktif
- "lemah": SNMP v2c
- "belum di-pin"

### 8.5 Fase 2

Sejak 13 Nov 2026 Fase 2 dibuka untuk semua OLT asli (keputusan pemilik repo, `CLAUDE.md` aturan 3). Setiap perubahan ke OLT hanya lewat template di builder `olt-spec`; template baru ditambahkan atas keputusan pemilik repo dan dicatat di tabel ini.

| Template | Job | Siapa | Keputusan |
| --- | --- | --- | --- |
| Registrasi ONU mode `default` (internet, panduan Bab IV-A), diikuti `write` setelah verifikasi | `onu_register` | A; T dengan persetujuan N | 13 Nov 2026 (OLT asli); diberi nama `default` 14 Nov 2026 |
| Registrasi ONU mode `bridge` (konfigurasi lapangan), diikuti `write` setelah verifikasi | `onu_register` | A; T dengan persetujuan N | 14 Nov 2026 (OLT asli); baris remote-id `vport 2` dihapus 17 Nov 2026 |
| Registrasi ONU mode `pppoe_map` ("PPPoE MAP", konfigurasi PPPoE lapangan), diikuti `write` setelah verifikasi | `onu_register` | A; T dengan persetujuan N | 15 Nov 2026 (OLT asli) |
| Registrasi ONU mode `bridge_static` ("Bridge Static", layanan static dan bridging lapangan), diikuti `write` setelah verifikasi | `onu_register` | A; T dengan persetujuan N | 17 Nov 2026 (OLT asli) |
| `write` (simpan running-config) | `config_save` | A | 13 Nov 2026 (OLT asli) |

Status job mengikuti technical brief, dengan tambahan berikut:

- `preview`: `api` merender perintah dengan builder `olt-spec`, memilih ID ONU kosong berikutnya dari data terakhir, lalu menyimpan `preview` dan `preview_sha256`.
- `confirmed`: hanya oleh admin, atau oleh teknisi untuk `onu_register` miliknya. Body harus membawa `previewSha256` yang sama.
- `running`: `worker` memeriksa guard tulis, memverifikasi identitas, memvalidasi ulang parameter dengan Zod, dan merender ulang perintah (hash harus sama). Sebelum perintah pertama, `worker` memastikan ID ONU masih kosong; bila tidak, job `failed` dengan pesan "buat preview ulang".
- Gagal di tengah: berhenti di perintah pertama yang error, tanpa rollback otomatis karena `no onu` termasuk perintah destruktif. Perintah yang sudah terkirim disimpan di `applied_commands`.
- `verifying`: output `showOnuState`, `showOnuRunningConfig`, dan `showOnuMngConfig` harus memuat baris yang diharapkan. Snapshot sebelum dan sesudah disimpan.
- `write` otomatis: bila verifikasi berhasil, `worker` menjalankan `write` di sesi yang sama. Preview menampilkannya sebagai baris terakhir sehingga ikut ter-hash. Sukses bila output memuat `[OK]`; job ini dan registrasi sebelumnya yang belum tersimpan lalu dicatat tersimpan (`saved_by_job_id`). Bila `write` gagal, job tetap `succeeded` dengan peringatan dan muncul di panel perubahan belum disimpan.
- Perubahan belum disimpan: job `succeeded` tanpa `saved_by_job_id` tampil di panel OLT, lengkap dengan aktor, waktu, perintah, dan before/after. Panel itu juga memperingatkan bahwa `write` menyimpan seluruh running-config, termasuk perubahan di luar aplikasi. Admin (LAN) menjalankan `config.save`, yang dianggap sukses bila output memuat `[OK]`.

Template Bab IV-A (panduan hlm. 12–14). Baris `name` ditambahkan dari contoh lapangan di hlm. 20 karena aturan riwayat ONU bergantung pada nama.

```
configure terminal
interface gpon-olt_1/{slot}/{port}
onu {onuId} type {onuType} sn {sn}
exit
interface gpon-onu_1/{slot}/{port}:{onuId}
name {name}
tcont 1 name T1 profile {tcontProfile}
gemport 1 name gemport1 unicast tcont 1
service-port 1 vport 1 user-vlan {vlan} vlan {vlan}
exit
pon-onu-mng gpon-onu_1/{slot}/{port}:{onuId}
service HSI type internet gemport 1 cos 0 vlan {vlan}
vlan port eth_0/1 mode tag vlan {vlan} priority 0
end
write
```

Baris `write` baru dijalankan setelah verifikasi berhasil.

Template di atas adalah mode `default`. Mode dipilih di form registrasi (`mode`), dan form memilih `default` di awal. Job tanpa `mode` dianggap `default`, sehingga preview dan hash-nya tidak berubah.

Template mode `bridge` mengikuti konfigurasi lapangan pemilik repo (14 Nov 2026). Baris `description` hanya dikirim bila deskripsi diisi. Baris `vlan port` dibuat untuk `eth_0/1` sampai `eth_0/{lanPorts}`. Baris `port-identification sub-option remote-id enable vport 2` dihapus dari template ini pada 17 Nov 2026 (keputusan pemilik repo) karena hanya mode `bridge_static` yang memakai vport 2. Job `bridge` yang preview-nya dibuat sebelum perubahan itu ditolak `worker` karena hash tidak cocok, sehingga preview harus dibuat ulang.

```
configure terminal
interface gpon-olt_1/{slot}/{port}
onu {onuId} type {onuType} sn {sn}
exit
interface gpon-onu_1/{slot}/{port}:{onuId}
name {name}
description {description}
sn-bind enable sn
tcont 1 profile {tcontProfile}
gemport 1 name bridging tcont 1
service-port 1 vport 1 user-vlan {vlan} vlan {vlan}
port-identification sub-option remote-id enable vport 1
exit
pon-onu-mng gpon-onu_1/{slot}/{port}:{onuId}
service bridging gemport 1 vlan {vlan}
switchport-bind switch_0/1 veip 1
vlan port eth_0/{1..lanPorts} mode tag vlan {vlan}
end
write
```

Verifikasi mode `bridge` juga memeriksa:

- baris `description`, bila diisi
- `service bridging gemport 1 vlan {vlan}`
- setiap baris `vlan port`

Baris yang tidak ditemukan dicatat di hasil job sebagai `missing`. OLT menolak `vlan port` untuk port LAN yang tidak dimiliki ONU. Job berhenti di baris itu, tanpa rollback dan tanpa `write`, sehingga jumlah port LAN harus sesuai tipe ONU.

Template mode `pppoe_map` (label "PPPoE MAP") mengikuti konfigurasi PPPoE lapangan pemilik repo (15 Nov 2026). Nama `AUD` untuk gemport dan service bersifat tetap. Begitu pula `vlan-profile PPPoE`, yang harus sudah ada di OLT sebagai prasyarat, sama seperti profil T-CONT. Baris `description` hanya dikirim bila deskripsi diisi.

```
configure terminal
interface gpon-olt_1/{slot}/{port}
onu {onuId} type {onuType} sn {sn}
exit
interface gpon-onu_1/{slot}/{port}:{onuId}
name {name}
description {description}
sn-bind enable sn
tcont 1 profile {tcontProfile}
gemport 1 name AUD tcont 1
service-port 1 vport 1 user-vlan {vlan} vlan {vlan}
pppoe-intermediate-agent enable sport 1
exit
pon-onu-mng gpon-onu_1/{slot}/{port}:{onuId}
service AUD gemport 1 vlan {vlan}
wan-ip 1 mode pppoe username {pppoeUsername} password {pppoePassword} vlan-profile PPPoE host 1
wan-ip 1 ping-response enable traceroute-response enable
security-mgmt 1 state enable mode forward protocol web
end
write
```

Verifikasi mode `pppoe_map` juga memeriksa:

- baris `description`, bila diisi
- `service AUD gemport 1 vlan {vlan}`
- `wan-ip 1 mode pppoe username {pppoeUsername}`; cara OLT menampilkan password tidak ikut diperiksa

Template mode `bridge_static` (label "Bridge Static") mengikuti konfigurasi lapangan pemilik repo (17 Nov 2026). Satu ONU membawa dua layanan:

- `static` di T-CONT 1, gemport `AUD`, dan vport 1 dengan `{vlan}` serta profil `{tcontProfile}`
- `bridging` di T-CONT 2, gemport `bridging`, dan vport 2 dengan `{bridgeVlan}` serta profil `{bridgeTcontProfile}`; VLAN ini yang di-tag ke port LAN

Nama `AUD`, `static`, dan `bridging` bersifat tetap. Kedua profil T-CONT dipilih terpisah dan harus ada di daftar profil OLT itu; kedua VLAN harus ada di daftar VLAN OLT itu dan wajib berbeda (keputusan pemilik repo 17 Nov 2026). Baris `description` hanya dikirim bila deskripsi diisi. Baris `vlan port` dibuat untuk `eth_0/1` sampai `eth_0/{lanPorts}`. Hanya template ini yang mengirim `port-identification sub-option remote-id enable vport 2`.

```
configure terminal
interface gpon-olt_1/{slot}/{port}
onu {onuId} type {onuType} sn {sn}
exit
interface gpon-onu_1/{slot}/{port}:{onuId}
name {name}
description {description}
sn-bind enable sn
tcont 1 profile {tcontProfile}
tcont 2 profile {bridgeTcontProfile}
gemport 1 name AUD tcont 1
gemport 2 name bridging tcont 2
service-port 1 vport 1 user-vlan {vlan} vlan {vlan}
service-port 2 vport 2 user-vlan {bridgeVlan} vlan {bridgeVlan}
port-identification sub-option remote-id enable vport 1
port-identification sub-option remote-id enable vport 2
exit
pon-onu-mng gpon-onu_1/{slot}/{port}:{onuId}
service static gemport 1 vlan {vlan}
service bridging gemport 2 vlan {bridgeVlan}
switchport-bind switch_0/1 veip 1
vlan port eth_0/{1..lanPorts} mode tag vlan {bridgeVlan}
end
write
```

Verifikasi mode `bridge_static` juga memeriksa:

- baris `description`, bila diisi
- `user-vlan {bridgeVlan} vlan {bridgeVlan}` di running-config ONU
- `service static gemport 1 vlan {vlan}` dan `service bridging gemport 2 vlan {bridgeVlan}`
- setiap baris `vlan port`

Seperti mode `bridge`, port LAN yang tidak dimiliki ONU menghentikan job di baris itu, tanpa rollback dan tanpa `write`.

Password PPPoE adalah parameter biasa (keputusan pemilik repo 15 Nov 2026). Isinya tersimpan dan tampil apa adanya, tanpa enkripsi, di:

- `params` dan preview job, termasuk halaman job dan antrean persetujuan
- audit log `job.preview`
- `applied_commands`
- transcript dan snapshot output `show onu running config`

Lihat §12.

Langkah yang berlaku untuk seluruh OLT (membuat `onu-type`, profil T-CONT, dan VLAN uplink) adalah prasyarat, bukan bagian template. Tipe ONU diketik di form; isi `provision_allowlist` jenis `onu_type` hanya menjadi saran, dan OLT sendiri menolak tipe yang tidak dikenal (job berhenti di perintah itu, tanpa `write`). VLAN dan profil T-CONT dipilih dari daftar OLT itu (`provision_allowlist` jenis `vlan` dan `tcont_profile`), yang ditambah NOC atau admin; daftar itu hanya ada di aplikasi dan tidak mengubah OLT (keputusan pemilik repo 13 Nov 2026). NOC atau admin juga bisa mengambil kedua daftar dari OLT dengan satu tombol (`cli.list-sync`, hanya perintah baca). Nilai yang ditemukan ditambahkan tanpa menghapus yang sudah ada. Keluaran yang tidak bisa di-parse, misalnya jumlah VLAN tidak cocok dengan angka yang diumumkan, tidak disimpan; daftar lain tetap disimpan.

| Parameter | Validasi |
| --- | --- |
| `slot`, `port` | Harus ada di `pon_port` milik OLT itu |
| `onuId` | Bilangan 1–128 dan masih kosong |
| `sn` | `^[A-Za-z0-9]{4}[0-9A-Fa-f]{8}$`, disimpan dalam huruf besar |
| `name` | `^[A-Za-z0-9._-]{1,32}$` |
| `onuType` | `^[A-Za-z0-9._-]{1,32}$`, diketik di form |
| `tcontProfile` | `^[A-Za-z0-9._-]{1,32}$` dan ada di daftar profil T-CONT OLT itu |
| `vlan` | Bilangan 1–4094 dan ada di daftar VLAN OLT itu |
| `mode` | `default`, `bridge`, `pppoe_map`, atau `bridge_static`; tanpa nilai berarti `default` |
| `description` | Hanya mode `bridge`, `pppoe_map`, dan `bridge_static`, opsional; `^[A-Za-z0-9._-]{1,32}$`, tanpa spasi seperti `name` (keputusan pemilik repo 14 Nov 2026) |
| `lanPorts` | Hanya mode `bridge` dan `bridge_static`, wajib; bilangan 1–4 |
| `bridgeTcontProfile` | Hanya mode `bridge_static`, wajib; aturan sama dengan `tcontProfile` dan ada di daftar profil T-CONT OLT itu (keputusan pemilik repo 17 Nov 2026) |
| `bridgeVlan` | Hanya mode `bridge_static`, wajib; bilangan 1–4094, ada di daftar VLAN OLT itu, dan berbeda dari `vlan` (keputusan pemilik repo 17 Nov 2026) |
| `pppoeUsername` | Hanya mode `pppoe_map`, wajib; `^[A-Za-z0-9._@-]{1,64}$` (keputusan pemilik repo 15 Nov 2026) |
| `pppoePassword` | Hanya mode `pppoe_map`, wajib; `^[A-Za-z0-9._@-]{1,32}$`; spasi, `?`, tanda kutip, dan simbol lain ditolak |

Sebagai pertahanan berlapis, builder juga menolak hasil akhir yang memuat CR, LF, atau karakter kontrol.

Guard tulis, ketiganya wajib:

1. `api` hanya menerima job tulis untuk OLT berstatus `ok` dengan CLI aktif.
2. `worker` hanya menghubungi alamat di `OLT_TARGET_CIDRS`, lalu memverifikasi identitas (SNMP, kemudian host key saat handshake) sebelum kredensial dikirim.
3. `OltCliSession.run` menolak perintah `kind: 'write'` kecuali sesi dibuka dengan mode `write`.

### 8.6 Auth, sesi, dan peran

| Aksi | Admin (LAN) | NOC | Teknisi |
| --- | --- | --- | --- |
| Lihat dashboard, OLT, ONU, alarm; refresh detail ONU | Ya | Ya | Ya |
| Ack alarm | Ya | Ya | — |
| Tambah OLT, probe, pin identitas, hapus OLT (kecuali yang identitasnya belum diterima) | Ya | Ya | — |
| Ubah kredensial OLT, terima perubahan identitas (karantina), hapus OLT dengan perubahan identitas yang belum diterima, jendela pemeliharaan | Ya | — | — |
| Fase 2: susun registrasi ONU | Ya, langsung jalan | — | Ya, diajukan untuk persetujuan |
| Fase 2: setujui atau tolak registrasi teknisi | Ya | Ya | — |
| Fase 2: `write` dan job lain | Ya | — | — |
| Ganti password akun NOC dan teknisi, lihat audit log | Ya | — | — |

Keputusan pemilik repo 10 dan 11 Nov 2026: NOC boleh menambah, mem-pin, dan menghapus OLT tanpa batasan LAN. Akibatnya titik kepercayaan pin juga bisa dipakai dari internet; menerima perubahan identitas tetap admin dari LAN. Registrasi teknisi berjalan `preview` → `pending_approval` → `confirmed` (disetujui) atau `rejected`. Penyetuju mengirim hash preview yang ia lihat, dan tidak ada yang bisa menyetujui job miliknya sendiri. Password admin hanya bisa diganti pemiliknya.

- Password memakai Argon2id. Login dibatasi per IP dan per username (lewat Redis), dengan respons 429.
- User dibuat lewat seed dari `SEED_*`. Bila `SEED_ADMIN_PASSWORD` kosong, admin baru (atau admin yang di-reset dengan `SEED_RESET_PASSWORDS=1`) memakai password default `DataUtama*26` (keputusan pemilik repo 11 Nov 2026), tanpa wajib ganti. Setiap pengguna mengganti password sendiri lewat halaman **Ganti password** (minimal 12 karakter); admin mengganti password NOC dan teknisi lewat halaman **Pengguna**.
- Sesi disimpan di server (tabel `session`), dengan cookie `httpOnly`, `Secure`, dan `SameSite=Strict`. Batasnya idle 30 menit dan maksimal 12 jam, dan semua sesi dicabut saat password berubah. Request yang mengubah data juga memeriksa header `Origin`.
- `AdminLanGuard` berjalan di setiap request berperan admin, termasuk login: IP klien harus ada di `ADMIN_ALLOWED_CIDRS`. Bila tidak, respons 403, sesi admin dicabut, dan `admin_offlan_denied` tercatat. IP klien diambil dari `X-Forwarded-For` yang diset `caddy`. `api` mempercayai tepat satu hop proxy dan hanya bisa dijangkau lewat `caddy`.
- RBAC default-deny di `api`, sesuai brief.

## 9. Keamanan dan deployment

Kontrol dasar di technical brief tetap berlaku, kecuali "UI hanya lewat VPN atau allowlist IP", yang diganti keputusan akses internet. Tambahan untuk akses internet:

- `caddy` memakai sertifikat Let's Encrypt untuk `PUBLIC_DOMAIN` dan mengirim HSTS, CSP ketat (`default-src 'self'`, dicek di build produksi), `X-Content-Type-Options`, `Referrer-Policy`, serta `frame-ancestors 'none'`. Klien tidak bisa memalsukan `X-Forwarded-For`, karena secara default (sejak v2.5) `caddy` tidak mempercayai header itu dari klien.
- Router kantor meneruskan 443 dengan DNAT saja. Bila router melakukan SNAT atau masquerade, semua klien internet tampak berasal dari IP LAN dan pembatasan admin tidak berlaku. Ini diverifikasi di §14.
- Kredensial OLT memakai enkripsi amplop (§2.2 nomor 1). Private key hanya di-mount sebagai Docker secret ke `worker`.
- Container berjalan non-root, `read_only`, `cap_drop: ALL`, `no-new-privileges`, dengan image yang dipin ke digest. Supaya `caddy` dan `worker` bisa bind port di bawah 1024 tanpa root, pakai sysctl `net.ipv4.ip_unprivileged_port_start=0` di kedua container itu.
- Profil compose: tanpa profil untuk produksi, `dev` (semua layanan + `mock-olt`, dengan `tls internal`), dan `demo` (produksi + `mock-olt`). Setelah demo, profil `demo` dimatikan dan OLT mock dinonaktifkan.
- Rahasia disimpan di `deploy/env.sops.yaml` (sops + age).
- Kontrol rantai pasok mengikuti brief.

## 10. Prasyarat OLT asli dan go-live

Daftar ini diminta ke pembimbing lapangan atau dikerjakan sendiri. Claude tidak menyentuh OLT asli.

- [ ] User SNMPv3 read-only (authPriv, SHA dan AES; DES/`des56` hanya bila firmware tidak mendukung AES, passphrase acak ≥ 24 karakter) dengan view terbatas pada subtree yang dipakai. ACL SNMP hanya mengizinkan IP VPS dan LibreNMS.
- [ ] Izin tertulis untuk memakai community v2c ro yang sudah ada sampai SNMPv3 aktif.
- [ ] Aktivasi SSH dan akun CLI khusus aplikasi berhak rendah. Pastikan akun itu bisa menjalankan semua perintah di §6.2, dan ACL SSH hanya mengizinkan VPS dan IP admin.
- [ ] Cek community rw yang aktif (panduan hlm. 11 mencontohkan `public ... rw`), lalu cabut atau batasi bila ada.
- [ ] Catat batas sesi VTY, idle timeout, dan format pesan saat sesi penuh.
- [ ] Rekaman golden, kamu kerjakan di jam sepi:
  - `snmpbulkwalk` subtree ZTE (`1.3.6.1.4.1.3902`).
  - Pada waktu yang sama, output `show card` dan `show gpon onu state` untuk satu port.
  - Output `show pon power attenuation` dan `show gpon onu detail-info` untuk 3 ONU: satu working, satu offline, dan satu dengan Rx rendah bila ada.
  - Redaksi nama pelanggan, lalu taruh di `apps/mock-olt/fixtures/`.
  - Bila LibreNMS kantor menyimpan MIB ZTE, salin juga sebagai bahan pemetaan.
- [ ] Cara menampilkan engine ID dan fingerprint host key di konsol OLT, untuk pin awal.
- [ ] Domain, DNS, port forward 443 tanpa SNAT, dan IP publik statis atau DDNS.
- [ ] Bot Telegram dan chat ID grup NOC.
- [ ] (Ditunda) Trap host ke IP VPS dengan community khusus, tanpa mengganti trap host LibreNMS.
- [ ] (Go-live) Backup `pg_dump` terenkripsi ke luar VPS, dengan uji restore.
- [ ] (Sebelum Fase 2 ke OLT asli) Ganti template agar mengikuti konfigurasi lapangan, tinjau ulang MFA atau eksekusi khusus LAN untuk teknisi, lalu uji di ONU cadangan pada port non-kritis.

## 11. Di luar lingkup

- Konfigurasi fisik dan sistem OLT: rack, shelf, kartu, IP manajemen, VLAN uplink, `snmp-server`, `username`, SSH, serta pembuatan `onu-type` dan profil T-CONT.
- Perintah tulis apa pun ke OLT asli selama KP, SNMP SET, endpoint perintah bebas, dan rollback otomatis.
- Telnet; netwatch, pemantauan ARP, dan ARP statis.
- Multicast dan VoIP; reboot ONU, lock port ONU, dan `restore factory`; daftar ONU belum terdaftar (backlog di brief).
- Billing dan CRM, perangkat selain ZTE C320, high availability, dan modul prediksi TA.
- VPN dan MFA (risiko diterima).
- Ditunda sampai setelah demo, bukan dihapus: penerima trap, trafik per ONU, metrik OLT, halaman kelola user dan audit, rollup per jam, dan backup.

## 12. Risiko yang diterima dan pertanyaan terbuka

| Risiko | Keputusan | Kapan ditinjau ulang |
| --- | --- | --- |
| UI publik tanpa VPN dan MFA; NOC dan teknisi masuk hanya dengan password | Diterima. Mitigasi: sesi pendek, rate limit, admin hanya dari LAN, `api` tanpa private key | Sebelum Fase 2 ke OLT asli |
| NOC dan teknisi memakai Fase 2 dari internet ke OLT asli (NOC menyetujui registrasi teknisi) | Diterima (keputusan 13 Nov 2026): template, preview ber-hash, persetujuan, dan audit | Ditinjau berkala |
| NOC bisa mem-pin identitas OLT dari internet | Diterima (keputusan 10 Nov 2026); akun NOC yang diambil alih bisa mem-pin OLT palsu | Sebelum go-live |
| Password default admin (`DataUtama*26`) tertulis di repo dan tidak wajib diganti | Diterima (keputusan 11 Nov 2026); admin hanya bisa login dari LAN kantor | Sebelum go-live |
| NOC bisa menghapus OLT beserta seluruh riwayatnya dari internet | Diterima (keputusan 11 Nov 2026); konfirmasi nama OLT dan audit log, tanpa backup sampai go-live | Go-live (backup) |
| SNMPv3 dengan privacy DES (`des56`) bila firmware tidak mendukung AES; worker berjalan dengan `--openssl-legacy-provider` | Diterima per OLT, ditandai "enkripsi lemah" di form | Saat firmware mendukung AES |
| SNMP v2c sementara: community terkirim tanpa enkripsi dan identitas lemah | Diterima sampai SNMPv3 aktif | Saat SNMPv3 aktif |
| OID dan firmware belum terverifikasi | Bagian OLT asli di demo bisa gagal; mock tetap jalan | Setelah golden test |
| Belum ada backup | Diterima sampai demo | Go-live |
| `mock-olt` berjalan di VPS produksi saat demo | Dilabeli jelas dan hanya di jaringan internal | Setelah demo |
| Jadwal ±40 jam, sedangkan estimasi brief untuk lingkup ini 44–56 jam | Ikuti urutan tunda di §3 | Tiap akhir hari |
| Template Bab IV berbeda dari konfigurasi lapangan | Dicocokkan dengan konfigurasi ONU di OLT asli sebelum diaktifkan | Sebelum registrasi pertama ke OLT asli |
| Password PPPoE pelanggan (mode `pppoe_map`) tersimpan tanpa enkripsi di job, audit log, dan snapshot, dan bisa dibaca siapa pun yang membuka job atau antrean persetujuan | Diterima (keputusan 15 Nov 2026) agar NOC bisa memeriksa perintah lengkap; aturan 5 hanya berlaku untuk kredensial OLT | Sebelum go-live |

Pertanyaan yang belum terjawab:

- Versi firmware dan profil OID yang cocok (akan dijawab golden test).
- Algoritma SSH yang didukung firmware; mungkin ssh2 perlu kex atau cipher lama.
- Apakah akun CLI berhak rendah perlu `enable` untuk menjalankan perintah `show` di §6.2.
- Batas sesi VTY, idle timeout, dan pesan error saat sesi penuh.
- Jam OLT: zona waktu dan NTP (`show clock`), serta nilai `APP_TIMEZONE`.
- Apakah SNMP menyediakan counter trafik per ONU.
- Nama domain dan IP publik kantor.

## 13. Rencana kerja

Estimasi diambil dari technical brief.

| Urutan | Paket | Isi | Estimasi (jam) | Boleh ditunda |
| --- | --- | --- | --- | --- |
| 0 | Prasyarat | §10, kamu kerjakan paralel | — | Tidak; jalur kritis OLT asli |
| 1 | WP1 | Monorepo pnpm, compose dengan profil, Caddyfile, CI untuk lint, typecheck, dan test | 3–4 | — |
| 2 | WP3 | `olt-spec`, `OltSnmpClient`, `OltCliSession`, `mock-olt` dan skenario | 6–8 | — |
| 3 | WP2 | Prisma, sesi, RBAC, `AdminLanGuard`, audit, seed admin | 5–6 | Halaman user dan audit |
| 4 | WP4 | Scheduler, poller, mesin alarm, outbox Telegram, realtime | 4–5 | Rollup, trafik, metrik OLT |
| 5 | WP7 | Identitas, karantina, jendela pemeliharaan | 3–4 | — |
| 6 | WP6 | UI | 8–10 | Polesan, grafik lanjutan |
| 7 | WP8 | Fase 2 di mock sampai `write` | 8–10 | Turun ke mode generator perintah |
| 8 | WP9 | Hardening untuk akses internet | 3–4 | Backup |
| 9 | — | Menyambungkan OLT asli setelah golden test lulus | ±2 | — |
| 10 | WP10 | Gladi demo dan dokumentasi | 2–3 | — |
| — | WP5 | Penerima trap | 2–3 | Ya |

## 14. Verifikasi end-to-end

Skrip `pnpm` dan perintah skenario di bawah dibuat di WP1 dan WP3, lalu dicatat di `CLAUDE.md` setelah scaffolding.

### A. Otomatis, tiap commit

1. Lint, typecheck, dan unit test hijau. Unit test mencakup:
   - parser terhadap fixture dari panduan dan rekaman
   - builder dan Zod, termasuk property test fast-check bahwa tidak ada hasil yang memuat CR, LF, atau karakter kontrol
   - aturan alarm dengan clock palsu
   - verifikator identitas
   - guard peran dan LAN
   - enkripsi amplop bolak-balik
2. Golden test: untuk setiap rekaman, nilai yang didekode profil OID sama dengan hasil parser CLI dari rekaman yang sama. Status harus sama, dan selisih Rx ≤ 0,5 dB.
3. Integration test (Testcontainers + `mock-olt`) dan E2E Playwright hijau.

### B. Skenario lengkap di profil `demo` dengan mock

1. `docker compose --profile demo up -d`: semua container sehat dan `GET /api/health` mengembalikan 200.
2. Seed admin, login dari LAN, lalu daftarkan `mock-1` sampai `mock-3` (SNMPv3 dan SSH). Kandidat identitas muncul, lalu admin mem-pin.
3. Dalam 2 menit, dashboard menampilkan ±210 ONU, usia data status < 2 menit, dan Rx sesuai fixture.
4. `scenario onu-los`: alarm `onu_los` muncul di UI dalam ≤ 2 menit, tanpa pesan Telegram.
5. `scenario onu-dying-gasp`: status berubah dan alarm `onu_dying_gasp` muncul, tanpa pesan Telegram.
6. `scenario los-mass` (5 ONU di satu port): satu `pon_mass_los` dan satu pesan Telegram, dengan alarm per ONU tergabung di bawahnya. `scenario reset`: alarm selesai dan pesan pulih terkirim.
7. `scenario dying-gasp-mass`: `pon_mass_power` dengan teks "kemungkinan listrik padam", plus pesan Telegram.
8. `scenario flap` (3 kali, dengan profil waktu cepat): `onu_flapping` dan pesan Telegram. Setelah ONU stabil, alarm selesai dan pesan selesai terkirim.
9. `scenario rx-degrade`: −26 dBm memicu waspada, −27,5 dBm memicu kritis, −25,5 dBm membuat alarm tetap aktif (histeresis), dan −23,9 dBm menyelesaikan alarm.
10. `scenario olt-down`: setelah 2 siklus muncul `olt_unreachable` dan pesan Telegram. ONU tampil "tidak diketahui", tanpa alarm per ONU. `scenario olt-up`: satu pesan pulih, tanpa banjir pesan.
11. `scenario vty-full`, lalu klik refresh detail ONU: job di-retry, lalu gagal dengan `cli_unavailable`. Log mock tidak menunjukkan sesi lain yang diputus.
12. `scenario hostkey-rotate`, lalu klik refresh detail ONU:
    - Koneksi diputus sebelum autentikasi; log mock mencatat 0 percobaan autentikasi.
    - OLT menjadi `quarantined` dan pesan Telegram keamanan terkirim.
    - Log agent SNMP mock tidak menerima request lagi.
    - Admin dari LAN menerima perubahan dengan alasan; polling berjalan lagi dan audit tercatat.
13. `scenario engineid-change`: hasilnya sama, untuk SNMPv3.
14. OLT mock yang didaftarkan dengan v2c menampilkan lencana "identitas lemah".
15. Fase 2:
    - Teknisi menyusun registrasi ONU, preview menampilkan perintahnya, lalu teknisi mengonfirmasi.
    - Log mock menerima perintah yang persis sama, dan verifikasi sukses.
    - Panel "Perubahan belum disimpan" menampilkan before/after.
    - Admin dari LAN menjalankan `write`; mock mencatat `write` dan panel menjadi kosong.
16. Guard: job tulis untuk OLT yang belum `ok` atau CLI-nya nonaktif ditolak `api`; job untuk alamat di luar `OLT_TARGET_CIDRS` gagal di `worker` tanpa koneksi.
17. Injeksi: SN berisi `\r\nreboot` dan nama berisi `;` atau baris baru ditolak di `api` dan di `worker`.
18. Teknisi yang mengonfirmasi job orang lain atau job selain registrasi mendapat 403.
19. Kredensial mock tidak ditemukan di `docker compose logs`, isi `job.result`, maupun respons `GET /olts/:id`.

### C. Akses internet, di VPS setelah domain siap

1. Dari HP lewat data seluler: sertifikat valid, login NOC dan teknisi berhasil, dan login admin ditolak. Memakai cookie sesi admin dari HP menghasilkan 403 dan `admin_offlan_denied`.
2. Log `api` untuk request dari HP menunjukkan IP publik HP, bukan IP router (bukti tidak ada SNAT).
3. `curl -sI https://<domain>` menampilkan HSTS, CSP, dan header lain di §9.
4. Diam 30 menit membuat sesi berakhir, dan ganti password mencabut sesi di perangkat lain.
5. Login gagal berulang dari satu IP menghasilkan 429.
6. Scan port dari luar: hanya 443 (dan 80 bila dipakai) yang terbuka; `api`, `postgres`, `redis`, dan `mock-olt` tidak terjangkau.

### D. OLT asli read-only, setelah akses diberikan

1. Golden test lulus untuk rekaman OLT itu, dan profilnya ditandai `verified`.
2. Daftarkan OLT dengan SNMPv3, atau dengan v2c dan lencana lemah. Engine ID dicocokkan dengan konsol sebelum di-pin.
3. Untuk 3 ONU, tampilan UI cocok dengan output CLI yang kamu ambil manual: status sama dan selisih Rx ≤ 0,5 dB.
4. Selama 1 jam: tidak ada celah di `poll_run`, usia data status ≤ 2 menit, usia data optik ≤ 10 menit, dan CPU OLT di LibreNMS tidak naik berarti.
5. Tombol provisioning tidak muncul untuk OLT asli, dan `POST /jobs` untuk OLT itu ditolak.
6. Bila SSH sudah aktif: pin host key, lalu refresh detail satu ONU sampai riwayat offline tampil. Setelah job selesai, cek manual bahwa sesi aplikasi tidak tersisa di daftar user OLT.

### E. Gladi demo

Alur cerita demo:

1. Dashboard OLT asli dan detail ONU.
2. LOS massal di mock.
3. Flapping.
4. OLT down.
5. Host key berubah: karantina, lalu perubahan diterima admin.
6. Fase 2 sampai `write`.
7. Audit log.

Jalankan gladi penuh sekali sehari sebelum demo, termasuk `scenario reset` di antara bagian.
