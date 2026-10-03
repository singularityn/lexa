/**
 * Pembantu D1.
 *
 * D1 menolak kueri dengan lebih dari 100 parameter terikat (SQLite biasa
 * mengizinkan puluhan ribu), jadi daftar `IN (...)` yang panjangnya mengikuti
 * data, bukan konstanta, harus dipecah. Kegagalannya baru terlihat di produksi,
 * pada data yang cukup besar: kueri yang sama lolos di lingkungan uji kecil.
 */

/** Sisakan ruang di bawah batas 100 untuk parameter lain di kueri yang sama. */
export const BATAS_PARAMETER = 90;

/** Bagi daftar menjadi potongan berukuran paling banyak `ukuran`. */
export function kelompokkan<T>(daftar: readonly T[], ukuran = BATAS_PARAMETER): T[][] {
  const hasil: T[][] = [];
  for (let i = 0; i < daftar.length; i += ukuran) hasil.push(daftar.slice(i, i + ukuran));
  return hasil;
}

/**
 * Jalankan kueri `... IN (?,?,…)` untuk daftar nilai berapa pun panjangnya.
 *
 * @param sql   menerima deretan penanda ("?,?,?") dan mengembalikan kueri lengkap
 * @param ulang berapa kali daftar yang sama dipakai dalam satu kueri (mis. 2 untuk
 *              `a IN (…) OR b IN (…)`); ukuran potongan menyesuaikan
 * @returns     gabungan hasil seluruh potongan. Kueri dengan OR antar-kolom dapat
 *              mengembalikan baris yang sama dari dua potongan; pemanggil yang
 *              peduli harus menghilangkan duplikatnya.
 */
export async function pilihDalam<T>(
  db: D1Database,
  nilai: readonly string[],
  sql: (penanda: string) => string,
  opsi: { ulang?: number } = {},
): Promise<T[]> {
  const ulang = opsi.ulang ?? 1;
  const hasil: T[] = [];
  for (const potongan of kelompokkan(nilai, Math.max(1, Math.floor(BATAS_PARAMETER / ulang)))) {
    const penanda = potongan.map(() => "?").join(",");
    const terikat = Array.from({ length: ulang }, () => potongan).flat();
    const { results } = await db.prepare(sql(penanda)).bind(...terikat).all<T>();
    hasil.push(...results);
  }
  return hasil;
}
