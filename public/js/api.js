// @ts-check
/**
 * Klien API Lexa. Semua panggilan sama-origin (`/api/*`), memakai cookie sesi
 * HttpOnly yang dikelola server; tidak ada token di sisi klien.
 */

/** @typedef {import("../../src/shared/types").SearchResponse} SearchResponse */
/** @typedef {import("../../src/shared/types").BrowseResponse} BrowseResponse */
/** @typedef {import("../../src/shared/types").LawDetailResponse} LawDetailResponse */
/** @typedef {import("../../src/shared/types").Law} Law */
/**
 * @typedef {{ frbr_uri: string, sitasi: string, judul: string, nomor_pasal: string | null, ayat: string | null, status: string }} SitasiJawaban
 * @typedef {{ jawaban?: string, sitasi: SitasiJawaban[], cukup_dasar: boolean, percakapan_id?: string | null }} BalasanTanya
 * @typedef {{ masuk: boolean, login_tersedia: boolean, pengguna: { id: string, email: string, nama: string | null, foto_url: string | null } | null }} StatusAuth
 * @typedef {{ jenis: string, n: number }} JumlahJenis
 * @typedef {{ frbr_uri: string, jenis: string, nomor: string, tahun: number, judul: string }} RingkasPeraturan
 * @typedef {{ job: string, status: string, jumlah: number, detail: string | null, created_at: string }} CatatanSinkron
 * @typedef {{ total_peraturan: number, total_pasal: number, terindeks_vektor: number, per_jenis: JumlahJenis[], terbaru: RingkasPeraturan[], sinkronisasi_terakhir: CatatanSinkron[] }} Statistik
 * @typedef {{ nama: string, jumlah: number, berlaku: number, tahun_terbaru: number }} Bidang
 * @typedef {{ tipe: "peraturan" | "kueri", teks: string, uri: string | null }} Saran
 * @typedef {{ uri: string, label: string, jenis: string | null, tahun: number | null, status: string | null, ada_di_indeks: boolean, jarak: number }} SimpulGraf
 * @typedef {{ dari: string, ke: string, jenis: string }} SisiGraf
 * @typedef {{ pusat: string, simpul: SimpulGraf[], sisi: SisiGraf[] }} Graf
 * @typedef {{ uri: string, ada_pdf: boolean, ada_teks: boolean, pdf_url: string | null, teks_url: string | null, bpk_url: string | null }} StatusDokumen
 * @typedef {{ uri: string, sitasi: string, judul: string, catatan?: string | null, disimpan_pada?: string }} EntriServer
 */

export class GalatApi extends Error {
  /**
   * @param {number} status 0 = gagal menghubungi server
   * @param {string} kode
   * @param {string} pesan
   * @param {any} [data]
   */
  constructor(status, kode, pesan, data) {
    super(pesan);
    this.name = "GalatApi";
    this.status = status;
    this.kode = kode;
    this.data = data;
  }
}

/** @param {unknown} e */
export function dibatalkan(e) {
  return e instanceof DOMException && e.name === "AbortError";
}

/**
 * @typedef {Record<string, string | number | boolean | Array<string | number> | null | undefined>} ParamApi
 * @param {string} path
 * @param {{ metode?: string, badan?: unknown, sinyal?: AbortSignal, params?: ParamApi, teks?: boolean }} [opsi]
 * @returns {Promise<any>}
 */
async function minta(path, opsi = {}) {
  const url = new URL(path, location.origin);
  for (const [k, v] of Object.entries(opsi.params ?? {})) {
    if (v === null || v === undefined || v === "" || v === false) continue;
    if (Array.isArray(v)) {
      if (v.length) url.searchParams.set(k, v.join(","));
    } else {
      url.searchParams.set(k, String(v));
    }
  }

  /** @type {Response} */
  let res;
  try {
    res = await fetch(url, {
      method: opsi.metode ?? "GET",
      headers: opsi.badan !== undefined ? { "content-type": "application/json" } : undefined,
      body: opsi.badan !== undefined ? JSON.stringify(opsi.badan) : undefined,
      signal: opsi.sinyal,
      credentials: "same-origin",
    });
  } catch (e) {
    if (dibatalkan(e)) throw e;
    throw new GalatApi(0, "jaringan", "Tidak dapat menghubungi server. Periksa koneksi Anda lalu coba lagi.");
  }

  if (opsi.teks && res.ok) return res.text();

  /** @type {any} */
  let data = null;
  try {
    data = await res.json();
  } catch {
    // Badan bukan JSON (mis. halaman galat dari perantara).
  }
  if (!res.ok) {
    throw new GalatApi(
      res.status,
      data?.error ?? "galat_server",
      data?.message ?? (res.status >= 500 ? "Server sedang bermasalah. Coba lagi sebentar lagi." : `Permintaan gagal (${res.status}).`),
      data,
    );
  }
  return data;
}

