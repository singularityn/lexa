// @ts-check
import { h } from "../dom.js";
import { ikon } from "./ikon.js";

let cacahId = 0;

/**
 * Lembar modal berbasis <dialog>: naik dari bawah di ponsel, kartu di tengah di layar lebar.
 * Fokus terperangkap di dalamnya, Esc dan klik pada latar menutupnya, dan halaman di belakangnya
 * tidak tergulir (lihat app.css). Dibuat saat dibutuhkan lalu dibuang dari dokumen saat tertutup.
 *
 * @param {{
 *   judul: string,
 *   isi: Array<import("../dom.js").Anak>,
 *   kaki?: import("../dom.js").Anak,
 *   kelas?: string,
 *   saatTutup?: () => void,
 * }} opsi
 * @returns {{ el: HTMLDialogElement, tutup: () => void }}
 */
export function bukaLembar(opsi) {
  const id = `lembar-${++cacahId}`;
  const dialog = /** @type {HTMLDialogElement} */ (
    h(
      "dialog",
      { class: ["lembar", opsi.kelas].filter(Boolean).join(" "), "aria-labelledby": id },
      h(
        "div",
        { class: "lembar-kepala" },
        h("h2", { id }, opsi.judul),
        h("button", { type: "button", class: "tombol tombol-hantu tombol-ikon", "aria-label": "Tutup", onclick: () => dialog.close() }, ikon("tutup")),
      ),
      h("div", { class: "lembar-isi" }, ...opsi.isi),
      opsi.kaki ? h("div", { class: "lembar-kaki" }, opsi.kaki) : null,
    )
  );
  document.body.appendChild(dialog);
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    opsi.saatTutup?.();
  });
  dialog.showModal();
  return { el: dialog, tutup: () => dialog.close() };
}

/**
 * @typedef {{
 *   ikon: string,
 *   label: string,
 *   keterangan?: string,
 *   href?: string | null,
 *   unduh?: string,
 *   saat?: () => void | Promise<void>,
 *   tampil?: boolean,
 * }} AksiLembar
 */

/**
 * Daftar aksi sebagai lembar: tiap baris tombol besar yang mudah diketuk. `href` membuka tautan di tab
 * baru (atau mengunduhnya dengan nama `unduh`, untuk berkas di asal yang sama), `saat` menjalankan fungsi
 * lalu menutup lembar. Aksi dengan `tampil: false` dilewati.
 *
 * @param {{ judul: string, aksi: AksiLembar[], saatTutup?: () => void }} opsi
 */
export function bukaLembarAksi(opsi) {
  /** @type {ReturnType<typeof bukaLembar>} */
  let lembar;
  const baris = opsi.aksi
    .filter((a) => a.tampil !== false)
    .map((a) => {
      const isi = [
        ikon(a.ikon),
        h("span", { class: "aksi-teks" }, h("span", null, a.label), a.keterangan ? h("small", null, a.keterangan) : null),
      ];
      return a.href
        ? h(
            "a",
            { class: "aksi-baris", href: a.href, ...(a.unduh ? { download: a.unduh } : { target: "_blank", rel: "noopener noreferrer", "data-luar": "" }), onclick: () => lembar.tutup() },
            ...isi,
          )
        : h(
            "button",
            {
              type: "button",
              class: "aksi-baris",
              onclick: async () => {
                lembar.tutup();
                await a.saat?.();
              },
            },
            ...isi,
          );
    });
  lembar = bukaLembar({ judul: opsi.judul, isi: [h("div", { class: "aksi-daftar" }, baris)], kelas: "lembar-aksi", saatTutup: opsi.saatTutup });
  return lembar;
}
