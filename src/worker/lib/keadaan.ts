/**
 * Keadaan kecil yang dibagi antar-eksekusi Worker, disimpan di tabel `sync_state` (kunci -> teks).
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

/**
 * Catat bahwa pemicu Cron `cron` berjalan: kunci "denyut:<ekspresi>" berisi waktu eksekusi terakhir (ISO). Halaman status
 * menampilkannya sebagai "pemeliharaan terakhir berjalan"; tanpa jejak ini tak ada cara membedakan pemicu yang tak
 * berjalan dari pemicu yang berjalan tanpa pekerjaan.
 */
export async function catatDenyut(db: D1Database, cron: string, sekarang = Date.now()): Promise<void> {
  await tulisState(db, `denyut:${cron}`, new Date(sekarang).toISOString());
}
