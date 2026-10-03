// @ts-check
import { cuplikan, h } from "../dom.js";
import { jangkarDariId, sitasi, urlPeraturan } from "../format.js";
import { lencanaJenis, lencanaStatus } from "./umum.js";
import { tombolTandai } from "./tombolTandai.js";

const LABEL_SUMBER = /** @type {Record<string, string>} */ ({
  sitasi: "Sitasi",
  fts: "Kata kunci",
  vector: "Makna",
});

/**
 * Satu hasil pencarian: sebuah peraturan, atau sebuah pasal di dalamnya.
 * @param {import("../../../src/shared/types").SearchHit} hit
 * @param {{ q?: string }} [opsi]
 */
export function kartuHasil(hit, opsi = {}) {
  const jangkar = hit.article_id ? jangkarDariId(hit.article_id) : null;
  const href = urlPeraturan(hit.frbr_uri, { q: opsi.q, jangkar });
  const label = hit.nomor_pasal ? `Pasal ${hit.nomor_pasal}${hit.ayat ? ` ayat (${hit.ayat})` : ""}` : null;

  return h(
    "li",
    { class: "hasil" },
    h(
      "div",
      { class: "hasil-kepala" },
      lencanaJenis(hit.jenis),
      h("span", { class: "hasil-sitasi" }, sitasi(hit)),
      label ? h("span", { class: "hasil-pasal" }, label) : null,
      lencanaStatus(hit.status),
    ),
    h("h3", { class: "hasil-judul" }, h("a", { href }, hit.judul)),
    hit.snippet ? h("p", { class: "hasil-cuplikan" }, cuplikan(hit.snippet)) : hit.tentang ? h("p", { class: "hasil-cuplikan redup" }, hit.tentang) : null,
    h(
      "div",
      { class: "hasil-kaki" },
      hit.sources.map((sumber) => h("span", { class: "sumber-chip", title: `Ditemukan lewat ${LABEL_SUMBER[sumber]?.toLowerCase() ?? sumber}` }, LABEL_SUMBER[sumber] ?? sumber)),
      h("span", { class: "rentang" }),
      tombolTandai({ uri: hit.frbr_uri, sitasi: sitasi(hit), judul: hit.judul }),
    ),
  );
}

/**
 * Baris peraturan untuk daftar telusur (tanpa cuplikan).
 * @param {import("../../../src/shared/types").Law} l
 * @param {{ q?: string }} [opsi]
 */
export function kartuPeraturan(l, opsi = {}) {
  return h(
    "li",
    { class: "hasil" },
    h("div", { class: "hasil-kepala" }, lencanaJenis(l.jenis), h("span", { class: "hasil-sitasi" }, sitasi(l)), lencanaStatus(l.status)),
    h("h3", { class: "hasil-judul" }, h("a", { href: urlPeraturan(l.frbr_uri, opsi) }, l.judul)),
    l.ringkasan ? h("p", { class: "hasil-cuplikan redup" }, l.ringkasan.length > 220 ? `${l.ringkasan.slice(0, 220)}…` : l.ringkasan) : null,
    h(
      "div",
      { class: "hasil-kaki" },
      l.bidang ? h("span", { class: "sumber-chip" }, l.bidang) : null,
      l.jumlah_pasal ? h("span", { class: "istilah" }, `${l.jumlah_pasal} pasal`) : null,
      h("span", { class: "rentang" }),
      tombolTandai({ uri: l.frbr_uri, sitasi: sitasi(l), judul: l.judul }),
    ),
  );
}

