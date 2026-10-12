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

/** Paling banyak pernyataan dalam satu `batch()`; D1 tidak mendokumentasikan batas pasti, ini jauh di bawah yang wajar. */
const MAKS_PERNYATAAN_BATCH = 200;

/**
 * Jalankan kelompok pernyataan (satu kelompok = satu dokumen) seaman mungkin.
 *
 * `batch()` D1 atomik: satu pernyataan yang melanggar kendala (indeks unik, CHECK) membatalkan SEMUA yang sebanding,
 * jadi satu dokumen buruk di antara 500 menggagalkan 499 yang sehat. Di sini kelompok dikemas ke dalam beberapa batch;
 * batch yang gagal diulang kelompok demi kelompok, sehingga yang bermasalah terpisah dari yang sehat.
 *
 * @returns alasan kegagalan menurut `id` kelompok yang gagal (kosong bila semuanya tersimpan)
 */
export async function batchBerkelompok(
  db: D1Database,
  kelompok: ReadonlyArray<{ id: string; pernyataan: D1PreparedStatement[] }>,
): Promise<Map<string, string>> {
  const gagal = new Map<string, string>();
  const paket: Array<typeof kelompok[number][]> = [];
  let kini: Array<typeof kelompok[number]> = [];
  let jumlah = 0;
  for (const k of kelompok) {
    if (!k.pernyataan.length) continue;
    if (kini.length && jumlah + k.pernyataan.length > MAKS_PERNYATAAN_BATCH) {
      paket.push(kini);
      kini = [];
      jumlah = 0;
    }
    kini.push(k);
    jumlah += k.pernyataan.length;
  }
  if (kini.length) paket.push(kini);

  for (const isi of paket) {
    try {
      await db.batch(isi.flatMap((k) => k.pernyataan));
    } catch {
      for (const k of isi) {
        try {
          await db.batch(k.pernyataan);
        } catch (e) {
          gagal.set(k.id, String(e instanceof Error ? e.message : e).slice(0, 200));
        }
      }
    }
  }
  return gagal;
}

/**
 * Jalankan banyak SELECT sekaligus (satu perjalanan ke D1 per `MAKS_PERNYATAAN_BATCH`), hasilnya sejajar dengan masukan.
 */
export async function pilihBanyak<T>(db: D1Database, pernyataan: readonly D1PreparedStatement[]): Promise<T[][]> {
  const hasil: T[][] = [];
  for (let i = 0; i < pernyataan.length; i += MAKS_PERNYATAAN_BATCH) {
    const jawab = await db.batch<T>(pernyataan.slice(i, i + MAKS_PERNYATAAN_BATCH) as D1PreparedStatement[]);
    for (const j of jawab) hasil.push(j.results);
  }
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
