// @ts-check
import { h, isi } from "../dom.js";
import { halamanKosong } from "../komponen/umum.js";

/** @param {import("../router.js").Konteks} ctx */
export default function tidakDitemukan(ctx) {
  ctx.setJudul("Halaman tidak ditemukan");
  isi(
    ctx.akar,
    halamanKosong(
      "Halaman tidak ditemukan",
      h("p", null, "Alamat yang Anda buka tidak ada di Lexa."),
      h("div", { class: "contoh" }, h("a", { class: "tombol tombol-utama", href: "/" }, "Ke beranda"), h("a", { class: "tombol", href: "/telusuri" }, "Telusuri peraturan")),
    ),
  );
}
