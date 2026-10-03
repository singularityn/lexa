// @ts-check
import { h } from "../dom.js";
import { namaPasal, rapikanHuruf, strukturDaftarIsi } from "../format.js";
import { ikon } from "./ikon.js";

/** Di bawah lebar ini daftar isi menjadi lembar dari bawah; di atasnya kolom di samping teks (lihat app.css). */
const SEMPIT = "(max-width: 1099px)";

/**
 * Rentang nomor pasal sebuah BAB. Nomor kembar (id berakhiran ~n, hasil salah deteksi saat ekstraksi) tidak
 * dijadikan batas: "Pasal 183–48" semestinya "Pasal 183–190".
 * @param {Array<{ nomor: string, jangkar: string }>} pasal
 */
function rentangPasal(pasal) {
  const asli = pasal.filter((p) => !p.jangkar.includes("~"));
  const dasar = asli.length ? asli : pasal;
  const awal = dasar[0]?.nomor;
  const akhir = dasar.at(-1)?.nomor;
  return dasar.length === 1 || awal === akhir ? `Pasal ${awal}` : `Pasal ${awal}–${akhir}`;
}

/** Penjelasan: "Umum dan Pasal 1–193". @param {Array<{ nomor: string, jangkar: string }>} pasal */
function rentangPenjelasan(pasal) {
  const umum = pasal.some((p) => p.nomor === "Umum");
  const bernomor = pasal.filter((p) => p.nomor !== "Umum");
  const rentang = bernomor.length ? `Pasal ${bernomor[0].nomor}${bernomor.length > 1 ? `–${bernomor.at(-1)?.nomor}` : ""}` : "";
  return [umum ? "Umum" : "", rentang].filter(Boolean).join(" dan ");
}

/** "pasal 5a", " 12 " menjadi "5a", "12". @param {string} t */
const normalNomor = (t) => t.trim().replace(/^pasal\s*/i, "").replace(/\s+/g, "").toLowerCase();

/**
 * Daftar isi peraturan: BAB dengan nomor pasalnya, dan kolom "Lompat ke pasal".
 *
 * Layar lebar: kolom lengket di samping teks. Layar sempit: lembar modal yang dibuka lewat `tombol`
 * (di bilah alat) atau `tombolMengambang` (muncul saat bilah alat sudah tergulir lewat).
 *
 * @param {{
 *   kelompok: ReturnType<typeof import("../format.js").kelompokkanPasal>,
 *   keJangkar: (jangkar: string) => void,
 * }} opsi
 */
