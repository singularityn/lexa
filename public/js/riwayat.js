// @ts-check
/**
 * Riwayat di perangkat ini: peraturan yang terakhir dibuka dan kata yang terakhir dicari.
 *
 * Hanya disimpan di localStorage (lewat `penyimpanan`, yang tahan terhadap penyimpanan yang diblokir);
 * tidak pernah dikirim ke server. Dipakai di beranda ("Terakhir dilihat", "Pencarian terakhir") dan
 * bisa dihapus dari halaman Akun.
 */

import { penyimpanan } from "./state.js";

const KUNCI = "lexa:riwayat:v1";
export const MAKS_DILIHAT = 20;
export const MAKS_CARI = 10;

/**
 * @typedef {{ uri: string, sitasi: string, judul: string, waktu: number }} Dilihat
 * @typedef {{ q: string, waktu: number }} Dicari
 */

/** @returns {{ dilihat: Dilihat[], cari: Dicari[] }} */
function baca() {
  try {
    const mentah = JSON.parse(penyimpanan.baca(KUNCI) ?? "{}");
    const dilihat = Array.isArray(mentah?.dilihat)
      ? mentah.dilihat.filter((/** @type {any} */ e) => e && typeof e.uri === "string" && typeof e.judul === "string").map((/** @type {any} */ e) => ({
          uri: e.uri,
          sitasi: String(e.sitasi ?? ""),
          judul: e.judul,
          waktu: Number(e.waktu) || 0,
        }))
      : [];
    const cari = Array.isArray(mentah?.cari)
      ? mentah.cari.filter((/** @type {any} */ e) => e && typeof e.q === "string" && e.q.trim() !== "").map((/** @type {any} */ e) => ({ q: e.q, waktu: Number(e.waktu) || 0 }))
      : [];
    return { dilihat: dilihat.slice(0, MAKS_DILIHAT), cari: cari.slice(0, MAKS_CARI) };
  } catch {
    return { dilihat: [], cari: [] };
  }
}

/** @param {{ dilihat: Dilihat[], cari: Dicari[] }} data */
function tulis(data) {
  penyimpanan.tulis(KUNCI, JSON.stringify(data));
}

export const riwayat = {
  /** Terbaru dulu. @returns {Dilihat[]} */
  dilihat() {
    return baca().dilihat;
  },

  /** Terbaru dulu. @returns {Dicari[]} */
  pencarian() {
    return baca().cari;
  },

  /**
   * Catat peraturan yang dibuka; membukanya lagi memindahkannya ke paling atas.
   * @param {{ uri: string, sitasi: string, judul: string }} p
   */
  catatDilihat(p) {
    const data = baca();
    data.dilihat = [{ uri: p.uri, sitasi: p.sitasi, judul: p.judul, waktu: Date.now() }, ...data.dilihat.filter((e) => e.uri !== p.uri)].slice(0, MAKS_DILIHAT);
    tulis(data);
  },

  /**
   * Catat kata yang dicari (tanpa membedakan huruf besar/kecil dan spasi berlebih).
   * @param {string} q
   */
  catatPencarian(q) {
    const bersih = q.trim().replace(/\s+/g, " ");
    if (bersih.length < 2) return;
    const data = baca();
    data.cari = [{ q: bersih, waktu: Date.now() }, ...data.cari.filter((e) => e.q.toLowerCase() !== bersih.toLowerCase())].slice(0, MAKS_CARI);
    tulis(data);
  },

  /** @param {string} uri */
  hapusDilihat(uri) {
    const data = baca();
    data.dilihat = data.dilihat.filter((e) => e.uri !== uri);
    tulis(data);
  },

  hapusSemua() {
    penyimpanan.hapus(KUNCI);
  },
};
