/**
 * Pembangkit PDF minimal untuk tes: tiap halaman berisi baris-baris teks Helvetica (tanpa penyisipan font), dengan tabel
 * xref yang benar sehingga PDF.js membacanya tanpa perbaikan. Dipakai e2e penampil PDF; tak ada pustaka PDF di repo.
 */

/** Teks yang aman di dalam string PDF: kurung dan garis miring dilolos, selain ASCII dibuang. */
const lolos = (t) => t.replace(/[^\x20-\x7e]/g, "?").replace(/([()\\])/g, "\\$1");

/**
 * @param {string[][]} halaman baris-baris teks tiap halaman
 * @param {{ lebar?: number, tinggi?: number, tanpaTeks?: boolean }} [opsi]
 *   tanpaTeks: halaman hanya berisi gambar vektor (kotak), tanpa teks sama sekali: meniru PDF hasil pindaian
 * @returns {Buffer}
 */
export function buatPdf(halaman, { lebar = 595, tinggi = 842, tanpaTeks = false } = {}) {
  const jumlah = halaman.length;
  const idFont = 3 + jumlah * 2;
  /** @type {string[]} */
  const objek = [];
  objek[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objek[2] = `<< /Type /Pages /Kids [${halaman.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${jumlah} >>`;
  halaman.forEach((baris, i) => {
    const idHalaman = 3 + i * 2;
    const idIsi = idHalaman + 1;
    const isi = tanpaTeks
      ? `0.3 g 72 ${tinggi - 200} ${lebar - 144} 120 re f`
      : `BT /F1 16 Tf 72 ${tinggi - 62} Td 24 TL ${baris.map((b) => `(${lolos(b)}) Tj T*`).join(" ")} ET`;
    objek[idHalaman] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${lebar} ${tinggi}] /Contents ${idIsi} 0 R /Resources << /Font << /F1 ${idFont} 0 R >> >> >>`;
    objek[idIsi] = `<< /Length ${isi.length} >>\nstream\n${isi}\nendstream`;
  });
  objek[idFont] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let keluar = "%PDF-1.4\n";
  /** @type {number[]} */
  const posisi = [];
  for (let id = 1; id <= idFont; id++) {
    posisi[id] = keluar.length;
    keluar += `${id} 0 obj\n${objek[id]}\nendobj\n`;
  }
  const xref = keluar.length;
  keluar += `xref\n0 ${idFont + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= idFont; id++) keluar += `${String(posisi[id]).padStart(10, "0")} 00000 n \n`;
  keluar += `trailer\n<< /Size ${idFont + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(keluar, "latin1");
}

/**
 * Naskah contoh bergaya undang-undang: tiap pasal berjudul "Pasal N" pada barisnya sendiri, beberapa pasal per halaman.
 * Pasal 1-3 di halaman 1, 4-6 di halaman 2, dan seterusnya; halaman terakhir memuat "PENJELASAN" yang memakai ulang
 * "Pasal 1" (harus tak menggeser halaman pasal 1).
 * @param {number} jumlahPasal
 * @param {number} [perHalaman]
 */
export function naskahContoh(jumlahPasal, perHalaman = 3) {
  /** @type {string[][]} */
  const halaman = [];
  for (let n = 1; n <= jumlahPasal; n++) {
    const i = Math.floor((n - 1) / perHalaman);
    (halaman[i] ??= i === 0 ? ["UNDANG-UNDANG CONTOH", ""] : []).push(`Pasal ${n}`, `Setiap orang wajib mematuhi ketentuan nomor ${n}.`, "");
  }
  halaman.push(["PENJELASAN", "Pasal 1", "Cukup jelas."]);
  return halaman;
}
