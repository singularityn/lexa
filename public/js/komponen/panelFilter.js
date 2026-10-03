// @ts-check
import { h, tunda } from "../dom.js";
import { angka, daftarBidang, kodeJenis, labelJenis, labelStatus } from "../format.js";
import { ikon } from "./ikon.js";
import { pilihMode } from "./pilihMode.js";

/**
 * @typedef {{ jenis: string[], status: string[], tahun_min?: number, tahun_max?: number, bidang?: string }} FilterPeraturan
 * @typedef {{ value: string, count?: number }} ButirFacet
 */

const STATUS = ["berlaku", "diubah", "dicabut"];
/** Di bawah lebar ini panel menjadi lembar yang naik dari bawah (lihat app.css, @media 860px). */
const PONSEL = "(max-width: 860px)";

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
 * Di layar lebar panel tampil sebagai kolom di samping hasil. Di ponsel isinya sebuah <dialog> modal
 * yang naik dari bawah (fokus terperangkap, Esc menutup, latar tak bisa disentuh), dibuka lewat
 * `tombol`. Filter berlaku seketika; "Tampilkan hasil" hanya menutup lembar. Filter yang aktif juga
 * ditampilkan sebagai chip yang bisa dilepas satu per satu (`chipAktif`), di luar lembar.
 *
 * Bila `mode` diberikan, kelompok pertamanya adalah "Cara mencari" (Otomatis/Kata persis/Makna): di ponsel
 * ia ada di dalam lembar bersama filter lain, dan mode selain Otomatis tampil sebagai chip aktif.
 *
 * @param {{
 *   filter: FilterPeraturan,
 *   saatUbah: () => void,
 *   bidang?: boolean,
 *   mode?: { ambil: () => string, ubah: (mode: string) => void },
 * }} opsi `filter` adalah objek yang dimiliki halaman; panel hanya mengubah isinya lalu memanggil `saatUbah`.
 */
