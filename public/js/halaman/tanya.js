// @ts-check
import { h, isi, renderBlokTeks, salin } from "../dom.js";
import { api, dibatalkan, GalatApi } from "../api.js";
import { bacaTeksModel, blokKeTeks, sitasiPasal, urlPeraturan } from "../format.js";
import { ikon } from "../komponen/ikon.js";
import { toast } from "../komponen/toast.js";
import { lencanaStatus, peringatan } from "../komponen/umum.js";

const MAKS = 500;
const CONTOH = [
  "Berapa lama cuti melahirkan bagi pekerja perempuan?",
  "Apa saja hak pekerja yang terkena PHK?",
  "Apa kewajiban pengendali data pribadi?",
  "Berapa batas usia minimal untuk menikah?",
];

/**
 * Daftar pasal yang menjadi dasar jawaban.
 * @param {import("../api.js").SitasiJawaban[]} sitasi
 * @param {string} judul
 */
function dasarHukum(sitasi, judul = "Dasar hukum") {
  if (!sitasi.length) return null;
  return h(
    "div",
    { class: "dasar-hukum" },
    h("h3", null, judul),
    h(
      "ul",
      null,
      sitasi.map((s) => {
        const jangkar = s.nomor_pasal ? `pasal-${s.nomor_pasal}${s.ayat ? `-ayat-${s.ayat}` : ""}` : null;
        const [jenis, nomorTahun] = s.sitasi.split(" ");
        const [nomor, tahun] = (nomorTahun ?? "").split("/");
        return h(
          "li",
          null,
          h("a", { href: urlPeraturan(s.frbr_uri, { jangkar }) }, s.nomor_pasal ? sitasiPasal({ jenis: jenis ?? "", nomor: nomor ?? "", tahun: Number(tahun) }, s.nomor_pasal, s.ayat) : s.sitasi),
          h("span", { class: "redup" }, s.judul.length > 70 ? `${s.judul.slice(0, 70)}…` : s.judul),
          s.status !== "berlaku" ? lencanaStatus(s.status) : null,
        );
      }),
    ),
  );
}

