// @ts-check
/**
 * Penampil PDF untuk naskah yang diarsipkan Lexa (tab "PDF" di halaman peraturan): peraturan dibaca langsung dari PDF resminya.
 *
 * Peramban ponsel tidak menampilkan PDF di dalam halaman (iOS hanya halaman pertama, Chrome Android hanya menawarkan unduhan),
 * jadi halamannya digambar sendiri dengan PDF.js (public/vendor/pdfjs, dimuat hanya saat penampil dipakai) di dalam penggulir
 * sendiri, bukan di gulir halaman, supaya cubit-zoom dan penggulirannya bisa dikendalikan sepenuhnya.
 *
 * Yang dikerjakan:
 *  - halaman digambar malas (hanya yang dekat layar; selebihnya dilepas agar memori ponsel aman), lapisan teks untuk memilih
 *    dan menyalin;
 *  - bilah alat: daftar pasal (lembar) dengan nomor halamannya, nomor halaman, cari di PDF, zoom, layar penuh, dan menu
 *    (halaman gelap, periksa pasal, unduh, buka di tab baru);
 *  - zoom dengan cubitan dua jari, ketuk dua kali, Ctrl + roda, dan tombol; titik di bawah jari tetap di tempatnya;
 *  - `keHalamanPasal`: membuka halaman tempat sebuah pasal dimulai. Halaman yang disimpan server per pasal (articles.halaman)
 *    dipakai lebih dulu dan DIPERIKSA terhadap lapisan teks PDF-nya; bila tak cocok atau belum ada, judul pasal dicari di teks PDF
 *    (indeksPasalPdf.js). PDF hasil pindaian tanpa lapisan teks tetap bisa dibaca, hanya pencarian dan pemeriksaan pasalnya yang
 *    tak tersedia, dan itu dikatakan terus terang;
 *  - halaman terakhir dibaca diingat per PDF di perangkat ini.
 *
 * CSP aplikasi ketat (tanpa eval, tanpa WebAssembly, tanpa gaya sebaris), jadi PDF.js dipanggil dengan `useWasm: false`
 * (dekoder JBIG2 dan JPEG 2000 versi JavaScript, dimuat dari public/vendor/pdfjs/wasm) dan ukuran dipasang lewat CSSOM.
 * PDF.js 6 tidak lagi memakai eval, jadi tak ada opsi yang perlu dimatikan untuk itu.
 */

import { h, tunda } from "../dom.js";
import { ikon } from "./ikon.js";
import { bukaLembarAksi } from "./lembar.js";
import { toast } from "./toast.js";
import { buatPencarian } from "./pdfPencarian.js";
import { bukaDaftarPasal } from "./pdfDaftarPasal.js";
import { bukaPeriksa } from "./pdfPeriksa.js";
import { buatIndeksPasal } from "../indeksPasalPdf.js";
import { bangunTeksHalaman, itemDariTeks } from "../pdfCari.js";
import { pasangGestur } from "../pdfGestur.js";
import { halamanTerlihat, indeksPertamaDi, jepit } from "../pdfZoom.js";
import { penyimpanan } from "../state.js";

const URL_INTI = "/vendor/pdfjs/pdf.min.mjs";
const URL_PEKERJA = "/vendor/pdfjs/pdf.worker.min.mjs";
const URL_WASM = "/vendor/pdfjs/wasm/";

/** Lebar halaman terbesar yang masih nyaman dibaca pada "pas lebar", dalam piksel CSS. */
const LEBAR_MAKS = 900;
const ZOOM_MIN = 0.5;
const ZOOM_MAKS = 4;
const LANGKAH_ZOOM = 1.25;
/** Piksel kanvas terbanyak per halaman (lebar x tinggi): menjaga memori ponsel (batas kanvas iOS ±16,7 juta). */
const MAKS_PIKSEL = 12_000_000;
const MAKS_DPR = 2;
/** Halaman digambar bila berjarak sampai ini (kali tinggi penggulir) dari layar; yang lebih jauh dilepas. */
const JARAK_GAMBAR = 1.2;
/** Berapa halaman digambar bersamaan. */
const MAKS_BERSAMAAN = 2;
/** Jarak antara tepi atas penggulir dan halaman yang dituju, dalam piksel (sedikit celah di atas halaman). */
const JEDA_ATAS = 6;
/** Layar sempit: kontrol zoom dan tombol halaman pindah ke menu (cubitan dan gulir sudah cukup). */
const LAYAR_SEMPIT = "(max-width: 560px)";

