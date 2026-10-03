// @ts-check
import { h } from "../dom.js";
import { ikon } from "./ikon.js";

/**
 * Pita tipis di bawah header saat peramban melaporkan tidak ada jaringan. Tidak menghalangi apa pun:
 * peraturan yang pernah dibuka tetap bisa dibaca (public/sw.js).
 */
export function bangunPitaLuring() {
  const pita = h(
    "div",
    { class: "pita-luring", role: "status", hidden: true },
    ikon("luring"),
    h("span", null, "Anda sedang luring. Peraturan yang pernah dibuka tetap bisa dibaca."),
  );
  const perbarui = () => {
    pita.hidden = navigator.onLine;
  };
  addEventListener("online", perbarui);
  addEventListener("offline", perbarui);
  perbarui();
  return pita;
}
