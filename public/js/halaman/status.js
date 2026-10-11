// @ts-check
import { h, isi } from "../dom.js";
import { api, dibatalkan } from "../api.js";
import { angka, daftarCakupan, judulRingkas, kodeJenis, labelJenis, sitasi, urlPeraturan } from "../format.js";
import { kerangka, kotakGalat } from "../komponen/umum.js";

const NAMA_PEKERJAAN = /** @type {Record<string, string>} */ ({
  jadwal_sinkronisasi: "Sinkronisasi terjadwal",
  antrean_ingest: "Antrean ingest",
  impor_bpk: "Impor dari BPK",
  ekstrak_pdf: "Ekstraksi PDF",
  ringkas: "Ringkasan AI",
  perbaiki_celah: "Perbaikan pasal bercelah",
  asisten: "Tanya Lexa",
});

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
