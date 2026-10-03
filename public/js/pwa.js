// @ts-check
/**
 * PWA: pendaftaran service worker, ajakan memasang ke layar utama, dan status luring.
 *
 * Android/Chrome mengirim `beforeinstallprompt` (ditahan lalu dipicu dari tombol kami). iOS Safari
 * tidak punya API pemasangan, jadi pengguna dipandu memakai menu Bagikan. Aplikasi yang sudah
 * dibuka dari layar utama (display-mode: standalone) tidak ditawari apa-apa.
 */

import { pantau, penyimpanan } from "./state.js";
import { toast } from "./komponen/toast.js";

const KUNCI_TUNDA = "lexa:pasang:tunda";
const TUNDA_MS = 14 * 24 * 3600 * 1000;
const PERIKSA_PEMBARUAN_MS = 30 * 60 * 1000;

/** @type {any} */
let acaraPasang = null;
/** @type {Set<() => void>} */
const pendengar = new Set();
const kabari = () => pendengar.forEach((fn) => fn());

export function daftarkanServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  // Versi baru yang mengambil alih halaman yang sedang terbuka: tawarkan muat ulang, jangan paksa
  // (pengguna mungkin sedang menulis pertanyaan). Pemasangan pertama (belum ada pengendali) tidak dihitung.
  const sudahDikendalikan = navigator.serviceWorker.controller !== null;
  let sudahDiberitahu = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!sudahDikendalikan || sudahDiberitahu) return;
    sudahDiberitahu = true;
    toast("Lexa versi baru tersedia.", { durasi: 60_000, aksi: { label: "Muat ulang", saat: () => location.reload() } });
  });

  const daftar = async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      // Aplikasi di layar utama bisa terbuka berhari-hari: cari pembaruan saat kembali ke latar depan.
      let terakhir = Date.now();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible" || Date.now() - terakhir < PERIKSA_PEMBARUAN_MS) return;
        terakhir = Date.now();
        reg.update().catch(() => {});
      });
    } catch {
      // Tanpa service worker (mode privat tertentu, penyimpanan diblokir) aplikasi tetap berjalan.
    }
  };
  // Setelah halaman selesai dimuat, agar pemasangan tidak bersaing dengan pemuatan awal.
  if (document.readyState === "complete") void daftar();
  else addEventListener("load", () => void daftar(), { once: true });
}

export function sudahTerpasang() {
  return (
    matchMedia("(display-mode: standalone)").matches ||
    matchMedia("(display-mode: minimal-ui)").matches ||
    /** @type {any} */ (navigator).standalone === true
  );
}

/** Dibuka dari layar utama tanpa bilah peramban (tidak ada tombol kembali bawaan, terutama di iOS). */
export function modeMandiri() {
  return matchMedia("(display-mode: standalone)").matches || /** @type {any} */ (navigator).standalone === true;
}

/** iPhone/iPad (iPadOS menyamar sebagai Mac, dikenali dari layar sentuh). */
export function perangkatIos() {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function pasangTersedia() {
  return acaraPasang !== null;
}

export function ajakanDitunda() {
  const t = Number(penyimpanan.baca(KUNCI_TUNDA));
  return Number.isFinite(t) && t > 0 && Date.now() - t < TUNDA_MS;
}

export function tundaAjakan() {
  penyimpanan.tulis(KUNCI_TUNDA, String(Date.now()));
  kabari();
}

/** Perlu menampilkan ajakan pasang (spanduk) saat ini? */
export function perluAjakan() {
  return !sudahTerpasang() && !ajakanDitunda() && (pasangTersedia() || perangkatIos());
}

/** @returns {Promise<"accepted" | "dismissed" | "tidak-tersedia">} */
export async function pasangSekarang() {
  const acara = acaraPasang;
  if (!acara) return "tidak-tersedia";
  acaraPasang = null;
  kabari();
  acara.prompt();
  const { outcome } = await acara.userChoice;
  return outcome;
}

/** @param {() => void} fn @returns {() => void} */
export function pantauPasang(fn) {
  pendengar.add(fn);
  return () => void pendengar.delete(fn);
}

/**
 * Samakan warna bilah status/judul (theme-color) dengan tema yang tampil. Meta di index.html hanya
 * mengikuti pengaturan sistem lewat media query; pilihan tema manual di aplikasi tidak terlihat olehnya.
 */
export function selaraskanWarnaBilah() {
  const terapkan = () => {
    const warna = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    if (!warna) return;
    let meta = document.head.querySelector('meta[name="theme-color"][data-dinamis]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      meta.setAttribute("data-dinamis", "");
      // Peramban memakai theme-color pertama yang cocok; yang tanpa media ini selalu cocok.
      document.head.prepend(meta);
    }
    meta.setAttribute("content", warna);
  };
  terapkan();
  pantau("tema", terapkan);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", terapkan);
}

/** Memasang pendengar global; dipanggil sekali saat aplikasi mulai. */
export function mulaiPwa() {
  selaraskanWarnaBilah();
  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    acaraPasang = e;
    kabari();
  });
  addEventListener("appinstalled", () => {
    acaraPasang = null;
    kabari();
    toast("Lexa terpasang di perangkat Anda.");
  });
  // Service worker menandai jawaban yang berasal dari salinan perangkat (lihat api.js).
  let sudahDiberitahu = false;
  addEventListener("lexa:salinan", () => {
    if (sudahDiberitahu) return;
    sudahDiberitahu = true;
    toast("Menampilkan salinan yang tersimpan di perangkat (tanpa jaringan).", { durasi: 5000 });
  });
  daftarkanServiceWorker();
}
