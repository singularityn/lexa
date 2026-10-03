// @ts-check
/**
 * Pembantu DOM tanpa kerangka kerja.
 *
 * Seluruh teks dinamis masuk sebagai simpul teks, bukan innerHTML, sehingga data
 * dari API tidak pernah dapat menyisipkan markup. Satu-satunya HTML yang
 * dikenali adalah penanda <mark> pada cuplikan pencarian, dan itu pun dibangun
 * ulang menjadi elemen oleh `cuplikan()`, bukan ditempel apa adanya.
 */

const NS_SVG = "http://www.w3.org/2000/svg";

/** @typedef {string | number | boolean | null | undefined | Node | Anak[]} Anak */

/**
 * @param {Element} el
 * @param {Record<string, any> | null | undefined} props
 */
function pasang(el, props) {
  if (!props) return;
  /** @type {unknown} */
  let nilaiAkhir;
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class" || k === "kelas") {
      el.setAttribute("class", Array.isArray(v) ? v.filter(Boolean).join(" ") : String(v));
    } else if (k === "dataset") {
      for (const [dk, dv] of Object.entries(v)) /** @type {HTMLElement} */ (el).dataset[dk] = String(dv);
    } else if (k === "style" && typeof v === "object") {
      // CSSOM diizinkan oleh CSP; atribut style sebaris tidak.
      Object.assign(/** @type {HTMLElement} */ (el).style, v);
    } else if (k.startsWith("on") && typeof v === "function") {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === "value") {
      // Ditunda: pada <select>, nilai hanya bisa dipasang setelah <option> ada.
      nilaiAkhir = v;
    } else if (v === true) {
      el.setAttribute(k, "");
    } else {
      el.setAttribute(k, String(v));
    }
  }
  if (nilaiAkhir !== undefined) /** @type {any} */ (el)._nilaiTertunda = nilaiAkhir;
}

/**
 * @param {Element | DocumentFragment} induk
 * @param {Anak[]} anak
 */
function tambah(induk, anak) {
  for (const a of anak) {
    if (a === null || a === undefined || a === false || a === true) continue;
    if (Array.isArray(a)) tambah(induk, a);
    else if (a instanceof Node) induk.appendChild(a);
    else induk.appendChild(document.createTextNode(String(a)));
  }
  const el = /** @type {any} */ (induk);
  if ("_nilaiTertunda" in el) {
    el.value = el._nilaiTertunda;
    delete el._nilaiTertunda;
  }
}

/**
 * Buat elemen HTML.
 * @param {string} tag
 * @param {Record<string, any> | null} [props]
 * @param {...Anak} anak
 * @returns {HTMLElement}
 */
export function h(tag, props, ...anak) {
  const el = document.createElement(tag);
  pasang(el, props);
  tambah(el, anak);
  return el;
}

/**
 * Buat elemen SVG.
 * @param {string} tag
 * @param {Record<string, any> | null} [props]
 * @param {...Anak} anak
 * @returns {SVGElement}
 */
export function s(tag, props, ...anak) {
  const el = document.createElementNS(NS_SVG, tag);
  pasang(el, props);
  tambah(el, anak);
  return el;
}

/**
 * Ganti seluruh isi sebuah elemen.
 * @param {Element} el
 * @param {...Anak} anak
 */
export function isi(el, ...anak) {
  const frag = document.createDocumentFragment();
  tambah(frag, anak);
  el.replaceChildren(frag);
}

/**
 * Bangun cuplikan pencarian: hanya <mark> dan </mark> yang dikenali, selebihnya
 * dianggap teks biasa.
 * @param {string | null | undefined} teks
 * @returns {DocumentFragment}
 */
export function cuplikan(teks) {
  const frag = document.createDocumentFragment();
  if (!teks) return frag;
  let tanda = false;
  for (const bagian of teks.split(/(<\/?mark>)/)) {
    if (bagian === "<mark>") tanda = true;
    else if (bagian === "</mark>") tanda = false;
    else if (bagian) frag.appendChild(tanda ? h("mark", null, bagian) : document.createTextNode(bagian));
  }
  return frag;
}

