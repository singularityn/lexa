/**
 * Panen PDF peraturan dari peraturan.bpk.go.id untuk Lexa.
 *
 * KENAPA ADA: pasal.id sejak 11 Okt 2026 hanya memberi metadata lewat API-nya, jadi teks UUD, Tap MPR, UU, Perppu, dan
 * PP yang belum ada di Lexa hanya bisa datang dari naskah resmi. Seluruh situs BPK berada di balik Cloudflare managed
 * challenge dan Worker Lexa tidak pernah menghubunginya, jadi pengambilan dikerjakan DARI PERAMBAN ANDA SENDIRI, dengan
 * sesi yang sudah lolos challenge: skrip ini menanyakan ke Lexa peraturan mana yang perlu teksnya, membuka halaman
 * rinciannya di BPK, mengunduh PDF-nya, dan mengunggahnya ke Lexa, yang mengekstraknya menjadi pasal
 * (PUT /api/impor/pdf, lalu antrean ekstrak_pdf).
 *
 * CARA PAKAI
 *  1. Buka https://peraturan.bpk.go.id/ di peramban, selesaikan tantangan "Verify you are human" bila muncul.
 *  2. Buka DevTools > Console (F12), tempel seluruh isi berkas ini, tekan Enter.
 *  3. Isi alamat Lexa (mis. https://lexa.nama-akun.workers.dev) dan token admin (secret ADMIN_TOKEN; hanya disimpan di
 *     memori halaman, tidak ditulis ke mana pun) pada kotak yang muncul.
 *  Skrip memproses peraturan satu per satu dengan jeda beberapa detik, berhenti sendiri bila berulang kali gagal (mis.
 *  sesi BPK kedaluwarsa), dan mencetak ringkasan. Jalankan lagi untuk melanjutkan: yang PDF-nya sudah terunggah tidak
 *  muncul lagi di daftar kerja.
 *
 * OPSI (opsional; setel sebelum menempel, mis. `window.LEXA_PANEN = { batas: 20, kering: true }`)
 *   lexa, token   alamat dan token admin (bila tidak diisi, ditanyakan lewat kotak dialog)
 *   batas         paling banyak berapa peraturan dalam satu putaran (bawaan 50, maksimum 200)
 *   jenis         "UU,PP" untuk menyaring jenis (bawaan: seluruh cakupan Lexa)
 *   celah         true: sertakan juga peraturan yang teksnya baru sebagian (nomor pasal bercelah)
 *   jeda          jeda minimum antarperaturan dalam milidetik (bawaan 4000; jangan dikecilkan)
 *   kering        true: hanya mengecek (cari tautan PDF dan mengunduhnya) tanpa mengunggah ke Lexa
 *   periksa       true: hanya menganalisis halaman yang sedang dibuka (tabel metadata dan tautan unduhan) dan mencetaknya;
 *                 berguna bila BPK mengubah susunan halamannya, supaya pemilih di bawah bisa disesuaikan
 *
 * CATATAN: skrip ini ditulis berdasarkan susunan halaman rincian BPK (tabel metadata dan tautan /Download/) dan belum
 * pernah dijalankan pada situs sungguhan dari lingkungan pengembangan Lexa (situs itu tak terjangkau di sana). Coba dengan
 * `kering: true` dan `batas: 3` dulu; bila tautan PDF tak ditemukan, jalankan dengan `periksa: true` di halaman rincian
 * dan kirim hasilnya agar pemilihnya diperbaiki. Hormati ketentuan situs BPK: satu permintaan sekali, jeda tetap.
 */
