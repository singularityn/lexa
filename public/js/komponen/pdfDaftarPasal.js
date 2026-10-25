// @ts-check
/**
 * Lembar "Pasal" di penampil PDF: lompat ke pasal lewat nomornya, atau pilih dari daftar menurut BAB. Tiap pasal menyebut halaman PDF
 * tempatnya dimulai bila server sudah mengetahuinya (articles.halaman); selebihnya dicari di teks PDF saat dipilih.
 */

import { h } from "../dom.js";
import { namaPasal, rapikanHuruf } from "../format.js";
import { bukaLembar } from "./lembar.js";

/** @typedef {{ nomor: string, jangkar: string, halaman?: number | null }} PasalDaftar */
/** @typedef {{ bab: string | null, penjelasan: boolean, pasal: PasalDaftar[] }} KelompokDaftar */

/** "pasal 5a", " 12 " menjadi "5a", "12". @param {string} t */
const normalNomor = (t) => t.trim().replace(/^pasal\s*/i, "").replace(/\s+/g, "").toLowerCase();

/**
 * "hal. 3–5" dari halaman-halaman yang diketahui pada sebuah BAB; "" bila tak ada satu pun.
 * @param {PasalDaftar[]} pasal
 */
export function rentangHalaman(pasal) {
  /** @type {number[]} */
  const ada = [];
  for (const p of pasal) if (typeof p.halaman === "number" && p.halaman > 0) ada.push(p.halaman);
  if (!ada.length) return "";
  const awal = Math.min(...ada);
  const akhir = Math.max(...ada);
  return awal === akhir ? `hal. ${awal}` : `hal. ${awal}–${akhir}`;
}

/** Rentang nomor pasal sebuah BAB, tanpa nomor kembar akibat salah deteksi (akhiran ~n pada jangkar). @param {PasalDaftar[]} pasal */
function rentangPasal(pasal) {
  const asli = pasal.filter((p) => !p.jangkar.includes("~"));
  const dasar = asli.length ? asli : pasal;
  const awal = dasar[0]?.nomor;
  const akhir = dasar.at(-1)?.nomor;
  return dasar.length === 1 || awal === akhir ? `Pasal ${awal}` : `Pasal ${awal}–${akhir}`;
}

/**
 * @param {{
 *   struktur: KelompokDaftar[],
 *   buka: (nomor: string, saran: number | null) => void,
 * }} o `buka`: dipanggil sesudah lembar tertutup, dengan halaman yang diketahui server (atau null)
 */
export function bukaDaftarPasal({ struktur, buka }) {
  const badan = struktur.filter((g) => !g.penjelasan);
  const semua = badan.flatMap((g) => g.pasal);
  /** @type {ReturnType<typeof bukaLembar>} */
  let lembar;

  /** @param {string} nomor @param {number | null | undefined} halaman */
  function pergi(nomor, halaman) {
    lembar.tutup();
    // Setelah lembar tertutup (gulir latar terbuka kembali), baru berpindah.
    requestAnimationFrame(() => buka(nomor, halaman ?? null));
  }

  const pesan = h("p", { class: "bantu", role: "status", "aria-live": "polite" });
  const masukan = /** @type {HTMLInputElement} */ (
    h("input", { class: "input", id: "pdf-lompat-nomor", type: "text", inputmode: "text", enterkeyhint: "go", autocomplete: "off", autocapitalize: "off", placeholder: "mis. 156 atau 5a", "aria-label": "Nomor pasal", name: "nomor-pasal" })
  );
  masukan.addEventListener("input", () => (pesan.textContent = ""));
  const lompat = h(
    "form",
    {
      class: "lompat-pasal",
      onsubmit: (/** @type {SubmitEvent} */ e) => {
        e.preventDefault();
        const n = normalNomor(masukan.value);
        if (!n) return;
        // Pasal yang tak tersimpan di Lexa tetap dicari di teks PDF-nya (mungkin terlewat oleh ekstraksi).
        const ada = semua.find((p) => p.nomor.toLowerCase() === n);
        pergi(ada?.nomor ?? n.toUpperCase(), ada?.halaman);
      },
    },
    h("label", { class: "bidang", for: "pdf-lompat-nomor" }, "Lompat ke pasal"),
    h("div", { class: "lompat-baris" }, masukan, h("button", { type: "submit", class: "tombol tombol-utama" }, "Buka")),
    pesan,
  );

  /** @param {PasalDaftar[]} pasal */
  const kisi = (pasal) =>
    h(
      "div",
      { class: "kisi-pasal kisi-pasal-pdf" },
      pasal.map((p) =>
        h(
          "button",
          {
            type: "button",
            class: "chip-pasal",
            "aria-label": `${namaPasal({ nomor: p.nomor, penjelasan: false })}${p.halaman ? `, halaman ${p.halaman}` : ""}`,
            onclick: () => pergi(p.nomor, p.halaman),
          },
          h("b", null, p.nomor),
          p.halaman ? h("small", null, `h. ${p.halaman}`) : null,
        ),
      ),
    );

  const adaBab = badan.some((g) => g.bab !== null);
  const daftar = !semua.length
    ? h("p", { class: "redup" }, "Lexa belum menyimpan pasal peraturan ini. Ketik nomor pasal di atas untuk mencarinya di teks PDF.")
    : adaBab
      ? h(
          "div",
          { class: "daftar-bab" },
          badan.map((g) =>
            h(
              "details",
              { class: "grup-bab" },
              h("summary", null, h("span", { class: "nama-bab" }, g.bab ? rapikanHuruf(g.bab) : "Tanpa bab"), h("span", { class: "rentang-pasal" }, [rentangPasal(g.pasal), rentangHalaman(g.pasal)].filter(Boolean).join(" · "))),
              kisi(g.pasal),
            ),
          ),
        )
      : kisi(semua);

  lembar = bukaLembar({ judul: "Pasal", isi: [lompat, daftar], kelas: "lembar-pasal-pdf" });
  // Di layar sentuh papan ketik yang langsung muncul akan menutupi daftarnya.
  if (!matchMedia("(pointer: coarse)").matches) masukan.focus({ preventScroll: true });
  return lembar;
}