export function buatPanelFilter({ filter, saatUbah, bidang = true, mode }) {
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
  const tombol = h("button", { type: "button", class: "tombol filter-toggle", "aria-expanded": "false", "aria-haspopup": "dialog", onclick: () => buka() }, ikon("penyaring"), h("span", { class: "filter-teks" }, "Filter"), lencana);

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

  const chipAktif = h("div", { class: "filter-aktif", role: "group", "aria-label": "Filter yang aktif" });
  const kelompokMode = mode
    ? h("div", { class: "filter-grup" }, h("h3", null, "Cara mencari"), pilihMode(mode.ambil(), (m) => { mode.ubah(m); gambarRingkasan(); }, "mode-cari"))
    : null;
  const tombolSelesai = h("button", { type: "button", class: "tombol tombol-utama", onclick: () => tutup() }, "Tampilkan hasil");

  const dialog = /** @type {HTMLDialogElement} */ (
    h(
      "dialog",
      { class: "filter-isi", "aria-labelledby": "judul-filter" },
      h(
        "div",
        { class: "lembar-kepala" },
        h("h2", { id: "judul-filter" }, "Filter"),
        h("button", { type: "button", class: "tombol tombol-hantu tombol-ikon", "aria-label": "Tutup filter", onclick: () => tutup() }, ikon("tutup")),
      ),
      h(
        "div",
        { class: "lembar-isi" },
        kelompokMode,
        jenis.el,
        status.el,
        h("div", { class: "filter-grup" }, h("h3", null, "Tahun"), h("div", { class: "filter-tahun" }, dari, sampai)),
        bidang ? h("div", { class: "filter-grup" }, h("h3", null, "Bidang"), pilihBidang) : null,
        tombolHapus,
      ),
      h("div", { class: "lembar-kaki" }, tombolSelesai),
    )
  );
  // Klik pada latar (bagian dialog di luar kotak isinya) menutup lembar di ponsel.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog && dialog.open && mobil.matches) tutup();
  });
  dialog.addEventListener("close", () => tombol.setAttribute("aria-expanded", "false"));

  const el = h("aside", { class: "sisi", "aria-label": "Filter pencarian" }, dialog);

  // Layar lebar: panel selalu tampil (dialog non-modal). Ponsel: tertutup sampai dibuka.
  const mobil = matchMedia(PONSEL);
  if (!mobil.matches) dialog.setAttribute("open", "");
  mobil.addEventListener("change", () => {
    if (mobil.matches) {
      if (dialog.open) dialog.close();
    } else if (!dialog.open) {
      dialog.show();
    }
  });

  function buka() {
    if (!mobil.matches) return;
    if (!dialog.open) dialog.showModal();
    tombol.setAttribute("aria-expanded", "true");
  }
  function tutup() {
    if (mobil.matches && dialog.open) dialog.close();
    tombol.focus({ preventScroll: true });
  }

  /** Filter aktif sebagai butir yang bisa dilepas. @returns {Array<{ label: string, lepas: () => void }>} */
  function butirAktif() {
    /** @type {Array<{ label: string, lepas: () => void }>} */
    const daftar = [];
    if (mode && mode.ambil() !== "hybrid") {
      daftar.push({
        label: `Cara: ${mode.ambil() === "keyword" ? "Kata persis" : "Makna"}`,
        lepas: () => /** @type {HTMLInputElement | null} */ (kelompokMode?.querySelector('input[value="hybrid"]'))?.click(),
      });
    }
    for (const j of filter.jenis) daftar.push({ label: kodeJenis(j), lepas: () => setelahLepas(() => (filter.jenis = filter.jenis.filter((x) => x !== j))) });
    for (const st of filter.status) daftar.push({ label: labelStatus(st), lepas: () => setelahLepas(() => (filter.status = filter.status.filter((x) => x !== st))) });
    if (filter.tahun_min || filter.tahun_max) {
      daftar.push({
        label: filter.tahun_min && filter.tahun_max ? `${filter.tahun_min}–${filter.tahun_max}` : filter.tahun_min ? `Sejak ${filter.tahun_min}` : `Sampai ${filter.tahun_max}`,
        lepas: () => setelahLepas(() => { filter.tahun_min = filter.tahun_max = undefined; dari.value = sampai.value = ""; }),
      });
    }
    if (filter.bidang) {
      const nama = daftarBidang(filter.bidang)[0] ?? filter.bidang;
      daftar.push({ label: nama, lepas: () => setelahLepas(() => { filter.bidang = undefined; pilihBidang.value = ""; }) });
    }
    return daftar;
  }

  /** @param {() => void} ubahFilter */
  function setelahLepas(ubahFilter) {
    ubahFilter();
    jenis.perbarui([], false);
    status.perbarui(STATUS.map((value) => ({ value })));
    ubah();
  }

  function jumlahAktif() {
    return (mode && mode.ambil() !== "hybrid" ? 1 : 0) + filter.jenis.length + filter.status.length + (filter.tahun_min ? 1 : 0) + (filter.tahun_max ? 1 : 0) + (filter.bidang ? 1 : 0);
  }

  function gambarRingkasan() {
    const n = jumlahAktif();
    lencana.textContent = String(n);
    lencana.classList.toggle("sembunyi", n === 0);
    tombolHapus.classList.toggle("sembunyi", n === 0);
    chipAktif.replaceChildren(
      ...butirAktif().map((b) =>
        h("button", { type: "button", class: "chip-filter", "aria-label": `Lepas filter ${b.label}`, onclick: b.lepas }, b.label, ikon("tutup")),
      ),
    );
  }

  function ubah() {
    gambarRingkasan();
    saatUbah();
  }
  gambarRingkasan(); // keadaan awal dari URL

  return {
    el,
    /** Tombol pembuka lembar (hanya tampil di ponsel); halaman menaruhnya di bilah alatnya. */
    tombol,
    /** Chip filter aktif; halaman menaruhnya di dekat hasil. */
    chipAktif,
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
        ...daftar.map((b) => h("option", { value: b.nama }, `${daftarBidang(b.nama)[0] ?? b.nama} (${angka(b.jumlah)})`)),
      );
      if (filter.bidang && !daftar.some((b) => b.nama === filter.bidang)) pilihBidang.appendChild(h("option", { value: filter.bidang }, daftarBidang(filter.bidang)[0] ?? filter.bidang));
      pilihBidang.value = filter.bidang ?? "";
    },
    /** Teks tombol penutup lembar, mis. "Tampilkan 20 hasil". @param {string} teks */
    setTombolSelesai(teks) {
      tombolSelesai.textContent = teks;
    },
    jumlahAktif,
  };
}
