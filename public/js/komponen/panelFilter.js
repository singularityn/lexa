// @ts-check
import { h, tunda } from "../dom.js";
import { angka, kodeJenis, labelJenis, labelStatus } from "../format.js";
import { ikon } from "./ikon.js";

/**
 * @typedef {{ jenis: string[], status: string[], tahun_min?: number, tahun_max?: number, bidang?: string }} FilterPeraturan
 * @typedef {{ value: string, count?: number }} ButirFacet
 */

const STATUS = ["berlaku", "diubah", "dicabut"];

/**
 * Kelompok kotak centang yang bisa diperbarui di tempat (hitungan dan butir baru)
 * tanpa mengganti elemen, supaya fokus papan ketik tidak hilang.
 * @param {{ nama: string, judul: string, label: (nilai: string) => string, terpilih: () => string[], saatUbah: (nilai: string, centang: boolean) => void }} opsi
 */
function kelompokCentang({ nama, judul, label, terpilih, saatUbah }) {
  const daftar = h("div", { role: "group", "aria-label": judul });
  /** @type {Map<string, { baris: HTMLElement, input: HTMLInputElement, jumlah: HTMLElement }>} */
  const peta = new Map();

  /** @param {string} nilai */
  function pastikan(nilai) {
    let butir = peta.get(nilai);
    if (butir) return butir;
    const input = /** @type {HTMLInputElement} */ (
      h("input", { type: "checkbox", name: nama, value: nilai, onchange: () => saatUbah(nilai, input.checked) })
    );
    const jumlah = h("span", { class: "jumlah" });
    const baris = h("label", { class: "cek" }, input, h("span", null, label(nilai)), jumlah);
    daftar.appendChild(baris);
    butir = { baris, input, jumlah };
    peta.set(nilai, butir);
    return butir;
  }

  return {
    el: h("div", { class: "filter-grup" }, h("h3", null, judul), daftar),
    /** @param {ButirFacet[]} butir @param {boolean} [tambahkanBaru] */
    perbarui(butir, tambahkanBaru = true) {
      const dipilih = new Set(terpilih());
      const hitungan = new Map(butir.map((b) => [b.value, b.count]));
      if (tambahkanBaru) for (const b of butir) pastikan(b.value);
      for (const v of dipilih) pastikan(v);
      for (const [nilai, { input, jumlah, baris }] of peta) {
        input.checked = dipilih.has(nilai);
        const n = hitungan.get(nilai);
        jumlah.textContent = n === undefined ? "" : angka(n);
        // Butir yang tidak ada di hasil (dan tidak dipilih) diredupkan, bukan dihilangkan.
        baris.classList.toggle("redup", !hitungan.has(nilai) && !dipilih.has(nilai));
      }
    },
  };
}

/**
 * Panel filter peraturan: jenis, status, tahun, bidang.
 *
 * @param {{
 *   filter: FilterPeraturan,
 *   saatUbah: () => void,
 *   bidang?: boolean,
 * }} opsi `filter` adalah objek yang dimiliki halaman; panel hanya mengubah isinya lalu memanggil `saatUbah`.
 */
