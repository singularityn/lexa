// @ts-check
import { h, tunda } from "../dom.js";
import { api, dibatalkan } from "../api.js";
import { pergi } from "../navigasi.js";
import { urlPeraturan } from "../format.js";
import { ikon } from "./ikon.js";

let cacahId = 0;

/**
 * Kotak pencarian dengan saran ketik (pola ARIA combobox).
 *
 * @param {{
 *   nilai?: string,
 *   ukuran?: "besar" | "ringkas" | "",
 *   placeholder?: string,
 *   label?: string,
 *   saatKirim: (q: string) => void,
 *   tombol?: boolean,
 * }} opsi
 * @returns {HTMLElement & { fokus: () => void, setNilai: (q: string) => void }}
 */
export function kotakCari(opsi) {
  const id = `saran-${++cacahId}`;
  const input = /** @type {HTMLInputElement} */ (
    h("input", {
      class: "input",
      type: "search",
      name: "q",
      value: opsi.nilai ?? "",
      placeholder: opsi.placeholder ?? "Cari peraturan, pasal, atau sitasi",
      autocomplete: "off",
      autocapitalize: "off",
      spellcheck: "false",
      maxlength: "300",
      role: "combobox",
      "aria-label": opsi.label ?? "Cari peraturan",
      "aria-autocomplete": "list",
      "aria-expanded": "false",
      "aria-controls": id,
    })
  );
  const daftar = h("ul", { class: "saran sembunyi", id, role: "listbox", "aria-label": "Saran pencarian" });
  /** @type {import("../api.js").Saran[]} */
  let saran = [];
  let terpilih = -1;
  /** @type {AbortController | null} */
  let pengendali = null;

  function tutup() {
    daftar.classList.add("sembunyi");
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    terpilih = -1;
  }

  function sorot(/** @type {number} */ i) {
    terpilih = i;
    [...daftar.children].forEach((li, n) => li.setAttribute("aria-selected", String(n === i)));
    if (i >= 0) input.setAttribute("aria-activedescendant", `${id}-${i}`);
    else input.removeAttribute("aria-activedescendant");
  }

  function gambar() {
    daftar.replaceChildren(
      ...saran.map((sa, i) =>
        h(
          "li",
          {
            id: `${id}-${i}`,
            role: "option",
            "aria-selected": "false",
            // mousedown (bukan click) agar terjadi sebelum input kehilangan fokus.
            onmousedown: (/** @type {MouseEvent} */ e) => {
              e.preventDefault();
              pilih(i);
            },
          },
          h("span", { class: "tipe" }, sa.tipe === "peraturan" ? "Peraturan" : "Pencarian"),
          h("span", null, sa.teks),
        ),
      ),
    );
    const ada = saran.length > 0;
    daftar.classList.toggle("sembunyi", !ada);
    input.setAttribute("aria-expanded", String(ada));
    terpilih = -1;
  }

  /** @param {number} i */
  function pilih(i) {
    const sa = saran[i];
    if (!sa) return;
    tutup();
    if (sa.tipe === "peraturan" && sa.uri) {
      pergi(urlPeraturan(sa.uri));
    } else {
      input.value = sa.teks;
      opsi.saatKirim(sa.teks);
    }
  }

  const ambilSaran = tunda(async () => {
    const q = input.value.trim();
    if (q.length < 2) {
      saran = [];
      gambar();
      return;
    }
    pengendali?.abort();
    pengendali = new AbortController();
    try {
      saran = (await api.saran(q, pengendali.signal)).suggestions;
      if (document.activeElement === input) gambar();
    } catch (e) {
      if (!dibatalkan(e)) saran = [];
    }
  }, 180);

  input.addEventListener("input", ambilSaran);
  input.addEventListener("blur", () => setTimeout(tutup, 120));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && saran.length) {
      e.preventDefault();
      daftar.classList.remove("sembunyi");
      sorot((terpilih + 1) % saran.length);
    } else if (e.key === "ArrowUp" && saran.length) {
      e.preventDefault();
      sorot((terpilih - 1 + saran.length) % saran.length);
    } else if (e.key === "Enter" && terpilih >= 0) {
      e.preventDefault();
      pilih(terpilih);
    } else if (e.key === "Escape") {
      tutup();
    }
  });

  const form = h(
    "form",
    {
      role: "search",
      onsubmit: (/** @type {SubmitEvent} */ e) => {
        e.preventDefault();
        const q = input.value.trim();
        if (!q) return input.focus();
        tutup();
        opsi.saatKirim(q);
      },
    },
    h("div", { style: { position: "relative", flex: "1" } }, ikon("cari", { kelas: "ikon-cari" }), input),
    opsi.tombol === false ? null : h("button", { type: "submit", class: "tombol tombol-utama" }, "Cari"),
  );

  const akar = /** @type {HTMLElement & { fokus: () => void, setNilai: (q: string) => void }} */ (
    h("div", { class: ["kotak-cari", opsi.ukuran ?? ""].filter(Boolean).join(" ") }, form, daftar)
  );
  akar.fokus = () => input.focus();
  akar.setNilai = (q) => {
    input.value = q;
  };
  return akar;
}
