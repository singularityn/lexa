// @ts-check
/**
 * Indeks "pasal -> halaman PDF" yang dibangun di peramban pembaca dari lapisan teks PDF-nya (tanpa DOM dan tanpa PDF.js: teks halaman
 * diambil lewat `ambilItem`, jadi bisa diuji dan dipakai bersama oleh pencarian dan pemeriksaan).
 *
 * Sumber utamanya adalah halaman yang disimpan server per pasal (articles.halaman); indeks ini adalah cadangan dan pemeriksanya:
 *  - `verifikasi`: memastikan judul pasal memang tampak di (atau di sebelah) halaman yang disarankan server;
 *  - `cari`: memindai PDF berurutan dari halaman pertama sampai judul pasal ditemukan, untuk pasal yang belum punya halaman;
 *  - `pindai`: memindai seluruh batang tubuh (bahan "Periksa pasal").
 * Pemindaian berhenti di judul penjelasan (penjelasan memakai ulang nomor pasal batang tubuh), dan PDF hasil pindaian tanpa
 * lapisan teks dikenali supaya tak dipindai sia-sia dan pembaca diberi tahu terus terang.
 */

import { rapikanNomorPasal } from "./format.js";
import { catatHalamanBadan, pindaiHalaman } from "./pdfPasal.js";

/** Bila sebanyak ini halaman pertama tak berisi teks sama sekali, PDF dianggap hasil pindaian dan pemindaian dihentikan. */
export const HALAMAN_UJI_PINDAIAN = 8;

/**
 * @typedef {{ str?: string, hasEOL?: boolean }} ItemTeks
 * @typedef {{
 *   jumlahHalaman: number,
 *   ambilItem: (no: number) => Promise<ReadonlyArray<ItemTeks>>,
 *   pulihkan?: () => string | null,
 *   simpan?: (data: string) => void,
 * }} OpsiIndeks
 */

/** Nomor pasal sebagai kunci indeks: tanpa spasi, huruf besar, dirapikan seperti di D1. @param {string} nomor */
export const kunciPasal = (nomor) => rapikanNomorPasal(String(nomor).replace(/\s+/g, "").toUpperCase());

/** @param {OpsiIndeks} opsi */
export function buatIndeksPasal({ jumlahHalaman, ambilItem, pulihkan, simpan }) {
  /** @type {Map<string, number>} */
  const indeks = new Map();
  let sudahDipindai = 0;
  let tanpaTeks = false;
  /** Judul penjelasan sudah ditemui: batang tubuh selesai dipindai, sisanya tak perlu dibaca. */
  let akhirBadan = false;
  let jumlahItemAwal = 0;
  let hancur = false;
  let rantai = Promise.resolve();

  function simpanKeadaan() {
    try {
      simpan?.(JSON.stringify({ n: jumlahHalaman, s: sudahDipindai, t: tanpaTeks, a: akhirBadan, p: [...indeks] }));
    } catch {
      /* penyimpanan penuh atau dimatikan: pemindaian saja yang diulang */
    }
  }

  (() => {
    try {
      const mentah = pulihkan?.();
      if (!mentah) return;
      const o = JSON.parse(mentah);
      if (o?.n !== jumlahHalaman || !Array.isArray(o.p)) return;
      for (const [nomor, halaman] of o.p) if (typeof nomor === "string" && Number.isInteger(halaman)) indeks.set(nomor, halaman);
      sudahDipindai = Math.min(Number(o.s) || 0, jumlahHalaman);
      tanpaTeks = Boolean(o.t);
      akhirBadan = Boolean(o.a);
    } catch {
      /* indeks rusak: dipindai ulang */
    }
  })();

  /** Apakah masih ada halaman batang tubuh yang belum dipindai. */
  const bisaMemindai = () => !hancur && !tanpaTeks && !akhirBadan && sudahDipindai < jumlahHalaman;

  /** Pindai satu halaman berikutnya; halaman yang tak terbaca dilewati. */
  async function pindaiBerikut() {
    const no = ++sudahDipindai;
    try {
      const item = await ambilItem(no);
      jumlahItemAwal += no <= HALAMAN_UJI_PINDAIAN ? item.length : 0;
      if (catatHalamanBadan(indeks, no, item).penjelasan) akhirBadan = true;
    } catch {
      /* halaman yang tak terbaca dilewati */
    }
    if (no === Math.min(HALAMAN_UJI_PINDAIAN, jumlahHalaman) && jumlahItemAwal === 0) tanpaTeks = true;
  }

  return {
    /**
     * Halaman tempat pasal `nomor` dimulai, dicari berurutan dari halaman terakhir yang sudah dipindai (berhenti begitu ketemu atau
     * begitu bagian penjelasan dimulai). null bila tak ada, atau PDF-nya hasil pindaian tanpa lapisan teks.
     * @param {string} nomor
     * @returns {Promise<number | null>}
     */
    cari(nomor) {
      const kunci = kunciPasal(nomor);
      rantai = rantai.then(async () => {
        while (bisaMemindai() && !indeks.has(kunci)) await pindaiBerikut();
        simpanKeadaan();
      });
      return rantai.then(() => indeks.get(kunci) ?? null);
    },

    /**
     * Pindai sisa batang tubuh. `batal` ditanyakan sebelum tiap halaman; `lapor` dipanggil sesudahnya.
     * @param {{ batal?: () => boolean, lapor?: (sudah: number, total: number) => void }} [o]
     * @returns {Promise<void>}
     */
    pindai({ batal, lapor } = {}) {
      rantai = rantai.then(async () => {
        while (bisaMemindai() && !batal?.()) {
          await pindaiBerikut();
          lapor?.(sudahDipindai, jumlahHalaman);
        }
        simpanKeadaan();
      });
      return rantai;
    },

    /**
     * Periksa halaman yang disarankan server: judul pasal harus tampak di halaman itu atau di sebelahnya (peta halaman server
     * bisa bergeser satu halaman bila judul jatuh di batas halaman). `pasti: false` berarti halaman-halaman itu tak punya lapisan
     * teks (PDF pindaian), jadi sarannya dipercaya tanpa bukti. null bila ada teks tetapi judulnya tak tampak.
     * @param {string} nomor
     * @param {number} saran
     * @returns {Promise<{ halaman: number, pasti: boolean } | null>}
     */
    async verifikasi(nomor, saran) {
      if (!Number.isInteger(saran) || saran < 1 || saran > jumlahHalaman) return null;
      const kunci = kunciPasal(nomor);
      let adaTeks = false;
      for (const no of [saran, saran + 1, saran - 1]) {
        if (hancur) return null;
        if (no < 1 || no > jumlahHalaman) continue;
        try {
          const item = await ambilItem(no);
          if (item.some((it) => typeof it.str === "string" && it.str.trim())) adaTeks = true;
          if (pindaiHalaman(item).pasal.includes(kunci)) return { halaman: no, pasti: true };
        } catch {
          /* halaman yang tak terbaca dilewati */
        }
      }
      return adaTeks ? null : { halaman: saran, pasti: false };
    },

    bisaMemindai,
    /** Nomor pasal yang judulnya sudah ditemukan. */
    nomor: () => [...indeks.keys()],
    /** @param {string} nomor */
    halamanDari: (nomor) => indeks.get(kunciPasal(nomor)),
    /** Keadaan pemindaian untuk laporan. */
    keadaan: () => ({ sudahDipindai, jumlahHalaman, tanpaTeks, akhirBadan, jumlahJudul: indeks.size }),
    hancurkan() {
      hancur = true;
    },
  };
}
