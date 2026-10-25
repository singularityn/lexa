// @ts-check
/**
 * "Periksa pasal" di penampil PDF: memindai SELURUH batang tubuh PDF dan membandingkan nomor pasal yang judulnya tampak di sana
 * dengan pasal yang tersimpan di Lexa. Pasal yang ada di PDF tetapi tak ada di Lexa kemungkinan terlewat oleh ekstraksi, dan
 * sebaliknya. Itu mengubah "ekstraksi mungkin keliru" menjadi daftar yang bisa diperiksa satu per satu (setiap nomor membuka
 * halamannya). Yang dibandingkan hanya nomor pasal; isi pasal tetap perlu dibaca di halaman PDF-nya.
 */

import { h } from "../dom.js";
import { bandingkanPasal } from "../pdfPasal.js";
import { ikon } from "./ikon.js";
import { bukaLembar } from "./lembar.js";

/** Paling banyak nomor yang diperinci per daftar hasil pemeriksaan; sisanya disebut jumlahnya. */
const MAKS_NOMOR_TAMPIL = 60;

/**
 * @param {{
 *   indeks: ReturnType<typeof import("../indeksPasalPdf.js").buatIndeksPasal>,
 *   nomorPasalLexa: () => string[],
 *   keHalaman: (no: number) => void,
 * }} o
 */
export function bukaPeriksa({ indeks, nomorPasalLexa, keHalaman }) {
  let dibatalkan = false;
  let selesai = false;
  /** @type {ReturnType<typeof bukaLembar>} */
  let lembar;

  const kemajuan = h("p", { class: "redup", role: "status", "aria-live": "polite" }, "Membaca judul pasal di PDF…");
  const hasil = h("div", { class: "pdf-periksa-hasil", role: "status", "aria-live": "polite" });
  hasil.hidden = true;
  const tombol = /** @type {HTMLButtonElement} */ (
    h(
      "button",
      {
        type: "button",
        class: "tombol",
        onclick: () => {
          if (selesai) {
            lembar.tutup();
            return;
          }
          dibatalkan = true;
          tombol.disabled = true;
          tombol.textContent = "Membatalkan…";
        },
      },
      "Batalkan",
    )
  );

  /** Daftar nomor sebagai tombol (membuka halaman PDF-nya) atau butir polos. @param {string[]} nomor @param {boolean} bisaBuka */
  function daftarNomor(nomor, bisaBuka) {
    const tampil = nomor.slice(0, MAKS_NOMOR_TAMPIL);
    return h(
      "div",
      { class: "pdf-nomor-daftar" },
      tampil.map((n) => {
        const halaman = indeks.halamanDari(n);
        return bisaBuka && halaman
          ? h(
              "button",
              {
                type: "button",
                class: "chip pdf-nomor",
                "aria-label": `Pasal ${n}, buka halaman ${halaman} PDF`,
                title: `Buka halaman ${halaman}`,
                onclick: () => {
                  lembar.tutup();
                  requestAnimationFrame(() => keHalaman(halaman));
                },
              },
              n,
            )
          : h("span", { class: "chip pdf-nomor pdf-nomor-polos" }, n);
      }),
      nomor.length > tampil.length ? h("span", { class: "redup" }, ` dan ${nomor.length - tampil.length} lainnya`) : null,
    );
  }

  /** @param {boolean} sebagian pemeriksaan dibatalkan sebelum seluruh batang tubuh terbaca */
  function tampilkan(sebagian) {
    const { tanpaTeks, sudahDipindai, jumlahHalaman, akhirBadan, jumlahJudul } = indeks.keadaan();
    const bagian = [];
    if (sebagian && jumlahJudul === 0) {
      bagian.push(h("p", null, h("strong", null, "Pemeriksaan dibatalkan"), " sebelum ada judul pasal yang terbaca."));
    } else if (tanpaTeks) {
      bagian.push(h("p", null, h("strong", null, "PDF ini hasil pindaian tanpa lapisan teks."), " Judul pasalnya tak bisa dibaca otomatis, jadi pemeriksaan tak dapat dilakukan. Bandingkan dengan membaca halamannya."));
    } else {
      const r = bandingkanPasal(indeks.nomor(), nomorPasalLexa());
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
      if (sebagian) bagian.push(h("p", { class: "redup" }, `Pemeriksaan dibatalkan setelah ${sudahDipindai} dari ${jumlahHalaman} halaman dibaca; hasil ini sebagian.`));
      else if (akhirBadan) bagian.push(h("p", { class: "redup" }, "Hanya batang tubuh yang dibandingkan; bagian penjelasan tidak dihitung."));
    }
    if (jumlahJudul) bagian.push(h("p", { class: "redup" }, "Yang dibandingkan hanya nomor pasal. Isi pasal tetap perlu dibaca di halaman PDF."));
    hasil.replaceChildren(...bagian);
    hasil.hidden = false;
  }

  lembar = bukaLembar({
    judul: "Periksa pasal",
    isi: [h("p", { class: "redup" }, "Membandingkan judul pasal di PDF dengan teks di Lexa."), kemajuan, hasil],
    kaki: tombol,
    kelas: "lembar-periksa",
    saatTutup: () => {
      dibatalkan = true;
    },
  });

  void (async () => {
    const lapor = (/** @type {number} */ sudah, /** @type {number} */ total) => {
      kemajuan.textContent = `Memindai halaman ${sudah} dari ${total}…`;
    };
    const { sudahDipindai, jumlahHalaman } = indeks.keadaan();
    lapor(sudahDipindai, jumlahHalaman);
    await indeks.pindai({ batal: () => dibatalkan, lapor });
    // Lembar ditutup sebelum selesai: tak ada yang perlu ditampilkan.
    if (!lembar.el.isConnected) return;
    selesai = true;
    kemajuan.hidden = true;
    tampilkan(dibatalkan && indeks.bisaMemindai());
    tombol.disabled = false;
    tombol.textContent = "Tutup";
  })();
  return lembar;
}
