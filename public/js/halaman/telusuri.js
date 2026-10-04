// @ts-check
import { h, isi } from "../dom.js";
import { api, dibatalkan } from "../api.js";
import { angka, bacaFilter, daftarCakupan, kodeJenis, queryString } from "../format.js";
import { buatPanelFilter } from "../komponen/panelFilter.js";
import { kartuPeraturan } from "../komponen/kartuHasil.js";
import { keadaanKosong, kerangkaHasil, kotakGalat, paginasi } from "../komponen/umum.js";

const PER_HALAMAN = 20;
const URUTAN = [
  ["", "Terbaru"],
  ["tahun_asc", "Terlama"],
  ["judul", "Judul A–Z"],
];

/** @param {import("../router.js").Konteks} ctx */
export default async function telusuri(ctx) {
  ctx.setJudul("Telusuri peraturan", "Telusuri seluruh peraturan menurut jenis, tahun, status, dan bidang hukum.");

  const dariUrl = bacaFilter(ctx.params);
  const filter = {
    jenis: dariUrl.jenis,
    status: dariUrl.status,
    tahun_min: dariUrl.tahun_min,
    tahun_max: dariUrl.tahun_max,
    bidang: dariUrl.bidang,
  };
  const keadaan = {
    urut: ["tahun_asc", "judul"].includes(ctx.params.get("urut") ?? "") ? /** @type {string} */ (ctx.params.get("urut")) : "",
    halaman: Math.max(Number(ctx.params.get("page")) || 1, 1),
  };

  let nomor = 0;
  /** @type {AbortController | null} */
  let berjalan = null;
  ctx.saatKeluar(() => berjalan?.abort());

  const panel = buatPanelFilter({
    filter,
    saatUbah: () => {
      keadaan.halaman = 1;
      muat();
    },
  });
  const hasil = h("div", { "aria-live": "polite" });
  const ringkas = h("span", { class: "ringkas-hasil", role: "status" });
  const cakupanInfo = h("p", { class: "redup" });
  const urut = /** @type {HTMLSelectElement} */ (
    h(
      "select",
      {
        class: "input",
        style: { width: "auto" },
        "aria-label": "Urutkan",
        onchange: () => {
          keadaan.urut = urut.value;
          keadaan.halaman = 1;
          muat();
        },
        value: keadaan.urut,
      },
      URUTAN.map(([v, label]) => h("option", { value: v }, label)),
    )
  );

  isi(
    ctx.akar,
    h("h1", null, "Telusuri peraturan"),
    cakupanInfo,
    h(
      "div",
      { class: "dua-kolom" },
      panel.el,
      h("div", { class: "area-atas bilah-alat" }, panel.tombol, h("span", { class: "rentang" }), urut),
      h("section", { class: "area-hasil", "aria-label": "Daftar peraturan" }, panel.chipAktif, h("div", { class: "bilah-hasil" }, ringkas), hasil),
    ),
  );
  panel.perbaruiFacet({});
  api.bidang().then((b) => !ctx.sinyal.aborted && panel.isiBidang(b.bidang)).catch(() => {});

  /** @param {number} halaman */
  const urlHalaman = (halaman) =>
    `/telusuri${queryString({
      jenis: filter.jenis,
      status: filter.status,
      tahun_min: filter.tahun_min,
      tahun_max: filter.tahun_max,
      bidang: filter.bidang,
      urut: keadaan.urut,
      page: halaman > 1 ? halaman : null,
    })}`;

  async function muat() {
    const giliran = ++nomor;
    berjalan?.abort();
    berjalan = new AbortController();
    ctx.sinyal.addEventListener("abort", () => berjalan?.abort(), { once: true });
    ctx.perbaruiUrl(urlHalaman(keadaan.halaman));
    isi(hasil, kerangkaHasil());
    ringkas.textContent = "Memuat…";

    try {
      const r = await api.telusur({ ...filter, urut: keadaan.urut, page: keadaan.halaman, per_page: PER_HALAMAN }, berjalan.signal);
      if (giliran !== nomor) return;
      panel.perbaruiFacet(r.facets);
      ringkas.textContent = `${angka(r.total)} peraturan`;
      panel.setTombolSelesai(r.total ? `Tampilkan ${angka(r.total)} peraturan` : "Tutup");
      if (r.cakupan?.length) cakupanInfo.textContent = `Cakupan saat ini: ${daftarCakupan(r.cakupan)}.`;
      if (!r.laws.length) {
        const luar = r.di_luar_cakupan?.length ? r.di_luar_cakupan : null;
        isi(
          hasil,
          luar
            ? keadaanKosong(
                `Jenis ${luar.map(kodeJenis).join(", ")} belum dimuat Lexa`,
                h("p", null, `Untuk saat ini Lexa hanya memuat ${daftarCakupan(r.cakupan ?? [])}.`),
                h("div", { class: "contoh", style: { marginTop: "12px" } }, h("a", { class: "chip", href: "/telusuri" }, "Telusuri semua peraturan")),
              )
            : keadaanKosong("Tidak ada peraturan yang cocok", h("p", null, "Longgarkan filter di samping untuk melihat lebih banyak.")),
        );
        return;
      }
      isi(
        hasil,
        h("ul", { class: "daftar-hasil" }, r.laws.map((l) => kartuPeraturan(l))),
        paginasi({ halaman: r.page, total: r.total, perHalaman: r.per_page, url: urlHalaman }),
      );
      // Tautan paginasi dibuka lewat router, jadi gulir ke atas daftar setelah ganti halaman.
    } catch (e) {
      if (dibatalkan(e) || giliran !== nomor) return;
      ringkas.textContent = "";
      isi(hasil, kotakGalat(e, muat));
    }
  }

  await muat();
}
