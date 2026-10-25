// @ts-check
import { h, isi } from "../dom.js";
import { api, dibatalkan } from "../api.js";
import { angka, daftarCakupan, kodeJenis } from "../format.js";
import { kerangka, kotakGalat } from "../komponen/umum.js";

const NAMA_PEKERJAAN = /** @type {Record<string, string>} */ ({
  impor_bpk: "Impor metadata BPK",
  impor_bpk_tautan: "Penautan daftar BPK",
  ekstrak_pdf: "Ekstraksi PDF",
  ringkas: "Ringkasan AI",
  asisten: "Tanya Lexa",
  hapus_objek: "Pembersihan data lama",
  pemeliharaan: "Pemeliharaan harian",
  // Pekerjaan sumber lama (sudah tidak berjalan); catatannya baru hilang setelah masa simpan log habis.
  jadwal_sinkronisasi: "Sinkronisasi lama",
  antrean_ingest: "Antrean ingest lama",
  perbaiki_celah: "Perbaikan pasal bercelah (lama)",
  isi_peraturan: "Pengambilan isi (sumber lama)",
  akses_isi: "Akses sumber lama",
  pasal_laju: "Batas laju sumber lama",
});

/** Urutan jenis di tabel kelengkapan: dari yang paling dicari. */
const URUTAN_JENIS = ["UUD", "TAP_MPR", "UU", "PERPPU", "PP"];

