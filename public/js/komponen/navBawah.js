// @ts-check
import { h } from "../dom.js";
import { ikon } from "./ikon.js";
import { koleksi, pantau, sesi } from "../state.js";

/** Tab utama di ponsel. `cocok` menentukan path mana yang menandai tab ini aktif. */
const TAB = [
  { href: "/", label: "Cari", ikon: "cari", cocok: ["/", "/cari"] },
  { href: "/telusuri", label: "Telusuri", ikon: "daftar", cocok: ["/telusuri", "/peraturan"] },
  { href: "/tanya", label: "Tanya", ikon: "tanya", cocok: ["/tanya"] },
  { href: "/koleksi", label: "Koleksi", ikon: "tandai", cocok: ["/koleksi"] },
  { href: "/akun", label: "Akun", ikon: "akun", cocok: ["/akun", "/tentang", "/status"] },
];

/**
 * Bilah navigasi bawah untuk layar sempit (CSS menyembunyikannya di desktop). Menggantikan menu
 * hamburger: tujuan utama selalu terlihat dan terjangkau ibu jari.
 */
export function bangunNavBawah() {
  const lencana = h("span", { class: "lencana-jumlah sembunyi", "aria-label": "jumlah koleksi" });
  const tautan = TAB.map((t) =>
    h(
      "a",
      { href: t.href, "data-tab": t.href },
      h("span", { class: "tab-ikon" }, ikon(t.ikon), t.href === "/koleksi" ? lencana : null),
      h("span", { class: "tab-label" }, t.label),
    ),
  );
  const nav = h("nav", { class: "nav-bawah", "aria-label": "Navigasi utama" }, tautan);

  const gambarJumlah = () => {
    lencana.textContent = String(koleksi.jumlah);
    lencana.classList.toggle("sembunyi", koleksi.jumlah === 0);
  };
  gambarJumlah();
  pantau("koleksi", gambarJumlah);

  // Label "Akun" menjadi "Masuk" bagi tamu bila login tersedia, agar jalurnya jelas.
  const labelAkun = /** @type {HTMLElement} */ (tautan[4].querySelector(".tab-label"));
  const gambarAkun = () => {
    labelAkun.textContent = sesi.data.masuk ? "Akun" : sesi.data.login_tersedia ? "Masuk" : "Akun";
  };
  gambarAkun();
  pantau("sesi", gambarAkun);

  /** @param {string} path */
  function tandaiAktif(path) {
    for (const a of tautan) {
      const t = TAB.find((x) => x.href === a.getAttribute("data-tab"));
      const aktif = Boolean(t?.cocok.includes(path));
      if (aktif) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
  }

  return { nav, tandaiAktif };
}
