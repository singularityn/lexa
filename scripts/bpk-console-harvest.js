/**
 * Panen peraturan dari peraturan.bpk.go.id untuk Lexa.
 *
 * KENAPA ADA: naskah resmi di BPK adalah satu-satunya sumber teks UUD, Tap MPR, UU, Perppu, dan PP di Lexa. Seluruh situs
 * BPK berada di balik Cloudflare managed challenge dan Worker Lexa tidak pernah menghubunginya, jadi pengambilan
 * dikerjakan DARI PERAMBAN ANDA SENDIRI, dengan sesi yang sudah lolos challenge. Skrip ini punya dua tahap:
 *
 *  1. PENJELAJAHAN (opsi `jelajah`): membuka daftar peraturan BPK per jenis (UUD, Tap MPR, UU, Perppu, PP), halaman demi
 *     halaman, dan mengirim tiap entri ke Lexa (POST /api/impor/tautan) yang mencocokkannya dengan peraturan di Lexa dan
 *     menyimpan alamat dokumennya di BPK. Perlu SEKALI: di produksi hampir semua PP belum punya tautan BPK, jadi tanpa
 *     tahap ini skrip tidak tahu ke mana harus pergi.
 *  2. PANEN PDF: menanyakan ke Lexa peraturan mana yang perlu teksnya (GET /api/impor/butuh-teks), mengunduh PDF-nya dari
 *     BPK (langsung dari tautan di daftar bila ada, selain itu lewat halaman rincian), dan mengunggahnya ke Lexa
 *     (PUT /api/impor/pdf). Lexa mengekstraknya menjadi pasal di latar belakang. Metadata halaman rincian (judul resmi,
 *     status, tanggal) ikut diperbarui.
 *
 * CARA PAKAI
 *  1. Buka https://peraturan.bpk.go.id/ di peramban, selesaikan tantangan "Verify you are human" bila muncul.
 *  2. Buka DevTools > Console (F12). Setel opsi (lihat di bawah), mis. `window.LEXA_PANEN = { kering: true, batas: 3 }`
 *     dan tekan Enter. Lalu tempel seluruh isi berkas ini dan tekan Enter.
 *  3. Isi alamat Lexa (mis. https://lexa.nama-akun.workers.dev) dan token admin (secret ADMIN_TOKEN; hanya disimpan di
 *     memori halaman, tidak ditulis ke mana pun) pada kotak yang muncul.
 *  Biarkan tab ini terbuka dan terlihat selama berjalan (peramban memperlambat tab yang tersembunyi). Kotak status di
 *  pojok kanan bawah menunjukkan kemajuan dan punya tombol Berhenti (atau jalankan `lexaPanenBerhenti()` di konsol).
 *  Skrip memproses satu permintaan sekali dengan jeda beberapa detik, berhenti sendiri bila berulang kali gagal (mis.
 *  sesi BPK kedaluwarsa), dan mencetak ringkasan. Jalankan lagi untuk melanjutkan: yang sudah selesai tak muncul lagi.
 *
 * URUTAN YANG DIANJURKAN
 *   a. Uji:        { jelajah: true, kering: true, halamanMaks: 2 }        (jelajah dua halaman, tak menulis ke Lexa)
 *   b. Jelajah:    { jelajah: true, hanyaJelajah: true }                  (sekali; ±250-500 permintaan untuk PP)
 *   c. Uji PDF:    { kering: true, batas: 3 }                             (unduh 3 PDF tanpa mengunggah)
 *   d. Panen:      { batas: 200, terus: true }                            (sampai habis atau dihentikan)
 *
 * OPSI (opsional; setel sebelum menempel: `window.LEXA_PANEN = { ... }`)
 *   lexa, token   alamat dan token admin (bila tidak diisi, ditanyakan lewat kotak dialog)
 *   jelajah       true: jelajahi daftar BPK dan tautkan ke Lexa sebelum memanen PDF
 *   hanyaJelajah  true: berhenti sesudah penjelajahan
 *   awal          alamat daftar yang dijelajahi, mis. ["https://peraturan.bpk.go.id/Search?jenis=10"]. Bila kosong, daftar
 *                 jenis dicari dari halaman /Jenis BPK; atau, bila halaman yang sedang dibuka sudah berupa daftar, dari sana
 *   halamanMaks   batas halaman per daftar (bawaan 2000; penjelajahan berhenti lebih dulu bila daftar habis)
 *   halamanAwal   mulai dari halaman ini (bawaan 1), untuk melanjutkan penjelajahan yang terputus
 *   buat          false: jangan membuat peraturan baru di Lexa untuk entri BPK yang belum ada di sana (bawaan: membuat)
 *   batas         paling banyak berapa peraturan dalam satu putaran panen PDF (bawaan 50, maksimum 200)
 *   terus         true: ulangi putaran panen PDF sampai daftar kerja habis, atau tak ada kemajuan, atau dihentikan
 *   jenis         "UU,PP" untuk menyaring jenis (bawaan: seluruh cakupan Lexa)
 *   celah         true: sertakan juga peraturan yang teksnya baru sebagian (nomor pasal bercelah)
 *   lama          true: sertakan juga peraturan yang sudah berpasal dari teks lama (bukan dari BPK), supaya naskah BPK
 *                 menggantikannya; didahulukan yang belum punya teks sama sekali. Jalankan sesudah yang tanpa teks habis
 *   usang         true: tidak memanen apa pun dari BPK. Lexa menguraikan ulang arsip teks peraturan yang terakhir diurai
 *                 dengan versi pengurai lama (POST /api/impor/ekstrak-ulang), per `batas` (maks 100) peraturan sekali
 *                 jalan, sampai habis. Perlu SEKALI sesudah pengurai Lexa diperbarui; tab ini bisa dibuka di situs mana pun
 *                 yang diizinkan Lexa. `jedaUsang`: jeda antarputaran dalam milidetik (bawaan 8000)
 *   geminiCek     true: tidak memanen apa pun. Menguji kunci, model, dan alamat Gemini di Lexa (GET /api/impor/gemini-cek) dengan
 *                 satu permintaan kecil dan mencetak anggaran token hari ini
 *   geminiUji     alamat peraturan (atau daftar alamat), mis. "/akn/id/act/uu/2019/24": Gemini membaca PDF-nya dan Lexa
 *                 melaporkan apa yang AKAN terjadi (pasal terbaca, mutu, kesesuaian dengan teks bawaan, token, keputusan) tanpa
 *                 menyimpan pasal apa pun (POST /api/impor/gemini-uji; satu sampai beberapa menit per peraturan). Jalankan ini
 *                 dulu pada beberapa peraturan sebelum `gemini`
 *   gemini        true: tidak memanen apa pun dari BPK. Lexa meminta Gemini membaca PDF peraturan yang teksnya tak layak (vonis
 *                 tanpa_pasal, berat, atau gagal) lewat POST /api/impor/ekstrak-ulang, `batas` (bawaan 3, maks 20) sekali jalan,
 *                 menunggu tiap kelompok selesai sebelum yang berikutnya, sampai habis atau anggaran token harian habis.
 *                 `geminiVonis`: "tanpa_pasal,berat" untuk menyaring (juga "ringan", "bersih"); `ulangi: true`: coba juga
 *                 yang pernah dicoba; `jedaGemini`: jeda pemeriksaan kemajuan dalam milidetik (bawaan 15000)
 *   jeda          jeda minimum antarpermintaan ke BPK dalam milidetik (bawaan 4000; minimum 2000; jangan dikecilkan)
 *   kering        true: tidak menulis apa pun ke Lexa (penjelajahan tak mengirim tautan, PDF diunduh tetapi tak diunggah)
 *   rincian       true: buka halaman rincian walau tautan PDF langsung dari daftar diketahui (metadata ikut diperbarui,
 *                 tetapi dua kali lipat permintaan)
 *   periksa       true: hanya menganalisis halaman yang sedang dibuka (tabel metadata, tautan unduhan, entri daftar, tautan
 *                 halaman berikutnya, tautan jenis) dan mencetaknya; untuk menyesuaikan pemilih bila BPK mengubah susunan
 *   papan         false: tanpa kotak status
 *
 * CATATAN: skrip ini ditulis menurut susunan situs BPK yang diketahui (alamat /Details/<id>/<slug>, /Download/<id>/<berkas>,
 * daftar /Search?jenis=<n>&page=<n>) dan belum pernah dijalankan pada situs sungguhan dari lingkungan pengembangan Lexa
 * (situs itu tak terjangkau di sana). Coba dengan langkah (a) dan (c) di atas dulu. Bila yang ditemukan tak sesuai, jalankan
 * `window.LEXA_PANEN = { periksa: true }` di halaman daftar atau rincian dan kirim hasilnya agar pemilihnya diperbaiki.
 * Hormati ketentuan situs BPK: satu permintaan sekali, jeda tetap.
 */
