// @ts-check
/**
 * Peraturan yang sengaja disimpan agar terbaca tanpa jaringan ("Simpan untuk luring").
 *
 * Disimpan di Cache API (`lexa-simpan-v1`), milik service worker (public/sw.js): ia mencari di sini lebih dulu
 * daripada di cache baca yang dibatasi 80 entri, dan jawaban jaringan terbaru memperbarui salinan ini sehingga
 * isinya tidak usang. Yang disimpan hanya jawaban API baca publik (isi peraturan, status dokumen, peta relasi
 * langsung); tidak ada data pribadi, dan tidak ada yang dikirim ke server.
 *
 * Kunci cache adalah alamat lengkap permintaan, jadi alamat dibangun dengan pembangun yang sama dengan klien API
 * (`api.alamat`), supaya cocok persis dengan yang diminta halaman.
 */

import { api } from "./api.js";
import { penyimpanan, siarkan } from "./state.js";

export const CACHE_SIMPAN = "lexa-simpan-v1";
/** Judul peraturan yang tersimpan, hanya untuk ditampilkan di daftar (isi sebenarnya ada di Cache API). */
const KUNCI_META = "lexa:luring:v1";
/** Batas jumlah peraturan yang disimpan, agar penyimpanan perangkat tidak habis tanpa disadari. */
export const MAKS_SIMPANAN = 30;

export class GalatLuring extends Error {
  /** @param {"tidak_didukung" | "penuh" | "jaringan"} kode @param {string} pesan */
  constructor(kode, pesan) {
    super(pesan);
    this.name = "GalatLuring";
    this.kode = kode;
  }
}

/** Cache API hanya ada di konteks aman (https atau localhost). */
export function luringDidukung() {
  return typeof caches !== "undefined" && typeof caches.open === "function";
}

/** @returns {Record<string, { sitasi: string, judul: string }>} */
function bacaMeta() {
  try {
    const m = JSON.parse(penyimpanan.baca(KUNCI_META) ?? "{}");
    return m && typeof m === "object" && !Array.isArray(m) ? m : {};
  } catch {
    return {};
  }
}

/** @param {string} uri @param {{ sitasi: string, judul: string } | null} nilai */
function tulisMeta(uri, nilai) {
  const m = bacaMeta();
  if (nilai) m[uri] = { sitasi: String(nilai.sitasi), judul: String(nilai.judul) };
  else delete m[uri];
  penyimpanan.tulis(KUNCI_META, JSON.stringify(m));
}

/** @param {string} uri */
function alamatPeraturan(uri) {
  return { detail: api.alamat.detail(uri), status: api.alamat.statusDokumen(uri), graf: api.alamat.graf(uri, 1) };
}

export const luring = {
  /**
   * Peraturan yang tersimpan beserta ukuran seluruh salinannya (bita), yang terbaru disimpan lebih dulu.
   * `sitasi` dan `judul` kosong bila catatannya hilang (isinya tetap tersimpan).
   * @returns {Promise<Array<{ uri: string, sitasi: string, judul: string, ukuran: number }>>}
   */
  async daftar() {
    if (!luringDidukung()) return [];
    try {
      const cache = await caches.open(CACHE_SIMPAN);
      /** @type {Map<string, number>} */
      const ukuran = new Map();
      /** @type {string[]} */
      const urut = [];
      for (const req of await cache.keys()) {
        const alamat = new URL(req.url);
        const uri = alamat.searchParams.get("uri");
        if (!uri) continue;
        const res = await cache.match(req);
        ukuran.set(uri, (ukuran.get(uri) ?? 0) + (res ? (await res.blob()).size : 0));
        // Hanya peraturan yang isinya (detail) tersimpan yang dihitung.
        if (alamat.pathname === "/api/laws/detail") urut.push(uri);
      }
      const meta = bacaMeta();
      return urut.reverse().map((uri) => ({ uri, sitasi: meta[uri]?.sitasi ?? "", judul: meta[uri]?.judul ?? "", ukuran: ukuran.get(uri) ?? 0 }));
    } catch {
      return [];
    }
  },

  /** @param {string} uri */
  async tersimpan(uri) {
    if (!luringDidukung()) return false;
    try {
      return Boolean(await (await caches.open(CACHE_SIMPAN)).match(alamatPeraturan(uri).detail));
    } catch {
      return false;
    }
  },

  /**
   * Ambil peraturan dari jaringan lalu simpan. Isi peraturan wajib berhasil; status dokumen dan peta relasi
   * pelengkap (bila gagal, tab itu saja yang kosong saat luring).
   * @param {string} uri
   * @param {{ sitasi: string, judul: string }} [catatan] untuk daftar di halaman Akun
   * @returns {Promise<number>} ukuran yang tersimpan (bita)
   */
  async simpan(uri, catatan) {
    if (!luringDidukung()) throw new GalatLuring("tidak_didukung", "Peramban ini tidak mendukung penyimpanan untuk dibaca luring.");
    const ada = await this.daftar();
    if (ada.length >= MAKS_SIMPANAN && !ada.some((e) => e.uri === uri)) {
      throw new GalatLuring("penuh", `Simpanan luring penuh (${MAKS_SIMPANAN} peraturan). Hapus salah satunya di halaman Akun.`);
    }
    const alamat = alamatPeraturan(uri);
    const cache = await caches.open(CACHE_SIMPAN);

    /** @param {string} url @param {boolean} wajib */
    const ambil = async (url, wajib) => {
      try {
        const res = await fetch(url, { credentials: "same-origin" });
        // Salinan yang disodorkan service worker karena jaringan lambat bukan data terbaru; jangan dijadikan simpanan.
        if (!res.ok || res.headers.get("x-lexa-salinan")) throw new Error(`jawaban tidak layak disimpan (${res.status})`);
        const salinan = res.clone();
        const ukuran = (await res.blob()).size;
        await cache.put(url, salinan);
        return ukuran;
      } catch {
        if (!wajib) return 0;
        throw new GalatLuring("jaringan", "Peraturan tidak dapat diambil dari jaringan. Coba lagi saat sinyal lebih baik.");
      }
    };

    const ukuran = (await ambil(alamat.detail, true)) + (await ambil(alamat.status, false)) + (await ambil(alamat.graf, false));
    // Minta peramban tidak membuang simpanan ini saat penyimpanan menipis (boleh ditolak; tidak wajib).
    try {
      await navigator.storage?.persist?.();
    } catch {
      /* tidak wajib */
    }
    if (catatan) tulisMeta(uri, catatan);
    siarkan("luring", { uri, tersimpan: true });
    return ukuran;
  },

  /** @param {string} uri */
  async hapus(uri) {
    if (!luringDidukung()) return;
    const cache = await caches.open(CACHE_SIMPAN);
    const alamat = alamatPeraturan(uri);
    await Promise.all([cache.delete(alamat.detail), cache.delete(alamat.status), cache.delete(alamat.graf)]);
    tulisMeta(uri, null);
    siarkan("luring", { uri, tersimpan: false });
  },
};
