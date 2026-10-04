// @ts-check
import { h, isi } from "../dom.js";
import { api, dibatalkan } from "../api.js";
import { angka, bacaFilter, daftarCakupan, kodeJenis, queryString } from "../format.js";
import { kotakCari } from "../komponen/kotakCari.js";
import { modeTersimpan } from "../komponen/pilihMode.js";
import { buatPanelFilter } from "../komponen/panelFilter.js";
import { kartuHasil } from "../komponen/kartuHasil.js";
import { catatanHasil, keadaanKosong, kerangkaHasil, kotakGalat } from "../komponen/umum.js";
import { riwayat } from "../riwayat.js";

const BATAS_AWAL = 20;
const BATAS_MAKS = 50;

/** @param {import("../router.js").Konteks} ctx */
export default async function cari(ctx) {
  const dariUrl = bacaFilter(ctx.params);
  const mode = ctx.params.has("mode") ? dariUrl.mode : modeTersimpan();
  const filter = {
    jenis: dariUrl.jenis,
    status: dariUrl.status,
    tahun_min: dariUrl.tahun_min,
    tahun_max: dariUrl.tahun_max,
    bidang: dariUrl.bidang,
  };
  const keadaan = { q: dariUrl.q, mode, limit: BATAS_AWAL };

  /** @type {AbortController | null} */
  let berjalan = null;
  let nomor = 0;
  ctx.saatKeluar(() => berjalan?.abort());

  const panel = buatPanelFilter({
    filter,
    saatUbah: () => jalankan(),
    mode: {
      ambil: () => keadaan.mode,
      ubah: (m) => {
        keadaan.mode = m;
        jalankan();
      },
    },
  });
  // Di ponsel tombol filter berdampingan dengan kotak cari, hanya ikon (labelnya tetap terbaca pembaca layar).
  panel.tombol.classList.add("filter-ikon");
  const kotak = kotakCari({
    nilai: keadaan.q,
    saatKirim: (q) => {
      keadaan.q = q;
      keadaan.limit = BATAS_AWAL;
      jalankan();
    },
  });
  const hasil = h("div", { "aria-live": "polite" });
  const ringkas = h("div", { class: "bilah-hasil" });

  isi(
    ctx.akar,
    h("h1", { class: "sr-only" }, "Hasil pencarian"),
    h(
      "div",
      { class: "dua-kolom" },
      panel.el,
      h("section", { class: "area-atas baris-cari", "aria-label": "Pencarian" }, kotak, panel.tombol),
      h("section", { class: "area-hasil", "aria-label": "Hasil" }, panel.chipAktif, ringkas, hasil),
    ),
  );

  // Facet untuk panel filter diambil sekali: jumlah di sini adalah jumlah di seluruh indeks.
  api.telusur({ per_page: 1 }, ctx.sinyal).then((r) => !ctx.sinyal.aborted && panel.perbaruiFacet(r.facets)).catch(() => {});
  api.bidang().then((b) => !ctx.sinyal.aborted && panel.isiBidang(b.bidang)).catch(() => {});
  panel.perbaruiFacet({});

  function urlSaatIni() {
    return `/cari${queryString({
      q: keadaan.q,
      mode: keadaan.mode === "hybrid" ? null : keadaan.mode,
      jenis: filter.jenis,
      status: filter.status,
      tahun_min: filter.tahun_min,
      tahun_max: filter.tahun_max,
      bidang: filter.bidang,
    })}`;
  }

  async function jalankan() {
    const giliran = ++nomor;
    berjalan?.abort();
    berjalan = new AbortController();
    ctx.sinyal.addEventListener("abort", () => berjalan?.abort(), { once: true });
    ctx.perbaruiUrl(urlSaatIni());

    if (!keadaan.q) {
      ctx.setJudul("Cari peraturan");
      isi(ringkas);
      isi(hasil, keadaanKosong("Apa yang ingin Anda cari?", h("p", null, "Ketik kata kunci, nomor peraturan (mis. ", h("code", null, "UU 13/2003"), "), atau pertanyaan dengan bahasa sehari-hari.")));
      return;
    }
    ctx.setJudul(`Cari: ${keadaan.q}`);
    isi(ringkas);
    isi(hasil, kerangkaHasil());

    try {
      const r = await api.cari({ q: keadaan.q, mode: keadaan.mode, limit: keadaan.limit, ...filter }, berjalan.signal);
      if (giliran !== nomor) return;

      isi(
        ringkas,
        h("span", { class: "ringkas-hasil", role: "status" }, r.hits.length ? `${angka(r.hits.length)} hasil teratas untuk “${r.query}”` : `Tidak ada hasil untuk “${r.query}”`),
      );
      panel.setTombolSelesai(r.hits.length ? `Tampilkan ${angka(r.hits.length)} hasil` : "Tutup");

      if (!r.hits.length) {
        isi(hasil, r.di_luar_cakupan ? catatanLuarCakupan(r.di_luar_cakupan, false) : null, kosong(r));
        return;
      }
      riwayat.catatPencarian(r.query);
      const lebih = r.hits.length >= keadaan.limit && keadaan.limit < BATAS_MAKS;
      isi(
        hasil,
        r.di_luar_cakupan ? catatanLuarCakupan(r.di_luar_cakupan, true) : null,
        r.longgar ? catatanLonggar(r.longgar.penuh) : null,
        h("ul", { class: "daftar-hasil" }, r.hits.map((hit) => kartuHasil(hit, { q: r.query }))),
        lebih
          ? h("div", { class: "tengah", style: { marginTop: "18px" } }, h("button", {
              type: "button",
              class: "tombol",
              onclick: () => {
                keadaan.limit = BATAS_MAKS;
                jalankan();
              },
            }, "Tampilkan lebih banyak"))
          : null,
        r.expanded_terms.length
          ? h(
              "details",
              { class: "istilah", style: { marginTop: "18px" } },
              h("summary", null, "Istilah yang dipakai Lexa untuk mencari"),
              h("p", { class: "bantu" }, "Kata Anda dilucuti imbuhannya dan diperluas dengan sinonim hukum agar tidak terlewat."),
              r.expanded_terms.map((t) => h("code", null, t)),
            )
          : null,
      );
    } catch (e) {
      if (dibatalkan(e) || giliran !== nomor) return;
      isi(ringkas);
      isi(hasil, kotakGalat(e, jalankan));
    }
  }

  /**
   * Hasil memuat cadangan longgar: pencarian ketat menemukan terlalu sedikit. Dinyatakan terus terang,
   * supaya pembaca tahu hasil di bawahnya hanya memuat sebagian kata.
   * @param {number} penuh jumlah hasil yang memuat semua kata
   */
  function catatanLonggar(penuh) {
    return catatanHasil(
      penuh === 0
        ? "Tidak ada pasal yang memuat semua kata Anda. Yang tampil memuat sebagian kata; periksa sebelum dipakai."
        : `Hanya ${angka(penuh)} hasil yang memuat semua kata Anda. Sisanya memuat sebagian kata.`,
    );
  }

  /**
   * Kueri berbentuk sitasi ke jenis yang tidak dimuat Lexa ("Perpres 12/2020"): dinyatakan terus terang,
   * supaya pembaca tidak mengira peraturannya ada tetapi tak ketemu.
   * @param {{ jenis: string, cakupan: string[] }} luar
   * @param {boolean} adaHasil hasil di bawahnya berasal dari kata-kata kueri, bukan dari sitasinya
   */
  function catatanLuarCakupan(luar, adaHasil) {
    return catatanHasil(
      `Lexa belum memuat peraturan jenis ${kodeJenis(luar.jenis)}; untuk saat ini cakupannya ${daftarCakupan(luar.cakupan)}. `,
      adaHasil ? "Yang tampil di bawah adalah peraturan dalam cakupan yang memuat kata-kata Anda. " : "",
      "Naskah resminya dapat dicari di ",
      h("a", { href: "https://peraturan.bpk.go.id", target: "_blank", rel: "noopener noreferrer" }, "peraturan.bpk.go.id"),
      ".",
    );
  }

  /** @param {import("../../../src/shared/types").SearchResponse} r */
  function kosong(r) {
    const adaFilter = panel.jumlahAktif() > 0;
    return keadaanKosong(
      "Tidak ada hasil",
      h("p", null, adaFilter ? "Coba longgarkan filter di samping, atau gunakan istilah yang lebih umum." : "Coba periksa ejaan, gunakan istilah yang lebih umum, atau ganti ke mode lain."),
      h(
        "div",
        { class: "contoh", style: { marginTop: "12px" } },
        r.mode !== "semantic" ? h("button", { type: "button", class: "chip", onclick: () => ubahMode("semantic") }, "Coba mode Makna") : null,
        r.mode !== "hybrid" ? h("button", { type: "button", class: "chip", onclick: () => ubahMode("hybrid") }, "Coba mode Otomatis") : null,
        h("a", { class: "chip", href: "/telusuri" }, "Telusuri semua peraturan"),
        h("a", { class: "chip", href: `/tanya${queryString({ q: keadaan.q })}` }, "Tanyakan ke Lexa"),
      ),
    );
  }

  /** @param {string} m */
  function ubahMode(m) {
    keadaan.mode = m;
    const radio = /** @type {HTMLInputElement | null} */ (ctx.akar.querySelector(`input[name="mode-cari"][value="${m}"]`));
    if (radio) radio.checked = true;
    jalankan();
  }

  await jalankan();
}