const KUNCI_GELAP = "lexa:pdf-gelap";
const kunciHalaman = (/** @type {string} */ url) => `lexa:pdf-hal:v1:${url}`;
const kunciIndeks = (/** @type {string} */ url) => `lexa:pdf-indeks:v2:${url}`;

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
 *   no: number, el: HTMLElement, kanvas: HTMLCanvasElement | null, teks: HTMLElement, textDivs: HTMLElement[] | null,
 *   status: "kosong" | "antre" | "proses" | "siap", skala: number, giliran: number, tugas: any,
 *   ukuran: { l: number, t: number }
 * }} Halaman
 * @typedef {{ no: number, fx: number, fy: number, layar: { x: number, y: number } }} Jangkar
 */

/**
 * @param {string} nama
 * @param {string} label
 * @param {() => void} saat
 * @param {string} [kelas]
 */
function tombolAlat(nama, label, saat, kelas = "") {
  return /** @type {HTMLButtonElement} */ (
    h("button", { type: "button", class: ["tombol", "tombol-ikon", "tombol-kecil", kelas], "aria-label": label, title: label, onclick: saat }, ikon(nama))
  );
}

/**
 * @param {{
 *   url: string,
 *   namaBerkas?: string,
 *   struktur?: Array<import("./pdfDaftarPasal.js").KelompokDaftar>,
 *   nomorPasalLexa?: () => string[],
 *   halamanAwal?: number,
 *   saatHalaman?: (no: number) => void,
 * }} opsi `url`: alamat PDF di asal yang sama (/api/dokumen/pdf?uri=...); `namaBerkas`: nama unduhan; `struktur`: daftar isi
 *   (strukturDaftarIsi) dengan halaman tiap pasal; `nomorPasalLexa`: nomor pasal batang tubuh yang tersimpan di Lexa, untuk
 *   "Periksa pasal"; `halamanAwal`: halaman yang dibuka pertama (0 = ingatan terakhir, atau awal); `saatHalaman`: dipanggil
 *   (tertunda) setiap halaman yang dibaca berubah
 */
