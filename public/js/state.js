// @ts-check
/**
 * Keadaan lintas halaman: penyimpanan peramban, tema, sesi, dan koleksi.
 *
 * Aplikasi berfungsi penuh sebagai tamu. Akun hanya menambah sinkronisasi
 * koleksi antarperangkat; karena itu setiap akses ke localStorage dibungkus
 * try/catch (mode privat atau penyimpanan diblokir tidak boleh merusak apa pun).
 */

import { api, GalatApi } from "./api.js";

const bus = new EventTarget();

/** @param {"sesi" | "koleksi" | "tema" | "luring" | "riwayat"} nama @param {unknown} [detail] */
export function siarkan(nama, detail) {
  bus.dispatchEvent(new CustomEvent(nama, { detail }));
}

/**
 * @param {"sesi" | "koleksi" | "tema" | "luring" | "riwayat"} nama
 * @param {(detail: any) => void} fn
 * @returns {() => void} fungsi berhenti memantau
 */
export function pantau(nama, fn) {
  const pendengar = /** @param {Event} e */ (e) => fn(/** @type {CustomEvent} */ (e).detail);
  bus.addEventListener(nama, pendengar);
  return () => bus.removeEventListener(nama, pendengar);
}

// --- Penyimpanan --------------------------------------------------------------

/** Cadangan di memori bila localStorage tidak tersedia. @type {Map<string, string>} */
const memori = new Map();

export const penyimpanan = {
  /** @param {string} kunci @returns {string | null} */
  baca(kunci) {
    try {
      return localStorage.getItem(kunci);
    } catch {
      return memori.get(kunci) ?? null;
    }
  },
  /** @param {string} kunci @param {string} nilai */
  tulis(kunci, nilai) {
    try {
      localStorage.setItem(kunci, nilai);
    } catch {
      memori.set(kunci, nilai);
    }
  },
  /** @param {string} kunci */
  hapus(kunci) {
    try {
      localStorage.removeItem(kunci);
    } catch {
      memori.delete(kunci);
    }
  },
};

// --- Tema ---------------------------------------------------------------------

export const tema = {
  /** Tema yang sedang tampil: pilihan pengguna, atau pengaturan sistem. @returns {"terang" | "gelap"} */
  efektif() {
    const pilihan = document.documentElement.dataset.tema;
    if (pilihan === "terang" || pilihan === "gelap") return pilihan;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "gelap" : "terang";
  },
  alihkan() {
    const baru = this.efektif() === "gelap" ? "terang" : "gelap";
    document.documentElement.dataset.tema = baru;
    penyimpanan.tulis("lexa:tema", baru);
    siarkan("tema", baru);
  },
};

// --- Sesi ---------------------------------------------------------------------

/** @type {import("./api.js").StatusAuth} */
const sesiAwal = { masuk: false, login_tersedia: false, pengguna: null };

export const sesi = {
  /** @type {import("./api.js").StatusAuth} */
  data: sesiAwal,

  async muat() {
    try {
      const status = await api.statusAuth();
      // Jawaban yang bentuknya salah (null, bukan objek) diperlakukan seperti tanpa sesi:
      // seluruh halaman membaca `sesi.data` dan tidak boleh ada yang menemukan null.
      this.data = status && typeof status === "object" && typeof status.masuk === "boolean" ? status : sesiAwal;
    } catch {
      this.data = sesiAwal; // tanpa sesi pun aplikasi tetap berguna
    }
    siarkan("sesi", this.data);
    return this.data;
  },

  async keluar() {
    try {
      await api.keluar();
    } finally {
      this.data = { ...sesiAwal, login_tersedia: this.data.login_tersedia };
      koleksi.setelahSesiBerubah();
      siarkan("sesi", this.data);
    }
  },
};

// --- Koleksi ------------------------------------------------------------------

const KUNCI_KOLEKSI = "lexa:koleksi:v1";

/**
 * @typedef {{ uri: string, sitasi: string, judul: string, catatan: string | null, waktu: number }} Entri
 */

/** @returns {Entri[]} */
function bacaLokal() {
  try {
    const mentah = JSON.parse(penyimpanan.baca(KUNCI_KOLEKSI) ?? "[]");
    if (!Array.isArray(mentah)) return [];
    return mentah
      .filter((e) => e && typeof e.uri === "string" && typeof e.judul === "string")
      .map((e) => ({
        uri: e.uri,
        sitasi: String(e.sitasi ?? ""),
        judul: e.judul,
        catatan: typeof e.catatan === "string" && e.catatan ? e.catatan : null,
        waktu: Number(e.waktu) || Date.now(),
      }));
  } catch {
    return [];
  }
}