/** Waktu ISO (UTC) dalam zona waktu pembaca. @param {string | null | undefined} iso */
function waktuIso(iso) {
  if (!iso) return "belum pernah";
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? iso : t.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Meter kemajuan dengan keterangan teksnya.
 * @param {string} judul
 * @param {number} nilai
 * @param {number} total
 * @param {string} label
 */
function meterKemajuan(judul, nilai, total, label) {
  const persen = total ? Math.round((nilai / total) * 100) : 0;
  return [
    h("p", { class: "kelengkapan-ringkas" }, h("strong", null, `${angka(nilai)} dari ${angka(total)}`), ` ${judul}`),
    h(
      "div",
      { class: "meter", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(persen), "aria-label": label },
      h("span", { style: { width: `${persen}%` } }),
    ),
  ];
}

/**
 * Kelengkapan data: sumber teks Lexa adalah PDF resmi BPK, jadi yang diukur adalah kemajuan panennya per jenis, yaitu
 * peraturan yang sudah bertaut ke BPK, sudah punya PDF, sudah punya teks pasal, dan yang masih menunggu.
 * @param {import("../api.js").KemajuanIsi} isi
 * @param {string[]} cakupan
 */
function panelKelengkapan(isi, cakupan) {
  const jenis = [...URUTAN_JENIS.filter((j) => cakupan.includes(j)), ...cakupan.filter((j) => !URUTAN_JENIS.includes(j))];
  /** @type {import("../api.js").IsiJenis} */
  const kosong = { total: 0, pasal: 0, berisi: 0, bertaut_bpk: 0, ber_pdf: 0, perlu_pdf: 0, pdf_belum_terurai: 0, teks_bpk: 0, teks_lama: 0 };
  const baris = jenis.map((j) => ({ jenis: j, ...(isi.per_jenis[j] ?? kosong) }));
  const jumlah = (/** @type {keyof import("../api.js").IsiJenis} */ k) => baris.reduce((n, b) => n + b[k], 0);
  const total = jumlah("total");
  const berisi = jumlah("berisi");
  const berPdf = jumlah("ber_pdf");
  const teksLama = jumlah("teks_lama");
  const perluPdf = jumlah("perlu_pdf");
  const belumTerurai = jumlah("pdf_belum_terurai");

  const kolom = ["Jenis", "Peraturan", "Berisi pasal", "PDF BPK", "Bertaut BPK", "Menunggu PDF", "PDF belum terurai"];
  return h(
    "section",
    { class: "bagian", "aria-labelledby": "judul-kelengkapan" },
    h("h2", { id: "judul-kelengkapan" }, "Kelengkapan data"),
    h(
      "div",
      { class: "kartu" },
      ...meterKemajuan("peraturan sudah punya teks pasal", berisi, total, "Peraturan yang sudah punya teks pasal"),
      ...meterKemajuan("peraturan sudah punya PDF resmi dari BPK", berPdf, total, "Peraturan yang sudah punya PDF dari BPK"),
      h(
        "details",
        { class: "rincian-status" },
        h("summary", null, "Rincian per jenis"),
      h(
        "div",
        { class: "tabel-gulir", tabindex: "0", role: "region", "aria-label": "Kelengkapan data per jenis, dapat digulir" },
        h(
          "table",
          { class: "tabel" },
          h("thead", null, h("tr", null, kolom.map((k, i) => h("th", { class: i ? "angka-tabel" : "" }, k)))),
          h(
            "tbody",
            null,
            baris.map((b) =>
              h(
                "tr",
                null,
                h("td", null, kodeJenis(b.jenis)),
                h("td", { class: "angka-tabel" }, angka(b.total)),
                h("td", { class: "angka-tabel" }, angka(b.berisi)),
                h("td", { class: "angka-tabel" }, angka(b.ber_pdf)),
                h("td", { class: "angka-tabel" }, angka(b.bertaut_bpk)),
                h("td", { class: "angka-tabel" }, angka(b.perlu_pdf)),
                h("td", { class: "angka-tabel" }, angka(b.pdf_belum_terurai)),
              ),
            ),
          ),
        ),
      ),
      h(
        "p",
        { class: "redup kelengkapan-catatan" },
        "Teks peraturan hanya bersumber dari naskah resmi di peraturan.bpk.go.id. \"Menunggu PDF\" belum punya PDF maupun teks pasal; \"PDF belum terurai\" sudah punya PDF tetapi pasalnya belum terbaca (biasanya pindaian).",
      ),
      teksLama
        ? h(
            "p",
            { class: "redup kelengkapan-catatan" },
            `${angka(teksLama)} peraturan masih memakai teks lama yang tersimpan sebelum panen BPK; teksnya digantikan naskah BPK begitu PDF-nya dipanen dan terbaca utuh.`,
          )
        : null,
      isi.tanpa_berkas
        ? h("p", { class: "redup kelengkapan-catatan" }, `${angka(isi.tanpa_berkas)} peraturan ditandai tidak memiliki berkas PDF di BPK (hanya metadata), jadi tidak diminta lagi.`)
        : null,
      perluPdf + belumTerurai === 0 && total > 0 ? h("p", { class: "redup kelengkapan-catatan" }, "Semua peraturan dalam cakupan sudah punya teks atau PDF.") : null,
      h("p", { class: "redup kelengkapan-catatan" }, `Pemeliharaan harian terakhir berjalan ${waktuIso(isi.pemeliharaan_terakhir)}.`),
      ),
    ),
  );
}

/** Waktu D1 ("2026-10-03 08:38:22", UTC) dalam zona waktu pembaca. @param {string} d */
function waktuLokal(d) {
  const t = new Date(`${d.replace(" ", "T")}Z`);
  return Number.isNaN(t.getTime()) ? d : t.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

/** @param {import("../router.js").Konteks} ctx */
export default async function status(ctx) {
  ctx.setJudul("Status data", "Jumlah peraturan terindeks dan riwayat sinkronisasi data Lexa.");
  isi(ctx.akar, h("h1", null, "Status data"), h("div", { class: "kartu" }, kerangka(4)));

  try {
    const s = await api.statistik();
    if (ctx.sinyal.aborted) return;
    const cakupan = s.total_peraturan ? Math.round((s.terindeks_vektor / s.total_peraturan) * 100) : 0;

    isi(
      ctx.akar,
      h("h1", null, "Status data"),
      h("p", { class: "redup" }, s.cakupan?.length ? `Cakupan saat ini: ${daftarCakupan(s.cakupan)}. Jenis lain tidak dimuat.` : "Seberapa lengkap indeks Lexa saat ini."),
      h(
        "section",
        { class: "statistik", "aria-label": "Ringkasan" },
        h("div", { class: "kartu" }, h("span", { class: "angka" }, angka(s.total_peraturan)), h("span", { class: "label" }, "peraturan")),
        h("div", { class: "kartu" }, h("span", { class: "angka" }, angka(s.total_pasal)), h("span", { class: "label" }, "pasal dan ayat")),
        h("div", { class: "kartu" }, h("span", { class: "angka" }, `${cakupan}%`), h("span", { class: "label" }, `terindeks untuk pencarian makna (${angka(s.terindeks_vektor)})`)),
      ),
      s.isi ? panelKelengkapan(s.isi, s.cakupan ?? []) : null,
      h(
        "details",
        { class: "rincian-status riwayat-status" },
        h("summary", null, "Riwayat pekerjaan data"),
        s.sinkronisasi_terakhir.length
          ? h(
              "div",
              { class: "tabel-gulir", tabindex: "0", role: "region", "aria-label": "Riwayat pekerjaan data, dapat digulir" },
              h(
                "table",
                { class: "tabel" },
                h("thead", null, h("tr", null, ["Waktu", "Pekerjaan", "Status", "Jumlah", "Keterangan"].map((k) => h("th", null, k)))),
                h(
                  "tbody",
                  null,
                  s.sinkronisasi_terakhir.map((r) =>
                    h(
                      "tr",
                      null,
                      h("td", null, waktuLokal(r.created_at)),
                      h("td", null, NAMA_PEKERJAAN[r.job] ?? r.job),
                      h("td", null, h("span", { class: ["lencana", r.status === "sukses" ? "lencana-berlaku" : r.status === "gagal" ? "lencana-dicabut" : ""].filter(Boolean).join(" ") }, r.status)),
                      h("td", null, angka(r.jumlah)),
                      h("td", { class: "redup" }, r.detail ?? ""),
                    ),
                  ),
                ),
              ),
            )
          : h("p", { class: "redup" }, "Belum ada pekerjaan yang tercatat."),
      ),
    );
  } catch (e) {
    if (dibatalkan(e)) return;
    isi(ctx.akar, h("h1", null, "Status data"), kotakGalat(e, () => status(ctx)));
  }
}
