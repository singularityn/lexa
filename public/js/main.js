// @ts-check
/**
 * Titik masuk Lexa: menyusun kerangka halaman (header, konten, footer),
 * memasang router, dan memuat sesi di latar belakang.
 */

import { h, isi } from "./dom.js";
import { buatRouter } from "./router.js";
import { pasangNavigasi, pergi } from "./navigasi.js";
import { koleksi, pantau, sesi, siap, tema } from "./state.js";
import { ikon } from "./komponen/ikon.js";
import { kotakCari } from "./komponen/kotakCari.js";
import { bangunNavBawah } from "./komponen/navBawah.js";
import { bangunPitaLuring } from "./komponen/pitaLuring.js";
import { buatAreaToast, toast } from "./komponen/toast.js";
import { modeMandiri, mulaiPwa } from "./pwa.js";
import { queryString } from "./format.js";

const VERSI = "0.2.0";

/** @type {Record<string, import("./router.js").Rute>} */
const rute = {
  "/": { halaman: "beranda", muat: () => import("./halaman/beranda.js") },
  "/cari": { halaman: "cari", muat: () => import("./halaman/cari.js") },
  "/telusuri": { halaman: "telusuri", muat: () => import("./halaman/telusuri.js") },
  "/peraturan": { halaman: "peraturan", muat: () => import("./halaman/peraturan.js") },
  "/tanya": { halaman: "tanya", muat: () => import("./halaman/tanya.js") },
  "/koleksi": { halaman: "koleksi", muat: () => import("./halaman/koleksi.js") },
  "/akun": { halaman: "akun", muat: () => import("./halaman/akun.js") },
  "/tentang": { halaman: "tentang", muat: () => import("./halaman/tentang.js") },
  "/status": { halaman: "status", muat: () => import("./halaman/status.js") },
};
/** @type {import("./router.js").Rute} */
const tidakDitemukan = { halaman: "tidak-ditemukan", muat: () => import("./halaman/tidakDitemukan.js") };

/** Halaman puncak tiap tab; selainnya (hasil, detail, dst.) dapat "kembali". */
const HALAMAN_AKAR = new Set(["/", "/telusuri", "/tanya", "/koleksi", "/akun"]);

const NAV = [
  ["/telusuri", "Telusuri"],
  ["/tanya", "Tanya Lexa"],
  ["/koleksi", "Koleksi"],
  ["/tentang", "Tentang"],
];

