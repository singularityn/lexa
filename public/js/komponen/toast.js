// @ts-check
import { h } from "../dom.js";

/** @type {HTMLElement | null} */
let area = null;

/** Elemen wadah toast; aria-live agar pembaca layar mengumumkan pesannya. */
export function buatAreaToast() {
  area = h("div", { class: "toast-area", role: "status", "aria-live": "polite" });
  return area;
}

/**
 * @param {string} pesan
 * @param {{ galat?: boolean, durasi?: number }} [opsi]
 */
export function toast(pesan, opsi = {}) {
  if (!area) return;
  const el = h("div", { class: ["toast", opsi.galat ? "galat-toast" : ""] }, pesan);
  area.appendChild(el);
  setTimeout(() => el.remove(), opsi.durasi ?? (opsi.galat ? 6000 : 3500));
}