export function buatPenampilPdf({ url, namaBerkas = "peraturan.pdf", struktur = [], nomorPasalLexa = () => [], halamanAwal = 0, saatHalaman }) {
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
  let ukuranAwal = { l: 595, t: 842 };
  let lebarFitKini = LEBAR_MAKS;
  let saatIni = 1;
  /** Setelah loncat ke halaman, halaman saat ini tak berubah sampai pembaca sendiri menggulir. */
  /** @type {{ no: number, gulir: number } | null} */
  let kunci = null;
  /** Halaman yang dekat layar. */
  const dekat = new Set();
  /** @type {Halaman[]} */
  const antre = [];
  let berjalan = 0;
  let gelap = false;
  try {
    gelap = penyimpanan.baca(KUNCI_GELAP) === "1";
  } catch {
    /* penyimpanan dimatikan */
  }

  // --- Teks halaman (dipakai bersama pencarian, pemeriksaan, dan pencarian pasal) --------------------------------------
  /** @type {Map<number, Promise<import("../pdfCari.js").TeksHalaman>>} */
  const teksHalaman = new Map();
  /** @param {number} no */
  function ambilTeks(no) {
    let janji = teksHalaman.get(no);
    if (!janji) {
      janji = (async () => {
        const page = await pdf.getPage(no);
        try {
          const isi = await page.getTextContent();
          return bangunTeksHalaman(isi.items);
        } finally {
          page.cleanup();
        }
      })();
      teksHalaman.set(no, janji);
      janji.catch(() => teksHalaman.delete(no));
    }
    return janji;
  }

  /** @type {ReturnType<typeof buatIndeksPasal> | null} */
  let indeks = null;

  // --- Elemen ---------------------------------------------------------------
  const status = h("div", { class: "pdf-status", role: "status", "aria-live": "polite" });
  status.hidden = true;
  const lapis = h("div", { class: "pdf-lapis" });
  const gulir = h("div", { class: "pdf-gulir", tabindex: "0", role: "region", "aria-label": "Isi PDF" }, lapis);
  const masukan = /** @type {HTMLInputElement} */ (
    h("input", { class: "input pdf-hal-input", type: "number", min: "1", step: "1", inputmode: "numeric", "aria-label": "Nomor halaman", disabled: true })
  );
  const total = h("span", { class: "pdf-hal-total" }, "/ –");
  const labelZoom = h("span", { class: "pdf-zoom pdf-zoom-grup", "aria-live": "polite" }, "100%");

  const tombolPasal = /** @type {HTMLButtonElement} */ (
    h("button", { type: "button", class: "tombol tombol-kecil pdf-tombol-pasal", "aria-haspopup": "dialog", disabled: true, onclick: () => bukaLembarPasal() }, ikon("toc"), h("span", { class: "pdf-label" }, "Pasal"))
  );
  const sebelum = tombolAlat("kiri", "Halaman sebelumnya", () => keHalaman(saatIni - 1), "pdf-nav-halaman");
  const berikut = tombolAlat("kanan", "Halaman berikutnya", () => keHalaman(saatIni + 1), "pdf-nav-halaman");
  const tombolCari = tombolAlat("cari", "Cari di PDF", () => bukaCari());
  tombolCari.setAttribute("aria-expanded", "false");
  const kecil = tombolAlat("kurang", "Perkecil", () => ubahZoom(1 / LANGKAH_ZOOM), "pdf-zoom-grup");
  const besar = tombolAlat("tambah", "Perbesar", () => ubahZoom(LANGKAH_ZOOM), "pdf-zoom-grup");
  const pas = tombolAlat("lebarHalaman", "Pas lebar", () => aturZoom(1), "pdf-zoom-grup");
  const tombolPenuh = tombolAlat("layarPenuh", "Layar penuh", () => alihkanLayarPenuh());
  tombolPenuh.setAttribute("aria-pressed", "false");
  const tombolMenu = tombolAlat("lainnya", "Menu PDF", () => bukaMenu());
  tombolMenu.setAttribute("aria-haspopup", "dialog");
  const bilah = h(
    "div",
    { class: "pdf-bilah", role: "toolbar", "aria-label": "Kontrol PDF" },
    tombolPasal,
    sebelum,
    h("label", { class: "pdf-hal" }, h("span", { class: "sr-only" }, "Halaman"), masukan, total),
    berikut,
    h("span", { class: "pdf-spasi" }),
    tombolCari,
    kecil,
    labelZoom,
    besar,
    pas,
    tombolPenuh,
    tombolMenu,
  );
  for (const t of [tombolPasal, sebelum, berikut, tombolCari, kecil, besar, pas, tombolMenu]) t.disabled = true;

  const pencarian = buatPencarian({
    jumlahHalaman: () => hal.length,
    halamanSaatIni: () => saatIni,
    ambilTeks,
    lihat: (no) => hal[no - 1]?.textDivs ?? null,
    keHalaman: (no) => void keHalaman(no),
    gulirKeElemen,
    saatTutup: () => {
      tombolCari.setAttribute("aria-expanded", "false");
      gulir.focus({ preventScroll: true });
    },
  });

  const akar = h("section", { class: ["penampil-pdf", gelap ? "pdf-gelap" : ""], "aria-label": "Penampil PDF" }, bilah, pencarian.el, h("div", { class: "pdf-badan" }, gulir, status));

  /** @param {string} teks @param {boolean} [galat] */
  function tulisStatus(teks, galat = false) {
    status.replaceChildren(teks ? document.createTextNode(teks) : "");
    status.classList.toggle("pdf-status-galat", galat);
    status.hidden = !teks;
  }

  // --- Ukuran dan skala -----------------------------------------------------
  /** Lebar halaman pada "pas lebar": lebar penggulir tanpa bantalan, paling lebar LEBAR_MAKS. */
  function hitungLebarFit() {
    const bantalan = parseFloat(getComputedStyle(lapis).paddingLeft) || 0;
    const lebar = gulir.clientWidth - bantalan * 2;
    return lebar > 40 ? Math.min(lebar, LEBAR_MAKS) : LEBAR_MAKS;
  }

  /** Tiap halaman diskalakan menurut lebarnya sendiri, jadi halaman lanskap dan lampiran tetap muat di layar. @param {Halaman} p */
  const skala = (p) => (lebarFitKini / p.ukuran.l) * zoom;

  /** @param {Halaman} p */
  function terapkanUkuran(p) {
    const s = skala(p);
    Object.assign(p.el.style, { width: `${Math.floor(p.ukuran.l * s)}px`, height: `${Math.floor(p.ukuran.t * s)}px` });
    p.el.style.setProperty("--total-scale-factor", String(s));
  }

  function terapkanSemuaUkuran() {
    for (const p of hal) terapkanUkuran(p);
    labelZoom.textContent = `${Math.round(zoom * 100)}%`;
    kecil.disabled = !hal.length || zoom <= ZOOM_MIN + 1e-6;
    besar.disabled = !hal.length || zoom >= ZOOM_MAKS - 1e-6;
  }

  /**
   * Titik di layar (relatif terhadap pojok kiri-atas penggulir) dinyatakan terhadap halaman di bawahnya, supaya tetap di bawah jari
   * setelah ukuran halaman berubah. Celah antar-halaman tidak ikut berubah ukurannya, jadi menskalakan koordinat isi begitu saja
   * akan meleset ratusan piksel di halaman yang jauh.
   * @param {{ x: number, y: number }} layar
   * @param {{ x: number, y: number }} [fokus] titik di dalam isi yang tergulir; bawaannya gulir sekarang + layar
   * @returns {Jangkar | null}
   */
  function ambilJangkar(layar, fokus) {
    if (!hal.length) return null;
    const x = fokus?.x ?? gulir.scrollLeft + layar.x;
    const y = fokus?.y ?? gulir.scrollTop + layar.y;
    const i = Math.min(indeksPertamaDi(hal.length, (k) => hal[k].el.offsetTop + hal[k].el.offsetHeight, y), hal.length - 1);
    const el = hal[i].el;
    return { no: i + 1, fx: (x - el.offsetLeft) / (el.offsetWidth || 1), fy: (y - el.offsetTop) / (el.offsetHeight || 1), layar };
  }

  /** @param {Jangkar | null} j */
  function pulihkanJangkar(j) {
    const el = j ? hal[j.no - 1]?.el : null;
    if (!j || !el) return;
    gulir.scrollLeft = Math.max(0, el.offsetLeft + j.fx * el.offsetWidth - j.layar.x);
    gulir.scrollTop = Math.max(0, el.offsetTop + j.fy * el.offsetHeight - j.layar.y);
  }

  const pusatLayar = () => ({ x: gulir.clientWidth / 2, y: gulir.clientHeight / 2 });

  /**
   * Ubah zoom (1 = pas lebar) dengan mempertahankan titik yang sedang dilihat di tempatnya.
   * @param {number} nilai
   * @param {Jangkar | null} [jangkar] titik yang dipertahankan; bawaannya pusat layar
   */
  function aturZoom(nilai, jangkar) {
    const baru = jepit(nilai, ZOOM_MIN, ZOOM_MAKS);
    if (!hal.length || Math.abs(baru - zoom) < 1e-6) return;
    const j = jangkar ?? ambilJangkar(pusatLayar());
    zoom = baru;
    terapkanSemuaUkuran();
    pulihkanJangkar(j);
    for (const p of hal) if (p.status === "siap" && p.skala !== skala(p)) jadwalkanUlang(p);
    perbaruiPandangan();
    pencarian.segarkan();
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
    if (p.status === "siap" && p.skala === skala(p)) return;
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

  /**
   * Ukuran sebenarnya sebuah halaman (bisa berbeda dari halaman pertama: lanskap, lampiran). Halaman yang berada di atas layar dan
   * berubah tingginya menggeser isi di bawahnya; gulir dikoreksi supaya yang sedang dibaca tidak melompat.
   * @param {Halaman} p
   * @param {number} l
   * @param {number} t
   */
  function ubahUkuranHalaman(p, l, t) {
    const lama = p.el.offsetHeight;
    p.ukuran = { l, t };
    terapkanUkuran(p);
    const selisih = p.el.offsetHeight - lama;
    if (selisih && p.el.offsetTop + lama <= gulir.scrollTop) gulir.scrollTop += selisih;
  }

  /** @param {Halaman} p */
  async function gambar(p) {
    const giliran = ++p.giliran;
    p.status = "proses";
    try {
      const page = await pdf.getPage(p.no);
      if (hancur || giliran !== p.giliran) return;
      const asli = page.getViewport({ scale: 1 });
      if (Math.abs(asli.width - p.ukuran.l) > 0.5 || Math.abs(asli.height - p.ukuran.t) > 0.5) ubahUkuranHalaman(p, asli.width, asli.height);
      const s = skala(p);
      const vp = page.getViewport({ scale: s });
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

      // Lapisan teks (memilih, menyalin, dan menandai hasil pencarian). Gagalnya tidak menggagalkan halamannya.
      try {
        p.teks.replaceChildren();
        const lapisan = new lib.TextLayer({ textContentSource: page.streamTextContent(), container: p.teks, viewport: vp });
        await lapisan.render();
        p.textDivs = lapisan.textDivs;
      } catch {
        p.textDivs = null;
      }
      p.skala = s;
      p.status = "siap";
      page.cleanup();
      pencarian.saatHalamanSiap(p.no);
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
    p.textDivs = null;
    p.skala = 0;
    p.status = "kosong";
    p.el.classList.remove("pdf-halaman-galat");
    p.el.removeAttribute("data-galat");
  }

  // --- Pandangan: halaman saat ini dan halaman yang digambar ------------------------------------------------------------
  const proses = tunda(() => {
    if (hancur) return;
    for (const p of hal) {
      if (dekat.has(p.no)) jadwalkan(p);
      else if (p.status !== "kosong") lepas(p);
    }
  }, 60);

  const gulirTerkunci = () => kunci !== null && Math.abs(gulir.scrollTop - kunci.gulir) < 2;

  function perbaruiPandangan() {
    // Panel tersembunyi (tab lain) atau belum punya ukuran: tak ada yang terlihat, jangan menggambar apa pun.
    if (hancur || !hal.length || !gulir.clientHeight) return;
    const atas = gulir.scrollTop;
    const r = halamanTerlihat(
      hal.length,
      (i) => hal[i].el.offsetTop,
      (i) => hal[i].el.offsetTop + hal[i].el.offsetHeight,
      atas,
      gulir.clientHeight,
      gulir.clientHeight * JARAK_GAMBAR,
    );
    dekat.clear();
    for (const no of r.dekat) dekat.add(no);
    if (!gulirTerkunci()) kunci = null;
    if (r.utama && r.utama !== saatIni && !kunci) catatHalaman(r.utama);
    proses();
  }

  let menungguBingkai = false;
  function saatGulir() {
    if (menungguBingkai) return;
    menungguBingkai = true;
    requestAnimationFrame(() => {
      menungguBingkai = false;
      perbaruiPandangan();
    });
  }
  gulir.addEventListener("scroll", saatGulir, { passive: true });

  const laporHalaman = tunda(() => {
    if (hancur) return;
    simpanIngatan();
    saatHalaman?.(saatIni);
  }, 500);

  /** @param {number} no */
  function catatHalaman(no) {
    saatIni = no;
    masukan.value = String(no);
    sebelum.disabled = no <= 1;
    berikut.disabled = no >= hal.length;
    laporHalaman();
  }

  /**
   * Buka halaman `n` (dijepit ke rentang yang ada) di puncak penggulir. Mengembalikan halaman yang dibuka, atau null bila PDF belum siap.
   * @param {number} n
   */
  function keHalaman(n) {
    if (!hal.length) return null;
    const no = jepit(Math.round(n) || 1, 1, hal.length);
    catatHalaman(no);
    gulir.scrollTop = Math.max(0, hal[no - 1].el.offsetTop - JEDA_ATAS);
    kunci = { no, gulir: gulir.scrollTop };
    perbaruiPandangan();
    return no;
  }

  /**
   * Gulir penggulir (bukan halaman web) sampai `el` berada sepertiga dari atas, dan terlihat secara mendatar bila diperbesar.
   * @param {HTMLElement} el
   */
  function gulirKeElemen(el) {
    const g = gulir.getBoundingClientRect();
    const k = el.getBoundingClientRect();
    gulir.scrollTop += k.top - g.top - gulir.clientHeight * 0.33;
    if (k.left < g.left + 8 || k.right > g.right - 8) gulir.scrollLeft += k.left + k.width / 2 - (g.left + g.width / 2);
    kunci = null;
    perbaruiPandangan();
  }

  // --- Menyimpan halaman terakhir ------------------------------------------------------------------------------------
  function simpanIngatan() {
    if (!hal.length) return;
    try {
      penyimpanan.tulis(kunciHalaman(url), JSON.stringify({ n: hal.length, h: saatIni }));
    } catch {
      /* penyimpanan penuh atau dimatikan */
    }
  }

  /** Halaman terakhir dibaca pada PDF yang sama (jumlah halamannya sama), atau 0. */
  function bacaIngatan() {
    try {
      const mentah = penyimpanan.baca(kunciHalaman(url));
      const o = mentah ? JSON.parse(mentah) : null;
      return o && o.n === hal.length && Number.isInteger(o.h) && o.h > 1 && o.h <= hal.length ? o.h : 0;
    } catch {
      return 0;
    }
  }

  // --- Pasal -> halaman -------------------------------------------------------
  /**
   * Buka halaman tempat pasal dimulai. `saran`: halaman yang disimpan server untuk pasal itu (bila ada). Hasilnya: halaman yang
   * dibuka (`pasti`: terbukti dari teks PDF), atau alasan gagal.
   * @param {string} nomor
   * @param {number | null} [saran]
   * @returns {Promise<{ halaman: number, pasti: boolean } | { alasan: "belum_siap" | "pindaian" | "tidak_ada" }>}
   */
  async function keHalamanPasal(nomor, saran = null) {
    if (janjiMuat) await janjiMuat;
    if (!hal.length || !indeks) return { alasan: "belum_siap" };
    if (saran) {
      const v = await indeks.verifikasi(nomor, saran);
      if (v) {
        keHalaman(v.halaman);
        return v;
      }
    }
    const halaman = await indeks.cari(nomor);
    if (halaman) {
      keHalaman(halaman);
      return { halaman, pasti: true };
    }
    if (saran && !indeks.keadaan().tanpaTeks) {
      // Ada lapisan teks tetapi judulnya tak terbaca: halaman dari server tetap lebih baik daripada tidak ke mana-mana.
      keHalaman(saran);
      return { halaman: saran, pasti: false };
    }
    return { alasan: indeks.keadaan().tanpaTeks ? "pindaian" : "tidak_ada" };
  }

  /**
   * Buka halaman tempat pasal dimulai dan kabarkan hasilnya kepada pembaca (toast): terbukti, dibuka menurut indeks Lexa tanpa bukti,
   * atau tak bisa (PDF pindaian, judul tak ditemukan).
   * @param {string} nomor
   * @param {number | null} [saran] halaman PDF pasal itu menurut server
   */
  async function bukaPasal(nomor, saran = null) {
    const hasil = await keHalamanPasal(nomor, saran);
    if ("halaman" in hasil) {
      toast(hasil.pasti ? `Pasal ${nomor} dimulai di halaman ${hasil.halaman} PDF.` : `Pasal ${nomor} dibuka di halaman ${hasil.halaman} menurut indeks Lexa; periksa judulnya di halaman itu.`);
    } else if (hasil.alasan === "pindaian") {
      toast("PDF ini hasil pindaian tanpa lapisan teks, jadi halaman pasalnya tak bisa dicari otomatis. Ketik nomor halaman atau gulir.", { durasi: 7000 });
    } else if (hasil.alasan === "tidak_ada") {
      toast(`Pasal ${nomor} tidak ditemukan di teks PDF. Ketik nomor halaman atau gulir.`, { durasi: 6000 });
    }
  }

  /** Lembar "Pasal": daftar pasal menurut BAB dan kolom lompat ke nomor. */
  function bukaLembarPasal() {
    bukaDaftarPasal({ struktur, buka: (nomor, saran) => void bukaPasal(nomor, saran) });
  }

  function periksaPasal() {
    if (!indeks) return;
    bukaPeriksa({ indeks, nomorPasalLexa, keHalaman: (no) => void keHalaman(no) });
  }

  // --- Cari, halaman gelap, layar penuh, menu ---------------------------------------------------------------------------
  function bukaCari() {
    if (!hal.length) return;
    tombolCari.setAttribute("aria-expanded", "true");
    pencarian.buka();
  }

  function terapkanGelap() {
    akar.classList.toggle("pdf-gelap", gelap);
  }

  function alihkanGelap() {
    gelap = !gelap;
    penyimpanan.tulis(KUNCI_GELAP, gelap ? "1" : "0");
    terapkanGelap();
  }

  let penuh = false;
  /** Layar penuh menambah satu entri riwayat supaya tombol Kembali menutupnya (bukan meninggalkan peraturan). */
  let entriRiwayat = false;

  /** @param {boolean} nilai */
  function aturLayarPenuh(nilai) {
    if (nilai === penuh) return;
    penuh = nilai;
    const acuan = ambilJangkar(pusatLayar());
    akar.classList.toggle("layar-penuh", penuh);
    document.documentElement.classList.toggle("pdf-penuh", penuh);
    tombolPenuh.setAttribute("aria-pressed", String(penuh));
    const label = penuh ? "Keluar dari layar penuh" : "Layar penuh";
    tombolPenuh.setAttribute("aria-label", label);
    tombolPenuh.title = label;
    tombolPenuh.replaceChildren(ikon(penuh ? "layarKecil" : "layarPenuh"));
    if (penuh && !entriRiwayat) {
      history.pushState({ pdfPenuh: true }, "", location.href);
      entriRiwayat = true;
    } else if (!penuh && entriRiwayat) {
      entriRiwayat = false;
      if (history.state?.pdfPenuh) history.back();
    }
    // Ukuran penggulir berubah: titik yang sedang dilihat dipertahankan.
    requestAnimationFrame(() => {
      pulihkanJangkar(acuan);
      perbaruiPandangan();
      if (!penuh) tampilkanDiLayar();
    });
  }

  function alihkanLayarPenuh() {
    aturLayarPenuh(!penuh);
  }

  /** Tombol Kembali: menutup layar penuh bila terbuka. Entri riwayatnya sudah diambil peramban. */
  function saatKembali() {
    if (!penuh) return;
    entriRiwayat = false;
    aturLayarPenuh(false);
  }
  window.addEventListener("popstate", saatKembali);

  function bukaMenu() {
    const sempit = matchMedia(LAYAR_SEMPIT).matches;
    bukaLembarAksi({
      judul: "PDF",
      aksi: [
        { ikon: "lebarHalaman", label: "Pas lebar", saat: () => aturZoom(1), tampil: sempit },
        { ikon: "tambah", label: "Perbesar", saat: () => ubahZoom(LANGKAH_ZOOM), tampil: sempit },
        { ikon: "kurang", label: "Perkecil", saat: () => ubahZoom(1 / LANGKAH_ZOOM), tampil: sempit },
        { ikon: gelap ? "matahari" : "bulan", label: gelap ? "Halaman terang" : "Halaman gelap", keterangan: "Warna halaman lebih nyaman di malam hari", saat: alihkanGelap },
        { ikon: "centang", label: "Periksa pasal", keterangan: "Bandingkan nomor pasal di PDF dengan teks di Lexa", saat: periksaPasal },
        { ikon: "unduh", label: "Unduh PDF", keterangan: "Salinan yang diarsipkan Lexa", href: url, unduh: namaBerkas },
        { ikon: "luar", label: "Buka di tab baru", href: url },
      ],
    });
  }

  /** Tinggi tab di atas penampil (bila ada), supaya tinggi penampil pas di bawahnya apa pun ukuran hurufnya. */
  function ukurTab() {
    const tinggi = document.querySelector(".tab-daftar")?.getBoundingClientRect().height;
    if (tinggi) akar.style.setProperty("--tinggi-tab-pdf", `${Math.round(tinggi)}px`);
  }

  /**
   * Gulir halaman web sampai penampil berada tepat di bawah header dan tab yang lengket, supaya mengisi layar. Dipanggil
   * penampil tampil (tab PDF dibuka) dan sesudah keluar dari layar penuh.
   */
  function tampilkanDiLayar() {
    if (hancur || penuh || !akar.isConnected || !akar.offsetParent) return;
    ukurTab();
    const header = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tinggi-header")) || 0;
    const tab = document.querySelector(".tab-daftar")?.getBoundingClientRect().height ?? 0;
    const selisih = akar.getBoundingClientRect().top - header - tab - 6;
    if (Math.abs(selisih) > 2) window.scrollBy({ top: selisih, behavior: "auto" });
  }

  akar.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "f") {
      // Pencarian peramban hanya menemukan teks halaman yang sedang tergambar; pencarian di sini menjangkau seluruh PDF.
      e.preventDefault();
      bukaCari();
    } else if (e.key === "Escape" && penuh && !pencarian.terbuka()) {
      e.preventDefault();
      aturLayarPenuh(false);
    }
  });

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

  /**
   * Muat PDF.js dan dokumennya; aman dipanggil berulang. `pulih: false` melewati pemulihan halaman terakhir dibaca (pemanggil
   * akan langsung membuka halaman tertentu).
   * @param {{ pulih?: boolean }} [opsi]
   * @returns {Promise<void>}
   */
  function muat({ pulih = true } = {}) {
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
          hal.push({ no: i, el, kanvas: null, teks, textDivs: null, status: "kosong", skala: 0, giliran: 0, tugas: null, ukuran: { ...ukuranAwal } });
        }
        indeks = buatIndeksPasal({
          jumlahHalaman: hal.length,
          ambilItem: async (no) => itemDariTeks(await ambilTeks(no)),
          pulihkan: () => penyimpanan.baca(kunciIndeks(url)),
          simpan: (data) => penyimpanan.tulis(kunciIndeks(url), data),
        });
        lebarFitKini = hitungLebarFit();
        lapis.replaceChildren(...hal.map((p) => p.el));
        terapkanSemuaUkuran();
        total.textContent = `/ ${hal.length}`;
        masukan.max = String(hal.length);
        masukan.disabled = false;
        for (const t of [tombolPasal, tombolCari, pas, tombolMenu]) t.disabled = false;
        catatHalaman(1);
        tulisStatus("");
        const awal = halamanAwal > 0 ? halamanAwal : pulih ? bacaIngatan() : 0;
        if (awal > 1) {
          keHalaman(awal);
          if (!halamanAwal) toast(`Dilanjutkan dari halaman ${saatIni}.`, { aksi: { label: "Dari awal", saat: () => void keHalaman(1) } });
        }
        perbaruiPandangan();
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

  // Lebar atau tinggi penggulir berubah (putar ponsel, ubah ukuran jendela, layar penuh, tab dibuka): "pas lebar" ikut menyesuaikan
  // dan titik yang sedang dilihat dipertahankan.
  const saatUbahUkuran = tunda(() => {
    if (!hal.length || hancur || !gulir.clientWidth) return;
    ukurTab();
    const baru = hitungLebarFit();
    if (Math.abs(baru - lebarFitKini) / lebarFitKini >= 0.02) {
      const acuan = ambilJangkar(pusatLayar());
      lebarFitKini = baru;
      terapkanSemuaUkuran();
      pulihkanJangkar(acuan);
      for (const p of hal) if (p.status === "siap" && p.skala !== skala(p)) jadwalkanUlang(p);
      pencarian.segarkan();
    }
    perbaruiPandangan();
  }, 120);
  const pengamatUkuran = new ResizeObserver(saatUbahUkuran);
  pengamatUkuran.observe(gulir);

  const lepasGestur = pasangGestur(gulir, lapis, {
    ambilZoom: () => zoom,
    min: ZOOM_MIN,
    maks: ZOOM_MAKS,
    atur: (zoomBaru, fokus, layar) => aturZoom(zoomBaru, ambilJangkar(layar, fokus)),
    ketukDuaDi: (layar, fokus) => aturZoom(zoom > 1.05 ? 1 : 2, ambilJangkar(layar, fokus)),
  });

  window.addEventListener("pagehide", simpanIngatan);

  /** Hentikan semuanya dan lepaskan memori; dipanggil saat halaman peraturan ditinggalkan. */
  function hancurkan() {
    hancur = true;
    simpanIngatan();
    window.removeEventListener("popstate", saatKembali);
    window.removeEventListener("pagehide", simpanIngatan);
    pengamatUkuran.disconnect();
    lepasGestur();
    pencarian.hancurkan();
    indeks?.hancurkan();
    document.documentElement.classList.remove("pdf-penuh");
    for (const p of hal) lepas(p);
    antre.length = 0;
    teksHalaman.clear();
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
    bukaPasal,
    periksaPasal,
    bukaCari,
    tampilkanDiLayar,
    hancurkan,
    /** Jumlah halaman, 0 sebelum PDF termuat. */
    jumlahHalaman: () => hal.length,
    /** Halaman yang sedang dibaca. */
    halamanSaatIni: () => saatIni,
  };
}
