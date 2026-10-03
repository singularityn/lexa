// @ts-check
import { h, hapusTanda, isi, salin, tandaiIstilah, tunda } from "../dom.js";
import { api, dibatalkan, GalatApi } from "../api.js";
import {
  angka, bacaIsiPasal, bersihkanArtefak, istilahDariKueri, jangkarDariId, judulRingkas, kelompokkanPasal, labelJenis, labelRelasi,
  hitungPasal, namaLengkap, namaPasal, nomorTahun, pecahBidang, pecahRujukan, pratinjauPeraturan, queryString, rapikanHuruf, sitasi, sitasiPasal, tanggalIndonesia, teksPasal, ukuranBerkas, urlPeraturan, URUTAN_RELASI,
} from "../format.js";
import { bacaPref, HURUF, simpanPref, terapkanPref, UKURAN } from "../bacaan.js";
import { buatDaftarIsi } from "../komponen/daftarIsi.js";
import { ikon } from "../komponen/ikon.js";
import { bukaLembar, bukaLembarAksi } from "../komponen/lembar.js";
import { toast } from "../komponen/toast.js";
import { tombolTandai } from "../komponen/tombolTandai.js";
import { bukaDialogLaporan } from "../komponen/dialogLaporan.js";
import { buatGrafik } from "../komponen/grafik.js";
import { GalatLuring, luring, luringDidukung } from "../luring.js";
import { pantau } from "../state.js";
import { riwayat } from "../riwayat.js";
import { halamanKosong, keadaanKosong, kerangka, kotakGalat, lencanaStatus, peringatan, tombolIkon } from "../komponen/umum.js";

/**
 * "13 / 2003"; POJK lama bernomor slug ditulis resmi ("48/POJK.04/2016", tahun sudah di dalamnya).
 * @param {{ jenis: string, nomor: string, tahun: number }} l
 */
const nomorResmi = (l) => {
  const resmi = nomorTahun(l.jenis, l.nomor, l.tahun);
  return resmi === `${l.nomor}/${l.tahun}` ? `${l.nomor} / ${l.tahun}` : resmi;
};

/**
 * Relasi yang peraturan tujuannya ada di indeks selalu punya jenis, nomor, dan tahun
 * (kolom NOT NULL di tabel laws); tipe relasi menganggapnya bisa null karena LEFT JOIN.
 * @param {import("../../../src/shared/types").Relation} r
 */
const sitasiRelasi = (r) => sitasi({ jenis: r.jenis ?? "", nomor: r.nomor ?? "", tahun: r.tahun ?? 0 });

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

/** Lembar bagikan bawaan perangkat (ponsel dan sebagian peramban desktop). Tanpa itu, tombol Bagikan tidak ditampilkan. */
const bisaBagikan = typeof navigator.share === "function";

/**
 * Buka lembar bagikan perangkat. Dibatalkan pengguna bukan galat; kegagalan lain diberi tahu dengan jalan keluar.
 * @param {{ teks: string, url: string }} isi
 */
async function bagikan({ teks, url }) {
  try {
    await navigator.share({ text: teks, url });
  } catch (e) {
    if (!(e instanceof DOMException && e.name === "AbortError")) toast("Berbagi gagal. Coba salin tautannya.", { galat: true });
  }
}

