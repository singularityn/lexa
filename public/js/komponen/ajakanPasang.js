// @ts-check
import { h, isi } from "../dom.js";
import { ikon } from "./ikon.js";
import { pantauPasang, pasangSekarang, pasangTersedia, perangkatIos, perluAjakan, sudahTerpasang, tundaAjakan } from "../pwa.js";

const ALASAN = "Buka lebih cepat seperti aplikasi, dan peraturan yang pernah Anda buka tetap bisa dibaca tanpa sinyal.";

/** Panduan manual untuk Safari iPhone/iPad, yang tidak punya API pemasangan. */
function langkahIos() {
  return h(
    "ol",
    { class: "langkah-ios" },
    h("li", null, "Ketuk ikon ", h("strong", null, "Bagikan"), " ", ikon("bagikan"), " di bilah Safari."),
    h("li", null, "Pilih ", h("strong", null, "Tambahkan ke Layar Utama"), "."),
  );
}

/**
 * Pantau perubahan status pasang selama elemen masih ada di halaman; setelah halaman diganti,
 * pendengarnya berhenti sendiri.
 * @param {HTMLElement} akar
 * @param {() => void} gambar
 */
function ikutiStatusPasang(akar, gambar) {
  const berhenti = pantauPasang(() => {
    if (!akar.isConnected) berhenti();
    else gambar();
  });
}

/**
 * Spanduk "Pasang Lexa di layar utama". Tampil hanya bila peramban menawarkan pemasangan (Android
 * dan sebagian desktop) atau perangkatnya iOS (panduan manual), dan belum pernah ditunda.
 * @param {{ ringkas?: boolean }} [opsi]
 */
export function ajakanPasang(opsi = {}) {
  const akar = h("section", { class: ["ajakan-pasang", opsi.ringkas ? "ringkas" : ""], "aria-label": "Pasang aplikasi", hidden: true });

  const gambar = () => {
    const tampil = perluAjakan();
    akar.hidden = !tampil;
    if (!tampil) {
      akar.replaceChildren();
      return;
    }
    const ios = !pasangTersedia() && perangkatIos();
    akar.replaceChildren(
      h("div", { class: "ajakan-ikon", "aria-hidden": "true" }, ikon("pasang")),
      h("div", { class: "ajakan-teks" }, h("strong", null, "Pasang Lexa di layar utama"), h("p", null, ALASAN), ios ? langkahIos() : null),
      h(
        "div",
        { class: "ajakan-aksi" },
        ios
          ? null
          : h(
              "button",
              {
                type: "button",
                class: "tombol tombol-utama",
                onclick: async () => {
                  if ((await pasangSekarang()) === "dismissed") tundaAjakan();
                },
              },
              "Pasang",
            ),
        h("button", { type: "button", class: "tombol tombol-hantu", onclick: tundaAjakan }, "Nanti"),
      ),
    );
  };

  gambar();
  ikutiStatusPasang(akar, gambar);
  return akar;
}

/**
 * Kartu tetap di halaman Akun: selalu ada, apa pun jawaban pengguna pada spanduk, dan menjelaskan
 * cara memasang sesuai perangkatnya.
 */
export function kartuPasang() {
  const akar = h("div", { class: "kartu" });

  const gambar = () => {
    const ios = !pasangTersedia() && perangkatIos();
    isi(
      akar,
      h("h2", { class: "kartu-judul" }, "Pasang di layar utama"),
      sudahTerpasang()
        ? h("p", { class: "redup" }, "Lexa sudah terpasang dan dibuka sebagai aplikasi di perangkat ini.")
        : [
            h("p", null, ALASAN),
            pasangTersedia()
              ? h("button", { type: "button", class: "tombol tombol-utama", onclick: () => void pasangSekarang() }, ikon("pasang"), "Pasang Lexa")
              : ios
                ? langkahIos()
                : h(
                    "p",
                    { class: "bantu" },
                    "Di Chrome atau Edge: buka menu ⋮ lalu pilih “Pasang aplikasi” atau “Tambahkan ke layar utama”. Di Safari iPhone atau iPad: ketuk Bagikan, lalu “Tambahkan ke Layar Utama”.",
                  ),
          ],
    );
  };

  gambar();
  ikutiStatusPasang(akar, gambar);
  return akar;
}
