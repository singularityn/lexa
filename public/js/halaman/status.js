// @ts-check
import { h, isi } from "../dom.js";
import { api, dibatalkan } from "../api.js";
import { angka, daftarCakupan, judulRingkas, kodeJenis, labelJenis, sitasi, urlPeraturan } from "../format.js";
import { kerangka, kotakGalat, peringatan } from "../komponen/umum.js";

const NAMA_PEKERJAAN = /** @type {Record<string, string>} */ ({
  jadwal_sinkronisasi: "Sinkronisasi terjadwal",
  antrean_ingest: "Antrean ingest",
  impor_bpk: "Impor dari BPK",
  ekstrak_pdf: "Ekstraksi PDF",
  ringkas: "Ringkasan AI",
  perbaiki_celah: "Perbaikan pasal bercelah",
  asisten: "Tanya Lexa",
  isi_peraturan: "Pengambilan isi peraturan",
  akses_isi: "Akses isi pasal.id",
  pasal_laju: "Batas laju pasal.id",
  hapus_objek: "Pembersihan data lama",
  pemeliharaan: "Pemeliharaan harian",
});

/** Urutan jenis di tabel kelengkapan: sama dengan urutan pengambilan isi. */
const URUTAN_JENIS = ["UUD", "TAP_MPR", "UU", "PERPPU", "PP"];

