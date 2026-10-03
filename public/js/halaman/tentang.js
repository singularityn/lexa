// @ts-check
import { h, isi } from "../dom.js";

/** @param {import("../router.js").Konteks} ctx */
export default function tentang(ctx) {
  ctx.setJudul("Tentang Lexa", "Apa itu Lexa, dari mana datanya, bagaimana pencarian dan tanya jawab bekerja, dan apa batasannya.");
  const luar = (/** @type {string} */ href, /** @type {string} */ teks) => h("a", { href, target: "_blank", rel: "noopener noreferrer" }, teks);

  isi(
    ctx.akar,
    h(
      "article",
      { class: "prosa" },
      h("h1", null, "Tentang Lexa"),
      h("p", { class: "lead redup" }, "Lexa membantu menemukan dan membaca peraturan perundang-undangan Indonesia, dan setiap jawabannya bisa ditelusuri sampai ke pasal."),

      h("h2", null, "Batasan yang perlu Anda ketahui"),
      h(
        "ul",
        null,
        h("li", null, h("strong", null, "Bukan nasihat hukum. "), "Lexa alat bantu riset. Untuk keputusan penting, rujuk naskah resmi dan konsultasikan dengan ahli hukum."),
        h("li", null, h("strong", null, "Data bisa tertinggal atau keliru. "), "Status “berlaku/dicabut/diubah” dan isi pasal bersumber dari data pihak lain dan hasil konversi PDF otomatis. Perubahan terbaru mungkin belum tercermin. Gunakan tombol ", h("em", null, "Laporkan kesalahan"), " bila menemukan yang janggal."),
        h("li", null, h("strong", null, "AI bisa salah. "), "Ringkasan peraturan dan jawaban Tanya Lexa disusun model bahasa. Lexa membatasinya pada pasal yang ditemukan dan menampilkan sumbernya, tetapi tetap periksa pasal yang dikutip."),
        h("li", null, h("strong", null, "Cakupan belum lengkap. "), "Halaman ", h("a", { href: "/status" }, "Status data"), " menunjukkan jumlah peraturan yang saat ini terindeks."),
      ),

      h("h2", null, "Dari mana datanya"),
      h(
        "ul",
        null,
        h("li", null, "Naskah resmi, metadata, dan relasi antarperaturan: ", luar("https://peraturan.bpk.go.id", "Database Peraturan BPK"), ". Lexa menautkan setiap peraturan ke halaman resminya."),
        h("li", null, "Struktur pasal untuk sebagian peraturan: ", luar("https://pasal.id", "pasal.id"), "."),
        h("li", null, "Peraturan perundang-undangan bukan objek hak cipta (Pasal 42 UU 28/2014 tentang Hak Cipta), sehingga bebas dibaca dan dikutip."),
      ),

      h("h2", null, "Cara pencarian bekerja"),
      h(
        "ul",
        null,
        h("li", null, h("strong", null, "Sitasi: "), "ketik “UU 13/2003” atau “PP 35/2021” untuk langsung menuju peraturannya."),
        h("li", null, h("strong", null, "Kata persis: "), "pencarian teks penuh pada judul dan isi pasal, dengan pelucutan imbuhan bahasa Indonesia dan sinonim istilah hukum (mis. “cuti” juga mencari “istirahat”)."),
        h("li", null, h("strong", null, "Makna: "), "kemiripan makna lewat model embedding, berguna bila Anda tidak tahu istilah resminya."),
        h("li", null, "Mode ", h("em", null, "Otomatis"), " memadukan ketiganya dengan Reciprocal Rank Fusion; sitasi selalu diutamakan, dan hasil yang memuat kata yang Anda ketik didahulukan atas yang hanya memuat sinonimnya."),
        h("li", null, "Untuk kalimat panjang yang tak ada satu pasal pun memuat semua katanya, Lexa menampilkan pasal yang memuat sebagian kata dan menyatakannya terus terang."),
      ),

      h("h2", null, "Cara Tanya Lexa bekerja"),
      h("p", null, "Pertanyaan Anda dicari dulu di indeks. Hanya pasal yang cukup relevan yang diberikan kepada model, dengan perintah tegas untuk tidak menambah ketentuan di luar kutipan, menyebut sumber, dan menandai peraturan yang dicabut atau diubah. Bila tidak ada dasar yang cukup, model tidak dipanggil dan Lexa menyatakannya terus terang."),

      h("h2", null, "Privasi"),
      h(
        "ul",
        null,
        h("li", null, "Tidak ada pelacak, iklan, atau skrip pihak ketiga."),
        h("li", null, "Kata yang Anda cari dicatat tanpa identitas untuk memperbaiki pencarian."),
        h("li", null, "Sebagai tamu, koleksi hanya disimpan di peramban Anda. Bila masuk dengan Google, Lexa menyimpan nama, email, foto, koleksi, dan riwayat tanya jawab Anda; sesi memakai cookie HttpOnly."),
        h("li", null, "Pertanyaan Tanya Lexa diproses oleh Cloudflare Workers AI."),
      ),

      h("h2", null, "Kode sumber"),
      h("p", null, "Lexa berjalan di Cloudflare Workers (D1, KV, R2, Queues, Vectorize, Workers AI). Kode dan dokumentasinya ada di ", luar("https://github.com/singularityn/lexa", "GitHub"), "."),
    ),
  );
}