/** @type {Map<string, { waktu: number, nilai: any }>} */
const ingatan = new Map();

/**
 * Ingat hasil sementara di memori halaman untuk data yang jarang berubah.
 * @template T
 * @param {string} kunci
 * @param {number} umurMs
 * @param {() => Promise<T>} ambil
 * @returns {Promise<T>}
 */
async function ingat(kunci, umurMs, ambil) {
  const ada = ingatan.get(kunci);
  if (ada && Date.now() - ada.waktu < umurMs) return ada.nilai;
  const nilai = await ambil();
  ingatan.set(kunci, { waktu: Date.now(), nilai });
  return nilai;
}

export const api = {
  /**
   * @param {{ q: string, mode?: string, jenis?: string[], status?: string[], tahun_min?: number, tahun_max?: number, bidang?: string, limit?: number }} f
   * @param {AbortSignal} [sinyal]
   * @returns {Promise<SearchResponse>}
   */
  cari(f, sinyal) {
    return minta("/api/search", { sinyal, params: { ...f } });
  },

  /**
   * @param {{ jenis?: string[], status?: string[], tahun_min?: number, tahun_max?: number, bidang?: string, urut?: string, page?: number, per_page?: number }} f
   * @param {AbortSignal} [sinyal]
   * @returns {Promise<BrowseResponse>}
   */
  telusur(f, sinyal) {
    return minta("/api/laws", { sinyal, params: { ...f } });
  },

  /** @param {string} uri @param {AbortSignal} [sinyal] @returns {Promise<LawDetailResponse>} */
  detail(uri, sinyal) {
    return minta("/api/laws/detail", { sinyal, params: { uri } });
  },

  /** @param {string} q @param {AbortSignal} [sinyal] @returns {Promise<{ suggestions: Saran[] }>} */
  saran(q, sinyal) {
    return minta("/api/suggest", { sinyal, params: { q } });
  },

  /** @returns {Promise<{ bidang: Bidang[] }>} */
  bidang() {
    return ingat("bidang", 10 * 60_000, () => minta("/api/bidang"));
  },

  /** @returns {Promise<Statistik>} */
  statistik() {
    return ingat("statistik", 60_000, () => minta("/api/stats"));
  },

  /** @param {string} uri @param {number} [kedalaman] @param {AbortSignal} [sinyal] @returns {Promise<Graf>} */
  graf(uri, kedalaman = 1, sinyal) {
    return minta("/api/relasi/graf", { sinyal, params: { uri, kedalaman } });
  },

  /** @param {string} uri @param {AbortSignal} [sinyal] @returns {Promise<StatusDokumen>} */
  statusDokumen(uri, sinyal) {
    return minta("/api/dokumen/status", { sinyal, params: { uri } });
  },

  /** @param {string} uri @param {AbortSignal} [sinyal] @returns {Promise<string>} */
  teksDokumen(uri, sinyal) {
    return minta("/api/dokumen/teks", { sinyal, params: { uri }, teks: true });
  },

  /**
   * @param {string} pertanyaan
   * @param {string | null} percakapanId
   * @param {AbortSignal} [sinyal]
   * @returns {Promise<BalasanTanya>}
   */
  tanya(pertanyaan, percakapanId, sinyal) {
    return minta("/api/tanya", {
      metode: "POST",
      sinyal,
      badan: { pertanyaan, ...(percakapanId ? { percakapan_id: percakapanId } : {}) },
    });
  },

  /** @returns {Promise<StatusAuth>} */
  statusAuth() {
    return minta("/api/auth/status");
  },

  keluar() {
    return minta("/api/auth/keluar", { metode: "POST" });
  },

  /** @param {{ nama?: string, foto_url?: string | null }} badan */
  ubahProfil(badan) {
    return minta("/api/auth/profil", { metode: "PATCH", badan });
  },

  koleksi: {
    /** @returns {Promise<{ masuk: boolean, koleksi: EntriServer[] }>} */
    daftar() {
      return minta("/api/koleksi");
    },
    /** @param {{ uri: string, sitasi: string, judul: string, catatan?: string | null }} entri */
    simpan(entri) {
      return minta("/api/koleksi", { metode: "PUT", badan: entri });
    },
    /** @param {string} uri */
    hapus(uri) {
      return minta("/api/koleksi", { metode: "DELETE", params: { uri } });
    },
    /** @param {Array<{ uri: string, sitasi: string, judul: string, catatan?: string | null, waktu?: number }>} koleksi */
    gabung(koleksi) {
      return minta("/api/koleksi/gabung", { metode: "POST", badan: { koleksi } });
    },
  },

  /** @param {{ uri: string, jenis: string, keterangan: string, konteks?: string }} badan */
  lapor(badan) {
    return minta("/api/laporan", { metode: "POST", badan });
  },
};
