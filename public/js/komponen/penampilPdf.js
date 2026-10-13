// @ts-check
/**
 * Penampil PDF untuk naskah yang diarsipkan Lexa (tab "PDF" di halaman peraturan).
 *
 * Tujuannya satu: pembaca bisa memeriksa teks hasil ekstraksi terhadap naskah aslinya, di dalam aplikasi, termasuk di
 * ponsel. Peramban ponsel tidak menampilkan PDF di dalam halaman (iOS hanya halaman pertama, Chrome Android hanya menawarkan
 * unduhan), jadi halamannya digambar sendiri dengan PDF.js (public/vendor/pdfjs, dimuat hanya saat tab ini dibuka).
 *
 * Yang dikerjakan: halaman digambar malas (hanya yang dekat layar, selebihnya dilepas agar memori ponsel aman), lapisan
 * teks untuk memilih dan menyalin, navigasi halaman, perbesar/perkecil, dan `keHalamanPasal`: membuka halaman tempat sebuah
 * pasal dimulai, dicari di lapisan teks PDF-nya (lihat pdfPasal.js). PDF hasil pindaian tanpa lapisan teks tetap bisa dibaca,
 * hanya pencarian pasalnya yang tak tersedia, dan itu dikatakan terus terang.
 *
 * "Periksa pasal" memindai SELURUH batang tubuh PDF dan membandingkan nomor pasal yang judulnya tampak di sana dengan pasal yang
 * tersimpan di Lexa: pasal yang ada di PDF tetapi tak ada di Lexa kemungkinan terlewat oleh ekstraksi, dan sebaliknya. Itu
 * mengubah "ekstraksi mungkin keliru" menjadi daftar yang bisa diperiksa satu per satu (setiap nomor membuka halamannya).
 *
 * CSP aplikasi ketat (tanpa eval, tanpa WebAssembly, tanpa gaya sebaris), jadi PDF.js dipanggil dengan `useWasm: false`
 * (dekoder JBIG2 dan JPEG 2000 versi JavaScript, dimuat dari public/vendor/pdfjs/wasm) dan ukuran dipasang lewat CSSOM.
 * PDF.js 6 tidak lagi memakai eval, jadi tak ada opsi yang perlu dimatikan untuk itu.
 */

import { h, tunda } from "../dom.js";
import { ikon } from "./ikon.js";
import { bandingkanPasal, catatHalamanBadan } from "../pdfPasal.js";
import { rapikanNomorPasal } from "../format.js";
import { penyimpanan } from "../state.js";

const URL_INTI = "/vendor/pdfjs/pdf.min.mjs";
const URL_PEKERJA = "/vendor/pdfjs/pdf.worker.min.mjs";
const URL_WASM = "/vendor/pdfjs/wasm/";

/** Lebar halaman terbesar yang masih nyaman dibaca pada "pas lebar", dalam piksel CSS. */
const LEBAR_MAKS = 900;
const ZOOM_MIN = 0.5;
const ZOOM_MAKS = 3;
const LANGKAH_ZOOM = 1.25;
/** Piksel kanvas terbanyak per halaman (lebar x tinggi): menjaga memori ponsel. */
const MAKS_PIKSEL = 12_000_000;
const MAKS_DPR = 2;
/** Halaman digambar bila berjarak sampai ini (kali tinggi layar) dari layar; yang lebih jauh dilepas. */
const JARAK_GAMBAR = "120%";
/** Berapa halaman digambar bersamaan. */
const MAKS_BERSAMAAN = 2;
/** Bila sebanyak ini halaman pertama tak berisi teks sama sekali, PDF dianggap hasil pindaian dan pemindaian pasal dihentikan. */
const HALAMAN_UJI_PINDAIAN = 8;
const PETUNJUK_PERIKSA = "Bandingkan judul pasal di PDF dengan teks di Lexa";
/** Paling banyak nomor yang diperinci per daftar hasil pemeriksaan; sisanya disebut jumlahnya. */
const MAKS_NOMOR_TAMPIL = 60;

/** @type {Promise<any> | null} */
let janjiPustaka = null;

/**
 * Muat PDF.js sekali per sesi. Kegagalan (jaringan putus, berkas tak ada) tidak disimpan, supaya bisa dicoba lagi.
 * @returns {Promise<any>}
 */
export function muatPdfjs() {
  if (!janjiPustaka) {
    const alamat = /** @type {string} */ (URL_INTI);
    janjiPustaka = import(alamat).then(
      (lib) => {
        lib.GlobalWorkerOptions.workerSrc = URL_PEKERJA;
        return lib;
      },
      (e) => {
        janjiPustaka = null;
        throw e;
      },
    );
  }
  return janjiPustaka;
}

