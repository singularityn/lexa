// @ts-check
import { h, isi, salin, tunda, unduh } from "../dom.js";
import { GalatApi } from "../api.js";
import { judulRingkas, tanggalIndonesia, urlPeraturan } from "../format.js";
import { koleksi, pantau, sesi, siap } from "../state.js";
import { ikon } from "../komponen/ikon.js";
import { toast } from "../komponen/toast.js";
import { keadaanKosong, kerangka, peringatan } from "../komponen/umum.js";

/** @param {number} waktu */
function tanggal(waktu) {
  return tanggalIndonesia(new Date(waktu).toISOString().slice(0, 10));
}

/** @param {import("../router.js").Konteks} ctx */
export default async function halamanKoleksi(ctx) {
  ctx.setJudul("Koleksi", "Peraturan yang Anda simpan beserta catatan pribadi.");
  isi(ctx.akar, h("h1", null, "Koleksi"), h("div", { class: "kartu" }, kerangka(3)));
  await siap();
  if (ctx.sinyal.aborted) return;

  const daftar = h("div", { class: "tumpuk" });
  const aksi = h("div", { class: "baris" });

  /** @param {import("../state.js").Entri} e */
  function kartuEntri(e) {
    const catatan = /** @type {HTMLTextAreaElement} */ (
      h("textarea", { class: "input", rows: "2", maxlength: "2000", placeholder: "Catatan pribadi…", "aria-label": `Catatan untuk ${e.sitasi}` }, e.catatan ?? "")
    );
    const status = h("span", { class: "bantu", role: "status", "aria-live": "polite" });
    const simpanCatatan = tunda(async () => {
      try {
        await koleksi.simpan({ ...e, catatan: catatan.value });
        status.textContent = "Catatan tersimpan.";
      } catch (err) {
        status.textContent = err instanceof GalatApi ? err.message : "Catatan gagal disimpan.";
      }
    }, 700);
    catatan.addEventListener("input", () => {
      status.textContent = "Menyimpan…";
      simpanCatatan();
    });

    return h(
      "article",
      { class: "kartu entri-koleksi" },
      h("header", null, h("a", { class: "sitasi", href: urlPeraturan(e.uri) }, e.sitasi || e.uri), h("span", { class: "judul-entri" }, judulRingkas(e.judul))),
      catatan,
      h(
        "footer",
        null,
        h("span", { class: "bantu" }, `Disimpan ${tanggal(e.waktu)} · `, status),
        h("button", {
          type: "button",
          class: "tombol tombol-kecil",
          onclick: async () => {
            try {
              await koleksi.hapus(e.uri);
              toast("Dilepas dari koleksi.");
            } catch (err) {
              toast(err instanceof GalatApi ? err.message : "Gagal menghapus.", { galat: true });
            }
          },
        }, ikon("sampah"), "Lepas"),
      ),
    );
  }

  function gambar() {
    const entri = koleksi.daftar();
    isi(
      aksi,
      entri.length
        ? [
            h("button", { type: "button", class: "tombol tombol-kecil", onclick: async () => toast((await salin(entri.map((e) => `${e.sitasi} ${e.judul}`).join("\n"))) ? "Daftar sitasi disalin." : "Penyalinan gagal") }, ikon("salin"), "Salin daftar sitasi"),
            h("button", { type: "button", class: "tombol tombol-kecil", onclick: () => unduh("koleksi-lexa.json", JSON.stringify(entri.map(({ uri, sitasi, judul, catatan }) => ({ uri, sitasi, judul, catatan })), null, 2)) }, ikon("unduh"), "Unduh JSON"),
          ]
        : null,
    );
    isi(
      daftar,
      entri.length
        ? entri.map(kartuEntri)
        : keadaanKosong("Koleksi masih kosong", h("p", null, "Simpan peraturan dengan tombol penanda di hasil pencarian atau halaman peraturan. Catatan pribadi bisa ditambahkan di sini."), h("a", { class: "tombol tombol-utama", href: "/telusuri" }, "Telusuri peraturan")),
    );
  }

  const tamu = !sesi.data.masuk;
  isi(
    ctx.akar,
    h("h1", null, "Koleksi"),
    h("p", { class: "redup" }, "Peraturan yang Anda simpan, lengkap dengan catatan pribadi."),
    tamu
      ? peringatan(
          "info",
          h("p", null, h("strong", null, "Tersimpan di perangkat ini saja. "), sesi.data.login_tersedia ? ["Masuk dengan Google agar koleksi tersinkron ke perangkat lain. ", h("a", { href: "/akun" }, "Masuk")] : "Menghapus data peramban akan menghapus koleksi. Unduh salinannya bila perlu."),
        )
      : null,
    koleksi.galat ? h("div", { class: "galat", role: "alert" }, koleksi.galat) : null,
    aksi,
    h("div", { style: { marginTop: "14px" } }, daftar),
  );
  gambar();

  // Perubahan koleksi dari tempat lain (mis. tombol di halaman lain) langsung tercermin,
  // kecuali saat pengguna sedang mengetik catatan agar fokusnya tidak hilang.
  const berhenti = pantau("koleksi", () => {
    if (!daftar.isConnected) return berhenti();
    if (daftar.contains(document.activeElement) && document.activeElement instanceof HTMLTextAreaElement) return;
    gambar();
  });
  ctx.saatKeluar(berhenti);
}
