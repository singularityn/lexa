// @ts-check
import { h, isi } from "../dom.js";
import { api } from "../api.js";
import { angka, bersihkanArtefak, judulRingkas, kodeJenis, queryString, sitasi, tanggalIndonesia, urlPeraturan } from "../format.js";
import { ikon } from "./ikon.js";
import { kelasJenis } from "./jenis.js";
import { tombolTandai } from "./tombolTandai.js";
import { lencanaStatus } from "./umum.js";

/** @typedef {"daftar" | "papan" | "hierarki"} Tampilan */

const TAMPILAN = /** @type {Array<[Tampilan, string, string]>} */ ([
  ["daftar", "Daftar", "daftar"],
  ["papan", "Papan", "papan"],
  ["hierarki", "Hierarki", "hierarki"],
]);

/** Papan: satu kolom per jenis, memuat sedikit peraturan terbaru di tiap kolom. */
const KOLOM = [
  { judul: "UUD dan Ketetapan MPR", jenis: ["UUD", "TAP_MPR"], kelas: "j-tap" },
  { judul: "Undang-Undang", jenis: ["UU"], kelas: "j-uu" },
  { judul: "Perppu", jenis: ["PERPPU"], kelas: "j-perppu" },
  { judul: "Peraturan Pemerintah", jenis: ["PP"], kelas: "j-pp" },
];
const PER_KOLOM = 6;

/** @param {string | null} nilai @returns {Tampilan} */
export function tampilanDariUrl(nilai) {
  return nilai === "papan" || nilai === "hierarki" ? nilai : "daftar";
}

/**
 * Pilihan tampilan Telusuri: Daftar, Papan, atau Hierarki (tombol dengan aria-pressed).
 * @param {Tampilan} awal
 * @param {(t: Tampilan) => void} saatPilih
 */
export function bilahTampilan(awal, saatPilih) {
  /** @type {Array<[Tampilan, HTMLElement]>} */
  const daftar = [];
  const el = h("div", { class: "tab-tampilan", role: "group", "aria-label": "Tampilan" });
  const atur = (/** @type {Tampilan} */ t) => daftar.forEach(([k, b]) => b.setAttribute("aria-pressed", String(k === t)));
  for (const [kode, label, ik] of TAMPILAN) {
    const b = h(
      "button",
      {
        type: "button",
        "aria-pressed": String(kode === awal),
        onclick: () => {
          atur(kode);
          saatPilih(kode);
        },
      },
      ikon(ik),
      label,
    );
    daftar.push([kode, b]);
    el.appendChild(b);
  }
  return el;
}

/** Tiga kartu pastel: jumlah peraturan, pasal dan ayat, dan cakupan pencarian makna. @param {AbortSignal} sinyal */
export function statistikTelusuri(sinyal) {
  const el = h("section", { class: "statistik sembunyi", "aria-label": "Ringkasan indeks" });
  /** @param {string} nilai @param {string} label @param {string} [catatan] */
  const kartu = (nilai, label, catatan) =>
    h("div", { class: "kartu" }, h("span", { class: "angka" }, nilai), h("span", { class: "label" }, label), catatan ? h("span", { class: "catatan" }, catatan) : null);
  api
    .statistik()
    .then((s) => {
      if (sinyal.aborted || !s.total_peraturan) return;
      const persen = Math.round((s.terindeks_vektor / s.total_peraturan) * 100);
      el.classList.remove("sembunyi");
      isi(
        el,
        kartu(angka(s.total_peraturan), "peraturan", s.per_jenis.map((j) => `${kodeJenis(j.jenis)} ${angka(j.n)}`).join(" · ")),
        kartu(angka(s.total_pasal), "pasal dan ayat"),
        kartu(`${persen}%`, "terindeks untuk pencarian makna", `${angka(s.terindeks_vektor)} peraturan`),
      );
    })
    .catch(() => {});
  return el;
}

/** @param {import("../../../src/shared/types").Law} l */
function kartuPapan(l) {
  const ringkas = l.ringkasan ? bersihkanArtefak(l.ringkasan) : "";
  const tanggal = l.tanggal_penetapan ? tanggalIndonesia(l.tanggal_penetapan.slice(0, 10)) : "";
  return h(
    "article",
    { class: ["kartu-papan", kelasJenis(l.jenis)] },
    h("div", { class: "kp-kepala" }, h("span", { class: "hasil-sitasi" }, sitasi(l)), lencanaStatus(l.status), tombolTandai({ uri: l.frbr_uri, sitasi: sitasi(l), judul: l.judul })),
    h("h3", { class: "kp-judul" }, h("a", { href: urlPeraturan(l.frbr_uri) }, judulRingkas(l.judul))),
    ringkas ? h("p", { class: "kp-ringkas" }, ringkas) : null,
    h(
      "div",
      { class: "kp-kaki" },
      tanggal ? h("span", null, ikon("kalender"), tanggal) : null,
      l.jumlah_pasal ? h("span", null, ikon("dokumen"), `${angka(l.jumlah_pasal)} pasal`) : null,
    ),
  );
}

