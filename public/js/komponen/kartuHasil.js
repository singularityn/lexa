// @ts-check
import { cuplikan, h, tandaiIstilah } from "../dom.js";
import { bersihkanArtefak, istilahDariKueri, jangkarDariId, judulRingkas, labelJenis, sitasi, urlPeraturan } from "../format.js";
import { lencanaStatus } from "./umum.js";
import { tombolTandai } from "./tombolTandai.js";

const LABEL_SUMBER = /** @type {Record<string, string>} */ ({
  sitasi: "Sitasi",
  fts: "Kata kunci",
  vector: "Makna",
});

/** Huruf kecil tanpa tanda baca, untuk membandingkan teks. @param {string} t */
const polos = (t) => t.toLowerCase().replace(/<\/?mark>/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Cuplikan yang hanya mengulang judul tidak menambah informasi (FTS di tingkat peraturan memotong
 * kolom judul). Dibandingkan tanpa tanda baca dan tanpa penanda <mark>.
 * @param {string} cuplikanMentah
 * @param {string} judulPenuh
 */
function mengulangJudul(cuplikanMentah, judulPenuh) {
  const c = polos(cuplikanMentah);
  const j = polos(judulPenuh);
  if (c.length < 12) return false;
  return j.startsWith(c.slice(0, 40)) || j.includes(c) || c.includes(j.slice(0, 50));
}

/**
 * Satu hasil pencarian: sebuah peraturan, atau sebuah pasal di dalamnya.
 *
 * Susunan (tanpa lencana jenis; sitasi sudah memuat jenisnya, dan nama lengkapnya jadi keterangan kecil):
 *   - hasil pasal: sitasi + "Pasal N" + status, lalu cuplikan, lalu judul peraturan sebagai konteks;
 *   - hasil peraturan: sitasi + status, lalu judul (topiknya saja), lalu cuplikan bila bukan sekadar judul.
 * Seluruh kartu dapat diketuk (tautan judul membentang), tombol simpan tetap terpisah.
 *
 * @param {import("../../../src/shared/types").SearchHit} hit
 * @param {{ q?: string }} [opsi]
 */
export function kartuHasil(hit, opsi = {}) {
  const jangkar = hit.article_id ? jangkarDariId(hit.article_id) : null;
  const href = urlPeraturan(hit.frbr_uri, { q: opsi.q, jangkar });
  const label = hit.nomor_pasal ? `Pasal ${hit.nomor_pasal}${hit.ayat ? ` ayat (${hit.ayat})` : ""}` : null;
  const bersih = hit.snippet ? bersihkanArtefak(hit.snippet) : "";
  const tampilkanCuplikan = bersih !== "" && (label !== null || !mengulangJudul(bersih, hit.judul));

  const tautan = h("a", { href }, judulRingkas(hit.judul));
  // Cuplikan yang dibuang karena mengulang judul membawa penanda kata yang dicari; pindahkan ke judul.
  if (!tampilkanCuplikan) tandaiIstilah(tautan, istilahDariKueri(opsi.q));

  const judul = h("h3", { class: label ? "hasil-judul hasil-konteks" : "hasil-judul" }, tautan);
  const isiCuplikan = tampilkanCuplikan
    ? h("p", { class: "hasil-cuplikan" }, cuplikan(bersih))
    : !label && hit.tentang
      ? h("p", { class: "hasil-cuplikan redup" }, hit.tentang)
      : null;
  const sumberTepat = hit.sources.includes("sitasi");

  const kaki =
    sumberTepat || !label
      ? h(
          "div",
          { class: "hasil-kaki" },
          label ? null : h("span", { class: "hasil-jenis" }, labelJenis(hit.jenis)),
          // Hanya sitasi yang berarti bagi pembaca ("cocok persis dengan nomor yang diketik"); kata kunci/makna adalah mesin.
          sumberTepat ? h("span", { class: "sumber-chip", title: `Ditemukan lewat ${LABEL_SUMBER.sitasi.toLowerCase()}` }, LABEL_SUMBER.sitasi) : null,
        )
      : null;

  return h(
    "li",
    { class: ["hasil", label ? "hasil-pasal-tipe" : ""] },
    h(
      "div",
      { class: "hasil-kepala" },
      h("span", { class: "hasil-id" }, h("span", { class: "hasil-sitasi" }, sitasi(hit)), label ? h("span", { class: "hasil-pasal" }, label) : null),
      lencanaStatus(hit.status),
      tombolTandai({ uri: hit.frbr_uri, sitasi: sitasi(hit), judul: hit.judul }),
    ),
    ...(label ? [isiCuplikan, judul] : [judul, isiCuplikan]),
    kaki,
  );
}

/**
 * Baris peraturan untuk daftar telusur.
 * @param {import("../../../src/shared/types").Law} l
 * @param {{ q?: string }} [opsi]
 */
export function kartuPeraturan(l, opsi = {}) {
  const ringkasan = l.ringkasan ? bersihkanArtefak(l.ringkasan) : "";
  return h(
    "li",
    { class: "hasil" },
    h(
      "div",
      { class: "hasil-kepala" },
      h("span", { class: "hasil-id" }, h("span", { class: "hasil-sitasi" }, sitasi(l))),
      lencanaStatus(l.status),
      tombolTandai({ uri: l.frbr_uri, sitasi: sitasi(l), judul: l.judul }),
    ),
    h("h3", { class: "hasil-judul" }, h("a", { href: urlPeraturan(l.frbr_uri, opsi) }, judulRingkas(l.judul))),
    ringkasan ? h("p", { class: "hasil-cuplikan redup" }, ringkasan) : null,
    h("div", { class: "hasil-kaki" }, h("span", { class: "hasil-jenis" }, labelJenis(l.jenis))),
  );
}