/**
 * Tandai kemunculan istilah di dalam sebuah subpohon dengan <mark>.
 * @param {Node} akar
 * @param {string[]} istilah
 * @returns {number} jumlah penanda yang dipasang
 */
export function tandaiIstilah(akar, istilah) {
  const bersih = istilah.map((t) => t.trim()).filter((t) => t.length >= 3);
  if (!bersih.length) return 0;
  const pola = new RegExp(`(${bersih.map(lolosRegex).join("|")})`, "gi");
  const walker = document.createTreeWalker(akar, NodeFilter.SHOW_TEXT);
  /** @type {Text[]} */
  const simpul = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement?.closest("mark, script, style")) continue;
    simpul.push(/** @type {Text} */ (n));
  }
  let jumlah = 0;
  for (const t of simpul) {
    const teks = t.data;
    pola.lastIndex = 0;
    if (!pola.test(teks)) continue;
    pola.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let akhir = 0;
    for (const m of teks.matchAll(pola)) {
      const mulai = m.index ?? 0;
      if (mulai > akhir) frag.appendChild(document.createTextNode(teks.slice(akhir, mulai)));
      frag.appendChild(h("mark", null, m[0]));
      akhir = mulai + m[0].length;
      jumlah++;
    }
    if (akhir < teks.length) frag.appendChild(document.createTextNode(teks.slice(akhir)));
    t.replaceWith(frag);
  }
  return jumlah;
}

/** Lepaskan semua penanda <mark> di bawah sebuah elemen. @param {Element} akar */
export function hapusTanda(akar) {
  for (const m of akar.querySelectorAll("mark")) m.replaceWith(document.createTextNode(m.textContent ?? ""));
  akar.normalize();
}

/** @param {string} t */
export function lolosRegex(t) {
  return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @template {(...args: any[]) => void} F
 * @param {F} fn
 * @param {number} ms
 * @returns {F}
 */
export function tunda(fn, ms) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let t;
  return /** @type {F} */ (
    (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    }
  );
}

/**
 * Salin teks ke papan klip, dengan cadangan untuk konteks tanpa Clipboard API.
 * @param {string} teks
 * @returns {Promise<boolean>}
 */
export async function salin(teks) {
  try {
    await navigator.clipboard.writeText(teks);
    return true;
  } catch {
    const area = h("textarea", { "aria-hidden": "true", tabindex: "-1" });
    /** @type {HTMLTextAreaElement} */ (area).value = teks;
    Object.assign(area.style, { position: "fixed", opacity: "0", top: "0" });
    document.body.appendChild(area);
    /** @type {HTMLTextAreaElement} */ (area).select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

/**
 * Unduh teks sebagai berkas.
 * @param {string} nama
 * @param {string} isiBerkas
 * @param {string} [tipe]
 */
export function unduh(nama, isiBerkas, tipe = "application/json") {
  const url = URL.createObjectURL(new Blob([isiBerkas], { type: `${tipe};charset=utf-8` }));
  const a = h("a", { href: url, download: nama });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Render jawaban model (Markdown ringan: paragraf, daftar, **tebal**) secara aman.
 * @param {import("./format.js").BlokTeks[]} blok
 * @returns {DocumentFragment}
 */
export function renderBlokTeks(blok) {
  const frag = document.createDocumentFragment();
  /** @param {import("./format.js").Sebaris[]} bagian */
  const sebaris = (bagian) => bagian.map((b) => (b.tebal ? h("strong", null, b.teks) : b.teks));
  for (const b of blok) {
    if (b.tipe === "p") frag.appendChild(h("p", null, sebaris(b.isi)));
    else frag.appendChild(h(b.tipe, null, b.butir.map((it) => h("li", null, sebaris(it)))));
  }
  return frag;
}
