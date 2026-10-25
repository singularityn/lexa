// @ts-check
import { h, isi } from "../dom.js";

const WARNA = ["p-koral-kuat", "p-biru", "p-ungu", "p-kuning", "p-hijau", "p-kaca"];

/**
 * Bagi isi artikel menjadi kartu per bagian (satu h2 beserta isinya), tanpa mengubah satu kata pun.
 * @param {HTMLElement} artikel
 */
function kelompokkan(artikel) {
  const kepala = h("header", { class: "tentang-kepala" });
  const kisi = h("div", { class: "tentang-kisi" });
  /** @type {HTMLElement | null} */
  let kartu = null;
  for (const el of [...artikel.children]) {
    if (el.tagName === "H2") {
      kartu = h("section", { class: ["kartu-pastel", WARNA[kisi.children.length % WARNA.length]] });
      kisi.appendChild(kartu);
    }
    (kartu ?? kepala).appendChild(el);
  }
  artikel.replaceChildren(kepala, kisi);
}

/** @param {import("../router.js").Konteks} ctx */
export default function tentang(ctx) {
  ctx.setJudul("Tentang Lexa", "Apa itu Lexa, dari mana datanya, bagaimana pencarian dan tanya jawab bekerja, dan apa batasannya.");
  const luar = (/** @type {string} */ href, /** @type {string} */ teks) => h("a", { href, target: "_blank", rel: "noopener noreferrer" }, teks);

  const artikel = h(
    "article",
    { class: "prosa tentang" },
    h("h1", null, "Tentang Lexa"),
    h("p", { class: "lead redup" }, "Lexa membantu menemukan dan membaca peraturan perundang-undangan Indonesia, sampai ke pasal dan PDF resminya."),

    h("h2", null, "Batasan"),
    h(
      "ul",
      null,
      h("li", null, h("strong", null, "Bukan nasihat hukum. "), "Lexa alat bantu riset. Untuk keputusan penting, rujuk naskah resmi dan ahli hukum."),
      h("li", null, h("strong", null, "Data bisa tertinggal atau keliru. "), "Status dan isi pasal berasal dari naskah BPK dan hasil konversi PDF otomatis. Menemukan yang janggal? Pakai ", h("em", null, "Laporkan kesalahan"), "."),
      h("li", null, h("strong", null, "AI bisa salah. "), "Ringkasan dan jawaban Tanya Lexa disusun model bahasa dari pasal yang ditemukan, lengkap dengan sumbernya. Periksa pasal yang dikutip."),
      h("li", null, h("strong", null, "Cakupan dibatasi. "), "Saat ini UUD dan ketetapan MPR, undang-undang (termasuk Perppu), dan peraturan pemerintah. Peraturan di bawahnya belum dimuat. Jumlahnya ada di ", h("a", { href: "/status" }, "Status data"), "."),
    ),

    h("h2", null, "Sumber data"),
    h(
      "ul",
      null,
      h("li", null, "Naskah, metadata, dan relasi: ", luar("https://peraturan.bpk.go.id", "Database Peraturan BPK"), ". Teks pasal diekstrak dari PDF resminya, dan PDF yang sudah diarsipkan bisa dibaca langsung di Lexa."),
      h("li", null, "Peraturan perundang-undangan bukan objek hak cipta (Pasal 42 UU 28/2014), jadi bebas dibaca dan dikutip."),
    ),

    h("h2", null, "Cara kerja"),
    h(
      "ul",
      null,
      h("li", null, h("strong", null, "Pencarian: "), "ketik sitasi (“UU 13/2003”), kata kunci, atau pertanyaan sehari-hari. Lexa memadukan sitasi, kata persis (dengan pelucutan imbuhan dan sinonim hukum), dan kemiripan makna."),
      h("li", null, h("strong", null, "Tanya Lexa: "), "pertanyaan dicari dulu di indeks. Hanya pasal yang relevan diberikan kepada model, yang wajib menyebut sumber dan tidak boleh menambah ketentuan. Bila dasarnya tak cukup, Lexa mengatakannya."),
    ),

    h("h2", null, "Privasi"),
    h(
      "ul",
      null,
      h("li", null, "Tanpa pelacak, iklan, atau skrip pihak ketiga. Kata yang dicari dicatat tanpa identitas untuk memperbaiki pencarian."),
      h("li", null, "Sebagai tamu, koleksi dan halaman terakhir dibaca hanya tersimpan di peramban Anda. Bila masuk dengan Google, Lexa menyimpan nama, email, foto, koleksi, dan riwayat tanya jawab Anda."),
      h("li", null, "Pertanyaan Tanya Lexa diproses oleh Cloudflare Workers AI."),
    ),

    h("h2", null, "Kode sumber"),
    h("p", null, "Lexa berjalan di Cloudflare Workers. Kode dan dokumentasinya ada di ", luar("https://github.com/singularityn/lexa", "GitHub"), "."),
  );
  kelompokkan(artikel);
  isi(ctx.akar, artikel);
}
