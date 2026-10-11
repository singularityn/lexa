// @ts-check
import { h } from "../dom.js";

/**
 * Garis tipis di puncak layar yang menunjukkan sejauh mana peraturan sudah digulir. Hanya tampil di
 * halaman peraturan (`atur(true)`); dihitung dari gulir jendela dan hanya dekoratif (aria-hidden).
 */
export function bangunProgresBaca() {
  const garis = h("div", { class: "progres-baca-isi" });
  const el = h("div", { class: "progres-baca sembunyi", "aria-hidden": "true" }, garis);
  let nyala = false;
  const hitung = () => {
    const tinggi = document.documentElement.scrollHeight - innerHeight;
    const p = tinggi > 80 ? Math.min(1, Math.max(0, scrollY / tinggi)) : 0;
    garis.style.transform = `scaleX(${p})`;
  };
  addEventListener(
    "scroll",
    () => {
      if (nyala) hitung();
    },
    { passive: true },
  );
  addEventListener("resize", () => {
    if (nyala) hitung();
  });
  return {
    el,
    /** @param {boolean} aktif */
    atur(aktif) {
      nyala = aktif;
      el.classList.toggle("sembunyi", !aktif);
      if (aktif) hitung();
      else garis.style.transform = "scaleX(0)";
    },
  };
}
