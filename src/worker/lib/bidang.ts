/**
 * Bidang hukum.
 *
 * BPK menandai satu peraturan dengan lebih dari satu bidang dengan cara
 * merangkainya dalam satu kolom, dipisah " - ":
 *
 *     "APBN - BUMN"
 *     "KESEHATAN - JABATAN / PROFESI / KEAHLIAN / SERTIFIKASI"
 *
 * Selama ini nilai itu diperlakukan sebagai satu kategori utuh. Akibatnya
 * "APBN" dan "APBN - BUMN" muncul sebagai dua bidang berbeda di daftar, dan
 * memilih "APBN" tidak pernah menemukan dokumen yang kebetulan juga ditandai
 * BUMN. Dari 60 nama yang tercatat, 13 sebenarnya gabungan — dan seluruh
 * bagiannya, kecuali "BUMN" dan "TERITORIAL INDONESIA", juga muncul sendirian
 * sebagai bidang. Jadi ini memang pemisah, bukan bagian dari nama.
 *
 * Pemisahnya wajib memakai spasi di kedua sisi. Ada nama yang mengandung tanda
 * hubung rapat seperti "BEA CUKAI, EKSPOR-IMPOR, KEPABEANAN", dan memecah pada
 * "-" telanjang akan merusaknya.
 */

const PEMISAH = " - ";

/** Pecah nilai kolom `bidang` menjadi daftar bidang yang sesungguhnya. */
export function pecahBidang(mentah: string | null | undefined): string[] {
  if (!mentah) return [];
  return mentah
    .split(PEMISAH)
    .map((b) => b.trim())
    .filter(Boolean);
}

/**
 * Klausa SQL untuk menyaring peraturan menurut satu bidang.
 *
 * Tidak bisa `bidang = ?` karena nilainya mungkin gabungan, dan tidak boleh
 * `LIKE '%X%'` karena itu akan menganggap "PERPAJAKAN" cocok dengan bidang lain
 * yang kebetulan memuat potongan katanya. Yang dicocokkan adalah posisi
 * bidang di dalam rangkaian: sendirian, di awal, di akhir, atau di tengah.
 */
export function klausaBidang(
  kolom: string,
): { sql: string; params: (nilai: string) => string[] } {
  return {
    sql: `(${kolom} = ? OR ${kolom} LIKE ? ESCAPE '\\' OR ${kolom} LIKE ? ESCAPE '\\' OR ${kolom} LIKE ? ESCAPE '\\')`,
    params: (nilai: string) => {
      // `%` dan `_` tidak pernah muncul di nama bidang BPK, tetapi nilai ini
      // datang dari parameter URL — jadi tetap dilepas supaya tidak ada yang
      // bisa memperluas kecocokan lewat pola LIKE.
      const aman = nilai.replace(/([\\%_])/g, "\\$1");
      return [nilai, `${aman}${PEMISAH}%`, `%${PEMISAH}${aman}`, `%${PEMISAH}${aman}${PEMISAH}%`];
    },
  };
}

export interface RingkasBidang {
  nama: string;
  jumlah: number;
  berlaku: number;
  tahun_terbaru: number;
}

/**
 * Gabungkan baris hasil GROUP BY kolom mentah menjadi daftar bidang tunggal.
 *
 * Satu peraturan bertanda "A - B" dihitung untuk A sekaligus untuk B, jadi
 * jumlah seluruh bidang memang melebihi jumlah peraturan. Itu benar untuk
 * penanda berganda, dan lebih jujur daripada memaksa setiap dokumen hanya
 * masuk satu kategori.
 */
export function gabungkanBidang(baris: RingkasBidang[]): RingkasBidang[] {
  const peta = new Map<string, RingkasBidang>();

  for (const b of baris) {
    for (const nama of pecahBidang(b.nama)) {
      const ada = peta.get(nama);
      if (ada) {
        ada.jumlah += b.jumlah;
        ada.berlaku += b.berlaku;
        ada.tahun_terbaru = Math.max(ada.tahun_terbaru, b.tahun_terbaru);
      } else {
        peta.set(nama, { ...b, nama });
      }
    }
  }

  return [...peta.values()].sort(
    (a, b) => b.jumlah - a.jumlah || a.nama.localeCompare(b.nama, "id"),
  );
}
