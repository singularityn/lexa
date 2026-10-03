// @ts-check
import { h, s } from "../dom.js";
import { labelRelasi, labelStatus, sisiUnik, tataLetakGraf, urlPeraturan } from "../format.js";
import { pergi } from "../navigasi.js";

const MAKS_SIMPUL = 41;

/**
 * Titik potong garis pusat-ke-pusat dengan tepi persegi panjang sebuah simpul.
 * @param {{ x: number, y: number }} dari
 * @param {{ x: number, y: number }} ke
 * @param {number} lebar
 * @param {number} tinggi
 */
function tepi(dari, ke, lebar, tinggi) {
  const dx = ke.x - dari.x;
  const dy = ke.y - dari.y;
  if (dx === 0 && dy === 0) return dari;
  const t = Math.min(dx !== 0 ? lebar / 2 / Math.abs(dx) : Infinity, dy !== 0 ? tinggi / 2 / Math.abs(dy) : Infinity);
  return { x: dari.x + dx * t, y: dari.y + dy * t };
}

/**
 * Peta relasi antarperaturan sebagai SVG.
 * @param {import("../api.js").Graf} graf
 */
export function buatGrafik(graf) {
  const urut = [...graf.simpul].sort((a, b) => a.jarak - b.jarak || (b.tahun ?? 0) - (a.tahun ?? 0));
  const tampil = urut.slice(0, MAKS_SIMPUL);
  const dipakai = new Set(tampil.map((n) => n.uri));
  const sisi = sisiUnik(graf.sisi).filter((e) => dipakai.has(e.dari) && dipakai.has(e.ke));
  const tata = tataLetakGraf(tampil, sisi, graf.pusat);

  const svg = s("svg", {
    class: "grafik",
    viewBox: `0 0 ${Math.round(tata.lebar)} ${Math.round(tata.tinggi)}`,
    width: Math.round(tata.lebar),
    height: Math.round(tata.tinggi),
    role: "group",
    "aria-label": `Peta relasi: ${tampil.length} peraturan dan ${sisi.length} hubungan`,
  });
  svg.appendChild(
    s("defs", null, s("marker", { id: "panah", viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" }, s("path", { d: "M0 0 10 5 0 10z", fill: "var(--garis-kuat)" }))),
  );

  for (const e of sisi) {
    const a = tata.posisi.get(e.dari);
    const b = tata.posisi.get(e.ke);
    if (!a || !b) continue;
    const p1 = tepi(a, b, tata.lebarSimpul, tata.tinggiSimpul);
    const p2 = tepi(b, a, tata.lebarSimpul, tata.tinggiSimpul);
    svg.appendChild(s("line", { class: "sisi", x1: p1.x.toFixed(1), y1: p1.y.toFixed(1), x2: p2.x.toFixed(1), y2: p2.y.toFixed(1), "marker-end": "url(#panah)" }));
    svg.appendChild(s("text", { class: "sisi-label", x: ((p1.x + p2.x) / 2).toFixed(1), y: ((p1.y + p2.y) / 2 - 4).toFixed(1) }, labelRelasi(e.jenis)));
  }

  for (const n of tampil) {
    const p = tata.posisi.get(n.uri);
    if (!p) continue;
    const pusat = n.uri === graf.pusat;
    const luar = !n.ada_di_indeks;
    const href = urlPeraturan(n.uri);
    const kelas = ["simpul", pusat ? "pusat" : "", luar ? "luar" : ""].filter(Boolean).join(" ");
    const label = n.label.length > 16 ? `${n.label.slice(0, 15)}…` : n.label;
    const isi = s(
      "g",
      { class: kelas, transform: `translate(${(p.x - tata.lebarSimpul / 2).toFixed(1)} ${(p.y - tata.tinggiSimpul / 2).toFixed(1)})` },
      s("title", null, `${n.label}${n.status ? ` · ${labelStatus(n.status)}` : ""}${luar ? " · belum ada di indeks Lexa" : ""}`),
      s("rect", { width: tata.lebarSimpul, height: tata.tinggiSimpul }),
      s("text", { x: tata.lebarSimpul / 2, y: tata.tinggiSimpul / 2 }, label),
      n.status ? s("circle", { class: `status-titik ${n.status}`, cx: tata.lebarSimpul - 6, cy: 6, r: 5 }) : null,
    );
    if (pusat || luar) {
      svg.appendChild(isi);
    } else {
      svg.appendChild(
        s(
          "a",
          {
            href,
            "aria-label": `${n.label}${n.status ? `, ${labelStatus(n.status)}` : ""}`,
            onclick: (/** @type {MouseEvent} */ e) => {
              if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              pergi(href);
            },
          },
          isi,
        ),
      );
    }
  }

  const terpotong = graf.simpul.length - tampil.length;
  return h(
    "div",
    { class: "grafik-bungkus" },
    svg,
    h(
      "div",
      { class: "legenda" },
      h("span", null, "Tanda panah: dari peraturan yang mengatur ke yang diatur. Klik peraturan untuk membukanya."),
      terpotong > 0 ? h("span", null, `${terpotong} peraturan lain tidak digambar.`) : null,
    ),
  );
}
