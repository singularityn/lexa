// @ts-check
import { h, isi } from "../dom.js";
import { judulRingkas, urlPeraturan } from "../format.js";
import { pantau } from "../state.js";
import { riwayat } from "../riwayat.js";
import { jenisDariSitasi, kelasJenis, kodePendek } from "./jenis.js";

/**
 * Daftar "Terakhir dilihat" di sidebar layar lebar (CSS menyembunyikannya di ponsel). Ikut berubah
 * saat riwayat berubah; peraturan yang sudah dibaca cukup jauh dibuka langsung di pasal terakhirnya.
 */
export function bangunSisiDilihat() {
  const akar = h("div", { class: "sisi-dilihat sembunyi" });
  const gambar = () => {
    const daftar = riwayat.dilihat().slice(0, 4);
    akar.classList.toggle("sembunyi", daftar.length === 0);
    isi(
      akar,
      h("div", { class: "sisi-judul", id: "sisi-dilihat-judul" }, "Terakhir dilihat"),
      h(
        "ul",
        { class: "sisi-daftar", "aria-labelledby": "sisi-dilihat-judul" },
        daftar.map((d) => {
          const jenis = jenisDariSitasi(d.sitasi);
          return h(
            "li",
            null,
            h(
              "a",
              { href: urlPeraturan(d.uri, { jangkar: riwayat.posisi(d.uri)?.jangkar }) },
              h("span", { class: ["kode-jenis", kelasJenis(jenis)], "aria-hidden": "true" }, kodePendek(jenis)),
              h("span", { class: "sisi-teks" }, h("b", null, d.sitasi), h("small", null, judulRingkas(d.judul))),
            ),
          );
        }),
      ),
    );
  };
  gambar();
  pantau("riwayat", gambar);
  return akar;
}