/**
 * @param {typeof KOLOM[number]} k
 * @param {import("../../../src/shared/types").BrowseResponse | null} r  null: gagal dimuat
 */
function kolom(k, r) {
  const total = r?.total ?? 0;
  return h(
    "section",
    { class: ["papan-kolom", k.kelas], "aria-label": k.judul },
    h("div", { class: "papan-judul" }, h("span", { class: "papan-titik", "aria-hidden": "true" }), k.judul, h("span", { class: "jml" }, r ? `(${angka(total)})` : "")),
    h(
      "div",
      { class: "papan-isi" },
      r === null
        ? h("p", { class: "papan-kosong" }, "Gagal dimuat.")
        : r.laws.length
          ? [r.laws.map(kartuPapan), total > r.laws.length ? h("a", { class: "papan-lebih", href: `/telusuri${queryString({ jenis: k.jenis })}` }, `Lihat semua ${angka(total)}`) : null]
          : h("p", { class: "papan-kosong" }, "Belum ada di indeks."),
    ),
  );
}

/** Papan per jenis; dimuat sekali, saat pertama kali ditampilkan. @param {AbortSignal} sinyal */
export function papanJenis(sinyal) {
  const el = h("div", { class: "papan sembunyi" });
  let dimuat = false;
  async function muat() {
    if (dimuat) return;
    dimuat = true;
    isi(el, h("p", { class: "papan-kosong", role: "status" }, "Memuat papan…"));
    const hasil = await Promise.allSettled(KOLOM.map((k) => api.telusur({ jenis: k.jenis, per_page: PER_KOLOM }, sinyal)));
    if (sinyal.aborted) return;
    isi(
      el,
      KOLOM.map((k, i) => {
        const r = hasil[i];
        return kolom(k, r.status === "fulfilled" ? r.value : null);
      }),
    );
  }
  return { el, muat };
}

/**
 * @param {string} kelas @param {string} ik @param {number} jumlah @param {string} judul @param {string} uraian @param {string[]} jenis
 */
function simpul(kelas, ik, jumlah, judul, uraian, jenis) {
  return h(
    "section",
    { class: ["hier-simpul", kelas] },
    h("div", { class: "hier-kepala" }, h("span", { class: "hier-ikon", "aria-hidden": "true" }, ikon(ik)), h("span", { class: "hier-jumlah" }, angka(jumlah))),
    h("h3", null, judul),
    h("p", null, uraian),
    h("a", { class: "tombol", href: `/telusuri${queryString({ jenis })}` }, "Telusuri", ikon("kanan")),
  );
}

/** @param {string} label */
const sambung = (label) => h("div", { class: "hier-sambung", "aria-hidden": "true" }, h("span", null, label), ikon("kanan"));

/** Hierarki peraturan: UUD dan Tap MPR, lalu UU dan Perppu, lalu PP, dengan jumlahnya di indeks. @param {AbortSignal} sinyal */
export function hierarkiJenis(sinyal) {
  const el = h("div", { class: "sembunyi" });
  let dimuat = false;
  async function muat() {
    if (dimuat) return;
    dimuat = true;
    /** @type {Record<string, number>} */
    const n = {};
    try {
      const s = await api.statistik();
      for (const j of s.per_jenis) n[j.jenis] = j.n;
    } catch {
      // Tanpa angka pun hierarkinya tetap bermakna.
    }
    if (sinyal.aborted) return;
    const jml = (/** @type {string[]} */ kode) => kode.reduce((t, k) => t + (n[k] ?? 0), 0);
    isi(
      el,
      h(
        "div",
        { class: "hierarki" },
        simpul("p-kuning", "buku", jml(["UUD", "TAP_MPR"]), "UUD dan Ketetapan MPR", `Landasan tertinggi tata urutan peraturan.${n.UUD ? "" : " UUD 1945 belum ada di indeks."}`, ["UUD", "TAP_MPR"]),
        sambung("dasar hukum"),
        simpul("p-ungu", "dokumen", jml(["UU", "PERPPU"]), "Undang-Undang dan Perppu", "Dibentuk bersama DPR. Perppu ditetapkan Presiden dalam kegentingan yang memaksa, lalu dimintakan persetujuan DPR.", ["UU", "PERPPU"]),
        sambung("dilaksanakan oleh"),
        simpul("p-biru", "hierarki", jml(["PP"]), "Peraturan Pemerintah", "Menjalankan undang-undang sebagaimana mestinya.", ["PP"]),
      ),
      h(
        "div",
        { class: "hierarki-luar" },
        h("b", null, "Di luar cakupan saat ini"),
        ["Perpres", "Peraturan menteri", "POJK", "Perda"].map((t) => h("span", { class: "chip" }, t)),
        h("span", null, "Belum dimuat supaya aplikasi tetap ringan."),
      ),
    );
  }
  return { el, muat };
}