export function buatDaftarIsi({ kelompok, keJangkar }) {
  const struktur = strukturDaftarIsi(kelompok);
  const adaBab = struktur.some((g) => g.bab !== null || g.penjelasan);
  const sempit = matchMedia(SEMPIT);

  const pesan = h("p", { class: "bantu", role: "status", "aria-live": "polite" });
  const masukan = /** @type {HTMLInputElement} */ (
    h("input", { class: "input", type: "text", inputmode: "text", enterkeyhint: "go", autocomplete: "off", autocapitalize: "off", placeholder: "mis. 156 atau 5a", "aria-label": "Nomor pasal", name: "nomor-pasal" })
  );

  /** @param {string} jangkar */
  function pilih(jangkar) {
    tutup();
    // Setelah lembar tertutup (gulir latar terbuka kembali), baru menggulir.
    requestAnimationFrame(() => keJangkar(jangkar));
  }

  const lompat = h(
    "form",
    {
      class: "lompat-pasal",
      onsubmit: (/** @type {SubmitEvent} */ e) => {
        e.preventDefault();
        const n = normalNomor(masukan.value);
        if (!n) return;
        // Nomor yang sama ada di batang tubuh dan di penjelasannya; yang pertama dicari adalah batang tubuh.
        const ada = kelompok.find((g) => !g.penjelasan && g.nomor.toLowerCase() === n) ?? kelompok.find((g) => g.nomor.toLowerCase() === n);
        if (!ada) {
          pesan.textContent = `Pasal ${masukan.value.trim()} tidak ada di peraturan ini.`;
          return;
        }
        pesan.textContent = "";
        pilih(ada.jangkar);
      },
    },
    h("label", { class: "bidang", for: "lompat-nomor" }, "Lompat ke pasal"),
    h("div", { class: "lompat-baris" }, masukan, h("button", { type: "submit", class: "tombol tombol-utama" }, "Pergi")),
    pesan,
  );
  masukan.id = "lompat-nomor";
  masukan.addEventListener("input", () => (pesan.textContent = ""));

  /** @param {{ nomor: string, jangkar: string }[]} pasal @param {boolean} [penjelasan] */
  const kisi = (pasal, penjelasan = false) =>
    h(
      "div",
      { class: "kisi-pasal" },
      pasal.map((p) =>
        h("a", { href: `#${p.jangkar}`, "aria-label": namaPasal({ nomor: p.nomor, penjelasan }), onclick: (/** @type {MouseEvent} */ e) => { e.preventDefault(); pilih(p.jangkar); } }, p.nomor),
      ),
    );

  const isiDaftar = adaBab
    ? h(
        "div",
        { class: "daftar-bab" },
        struktur.map((g) => {
          const rentang = g.penjelasan ? rentangPenjelasan(g.pasal) : rentangPasal(g.pasal);
          return h(
            "details",
            { class: "grup-bab" },
            h("summary", null, h("span", { class: "nama-bab" }, g.penjelasan ? "Penjelasan" : g.bab ? rapikanHuruf(g.bab) : "Tanpa bab"), h("span", { class: "rentang-pasal" }, rentang)),
            kisi(g.pasal, g.penjelasan),
          );
        }),
      )
    : kisi(struktur.flatMap((g) => g.pasal));

  const dialog = /** @type {HTMLDialogElement} */ (
    h(
      "dialog",
      { class: "daftar-isi", "aria-labelledby": "judul-daftar-isi" },
      h(
        "div",
        { class: "lembar-kepala" },
        h("h2", { id: "judul-daftar-isi" }, "Daftar isi"),
        h("button", { type: "button", class: "tombol tombol-hantu tombol-ikon", "aria-label": "Tutup daftar isi", onclick: () => tutup() }, ikon("tutup")),
      ),
      h("div", { class: "lembar-isi" }, lompat, isiDaftar),
    )
  );
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog && dialog.open && sempit.matches) tutup();
  });
  dialog.addEventListener("close", () => tombol.setAttribute("aria-expanded", "false"));
  if (!sempit.matches) dialog.setAttribute("open", "");
  sempit.addEventListener("change", () => {
    if (sempit.matches) {
      if (dialog.open) dialog.close();
    } else if (!dialog.open) {
      dialog.show();
    }
  });

  const tombol = h("button", { type: "button", class: "tombol tombol-kecil tombol-daftar-isi", "aria-haspopup": "dialog", "aria-expanded": "false", onclick: () => buka() }, ikon("toc"), "Daftar isi");
  const tombolMengambang = h("button", { type: "button", class: "fab-daftar-isi sembunyi", "aria-haspopup": "dialog", onclick: () => buka() }, ikon("toc"), h("span", null, "Daftar isi"));

  function buka() {
    if (!sempit.matches) {
      masukan.focus();
      return;
    }
    if (!dialog.open) dialog.showModal();
    tombol.setAttribute("aria-expanded", "true");
  }
  function tutup() {
    if (sempit.matches && dialog.open) dialog.close();
  }

  const el = h("aside", { class: "rel-daftar-isi", "aria-label": "Daftar isi" }, dialog);

  return {
    el,
    tombol,
    tombolMengambang,
    /** @param {boolean} tampil */
    tampilkanMengambang(tampil) {
      tombolMengambang.classList.toggle("sembunyi", !tampil);
    },
    buka,
    tutup,
  };
}