/** Potong di batas kata dan beri elipsis. @param {string} teks @param {number} maks */
function potongTeks(teks, maks) {
  const rapat = teks.replace(/\s+/g, " ").trim();
  if (rapat.length <= maks) return rapat;
  return `${rapat.slice(0, maks).replace(/\s+\S*$/, "")}…`;
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
  const topik = judulRingkas(l.judul);
  const kelompok = kelompokkanPasal(d.articles);
  riwayat.catatDilihat({ uri: l.frbr_uri, sitasi: nama, judul: l.judul });
  const halaman = pratinjauPeraturan(l);
  ctx.setJudul(halaman.judul, halaman.deskripsi);

  const aksiRelasi = (/** @type {string} */ jenis) => d.relations.filter((r) => r.jenis_relasi === jenis);
  const pengganti = [...aksiRelasi("dicabut_oleh"), ...aksiRelasi("diubah_oleh")];

  const spanduk = (() => {
    if (l.status === "berlaku") return null;
    const dicabut = l.status === "dicabut";
    return peringatan(
      dicabut ? "dicabut" : "diubah",
      h("p", null, h("strong", null, dicabut ? "Peraturan ini berstatus dicabut" : "Peraturan ini telah diubah"), dicabut ? ", sehingga ketentuannya mungkin tidak lagi berlaku." : "; ketentuannya mungkin sudah berbeda dari teks di bawah."),
      pengganti.length
        ? h("p", null, `${dicabut ? "Dicabut" : "Diubah"} oleh: `, pengganti.map((r, i) => [i ? ", " : "", r.judul && r.jenis ? h("a", { href: urlPeraturan(r.to_uri) }, sitasiRelasi(r)) : (r.keterangan ?? r.to_uri)]))
        : h("p", null, "Periksa tab Relasi untuk peraturan yang mengubah atau mencabutnya."),
    );
  })();

  // Status dokumen (PDF/teks) dimuat di latar belakang; hasilnya dipakai tombol PDF, menu Lainnya, dan tab Naskah.
  /** @type {{ nilai: import("../api.js").StatusDokumen | null, galat: unknown, selesai: boolean, saatSelesai: Array<() => void> }} */
  const infoStatus = { nilai: null, galat: null, selesai: false, saatSelesai: [] };
  const tombolPdf = h("a", { class: "tombol sembunyi", target: "_blank", rel: "noopener" }, ikon("unduh"), h("span", null, "PDF"));
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

  // --- Simpan untuk luring ----------------------------------------------------
  // Salinan peraturan ini di perangkat (Cache API), tidak ikut terbuang oleh cache baca; lihat luring.js.
  const luringBisa = luringDidukung();
  let luringAda = false;
  const lencanaLuring = h("span", { class: "lencana-luring", hidden: true }, ikon("centang"), "Tersedia luring");
  const tombolLuring = luringBisa
    ? /** @type {HTMLButtonElement} */ (tombolIkon("simpanLuring", "Simpan luring", { "aria-pressed": "false", title: "Simpan agar terbaca tanpa jaringan" }))
    : null;
  const segarkanLuring = async () => {
    luringAda = await luring.tersimpan(l.frbr_uri);
    lencanaLuring.hidden = !luringAda;
    if (!tombolLuring) return;
    tombolLuring.setAttribute("aria-pressed", String(luringAda));
    tombolLuring.classList.toggle("aktif", luringAda);
    const teks = tombolLuring.querySelector("span");
    if (teks) teks.textContent = luringAda ? "Tersimpan luring" : "Simpan luring";
  };
  const alihkanLuring = async () => {
    try {
      if (luringAda) {
        await luring.hapus(l.frbr_uri);
        toast("Dihapus dari simpanan luring.");
      } else {
        const ukuran = await luring.simpan(l.frbr_uri, { sitasi: nama, judul: l.judul });
        toast(`Tersimpan untuk dibaca luring (${ukuranBerkas(ukuran)}).`);
      }
    } catch (e) {
      toast(e instanceof GalatLuring ? e.message : "Simpanan luring gagal diubah.", { galat: true });
    }
    await segarkanLuring();
  };
  tombolLuring?.addEventListener("click", alihkanLuring);
  if (luringBisa) {
    void segarkanLuring();
    ctx.saatKeluar(pantau("luring", () => void segarkanLuring()));
  }

  // --- Aksi -----------------------------------------------------------------
  // Layar lebar: semua aksi berjajar. Ponsel: Simpan dan Salin sitasi, sisanya di lembar "Lainnya".
  const bpk = tautanAman(d.bpk_url);
  const salinSitasi = async () => toast((await salin(nama)) ? `Disalin: ${nama}` : "Penyalinan gagal");
  const salinTautan = async () => toast((await salin(location.origin + urlPeraturan(l.frbr_uri))) ? "Tautan disalin." : "Penyalinan gagal");
  const lapor = () => bukaDialogLaporan({ uri: l.frbr_uri, sitasi: nama });
  const bagikanPeraturan = () => bagikan({ teks: `${nama} tentang ${topik}`, url: location.origin + urlPeraturan(l.frbr_uri) });
  const cetak = () => window.print();

  const aksi = h(
    "div",
    { class: "aksi-bar" },
    tombolTandai({ uri: l.frbr_uri, sitasi: nama, judul: l.judul }, { denganTeks: true }),
    // Di ponsel labelnya menyusut menjadi "Sitasi" supaya tiga tombol utama muat sebaris; nama aksesibelnya tetap lengkap.
    h("button", { type: "button", class: "tombol", "aria-label": "Salin sitasi", onclick: salinSitasi }, ikon("salin"), h("span", { class: "teks-lebar" }, "Salin sitasi"), h("span", { class: "teks-sempit", "aria-hidden": "true" }, "Sitasi")),
    h(
      "span",
      { class: "aksi-lain" },
      tombolIkon("tautan", "Salin tautan", { onclick: salinTautan }),
      bisaBagikan ? tombolIkon("bagikan", "Bagikan", { onclick: bagikanPeraturan }) : null,
      tombolLuring,
      bpk ? h("a", { class: "tombol", href: bpk, target: "_blank", rel: "noopener noreferrer" }, ikon("luar"), h("span", null, "Naskah resmi (BPK)")) : null,
      tombolPdf,
      tombolIkon("bendera", "Laporkan kesalahan", { onclick: lapor }),
    ),
    h(
      "button",
      {
        type: "button",
        class: "tombol tombol-lainnya",
        "aria-haspopup": "dialog",
        onclick: () => {
          const pdf = infoStatus.nilai?.pdf_url ?? null;
          bukaLembarAksi({
            judul: nama,
            aksi: [
              { ikon: "bagikan", label: "Bagikan…", keterangan: "Kirim lewat WhatsApp, Telegram, dan lainnya", saat: bagikanPeraturan, tampil: bisaBagikan },
              { ikon: "tautan", label: "Salin tautan", saat: salinTautan },
              { ikon: "luar", label: "Naskah resmi (BPK)", keterangan: "peraturan.bpk.go.id", href: bpk, tampil: Boolean(bpk) },
              { ikon: "unduh", label: "Buka PDF", keterangan: "Salinan yang diarsipkan Lexa", href: pdf, tampil: Boolean(pdf) },
              {
                ikon: "simpanLuring",
                label: luringAda ? "Hapus dari simpanan luring" : "Simpan untuk dibaca luring",
                keterangan: luringAda ? "Tidak lagi tersedia tanpa jaringan" : "Teksnya tetap terbaca tanpa sinyal",
                saat: alihkanLuring,
                tampil: luringBisa,
              },
              { ikon: "cetak", label: "Cetak atau simpan PDF", keterangan: "Seluruh teks peraturan ini", saat: cetak },
              { ikon: "bendera", label: "Laporkan kesalahan", saat: lapor },
            ],
          });
        },
      },
      ikon("lainnya"),
      h("span", null, "Lainnya"),
    ),
  );

  // --- Keterangan -----------------------------------------------------------
  const bidang = pecahBidang(l.bidang);
  const polos = (/** @type {string} */ t) => t.toLowerCase().replace(/\s+/g, " ").trim();
  // "Tentang" hanya berguna bila memuat sesuatu yang tidak sudah ada di judul atau bidang.
  const tentang = l.tentang && ![l.judul, topik, l.bidang ?? ""].some((x) => polos(x) === polos(/** @type {string} */ (l.tentang))) ? rapikanHuruf(l.tentang) : null;
  const metadata = h(
    "dl",
    { class: "metadata" },
    ...[
      ["Jenis", labelJenis(l.jenis)],
      ["Nomor / tahun", nomorResmi(l)],
      l.tanggal_penetapan ? ["Ditetapkan", tanggalIndonesia(l.tanggal_penetapan)] : null,
      l.tanggal_berlaku ? ["Berlaku", tanggalIndonesia(l.tanggal_berlaku)] : null,
      l.instansi ? ["Instansi", l.instansi] : null,
      bidang.length ? ["Bidang", h("span", { class: "tautan-bidang" }, bidang.map((b) => h("a", { href: `/telusuri${queryString({ bidang: b.nama })}` }, b.label)))] : null,
      tentang ? ["Tentang", tentang] : null,
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
  const isiPanel = panelIsi(ctx, d, q, kelompok);
  /** @type {Record<string, HTMLElement>} */
  const panel = {
    isi: h("div", { role: "tabpanel", id: "panel-isi", "aria-labelledby": "tab-isi" }, isiPanel.el),
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
    isiPanel.saatTabBerubah(kunci === "isi");
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

  const jumlahPasal = hitungPasal(kelompok);
  const adaPenjelasan = kelompok.some((g) => g.penjelasan);
  const kepala = h(
    "header",
    { class: "kepala-peraturan" },
    h(
      "nav",
      { class: "remah", "aria-label": "Remah roti" },
      h("ol", null, h("li", null, h("a", { href: "/" }, "Beranda")), h("li", null, h("a", { href: "/telusuri" }, "Telusuri")), h("li", null, h("a", { href: `/telusuri${queryString({ jenis: l.jenis })}` }, labelJenis(l.jenis))), h("li", { "aria-current": "page" }, nama)),
    ),
    h("p", { class: "kicker" }, namaLengkap(l)),
    h("h1", { class: "judul-peraturan" }, topik),
    h(
      "div",
      { class: "meta-baris" },
      lencanaStatus(l.status),
      jumlahPasal ? h("span", { class: "redup" }, `${angka(jumlahPasal)} pasal${adaPenjelasan ? " dan penjelasannya" : ""}`) : null,
      lencanaLuring,
      l.tanggal_penetapan ? h("span", { class: "redup" }, `Ditetapkan ${tanggalIndonesia(l.tanggal_penetapan)}`) : null,
    ),
  );

  isi(
    ctx.akar,
    kepala,
    spanduk,
    aksi,
    l.ringkasan ? kartuRingkasan(l.ringkasan) : null,
    h("details", { class: "info-peraturan" }, h("summary", null, "Informasi peraturan"), metadata),
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
 * Ringkasan AI: empat baris dulu, selengkapnya atas permintaan (ringkasan bisa sepanjang satu layar ponsel).
 * @param {string} teks
 */
function kartuRingkasan(teks) {
  const p = h("p", { class: "terpotong" }, teks);
  const panjang = teks.length > 240;
  const tombol = panjang
    ? h(
        "button",
        {
          type: "button",
          class: "tombol-teks",
          "aria-expanded": "false",
          onclick: () => {
            const terbuka = p.classList.toggle("terpotong") === false;
            tombol?.setAttribute("aria-expanded", String(terbuka));
            if (tombol) tombol.textContent = terbuka ? "Lebih sedikit" : "Selengkapnya";
          },
        },
        "Selengkapnya",
      )
    : null;
  if (!panjang) p.classList.remove("terpotong");
  return h("section", { class: "kartu ringkasan-ai", "aria-label": "Ringkasan" }, h("span", { class: "label" }, "Ringkasan otomatis (dibuat AI, periksa pasal aslinya)"), p, tombol);
}

/**
 * Pasal yang bisa dituju dari rujukan di dalam teks: nomor pasal (huruf kecil) ke jangkar pasalnya, dan jangkar ayat yang ada.
 * Hanya batang tubuh; nomor kembar akibat salah deteksi memakai kemunculan pertama.
 * @param {ReturnType<typeof kelompokkanPasal>} kelompok
 */
function petaRujukan(kelompok) {
  /** @type {Map<string, string>} */
  const pasal = new Map();
  /** @type {Set<string>} */
  const ayat = new Set();
  for (const g of kelompok) {
    const kunci = g.nomor.toLowerCase();
    if (g.penjelasan || pasal.has(kunci)) continue;
    pasal.set(kunci, g.jangkar);
    for (const b of g.butir) if (b.ayat !== null) ayat.add(jangkarDariId(b.id));
  }
  return { pasal, ayat };
}

/**
 * Teks dengan rujukan "Pasal N [ayat (M)]" ke pasal di peraturan yang sama diubah menjadi tautan jangkar.
 * @param {string} teks
 * @param {ReturnType<typeof petaRujukan>} peta
 * @returns {Array<string | HTMLElement>}
 */
function denganRujukan(teks, peta) {
  return pecahRujukan(teks).map((bagian) => {
    if (typeof bagian === "string") return bagian;
    const dasar = peta.pasal.get(bagian.nomor.toLowerCase());
    if (!dasar) return bagian.teks;
    const jangkarAyat = bagian.ayat ? `${dasar}-ayat-${bagian.ayat}` : null;
    const tujuan = jangkarAyat && peta.ayat.has(jangkarAyat) ? jangkarAyat : dasar;
    return h("a", { class: "rujukan", href: `#${tujuan}` }, bagian.teks);
  });
}

/**
 * @param {ReturnType<typeof bacaIsiPasal>[number]} b
 * @param {ReturnType<typeof petaRujukan>} peta
 */
function renderBlok(b, peta) {
  if (b.tipe === "butir") {
    return h("div", { class: ["butir", b.tingkat === 2 ? "butir-2" : ""] }, h("span", { class: "no" }, b.penanda), h("span", { class: "isi" }, ...denganRujukan(b.teks, peta)));
  }
  return h("p", { class: b.tipe === "label" ? "isi-pasal label-bagian" : "isi-pasal" }, ...(b.tipe === "label" ? [b.teks] : denganRujukan(b.teks, peta)));
}

/**
 * Panel "Isi": pasal, daftar isi, pencarian di dalam peraturan, dan pengaturan tampilan teks.
 * @param {import("../router.js").Konteks} ctx
 * @param {Detail} d
 * @param {string} q
 * @param {ReturnType<typeof kelompokkanPasal>} kelompok
 * @returns {{ el: HTMLElement, saatTabBerubah: (aktif: boolean) => void }}
 */
function panelIsi(ctx, d, q, kelompok) {
  const l = d.law;
  const nama = sitasi(l);
  if (!d.articles.length) {
    return {
      el: keadaanKosong(
        "Teks pasal belum tersedia di Lexa",
        h("p", null, "Metadata peraturan ini sudah ada, tetapi isinya belum diekstrak. Naskah lengkap tersedia di situs resmi."),
        d.bpk_url ? h("a", { class: "tombol tombol-utama", href: d.bpk_url, target: "_blank", rel: "noopener noreferrer" }, "Buka naskah resmi (BPK)") : null,
      ),
      saatTabBerubah() {},
    };
  }

  const daftar = h("div", { class: "isi-peraturan" });
  terapkanPref(daftar);
  const peta = petaRujukan(kelompok);
  /** @type {Array<{ el: HTMLElement, teks: string, jangkar: string, nama: string }>} */
  const indeks = [];

  for (const g of kelompok) {
    // Penjelasan (pasal demi pasal) memakai ulang nomor batang tubuh; ia diberi judul sendiri, tanpa BAB.
    if (g.penjelasanBaru) daftar.appendChild(h("h2", { class: "bab", id: "penjelasan" }, "Penjelasan"));
    else if (!g.penjelasan && g.babBaru && g.bab) daftar.appendChild(h("h2", { class: "bab", id: `bab-${indeks.length}` }, g.bab));
    if (!g.penjelasan && g.bagianBaru && g.bagian) daftar.appendChild(h("h3", { class: "bagian-uu" }, g.bagian));

    const satuTeks = g.butir.length === 1 && g.butir[0].ayat === null;
    const namaPs = namaPasal(g);
    const sitasiPs = g.penjelasan ? `${nama} ${namaPs}` : sitasiPasal(l, g.nomor);
    const salinTeks = async () => toast((await salin(`${sitasiPs}\n${teksPasal(g, { kepala: false })}`)) ? `Disalin: ${sitasiPs}` : "Penyalinan gagal");
    const salinSitasiPasal = async () => toast((await salin(sitasiPs)) ? `Disalin: ${sitasiPs}` : "Penyalinan gagal");
    const salinTautanPasal = async () => toast((await salin(location.origin + urlPeraturan(l.frbr_uri, { jangkar: g.jangkar }))) ? "Tautan disalin." : "Penyalinan gagal");
    const bagikanPasal = () =>
      bagikan({ teks: `${sitasiPs}: ${potongTeks(teksPasal(g, { kepala: false }), 160)}`, url: location.origin + urlPeraturan(l.frbr_uri, { jangkar: g.jangkar }) });
    const laporPasal = () => bukaDialogLaporan({ uri: l.frbr_uri, sitasi: nama, konteks: namaPs });

    // Pasal disimpan ke koleksi dengan alamat peraturan + jangkar pasalnya (`/akn/id/act/uu/2003/13#pasal-82`).
    const tandaiPasal = tombolTandai({ uri: `${l.frbr_uri}#${g.jangkar}`, sitasi: sitasiPs, judul: l.judul });
    // Perangkat dengan penunjuk halus: tiga ikon yang muncul saat disorot. Layar sentuh: satu tombol "⋯" ke lembar aksi.
    const aksiPasal = h(
      "span",
      { class: "pasal-aksi" },
      h("button", { type: "button", class: "tombol tombol-kecil tombol-hantu tombol-ikon", title: "Salin sitasi", "aria-label": `Salin sitasi ${namaPs}`, onclick: salinSitasiPasal }, ikon("salin")),
      h("button", { type: "button", class: "tombol tombol-kecil tombol-hantu tombol-ikon", title: "Salin tautan ke pasal ini", "aria-label": `Salin tautan ${namaPs}`, onclick: salinTautanPasal }, ikon("tautan")),
      h("button", { type: "button", class: "tombol tombol-kecil tombol-hantu tombol-ikon", title: "Laporkan kesalahan pasal ini", "aria-label": `Laporkan kesalahan ${namaPs}`, onclick: laporPasal }, ikon("bendera")),
    );
    const lainnyaPasal = h(
      "button",
      {
        type: "button",
        class: "tombol tombol-kecil tombol-hantu tombol-ikon pasal-lainnya",
        "aria-haspopup": "dialog",
        "aria-label": `Aksi untuk ${namaPs}`,
        onclick: () =>
          bukaLembarAksi({
            judul: sitasiPs,
            aksi: [
              { ikon: "bagikan", label: "Bagikan pasal ini", keterangan: "Kirim lewat WhatsApp, Telegram, dan lainnya", saat: bagikanPasal, tampil: bisaBagikan },
              { ikon: "salin", label: "Salin teks pasal", keterangan: "Dengan sitasinya", saat: salinTeks },
              { ikon: "salin", label: "Salin sitasi", keterangan: sitasiPs, saat: salinSitasiPasal },
              { ikon: "tautan", label: "Salin tautan ke pasal ini", saat: salinTautanPasal },
              { ikon: "bendera", label: "Laporkan kesalahan", saat: laporPasal },
            ],
          }),
      },
      ikon("lainnya"),
    );

    const el = h(
      "article",
      { class: "pasal", id: g.jangkar },
      // Penanda pasal selalu terlihat (juga di layar sentuh); aksi lain muncul saat disorot atau lewat tombol "⋯".
      h("div", { class: "pasal-kepala" }, h("h3", null, namaPs), h("div", { class: "pasal-alat" }, tandaiPasal, aksiPasal, lainnyaPasal)),
      g.judul ? h("p", { class: "pasal-judul" }, g.judul) : null,
      satuTeks
        ? bacaIsiPasal(g.butir[0].isi).map((blok) => renderBlok(blok, peta))
        : g.butir.map((b) =>
            b.ayat === null
              ? bacaIsiPasal(b.isi).map((blok) => renderBlok(blok, peta))
              : h("div", { class: "ayat", id: jangkarDariId(b.id) }, h("span", { class: "no" }, `(${b.ayat})`), h("div", { class: "isi" }, bacaIsiPasal(b.isi).map((blok) => renderBlok(blok, peta)))),
          ),
    );
    daftar.appendChild(el);
    indeks.push({ el, teks: `${namaPs} ${g.judul ?? ""} ${g.butir.map((b) => bersihkanArtefak(b.isi)).join(" ")}`.toLowerCase(), jangkar: g.jangkar, nama: namaPs });
  }

  // --- Pencarian di dalam peraturan --------------------------------------
  const status = h("span", { class: "redup", role: "status", "aria-live": "polite" });
  const cariDalam = /** @type {HTMLInputElement} */ (
    h("input", { class: "input", type: "search", placeholder: "Cari kata di dalam peraturan ini…", "aria-label": "Cari di dalam peraturan ini", enterkeyhint: "search", value: q })
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

  // --- Daftar isi dan tampilan teks ----------------------------------------
  /** @param {string} jangkar */
  const keJangkarPasal = (jangkar) => {
    if (location.hash === `#${jangkar}`) ctx.keJangkar();
    else location.hash = jangkar;
  };
  const daftarIsi = kelompok.length > 1 ? buatDaftarIsi({ kelompok, keJangkar: keJangkarPasal }) : null;

  const tombolTampilan = h(
    "button",
    { type: "button", class: "tombol tombol-kecil", "aria-haspopup": "dialog", onclick: () => bukaPengaturanTampilan(daftar) },
    ikon("teks"),
    "Tampilan teks",
  );

  const alat = h(
    "div",
    { class: "alat-baca" },
    h("div", { class: "cari-dalam" }, cariDalam, tombolBersih, status),
    h("div", { class: "alat-baca-tombol" }, daftarIsi?.tombol ?? null, tombolTampilan),
  );

  const isiBaca = h("div", { class: "isi-baca" }, daftar);
  const lanjut = buatLanjutBaca(l.frbr_uri, indeks, { tanpa: Boolean(location.hash) || Boolean(q), keJangkar: keJangkarPasal });
  const akar = h("div", { class: ["baca-tata", daftarIsi ? "dengan-daftar-isi" : ""] }, daftarIsi?.el ?? null, h("div", { class: "baca-utama" }, lanjut, alat, isiBaca), daftarIsi?.tombolMengambang ?? null);
  pantauPosisiBaca(ctx, l.frbr_uri, daftar, indeks);

  // Tombol mengambang "Daftar isi" muncul bila bilah alat sudah tergulir ke atas layar.
  let panelAktif = true;
  let alatTerlewati = false;
  const perbaruiMengambang = () => daftarIsi?.tampilkanMengambang(panelAktif && alatTerlewati);
  if (daftarIsi) {
    const pengamat = new IntersectionObserver(([e]) => {
      alatTerlewati = !e.isIntersecting && e.boundingClientRect.bottom < 0;
      perbaruiMengambang();
    });
    pengamat.observe(alat);
    ctx.saatKeluar(() => pengamat.disconnect());
  }

  return {
    el: akar,
    saatTabBerubah(aktif) {
      panelAktif = aktif;
      perbaruiMengambang();
    },
  };
}

/** Pasal yang dilewati dulu sebelum "Lanjutkan membaca" ditawarkan; di awal peraturan tawaran itu tak berguna. */
const PASAL_AWAL = 3;

/**
 * Tawaran "Lanjutkan membaca" bila peraturan ini pernah dibaca sampai jauh di perangkat ini.
 * Tidak ditawarkan bila pembaca datang dengan tautan ke pasal tertentu atau dari hasil pencarian.
 * @param {string} uri
 * @param {Array<{ el: HTMLElement, jangkar: string, nama: string }>} indeks
 * @param {{ tanpa: boolean, keJangkar: (jangkar: string) => void }} opsi
 * @returns {HTMLElement | null}
 */
function buatLanjutBaca(uri, indeks, { tanpa, keJangkar }) {
  if (tanpa) return null;
  const tersimpan = riwayat.posisi(uri);
  const urutan = tersimpan ? indeks.findIndex((e) => e.jangkar === tersimpan.jangkar) : -1;
  if (!tersimpan || urutan < PASAL_AWAL) return null;
  const kartu = h(
    "div",
    { class: "lanjut-baca", role: "region", "aria-label": "Lanjutkan membaca" },
    h("span", { class: "lanjut-teks" }, "Terakhir dibaca: ", h("strong", null, tersimpan.nama || indeks[urutan].nama)),
    h("button", { type: "button", class: "tombol tombol-kecil tombol-utama", onclick: () => { kartu.remove(); keJangkar(tersimpan.jangkar); } }, "Lanjutkan"),
    h("button", { type: "button", class: "tombol tombol-kecil tombol-hantu tombol-ikon", "aria-label": "Tutup tawaran lanjutkan membaca", onclick: () => kartu.remove() }, ikon("tutup")),
  );
  return kartu;
}

/**
 * Simpan pasal yang sedang berada di atas layar setelah gulir berhenti (di perangkat ini saja).
 * Pasal ditemukan dengan elementFromPoint di bawah tab lengket, tanpa pengamat per pasal.
 * @param {import("../router.js").Konteks} ctx
 * @param {string} uri
 * @param {HTMLElement} daftar
 * @param {Array<{ el: HTMLElement, jangkar: string, nama: string }>} indeks
 */
function pantauPosisiBaca(ctx, uri, daftar, indeks) {
  const simpanSekarang = () => {
    // Tab Relasi/Naskah aktif atau halaman sudah diganti: daftar tidak terlihat.
    if (!daftar.isConnected || daftar.offsetParent === null || window.scrollY < 300) return;
    const tab = document.querySelector(".tab-daftar");
    const kotak = daftar.getBoundingClientRect();
    const titik = document.elementFromPoint(kotak.left + Math.min(kotak.width / 2, 220), (tab ? tab.getBoundingClientRect().bottom : 100) + 28);
    const pasal = titik?.closest(".pasal");
    const entri = pasal ? indeks.find((e) => e.el === pasal) : undefined;
    if (entri) riwayat.catatPosisi(uri, { jangkar: entri.jangkar, nama: entri.nama });
  };
  const tertunda = tunda(simpanSekarang, 500);
  window.addEventListener("scroll", tertunda, { passive: true });
  window.addEventListener("pagehide", simpanSekarang);
  ctx.saatKeluar(() => {
    simpanSekarang();
    window.removeEventListener("scroll", tertunda);
    window.removeEventListener("pagehide", simpanSekarang);
  });
}

/**
 * Lembar pengaturan tampilan teks: ukuran dan jenis huruf, berlaku seketika pada teks di belakangnya.
 * @param {HTMLElement} teksEl
 */
function bukaPengaturanTampilan(teksEl) {
  const pref = bacaPref();
  const nama = h("span", { class: "nilai-ukuran" }, UKURAN[pref.ukuran]);
  const geser = /** @type {HTMLInputElement} */ (
    h("input", {
      type: "range",
      min: "0",
      max: String(UKURAN.length - 1),
      step: "1",
      value: String(pref.ukuran),
      "aria-label": "Ukuran huruf",
      oninput: () => {
        const baru = simpanPref({ ukuran: Number(geser.value) });
        nama.textContent = UKURAN[baru.ukuran];
        terapkanPref(teksEl, baru);
        contoh.dataset.ukuran = String(baru.ukuran);
      },
    })
  );
  const contoh = h("p", { class: "contoh-teks isi-peraturan", dataset: { ukuran: String(pref.ukuran), huruf: pref.huruf } }, "Pekerja perempuan berhak memperoleh istirahat selama 1,5 bulan sebelum saatnya melahirkan anak.");
  const pilihan = HURUF.map((nilai) =>
    h(
      "label",
      { class: "pilihan-huruf" },
      h("input", {
        type: "radio",
        name: "huruf-baca",
        value: nilai,
        checked: pref.huruf === nilai,
        onchange: () => {
          const baru = simpanPref({ huruf: nilai });
          terapkanPref(teksEl, baru);
          contoh.dataset.huruf = baru.huruf;
        },
      }),
      h("span", { class: nilai === "serif" ? "huruf-serif" : "huruf-sans" }, nilai === "serif" ? "Berkaki (klasik)" : "Tanpa kaki (bersih)"),
    ),
  );
  bukaLembar({
    judul: "Tampilan teks",
    isi: [
      h("div", { class: "baris-ukuran" }, h("span", { class: "huruf-kecil", "aria-hidden": "true" }, "A"), geser, h("span", { class: "huruf-besar", "aria-hidden": "true" }, "A")),
      h("p", { class: "bantu", role: "status" }, "Ukuran: ", nama),
      h("div", { class: "pilihan-huruf-grup", role: "radiogroup", "aria-label": "Jenis huruf" }, pilihan),
      contoh,
    ],
    kelas: "lembar-tampilan",
  });
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
                    h("a", { class: "sitasi", href: urlPeraturan(r.to_uri) }, sitasiRelasi(r)),
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
