// @ts-check
import { h, isi } from "../dom.js";
import { api, GalatApi } from "../api.js";
import { koleksi, sesi, siap } from "../state.js";
import { toast } from "../komponen/toast.js";
import { kartuPasang } from "../komponen/ajakanPasang.js";
import { ikon } from "../komponen/ikon.js";
import { kerangka, peringatan } from "../komponen/umum.js";
import { pergi } from "../navigasi.js";
import { riwayat } from "../riwayat.js";

const PESAN_GALAT = /** @type {Record<string, string>} */ ({
  parameter: "Google tidak mengirim data yang dibutuhkan. Silakan coba masuk lagi.",
  state: "Sesi masuk sudah kedaluwarsa atau tidak dikenali. Silakan mulai lagi.",
  token: "Google menolak pertukaran kode masuk. Silakan coba lagi.",
  verifikasi: "Identitas dari Google tidak dapat diverifikasi, sehingga Anda tidak dimasukkan.",
});

/** Riwayat (peraturan yang dibuka, kata yang dicari) hanya ada di perangkat ini; pengguna bisa menghapusnya. */
function kartuRiwayat() {
  const ringkas = h("p", { class: "redup" });
  const tombol = /** @type {HTMLButtonElement} */ (h("button", { type: "button", class: "tombol" }, ikon("sampah"), "Hapus riwayat di perangkat ini"));
  const gambar = () => {
    const n = riwayat.dilihat().length + riwayat.pencarian().length;
    ringkas.textContent = n
      ? `${riwayat.dilihat().length} peraturan yang terakhir dibuka dan ${riwayat.pencarian().length} kata yang terakhir dicari disimpan di perangkat ini. Tidak dikirim ke server.`
      : "Belum ada riwayat di perangkat ini. Peraturan yang Anda buka dan kata yang Anda cari akan tampil di beranda, dan tidak dikirim ke server.";
    tombol.disabled = n === 0;
  };
  tombol.addEventListener("click", () => {
    riwayat.hapusSemua();
    gambar();
    toast("Riwayat dihapus.");
  });
  gambar();
  return h("div", { class: "kartu", style: { marginTop: "16px" } }, h("h2", { class: "kartu-judul" }, "Riwayat"), ringkas, tombol);
}

/** Tautan yang di layar lebar ada di header/footer, tetapi tidak di bilah navigasi bawah ponsel. */
function kartuInformasi() {
  return h(
    "div",
    { class: "kartu", style: { marginTop: "16px" } },
    h("h2", { class: "kartu-judul" }, "Informasi"),
    h(
      "ul",
      { class: "daftar-tautan" },
      h("li", null, h("a", { href: "/tentang" }, "Tentang dan batasan Lexa")),
      h("li", null, h("a", { href: "/status" }, "Status data dan sinkronisasi")),
      h("li", null, h("a", { href: "https://peraturan.bpk.go.id", target: "_blank", rel: "noopener noreferrer" }, "Naskah resmi di peraturan.bpk.go.id")),
    ),
  );
}