/** Waktu ISO (UTC) dalam zona waktu pembaca. @param {string | null | undefined} iso */
function waktuIso(iso) {
  if (!iso) return "belum pernah";
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? iso : t.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Kelengkapan isi: berapa peraturan yang sudah punya pasal, menunggu giliran, atau tanpa isi di sumber, per jenis, dan
 * kendala yang sedang menghambat (pasal.id tidak memberi naskah, atau meminta jeda).
 * @param {import("../api.js").KemajuanIsi} isi
 * @param {string[]} cakupan
 */
function panelKelengkapan(isi, cakupan) {
  const jenis = [...URUTAN_JENIS.filter((j) => cakupan.includes(j)), ...cakupan.filter((j) => !URUTAN_JENIS.includes(j))];
  const baris = jenis.map((j) => ({
    jenis: j,
    sumber: isi.katalog[j]?.total_sumber ?? null,
    dukungan: isi.katalog[j]?.dukungan ?? null,
    ...(isi.per_jenis[j] ?? { total: 0, pasal: 0, berisi: 0, lengkap: 0, menunggu: 0, kosong: 0, gagal: 0 }),
  }));
  const total = baris.reduce((n, b) => n + b.total, 0);
  const berisi = baris.reduce((n, b) => n + b.berisi, 0);
  const persen = total ? Math.round((berisi / total) * 100) : 0;
  const hariIni = isi.hari_ini;
  const terakhir = isi.denyut.antrean ?? isi.denyut.menit;

  return h(
    "section",
    { class: "bagian", "aria-labelledby": "judul-kelengkapan" },
    h("h2", { id: "judul-kelengkapan" }, "Kelengkapan isi"),
    isi.akses
      ? peringatan(
          "diubah",
          h("p", null, h("strong", null, "pasal.id sedang tidak memberi isi peraturan.")),
          h(
            "p",
            null,
            "Daftar peraturan tetap diperbarui, tetapi pasal.id tidak mengirim teks pasal lewat API-nya, sehingga teks peraturan baru belum bisa diambil. Teks yang sudah tersimpan tidak terpengaruh, dan pengambilan dilanjutkan sendiri begitu pasal.id kembali memberi isi.",
          ),
          isi.akses.catatan ? h("p", { class: "redup" }, `Catatan pasal.id: ${isi.akses.catatan}`) : null,
          h("p", { class: "redup" }, `Terlihat sejak ${waktuIso(isi.akses.sejak)}; diperiksa lagi ${waktuIso(isi.akses.periksa_lagi)}.`),
        )
      : null,
    isi.pasal_dijeda_sampai ? peringatan("info", h("p", null, `pasal.id meminta jeda. Pengambilan data dilanjutkan sekitar ${waktuIso(isi.pasal_dijeda_sampai)}.`)) : null,
    h(
      "div",
      { class: "kartu" },
      h("p", { class: "kelengkapan-ringkas" }, h("strong", null, `${angka(berisi)} dari ${angka(total)}`), " peraturan sudah punya teks pasal"),
      h(
        "div",
        { class: "meter", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(persen), "aria-label": "Peraturan yang sudah punya teks pasal" },
        h("span", { style: { width: `${persen}%` } }),
      ),
      h(
        "div",
        { class: "tabel-gulir", tabindex: "0", role: "region", "aria-label": "Kelengkapan isi per jenis, dapat digulir" },
        h(
          "table",
          { class: "tabel" },
          h("thead", null, h("tr", null, ["Jenis", "Di sumber", "Tersimpan", "Berisi pasal", "Menunggu", "Tanpa isi", "Gagal"].map((k, i) => h("th", { class: i ? "angka-tabel" : "" }, k)))),
          h(
            "tbody",
            null,
            baris.map((b) =>
              h(
                "tr",
                null,
                h("td", null, kodeJenis(b.jenis)),
                h("td", { class: "angka-tabel" }, b.dukungan?.startsWith("tidak") ? "tak ada" : b.sumber === null ? "belum disapu" : angka(b.sumber)),
                h("td", { class: "angka-tabel" }, angka(b.total)),
                h("td", { class: "angka-tabel" }, angka(b.berisi)),
                h("td", { class: "angka-tabel" }, angka(b.menunggu)),
                h("td", { class: "angka-tabel" }, angka(b.kosong)),
                h("td", { class: "angka-tabel" }, angka(b.gagal)),
              ),
            ),
          ),
        ),
      ),
      h(
        "p",
        { class: "redup kelengkapan-catatan" },
        "\"Di sumber\" adalah jumlah peraturan jenis itu di daftar pasal.id; \"Menunggu\" sudah tercatat tetapi pasalnya belum diambil (atau teksnya yang tersimpan sebagian sedang diambil ulang). Lexa mengambil isi bertahap, UUD dan Tap MPR lebih dulu, lalu UU, Perppu, dan PP, yang terbaru lebih dulu.",
      ),
      h(
        "p",
        { class: "redup kelengkapan-catatan" },
        `Pemroses latar terakhir berjalan ${waktuIso(terakhir)}. Hari ini: ${angka(hariIni.katalog ?? 0)} peraturan didaftar, ${angka(hariIni.lengkap ?? 0)} diisi, ${angka(hariIni.batas_laju ?? 0)} kali kena batas laju.`,
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
      h("p", { class: "redup" }, "Keadaan indeks Lexa saat ini. Data berasal dari sinkronisasi terjadwal dan impor manual, sehingga belum tentu mencakup semua peraturan yang termasuk cakupan."),
      s.cakupan?.length ? h("p", { class: "redup" }, `Cakupan Lexa saat ini: ${daftarCakupan(s.cakupan)}. Peraturan jenis lain tidak dimuat.`) : null,
      h(
        "section",
        { class: "statistik", "aria-label": "Ringkasan" },
        h("div", { class: "kartu" }, h("span", { class: "angka" }, angka(s.total_peraturan)), h("span", { class: "label" }, "peraturan")),
        h("div", { class: "kartu" }, h("span", { class: "angka" }, angka(s.total_pasal)), h("span", { class: "label" }, "pasal dan ayat")),
        h("div", { class: "kartu" }, h("span", { class: "angka" }, `${cakupan}%`), h("span", { class: "label" }, `terindeks untuk pencarian makna (${angka(s.terindeks_vektor)})`)),
      ),
      s.isi ? panelKelengkapan(s.isi, s.cakupan ?? []) : null,
      h(
        "div",
        { class: "dua-sama" },
        h(
          "section",
          { class: "kartu" },
          h("h2", { class: "kartu-judul" }, "Menurut jenis"),
          s.per_jenis.length
            ? h("div", { class: "tabel-gulir", tabindex: "0", role: "region", "aria-label": "Tabel jenis peraturan, dapat digulir" }, h("table", { class: "tabel" }, h("thead", null, h("tr", null, h("th", null, "Jenis"), h("th", null, "Jumlah"))), h("tbody", null, s.per_jenis.map((j) => h("tr", null, h("td", null, h("a", { href: `/telusuri?jenis=${encodeURIComponent(j.jenis)}` }, `${kodeJenis(j.jenis)} · ${labelJenis(j.jenis)}`)), h("td", null, angka(j.n)))))))
            : h("p", { class: "redup" }, "Belum ada data."),
        ),
        h(
          "section",
          { class: "kartu" },
          h("h2", { class: "kartu-judul" }, "Baru ditambahkan"),
          s.terbaru.length
            ? h("ul", { class: "daftar-ringkas" }, s.terbaru.map((l) => h("li", null, h("a", { href: urlPeraturan(l.frbr_uri) }, h("span", { class: "sitasi" }, sitasi(l)), h("span", { class: "judul" }, judulRingkas(l.judul))))))
            : h("p", { class: "redup" }, "Belum ada data."),
        ),
      ),
      h(
        "section",
        { class: "bagian" },
        h("h2", null, "Riwayat pekerjaan data"),
        s.sinkronisasi_terakhir.length
          ? h(
              "div",
              { class: "tabel-gulir kartu", tabindex: "0", role: "region", "aria-label": "Riwayat pekerjaan data, dapat digulir" },
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
