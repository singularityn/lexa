// @ts-check
import { h, isi } from "../dom.js";
import { api } from "../api.js";
import { angka, daftarBidang, daftarCakupan, judulRingkas, queryString, sitasi, urlPeraturan } from "../format.js";
import { ajakanPasang } from "../komponen/ajakanPasang.js";
import { ikon } from "../komponen/ikon.js";
import { jenisDariSitasi, kelasJenis } from "../komponen/jenis.js";
import { kotakCari } from "../komponen/kotakCari.js";
import { modeTersimpan } from "../komponen/pilihMode.js";
import { riwayat } from "../riwayat.js";

const MAKS_BIDANG = 10;
const MAKS_DILIHAT = 3;

/**
 * Baris peraturan ringkas: sitasi (berwarna menurut jenis) dan topiknya.
 * @param {{ frbr_uri: string, jenis: string, nomor: string, tahun: number, judul: string }} p
 */
function barisPeraturan(p) {
  return h(
    "li",
    { class: kelasJenis(p.jenis) },
    h("a", { href: urlPeraturan(p.frbr_uri) }, h("span", { class: "sitasi" }, sitasi(p)), h("span", { class: "judul" }, judulRingkas(p.judul))),
  );
}

/** @param {import("../router.js").Konteks} ctx */
export default async function beranda(ctx) {
  ctx.setJudul("Lexa", "Cari dan baca peraturan perundang-undangan Indonesia dengan pencarian sitasi, kata kunci, dan makna, serta tanya jawab yang selalu menyebut pasal sumbernya.");

  let mode = modeTersimpan();
  /** @param {string} q */
  const cari = (q) => ctx.pergi(`/cari${queryString({ q, mode: mode === "hybrid" ? null : mode })}`);
  // Pencarian terakhir tidak lagi berupa baris chip di beranda: muncul di daftar saran saat kotak cari difokuskan.
  const kotak = kotakCari({ ukuran: "besar", saatKirim: cari });

  const dilihat = riwayat.dilihat().slice(0, MAKS_DILIHAT);

  const terbaru = h("section", { class: "bagian sembunyi", "aria-labelledby": "h-terbaru" });
  const bidang = h("section", { class: "bagian sembunyi", "aria-labelledby": "h-bidang" });
  const info = h("p", { class: "info-indeks redup" });

  isi(
    ctx.akar,
    h(
      "div",
      { class: "beranda" },
      h(
        "section",
        { class: "hero" },
        h("h1", null, "Cari peraturan Indonesia"),
        kotak,
        // Jumlah dan cakupan indeks (diisi sesudah statistik tiba): pembaca perlu tahu jenis apa yang tak akan ditemukan di sini.
        info,
        h("a", { class: "tautan-tanya", href: "/tanya" }, ikon("tanya"), h("span", null, "Punya pertanyaan hukum? ", h("strong", null, "Tanya Lexa")), ikon("kanan")),
      ),
      ajakanPasang(),
      dilihat.length
        ? h(
            "section",
            { class: "bagian", "aria-labelledby": "h-dilihat" },
            h("h2", { id: "h-dilihat" }, "Terakhir dilihat"),
            h(
              "ul",
              { class: "daftar-ringkas kisi-lanjut" },
              dilihat.map((d) => {
                // Peraturan yang sudah dibaca cukup jauh dibuka langsung di pasal terakhir yang dibaca.
                const posisi = riwayat.posisi(d.uri);
                return h(
                  "li",
                  { class: kelasJenis(jenisDariSitasi(d.sitasi)) },
                  h(
                    "a",
                    { href: urlPeraturan(d.uri, { jangkar: posisi?.jangkar }) },
                    h("span", { class: "sitasi" }, d.sitasi),
                    h("span", { class: "judul" }, judulRingkas(d.judul)),
                    posisi?.nama ? h("span", { class: "lanjut-di" }, ikon("kanan"), `lanjut di ${posisi.nama}`) : null,
                  ),
                );
              }),
            ),
          )
        : null,
      h("div", { class: "dua-bagian" }, terbaru, bidang),
    ),
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
        ? "Indeks masih kosong: peraturan masuk lewat panen naskah resmi dari BPK."
        : `${angka(s.total_peraturan)} peraturan di indeks.`,
      s.cakupan?.length ? ` Cakupan saat ini: ${daftarCakupan(s.cakupan)}.` : null,
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