/**
 * @typedef {{
 *   no: number, el: HTMLElement, kanvas: HTMLCanvasElement | null, teks: HTMLElement,
 *   status: "kosong" | "antre" | "proses" | "siap", skala: number, giliran: number, tugas: any,
 *   ukuran: { l: number, t: number }
 * }} Halaman
 */

/**
 * @param {string} nama
 * @param {string} label
 * @param {() => void} saat
 */
function tombolAlat(nama, label, saat) {
  return h("button", { type: "button", class: "tombol tombol-ikon tombol-kecil", "aria-label": label, title: label, onclick: saat }, ikon(nama));
}

/**
 * @param {{ url: string, nomorPasalLexa?: () => string[] }} opsi `url`: alamat PDF di asal yang sama (/api/dokumen/pdf?uri=...);
 *   `nomorPasalLexa`: nomor pasal batang tubuh yang tersimpan di Lexa, untuk "Periksa pasal"
 */
export function buatPenampilPdf({ url, nomorPasalLexa = () => [] }) {
  /** @type {any} */
  let lib = null;
  /** @type {any} */
  let tugasDokumen = null;
  /** @type {any} */
  let pdf = null;
  /** @type {Promise<void> | null} */
  let janjiMuat = null;
  let hancur = false;

  /** @type {Halaman[]} */
  const hal = [];
  let zoom = 1;
  let skalaDasar = 1;
  let ukuranAwal = { l: 595, t: 842 };
  let saatIni = 1;
  /** Halaman yang dekat layar (menurut pengamat bermargin besar). */
  const dekat = new Set();
  /** Rasio keterlihatan per halaman (pengamat tanpa margin), untuk menentukan halaman yang sedang dibaca. */
  const rasio = new Map();
  /** @type {Halaman[]} */
  const antre = [];
  let berjalan = 0;

  // --- Indeks pasal -> halaman ----------------------------------------------
  /** @type {Map<string, number>} */
  const indeks = new Map();
  let sudahDipindai = 0;
  let tanpaTeks = false;
  /** Judul penjelasan sudah ditemui: batang tubuh selesai dipindai, sisanya tak perlu dibaca. */
  let akhirBadan = false;
  let jumlahItemAwal = 0;
  let rantaiPindai = Promise.resolve();
  const kunciIndeks = `lexa:pdf-indeks:v2:${url}`;

  // --- Elemen ---------------------------------------------------------------
  const status = h("div", { class: "pdf-status", role: "status", "aria-live": "polite" });
  const daftar = h("div", { class: "pdf-daftar" });
  const masukan = /** @type {HTMLInputElement} */ (
    h("input", { class: "input pdf-hal-input", type: "number", min: "1", step: "1", inputmode: "numeric", "aria-label": "Nomor halaman", disabled: true })
  );
  const total = h("span", { class: "pdf-hal-total" }, "/ –");
  const labelZoom = h("span", { class: "pdf-zoom", "aria-live": "polite" }, "100%");
  const sebelum = tombolAlat("kiri", "Halaman sebelumnya", () => keHalaman(saatIni - 1));
  const berikut = tombolAlat("kanan", "Halaman berikutnya", () => keHalaman(saatIni + 1));
  const kecil = tombolAlat("kurang", "Perkecil", () => ubahZoom(1 / LANGKAH_ZOOM));
  const besar = tombolAlat("tambah", "Perbesar", () => ubahZoom(LANGKAH_ZOOM));
  const pas = tombolAlat("lebarHalaman", "Pas lebar", () => aturZoom(1));
  const buka = h("a", { class: "tombol tombol-kecil pdf-buka", href: url, target: "_blank", rel: "noopener", "aria-label": "Buka PDF di tab baru", title: "Buka PDF di tab baru" }, ikon("luar"), h("span", { class: "pdf-buka-teks" }, "Buka"));
  const bilah = h(
    "div",
    { class: "pdf-bilah", role: "toolbar", "aria-label": "Kontrol PDF" },
    sebelum,
    h("label", { class: "pdf-hal" }, h("span", { class: "sr-only" }, "Halaman"), masukan, total),
    berikut,
    h("span", { class: "pdf-spasi" }),
    kecil,
    labelZoom,
    besar,
    pas,
    buka,
  );
  for (const t of [sebelum, berikut, kecil, besar, pas]) /** @type {HTMLButtonElement} */ (t).disabled = true;

  const labelPeriksa = h("span", null, "Periksa pasal");
  const tombolPeriksa = /** @type {HTMLButtonElement} */ (
    h("button", { type: "button", class: "tombol tombol-kecil", disabled: true, onclick: () => void periksaPasal() }, ikon("centang"), labelPeriksa)
  );
  const petunjukPeriksa = h("span", { class: "pdf-periksa-petunjuk redup" }, PETUNJUK_PERIKSA);
  const hasilPeriksa = h("div", { class: "pdf-periksa-hasil", role: "status", "aria-live": "polite" });
  hasilPeriksa.hidden = true;
  const blokPeriksa = h("div", { class: "pdf-periksa" }, h("div", { class: "pdf-periksa-bar" }, tombolPeriksa, petunjukPeriksa), hasilPeriksa);

  const akar = h("section", { class: "penampil-pdf", "aria-label": "Penampil PDF" }, bilah, blokPeriksa, status, daftar);

  /** @param {string} teks @param {boolean} [galat] */
  function tulisStatus(teks, galat = false) {
    status.replaceChildren(teks ? document.createTextNode(teks) : "");
    status.classList.toggle("pdf-status-galat", galat);
    status.hidden = !teks;
  }
  status.hidden = true;

  // --- Ukuran dan skala -----------------------------------------------------
  const skala = () => skalaDasar * zoom;

  function hitungSkalaDasar() {
    const lebarWadah = daftar.clientWidth || akar.clientWidth || LEBAR_MAKS;
    return Math.min(lebarWadah, LEBAR_MAKS) / ukuranAwal.l;
  }

  /** @param {Halaman} p */
  function terapkanUkuran(p) {
    const s = skala();
    Object.assign(p.el.style, { width: `${Math.floor(p.ukuran.l * s)}px`, height: `${Math.floor(p.ukuran.t * s)}px` });
    p.el.style.setProperty("--total-scale-factor", String(s));
  }

  function terapkanSemuaUkuran() {
    for (const p of hal) terapkanUkuran(p);
    labelZoom.textContent = `${Math.round(zoom * 100)}%`;
    /** @type {HTMLButtonElement} */ (kecil).disabled = zoom <= ZOOM_MIN + 1e-6;
    /** @type {HTMLButtonElement} */ (besar).disabled = zoom >= ZOOM_MAKS - 1e-6;
  }

  /** Ubah zoom dengan mempertahankan halaman yang sedang dibaca di tempatnya. @param {number} nilai */
  function aturZoom(nilai) {
    const baru = Math.min(ZOOM_MAKS, Math.max(ZOOM_MIN, nilai));
    if (Math.abs(baru - zoom) < 1e-6) return;
    const acuan = hal[saatIni - 1];
    const sebelumTop = acuan ? acuan.el.getBoundingClientRect().top : 0;
    zoom = baru;
    terapkanSemuaUkuran();
    if (acuan) window.scrollBy(0, acuan.el.getBoundingClientRect().top - sebelumTop);
    for (const p of hal) if (p.status === "siap" && p.skala !== skala()) jadwalkanUlang(p);
  }

  /** @param {number} faktor */
  function ubahZoom(faktor) {
    aturZoom(zoom * faktor);
  }

  // --- Menggambar -----------------------------------------------------------
  /** @param {Halaman} p */
  function jadwalkanUlang(p) {
    if (dekat.has(p.no)) jadwalkan(p);
  }

  /** @param {Halaman} p */
  function jadwalkan(p) {
    if (hancur || p.status === "antre" || p.status === "proses") return;
    if (p.status === "siap" && p.skala === skala()) return;
    p.status = "antre";
    antre.push(p);
    jalankan();
  }

  function jalankan() {
    while (berjalan < MAKS_BERSAMAAN && antre.length) {
      // Yang terdekat dengan halaman yang sedang dibaca lebih dulu; yang sudah menjauh dari layar dibuang dari antrean.
      let terbaik = -1;
      for (let i = antre.length - 1; i >= 0; i--) {
        if (!dekat.has(antre[i].no)) {
          antre[i].status = antre[i].kanvas && antre[i].skala ? "siap" : "kosong";
          antre.splice(i, 1);
        }
      }
      for (let i = 0; i < antre.length; i++) {
        if (terbaik < 0 || Math.abs(antre[i].no - saatIni) < Math.abs(antre[terbaik].no - saatIni)) terbaik = i;
      }
      if (terbaik < 0) return;
      const [p] = antre.splice(terbaik, 1);
      berjalan++;
      gambar(p).finally(() => {
        berjalan--;
        jalankan();
      });
    }
  }

  /** @param {Halaman} p */
  async function gambar(p) {
    const giliran = ++p.giliran;
    p.status = "proses";
    try {
      const page = await pdf.getPage(p.no);
      if (hancur || giliran !== p.giliran) return;
      const s = skala();
      const vp = page.getViewport({ scale: s });
      // Ukuran sebenarnya bisa berbeda dari halaman pertama (halaman landscape, lampiran).
      if (Math.abs(vp.width / s - p.ukuran.l) > 0.5 || Math.abs(vp.height / s - p.ukuran.t) > 0.5) {
        p.ukuran = { l: vp.width / s, t: vp.height / s };
        terapkanUkuran(p);
      }
      let dpr = Math.min(window.devicePixelRatio || 1, MAKS_DPR);
      if (vp.width * dpr * vp.height * dpr > MAKS_PIKSEL) dpr = Math.sqrt(MAKS_PIKSEL / (vp.width * vp.height));
      // Digambar ke kanvas lepas lalu ditukar sekaligus, supaya halaman lama tetap terlihat sampai yang baru siap.
      const baru = /** @type {HTMLCanvasElement} */ (document.createElement("canvas"));
      baru.width = Math.max(1, Math.floor(vp.width * dpr));
      baru.height = Math.max(1, Math.floor(vp.height * dpr));
      p.tugas = page.render({ canvas: baru, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      await p.tugas.promise;
      if (hancur || giliran !== p.giliran) return;
      baru.className = "pdf-kanvas";
      baru.setAttribute("aria-hidden", "true");
      if (p.kanvas) p.el.replaceChild(baru, p.kanvas);
      else p.el.insertBefore(baru, p.teks);
      p.kanvas = baru;

      // Lapisan teks (memilih dan menyalin). Gagalnya tidak menggagalkan halamannya.
      try {
        p.teks.replaceChildren();
        const lapis = new lib.TextLayer({ textContentSource: page.streamTextContent(), container: p.teks, viewport: vp });
        await lapis.render();
      } catch {
        /* halaman tetap terbaca tanpa lapisan teks */
      }
      p.skala = s;
      p.status = "siap";
      page.cleanup();
    } catch (e) {
      if (e && /** @type {any} */ (e).name === "RenderingCancelledException") return;
      if (giliran === p.giliran) {
        p.status = "kosong";
        p.el.classList.add("pdf-halaman-galat");
        p.el.setAttribute("data-galat", "Halaman ini gagal digambar.");
      }
    } finally {
      p.tugas = null;
    }
  }

  /** Lepas kanvas halaman yang jauh dari layar. @param {Halaman} p */
  function lepas(p) {
    p.giliran++;
    try {
      p.tugas?.cancel();
    } catch {
      /* sudah selesai */
    }
    p.tugas = null;
    if (p.kanvas) {
      p.kanvas.width = 0;
      p.kanvas.height = 0;
      p.kanvas.remove();
      p.kanvas = null;
    }
    p.teks.replaceChildren();
    p.skala = 0;
    p.status = "kosong";
    p.el.classList.remove("pdf-halaman-galat");
    p.el.removeAttribute("data-galat");
  }

  // --- Pengamat ---------------------------------------------------------------
  /** @type {IntersectionObserver | null} */
  let pengamatDekat = null;
  /** @type {IntersectionObserver | null} */
  let pengamatLihat = null;

  const proses = tunda(() => {
    if (hancur) return;
    for (const p of hal) {
      if (dekat.has(p.no)) jadwalkan(p);
      else if (p.status !== "kosong") lepas(p);
    }
  }, 60);

  function pasangPengamat() {
    pengamatDekat = new IntersectionObserver(
      (entri) => {
        for (const e of entri) {
          const no = Number(/** @type {HTMLElement} */ (e.target).dataset.halaman);
          if (e.isIntersecting) dekat.add(no);
          else dekat.delete(no);
        }
        proses();
      },
      { rootMargin: `${JARAK_GAMBAR} 0px ${JARAK_GAMBAR} 0px` },
    );
    pengamatLihat = new IntersectionObserver(
      (entri) => {
        for (const e of entri) rasio.set(Number(/** @type {HTMLElement} */ (e.target).dataset.halaman), e.isIntersecting ? e.intersectionRatio : 0);
        let terbaik = saatIni;
        let nilai = -1;
        for (const [no, r] of rasio) {
          if (r > nilai || (r === nilai && no < terbaik)) {
            terbaik = no;
            nilai = r;
          }
        }
        if (nilai > 0 && terbaik !== saatIni) catatHalaman(terbaik);
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const p of hal) {
      pengamatDekat.observe(p.el);
      pengamatLihat.observe(p.el);
    }
  }

  /** @param {number} no */
  function catatHalaman(no) {
    saatIni = no;
    masukan.value = String(no);
    /** @type {HTMLButtonElement} */ (sebelum).disabled = no <= 1;
    /** @type {HTMLButtonElement} */ (berikut).disabled = no >= hal.length;
  }

  /**
   * Buka halaman `n` (dijepit ke rentang yang ada). Mengembalikan halaman yang dibuka, atau null bila PDF belum siap.
   * Letaknya dihitung dari bilah alat yang lengket (tab di atasnya ikut menentukan), bukan lewat scrollIntoView: halaman
   * sudah punya `scroll-padding-top` untuk header lengket, dan menambahkan scroll-margin di atasnya melipatgandakan jaraknya.
   * @param {number} n
   */
  function keHalaman(n) {
    if (!hal.length) return null;
    const no = Math.min(hal.length, Math.max(1, Math.round(n) || 1));
    catatHalaman(no);
    const batas = (parseFloat(getComputedStyle(bilah).top) || 0) + bilah.offsetHeight + 8;
    window.scrollTo({ top: hal[no - 1].el.getBoundingClientRect().top + window.scrollY - batas, behavior: "auto" });
    return no;
  }

  /** Tinggi tab di atas bilah alat (bila ada), supaya bilah menempel tepat di bawahnya apa pun ukuran hurufnya. */
  function ukurTab() {
    const tinggiTab = document.querySelector(".tab-daftar")?.getBoundingClientRect().height;
    if (tinggiTab) akar.style.setProperty("--tinggi-tab-pdf", `${Math.round(tinggiTab)}px`);
  }

  // --- Pasal -> halaman -------------------------------------------------------
  function simpanIndeks() {
    try {
      penyimpanan.tulis(kunciIndeks, JSON.stringify({ n: hal.length, s: sudahDipindai, t: tanpaTeks, a: akhirBadan, p: [...indeks] }));
    } catch {
      /* penyimpanan penuh atau dimatikan: pemindaian saja yang diulang */
    }
  }

  function pulihkanIndeks() {
    try {
      const mentah = penyimpanan.baca(kunciIndeks);
      if (!mentah) return;
      const o = JSON.parse(mentah);
      if (o?.n !== hal.length || !Array.isArray(o.p)) return;
      for (const [nomor, halaman] of o.p) if (typeof nomor === "string" && Number.isInteger(halaman)) indeks.set(nomor, halaman);
      sudahDipindai = Math.min(Number(o.s) || 0, hal.length);
      tanpaTeks = Boolean(o.t);
      akhirBadan = Boolean(o.a);
    } catch {
      /* indeks rusak: dipindai ulang */
    }
  }

  /** Apakah masih ada halaman batang tubuh yang belum dipindai. */
  const bisaMemindai = () => Boolean(pdf) && !hancur && !tanpaTeks && !akhirBadan && sudahDipindai < hal.length;

  /** Pindai satu halaman berikutnya; halaman yang tak terbaca dilewati. */
  async function pindaiHalamanBerikut() {
    const no = ++sudahDipindai;
    try {
      const page = await pdf.getPage(no);
      const isi = await page.getTextContent();
      jumlahItemAwal += no <= HALAMAN_UJI_PINDAIAN ? isi.items.length : 0;
      if (catatHalamanBadan(indeks, no, isi.items).penjelasan) akhirBadan = true;
      page.cleanup();
    } catch {
      /* halaman yang tak terbaca dilewati */
    }
    if (no === Math.min(HALAMAN_UJI_PINDAIAN, hal.length) && jumlahItemAwal === 0) tanpaTeks = true;
  }

  /**
   * Halaman tempat pasal `nomor` dimulai, dicari di lapisan teks PDF (dipindai berurutan dari halaman terakhir yang sudah
   * dipindai, berhenti begitu ketemu atau begitu bagian penjelasan dimulai). null bila tak ada, atau PDF-nya hasil pindaian
   * tanpa lapisan teks.
   * @param {string} nomor
   * @returns {Promise<number | null>}
   */
  function cariHalamanPasal(nomor) {
    const kunci = rapikanNomorPasal(String(nomor).replace(/\s+/g, "").toUpperCase());
    rantaiPindai = rantaiPindai.then(async () => {
      while (bisaMemindai() && !indeks.has(kunci)) await pindaiHalamanBerikut();
      simpanIndeks();
    });
    return rantaiPindai.then(() => indeks.get(kunci) ?? null);
  }

  // --- Periksa pasal: PDF dibandingkan dengan Lexa ------------------------------------------------------------------
  let periksaBerjalan = false;
  let periksaDibatalkan = false;
  /** Ringkasan hasil terakhir, ditampilkan di baris tombol sampai pemeriksaan berikutnya. */
  let ringkasPeriksa = "";

  /** @param {string} teks */
  function tulisTombolPeriksa(teks) {
    labelPeriksa.textContent = teks;
  }

  /** Daftar nomor sebagai tombol (membuka halaman PDF-nya) atau butir polos. @param {string[]} nomor @param {boolean} bisaBuka */
  function daftarNomor(nomor, bisaBuka) {
    const tampil = nomor.slice(0, MAKS_NOMOR_TAMPIL);
    return h(
      "div",
      { class: "pdf-nomor-daftar" },
      tampil.map((n) => {
        const halaman = indeks.get(n);
        return bisaBuka && halaman
          ? h("button", { type: "button", class: "chip pdf-nomor", "aria-label": `Pasal ${n}, buka halaman ${halaman} PDF`, title: `Buka halaman ${halaman}`, onclick: () => keHalaman(halaman) }, n)
          : h("span", { class: "chip pdf-nomor pdf-nomor-polos" }, n);
      }),
      nomor.length > tampil.length ? h("span", { class: "redup" }, ` dan ${nomor.length - tampil.length} lainnya`) : null,
    );
  }

  /** @param {boolean} sebagian pemeriksaan dibatalkan sebelum seluruh batang tubuh terbaca */
  function tampilkanHasilPeriksa(sebagian) {
    const bagian = [];
    if (sebagian && indeks.size === 0) {
      bagian.push(h("p", null, h("strong", null, "Pemeriksaan dibatalkan"), " sebelum ada judul pasal yang terbaca."));
    } else if (tanpaTeks) {
      bagian.push(h("p", null, h("strong", null, "PDF ini hasil pindaian tanpa lapisan teks."), " Judul pasalnya tak bisa dibaca otomatis, jadi pemeriksaan tak dapat dilakukan. Bandingkan dengan membaca halamannya."));
    } else {
      const lexa = nomorPasalLexa();
      const r = bandingkanPasal(indeks.keys(), lexa);
      if (r.pdf === 0) {
        bagian.push(h("p", null, h("strong", null, "Tidak ada judul pasal yang terbaca di teks PDF ini."), " Mungkin naskahnya tidak berbab-pasal, atau judulnya tak berdiri sendiri di barisnya."));
      } else {
        bagian.push(
          h(
            "p",
            null,
            h("strong", null, `PDF memuat ${r.pdf} judul pasal`),
            r.lexa ? `; Lexa memuat ${r.lexa} pasal, ${r.sama} di antaranya bernomor sama.` : "; Lexa belum menyimpan pasal peraturan ini.",
          ),
        );
        if (!r.hanyaPdf.length && !r.hanyaLexa.length && r.lexa) {
          bagian.push(h("p", { class: "pdf-periksa-baik" }, ikon("centang"), " Semua nomor pasal selaras."));
        }
        if (r.hanyaPdf.length && r.lexa) {
          bagian.push(
            h("p", { class: "pdf-periksa-judul" }, `Ada di PDF, tidak ada di Lexa (${r.hanyaPdf.length}). Kemungkinan terlewat oleh ekstraksi; ketuk untuk membuka halamannya:`),
            daftarNomor(r.hanyaPdf, true),
          );
        }
        if (r.hanyaLexa.length) {
          bagian.push(
            h("p", { class: "pdf-periksa-judul" }, `Ada di Lexa, judulnya tak tampak di PDF (${r.hanyaLexa.length}). Bisa nomor yang salah terbaca, atau judulnya tak berdiri sendiri di barisnya:`),
            daftarNomor(r.hanyaLexa, false),
          );
        }
      }
      if (sebagian) bagian.push(h("p", { class: "redup" }, `Pemeriksaan dibatalkan setelah ${sudahDipindai} dari ${hal.length} halaman dibaca; hasil ini sebagian.`));
      else if (akhirBadan) bagian.push(h("p", { class: "redup" }, "Hanya batang tubuh yang dibandingkan; bagian penjelasan tidak dihitung."));
    }
    if (indeks.size) bagian.push(h("p", { class: "redup" }, "Yang dibandingkan hanya nomor pasal. Isi pasal tetap perlu dibaca di halaman PDF."));
    hasilPeriksa.replaceChildren(...bagian);
    hasilPeriksa.hidden = false;
    // Ringkasannya juga di baris tombol, supaya terbaca tanpa menggulir; lalu rincinya digulir ke bawah bilah alat bila tertutup.
    const r = tanpaTeks ? null : bandingkanPasal(indeks.keys(), nomorPasalLexa());
    ringkasPeriksa = r && indeks.size && r.lexa ? (r.hanyaPdf.length || r.hanyaLexa.length ? `${r.hanyaPdf.length} hanya di PDF, ${r.hanyaLexa.length} hanya di Lexa` : "Semua nomor pasal selaras") : "";
    requestAnimationFrame(() => {
      if (hancur) return;
      const kotak = hasilPeriksa.getBoundingClientRect();
      const batas = (parseFloat(getComputedStyle(bilah).top) || 0) + bilah.offsetHeight + 8;
      if (kotak.top < batas || kotak.bottom > window.innerHeight - 80) window.scrollTo({ top: kotak.top + window.scrollY - batas, behavior: "auto" });
    });
  }

  /**
   * Pindai seluruh batang tubuh PDF dan tampilkan perbandingannya dengan pasal di Lexa. Dipanggil lagi saat berjalan: dibatalkan.
   * @returns {Promise<void>}
   */
  async function periksaPasal() {
    if (periksaBerjalan) {
      periksaDibatalkan = true;
      tulisTombolPeriksa("Membatalkan…");
      return;
    }
    // Ditandai berjalan sebelum menunggu apa pun, supaya ketukan kedua yang menyusul langsung membatalkan (bukan memulai lagi).
    periksaBerjalan = true;
    periksaDibatalkan = false;
    tulisTombolPeriksa("Batalkan");
    hasilPeriksa.hidden = true;
    ringkasPeriksa = "";
    const lapor = () => {
      petunjukPeriksa.textContent = `Memindai halaman ${sudahDipindai} dari ${hal.length}…`;
    };
    try {
      if (janjiMuat) await janjiMuat;
      if (!hal.length || hancur) return;
      lapor();
      rantaiPindai = rantaiPindai.then(async () => {
        while (bisaMemindai() && !periksaDibatalkan) {
          await pindaiHalamanBerikut();
          lapor();
        }
        simpanIndeks();
      });
      await rantaiPindai;
      if (hancur) return;
      tampilkanHasilPeriksa(periksaDibatalkan && bisaMemindai());
    } finally {
      periksaBerjalan = false;
      petunjukPeriksa.textContent = !hasilPeriksa.hidden && ringkasPeriksa ? ringkasPeriksa : PETUNJUK_PERIKSA;
      tulisTombolPeriksa(hal.length && !hasilPeriksa.hidden ? "Periksa ulang" : "Periksa pasal");
    }
  }

  /**
   * Buka halaman tempat pasal dimulai. Hasilnya: halaman yang dibuka, atau alasan gagal.
   * @param {string} nomor
   * @returns {Promise<{ halaman: number } | { alasan: "belum_siap" | "pindaian" | "tidak_ada" }>}
   */
  async function keHalamanPasal(nomor) {
    if (janjiMuat) await janjiMuat;
    if (!hal.length) return { alasan: "belum_siap" };
    const halaman = await cariHalamanPasal(nomor);
    if (halaman) {
      keHalaman(halaman);
      return { halaman };
    }
    return { alasan: tanpaTeks ? "pindaian" : "tidak_ada" };
  }

  // --- Memuat -----------------------------------------------------------------
  /** @param {unknown} e */
  function pesanGalat(e) {
    const nama = /** @type {any} */ (e)?.name;
    if (nama === "PasswordException") return "PDF ini dilindungi kata sandi dan tidak bisa ditampilkan di sini.";
    if (nama === "InvalidPDFException") return "Berkas PDF ini rusak atau bukan PDF.";
    if (nama === "MissingPDFException" || /** @type {any} */ (e)?.status === 404) return "Berkas PDF peraturan ini tidak ditemukan di Lexa.";
    if (typeof navigator !== "undefined" && navigator.onLine === false) return "Anda sedang luring, dan PDF ini belum tersimpan di perangkat.";
    return "PDF tidak bisa dimuat. Periksa sambungan Anda lalu coba lagi.";
  }

  function tampilkanGalat(/** @type {unknown} */ e) {
    status.replaceChildren(
      pesanGalat(e),
      " ",
      h("button", { type: "button", class: "tombol tombol-kecil", onclick: () => {
        janjiMuat = null;
        void muat();
      } }, "Coba lagi"),
    );
    status.classList.add("pdf-status-galat");
    status.hidden = false;
  }

  /** Muat PDF.js dan dokumennya; aman dipanggil berulang. @returns {Promise<void>} */
  function muat() {
    if (janjiMuat) return janjiMuat;
    janjiMuat = (async () => {
      tulisStatus("Memuat penampil PDF…");
      try {
        lib = await muatPdfjs();
        if (hancur) return;
        tugasDokumen = lib.getDocument({
          url,
          useWasm: false,
          wasmUrl: URL_WASM,
          enableXfa: false,
          // Hanya galat yang dicetak ke konsol; peringatan internal PDF.js ("Indexing all PDF objects" pada berkas yang
          // tabelnya harus dibangun ulang) bukan urusan pembaca.
          verbosity: 0,
          // Jangan mengunduh seluruh berkas di latar belakang: PDF hasil pindaian bisa puluhan MB, dan paket data ponsel terbatas.
          disableAutoFetch: true,
        });
        tugasDokumen.onProgress = (/** @type {{ loaded: number, total?: number }} */ k) => {
          if (k.total) tulisStatus(`Memuat PDF… ${Math.min(100, Math.round((k.loaded / k.total) * 100))}%`);
        };
        pdf = await tugasDokumen.promise;
        if (hancur) {
          void pdf.destroy();
          return;
        }
        const pertama = await pdf.getPage(1);
        const vp = pertama.getViewport({ scale: 1 });
        ukuranAwal = { l: vp.width, t: vp.height };
        pertama.cleanup();

        for (let i = 1; i <= pdf.numPages; i++) {
          const teks = h("div", { class: "textLayer pdf-teks" });
          const el = h("div", { class: "pdf-halaman", dataset: { halaman: i }, role: "group", "aria-label": `Halaman ${i} dari ${pdf.numPages}` }, teks);
          el.style.setProperty("--scale-round-x", "1px");
          el.style.setProperty("--scale-round-y", "1px");
          hal.push({ no: i, el, kanvas: null, teks, status: "kosong", skala: 0, giliran: 0, tugas: null, ukuran: { ...ukuranAwal } });
        }
        ukurTab();
        skalaDasar = hitungSkalaDasar();
        daftar.replaceChildren(...hal.map((p) => p.el));
        terapkanSemuaUkuran();
        total.textContent = `/ ${hal.length}`;
        masukan.max = String(hal.length);
        masukan.disabled = false;
        for (const t of [sebelum, berikut, pas]) /** @type {HTMLButtonElement} */ (t).disabled = false;
        tombolPeriksa.disabled = false;
        catatHalaman(1);
        pulihkanIndeks();
        pasangPengamat();
        tulisStatus("");
      } catch (e) {
        if (!hancur) tampilkanGalat(e);
        janjiMuat = null;
      }
    })();
    return janjiMuat;
  }

  masukan.addEventListener("change", () => keHalaman(Number(masukan.value)));
  masukan.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      keHalaman(Number(masukan.value));
      masukan.blur();
    }
  });

  // Lebar layar berubah (putar ponsel, ubah ukuran jendela): "pas lebar" ikut menyesuaikan.
  const saatUbahUkuran = tunda(() => {
    if (!hal.length || hancur) return;
    ukurTab();
    const baru = hitungSkalaDasar();
    if (Math.abs(baru - skalaDasar) / skalaDasar < 0.02) return;
    const acuan = hal[saatIni - 1];
    const sebelumTop = acuan.el.getBoundingClientRect().top;
    skalaDasar = baru;
    terapkanSemuaUkuran();
    window.scrollBy(0, acuan.el.getBoundingClientRect().top - sebelumTop);
    for (const p of hal) if (p.status === "siap" && p.skala !== skala()) jadwalkanUlang(p);
  }, 150);
  window.addEventListener("resize", saatUbahUkuran);

  /** Hentikan semuanya dan lepaskan memori; dipanggil saat halaman peraturan ditinggalkan. */
  function hancurkan() {
    hancur = true;
    window.removeEventListener("resize", saatUbahUkuran);
    pengamatDekat?.disconnect();
    pengamatLihat?.disconnect();
    for (const p of hal) lepas(p);
    antre.length = 0;
    try {
      void tugasDokumen?.destroy();
    } catch {
      /* sudah dibuang */
    }
    pdf = null;
  }

  return {
    el: akar,
    muat,
    keHalaman,
    keHalamanPasal,
    cariHalamanPasal,
    periksaPasal,
    hancurkan,
    /** Jumlah halaman, 0 sebelum PDF termuat. */
    jumlahHalaman: () => hal.length,
    /** Halaman yang sedang dibaca. */
    halamanSaatIni: () => saatIni,
  };
}
