/**
 * Memecah PDF per rentang halaman (pdf-lib), supaya PDF panjang dibaca Gemini dalam potongan pendek.
 *
 * KENAPA: pembacaan pertama di produksi (PP 3/1961, 9 halaman) memakan 337 detik dan 13.052 token (5.304 masuk, 3.305 keluar, 4.443
 * berpikir). Satu panggilan untuk seluruh PDF tak muat dalam batas waktu bagi undang-undang yang panjang (UU 32/2014: ±50 halaman),
 * sedangkan satu pemanggilan konsumer antrean dibatasi 15 menit. Potongan pendek dibaca paralel, dicoba ulang satu per satu, dan
 * dapat dipecah lagi bila satu potongan terlalu lama atau terlalu panjang.
 *
 * Hanya halaman yang disalin ke PDF baru; isinya (gambar pindaian, lapisan teks) tak diubah. PDF terenkripsi tak dipecah: pdf-lib
 * tak mendekripsi, jadi potongannya akan berisi aliran yang masih terenkripsi tanpa kamus enkripsinya.
 */

import { PDFDocument } from "pdf-lib";

export interface PemecahPdf {
  /** Jumlah halaman PDF. */
  halaman: number;
  /** PDF baru berisi halaman `mulai` sampai `akhir` (mulai dari 1, kedua ujung ikut) dari PDF asli. */
  ambil(mulai: number, akhir: number): Promise<Uint8Array>;
}

/** Buka PDF untuk dipecah; null bila pdf-lib tak dapat membacanya (rusak, terenkripsi, atau tanpa halaman). */
export async function bukaPdf(bytes: Uint8Array): Promise<PemecahPdf | null> {
  let sumber: PDFDocument;
  let halaman: number;
  try {
    sumber = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    if (sumber.isEncrypted) return null;
    halaman = sumber.getPageCount(); // melempar pada PDF tanpa katalog atau tanpa pohon halaman
  } catch {
    return null;
  }
  if (halaman < 1) return null;

  return {
    halaman,
    async ambil(mulai, akhir) {
      if (!Number.isInteger(mulai) || !Number.isInteger(akhir) || mulai < 1 || akhir < mulai || akhir > halaman) {
        throw new RangeError(`rentang halaman ${mulai}-${akhir} di luar PDF sepanjang ${halaman} halaman`);
      }
      const baru = await PDFDocument.create();
      const salinan = await baru.copyPages(sumber, Array.from({ length: akhir - mulai + 1 }, (_, i) => mulai - 1 + i));
      for (const h of salinan) baru.addPage(h);
      return baru.save({ useObjectStreams: false });
    },
  };
}