function bangunHeader() {
  const lencanaKoleksi = h("span", { class: "lencana-jumlah sembunyi", "aria-label": "jumlah koleksi" });
  const tautanKoleksi = h("a", { href: "/koleksi", "data-nav": "/koleksi" }, "Koleksi", lencanaKoleksi);
  const nav = h(
    "nav",
    { class: "nav", id: "nav-utama", "aria-label": "Utama" },
    NAV.map(([href, label]) => (href === "/koleksi" ? tautanKoleksi : h("a", { href, "data-nav": href }, label))),
  );

  const tombolMenu = h(
    "button",
    {
      type: "button",
      class: "tombol tombol-hantu tombol-ikon tombol-menu",
      "aria-label": "Menu",
      "aria-expanded": "false",
      "aria-controls": "nav-utama",
      onclick: () => {
        const buka = nav.classList.toggle("terbuka");
        tombolMenu.setAttribute("aria-expanded", String(buka));
      },
    },
    ikon("menu"),
  );

  const cari = kotakCari({
    ukuran: "ringkas",
    placeholder: "Cari peraturan…",
    label: "Cari peraturan",
    tombol: false,
    saatKirim: (q) => pergi(`/cari${queryString({ q })}`),
  });
  const bungkusCari = h("div", { class: "header-cari" }, cari);

  // Aplikasi yang dibuka dari layar utama tidak punya tombol kembali peramban (iOS) atau hanya gestur; sediakan sendiri.
  const tombolKembali = h(
    "button",
    {
      type: "button",
      class: "tombol tombol-hantu tombol-ikon tombol-kembali",
      "aria-label": "Kembali",
      hidden: true,
      onclick: () => (history.length > 1 ? history.back() : pergi("/")),
    },
    ikon("kiri"),
  );

  const tombolTema = h("button", { type: "button", class: "tombol tombol-hantu tombol-ikon", onclick: () => tema.alihkan() });
  const gambarTema = () => {
    const gelap = tema.efektif() === "gelap";
    tombolTema.setAttribute("aria-label", gelap ? "Ganti ke tema terang" : "Ganti ke tema gelap");
    tombolTema.title = gelap ? "Tema terang" : "Tema gelap";
    tombolTema.replaceChildren(ikon(gelap ? "matahari" : "bulan"));
  };
  gambarTema();
  pantau("tema", gambarTema);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", gambarTema);

  const akun = h("a", { class: "nav-akun", href: "/akun", "data-nav": "/akun" });
  const gambarAkun = () => {
    const { masuk, pengguna } = sesi.data;
    if (masuk && pengguna) {
      const nama = pengguna.nama || pengguna.email;
      akun.setAttribute("aria-label", `Akun ${nama}`);
      akun.title = nama;
      akun.replaceChildren(
        pengguna.foto_url
          ? h("img", { class: "avatar", src: pengguna.foto_url, alt: "", referrerpolicy: "no-referrer" })
          : h("span", { class: "avatar-huruf", "aria-hidden": "true" }, nama.slice(0, 1).toUpperCase()),
      );
    } else {
      akun.removeAttribute("aria-label");
      akun.title = "";
      akun.replaceChildren("Masuk");
    }
  };
  gambarAkun();
  pantau("sesi", gambarAkun);

  const gambarJumlah = () => {
    lencanaKoleksi.textContent = String(koleksi.jumlah);
    lencanaKoleksi.classList.toggle("sembunyi", koleksi.jumlah === 0);
  };
  pantau("koleksi", gambarJumlah);

  const header = h(
    "header",
    { class: "header" },
    h(
      "div",
      { class: "bungkus header-isi" },
      tombolKembali,
      h("a", { class: "merek", href: "/", "aria-label": "Lexa, ke beranda" }, h("img", { src: "/favicon.svg", alt: "", width: "30", height: "30" }), h("span", { class: "merek-teks" }, "Lexa")),
      tombolMenu,
      nav,
      bungkusCari,
      h("div", { class: "header-aksi" }, tombolTema, akun),
    ),
    bangunPitaLuring(),
  );

  /** @param {string} path */
  function tandaiAktif(path) {
    for (const a of header.querySelectorAll("[data-nav]")) {
      const aktif = a.getAttribute("data-nav") === path || (path === "/peraturan" && a.getAttribute("data-nav") === "/telusuri");
      if (aktif) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    nav.classList.remove("terbuka");
    tombolMenu.setAttribute("aria-expanded", "false");
    tombolKembali.hidden = !(modeMandiri() && !HALAMAN_AKAR.has(path));
    // Halaman yang sudah punya kotak cari sendiri tidak memerlukan yang di header.
    bungkusCari.classList.toggle("sembunyi", path === "/" || path === "/cari");
  }

  return { header, tandaiAktif };
}

function bangunFooter() {
  return h(
    "footer",
    { class: "footer" },
    h(
      "div",
      { class: "bungkus footer-isi" },
      h(
        "div",
        null,
        h("strong", null, "Lexa"),
        ` ${VERSI} · Bukan nasihat hukum. Rujuk naskah resmi di `,
        h("a", { href: "https://peraturan.bpk.go.id", rel: "noopener noreferrer", target: "_blank" }, "peraturan.bpk.go.id"),
        ".",
      ),
      h("nav", { "aria-label": "Tautan footer" }, h("a", { href: "/tentang" }, "Tentang & batasan"), h("a", { href: "/status" }, "Status data"), h("a", { href: "/sitemap.xml", "data-luar": "" }, "Peta situs")),
    ),
  );
}

async function mulai() {
  const app = /** @type {HTMLElement} */ (document.getElementById("app"));
  const { header, tandaiAktif } = bangunHeader();
  const navBawah = bangunNavBawah();
  const konten = h("main", { id: "konten", tabindex: "-1", class: "bungkus" });
  const pengumuman = h("div", { class: "sr-only", role: "status", "aria-live": "polite" });
  isi(app, header, konten, bangunFooter(), navBawah.nav, buatAreaToast(), pengumuman);

  const router = buatRouter({
    rute,
    akar: konten,
    pengumuman,
    tidakDitemukan,
    saatBerubah: (path) => {
      tandaiAktif(path);
      navBawah.tandaiAktif(path);
      document.body.dataset.halaman = (rute[path] ?? tidakDitemukan).halaman;
    },
  });
  pasangNavigasi(router.pergi);

  // Pintasan "/" memfokuskan kotak cari yang terlihat, seperti di banyak situs dokumentasi.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    const el = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;
    const input = /** @type {HTMLInputElement | null} */ (document.querySelector('main input[type="search"], .header-cari:not(.sembunyi) input[type="search"]'));
    if (input) {
      e.preventDefault();
      input.focus();
    }
  });

  // Sesi dan koleksi dimuat di latar belakang; halaman tidak menunggunya kecuali memerlukannya.
  siap().then(({ digabung }) => {
    if (digabung) toast(`${digabung} peraturan dari perangkat ini digabung ke koleksi akun Anda.`);
  });

  // Sebelum rute pertama: panggilan API halaman pertama pun bisa dijawab dari salinan luring, dan pendengarnya harus sudah ada.
  mulaiPwa();
  await router.mulai();
}

mulai();