export function buatPanelFilter({ filter, saatUbah, bidang = true }) {
  const jenis = kelompokCentang({
    nama: "jenis",
    judul: "Jenis peraturan",
    label: (v) => `${kodeJenis(v)} · ${labelJenis(v)}`,
    terpilih: () => filter.jenis,
    saatUbah: (v, ya) => {
      filter.jenis = ya ? [...new Set([...filter.jenis, v])] : filter.jenis.filter((x) => x !== v);
      ubah();
    },
  });
  const status = kelompokCentang({
    nama: "status",
    judul: "Status",
    label: labelStatus,
    terpilih: () => filter.status,
    saatUbah: (v, ya) => {
      filter.status = ya ? [...new Set([...filter.status, v])] : filter.status.filter((x) => x !== v);
      ubah();
    },
  });
  status.perbarui(STATUS.map((value) => ({ value })));

  const bacaTahun = (/** @type {HTMLInputElement} */ el) => {
    const n = Number(el.value);
    return Number.isInteger(n) && n >= 1800 && n <= 2200 ? n : undefined;
  };
  const dari = /** @type {HTMLInputElement} */ (
    h("input", { class: "input", type: "number", inputmode: "numeric", min: "1800", max: "2200", placeholder: "Dari", "aria-label": "Tahun dari", value: filter.tahun_min ?? "" })
  );
  const sampai = /** @type {HTMLInputElement} */ (
    h("input", { class: "input", type: "number", inputmode: "numeric", min: "1800", max: "2200", placeholder: "Sampai", "aria-label": "Tahun sampai", value: filter.tahun_max ?? "" })
  );
  const ubahTahun = tunda(() => {
    filter.tahun_min = bacaTahun(dari);
    filter.tahun_max = bacaTahun(sampai);
    ubah();
  }, 450);
  dari.addEventListener("input", ubahTahun);
  sampai.addEventListener("input", ubahTahun);

  const pilihBidang = /** @type {HTMLSelectElement} */ (
    h("select", {
      class: "input",
      "aria-label": "Bidang hukum",
      onchange: () => {
        filter.bidang = pilihBidang.value || undefined;
        ubah();
      },
    }, h("option", { value: "" }, "Semua bidang"))
  );

  const lencana = h("span", { class: "lencana-jumlah sembunyi" });
  const tombolToggle = h(
    "button",
    {
      type: "button",
      class: "tombol filter-toggle",
      "aria-expanded": "false",
      onclick: () => {
        const tutup = el.classList.toggle("tertutup");
        tombolToggle.setAttribute("aria-expanded", String(!tutup));
      },
    },
    ikon("menu"),
    "Filter",
    lencana,
  );
  const tombolHapus = h(
    "button",
    {
      type: "button",
      class: "tombol tombol-kecil sembunyi",
      onclick: () => {
        filter.jenis = [];
        filter.status = [];
        filter.tahun_min = filter.tahun_max = filter.bidang = undefined;
        dari.value = sampai.value = "";
        pilihBidang.value = "";
        jenis.perbarui([], false);
        status.perbarui(STATUS.map((value) => ({ value })));
        ubah();
      },
    },
    "Hapus semua filter",
  );

  function jumlahAktif() {
    return filter.jenis.length + filter.status.length + (filter.tahun_min ? 1 : 0) + (filter.tahun_max ? 1 : 0) + (filter.bidang ? 1 : 0);
  }
  function ubah() {
    const n = jumlahAktif();
    lencana.textContent = String(n);
    lencana.classList.toggle("sembunyi", n === 0);
    tombolHapus.classList.toggle("sembunyi", n === 0);
    saatUbah();
  }

  const el = h(
    "aside",
    { class: "sisi tertutup", "aria-label": "Filter pencarian" },
    tombolToggle,
    h(
      "div",
      { class: "filter-isi" },
      jenis.el,
      status.el,
      h("div", { class: "filter-grup" }, h("h3", null, "Tahun"), h("div", { class: "filter-tahun" }, dari, sampai)),
      bidang ? h("div", { class: "filter-grup" }, h("h3", null, "Bidang"), pilihBidang) : null,
      tombolHapus,
    ),
  );

  // Keadaan awal dari URL.
  const n0 = jumlahAktif();
  lencana.textContent = String(n0);
  lencana.classList.toggle("sembunyi", n0 === 0);
  tombolHapus.classList.toggle("sembunyi", n0 === 0);

  return {
    el,
    /** @param {{ jenis?: ButirFacet[], status?: ButirFacet[] }} facet */
    perbaruiFacet(facet) {
      // Selalu dipanggil, juga tanpa facet: butir yang sudah dipilih dari URL harus tetap tampil.
      jenis.perbarui((facet.jenis ?? []).slice(0, 14));
      status.perbarui(STATUS.map((v) => (facet.status ? (facet.status.find((b) => b.value === v) ?? { value: v, count: 0 }) : { value: v })));
    },
    /** @param {Array<{ nama: string, jumlah: number }>} daftar */
    isiBidang(daftar) {
      pilihBidang.replaceChildren(
        h("option", { value: "" }, "Semua bidang"),
        ...daftar.map((b) => h("option", { value: b.nama }, `${b.nama} (${angka(b.jumlah)})`)),
      );
      if (filter.bidang && !daftar.some((b) => b.nama === filter.bidang)) pilihBidang.appendChild(h("option", { value: filter.bidang }, filter.bidang));
      pilihBidang.value = filter.bidang ?? "";
    },
    jumlahAktif,
  };
}
