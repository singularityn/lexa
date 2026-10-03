// @ts-check
import { h, isi } from "../dom.js";
import { api } from "../api.js";
import { angka, kodeJenis, queryString, sitasi, urlPeraturan } from "../format.js";
import { ajakanPasang } from "../komponen/ajakanPasang.js";
import { kotakCari } from "../komponen/kotakCari.js";
import { modeTersimpan, pilihMode } from "../komponen/pilihMode.js";

const CONTOH = ["UU 13/2003", "pesangon PHK", "cuti melahirkan", "perlindungan data pribadi", "pajak penghasilan", "hak cipta"];

/** @param {import("../router.js").Konteks} ctx */
export default async function beranda(ctx) {
  ctx.setJudul("Lexa", "Cari dan baca peraturan perundang-undangan Indonesia dengan pencarian sitasi, kata kunci, dan makna, serta tanya jawab yang selalu menyebut pasal sumbernya.");

  let mode = modeTersimpan();
  /** @param {string} q */
  const cari = (q) => ctx.pergi(`/cari${queryString({ q, mode: mode === "hybrid" ? null : mode })}`);
  const kotak = kotakCari({ ukuran: "besar", saatKirim: cari });

  const statistik = h("section", { class: "statistik", "aria-label": "Ringkasan indeks" });
  const bidang = h("section", { class: "bagian sembunyi", "aria-labelledby": "h-bidang" });
  const terbaru = h("section", { class: "bagian sembunyi", "aria-labelledby": "h-terbaru" });

  isi(
    ctx.akar,
    h(
      "section",
      { class: "hero" },
      h("h1", null, "Temukan pasal yang Anda cari"),
      h("p", { class: "lead" }, "Peraturan perundang-undangan Indonesia, dari undang-undang sampai peraturan menteri, dengan sumber yang selalu bisa ditelusuri."),
      kotak,
      h("div", { class: "pilihan" }, pilihMode(mode, (m) => (mode = m), "mode-beranda")),
      h(
        "div",
        { class: "contoh" },
        h("span", { class: "redup" }, "Coba:"),
        CONTOH.map((c) => h("a", { class: "chip", href: `/cari${queryString({ q: c })}` }, c)),
      ),
    ),
    ajakanPasang(),
    statistik,
    bidang,
    terbaru,
  );

  const [stat, bid] = await Promise.allSettled([api.statistik(), api.bidang()]);
  if (ctx.sinyal.aborted) return;

  if (stat.status === "fulfilled") {
    const s = stat.value;
    isi(
      statistik,
      h("div", { class: "kartu" }, h("span", { class: "angka" }, angka(s.total_peraturan)), h("span", { class: "label" }, "peraturan")),
      h("div", { class: "kartu" }, h("span", { class: "angka" }, angka(s.total_pasal)), h("span", { class: "label" }, "pasal dan ayat")),
      h("div", { class: "kartu" }, h("span", { class: "angka" }, angka(s.terindeks_vektor)), h("span", { class: "label" }, "terindeks untuk pencarian makna")),
      h(
        "div",
        { class: "kartu" },
        h("span", { class: "angka" }, String(s.per_jenis.length)),
        h("span", { class: "label" }, s.per_jenis.length ? `jenis: ${s.per_jenis.slice(0, 4).map((j) => kodeJenis(j.jenis)).join(", ")}${s.per_jenis.length > 4 ? "…" : ""}` : "jenis peraturan"),
      ),
    );

    if (s.terbaru.length) {
      terbaru.classList.remove("sembunyi");
      isi(
        terbaru,
        h("h2", { id: "h-terbaru" }, "Baru ditambahkan", h("a", { href: "/telusuri" }, "Lihat semua")),
        h(
          "ul",
          { class: "daftar-ringkas" },
          s.terbaru.slice(0, 6).map((l) =>
            h("li", null, h("a", { href: urlPeraturan(l.frbr_uri) }, h("span", { class: "sitasi" }, sitasi(l)), h("span", { class: "judul" }, l.judul))),
          ),
        ),
      );
    }
    if (s.total_peraturan === 0) {
      isi(statistik, h("div", { class: "kartu kosong", style: { gridColumn: "1 / -1" } }, h("h2", null, "Indeks masih kosong"), h("p", null, "Belum ada peraturan yang diindeks. Data masuk lewat sinkronisasi terjadwal dan impor dari BPK.")));
    }
  } else {
    statistik.classList.add("sembunyi");
  }

  if (bid.status === "fulfilled" && bid.value.bidang.length) {
    bidang.classList.remove("sembunyi");
    isi(
      bidang,
      h("h2", { id: "h-bidang" }, "Telusuri menurut bidang"),
      h(
        "div",
        { class: "kisi-bidang" },
        bid.value.bidang.slice(0, 18).map((b) =>
          h("a", { class: "chip", href: `/telusuri${queryString({ bidang: b.nama })}` }, b.nama.toLowerCase().replace(/(^|\s|-)\p{L}/gu, (m) => m.toUpperCase()), h("span", { class: "jumlah" }, angka(b.jumlah))),
        ),
      ),
    );
  }
}