/** @param {import("../router.js").Konteks} ctx */
export default async function akun(ctx) {
  ctx.setJudul("Akun");
  isi(ctx.akar, h("h1", null, "Akun"), h("div", { class: "kartu" }, kerangka(3)));
  await siap();
  if (ctx.sinyal.aborted) return;

  const galat = ctx.params.get("galat");
  const { masuk, pengguna, login_tersedia: tersedia } = sesi.data;

  const pesanGalat = galat ? peringatan("dicabut", h("p", null, PESAN_GALAT[galat] ?? "Masuk gagal. Silakan coba lagi.")) : null;

  if (!masuk || !pengguna) {
    isi(
      ctx.akar,
      h("div", { class: "prosa" },
        h("h1", null, "Akun"),
        pesanGalat,
        h("div", { class: "kartu" },
          h("h2", { class: "kartu-judul" }, "Anda memakai Lexa sebagai tamu"),
          h("p", null, "Semua fitur, termasuk pencarian, membaca pasal, tanya jawab, dan koleksi, berfungsi tanpa akun. Akun hanya menambah satu hal: koleksi dan riwayat tanya jawab Anda tersinkron antarperangkat."),
          tersedia
            ? [
                h("p", null, h("a", { class: "tombol tombol-utama", href: `/api/auth/google?kembali=${encodeURIComponent("/koleksi")}`, "data-luar": "" }, "Masuk dengan Google")),
                h("p", { class: "bantu" }, "Lexa hanya meminta identitas dasar (nama, email, foto), bukan akses ke Gmail atau Drive."),
              ]
            : h("p", { class: "redup" }, "Masuk dengan Google belum diaktifkan di instalasi ini. Mode tamu tetap berfungsi penuh."),
          koleksi.jumlah ? h("p", { class: "bantu" }, `${koleksi.jumlah} peraturan di koleksi perangkat ini akan dibawa ke akun saat Anda masuk.`) : null,
        ),
        h("div", { style: { marginTop: "16px" } }, kartuPasang()),
        kartuRiwayat(),
        kartuInformasi(),
      ),
    );
    return;
  }

  const nama = /** @type {HTMLInputElement} */ (h("input", { class: "input", id: "akun-nama", name: "nama", value: pengguna.nama ?? "", maxlength: "80", required: true, autocomplete: "name" }));
  const foto = /** @type {HTMLInputElement} */ (h("input", { class: "input", id: "akun-foto", name: "foto", type: "url", value: pengguna.foto_url ?? "", placeholder: "https://…", autocomplete: "off" }));
  const simpan = /** @type {HTMLButtonElement} */ (h("button", { type: "submit", class: "tombol tombol-utama" }, "Simpan perubahan"));
  const awal = (pengguna.nama || pengguna.email).slice(0, 1).toUpperCase();

  isi(
    ctx.akar,
    h("div", { class: "prosa" },
      h("h1", null, "Akun"),
      pesanGalat,
      h("div", { class: "kartu" },
        h("div", { class: "profil-kepala" },
          pengguna.foto_url ? h("img", { class: "avatar", src: pengguna.foto_url, alt: "", referrerpolicy: "no-referrer" }) : h("span", { class: "avatar-huruf", "aria-hidden": "true" }, awal),
          h("div", null, h("strong", null, pengguna.nama || "Tanpa nama"), h("div", { class: "redup" }, pengguna.email)),
        ),
        h("form", {
          class: "tumpuk",
          onsubmit: async (/** @type {SubmitEvent} */ e) => {
            e.preventDefault();
            simpan.disabled = true;
            try {
              await api.ubahProfil({ nama: nama.value, foto_url: foto.value.trim() || null });
              await sesi.muat();
              toast("Profil diperbarui.");
              pergi("/akun", { ganti: true });
            } catch (err) {
              toast(err instanceof GalatApi ? err.message : "Profil gagal diperbarui.", { galat: true });
              simpan.disabled = false;
            }
          },
        },
          h("div", null, h("label", { class: "bidang", for: "akun-nama" }, "Nama tampilan"), nama),
          h("div", null, h("label", { class: "bidang", for: "akun-foto" }, "URL foto (opsional)"), foto, h("p", { class: "bantu" }, "Harus berupa tautan http atau https.")),
          h("div", { class: "baris" }, simpan),
        ),
      ),
      h("div", { class: "kartu", style: { marginTop: "16px" } },
        h("h2", { class: "kartu-judul" }, "Keluar"),
        h("p", { class: "redup" }, "Sesi di perangkat ini diakhiri. Koleksi Anda tetap aman di akun."),
        h("button", {
          type: "button",
          class: "tombol",
          onclick: async () => {
            await sesi.keluar();
            toast("Anda sudah keluar.");
            pergi("/", { ganti: false });
          },
        }, "Keluar"),
      ),
      h("div", { style: { marginTop: "16px" } }, kartuPasang()),
      kartuRiwayat(),
      kartuInformasi(),
    ),
  );
}
