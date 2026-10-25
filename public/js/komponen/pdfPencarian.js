// @ts-check
/**
 * Pencarian teks di dalam PDF untuk penampil PDF: kotak cari, penghitung "3 / 12", tombol hasil sebelum/berikut, dan penandaan
 * kecocokan di lapisan teks halaman yang tergambar. Rumus pencarian (murni) ada di pdfCari.js; komponen ini hanya merangkai
 * teks halaman, DOM, dan penggulirannya.
 *
 * Halaman dipindai berurutan di latar belakang dan hasilnya bertambah selagi pencarian berjalan; hasil pertama pada atau sesudah
 * halaman yang sedang dibaca langsung dibuka (bukan yang pertama di naskah), jadi mencari dari halaman 50 tidak melompat ke halaman 3.
 * Penandaan memakai CSS Custom Highlight API bila ada (rentang persis di dalam teks), cadangannya menandai seluruh potongan teks
 * yang memuat kecocokan.
 */

import { h, tunda } from "../dom.js";
import { ikon } from "./ikon.js";
import { cariDiHalaman, MAKS_KECOCOKAN, MIN_KARAKTER, polaCari, rentangItem } from "../pdfCari.js";
import { HALAMAN_UJI_PINDAIAN } from "../indeksPasalPdf.js";

/** Nama sorotan CSS (lihat ::highlight di app.css) dan kelas cadangannya. */
const SOROT = "pdf-cari";
const SOROT_AKTIF = "pdf-cari-aktif";

/** @typedef {import("../pdfCari.js").TeksHalaman} TeksHalaman */
/** @typedef {{ no: number, mulai: number, akhir: number }} Kecocokan */

/**
 * @typedef {{
 *   jumlahHalaman: () => number,
 *   halamanSaatIni: () => number,
 *   ambilTeks: (no: number) => Promise<TeksHalaman>,
 *   lihat: (no: number) => HTMLElement[] | null,
 *   keHalaman: (no: number) => void,
 *   gulirKeElemen: (el: HTMLElement) => void,
 *   saatTutup?: () => void,
 * }} OpsiPencarian
 *   `lihat(no)`: potongan teks (satu per item teks) di lapisan teks halaman yang sedang tergambar, null bila halaman itu tak tergambar.
 */

const adaSorotanCss = () => typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";