/** @param {Entri[]} daftar */
function tulisLokal(daftar) {
  penyimpanan.tulis(KUNCI_KOLEKSI, JSON.stringify(daftar));
}

/** Tanggal D1 ("2026-10-03 08:38:22", UTC) menjadi epoch ms. @param {string | undefined} d */
function epoch(d) {
  if (!d) return Date.now();
  const t = Date.parse(`${d.replace(" ", "T")}Z`);
  return Number.isNaN(t) ? Date.now() : t;
}

export const koleksi = {
  /** @type {Map<string, Entri>} */
  peta: new Map(),
  /** Pesan galat terakhir dari sinkronisasi server, bila ada. @type {string | null} */
  galat: null,

  get jumlah() {
    return this.peta.size;
  },

  /** @returns {Entri[]} terbaru dulu */
  daftar() {
    return [...this.peta.values()].sort((a, b) => b.waktu - a.waktu);
  },

  /** @param {string} uri */
  ada(uri) {
    return this.peta.has(uri);
  },

  /** Muat ulang dari sumber yang berlaku: server bila masuk, perangkat bila tamu. */
  async muat() {
    this.galat = null;
    this.peta.clear();
    if (sesi.data.masuk) {
      try {
        const { koleksi: daftar } = await api.koleksi.daftar();
        for (const e of daftar) {
          this.peta.set(e.uri, { uri: e.uri, sitasi: e.sitasi, judul: e.judul, catatan: e.catatan ?? null, waktu: epoch(e.disimpan_pada) });
        }
      } catch (e) {
        this.galat = e instanceof GalatApi ? e.message : "Koleksi tidak dapat dimuat.";
      }
    } else {
      for (const e of bacaLokal()) this.peta.set(e.uri, e);
    }
    siarkan("koleksi", this.jumlah);
  },

  /** Dipanggil saat status masuk/keluar berubah. */
  async setelahSesiBerubah() {
    await this.muat();
  },

  /**
   * Tambah atau perbarui satu entri.
   * @param {{ uri: string, sitasi: string, judul: string, catatan?: string | null }} entri
   */
  async simpan(entri) {
    const lama = this.peta.get(entri.uri);
    /** @type {Entri} */
    const baru = {
      uri: entri.uri,
      sitasi: entri.sitasi,
      judul: entri.judul,
      catatan: entri.catatan === undefined ? (lama?.catatan ?? null) : entri.catatan || null,
      waktu: lama?.waktu ?? Date.now(),
    };
    if (sesi.data.masuk) {
      await api.koleksi.simpan({ uri: baru.uri, sitasi: baru.sitasi, judul: baru.judul, catatan: baru.catatan });
    }
    this.peta.set(baru.uri, baru);
    if (!sesi.data.masuk) tulisLokal([...this.peta.values()]);
    siarkan("koleksi", this.jumlah);
  },

  /** @param {string} uri */
  async hapus(uri) {
    if (sesi.data.masuk) await api.koleksi.hapus(uri);
    this.peta.delete(uri);
    if (!sesi.data.masuk) tulisLokal([...this.peta.values()]);
    siarkan("koleksi", this.jumlah);
  },

  /**
   * Setelah masuk, bawa koleksi perangkat ini ke akun lalu kosongkan salinan lokal.
   * Penggabungan di server tidak pernah menimpa catatan yang sudah ada.
   * @returns {Promise<number>} jumlah entri yang dibawa
   */
  async gabungkanLokal() {
    if (!sesi.data.masuk) return 0;
    const lokal = bacaLokal();
    if (!lokal.length) return 0;
    await api.koleksi.gabung(lokal);
    penyimpanan.hapus(KUNCI_KOLEKSI);
    return lokal.length;
  },
};

// --- Inisialisasi -------------------------------------------------------------

/** @type {Promise<{ digabung: number }> | null} */
let janjiSiap = null;

/**
 * Muat sesi dan koleksi satu kali. Halaman yang bergantung pada keduanya
 * (koleksi, akun) menunggu hasil ini; halaman lain tidak perlu.
 * Bila baru saja masuk, koleksi perangkat ini dibawa ke akun.
 * @returns {Promise<{ digabung: number }>}
 */
export function siap() {
  janjiSiap ??= (async () => {
    await sesi.muat();
    await koleksi.muat();
    let digabung = 0;
    if (sesi.data.masuk) {
      try {
        digabung = await koleksi.gabungkanLokal();
        if (digabung) await koleksi.muat();
      } catch {
        // Gagal menggabung tidak boleh menghalangi aplikasi; salinan lokal tetap ada untuk dicoba lagi.
      }
    }
    return { digabung };
  })();
  return janjiSiap;
}