/** @param {import("../router.js").Konteks} ctx */
export default async function tanya(ctx) {
  ctx.setJudul("Tanya Lexa", "Ajukan pertanyaan hukum dan dapatkan jawaban yang hanya bersandar pada pasal yang ada di indeks, lengkap dengan sumbernya.");

  /** @type {string | null} */
  let percakapanId = null;
  let sedang = false;
  /** @type {AbortController | null} */
  let berjalan = null;
  ctx.saatKeluar(() => berjalan?.abort());

  const log = h("div", { class: "percakapan", role: "log", "aria-label": "Percakapan" });
  const input = /** @type {HTMLTextAreaElement} */ (
    h("textarea", {
      class: "input",
      id: "pertanyaan",
      rows: "2",
      maxlength: String(MAKS),
      placeholder: "Tulis pertanyaan Anda, mis. “Berapa lama cuti melahirkan?”",
      "aria-label": "Pertanyaan Anda",
    })
  );
  const hitung = h("div", { class: "penghitung", "aria-hidden": "true" }, `0/${MAKS}`);
  const kirim = /** @type {HTMLButtonElement} */ (h("button", { type: "submit", class: "tombol tombol-utama" }, ikon("kirim"), h("span", null, "Kirim")));
  const baru = h("button", { type: "button", class: "tombol tombol-kecil sembunyi", onclick: mulaiBaru }, "Percakapan baru");

  input.value = (ctx.params.get("q") ?? "").slice(0, MAKS);
  const sesuaikan = () => {
    hitung.textContent = `${input.value.length}/${MAKS}`;
    hitung.classList.toggle("lewat", input.value.length >= MAKS);
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 220)}px`;
  };
  input.addEventListener("input", sesuaikan);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  const form = /** @type {HTMLFormElement} */ (
    h(
      "form",
      {
        class: "form-tanya",
        onsubmit: (/** @type {SubmitEvent} */ e) => {
          e.preventDefault();
          void kirimPertanyaan();
        },
      },
      h("div", { class: "form-tanya-baris" }, h("div", { class: "rentang" }, input), kirim),
      h("div", { class: "baris", style: { justifyContent: "space-between", marginTop: "6px" } }, baru, hitung),
    )
  );

  isi(
    ctx.akar,
    h(
      "div",
      { class: "tanya-tata" },
      h("h1", null, "Tanya Lexa"),
      h("p", { class: "redup" }, "Jawaban disusun AI hanya dari pasal yang ditemukan di indeks Lexa, dan sumbernya selalu ditampilkan. Bila dasarnya tidak cukup, Lexa akan mengatakannya."),
      peringatan("info", h("p", null, h("strong", null, "Bukan nasihat hukum. "), "Periksa pasal yang dikutip dan, untuk keputusan penting, rujuk naskah resmi serta konsultasikan dengan ahli.")),
      log,
      h("div", { class: "contoh", id: "contoh-tanya", style: { justifyContent: "flex-start" } }, h("span", { class: "redup" }, "Contoh:"), CONTOH.map((c) => h("button", { type: "button", class: "chip", onclick: () => { input.value = c; sesuaikan(); input.focus(); } }, c))),
      form,
    ),
  );
  sesuaikan();

  function mulaiBaru() {
    berjalan?.abort();
    percakapanId = null;
    sedang = false;
    kirim.disabled = false;
    isi(log);
    baru.classList.add("sembunyi");
    document.getElementById("contoh-tanya")?.classList.remove("sembunyi");
    input.focus();
  }

  /**
   * Gelembung jawaban asisten, dengan tombol salin.
   * @param {Array<import("../dom.js").Anak>} isiJawaban
   * @param {string} [teksPolos]
   * @param {string} [kelas]
   */
  function gelembungAsisten(isiJawaban, teksPolos, kelas = "") {
    return h(
      "div",
      { class: ["gelembung", "asisten", kelas].filter(Boolean).join(" ") },
      ...isiJawaban,
      teksPolos
        ? h("div", { class: "baris", style: { marginTop: "10px" } }, h("button", { type: "button", class: "tombol tombol-kecil tombol-hantu", onclick: async () => toast((await salin(teksPolos)) ? "Jawaban disalin." : "Penyalinan gagal") }, ikon("salin"), "Salin jawaban"))
        : null,
    );
  }

  async function kirimPertanyaan() {
    const pertanyaan = input.value.trim();
    if (!pertanyaan || sedang) return;
    sedang = true;
    kirim.disabled = true;
    document.getElementById("contoh-tanya")?.classList.add("sembunyi");
    baru.classList.remove("sembunyi");

    log.appendChild(h("div", { class: "gelembung pengguna" }, pertanyaan));
    const menunggu = h("div", { class: "gelembung asisten", role: "status", "aria-label": "Lexa sedang menyusun jawaban" }, h("span", { class: "mengetik" }, h("i"), h("i"), h("i")));
    log.appendChild(menunggu);
    input.value = "";
    sesuaikan();
    menunggu.scrollIntoView({ block: "nearest", behavior: "smooth" });

    berjalan = new AbortController();
    try {
      const r = await api.tanya(pertanyaan, percakapanId, berjalan.signal);
      percakapanId = r.percakapan_id ?? percakapanId;
      /** @type {HTMLElement} */
      let jawab;
      if (!r.cukup_dasar || !r.jawaban) {
        jawab = gelembungAsisten([h("p", null, r.jawaban ?? "Saya belum menemukan dasar yang cukup untuk menjawab itu.")], undefined, "tanpa-dasar");
      } else {
        const blok = bacaTeksModel(r.jawaban);
        jawab = gelembungAsisten([renderBlokTeks(blok), dasarHukum(r.sitasi)], blokKeTeks(blok));
      }
      menunggu.replaceWith(jawab);
      // Jawaban yang panjang dibaca dari awal, bukan dari ujung bawahnya.
      jawab.scrollIntoView({ block: "start", behavior: "smooth" });
    } catch (e) {
      if (dibatalkan(e)) return;
      const g = e instanceof GalatApi ? e : null;
      const pesan = g?.status === 429 ? "Terlalu banyak pertanyaan dalam waktu singkat. Tunggu beberapa menit lalu coba lagi." : (g?.message ?? "Terjadi kesalahan tak terduga.");
      const sitasi = Array.isArray(g?.data?.sitasi) ? g?.data.sitasi : [];
      menunggu.replaceWith(
        gelembungAsisten([
          h("p", null, pesan),
          dasarHukum(sitasi, "Pasal yang relevan (tanpa rangkuman)"),
          g?.status !== 429 && g?.status !== 400 ? h("button", { type: "button", class: "tombol tombol-kecil", onclick: () => { input.value = pertanyaan; sesuaikan(); input.focus(); } }, "Tulis ulang pertanyaan") : null,
        ], undefined, "galat-jawaban"),
      );
    } finally {
      sedang = false;
      kirim.disabled = false;
      input.focus({ preventScroll: true });
    }
  }
}