(function () {
  "use strict";

  /** Tautan unduhan PDF di halaman rincian BPK: /Download/<id>/<nama>.pdf, atau tautan apa pun yang berujung .pdf. */
  var POLA_TAUTAN_PDF = /\/download\/|\.pdf(?:[?#]|$)/i;
  /** Teks tautan yang lazim untuk unduhan. */
  var POLA_TEKS_UNDUH = /unduh|download|pdf|dokumen|naskah/i;
  /** Tanda halaman tantangan Cloudflare (bukan halaman rincian). */
  var POLA_TANTANGAN = /just a moment|cf-chl|challenge-platform|verify you are human/i;
  /** Berapa kegagalan beruntun sebelum putaran dihentikan. */
  var MAKS_GAGAL_BERUNTUN = 5;

  var tunggu = function (ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); };
  var teks = function (el) { return (el && el.textContent ? el.textContent : "").replace(/\s+/g, " ").trim(); };

  /** Pasangan label -> nilai dari tabel metadata halaman rincian (baris dengan dua sel). */
  function bacaMetadata(doc) {
    var meta = {};
    doc.querySelectorAll("tr").forEach(function (tr) {
      var sel = tr.querySelectorAll(":scope > th, :scope > td");
      if (sel.length === 2) {
        var label = teks(sel[0]).replace(/:$/, "");
        var nilai = teks(sel[1]);
        if (label && nilai && !(label in meta)) meta[label] = nilai;
      }
    });
    return meta;
  }

  /** Semua tautan yang tampak seperti unduhan PDF, yang paling meyakinkan lebih dulu. */
  function cariTautanPdf(doc, dasar) {
    var kandidat = [];
    doc.querySelectorAll("a[href]").forEach(function (a) {
      var href = a.getAttribute("href") || "";
      if (!POLA_TAUTAN_PDF.test(href)) return;
      var mutlak;
      try { mutlak = new URL(href, dasar).href; } catch (e) { return; }
      kandidat.push({ url: mutlak, teks: teks(a), skor: (POLA_TEKS_UNDUH.test(teks(a)) ? 2 : 0) + (/\.pdf(?:[?#]|$)/i.test(href) ? 1 : 0) });
    });
    kandidat.sort(function (a, b) { return b.skor - a.skor; });
    return kandidat;
  }

  /** Halaman rincian sebagai dokumen. Melempar bila galat HTTP atau yang diterima halaman tantangan. */
  async function bacaHalaman(url) {
    var res = await fetch(url, { credentials: "include", headers: { Accept: "text/html" } });
    var html = await res.text();
    if (!res.ok) throw new Error("HTTP " + res.status + " pada halaman rincian");
    var doc = new DOMParser().parseFromString(html, "text/html");
    if (POLA_TANTANGAN.test(html) && !doc.querySelector("a[href*='ownload']")) {
      throw new Error("tantangan_cloudflare: selesaikan tantangan di tab ini (muat ulang halaman), lalu jalankan lagi");
    }
    return doc;
  }

  /** Unduh PDF sebagai ArrayBuffer; menolak yang bukan PDF (mis. halaman tantangan). */
  async function unduhPdf(url) {
    var res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error("HTTP " + res.status + " saat mengunduh PDF");
    var isi = await res.arrayBuffer();
    var kepala = String.fromCharCode.apply(null, new Uint8Array(isi.slice(0, 5)));
    if (kepala !== "%PDF-") throw new Error("yang terunduh bukan PDF (sesi BPK kedaluwarsa atau halaman tantangan)");
    return isi;
  }

  function periksaHalamanIni() {
    var meta = bacaMetadata(document);
    var tautan = cariTautanPdf(document, location.href);
    var semuaUnduh = [];
    document.querySelectorAll("a[href]").forEach(function (a) {
      if (/ownload|unduh|\.pdf/i.test(a.getAttribute("href") + " " + teks(a))) semuaUnduh.push({ href: a.getAttribute("href"), teks: teks(a) });
    });
    console.log("[Lexa panen] halaman:", location.href, "\njudul:", document.title);
    console.log("[Lexa panen] tabel metadata (" + Object.keys(meta).length + " baris):");
    console.table(meta);
    console.log("[Lexa panen] kandidat tautan PDF (" + tautan.length + "):");
    console.table(tautan);
    console.log("[Lexa panen] semua tautan yang menyebut unduh/download/pdf (" + semuaUnduh.length + "):");
    console.table(semuaUnduh);
    return { meta: meta, tautanPdf: tautan, tautanUnduh: semuaUnduh };
  }

  async function lexaPanenBpk(opsi) {
    opsi = opsi || {};
    if (opsi.periksa) return periksaHalamanIni();

    var lexa = String(opsi.lexa || prompt("Alamat Lexa (mis. https://lexa.nama-akun.workers.dev)") || "").trim().replace(/\/+$/, "");
    var token = String(opsi.token || prompt("Token admin Lexa (ADMIN_TOKEN)") || "").trim();
    if (!lexa || !token) { console.warn("[Lexa panen] dibatalkan: alamat atau token kosong."); return null; }
    var jeda = Math.max(Number(opsi.jeda) || 4000, 2000);
    var batas = Math.min(Math.max(Number(opsi.batas) || 50, 1), 200);

    var lexaMinta = async function (path, init) {
      var headers = Object.assign({ "x-admin-token": token }, (init && init.headers) || {});
      var res = await fetch(lexa + path, Object.assign({}, init, { headers: headers }));
      var badan = null;
      try { badan = await res.json(); } catch (e) { /* bukan JSON */ }
      if (!res.ok) throw new Error("Lexa " + res.status + (badan && badan.message ? ": " + badan.message : ""));
      return badan;
    };

    var query = "?batas=" + batas + (opsi.jenis ? "&jenis=" + encodeURIComponent(opsi.jenis) : "") + (opsi.celah ? "&celah=1" : "");
    var kerja = await lexaMinta("/api/impor/butuh-teks" + query);
    console.log("[Lexa panen] " + kerja.total + " peraturan masih perlu teks (" + kerja.tanpa_bpk + " di antaranya tanpa tautan BPK); memproses " + kerja.daftar.length + ".");

    var hasil = [];
    var gagalBeruntun = 0;
    for (var i = 0; i < kerja.daftar.length; i++) {
      var item = kerja.daftar[i];
      var baris = { uri: item.frbr_uri, hasil: "", ukuran: 0 };
      hasil.push(baris);
      if (!item.detail_url) { baris.hasil = "lewati: tak ada tautan BPK"; continue; }
      try {
        var doc = await bacaHalaman(item.detail_url);
        var tautan = cariTautanPdf(doc, item.detail_url);
        if (!tautan.length) throw new Error("tautan PDF tak ditemukan di halaman rincian (jalankan dengan periksa: true di halaman itu)");
        var pdf = await unduhPdf(tautan[0].url);
        baris.ukuran = pdf.byteLength;
        if (opsi.kering) {
          baris.hasil = "kering: PDF terunduh, tak diunggah";
        } else {
          var jawab = await lexaMinta("/api/impor/pdf?uri=" + encodeURIComponent(item.frbr_uri), { method: "PUT", body: pdf });
          baris.hasil = "diunggah (" + (jawab && jawab.status ? jawab.status : "ok") + ")";
        }
        gagalBeruntun = 0;
      } catch (e) {
        baris.hasil = "GAGAL: " + (e && e.message ? e.message : e);
        gagalBeruntun++;
        console.warn("[Lexa panen] " + item.frbr_uri + ": " + baris.hasil);
        if (gagalBeruntun >= MAKS_GAGAL_BERUNTUN) {
          console.error("[Lexa panen] " + MAKS_GAGAL_BERUNTUN + " kegagalan beruntun: putaran dihentikan. Periksa sesi BPK (muat ulang halaman dan selesaikan tantangan), lalu jalankan lagi.");
          break;
        }
      }
      console.log("[Lexa panen] " + (i + 1) + "/" + kerja.daftar.length + " " + item.frbr_uri + " — " + baris.hasil);
      if (i < kerja.daftar.length - 1) await tunggu(jeda + Math.round(Math.random() * jeda * 0.5));
    }

    var ringkas = {
      diproses: hasil.length,
      diunggah: hasil.filter(function (b) { return b.hasil.indexOf("diunggah") === 0; }).length,
      kering: hasil.filter(function (b) { return b.hasil.indexOf("kering") === 0; }).length,
      dilewati: hasil.filter(function (b) { return b.hasil.indexOf("lewati") === 0; }).length,
      gagal: hasil.filter(function (b) { return b.hasil.indexOf("GAGAL") === 0; }).length,
      sisaDiLexa: Math.max(kerja.total - hasil.filter(function (b) { return b.hasil.indexOf("diunggah") === 0; }).length, 0),
    };
    console.table(hasil);
    console.log("[Lexa panen] selesai:", ringkas, "\nLexa mengekstrak PDF menjadi pasal di latar belakang; hasilnya tampak di /status dalam beberapa menit.");
    return { ringkas: ringkas, hasil: hasil };
  }

  globalThis.lexaPanenBpk = lexaPanenBpk;
  globalThis.lexaPanenBpkBantu = { bacaMetadata: bacaMetadata, cariTautanPdf: cariTautanPdf };
  if (globalThis.LEXA_PANEN_OTOMATIS !== false) {
    lexaPanenBpk(globalThis.LEXA_PANEN || {}).catch(function (e) { console.error("[Lexa panen] galat:", e); });
  }
})();