(function () {
  "use strict";

  /** Tautan unduhan PDF di halaman BPK: /Download/<id>/<nama>.pdf, atau tautan apa pun yang berujung .pdf. */
  var POLA_TAUTAN_PDF = /\/download\/|\.pdf(?:[?#]|$)/i;
  /** Teks tautan yang lazim untuk unduhan. */
  var POLA_TEKS_UNDUH = /unduh|download|pdf|dokumen|naskah/i;
  /** Berkas pendamping, bukan naskah peraturannya. */
  var POLA_PENDAMPING = /lampiran|abstrak|terjemah|translation|english/i;
  /**
   * Tanda halaman tantangan Cloudflare (bukan halaman BPK yang sebenarnya): judulnya, atau teks yang tampak di awal halaman.
   * Kata "challenge-platform" sengaja tidak dipakai: skrip pelacak Cloudflare yang menyertakannya ada juga di halaman biasa.
   */
  var POLA_TANTANGAN = /just a moment|attention required|checking your browser|verify you are human|enable javascript and cookies/i;
  /** Tautan ke halaman rincian sebuah dokumen: /Details/<id>/<slug> atau /Home/Details/<id>/<slug>. */
  var POLA_RINCIAN = /\/(?:Home\/)?Details\/(\d+)(?:\/([^\/?#"]+))?/i;
  /** Berapa kegagalan beruntun sebelum putaran dihentikan. */
  var MAKS_GAGAL_BERUNTUN = 5;
  /** Jenis dalam cakupan Lexa dan nama yang dipakai BPK pada daftar jenisnya (urutan penting: Perppu sebelum UU dan PP). */
  var JENIS_CAKUPAN = [
    { kode: "UUD", pola: /^undang[\s-]*undang dasar\b/ },
    { kode: "TAP_MPR", pola: /^(?:ketetapan (?:mprs?|majelis permusyawaratan rakyat)|tap[\s-]*mprs?)\b/ },
    { kode: "PERPPU", pola: /^(?:peraturan pemerintah pengganti undang[\s-]*undang|perp?pu)\b/ },
    { kode: "UU", pola: /^undang[\s-]*undang\b(?!\s*dasar)/ },
    { kode: "PP", pola: /^peraturan pemerintah\b(?!\s+pengganti)/ },
  ];

  var berhenti = false;
  globalThis.lexaPanenBerhenti = function () { berhenti = true; };

  var tunggu = function (ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); };
  var teks = function (el) { return (el && el.textContent ? el.textContent : "").replace(/\s+/g, " ").trim(); };
  var pesan = function (e) { return e && e.message ? e.message : String(e); };
  var angka = function (n) { return Number(n || 0).toLocaleString("id-ID"); };
  /**
   * Apakah galat ini menandakan sesi/akses BPK bermasalah (lewat properti `sesi` yang ditandai tegas di titik lempar,
   * bukan dengan mencari kata dalam teks galat). Dipakai untuk memutuskan apakah mencoba jalur lain (halaman rincian,
   * tautan berikutnya) ada gunanya, atau sesinya memang perlu diselesaikan dulu di tab ini.
   *
   * Sebelumnya ini mencocokkan `/tantangan|dihentikan|HTTP (?:401|403|429)/` pada TEKS galat — tetapi galat "yang
   * terunduh bukan PDF (sesi BPK kedaluwarsa atau halaman tantangan)" sendiri memuat kata "tantangan" sebagai bagian
   * dari tebakan yang ditulis untuk pembaca manusia, bukan diagnosis yang pasti. Akibatnya kecocokan itu membuat kode
   * SELALU menyerah tanpa mencoba halaman rincian — persis pada kasus yang paling butuh percobaan itu: tautan
   * langsung dari daftar yang sudah usang. Di produksi ini mengunci satu dokumen (UU 6/2023) di urutan pertama
   * antrean selamanya, karena kegagalannya tak pernah tercatat di Lexa (PDF tak pernah terunggah) sehingga dokumen
   * yang sama diminta lagi di percobaan berikutnya.
   */
  function kegagalanSesi(e) { return Boolean(e) && (e.sesi === true || pesan(e) === "dihentikan"); }

  /** Menunggu sambil memeriksa tombol berhenti tiap 250 ms. */
  async function tungguSopan(ms) {
    var sampai = Date.now() + ms;
    while (!berhenti && Date.now() < sampai) await tunggu(Math.max(0, Math.min(250, sampai - Date.now())));
  }
  function jedaAcak(dasar) { return dasar + Math.round(Math.random() * dasar * 0.5); }

  // ---------------------------------------------------------------------------------------------------------------
  // Kotak status
  // ---------------------------------------------------------------------------------------------------------------

  /** Kotak kecil di pojok halaman (gaya lewat CSSOM, jadi lolos CSP yang melarang atribut style). Gagal diam-diam. */
  function buatPapan() {
    var papan = { tulis: function () {}, tutup: function () {} };
    try {
      var kotak = document.createElement("div");
      var gaya = function (el, nilai) { Object.keys(nilai).forEach(function (k) { el.style[k] = nilai[k]; }); };
      gaya(kotak, {
        position: "fixed", right: "12px", bottom: "12px", zIndex: "2147483647", maxWidth: "380px", padding: "10px 12px",
        background: "#12301f", color: "#fff", font: "12px/1.45 system-ui, sans-serif", borderRadius: "8px",
        boxShadow: "0 4px 16px rgba(0,0,0,.35)",
      });
      var judul = document.createElement("div");
      judul.textContent = "Lexa panen BPK";
      gaya(judul, { fontWeight: "600" });
      var isi = document.createElement("div");
      gaya(isi, { whiteSpace: "pre-wrap", margin: "4px 0 6px", wordBreak: "break-word" });
      var tombol = document.createElement("button");
      tombol.type = "button";
      tombol.textContent = "Berhenti";
      gaya(tombol, { font: "inherit", padding: "3px 10px", borderRadius: "6px", border: "0", cursor: "pointer" });
      tombol.addEventListener("click", function () {
        berhenti = true;
        tombol.textContent = "Menghentikan…";
        tombol.disabled = true;
      });
      kotak.appendChild(judul);
      kotak.appendChild(isi);
      kotak.appendChild(tombol);
      document.body.appendChild(kotak);
      papan.tulis = function (t) { isi.textContent = t; };
      papan.tutup = function (tundaMs) { setTimeout(function () { if (kotak.parentNode) kotak.parentNode.removeChild(kotak); }, tundaMs || 0); };
    } catch (e) { /* CSP atau dokumen tanpa body: tanpa kotak */ }
    return papan;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Membaca halaman BPK
  // ---------------------------------------------------------------------------------------------------------------

  /** Label metadata yang dikenal Lexa (shared bpk.ts: petakanDokumen); dipakai pembaca cadangan bila bukan tabel dua sel. */
  var LABEL_METADATA = [
    "Judul", "Bentuk", "Bentuk Singkat", "Jenis", "Nomor", "Tahun", "Status", "Tanggal Penetapan", "Tanggal Pengundangan",
    "Tanggal Berlaku", "T.E.U.", "T.E.U. Badan", "Tempat Penetapan", "Subjek", "Bidang", "Sumber", "Lokasi",
  ];

  /**
   * Pasangan label -> nilai dari halaman rincian. Utama: tabel dengan baris dua sel (<tr><th/td>label</><td>nilai</td>). Bila
   * yang terbaca kurang dari dua, dicoba daftar definisi (<dt>label</dt><dd>nilai</dd>) lalu elemen berlabel yang dikenal
   * (mis. <div class="col">Nomor</div><div class="col">13</div>) dengan nilai di elemen saudara sesudahnya.
   */
  function bacaMetadata(doc) {
    var meta = {};
    var tambah = function (label, nilai) {
      label = String(label || "").replace(/:$/, "").trim();
      nilai = String(nilai || "").trim();
      if (label && nilai && nilai.length <= 2000 && !(label in meta)) meta[label] = nilai;
    };
    doc.querySelectorAll("tr").forEach(function (tr) {
      var sel = tr.querySelectorAll(":scope > th, :scope > td");
      if (sel.length === 2) tambah(teks(sel[0]), teks(sel[1]));
    });
    if (Object.keys(meta).length >= 2) return meta;
    doc.querySelectorAll("dt").forEach(function (dt) {
      var dd = dt.nextElementSibling;
      if (dd && dd.tagName === "DD") tambah(teks(dt), teks(dd));
    });
    if (Object.keys(meta).length >= 2) return meta;
    var dikenal = {};
    LABEL_METADATA.forEach(function (l) { dikenal[l.toLowerCase()] = l; });
    doc.querySelectorAll("th, td, dt, div, span, label, strong, b, p").forEach(function (el) {
      if (el.children.length > 1) return;
      var t = teks(el).replace(/:$/, "").trim();
      var baku = dikenal[t.toLowerCase()];
      var saudara = el.nextElementSibling;
      if (baku && saudara) tambah(baku, teks(saudara));
    });
    return meta;
  }

  /** Semua tautan yang tampak seperti unduhan PDF, yang paling meyakinkan lebih dulu (lampiran dan terjemahan paling akhir). */
  function cariTautanPdf(doc, dasar) {
    var kandidat = [];
    doc.querySelectorAll("a[href]").forEach(function (a) {
      var href = a.getAttribute("href") || "";
      if (!POLA_TAUTAN_PDF.test(href)) return;
      var mutlak;
      try { mutlak = new URL(href, dasar).href; } catch (e) { return; }
      var skor = (POLA_TEKS_UNDUH.test(teks(a)) ? 2 : 0) + (/\.pdf(?:[?#]|$)/i.test(href) ? 1 : 0);
      if (POLA_PENDAMPING.test(teks(a) + " " + decodeURIComponentAman(href))) skor -= 3;
      kandidat.push({ url: mutlak, teks: teks(a), skor: skor });
    });
    kandidat.sort(function (a, b) { return b.skor - a.skor; });
    return kandidat;
  }

  function decodeURIComponentAman(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

  /** Alamat mutlak dari href relatif; null bila tak sah. */
  function mutlak(href, dasar) { try { return new URL(href, dasar).href; } catch (e) { return null; } }

  /**
   * Entri dokumen pada halaman daftar: setiap tautan ke /Details/<id>, digabung per id. Teks tautan terpanjang menjadi
   * judul entri; teks kartu di sekitarnya (naik dari tautan sampai sebelum melingkupi entri lain) menjadi `konteks`; tautan
   * unduhan PDF di kartu yang sama menjadi `pdf_url`.
   */
  function kumpulkanEntri(doc, dasar) {
    var semua = Array.prototype.slice.call(doc.querySelectorAll("a[href]"));
    var idDi = function (el) {
      var ids = {};
      el.querySelectorAll("a[href]").forEach(function (a) { var m = POLA_RINCIAN.exec(a.getAttribute("href") || ""); if (m) ids[m[1]] = true; });
      return Object.keys(ids).length;
    };
    var peta = {};
    var urut = [];
    semua.forEach(function (a) {
      var href = a.getAttribute("href") || "";
      var m = POLA_RINCIAN.exec(href);
      var url = m ? mutlak(href, dasar) : null;
      if (!m || !url) return;
      var e = peta[m[1]];
      if (!e) {
        e = peta[m[1]] = { bpk_id: m[1], url: url, slug: m[2] ? decodeURIComponentAman(m[2]) : null, teks: "", konteks: "", pdf_url: null, _a: a };
        urut.push(e);
      }
      var t = teks(a);
      if (t.length > e.teks.length && t.length <= 300) { e.teks = t; e._a = a; }
      if (m[2] && !e.slug) e.slug = decodeURIComponentAman(m[2]);
    });
    urut.forEach(function (e) {
      var kartu = e._a;
      for (var i = 0; i < 6 && kartu.parentElement; i++) {
        var induk = kartu.parentElement;
        if (idDi(induk) > 1) break;
        kartu = induk;
      }
      e.konteks = teks(kartu).slice(0, 500);
      var pdf = cariTautanPdf({ querySelectorAll: function (s) { return kartu.querySelectorAll(s); } }, dasar);
      e.pdf_url = pdf.length && pdf[0].skor >= 0 ? pdf[0].url : null;
      delete e._a;
    });
    return urut;
  }

  /** Nomor halaman pada alamat daftar (parameter page, bawaan 1). */
  function nomorHalaman(url) {
    try { return Math.max(parseInt(new URL(url).searchParams.get("page"), 10) || 1, 1); } catch (e) { return 1; }
  }

  /**
   * Alamat halaman berikutnya pada daftar: tautan rel=next, atau tautan "Selanjutnya/Next/›/»" yang tidak nonaktif; bila
   * tak ada, parameter page dinaikkan satu. Penghentian dilakukan pemanggil (halaman tanpa entri baru).
   */
  function halamanBerikut(doc, url, kini) {
    var rel = doc.querySelector("a[rel~='next'][href]");
    if (rel && rel.getAttribute("href") !== "#") return mutlak(rel.getAttribute("href"), url);
    var dipilih = null;
    doc.querySelectorAll("a[href]").forEach(function (a) {
      if (dipilih) return;
      var t = teks(a).toLowerCase();
      var label = ((a.getAttribute("aria-label") || "") + " " + (a.getAttribute("title") || "")).toLowerCase();
      if (!/^(?:selanjutnya|berikutnya|next|»|›|>|>>)$/.test(t) && !/next|selanjutnya|berikutnya/.test(label)) return;
      var li = a.closest ? a.closest("li") : null;
      if ((li && /disabled/.test(li.className || "")) || /disabled/.test(a.className || "") || a.getAttribute("aria-disabled") === "true") return;
      var href = a.getAttribute("href") || "";
      if (!href || href === "#" || /^javascript:/i.test(href)) return;
      dipilih = a;
    });
    if (dipilih) return mutlak(dipilih.getAttribute("href"), url);
    try {
      var u = new URL(url);
      u.searchParams.set("page", String(kini + 1));
      return u.href;
    } catch (e) { return null; }
  }

  /** Jumlah hasil yang disebut halaman daftar ("Menemukan 4.991 peraturan dalam 0,002 detik"); null bila tak ada. */
  function bacaTotalDaftar(doc) {
    var m = /menemukan\s+([\d.,]+)\s+peraturan/i.exec(doc && doc.body ? doc.body.textContent.replace(/\s+/g, " ") : "");
    return m ? parseInt(m[1].replace(/[.,]/g, ""), 10) || null : null;
  }

  /** Nama jenis tanpa jumlah di ujungnya: "Peraturan Pemerintah (PP) 4.991" -> "peraturan pemerintah (pp)". */
  function namaJenis(t) {
    return t.toLowerCase().replace(/\s+/g, " ").replace(/\s*\(?\d[\d.,]*\)?\s*$/, "").trim();
  }

  /** Tautan ke daftar jenis dalam cakupan Lexa pada sebuah halaman (biasanya /Jenis). Satu per jenis, yang berparameter jenis dulu. */
  function temukanJenis(doc, dasar) {
    var hasil = {};
    doc.querySelectorAll("a[href]").forEach(function (a) {
      var href = a.getAttribute("href") || "";
      if (!/search|jenis/i.test(href)) return;
      var nama = namaJenis(teks(a));
      for (var i = 0; i < JENIS_CAKUPAN.length; i++) {
        if (!JENIS_CAKUPAN[i].pola.test(nama)) continue;
        var url = mutlak(href, dasar);
        var ada = hasil[JENIS_CAKUPAN[i].kode];
        if (url && (!ada || (!/jenis=\d/.test(ada.url) && /jenis=\d/.test(url)))) hasil[JENIS_CAKUPAN[i].kode] = { kode: JENIS_CAKUPAN[i].kode, nama: teks(a), url: url };
        return;
      }
    });
    return JENIS_CAKUPAN.map(function (j) { return hasil[j.kode]; }).filter(Boolean);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Jaringan
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * fetch ke BPK dengan pengulangan untuk gangguan sementara (429/502/503/504 dan galat jaringan): menunggu sesuai Retry-After
   * atau berlipat. Halaman tantangan Cloudflare (403) tidak diulang: butuh manusia.
   */
  async function ambil(ctx, url, init) {
    var maks = 3;
    for (var i = 1; ; i++) {
      if (berhenti) throw new Error("dihentikan");
      var res;
      try {
        res = await fetch(url, init);
      } catch (e) {
        if (i >= maks) throw new Error("jaringan: " + pesan(e));
        await tungguSopan(ctx.jedaUlang * i);
        continue;
      }
      if ([429, 502, 503, 504].indexOf(res.status) >= 0 && i < maks) {
        var tunda = (Number(res.headers.get("retry-after")) || 0) * 1000;
        await tungguSopan(Math.min(Math.max(tunda, ctx.jedaUlang * i), 120000));
        continue;
      }
      return res;
    }
  }

  /** Apakah dokumen ini halaman tantangan Cloudflare: dinilai dari judul dan awal teks yang tampak, bukan dari seluruh HTML. */
  function halamanTantangan(doc) {
    var awal = (doc.title || "") + " " + (doc.body ? doc.body.textContent.replace(/\s+/g, " ").slice(0, 600) : "");
    return POLA_TANTANGAN.test(awal);
  }

  /** Galat tantangan Cloudflare yang sudah ditandai `.sesi = true` (lihat kegagalanSesi di atas). */
  function galatTantangan() {
    var e = new Error("tantangan_cloudflare: selesaikan tantangan di tab ini (muat ulang halaman), lalu jalankan lagi");
    e.sesi = true;
    return e;
  }

  /**
   * Seperti halamanTantangan, tetapi untuk respons unduhan PDF yang ternyata bukan PDF: dibaca ulang sebagai dokumen
   * HANYA bila content-type-nya HTML (respons PDF sungguhan tak pernah begini, jadi ini tak menambah biaya pada
   * kasus normal) dan diuji dengan heuristik yang sama.
   */
  function tantanganDariIsi(bytes, contentType) {
    if (!/html/i.test(contentType || "")) return false;
    try {
      var teks = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 4000));
      return halamanTantangan(new DOMParser().parseFromString(teks, "text/html"));
    } catch (e) {
      return false;
    }
  }

  /** Halaman HTML sebagai dokumen. Melempar bila galat HTTP atau yang diterima halaman tantangan. */
  async function bacaHalaman(ctx, url) {
    var res = await ambil(ctx, url, { credentials: "include", headers: { Accept: "text/html" } });
    var html = await res.text();
    var doc = new DOMParser().parseFromString(html, "text/html");
    if (res.status === 403 || (res.status === 503 && halamanTantangan(doc))) throw galatTantangan();
    if (!res.ok) throw new Error("HTTP " + res.status + " pada " + jalur(url));
    // Halaman yang tampak seperti tantangan tetapi memuat isi situs (tautan rincian, unduhan, tabel metadata) adalah halaman biasa.
    if (halamanTantangan(doc) && !doc.querySelector("a[href*='ownload']") && !doc.querySelector("a[href*='Details']") && Object.keys(bacaMetadata(doc)).length < 2) throw galatTantangan();
    return doc;
  }

  function jalur(url) { try { var u = new URL(url); return u.pathname + u.search; } catch (e) { return url; } }

  /**
   * Unduh PDF sebagai ArrayBuffer; menolak yang bukan PDF.
   *
   * Respons 200 yang bukan PDF TIDAK selalu berarti sesi bermasalah — bisa juga tautan yang sudah usang (hasil
   * pencarian lama, berkas dipindahkan BPK) sementara sesinya sendiri baik-baik saja. Hanya yang sungguh dikenali
   * sebagai halaman tantangan (lewat 403, atau isinya memang begitu) ditandai `.sesi`; sisanya dilaporkan apa adanya
   * dan TIDAK menghentikan percobaan jalur lain (lihat kegagalanSesi).
   */
  async function unduhPdf(ctx, url) {
    var res = await ambil(ctx, url, { credentials: "include" });
    if (res.status === 403) throw galatTantangan();
    if (!res.ok) {
      var g = new Error("HTTP " + res.status + " saat mengunduh PDF");
      if (res.status === 401 || res.status === 429) g.sesi = true;
      throw g;
    }
    var isi = await res.arrayBuffer();
    var bytes = new Uint8Array(isi);
    var kepala = String.fromCharCode.apply(null, bytes.slice(0, 5));
    if (kepala === "%PDF-") return isi;
    if (tantanganDariIsi(bytes, res.headers.get("content-type"))) throw galatTantangan();
    throw new Error("berkas yang terunduh bukan PDF dan bukan halaman tantangan yang dikenali (tautan mungkin usang atau berkas dipindahkan)");
  }

  /** Coba tiga tautan PDF teratas sampai ada yang benar-benar PDF; kegagalan sesi (tantangan, 401/403/429) langsung dilaporkan. */
  async function unduhDariDaftar(ctx, tautan) {
    var galat = null;
    for (var k = 0; k < Math.min(tautan.length, 3); k++) {
      try { return await unduhPdf(ctx, tautan[k].url); } catch (e) {
        galat = e;
        if (kegagalanSesi(e)) break;
      }
    }
    throw galat;
  }

  /** Klien Lexa: JSON masuk dan keluar; galat membawa `status`, dan 401/403/jaringan ditandai `fatal` (menghentikan semuanya). */
  function buatKlienLexa(lexa, token) {
    return async function lexaMinta(path, init) {
      init = init || {};
      var headers = Object.assign({ "x-admin-token": token }, init.headers || {});
      var res;
      try {
        res = await fetch(lexa + path, Object.assign({}, init, { headers: headers }));
      } catch (e) {
        var g = new Error("Lexa tak terjangkau dari halaman ini (" + pesan(e) + "). Periksa alamat Lexa, dan bahwa Lexa mengizinkan origin BPK (CORS).");
        g.fatal = true;
        throw g;
      }
      var badan = null;
      try { badan = await res.json(); } catch (e) { /* bukan JSON */ }
      if (!res.ok) {
        var galat = new Error("Lexa " + res.status + (badan && badan.message ? ": " + badan.message : ""));
        galat.status = res.status;
        galat.fatal = res.status === 401 || res.status === 403;
        throw galat;
      }
      return badan;
    };
  }
  function kirimJson(lexaMinta, path, objek) {
    return lexaMinta(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(objek) });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Tahap 1: penjelajahan daftar BPK
  // ---------------------------------------------------------------------------------------------------------------

  /** Daftar yang dijelajahi: dari opsi `awal`, atau halaman /Jenis BPK, atau halaman yang sedang dibuka bila sudah berupa daftar. */
  async function tentukanDaftarAwal(ctx) {
    var opsi = ctx.opsi;
    if (opsi.awal) {
      var daftar = [].concat(opsi.awal);
      return daftar.map(function (u) { return { kode: "?", nama: String(u), url: mutlak(String(u), location.href) }; }).filter(function (d) { return d.url; });
    }
    var asal = location.origin;
    var jenis = [];
    var coba = [asal + "/Jenis", asal + "/"];
    for (var i = 0; i < coba.length && !jenis.length; i++) {
      try { jenis = temukanJenis(await bacaHalaman(ctx, coba[i]), coba[i]); } catch (e) {
        if (kegagalanSesi(e)) throw e;
        console.warn("[Lexa panen] " + jalur(coba[i]) + " tak terbaca: " + pesan(e));
      }
    }
    if (jenis.length) return jenis;
    if (kumpulkanEntri(document, location.href).length) return [{ kode: "?", nama: "halaman ini", url: location.href }];
    return [];
  }

  async function jelajahi(ctx) {
    var opsi = ctx.opsi;
    var daftar = await tentukanDaftarAwal(ctx);
    var jel = {
      daftar: [], halaman: 0, entri: 0, ditautkan: 0, sudah: 0, dibuat: 0, tidak_ada: 0, luar_cakupan: 0, tidak_dikenali: 0,
      ambigu: 0, bentrok: 0, gagal: 0, contoh: { tidak_ada: [], tidak_dikenali: [], ambigu: [], bentrok: [], gagal: [] }, berhentiKarena: "",
    };
    if (!daftar.length) {
      jel.berhentiKarena = "daftar jenis tak ditemukan";
      console.error("[Lexa panen] Daftar jenis peraturan BPK tak ditemukan di /Jenis maupun beranda. Buka halaman daftar (mis. pilih Peraturan Pemerintah di situs BPK), lalu jalankan dengan { jelajah: true } di halaman itu, atau berikan { awal: [\"https://peraturan.bpk.go.id/Search?jenis=10\"] }. Untuk menganalisis halaman: { periksa: true }.");
      return jel;
    }
    console.log("[Lexa panen] penjelajahan: " + daftar.map(function (d) { return d.kode + " " + jalur(d.url); }).join(", "));

    for (var d = 0; d < daftar.length && !berhenti; d++) {
      var seed = daftar[d];
      var url = seed.url;
      var halaman = Math.max(Number(opsi.halamanAwal) || 1, 1);
      if (halaman > 1) { var u = new URL(url); u.searchParams.set("page", String(halaman)); url = u.href; }
      var terlihat = {};
      var kunjungan = {};
      var ringkasDaftar = { nama: seed.nama, kode: seed.kode, halaman: 0, entri: 0 };
      jel.daftar.push(ringkasDaftar);
      var maks = Math.max(Number(opsi.halamanMaks) || 2000, 1);

      for (var n = 0; n < maks && url && !berhenti; n++) {
        if (kunjungan[url]) break;
        kunjungan[url] = true;
        var doc;
        try { doc = await bacaHalaman(ctx, url); } catch (e) {
          if (pesan(e) === "dihentikan") break;
          jel.berhentiKarena = pesan(e) + " (" + seed.kode + ", halaman " + halaman + ")";
          console.error("[Lexa panen] " + jel.berhentiKarena);
          return jel;
        }
        var entri = kumpulkanEntri(doc, url);
        if (n === 0) ringkasDaftar.total = bacaTotalDaftar(doc);
        var baru = entri.filter(function (e) { return !terlihat[e.bpk_id]; });
        if (!entri.length) {
          console.warn("[Lexa panen] " + seed.kode + " halaman " + halaman + ": tidak ada tautan /Details/<id>. " + (n === 0 ? "Susunan BPK mungkin berbeda; jalankan { periksa: true } di halaman daftar ini." : "Daftar ini selesai."));
          break;
        }
        if (!baru.length) break; // halaman yang sama berulang: akhir daftar
        baru.forEach(function (e) { terlihat[e.bpk_id] = true; });
        ringkasDaftar.halaman++;
        ringkasDaftar.entri += baru.length;
        jel.halaman++;
        jel.entri += baru.length;

        var hasilHalaman = await kirimTautan(ctx, baru, jel);
        var papanTeks = "Penjelajahan " + (seed.kode === "?" ? seed.nama : seed.kode) + ": halaman " + halaman + ", " + angka(ringkasDaftar.entri) + (ringkasDaftar.total ? " dari " + angka(ringkasDaftar.total) : "") + " entri\n" +
          "ditautkan " + angka(jel.ditautkan) + " · sudah " + angka(jel.sudah) + " · dibuat " + angka(jel.dibuat) + " · tak ada di Lexa " + angka(jel.tidak_ada) + " · tak dikenali " + angka(jel.tidak_dikenali);
        if (ctx.papan) ctx.papan.tulis(papanTeks);
        console.log("[Lexa panen] " + seed.kode + " halaman " + halaman + ": " + baru.length + " entri" + (hasilHalaman ? " (" + hasilHalaman + ")" : ""));

        url = halamanBerikut(doc, url, nomorHalaman(url));
        halaman = url ? nomorHalaman(url) : halaman;
        if (url) await tungguSopan(jedaAcak(ctx.jedaDaftar));
      }
      if (!berhenti) console.log("[Lexa panen] " + seed.nama + ": " + angka(ringkasDaftar.entri) + (ringkasDaftar.total ? " dari " + angka(ringkasDaftar.total) + " yang disebut BPK" : "") + " entri di " + ringkasDaftar.halaman + " halaman.");
    }
    if (berhenti) jel.berhentiKarena = "dihentikan";
    return jel;
  }

  /** Kirim entri ke Lexa (maks 100 per permintaan) dan catat hasilnya; mengisi peta PDF langsung. Mengembalikan ringkasan teks. */
  async function kirimTautan(ctx, entri, jel) {
    if (ctx.opsi.kering) return "kering: tidak dikirim";
    var hitung = {};
    for (var i = 0; i < entri.length; i += 100) {
      var potong = entri.slice(i, i + 100);
      var jawab = await kirimJson(ctx.lexaMinta, "/api/impor/tautan", {
        buat: ctx.opsi.buat !== false,
        tautan: potong.map(function (e) { return { bpk_id: e.bpk_id, url: e.url, slug: e.slug, teks: e.teks, konteks: e.konteks }; }),
      });
      (jawab.hasil || []).forEach(function (h, k) {
        var e = potong[k];
        hitung[h.status] = (hitung[h.status] || 0) + 1;
        if (typeof jel[h.status] === "number") jel[h.status]++;
        if (h.status === "ditautkan" || h.status === "sudah" || h.status === "dibuat") {
          (h.uris || (h.uri ? [h.uri] : [])).forEach(function (uri) { if (e.pdf_url) ctx.pdfPerUri[uri] = e.pdf_url; });
        } else if (jel.contoh[h.status] && jel.contoh[h.status].length < 15) {
          jel.contoh[h.status].push({ id: e.bpk_id, teks: e.teks.slice(0, 120), slug: e.slug, konteks: e.konteks.slice(0, 160), sitasi: h.sitasi || null, alasan: h.alasan || null });
        }
      });
    }
    return Object.keys(hitung).map(function (s) { return hitung[s] + " " + s; }).join(", ");
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Tahap 2: panen PDF
  // ---------------------------------------------------------------------------------------------------------------

  /** Metadata halaman rincian dikirim sebagai pembaruan atas peraturan yang dituju (lexa_uri); kegagalan tak menghentikan panen. */
  async function kirimRincian(ctx, item, doc) {
    if (ctx.opsi.kering) return;
    var meta = bacaMetadata(doc);
    if (Object.keys(meta).length < 2) return;
    try {
      await kirimJson(ctx.lexaMinta, "/api/impor/manifest", {
        versi: 1,
        dokumen: [{ bpk_id: item.bpk_id || (POLA_RINCIAN.exec(item.detail_url || "") || [])[1] || "", lexa_uri: item.frbr_uri, detail_url: item.detail_url, meta: meta }],
      });
    } catch (e) {
      if (e && e.fatal) throw e;
      console.warn("[Lexa panen] metadata " + item.frbr_uri + " tak tersimpan: " + pesan(e));
    }
  }

  /** Apakah halaman memuat petunjuk adanya berkas (tombol atau tautan unduhan) walau tak ada tautan PDF yang dikenali. */
  function adaPetunjukBerkas(doc) {
    var ada = false;
    doc.querySelectorAll("a, button, embed, iframe, object, [data-href], [data-url], [data-file]").forEach(function (el) {
      var s = ["href", "src", "data", "data-href", "data-url", "data-file", "onclick"].map(function (k) { return el.getAttribute(k) || ""; }).join(" ") + " " + teks(el);
      if (/unduh|download|\.pdf\b|berkas/i.test(s)) ada = true;
    });
    return ada;
  }

  /**
   * Ambil PDF sebuah peraturan. Mengembalikan { pdf }, { tanpaBerkas: alasan } (halaman rincian dimuat dan lengkap tetapi tak
   * punya tautan PDF), atau { lewati } (tak ada alamat BPK untuk peraturan ini).
   */
  async function ambilPdfUntuk(ctx, item) {
    var langsung = ctx.pdfPerUri[item.frbr_uri];
    if (langsung && !ctx.opsi.rincian) {
      try { return { pdf: await unduhPdf(ctx, langsung) }; } catch (e) {
        // Tautan dari daftar usang atau ditolak: coba lewat halaman rincian, kecuali yang menandakan sesi bermasalah.
        if (!item.detail_url || kegagalanSesi(e)) throw e;
      }
    }
    if (!item.detail_url) return { lewati: "tak ada tautan BPK" };
    var doc = await bacaHalaman(ctx, item.detail_url);
    await kirimRincian(ctx, item, doc);
    var tautan = cariTautanPdf(doc, item.detail_url);
    if (!tautan.length) {
      // Halaman rincian yang lengkap tetapi tanpa berkas: naskah lama yang di BPK hanya metadata. Bukan kegagalan sesi.
      if (Object.keys(bacaMetadata(doc)).length >= 2) {
        return { tanpaBerkas: adaPetunjukBerkas(doc) ? "halaman dikenali, tetapi tautan PDF-nya tak dikenali (periksa halamannya)" : "tanpa berkas PDF di BPK" };
      }
      throw new Error("tautan PDF tak ditemukan di halaman rincian (jalankan dengan periksa: true di halaman itu)");
    }
    return { pdf: await unduhDariDaftar(ctx, tautan) };
  }

  async function panenPdf(ctx) {
    var opsi = ctx.opsi;
    var batas = Math.min(Math.max(Number(opsi.batas) || 50, 1), 200);
    var query = "?batas=" + batas + (opsi.jenis ? "&jenis=" + encodeURIComponent(opsi.jenis) : "") + (opsi.celah ? "&celah=1" : "") + (opsi.lama ? "&lama=1" : "");
    var hasil = [];
    var gagalBeruntun = 0;
    var terakhir = null;
    var berhentiKarena = "";

    for (var putaran = 1; !berhenti; putaran++) {
      var kerja = await ctx.lexaMinta("/api/impor/butuh-teks" + query);
      terakhir = kerja;
      if (putaran === 1) {
        console.log("[Lexa panen] " + angka(kerja.total) + " peraturan masih perlu teks (" + angka(kerja.tanpa_bpk) + " di antaranya tanpa tautan BPK" +
          (kerja.tanpa_berkas ? ", " + angka(kerja.tanpa_berkas) + " ditandai tanpa berkas di BPK" : "") + "); memproses " + kerja.daftar.length + (opsi.terus ? " per putaran." : "."));
        if (kerja.tanpa_bpk > 0 && !opsi.jelajah) console.log("[Lexa panen] Yang tanpa tautan BPK baru bisa dipanen sesudah penjelajahan daftar BPK: jalankan dengan { jelajah: true }.");
      }
      if (!kerja.daftar.length) { berhentiKarena = "daftar kerja habis"; break; }

      var kemajuan = 0;
      for (var i = 0; i < kerja.daftar.length && !berhenti; i++) {
        var item = kerja.daftar[i];
        var baris = { uri: item.frbr_uri, hasil: "", ukuran: 0 };
        hasil.push(baris);
        try {
          var ambilan = await ambilPdfUntuk(ctx, item);
          if (ambilan.lewati) {
            baris.hasil = "lewati: " + ambilan.lewati;
          } else if (ambilan.tanpaBerkas) {
            baris.hasil = "tanpa berkas di BPK";
            if (/tak dikenali/.test(ambilan.tanpaBerkas)) console.warn("[Lexa panen] " + item.frbr_uri + ": " + ambilan.tanpaBerkas + " — " + item.detail_url + ". Jalankan { periksa: true } di halaman itu bila banyak yang begini.");
            if (!opsi.kering) await kirimJson(ctx.lexaMinta, "/api/impor/tanpa-berkas", { uris: [item.frbr_uri], alasan: ambilan.tanpaBerkas });
            kemajuan++;
            gagalBeruntun = 0;
          } else {
            baris.ukuran = ambilan.pdf.byteLength;
            if (opsi.kering) {
              baris.hasil = "kering: PDF terunduh, tak diunggah";
            } else {
              var jawab = await ctx.lexaMinta("/api/impor/pdf?uri=" + encodeURIComponent(item.frbr_uri), { method: "PUT", body: ambilan.pdf });
              baris.hasil = "diunggah (" + (jawab && jawab.status ? jawab.status : "ok") + ")";
              kemajuan++;
            }
            gagalBeruntun = 0;
          }
        } catch (e) {
          if (e && e.fatal) throw e;
          if (pesan(e) === "dihentikan") { baris.hasil = "dihentikan"; break; }
          baris.hasil = "GAGAL: " + pesan(e);
          gagalBeruntun++;
          console.warn("[Lexa panen] " + item.frbr_uri + ": " + baris.hasil);
          if (gagalBeruntun >= MAKS_GAGAL_BERUNTUN) {
            berhentiKarena = MAKS_GAGAL_BERUNTUN + " kegagalan beruntun";
            console.error("[Lexa panen] " + MAKS_GAGAL_BERUNTUN + " kegagalan beruntun: putaran dihentikan. Periksa sesi BPK (muat ulang halaman dan selesaikan tantangan), lalu jalankan lagi.");
            break;
          }
        }
        var diunggah = hasil.filter(function (b) { return b.hasil.indexOf("diunggah") === 0; }).length;
        if (ctx.papan) ctx.papan.tulis("Panen PDF: " + angka(diunggah) + " diunggah dari " + angka(hasil.length) + " diproses\nTerakhir: " + item.frbr_uri + "\n" + baris.hasil);
        console.log("[Lexa panen] " + (i + 1) + "/" + kerja.daftar.length + " " + item.frbr_uri + " — " + baris.hasil);
        if (i < kerja.daftar.length - 1 && !berhentiKarena) await tungguSopan(jedaAcak(ctx.jeda));
        if (berhentiKarena) break;
      }
      if (berhentiKarena) break;
      if (!opsi.terus) break;
      if (!kemajuan) { berhentiKarena = "tidak ada kemajuan pada putaran ini"; break; }
      await tungguSopan(jedaAcak(ctx.jeda));
    }
    if (berhenti && !berhentiKarena) berhentiKarena = "dihentikan";

    var hitung = function (awalan) { return hasil.filter(function (b) { return b.hasil.indexOf(awalan) === 0; }).length; };
    var ringkas = {
      diproses: hasil.length,
      diunggah: hitung("diunggah"),
      kering: hitung("kering"),
      dilewati: hitung("lewati"),
      tanpaBerkas: hitung("tanpa berkas"),
      gagal: hitung("GAGAL"),
      sisaDiLexa: terakhir ? Math.max(terakhir.total - hitung("diunggah") - hitung("tanpa berkas"), 0) : null,
      berhentiKarena: berhentiKarena,
    };
    return { ringkas: ringkas, hasil: hasil };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Uraikan ulang arsip teks yang diurai dengan versi pengurai lama (tak menyentuh BPK)
  // ---------------------------------------------------------------------------------------------------------------

  async function uraikanUlangUsang(ctx) {
    var opsi = ctx.opsi;
    var batas = Math.min(Math.max(Number(opsi.batas) || 100, 1), 100);
    var jeda = typeof opsi._jedaUsang === "number" ? opsi._jedaUsang : Math.max(Number(opsi.jedaUsang) || 8000, 1000);
    var diantrekan = 0;
    var tersisaAwal = null;
    var tersisa = null;
    var setelah = "";
    var berhentiKarena = "";

    for (var putaran = 1; !berhenti; putaran++) {
      var badan = { usang: true, batas: batas };
      if (setelah) badan.setelah = setelah;
      if (opsi.jenis) badan.jenis = String(opsi.jenis).split(",").map(function (j) { return j.trim(); }).filter(Boolean);
      var jawab = await kirimJson(ctx.lexaMinta, "/api/impor/ekstrak-ulang", badan);
      if (tersisaAwal === null) {
        tersisaAwal = jawab.usang_tersisa;
        console.log("[Lexa panen] " + angka(jawab.usang_tersisa) + " peraturan diurai dengan versi pengurai lama (versi terkini " + jawab.versi_parser + "); diantrekan " + batas + " sekali jalan.");
      }
      tersisa = jawab.usang_tersisa;
      if (!jawab.diantrekan) { berhentiKarena = "tidak ada lagi yang diantrekan"; break; }
      diantrekan += jawab.diantrekan;
      setelah = jawab.terakhir || "";
      var catatan = "Uraikan ulang: " + angka(diantrekan) + " diantrekan; " + angka(tersisa) + " belum diurai ulang di Lexa\nTerakhir: " + setelah;
      if (ctx.papan) ctx.papan.tulis(catatan);
      console.log("[Lexa panen] putaran " + putaran + ": " + jawab.diantrekan + " diantrekan, " + angka(tersisa) + " belum diurai ulang (sampai " + setelah + ")");
      // Antrean Cloudflare mengerjakannya di latar belakang; jeda supaya tidak menumpuk puluhan ribu pesan sekaligus.
      await tungguSopan(jeda);
    }
    if (berhenti && !berhentiKarena) berhentiKarena = "dihentikan";
    return { diantrekan: diantrekan, tersisaAwal: tersisaAwal, tersisaTerakhirDilihat: tersisa, berhentiKarena: berhentiKarena };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Gemini membaca PDF yang tak punya lapisan teks (tak menyentuh BPK)
  // ---------------------------------------------------------------------------------------------------------------

  async function cekGemini(ctx) {
    var j = await ctx.lexaMinta("/api/impor/gemini-cek");
    // Pengaturan yang berlaku (Lexa yang lebih lama tak menyebutnya): berpikir, halaman per panggilan, paralel, dan batas panjang PDF.
    var atur = j.halaman_maks === undefined ? "" : "; pengaturan: berpikir " + (j.berpikir ? JSON.stringify(j.berpikir) : "bawaan model") + ", " + j.halaman_per_panggilan + " halaman per panggilan, " + j.paralel + " paralel, PDF lebih dari " + j.halaman_maks + " halaman ditolak";
    var di = j.lokasi_worker && j.lokasi_worker.colo ? "; Worker berjalan di pusat data " + j.lokasi_worker.colo + (j.lokasi_worker.placement ? " (" + j.lokasi_worker.placement + ")" : "") : "";
    console.log("[Lexa panen] Gemini siap: model " + j.model + " (versi " + j.versi_model + "), " + j.alamat + ", balasan \"" + j.balasan + "\", " + j.durasi_ms + " ms; anggaran token hari ini " + angka(j.anggaran.terpakai) + " dari " + angka(j.anggaran.batas) + atur + di + ".");
    return j;
  }

  async function ujiGemini(ctx) {
    var daftar = [].concat(ctx.opsi.geminiUji).map(String).filter(Boolean);
    var hasil = [];
    for (var i = 0; i < daftar.length && !berhenti; i++) {
      console.log("[Lexa panen] Gemini membaca " + daftar[i] + " (satu sampai beberapa menit)...");
      try {
        var l = await kirimJson(ctx.lexaMinta, "/api/impor/gemini-uji", { uri: daftar[i] });
        hasil.push(l);
        var k = l.kesesuaian_dengan_teks_lama;
        console.log("[Lexa panen] " + l.uri + ": " + l.keputusan.hasil + (l.keputusan.alasan ? " (" + l.keputusan.alasan + ")" : "") + "; " + l.hasil.nomor_pasal_berbeda + " nomor pasal terbaca (" + l.hasil.vonis + "), tersimpan " + l.tersimpan.nomor_pasal_berbeda + " (" + l.tersimpan.vonis + "); halaman " + l.halaman + "/" + (l.halaman_pdf === null ? "?" : l.halaman_pdf) + "; " + angka(l.token.total) + " token, " + Math.round(l.durasi_ms / 1000) + " detik" + (k ? "; sepakat dengan teks lama " + k.gemini_ada_di_lama + "/" + k.lama_ada_di_gemini : "") + (l.masalah.length ? "; MASALAH: " + l.masalah.join(" | ") : ""));
      } catch (e) {
        if (e && e.fatal) throw e;
        hasil.push({ uri: daftar[i], galat: pesan(e) });
        console.warn("[Lexa panen] " + daftar[i] + ": GAGAL: " + pesan(e));
      }
    }
    console.log("[Lexa panen] cuplikan teks hasil bacaan Gemini ada di R2 (teks-ai/<alamat>.md) dan di laporan:", hasil);
    return hasil;
  }

  async function bacaDenganGemini(ctx) {
    var opsi = ctx.opsi;
    await cekGemini(ctx);
    var batas = Math.min(Math.max(Number(opsi.batas) || 3, 1), 20);
    var jedaCek = typeof opsi._jedaGemini === "number" ? opsi._jedaGemini : Math.max(Number(opsi.jedaGemini) || 15000, 1000);
    var maksTunggu = typeof opsi._maksTungguGemini === "number" ? opsi._maksTungguGemini : 15 * 60 * 1000;
    var diantrekan = 0;
    var selesai = 0;
    var setelah = "";
    var tersisa = null;
    var berhentiKarena = "";
    // Berapa peraturan yang sudah dicoba dibaca (apa pun hasilnya), dari ringkasan Lexa: tanda bahwa antrean menyelesaikannya.
    var sudahDicoba = async function () {
      var r = await ctx.lexaMinta("/api/impor/ringkasan");
      var p = (r.gemini && r.gemini.pembacaan) || {};
      return ["dipakai", "dipertahankan", "ditolak", "gagal"].reduce(function (n, k) { return n + (p[k] || 0); }, 0);
    };

    for (var putaran = 1; !berhenti; putaran++) {
      var sebelum = await sudahDicoba();
      var badan = { gemini: true, batas: batas };
      if (setelah) badan.setelah = setelah;
      if (opsi.ulangi) badan.ulangi = true;
      if (opsi.geminiVonis) badan.vonis = String(opsi.geminiVonis).split(",").map(function (v) { return v.trim(); }).filter(Boolean);
      if (opsi.jenis) badan.jenis = String(opsi.jenis).split(",").map(function (j) { return j.trim(); }).filter(Boolean);
      var jawab = await kirimJson(ctx.lexaMinta, "/api/impor/ekstrak-ulang", badan);
      if (jawab.anggaran_habis) { berhentiKarena = "anggaran token harian habis (" + angka(jawab.anggaran.terpakai) + " dari " + angka(jawab.anggaran.batas) + ")"; break; }
      if (!jawab.diantrekan) { berhentiKarena = "tidak ada lagi yang diantrekan"; break; }
      diantrekan += jawab.diantrekan;
      setelah = jawab.terakhir || "";
      tersisa = jawab.gemini_tersisa;
      console.log("[Lexa panen] putaran " + putaran + ": " + jawab.diantrekan + " diantrekan (" + jawab.uris.join(", ") + "); " + angka(tersisa) + " belum dicoba; model " + jawab.model);
      if (ctx.papan) ctx.papan.tulis("Gemini membaca PDF: " + angka(diantrekan) + " diantrekan, " + angka(selesai) + " selesai\nBelum dicoba: " + angka(tersisa));

      // Satu PDF memakan menit dan kuota Gemini terbatas: tunggu Lexa menyelesaikan kelompok ini sebelum mengantrekan yang berikutnya.
      var mulaiTunggu = Date.now();
      var maju = 0;
      while (!berhenti && maju < jawab.diantrekan && Date.now() - mulaiTunggu < maksTunggu) {
        await tunggu(jedaCek);
        maju = (await sudahDicoba()) - sebelum;
      }
      selesai += Math.max(Math.min(maju, jawab.diantrekan), 0);
      if (maju < jawab.diantrekan && !berhenti) {
        berhentiKarena = "kelompok ini belum selesai dibaca dalam " + Math.round(maksTunggu / 60000) + " menit (kuota Google habis atau kunci bermasalah? jalankan { geminiCek: true } dan lihat log Lexa); jalankan lagi untuk melanjutkan";
        break;
      }
    }
    if (berhenti && !berhentiKarena) berhentiKarena = "dihentikan";
    return { diantrekan: diantrekan, selesai: selesai, belumDicoba: tersisa, berhentiKarena: berhentiKarena };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Analisis halaman yang sedang dibuka
  // ---------------------------------------------------------------------------------------------------------------

  function periksaHalamanIni() {
    var meta = bacaMetadata(document);
    var tautan = cariTautanPdf(document, location.href);
    var semuaUnduh = [];
    document.querySelectorAll("a[href]").forEach(function (a) {
      if (/ownload|unduh|\.pdf/i.test(a.getAttribute("href") + " " + teks(a))) semuaUnduh.push({ href: a.getAttribute("href"), teks: teks(a) });
    });
    var entri = kumpulkanEntri(document, location.href);
    var jenis = temukanJenis(document, location.href);
    var halaman = {
      total: bacaTotalDaftar(document),
      nomor: nomorHalaman(location.href),
      relNext: !!document.querySelector("a[rel~='next'][href]"),
      berikut: halamanBerikut(document, location.href, nomorHalaman(location.href)),
      tautanHalaman: Array.prototype.slice.call(document.querySelectorAll("a[href*='page=']")).slice(0, 12).map(function (a) { return { href: a.getAttribute("href"), teks: teks(a) }; }),
    };
    console.log("[Lexa panen] halaman:", location.href, "\njudul:", document.title);
    console.log("[Lexa panen] tabel metadata (" + Object.keys(meta).length + " baris):");
    console.table(meta);
    console.log("[Lexa panen] kandidat tautan PDF (" + tautan.length + "):");
    console.table(tautan);
    console.log("[Lexa panen] semua tautan yang menyebut unduh/download/pdf (" + semuaUnduh.length + "):");
    console.table(semuaUnduh);
    console.log("[Lexa panen] entri daftar (tautan /Details/<id>): " + entri.length + (entri.length ? "; 10 pertama:" : ""));
    if (entri.length) console.table(entri.slice(0, 10).map(function (e) { return { bpk_id: e.bpk_id, slug: e.slug, teks: e.teks.slice(0, 80), pdf_url: e.pdf_url, konteks: e.konteks.slice(0, 80) }; }));
    console.log("[Lexa panen] halaman berikutnya yang akan diikuti:", halaman.berikut, "(rel=next: " + halaman.relNext + ")");
    if (halaman.tautanHalaman.length) console.table(halaman.tautanHalaman);
    console.log("[Lexa panen] tautan jenis dalam cakupan Lexa di halaman ini (" + jenis.length + "):");
    console.table(jenis);
    return { meta: meta, tautanPdf: tautan, tautanUnduh: semuaUnduh, entri: entri.slice(0, 20), jumlahEntri: entri.length, halaman: halaman, jenis: jenis };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Titik masuk
  // ---------------------------------------------------------------------------------------------------------------

  async function lexaPanenBpk(opsi) {
    opsi = opsi || {};
    if (opsi.periksa) return periksaHalamanIni();

    var lexa = String(opsi.lexa || prompt("Alamat Lexa (mis. https://lexa.nama-akun.workers.dev)") || "").trim().replace(/\/+$/, "");
    var token = String(opsi.token || prompt("Token admin Lexa (ADMIN_TOKEN)") || "").trim();
    if (!lexa || !token) { console.warn("[Lexa panen] dibatalkan: alamat atau token kosong."); return null; }

    berhenti = false;
    var jedaMin = typeof opsi._jedaMin === "number" ? opsi._jedaMin : 2000; // _jedaMin: hanya untuk uji otomatis
    var jeda = Math.max(Number(opsi.jeda) || 4000, jedaMin);
    var ctx = {
      opsi: opsi, lexaMinta: buatKlienLexa(lexa, token), papan: opsi.papan === false ? null : buatPapan(),
      jeda: jeda, jedaDaftar: Math.max(Math.round(jeda * 0.75), jedaMin), jedaUlang: typeof opsi._jedaUlang === "number" ? opsi._jedaUlang : 15000,
      pdfPerUri: {},
    };
    var kunci = null;
    try { if (navigator.wakeLock) kunci = await navigator.wakeLock.request("screen"); } catch (e) { /* tidak wajib */ }

    try {
      // Memeriksa token, alamat, dan CORS sejak awal, dan memberi gambaran keadaan sebelum mulai.
      try {
        var awal = await ctx.lexaMinta("/api/impor/ringkasan");
        console.log("[Lexa panen] keadaan Lexa:");
        console.table((awal.per_jenis || []).map(function (r) { return { jenis: r.jenis, total: r.total, bertaut_BPK: r.bertaut_bpk, ber_PDF: r.ber_pdf, berpasal: r.berpasal, perlu_PDF: r.perlu_pdf }; }));
        var gm = awal.gemini;
        if (gm) {
          console.log("[Lexa panen] Gemini: " + (gm.terpasang
            ? "terpasang (" + gm.model + "); membaca otomatis: " + (gm.otomatis && gm.otomatis.mode !== "mati" ? gm.otomatis.mode : "mati")
              + (gm.belum_dibaca ? "; PDF belum dibaca Gemini: " + angka(gm.belum_dibaca.semua) + (gm.calon_belum_dicoba != null ? " (" + angka(gm.calon_belum_dicoba) + " bermasalah)" : "") : "")
              + (gm.anggaran ? "; anggaran token hari ini " + angka(gm.anggaran.terpakai) + " dari " + angka(gm.anggaran.batas) : "")
            : "belum dipasang (secret GEMINI_API)") + ".");
        }
      } catch (e) {
        if (!e || e.status !== 404) throw e;
        // Lexa lama (belum punya /ringkasan dan /tautan): panen PDF biasa tetap jalan, penjelajahan tidak.
        if (opsi.jelajah || opsi.hanyaJelajah) throw new Error("Lexa belum menjalankan versi yang mendukung penjelajahan (404 pada /api/impor/ringkasan). Tunggu deploy terbaru selesai, lalu coba lagi.");
        console.warn("[Lexa panen] Lexa belum menjalankan versi terbaru (tanpa /api/impor/ringkasan); panen PDF tetap dilanjutkan.");
      }
      if (document.hidden) console.warn("[Lexa panen] Tab ini tersembunyi; peramban memperlambat tab semacam itu. Biarkan tab terlihat selama berjalan.");

      if (opsi.geminiCek) return { geminiCek: await cekGemini(ctx) };
      if (opsi.geminiUji) return { geminiUji: await ujiGemini(ctx) };
      if (opsi.gemini) {
        var gem = await bacaDenganGemini(ctx);
        console.log("[Lexa panen] pembacaan Gemini selesai:", gem, "\nHasil tiap peraturan ada di tabel pembacaan_ai (dipakai, dipertahankan, ditolak, gagal) dan di status Lexa.");
        if (ctx.papan) ctx.papan.tulis("Selesai: " + angka(gem.selesai) + " dibaca dari " + angka(gem.diantrekan) + " diantrekan" + (gem.berhentiKarena ? "\n(" + gem.berhentiKarena + ")" : ""));
        return { gemini: gem };
      }

      if (opsi.usang) {
        var ulang = await uraikanUlangUsang(ctx);
        console.log("[Lexa panen] uraian ulang selesai:", ulang, "\nLexa mengerjakan antreannya di latar belakang; kemajuannya tampak lewat jumlah `usang_tersisa` pada panggilan berikutnya.");
        if (ctx.papan) ctx.papan.tulis("Selesai: " + angka(ulang.diantrekan) + " diantrekan" + (ulang.berhentiKarena ? "\n(" + ulang.berhentiKarena + ")" : ""));
        return { usang: ulang };
      }

      var jel = null;
      if (opsi.jelajah || opsi.hanyaJelajah) {
        jel = await jelajahi(ctx);
        console.log("[Lexa panen] penjelajahan selesai:", jel);
        var perhatian = ["tidak_ada", "tidak_dikenali", "ambigu", "bentrok", "gagal"].filter(function (s) { return jel.contoh[s].length; });
        perhatian.forEach(function (s) { console.log("[Lexa panen] contoh entri berstatus " + s + " (maks 15):"); console.table(jel.contoh[s]); });
      }
      if (opsi.hanyaJelajah || berhenti) return { jelajah: jel, ringkas: null, hasil: [] };

      var panen = await panenPdf(ctx);
      console.table(panen.hasil);
      console.log("[Lexa panen] selesai:", panen.ringkas, "\nLexa mengekstrak PDF menjadi pasal di latar belakang; hasilnya tampak di /status dalam beberapa menit.");
      if (ctx.papan) ctx.papan.tulis("Selesai: " + angka(panen.ringkas.diunggah) + " diunggah, " + panen.ringkas.gagal + " gagal" + (panen.ringkas.berhentiKarena ? "\n(" + panen.ringkas.berhentiKarena + ")" : ""));
      return { jelajah: jel, ringkas: panen.ringkas, hasil: panen.hasil };
    } catch (e) {
      if (ctx.papan) ctx.papan.tulis("Berhenti: " + pesan(e));
      throw e;
    } finally {
      try { if (kunci) await kunci.release(); } catch (e) { /* abaikan */ }
      if (ctx.papan) ctx.papan.tutup(opsi._papanTutup === undefined ? 30000 : opsi._papanTutup);
    }
  }

  globalThis.lexaPanenBpk = lexaPanenBpk;
  globalThis.lexaPanenBpkBantu = {
    bacaMetadata: bacaMetadata, cariTautanPdf: cariTautanPdf, kumpulkanEntri: kumpulkanEntri, halamanBerikut: halamanBerikut,
    temukanJenis: temukanJenis, namaJenis: namaJenis, nomorHalaman: nomorHalaman, bacaTotalDaftar: bacaTotalDaftar,
  };
  if (globalThis.LEXA_PANEN_OTOMATIS !== false) {
    lexaPanenBpk(globalThis.LEXA_PANEN || {}).catch(function (e) { console.error("[Lexa panen] galat:", e); });
  }
})();
