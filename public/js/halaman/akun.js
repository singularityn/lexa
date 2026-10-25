// @ts-check
import { h, isi, salin } from "../dom.js";
import { api, GalatApi } from "../api.js";
import { koleksi, sesi, siap } from "../state.js";
import { toast } from "../komponen/toast.js";
import { kartuPasang } from "../komponen/ajakanPasang.js";
import { ikon } from "../komponen/ikon.js";
import { kerangka, peringatan } from "../komponen/umum.js";
import { pergi } from "../navigasi.js";
import { ukuranBerkas, urlPeraturan } from "../format.js";
import { luring, luringDidukung } from "../luring.js";
import { riwayat } from "../riwayat.js";

const PESAN_GALAT = /** @type {Record<string, string>} */ ({
  parameter: "Google tidak mengirim data yang dibutuhkan. Silakan coba masuk lagi.",
  state: "Sesi masuk sudah kedaluwarsa atau tidak dikenali. Silakan mulai lagi.",
  token: "Google menolak pertukaran kode masuk. Silakan coba lagi.",
  verifikasi: "Identitas dari Google tidak dapat diverifikasi, sehingga Anda tidak dimasukkan.",
  ditolak: "Masuk dibatalkan, atau Google tidak mengizinkan akun itu masuk. Coba lagi, atau pakai akun Google lain.",
  google: "Google mengembalikan galat saat masuk. Silakan coba lagi.",
});

/**
 * Bantuan untuk PENGELOLA situs: bila Google menampilkan "Error 400: redirect_uri_mismatch", alamat pengalihan yang
 * dipakai Lexa belum terdaftar persis di Google Cloud Console. Halaman galat itu milik Google dan tidak mengembalikan
 * pengguna ke Lexa, jadi alamat yang benar ditampilkan di sini, sebelum masuk dicoba. Tertutup secara bawaan.
 * @param {string} uri
 */
function bantuanMasuk(uri) {
  return h(
    "details",
    { class: "istilah bantuan-masuk" },
    h("summary", null, "Pengelola situs: Google menampilkan “redirect_uri_mismatch”?"),
    h("p", { class: "bantu" }, "Alamat pengalihan di Google Cloud Console harus sama persis dengan yang dikirim Lexa (huruf, garis miring, dan https):"),
    h(
      "p",
      { class: "baris" },
      h("code", { class: "uri-callback" }, uri),
      h("button", { type: "button", class: "tombol tombol-kecil", onclick: async () => toast((await salin(uri)) ? "Alamat disalin." : "Penyalinan gagal") }, ikon("salin"), "Salin"),
    ),
    h(
      "ol",
      { class: "bantu" },
      h("li", null, "Buka Google Cloud Console > APIs & Services > Credentials, lalu pilih klien OAuth jenis “Web application” yang Client ID-nya terpasang di Lexa."),
      h("li", null, "Pada “Authorized redirect URIs”, tambahkan alamat di atas dan simpan. Perubahan bisa butuh beberapa menit."),
      h("li", null, "Bila situs dibuka lewat domain lain, daftarkan alamat untuk domain itu juga."),
    ),
  );
}

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
  return h("div", { class: "kartu" }, h("h2", { class: "kartu-judul" }, "Riwayat"), ringkas, tombol);
}

/** Peraturan yang disimpan untuk dibaca tanpa jaringan: daftar, ukuran, dan tombol hapus. */
function kartuLuring() {
  if (!luringDidukung()) return null;
  const ringkas = h("p", { class: "redup" }, "Memeriksa…");
  const daftar = h("ul", { class: "daftar-luring" });
  const hapusSemua = /** @type {HTMLButtonElement} */ (h("button", { type: "button", class: "tombol", hidden: true }, ikon("sampah"), "Hapus semua simpanan luring"));

  async function gambar() {
    const isiDaftar = await luring.daftar();
    const total = isiDaftar.reduce((n, e) => n + e.ukuran, 0);
    ringkas.textContent = isiDaftar.length
      ? `${isiDaftar.length} peraturan tersimpan di perangkat ini (${ukuranBerkas(total)}) dan bisa dibaca tanpa jaringan.`
      : "Belum ada. Pilih “Simpan untuk dibaca luring” di halaman peraturan agar teksnya terbaca tanpa sinyal.";
    hapusSemua.hidden = isiDaftar.length === 0;
    isi(
      daftar,
      isiDaftar.map((e) =>
        h(
          "li",
          null,
          h("a", { href: urlPeraturan(e.uri) }, e.sitasi || e.uri, e.judul ? h("span", { class: "redup" }, ` ${e.judul}`) : null),
          h("span", { class: "bantu" }, ukuranBerkas(e.ukuran)),
          h("button", {
            type: "button",
            class: "tombol tombol-kecil",
            "aria-label": `Hapus ${e.sitasi || e.uri} dari simpanan luring`,
            onclick: async () => {
              await luring.hapus(e.uri);
              toast("Dihapus dari simpanan luring.");
              await gambar();
            },
          }, ikon("sampah")),
        ),
      ),
    );
  }
  hapusSemua.addEventListener("click", async () => {
    for (const e of await luring.daftar()) await luring.hapus(e.uri);
    toast("Simpanan luring dikosongkan.");
    await gambar();
  });
  void gambar();
  return h("div", { class: "kartu" }, h("h2", { class: "kartu-judul" }, "Simpanan luring"), ringkas, daftar, hapusSemua);
}

/** Tautan yang di layar lebar ada di header/footer, tetapi tidak di bilah navigasi bawah ponsel. */
function kartuInformasi() {
  return h(
    "div",
    { class: "kartu" },
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
      h("div", { class: "prosa akun-tata" },
        h("h1", null, "Akun"),
        pesanGalat,
        h("div", { class: "kartu kartu-pastel p-ungu" },
          h("h2", { class: "kartu-judul" }, "Anda memakai Lexa sebagai tamu"),
          h("p", null, "Semua fitur berfungsi tanpa akun. Masuk hanya menyinkronkan koleksi dan riwayat tanya jawab Anda antarperangkat."),
          tersedia
            ? [
                h("p", null, h("a", { class: "tombol tombol-utama", href: `/api/auth/google?kembali=${encodeURIComponent("/koleksi")}`, "data-luar": "" }, "Masuk dengan Google")),
                h("p", { class: "bantu" }, "Lexa hanya meminta identitas dasar (nama, email, foto), bukan akses ke Gmail atau Drive."),
                sesi.data.redirect_uri ? bantuanMasuk(sesi.data.redirect_uri) : null,
              ]
            : h("p", { class: "redup" }, "Masuk dengan Google belum diaktifkan di instalasi ini. Mode tamu tetap berfungsi penuh."),
          koleksi.jumlah ? h("p", { class: "bantu" }, `${koleksi.jumlah} peraturan di koleksi perangkat ini akan dibawa ke akun saat Anda masuk.`) : null,
        ),
        kartuPasang(),
        kartuLuring(),
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
    h("div", { class: "prosa akun-tata" },
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
      h("div", { class: "kartu" },
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
      kartuPasang(),
      kartuLuring(),
      kartuRiwayat(),
      kartuInformasi(),
    ),
  );
}
