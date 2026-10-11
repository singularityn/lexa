/**
 * Keadaan kecil yang dibagi antar-eksekusi Worker, disimpan di tabel `sync_state` (kunci -> teks).
 * Tiga hal ditangani di sini: nilai biasa, jeda pasal.id (supaya semua eksekusi mematuhi satu jendela batas laju),
 * dan kunci pinjaman (lease) agar dua eksekusi Cron yang tumpang tindih tidak mengerjakan hal yang sama.
 */

export async function bacaState(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare(`SELECT value FROM sync_state WHERE key = ?`).bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function tulisState(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value)
    .run();
}

const KUNCI_JEDA_PASAL = "pasal_tunda_sampai";

/** Batas bawah dan atas jeda setelah kena batas laju: kurang dari semenit percuma, lebih dari sejam menahan terlalu lama. */
const JEDA_MIN_MS = 60_000;
const JEDA_MAKS_MS = 3_600_000;

/** Sampai kapan pasal.id tidak boleh dihubungi (ISO), atau null bila boleh sekarang. */
export async function jedaPasalSampai(db: D1Database, sekarang = Date.now()): Promise<string | null> {
  const nilai = await bacaState(db, KUNCI_JEDA_PASAL);
  return nilai && nilai > new Date(sekarang).toISOString() ? nilai : null;
}

/**
 * Larang menghubungi pasal.id selama `ms` (dijepit 1-60 menit). Jeda yang sudah lebih panjang tidak dipendekkan:
 * dua eksekusi yang sama-sama kena 429 tidak boleh saling membatalkan.
 */
export async function tundaPasal(db: D1Database, ms: number, sekarang = Date.now()): Promise<string> {
  const jeda = Math.min(Math.max(Number.isFinite(ms) ? ms : JEDA_MIN_MS, JEDA_MIN_MS), JEDA_MAKS_MS);
  const sampai = new Date(sekarang + jeda).toISOString();
  await db
    .prepare(
      `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
           WHERE sync_state.value < excluded.value`,
    )
    .bind(KUNCI_JEDA_PASAL, sampai)
    .run();
  return (await bacaState(db, KUNCI_JEDA_PASAL)) ?? sampai;
}

/**
 * Ambil kunci pinjaman `nama` selama `detik`. Berhasil hanya bila belum ada yang memegangnya atau pinjaman
 * sebelumnya sudah kedaluwarsa (eksekusi yang mati di tengah jalan tidak boleh mengunci selamanya).
 * Perbandingan teks ISO sama dengan perbandingan waktu.
 */
export async function ambilPinjaman(db: D1Database, nama: string, detik: number, sekarang = Date.now()): Promise<boolean> {
  const hasil = await db
    .prepare(
      `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
           WHERE sync_state.value < ?`,
    )
    .bind(`pinjaman:${nama}`, new Date(sekarang + detik * 1000).toISOString(), new Date(sekarang).toISOString())
    .run();
  return (hasil.meta?.changes ?? 0) > 0;
}

export async function lepasPinjaman(db: D1Database, nama: string): Promise<void> {
  await db
    .prepare(`UPDATE sync_state SET value = '' WHERE key = ?`)
    .bind(`pinjaman:${nama}`)
    .run()
    .catch(() => {});
}

/**
 * Catat bahwa pemicu Cron `cron` berjalan: kunci "denyut:<ekspresi>" berisi waktu eksekusi terakhir (ISO). Bila
 * catatannya masih lebih baru dari `selangMs`, tidak ada yang ditulis, jadi Cron per menit hanya menulis tiap lima
 * menit. Tanpa jejak ini tidak ada cara membedakan "Cron per menit tak berjalan" dari "berjalan tetapi tak ada kerja".
 */
export async function catatDenyut(db: D1Database, cron: string, sekarang = Date.now(), selangMs = 300_000): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
           WHERE sync_state.value < ?`,
    )
    .bind(`denyut:${cron}`, new Date(sekarang).toISOString(), new Date(sekarang - selangMs).toISOString())
    .run();
}

/**
 * Catat satu baris sync_log paling sering sekali tiap `selangMs` untuk `job`. Tik berjalan tiap menit dan kerap
 * mengulang peristiwa yang sama (kena batas laju, peraturan terisi); satu baris per tik akan menenggelamkan log.
 * Mengembalikan apakah barisnya ditulis.
 */
export async function catatLogBerjeda(
  db: D1Database,
  job: string,
  status: "sukses" | "gagal",
  detail: string,
  jumlah: number,
  selangMs: number,
  sekarang = Date.now(),
): Promise<boolean> {
  const hasil = await db
    .prepare(
      `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
           WHERE sync_state.value < ?`,
    )
    .bind(`log:${job}:${status}`, new Date(sekarang).toISOString(), new Date(sekarang - selangMs).toISOString())
    .run();
  if (!(hasil.meta?.changes ?? 0)) return false;
  await db
    .prepare(`INSERT INTO sync_log (job, status, detail, jumlah) VALUES (?, ?, ?, ?)`)
    .bind(job, status, detail, jumlah)
    .run()
    .catch(() => {});
  return true;
}

/**
 * Tambahkan hitungan ke statistik harian ("statistik:YYYY-MM-DD", JSON nama -> jumlah). Dipakai halaman status untuk
 * menunjukkan laju sebenarnya (berapa detail terambil hari ini, berapa kali kena batas laju). Hanya ditulis bila ada
 * yang bertambah. Dipanggil di dalam pinjaman tik, jadi baca-ubah-tulis tak berebut dengan eksekusi lain.
 */
export async function tambahStatistik(db: D1Database, hari: string, tambahan: Record<string, number>): Promise<void> {
  const naik = Object.entries(tambahan).filter(([, n]) => n > 0);
  if (!naik.length) return;
  const kunci = `statistik:${hari}`;
  let sekarang: Record<string, number> = {};
  try {
    sekarang = JSON.parse((await bacaState(db, kunci)) ?? "{}") as Record<string, number>;
  } catch {
    sekarang = {};
  }
  for (const [nama, n] of naik) sekarang[nama] = (sekarang[nama] ?? 0) + n;
  await tulisState(db, kunci, JSON.stringify(sekarang));
}
