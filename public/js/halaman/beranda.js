// @ts-check
import { h, isi } from "../dom.js";
import { api } from "../api.js";
import { angka, daftarBidang, judulRingkas, queryString, sitasi, urlPeraturan } from "../format.js";
import { ajakanPasang } from "../komponen/ajakanPasang.js";
import { ikon } from "../komponen/ikon.js";
import { kotakCari } from "../komponen/kotakCari.js";
import { modeTersimpan, pilihMode } from "../komponen/pilihMode.js";
import { riwayat } from "../riwayat.js";

const CONTOH = ["UU 13/2003", "pesangon PHK", "cuti melahirkan", "perlindungan data pribadi", "pajak penghasilan", "hak cipta"];
const MAKS_BIDANG = 10;

/**
 * Baris peraturan ringkas: sitasi dan topiknya.
 * @param {{ frbr_uri: string, jenis: string, nomor: string, tahun: number, judul: string }} p
 */
function barisPeraturan(p) {
  return h(
    "li",
    null,
    h("a", { href: urlPeraturan(p.frbr_uri) }, h("span", { class: "sitasi" }, sitasi(p)), h("span", { class: "judul" }, judulRingkas(p.judul))),
  );
}

/** @param {import("../router.js").Konteks} ctx */
export default async function beranda(ctx) {
  ctx.setJudul("Lexa", "Cari dan baca peraturan perundang-undangan Indonesia dengan pencarian sitasi, kata kunci, dan makna, serta tanya jawab yang selalu menyebut pasal sumbernya.");

  let mode = modeTersimpan();
  /** @param {string} q */
  const cari = (q) => ctx.pergi(`/cari${queryString({ q, mode: mode === "hybrid" ? null : mode })}`);
  const kotak = kotakCari({ ukuran: "besar", saatKirim: cari });

  const terakhirDicari = riwayat.pencarian().slice(0, 6);
  const dilihat = riwayat.dilihat().slice(0, 4);

  const terbaru = h("section", { class: "bagian sembunyi", "aria-labelledby": "h-terbaru" });
  const bidang = h("section", { class: "bagian sembunyi", "aria-labelledby": "h-bidang" });
  const info = h("p", { class: "info-indeks redup" });

  isi(
    ctx.akar,
    h(
      "section",
      { class: "hero" },
      h("h1", null, "Cari peraturan Indonesia"),
      h("p", { class: "lead" }, "Ketik kata kunci, nomor peraturan, atau pertanyaan sehari-hari. Hasilnya selalu bisa ditelusuri ke pasalnya."),
      kotak,
      h("div", { class: "opsi-cari" }, h("span", { class: "redup" }, "Cara mencari"), pilihMode(mode, (m) => (mode = m), "mode-beranda")),
      h(
        "div",
        { class: "contoh gulir-chip" },
        h("span", { class: "redup" }, terakhirDicari.length ? "Terakhir:" : "Coba:"),
        (terakhirDicari.length ? terakhirDicari.map((r) => r.q) : CONTOH).map((c) => h("a", { class: "chip", href: `/cari${queryString({ q: c })}` }, c)),
      ),
    ),
    ajakanPasang(),
    h(
      "a",
      { class: "teaser-tanya", href: "/tanya" },
      h("span", { class: "teaser-ikon", "aria-hidden": "true" }, ikon("tanya")),
      h("span", { class: "teaser-teks" }, h("strong", null, "Punya pertanyaan hukum?"), h("span", null, "Tanya Lexa. Jawabannya hanya dari pasal yang ada di indeks, lengkap dengan sumbernya.")),
      ikon("kirim"),
    ),
    dilihat.length
      ? h(
          "section",
          { class: "bagian", "aria-labelledby": "h-dilihat" },
          h("h2", { id: "h-dilihat" }, "Terakhir dilihat"),
          h("ul", { class: "daftar-ringkas" }, dilihat.map((d) => h("li", null, h("a", { href: urlPeraturan(d.uri) }, h("span", { class: "sitasi" }, d.sitasi), h("span", { class: "judul" }, judulRingkas(d.judul)))))),
        )
      : null,
    terbaru,
    bidang,
    info,
  );

  const [stat, bid] = await Promise.allSettled([api.statistik(), api.bidang()]);
  if (ctx.sinyal.aborted) return;

  if (stat.status === "fulfilled") {
    const s = stat.value;
    if (s.terbaru.length) {
      terbaru.classList.remove("sembunyi");
      isi(
        terbaru,
        h("h2", { id: "h-terbaru" }, "Baru ditambahkan", h("a", { href: "/telusuri" }, "Lihat semua")),
        h("ul", { class: "daftar-ringkas" }, s.terbaru.slice(0, 5).map(barisPeraturan)),
      );
    }
    isi(
      info,
      s.total_peraturan === 0
        ? "Indeks masih kosong: peraturan masuk lewat sinkronisasi terjadwal dan impor dari BPK."
        : `${angka(s.total_peraturan)} peraturan dan ${angka(s.total_pasal)} pasal dan ayat di indeks.`,
    );
  }

  if (bid.status === "fulfilled" && bid.value.bidang.length) {
    bidang.classList.remove("sembunyi");
    isi(
      bidang,
      h("h2", { id: "h-bidang" }, "Telusuri menurut bidang", h("a", { href: "/telusuri" }, "Semua")),
      h(
        "div",
        { class: "kisi-bidang" },
        bid.value.bidang.slice(0, MAKS_BIDANG).map((b) =>
          h("a", { class: "chip", href: `/telusuri${queryString({ bidang: b.nama })}` }, daftarBidang(b.nama)[0] ?? b.nama, h("span", { class: "jumlah" }, angka(b.jumlah))),
        ),
      ),
    );
  }
}
