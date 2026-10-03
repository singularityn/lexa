// @ts-check
import { h, hapusTanda, isi, salin, tandaiIstilah, tunda } from "../dom.js";
import { api, dibatalkan, GalatApi } from "../api.js";
import {
  angka, bersihkanArtefak, istilahDariKueri, jangkarDariId, kelompokkanPasal, labelJenis, labelRelasi, namaLengkap,
  queryString, sitasi, sitasiPasal, tanggalIndonesia, urlPeraturan, URUTAN_RELASI,
} from "../format.js";
import { ikon } from "../komponen/ikon.js";
import { toast } from "../komponen/toast.js";
import { tombolTandai } from "../komponen/tombolTandai.js";
import { bukaDialogLaporan } from "../komponen/dialogLaporan.js";
import { buatGrafik } from "../komponen/grafik.js";
import { halamanKosong, keadaanKosong, kerangka, kotakGalat, lencanaStatus, peringatan, tombolIkon } from "../komponen/umum.js";

/** @typedef {import("../../../src/shared/types").Law} Law */
/** @typedef {import("../../../src/shared/types").LawDetailResponse} Detail */

/** Tautan hanya jika skemanya http(s); data dari sumber luar tidak dipercaya begitu saja. @param {string | null | undefined} url */
function tautanAman(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

/** @param {import("../router.js").Konteks} ctx */
export default async function peraturan(ctx) {
  const uri = ctx.params.get("uri");
  const q = (ctx.params.get("q") ?? "").trim();

  if (!uri) {
    ctx.setJudul("Peraturan tidak ditentukan");
    isi(ctx.akar, halamanKosong("Peraturan tidak ditentukan", h("p", null, "Buka peraturan dari hasil pencarian atau daftar telusur."), h("a", { class: "tombol tombol-utama", href: "/telusuri" }, "Telusuri peraturan")));
    return;
  }

  ctx.setJudul("Memuat peraturan…");
  isi(ctx.akar, h("div", { class: "kartu" }, h("span", { class: "kerangka", style: { width: "40%", height: "1.6em" } }), kerangka(4)));

  /** @type {Detail} */
  let data;
  try {
    data = await api.detail(uri, ctx.sinyal);
  } catch (e) {
    if (dibatalkan(e)) return;
    ctx.setJudul(e instanceof GalatApi && e.status === 404 ? "Peraturan tidak ditemukan" : "Gagal memuat peraturan");
    isi(
      ctx.akar,
      e instanceof GalatApi && e.status === 404 ? tidakAda(uri) : kotakGalat(e, () => peraturan(ctx)),
    );
    return;
  }
  tampilkan(ctx, data, q);
}

/** @param {string} uri */
function tidakAda(uri) {
  const m = /\/akn\/id\/act\/([^/]+)\/(\d{4})\/([^/]+)/.exec(uri);
  const kutipan = m ? `${m[1].toUpperCase().replace(/-/g, " ")} ${m[3]}/${m[2]}` : null;
  return halamanKosong(
    "Peraturan ini belum ada di indeks Lexa",
    h("p", null, "Indeks Lexa belum memuat peraturan ini. Anda bisa mencarinya di indeks atau membuka naskah resminya di situs BPK."),
    h(
      "div",
      { class: "contoh" },
      kutipan ? h("a", { class: "chip", href: `/cari${queryString({ q: kutipan })}` }, `Cari “${kutipan}”`) : null,
      h("a", { class: "chip", href: "/telusuri" }, "Telusuri peraturan"),
      h("a", { class: "chip", href: "https://peraturan.bpk.go.id", target: "_blank", rel: "noopener noreferrer" }, "peraturan.bpk.go.id"),
    ),
  );
}

/**
 * @param {import("../router.js").Konteks} ctx
 * @param {Detail} d
 * @param {string} q
 */
function tampilkan(ctx, d, q) {
  const l = d.law;
  const nama = sitasi(l);
  const deskripsi = (l.ringkasan || `${namaLengkap(l)} tentang ${l.judul}.`).slice(0, 180);
  ctx.setJudul(`${nama} ${l.judul}`, deskripsi);

  const aksiRelasi = (/** @type {string} */ jenis) => d.relations.filter((r) => r.jenis_relasi === jenis);
  const pengganti = [...aksiRelasi("dicabut_oleh"), ...aksiRelasi("diubah_oleh")];

  const spanduk = (() => {
    if (l.status === "berlaku") return null;
    const dicabut = l.status === "dicabut";
    return peringatan(
      dicabut ? "dicabut" : "diubah",
      h("p", null, h("strong", null, dicabut ? "Peraturan ini berstatus dicabut" : "Peraturan ini telah diubah"), dicabut ? ", sehingga ketentuannya mungkin tidak lagi berlaku." : "; ketentuannya mungkin sudah berbeda dari teks di bawah."),
      pengganti.length
        ? h("p", null, `${dicabut ? "Dicabut" : "Diubah"} oleh: `, pengganti.map((r, i) => [i ? ", " : "", r.judul && r.jenis ? h("a", { href: urlPeraturan(r.to_uri) }, `${r.jenis} ${r.nomor}/${r.tahun}`) : (r.keterangan ?? r.to_uri)]))
        : h("p", null, "Periksa tab Relasi untuk peraturan yang mengubah atau mencabutnya."),
    );
  })();

  const infoDokumen = h("div", { id: "info-dokumen" });
  const tombolPdf = h("a", { class: "tombol sembunyi", target: "_blank", rel: "noopener" }, ikon("unduh"), h("span", null, "PDF"));
  const bpk = tautanAman(d.bpk_url);

  const aksi = h(
    "div",
    { class: "aksi-bar" },
    tombolTandai({ uri: l.frbr_uri, sitasi: nama, judul: l.judul }, { denganTeks: true }),
    tombolIkon("salin", "Salin sitasi", { onclick: async () => toast((await salin(nama)) ? `Disalin: ${nama}` : "Penyalinan gagal", { galat: false }) }),
    tombolIkon("tautan", "Salin tautan", { onclick: async () => toast((await salin(location.origin + urlPeraturan(l.frbr_uri))) ? "Tautan disalin." : "Penyalinan gagal") }),
    bpk ? h("a", { class: "tombol", href: bpk, target: "_blank", rel: "noopener noreferrer" }, ikon("luar"), h("span", null, "Naskah resmi (BPK)")) : null,
    tombolPdf,
    tombolIkon("bendera", "Laporkan kesalahan", { onclick: () => bukaDialogLaporan({ uri: l.frbr_uri, sitasi: nama }) }),
  );

  const metadata = h(
    "dl",
    { class: "metadata" },
    ...[
      ["Jenis", labelJenis(l.jenis)],
      ["Nomor / tahun", `${l.nomor} / ${l.tahun}`],
      l.tanggal_penetapan ? ["Ditetapkan", tanggalIndonesia(l.tanggal_penetapan)] : null,
      l.tanggal_berlaku ? ["Berlaku", tanggalIndonesia(l.tanggal_berlaku)] : null,
      l.instansi ? ["Instansi", l.instansi] : null,
      l.bidang ? ["Bidang", h("a", { href: `/telusuri${queryString({ bidang: l.bidang.split(/\s+-\s+/)[0] })}` }, l.bidang)] : null,
      l.tentang && l.tentang !== l.judul ? ["Tentang", l.tentang] : null,
      ["Jumlah pasal", angka(l.jumlah_pasal)],
      tautanAman(l.sumber_url) ? ["Sumber data", h("a", { href: /** @type {string} */ (tautanAman(l.sumber_url)), target: "_blank", rel: "noopener noreferrer" }, new URL(/** @type {string} */ (tautanAman(l.sumber_url))).hostname)] : null,
    ].flatMap((baris) => (baris ? [h("dt", null, baris[0]), h("dd", null, baris[1])] : [])),
  );

  // --- Tab ---------------------------------------------------------------
  const tabTersedia = [
    ["isi", "Isi"],
    ["relasi", `Relasi${d.relations.length ? ` (${d.relations.length})` : ""}`],
    ["naskah", "Naskah"],
  ];
  const tabAwal = tabTersedia.some(([k]) => k === ctx.params.get("tab")) ? /** @type {string} */ (ctx.params.get("tab")) : "isi";
  /** @type {Record<string, HTMLElement>} */
  const panel = {
    isi: h("div", { role: "tabpanel", id: "panel-isi", "aria-labelledby": "tab-isi" }, panelIsi(d, q)),
    relasi: h("div", { role: "tabpanel", id: "panel-relasi", "aria-labelledby": "tab-relasi", hidden: true }),
    naskah: h("div", { role: "tabpanel", id: "panel-naskah", "aria-labelledby": "tab-naskah", hidden: true }),
  };
  /** @type {Record<string, boolean>} */
  const termuat = { isi: true };

  /** @param {string} kunci */
  function pilihTab(kunci, { fokus = false, simpan = true } = {}) {
    for (const [k] of tabTersedia) {
      const tombol = /** @type {HTMLElement} */ (daftarTab.querySelector(`#tab-${k}`));
      const aktif = k === kunci;
      tombol.setAttribute("aria-selected", String(aktif));
      tombol.tabIndex = aktif ? 0 : -1;
      panel[k].hidden = !aktif;
      if (aktif && fokus) tombol.focus();
    }
    if (!termuat[kunci]) {
      termuat[kunci] = true;
      if (kunci === "relasi") isi(panel.relasi, ...panelRelasi(d, ctx));
      if (kunci === "naskah") isi(panel.naskah, panelNaskah(d, ctx, infoStatus));
    }
    if (simpan) ctx.perbaruiUrl(`${location.pathname}${queryString({ uri: l.frbr_uri, q: q || null, tab: kunci === "isi" ? null : kunci })}${location.hash}`);
  }

  const daftarTab = h(
    "div",
    {
      class: "tab-daftar",
      role: "tablist",
      "aria-label": "Bagian peraturan",
      onkeydown: (/** @type {KeyboardEvent} */ e) => {
        const kunci = tabTersedia.map(([k]) => k);
        const sekarang = kunci.findIndex((k) => daftarTab.querySelector(`#tab-${k}`)?.getAttribute("aria-selected") === "true");
        if (e.key === "ArrowRight") pilihTab(kunci[(sekarang + 1) % kunci.length], { fokus: true });
        else if (e.key === "ArrowLeft") pilihTab(kunci[(sekarang - 1 + kunci.length) % kunci.length], { fokus: true });
        else return;
        e.preventDefault();
      },
    },
    tabTersedia.map(([k, label]) =>
      h("button", { role: "tab", id: `tab-${k}`, "aria-controls": `panel-${k}`, "aria-selected": "false", type: "button", tabindex: "-1", onclick: () => pilihTab(k) }, label),
    ),
  );

  // Status dokumen (PDF/teks) dimuat di latar belakang; hasilnya dipakai tombol PDF dan tab Naskah.
  /** @type {{ nilai: import("../api.js").StatusDokumen | null, galat: unknown, selesai: boolean, saatSelesai: Array<() => void> }} */
  const infoStatus = { nilai: null, galat: null, selesai: false, saatSelesai: [] };
  api.statusDokumen(l.frbr_uri, ctx.sinyal)
    .then((st) => {
      infoStatus.nilai = st;
      if (st.pdf_url) {
        tombolPdf.setAttribute("href", st.pdf_url);
        tombolPdf.classList.remove("sembunyi");
      }
    })
    .catch((e) => {
      infoStatus.galat = e;
    })
    .finally(() => {
      infoStatus.selesai = true;
      for (const fn of infoStatus.saatSelesai) fn();
    });

  const kepala = h(
    "header",
    null,
    h(
      "nav",
      { class: "remah", "aria-label": "Remah roti" },
      h("ol", null, h("li", null, h("a", { href: "/" }, "Beranda")), h("li", null, h("a", { href: "/telusuri" }, "Telusuri")), h("li", null, h("a", { href: `/telusuri${queryString({ jenis: l.jenis })}` }, labelJenis(l.jenis))), h("li", { "aria-current": "page" }, nama)),
    ),
    h("p", { class: "kicker" }, namaLengkap(l)),
    h("h1", { class: "judul-peraturan" }, l.judul),
    h("div", { class: "meta-baris" }, lencanaStatus(l.status), l.jumlah_pasal ? h("span", { class: "redup" }, `${angka(l.jumlah_pasal)} pasal`) : null, l.tanggal_penetapan ? h("span", { class: "redup" }, `Ditetapkan ${tanggalIndonesia(l.tanggal_penetapan)}`) : null),
  );

  isi(
    ctx.akar,
    kepala,
    spanduk,
    aksi,
    infoDokumen,
    l.ringkasan
      ? h("section", { class: "kartu ringkasan-ai", "aria-label": "Ringkasan" }, h("span", { class: "label" }, "Ringkasan otomatis (dibuat AI, periksa pasal aslinya)"), h("p", null, l.ringkasan))
      : null,
    h("section", { class: "kartu kartu-datar", style: { marginTop: "16px" }, "aria-label": "Keterangan peraturan" }, metadata),
    daftarTab,
    panel.isi,
    panel.relasi,
    panel.naskah,
  );

  pilihTab(tabAwal, { simpan: false });
  if (location.hash) {
    // Pasal yang ditautkan harus terlihat walau tab awal bukan "isi".
    if (tabAwal !== "isi") pilihTab("isi", { simpan: false });
    requestAnimationFrame(() => ctx.keJangkar());
  }
}

/**
 * Panel "Isi": pasal, daftar nomor, dan pencarian di dalam peraturan.
 * @param {Detail} d
 * @param {string} q
 */
function panelIsi(d, q) {
  const l = d.law;
  const nama = sitasi(l);
  if (!d.articles.length) {
    return keadaanKosong(
      "Teks pasal belum tersedia di Lexa",
      h("p", null, "Metadata peraturan ini sudah ada, tetapi isinya belum diekstrak. Naskah lengkap tersedia di situs resmi."),
      d.bpk_url ? h("a", { class: "tombol tombol-utama", href: d.bpk_url, target: "_blank", rel: "noopener noreferrer" }, "Buka naskah resmi (BPK)") : null,
    );
  }

  const kelompok = kelompokkanPasal(d.articles);
  const daftar = h("div", { class: "isi-peraturan" });
  /** @type {Array<{ el: HTMLElement, teks: string }>} */
  const indeks = [];

  for (const g of kelompok) {
    if (g.babBaru && g.bab) daftar.appendChild(h("h2", { class: "bab", id: `bab-${indeks.length}` }, g.bab));
    if (g.bagianBaru && g.bagian) daftar.appendChild(h("h3", { class: "bagian-uu" }, g.bagian));

    const satuTeks = g.butir.length === 1 && g.butir[0].ayat === null;
    const aksiPasal = h(
      "span",
      { class: "pasal-aksi" },
      h("button", { type: "button", class: "tombol tombol-kecil tombol-hantu tombol-ikon", title: "Salin sitasi", "aria-label": `Salin sitasi Pasal ${g.nomor}`, onclick: async () => toast((await salin(sitasiPasal(l, g.nomor))) ? `Disalin: ${sitasiPasal(l, g.nomor)}` : "Penyalinan gagal") }, ikon("salin")),
      h("button", { type: "button", class: "tombol tombol-kecil tombol-hantu tombol-ikon", title: "Salin tautan ke pasal ini", "aria-label": `Salin tautan Pasal ${g.nomor}`, onclick: async () => toast((await salin(location.origin + urlPeraturan(l.frbr_uri, { jangkar: g.jangkar }))) ? "Tautan disalin." : "Penyalinan gagal") }, ikon("tautan")),
      h("button", { type: "button", class: "tombol tombol-kecil tombol-hantu tombol-ikon", title: "Laporkan kesalahan pasal ini", "aria-label": `Laporkan kesalahan Pasal ${g.nomor}`, onclick: () => bukaDialogLaporan({ uri: l.frbr_uri, sitasi: nama, konteks: `Pasal ${g.nomor}` }) }, ikon("bendera")),
    );

    const el = h(
      "article",
      { class: "pasal", id: g.jangkar },
      h("div", { class: "pasal-kepala" }, h("h3", null, `Pasal ${g.nomor}`), aksiPasal),
      g.judul ? h("p", { class: "pasal-judul" }, g.judul) : null,
      satuTeks
        ? h("p", { class: "isi-pasal" }, bersihkanArtefak(g.butir[0].isi))
        : g.butir.map((b) =>
            b.ayat === null
              ? h("p", { class: "isi-pasal" }, bersihkanArtefak(b.isi))
              : h("div", { class: "ayat", id: jangkarDariId(b.id) }, h("span", { class: "no" }, `(${b.ayat})`), h("span", { class: "isi" }, bersihkanArtefak(b.isi))),
          ),
    );
    daftar.appendChild(el);
    indeks.push({ el, teks: `pasal ${g.nomor} ${g.judul ?? ""} ${g.butir.map((b) => bersihkanArtefak(b.isi)).join(" ")}`.toLowerCase() });
  }

  // --- Pencarian di dalam peraturan --------------------------------------
  const status = h("span", { class: "redup", role: "status", "aria-live": "polite" });
  const cariDalam = /** @type {HTMLInputElement} */ (
    h("input", { class: "input", type: "search", placeholder: "Cari kata di dalam peraturan ini…", "aria-label": "Cari di dalam peraturan ini", value: q })
  );
  const tombolBersih = h("button", { type: "button", class: "tombol tombol-kecil sembunyi" }, "Hapus penanda");

  function terapkan() {
    const istilah = istilahDariKueri(cariDalam.value);
    hapusTanda(daftar);
    if (!istilah.length) {
      for (const { el } of indeks) el.classList.remove("tidak-cocok");
      status.textContent = "";
      tombolBersih.classList.add("sembunyi");
      return;
    }
    let cocok = 0;
    for (const { el, teks } of indeks) {
      const ya = istilah.every((t) => teks.includes(t));
      el.classList.toggle("tidak-cocok", !ya);
      if (ya) {
        cocok++;
        tandaiIstilah(el, istilah);
      }
    }
    status.textContent = cocok ? `${angka(cocok)} pasal memuat ${istilah.join(", ")}` : `Tidak ada pasal yang memuat ${istilah.join(" dan ")}`;
    tombolBersih.classList.remove("sembunyi");
  }
  cariDalam.addEventListener("input", tunda(terapkan, 200));
  tombolBersih.addEventListener("click", () => {
    cariDalam.value = "";
    terapkan();
  });

  // Dari hasil pencarian: tandai istilah kueri tanpa menyembunyikan pasal lain.
  if (q) {
    const istilah = istilahDariKueri(q);
    queueMicrotask(() => {
      let n = 0;
      for (const { el } of indeks) n += tandaiIstilah(el, istilah);
      if (n) {
        status.textContent = `${angka(n)} kemunculan “${istilah.join(" ")}” ditandai`;
        tombolBersih.classList.remove("sembunyi");
        tombolBersih.onclick = () => {
          hapusTanda(daftar);
          cariDalam.value = "";
          tombolBersih.classList.add("sembunyi");
          status.textContent = "";
        };
      }
    });
  }

  const nomorPasal = h(
    "div",
    { class: "daftar-pasal-nomor" },
    kelompok.map((g) => h("a", { href: `#${g.jangkar}`, "aria-label": `Pasal ${g.nomor}` }, g.nomor)),
  );

  return h(
    "div",
    null,
    h("div", { class: "cari-dalam" }, cariDalam, tombolBersih, status),
    kelompok.length > 1 ? h("details", { class: "toc" }, h("summary", null, `Daftar pasal (${angka(kelompok.length)})`), nomorPasal) : null,
    daftar,
  );
}

/**
 * Panel "Relasi": daftar relasi tercatat dan peta relasi dua arah.
 * @param {Detail} d
 * @param {import("../router.js").Konteks} ctx
 * @returns {Array<import("../dom.js").Anak>}
 */
function panelRelasi(d, ctx) {
  const l = d.law;
  const urut = [...URUTAN_RELASI, ...d.relations.map((r) => r.jenis_relasi).filter((j) => !URUTAN_RELASI.includes(j))];
  const kelompok = [...new Set(urut)].map((jenis) => ({ jenis, daftar: d.relations.filter((r) => r.jenis_relasi === jenis) })).filter((k) => k.daftar.length);

  const daftarRelasi = kelompok.length
    ? kelompok.map((k) => [
        h("h3", { class: "relasi-jenis" }, `${labelRelasi(k.jenis)} (${k.daftar.length})`),
        h(
          "ul",
          { class: "daftar-relasi" },
          k.daftar.map((r) =>
            h(
              "li",
              null,
              r.judul && r.jenis
                ? [
                    h("a", { class: "sitasi", href: urlPeraturan(r.to_uri) }, `${r.jenis} ${r.nomor}/${r.tahun}`),
                    h("span", null, r.judul),
                    r.status ? lencanaStatus(r.status) : null,
                  ]
                : [
                    h("span", { class: "sitasi" }, r.keterangan || r.to_uri.split("/").slice(-3).join("/")),
                    h("span", { class: "redup" }, "belum ada di indeks Lexa"),
                  ],
            ),
          ),
        ),
      ])
    : [h("p", { class: "redup" }, "Belum ada relasi yang tercatat untuk peraturan ini.")];

  const petaWadah = h("div", { "aria-live": "polite" });
  let kedalaman = 1;
  /** @type {AbortController | null} */
  let berjalan = null;
  ctx.saatKeluar(() => berjalan?.abort());

  async function muatPeta() {
    berjalan?.abort();
    berjalan = new AbortController();
    isi(petaWadah, h("div", { class: "kartu" }, kerangka(3)));
    try {
      const g = await api.graf(l.frbr_uri, kedalaman, berjalan.signal);
      isi(petaWadah, g.simpul.length > 1 ? buatGrafik(g) : h("p", { class: "redup" }, "Belum ada peraturan lain yang terhubung."));
    } catch (e) {
      if (!dibatalkan(e)) isi(petaWadah, kotakGalat(e, muatPeta));
    }
  }

  const pilihanKedalaman = h(
    "div",
    { class: "baris", style: { margin: "6px 0 12px" } },
    [1, 2].map((n) =>
      h("button", {
        type: "button",
        class: ["tombol", "tombol-kecil", n === kedalaman ? "aktif" : ""].filter(Boolean).join(" "),
        "aria-pressed": String(n === kedalaman),
        onclick: (/** @type {MouseEvent} */ e) => {
          kedalaman = n;
          for (const b of pilihanKedalaman.querySelectorAll("button")) {
            b.classList.toggle("aktif", b === e.currentTarget);
            b.setAttribute("aria-pressed", String(b === e.currentTarget));
          }
          muatPeta();
        },
      }, n === 1 ? "Langsung" : "Dua lapis"),
    ),
  );
  void muatPeta();

  return [
    ...daftarRelasi,
    h("h2", { style: { marginTop: "28px" } }, ikon("peta"), " Peta relasi"),
    h("p", { class: "redup" }, "Termasuk peraturan yang menunjuk ke peraturan ini, bukan hanya yang ditunjuknya."),
    pilihanKedalaman,
    petaWadah,
  ];
}

/**
 * Panel "Naskah": tautan resmi, PDF yang diarsipkan, dan teks hasil konversi.
 * @param {Detail} d
 * @param {import("../router.js").Konteks} ctx
 * @param {{ nilai: import("../api.js").StatusDokumen | null, galat: unknown, selesai: boolean, saatSelesai: Array<() => void> }} info
 */
function panelNaskah(d, ctx, info) {
  const wadah = h("div");
  const teksWadah = h("div", { "aria-live": "polite" });

  function gambar() {
    const st = info.nilai;
    const bpk = tautanAman(d.bpk_url);
    isi(
      wadah,
      h(
        "div",
        { class: "tumpuk" },
        h("div", { class: "kartu" }, h("h3", { class: "kartu-judul" }, "Naskah resmi"), bpk ? h("p", null, "Rujukan yang berlaku adalah naskah di situs resmi BPK.") : h("p", { class: "redup" }, "Tautan ke naskah resmi belum diketahui untuk peraturan ini."), bpk ? h("a", { class: "tombol", href: bpk, target: "_blank", rel: "noopener noreferrer" }, ikon("luar"), h("span", null, "Buka di peraturan.bpk.go.id")) : null),
        h(
          "div",
          { class: "kartu" },
          h("h3", { class: "kartu-judul" }, "Salinan di Lexa"),
          !info.selesai
            ? kerangka(2)
            : info.galat
              ? kotakGalat(info.galat)
              : [
                  st?.ada_pdf && st.pdf_url ? h("p", null, h("a", { class: "tombol", href: st.pdf_url, target: "_blank", rel: "noopener" }, ikon("unduh"), h("span", null, "Buka PDF"))) : h("p", { class: "redup" }, "Berkas PDF peraturan ini belum diarsipkan di Lexa."),
                  st?.ada_teks && st.teks_url
                    ? h("p", null, h("button", { type: "button", class: "tombol", onclick: muatTeks }, "Lihat teks hasil konversi"))
                    : h("p", { class: "redup" }, "Teks hasil konversi belum tersedia."),
                  teksWadah,
                ],
        ),
      ),
    );
  }

  async function muatTeks() {
    isi(teksWadah, kerangka(4));
    try {
      const teks = await api.teksDokumen(d.law.frbr_uri, ctx.sinyal);
      isi(
        teksWadah,
        peringatan("info", h("p", null, "Teks ini hasil konversi otomatis dari PDF dan dapat mengandung kesalahan. Untuk kebutuhan resmi, rujuk naskah asli.")),
        h("pre", { class: "teks-naskah", tabindex: "0", "aria-label": "Teks hasil konversi" }, teks),
      );
    } catch (e) {
      if (!dibatalkan(e)) isi(teksWadah, kotakGalat(e, muatTeks));
    }
  }

  gambar();
  if (!info.selesai) info.saatSelesai.push(gambar);
  return wadah;
}
