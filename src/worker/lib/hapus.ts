/**
 * Daftar hapus: pembersihan objek di luar D1 (berkas R2 dan vektor di Vectorize).
 *
 * Menghapus baris peraturan dari D1 (mis. jenis di luar cakupan) tidak menghapus teks arsipnya di R2 maupun
 * vektornya di Vectorize, dan keduanya hanya terjangkau lewat binding Worker. Karena itu kuncinya dicatat lebih dulu
 * di tabel `daftar_hapus` (migrasi 0005), lalu fungsi ini mengosongkannya sedikit demi sedikit dari Cron per menit.
 * Baris daftar baru dihapus SETELAH penghapusan objeknya berhasil, jadi kegagalan di tengah jalan hanya berarti
 * diulang pada menit berikutnya. Menghapus kunci yang sudah tidak ada tidak menimbulkan galat di R2 maupun Vectorize,
 * sehingga mengulang aman.
 */

/** R2 menerima hingga 1000 kunci per panggilan hapus. */
const KUNCI_R2_PER_PANGGILAN = 500;
/** Panggilan Vectorize per menit dan id per panggilan: cukup kecil agar satu tik tidak berlarut. */
const ID_VEKTOR_PER_PANGGILAN = 100;
const PANGGILAN_VEKTOR_PER_TIK = 10;

export interface LaporanHapus {
  r2: number;
  vektor: number;
  /** Id vektor yang ditolak Vectorize bahkan saat dihapus satu per satu; dilepas dari daftar agar tidak menahan antrean. */
  dilepas: number;
  /** Daftar hapus sudah kosong setelah putaran ini. */
  selesai: boolean;
}

const POTONGAN_D1 = 90;

/** Hapus baris daftar untuk kunci yang sudah diproses, dipecah agar tiap pernyataan di bawah batas 100 parameter D1. */
async function lepaskan(db: D1Database, jenis: "r2" | "vektor", kunci: string[]) {
  const pernyataan: D1PreparedStatement[] = [];
  for (let i = 0; i < kunci.length; i += POTONGAN_D1) {
    const potong = kunci.slice(i, i + POTONGAN_D1);
    pernyataan.push(
      db
        .prepare(`DELETE FROM daftar_hapus WHERE jenis_objek = ? AND kunci IN (${potong.map(() => "?").join(",")})`)
        .bind(jenis, ...potong),
    );
  }
  if (pernyataan.length) await db.batch(pernyataan);
}

async function ambilKunci(db: D1Database, jenis: "r2" | "vektor", batas: number): Promise<string[]> {
  const { results } = await db
    .prepare(`SELECT kunci FROM daftar_hapus WHERE jenis_objek = ? ORDER BY kunci LIMIT ?`)
    .bind(jenis, batas)
    .all<{ kunci: string }>();
  return results.map((r) => r.kunci);
}

/**
 * Hapus id vektor dari Vectorize. Bila satu panggilan gagal, bagi dua dan coba lagi sampai id yang bermasalah
 * terisolasi: satu id yang ditolak tidak boleh menahan ribuan lainnya selamanya. Mengembalikan id yang berhasil
 * dihapus dan yang dilepas (ditolak walau sendirian).
 */
async function hapusVektor(
  vectorize: VectorizeIndex,
  ids: string[],
): Promise<{ berhasil: string[]; dilepas: string[] }> {
  try {
    await vectorize.deleteByIds(ids);
    return { berhasil: ids, dilepas: [] };
  } catch (e) {
    if (ids.length === 1) {
      console.error("Lexa: id vektor ditolak Vectorize, dilepas dari daftar hapus:", ids[0], e);
      return { berhasil: [], dilepas: ids };
    }
    const tengah = Math.ceil(ids.length / 2);
    const kiri = await hapusVektor(vectorize, ids.slice(0, tengah));
    const kanan = await hapusVektor(vectorize, ids.slice(tengah));
    return { berhasil: [...kiri.berhasil, ...kanan.berhasil], dilepas: [...kiri.dilepas, ...kanan.dilepas] };
  }
}

/** Satu putaran pengosongan. Galat R2 dilempar ke pemanggil (tik), yang menundanya; kemajuan sebelumnya tetap sah. */
export async function kosongkanDaftarHapus(
  db: D1Database,
  docs: R2Bucket,
  vectorize: VectorizeIndex,
): Promise<LaporanHapus> {
  const laporan: LaporanHapus = { r2: 0, vektor: 0, dilepas: 0, selesai: false };

  const kunciR2 = await ambilKunci(db, "r2", KUNCI_R2_PER_PANGGILAN);
  if (kunciR2.length) {
    await docs.delete(kunciR2);
    await lepaskan(db, "r2", kunciR2);
    laporan.r2 = kunciR2.length;
  }

  for (let i = 0; i < PANGGILAN_VEKTOR_PER_TIK; i++) {
    const ids = await ambilKunci(db, "vektor", ID_VEKTOR_PER_PANGGILAN);
    if (!ids.length) break;
    const { berhasil, dilepas } = await hapusVektor(vectorize, ids);
    await lepaskan(db, "vektor", [...berhasil, ...dilepas]);
    laporan.vektor += berhasil.length;
    laporan.dilepas += dilepas.length;
  }

  laporan.selesai = !(await adaYangDihapus(db));
  return laporan;
}

/** Apakah ada yang menunggu dihapus. Satu baca indeks; dipakai tik untuk tidak melakukan apa pun saat sepi. */
export async function adaYangDihapus(db: D1Database): Promise<boolean> {
  const baris = await db.prepare(`SELECT 1 AS ada FROM daftar_hapus LIMIT 1`).first();
  return baris !== null;
}