/** @param {OpsiPencarian} o */
export function buatPencarian(o) {
  /** @type {RegExp | null} */
  let pola = null;
  /** @type {Kecocokan[]} */
  let hasil = [];
  let aktif = -1;
  /** Nomor yang naik tiap pencarian baru, supaya pemindaian lama berhenti. */
  let giliran = 0;
  let memindai = false;
  /** Pesan khusus (PDF pindaian, kueri terlalu pendek) menggantikan penghitung. */
  let pesan = "";
  /** @type {Map<number, TeksHalaman>} halaman yang punya kecocokan, untuk menandai dan menggulir tanpa membaca ulang */
  const teksBerhasil = new Map();
  /** @type {Map<number, Kecocokan[]>} */
  const perHalaman = new Map();
  /** Halaman yang sedang ditunggu tergambar supaya kecocokan aktifnya bisa digulirkan ke layar. */
  let menunggu = 0;
  let hancur = false;

  const masukan = /** @type {HTMLInputElement} */ (
    h("input", { class: "input pdf-cari-input", type: "search", placeholder: "Cari di PDF", "aria-label": "Cari di dalam PDF", enterkeyhint: "search", autocomplete: "off", spellcheck: "false" })
  );
  const hitung = h("span", { class: "pdf-cari-hitung", role: "status", "aria-live": "polite" });
  const sebelum = /** @type {HTMLButtonElement} */ (
    h("button", { type: "button", class: "tombol tombol-hantu tombol-ikon tombol-kecil", "aria-label": "Hasil sebelumnya", title: "Hasil sebelumnya (Shift+Enter)", disabled: true, onclick: () => pindah(-1) }, ikon("naik"))
  );
  const berikut = /** @type {HTMLButtonElement} */ (
    h("button", { type: "button", class: "tombol tombol-hantu tombol-ikon tombol-kecil", "aria-label": "Hasil berikutnya", title: "Hasil berikutnya (Enter)", disabled: true, onclick: () => pindah(1) }, ikon("bawah"))
  );
  const tutupTombol = h("button", { type: "button", class: "tombol tombol-hantu tombol-ikon tombol-kecil", "aria-label": "Tutup pencarian", title: "Tutup (Esc)", onclick: () => tutup() }, ikon("tutup"));
  const el = h("div", { class: "pdf-cari", role: "search", hidden: true }, masukan, hitung, sebelum, berikut, tutupTombol);

  // --- Penandaan -----------------------------------------------------------------------------------------------------
  function bersihkanSorotan() {
    if (adaSorotanCss()) {
      CSS.highlights.delete(SOROT);
      CSS.highlights.delete(SOROT_AKTIF);
    }
    for (const span of el.closest(".penampil-pdf")?.querySelectorAll(".pdf-cocok, .pdf-cocok-aktif") ?? []) span.classList.remove("pdf-cocok", "pdf-cocok-aktif");
  }

  /**
   * @param {HTMLElement[]} potongan
   * @param {NonNullable<ReturnType<typeof rentangItem>>} r
   * @returns {Range | null}
   */
  function bangunRentang(potongan, r) {
    const awal = potongan[r.itemAwal]?.firstChild;
    const akhir = potongan[r.itemAkhir]?.firstChild;
    if (!awal || !akhir) return null;
    const rentang = new Range();
    try {
      rentang.setStart(awal, r.dari);
      rentang.setEnd(akhir, r.sampai);
    } catch {
      return null;
    }
    return rentang;
  }

  function terapkanSorotan() {
    if (hancur) return;
    bersihkanSorotan();
    if (!pola || !hasil.length) return;
    /** @type {Range[]} */
    const biasa = [];
    /** @type {Range[]} */
    const terpilih = [];
    for (const [no, daftar] of perHalaman) {
      const potongan = o.lihat(no);
      const teks = teksBerhasil.get(no);
      // Jumlah potongan di lapisan teks harus sama dengan jumlah item teks halaman; bila tidak (batas PDF.js), tak ditandai.
      if (!potongan || !teks || potongan.length !== teks.bagian.length) continue;
      for (const c of daftar) {
        const r = rentangItem(teks, c);
        if (!r) continue;
        const ini = c === hasil[aktif];
        if (adaSorotanCss()) {
          const rentang = bangunRentang(potongan, r);
          if (rentang) (ini ? terpilih : biasa).push(rentang);
        } else {
          for (let k = r.itemAwal; k <= r.itemAkhir; k++) potongan[k]?.classList.add(ini ? "pdf-cocok-aktif" : "pdf-cocok");
        }
      }
    }
    if (adaSorotanCss()) {
      CSS.highlights.set(SOROT, new Highlight(...biasa));
      CSS.highlights.set(SOROT_AKTIF, new Highlight(...terpilih));
    }
  }
  const terapkanTertunda = tunda(terapkanSorotan, 30);

  // --- Navigasi hasil ------------------------------------------------------------------------------------------------
  /** Potongan teks tempat kecocokan aktif dimulai, bila halamannya sedang tergambar. */
  function potonganAktif() {
    const c = hasil[aktif];
    if (!c) return null;
    const potongan = o.lihat(c.no);
    const teks = teksBerhasil.get(c.no);
    const r = teks ? rentangItem(teks, c) : null;
    return potongan && r ? (potongan[r.itemAwal] ?? null) : null;
  }

  function gulirKeAktif() {
    const c = hasil[aktif];
    if (!c) return;
    const span = potonganAktif();
    if (span?.isConnected) {
      menunggu = 0;
      o.gulirKeElemen(span);
    } else {
      menunggu = c.no;
      o.keHalaman(c.no);
    }
  }

  /** @param {number} i */
  function pilih(i) {
    if (!hasil.length) return;
    aktif = (i + hasil.length) % hasil.length;
    tulisHitung();
    terapkanSorotan();
    gulirKeAktif();
  }

  /** @param {number} arah */
  function pindah(arah) {
    if (!hasil.length) return;
    pilih(aktif < 0 ? 0 : aktif + arah);
  }

  function tulisHitung() {
    sebelum.disabled = berikut.disabled = hasil.length < 2;
    if (pesan) {
      hitung.textContent = pesan;
      return;
    }
    if (!hasil.length) {
      hitung.textContent = memindai ? "Mencari…" : pola ? "Tidak ditemukan" : "";
      return;
    }
    const lebih = hasil.length >= MAKS_KECOCOKAN ? "+" : "";
    hitung.textContent = `${aktif + 1} / ${hasil.length}${lebih}`;
  }

  // --- Pencarian -----------------------------------------------------------------------------------------------------
  /** @param {string} kueri */
  async function cari(kueri) {
    const saya = ++giliran;
    pola = polaCari(kueri);
    hasil = [];
    aktif = -1;
    pesan = "";
    memindai = false;
    perHalaman.clear();
    teksBerhasil.clear();
    menunggu = 0;
    terapkanSorotan();
    if (!pola) {
      pesan = kueri.trim() ? `Ketik minimal ${MIN_KARAKTER} huruf` : "";
      tulisHitung();
      return;
    }
    memindai = true;
    tulisHitung();
    const total = o.jumlahHalaman();
    const mulaiDi = o.halamanSaatIni();
    let adaTeks = false;
    for (let no = 1; no <= total; no++) {
      if (saya !== giliran || hancur) return;
      /** @type {TeksHalaman | null} */
      let teks = null;
      try {
        teks = await o.ambilTeks(no);
      } catch {
        /* halaman yang tak terbaca dilewati */
      }
      if (saya !== giliran || hancur) return;
      if (teks) {
        if (teks.bagian.length) adaTeks = true;
        const cocok = cariDiHalaman(teks, pola, MAKS_KECOCOKAN - hasil.length);
        if (cocok.length) {
          teksBerhasil.set(no, teks);
          const daftar = cocok.map((c) => ({ no, ...c }));
          perHalaman.set(no, daftar);
          hasil.push(...daftar);
        }
      }
      // PDF hasil pindaian: halaman-halaman awal tak berteks sama sekali, jadi tak ada yang bisa dicari.
      if (no === Math.min(HALAMAN_UJI_PINDAIAN, total) && !adaTeks) {
        memindai = false;
        pesan = "PDF ini hasil pindaian: isinya tak bisa dicari.";
        tulisHitung();
        return;
      }
      // Hasil pertama pada atau sesudah halaman yang sedang dibaca langsung dibuka.
      if (aktif < 0 && hasil.length) {
        const pertama = hasil.findIndex((c) => c.no >= mulaiDi);
        if (pertama >= 0) pilih(pertama);
      }
      tulisHitung();
      terapkanTertunda();
      if (hasil.length >= MAKS_KECOCOKAN) break;
    }
    memindai = false;
    // Tak ada hasil sesudah halaman saat ini: mulai dari yang pertama di naskah.
    if (aktif < 0 && hasil.length) pilih(0);
    else tulisHitung();
    terapkanSorotan();
  }
  const cariTertunda = tunda(() => void cari(masukan.value), 350);

  masukan.addEventListener("input", () => {
    // Setiap ketikan menghentikan pemindaian yang lama seketika; yang baru dimulai sesudah jeda singkat.
    giliran++;
    cariTertunda();
  });
  masukan.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (hasil.length && pola && masukan.value.trim()) pindah(e.shiftKey ? -1 : 1);
      else void cari(masukan.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      tutup();
    }
  });

  // --- Buka dan tutup ------------------------------------------------------------------------------------------------
  /** @param {{ fokus?: boolean }} [opsi] */
  function buka({ fokus = true } = {}) {
    el.hidden = false;
    if (fokus) {
      masukan.focus();
      masukan.select();
    }
  }

  function tutup() {
    giliran++;
    el.hidden = true;
    memindai = false;
    pola = null;
    hasil = [];
    aktif = -1;
    pesan = "";
    perHalaman.clear();
    teksBerhasil.clear();
    menunggu = 0;
    masukan.value = "";
    tulisHitung();
    bersihkanSorotan();
    o.saatTutup?.();
  }

  return {
    el,
    buka,
    tutup,
    terbuka: () => !el.hidden,
    /**
     * Dipanggil penampil setelah sebuah halaman selesai (atau gagal) digambar: kecocokan di halaman itu ditandai, dan bila
     * halaman itulah yang ditunggu, kecocokan aktifnya digulirkan ke layar.
     * @param {number} no
     */
    saatHalamanSiap(no) {
      if (!pola || !hasil.length) return;
      if (perHalaman.has(no)) terapkanTertunda();
      if (menunggu === no) {
        const span = potonganAktif();
        if (span?.isConnected) {
          menunggu = 0;
          // Sorotan dipasang dulu supaya letak potongan teks sudah final saat digulirkan.
          terapkanSorotan();
          o.gulirKeElemen(span);
        }
      }
    },
    /** Setelah zoom atau lebar berubah, rentang di lapisan teks lama tak berlaku lagi. */
    segarkan: terapkanTertunda,
    hancurkan() {
      hancur = true;
      giliran++;
      bersihkanSorotan();
    },
  };
}
