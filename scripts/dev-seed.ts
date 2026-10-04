/**
 * Data contoh untuk pratinjau lokal (`npm run dev:node`).
 *
 * PENTING: ini data uji. Judul peraturan nyata, tetapi isi pasal berupa parafrase
 * singkat untuk memperagakan antarmuka, BUKAN naskah resmi. Server pratinjau
 * menampilkan pita peringatan agar tidak tertukar dengan data produksi.
 */
import type { Lingkungan, PeraturanUji, RelasiUji } from "../test/integration/harness";

export const PERATURAN_CONTOH: Array<PeraturanUji & { tanggal?: string; ringkasan?: string }> = [
  {
    uri: "/akn/id/act/uu/2003/13", jenis: "UU", nomor: "13", tahun: 2003, judul: "Ketenagakerjaan",
    tentang: "Ketenagakerjaan", instansi: "Presiden Republik Indonesia", bidang: "KETENAGAKERJAAN", bpkId: "1001",
    tanggal: "2003-03-25",
    ringkasan: "Mengatur hubungan kerja, waktu kerja dan istirahat, pengupahan, perlindungan pekerja, serta pemutusan hubungan kerja di Indonesia.",
    pasal: [
      { nomor: "1", bab: "BAB I KETENTUAN UMUM", isi: "Dalam undang-undang ini yang dimaksud dengan ketenagakerjaan adalah segala hal yang berhubungan dengan tenaga kerja pada waktu sebelum, selama, dan sesudah masa kerja." },
      { nomor: "77", ayat: "1", bab: "BAB X PERLINDUNGAN, PENGUPAHAN, DAN KESEJAHTERAAN", isi: "Setiap pengusaha wajib melaksanakan ketentuan waktu kerja." },
      { nomor: "77", ayat: "2", bab: "BAB X PERLINDUNGAN, PENGUPAHAN, DAN KESEJAHTERAAN", isi: "Waktu kerja meliputi 7 (tujuh) jam 1 (satu) hari dan 40 (empat puluh) jam 1 (satu) minggu untuk 6 (enam) hari kerja dalam 1 (satu) minggu, atau 8 (delapan) jam 1 (satu) hari dan 40 (empat puluh) jam 1 (satu) minggu untuk 5 (lima) hari kerja dalam 1 (satu) minggu." },
      { nomor: "79", ayat: "2", bab: "BAB X PERLINDUNGAN, PENGUPAHAN, DAN KESEJAHTERAAN", isi: "Waktu istirahat dan cuti meliputi istirahat antara jam kerja, istirahat mingguan, dan cuti tahunan sekurang-kurangnya 12 (dua belas) hari kerja setelah pekerja bekerja selama 12 (dua belas) bulan secara terus-menerus." },
      { nomor: "82", ayat: "1", bab: "BAB X PERLINDUNGAN, PENGUPAHAN, DAN KESEJAHTERAAN", isi: "Pekerja perempuan berhak memperoleh istirahat selama 1,5 (satu setengah) bulan sebelum saatnya melahirkan anak dan 1,5 (satu setengah) bulan sesudah melahirkan menurut perhitungan dokter kandungan atau bidan." },
      { nomor: "82", ayat: "2", bab: "BAB X PERLINDUNGAN, PENGUPAHAN, DAN KESEJAHTERAAN", isi: "Pekerja perempuan yang mengalami keguguran kandungan berhak memperoleh istirahat 1,5 (satu setengah) bulan atau sesuai dengan surat keterangan dokter kandungan atau bidan." },
      { nomor: "156", ayat: "1", bab: "BAB XII PEMUTUSAN HUBUNGAN KERJA", isi: "Dalam hal terjadi pemutusan hubungan kerja, pengusaha wajib membayar uang pesangon dan atau uang penghargaan masa kerja dan uang penggantian hak yang seharusnya diterima." },
    ],
  },
  {
    uri: "/akn/id/act/uu/2020/11", jenis: "UU", nomor: "11", tahun: 2020, judul: "Cipta Kerja",
    status: "dicabut", tentang: "Cipta Kerja", instansi: "Presiden Republik Indonesia", bidang: "EKONOMI - KETENAGAKERJAAN", bpkId: "149750",
    tanggal: "2020-11-02",
    pasal: [
      { nomor: "1", bab: "BAB I KETENTUAN UMUM", isi: "Cipta kerja adalah upaya penciptaan kerja melalui usaha kemudahan, perlindungan, dan pemberdayaan koperasi dan usaha mikro, kecil, dan menengah, peningkatan ekosistem investasi dan kemudahan berusaha, dan investasi pemerintah pusat dan percepatan proyek strategis nasional." },
      { nomor: "2", bab: "BAB I KETENTUAN UMUM", isi: "Undang-Undang ini bertujuan menciptakan dan meningkatkan lapangan kerja dengan memberikan kemudahan, pelindungan, dan pemberdayaan terhadap koperasi dan usaha mikro, kecil, dan menengah." },
    ],
  },
  {
    uri: "/akn/id/act/uu/2023/6", jenis: "UU", nomor: "6", tahun: 2023,
    judul: "Penetapan Peraturan Pemerintah Pengganti Undang-Undang Nomor 2 Tahun 2022 tentang Cipta Kerja menjadi Undang-Undang",
    instansi: "Presiden Republik Indonesia", bidang: "EKONOMI", bpkId: "246523", tanggal: "2023-03-31",
    pasal: [{ nomor: "1", isi: "Peraturan Pemerintah Pengganti Undang-Undang Nomor 2 Tahun 2022 tentang Cipta Kerja (Lembaran Negara Republik Indonesia Tahun 2022 Nomor 238) ditetapkan menjadi undang-undang." }],
  },
  {
    uri: "/akn/id/act/pp/2021/35", jenis: "PP", nomor: "35", tahun: 2021,
    judul: "Perjanjian Kerja Waktu Tertentu, Alih Daya, Waktu Kerja dan Waktu Istirahat, dan Pemutusan Hubungan Kerja",
    instansi: "Presiden Republik Indonesia", bidang: "KETENAGAKERJAAN", bpkId: "161904", tanggal: "2021-02-02",
    ringkasan: "Pelaksanaan UU Cipta Kerja di bidang ketenagakerjaan: PKWT, alih daya, waktu kerja dan istirahat, serta pemutusan hubungan kerja beserta hak yang menyertainya.",
    pasal: [
      { nomor: "40", ayat: "1", bab: "BAB V PEMUTUSAN HUBUNGAN KERJA", isi: "Dalam hal terjadi pemutusan hubungan kerja, pengusaha wajib membayar uang pesangon dan atau uang penghargaan masa kerja dan uang penggantian hak yang seharusnya diterima." },
      { nomor: "40", ayat: "2", bab: "BAB V PEMUTUSAN HUBUNGAN KERJA", isi: "Uang pesangon sebagaimana dimaksud pada ayat (1) diberikan dengan perhitungan sesuai masa kerja pekerja." },
      { nomor: "81", bab: "BAB V PEMUTUSAN HUBUNGAN KERJA", isi: "Pemutusan hubungan kerja hanya dapat dilakukan setelah pengusaha memberitahukan maksud dan alasan pemutusan kepada pekerja." },
    ],
  },
  {
    uri: "/akn/id/act/uu/2022/27", jenis: "UU", nomor: "27", tahun: 2022, judul: "Pelindungan Data Pribadi",
    tentang: "Pelindungan Data Pribadi", instansi: "Presiden Republik Indonesia", bidang: "KOMUNIKASI DAN INFORMATIKA", bpkId: "229798", tanggal: "2022-10-17",
    ringkasan: "Mengatur hak subjek data pribadi, kewajiban pengendali dan prosesor data pribadi, transfer data lintas negara, serta sanksi administratif dan pidana.",
    pasal: [
      { nomor: "1", bab: "BAB I KETENTUAN UMUM", isi: "Data Pribadi adalah data tentang orang perseorangan yang teridentifikasi atau dapat diidentifikasi secara tersendiri atau dikombinasikan dengan informasi lainnya baik secara langsung maupun tidak langsung melalui sistem elektronik atau nonelektronik." },
      { nomor: "4", ayat: "1", bab: "BAB III JENIS DATA PRIBADI", isi: "Data Pribadi terdiri atas Data Pribadi yang bersifat spesifik dan Data Pribadi yang bersifat umum." },
      { nomor: "20", ayat: "1", bab: "BAB IV HAK SUBJEK DATA PRIBADI", isi: "Pengendali Data Pribadi wajib memiliki dasar pemrosesan Data Pribadi." },
      { nomor: "46", ayat: "1", bab: "BAB VI KEWAJIBAN PENGENDALI DAN PROSESOR DATA PRIBADI", isi: "Dalam hal terjadi kegagalan Pelindungan Data Pribadi, Pengendali Data Pribadi wajib menyampaikan pemberitahuan secara tertulis paling lambat 3 x 24 (tiga kali dua puluh empat) jam kepada Subjek Data Pribadi dan lembaga." },
    ],
  },
  {
    uri: "/akn/id/act/uu/2008/11", jenis: "UU", nomor: "11", tahun: 2008, judul: "Informasi dan Transaksi Elektronik",
    status: "diubah", instansi: "Presiden Republik Indonesia", bidang: "KOMUNIKASI DAN INFORMATIKA", bpkId: "37589", tanggal: "2008-04-21",
    pasal: [
      { nomor: "1", ayat: "1", bab: "BAB I KETENTUAN UMUM", isi: "Informasi Elektronik adalah satu atau sekumpulan data elektronik, termasuk tetapi tidak terbatas pada tulisan, suara, gambar, peta, rancangan, foto, electronic data interchange (EDI), surat elektronik (electronic mail), telegram, teleks, telecopy atau sejenisnya." },
      { nomor: "5", ayat: "1", bab: "BAB III INFORMASI, DOKUMEN, DAN TANDA TANGAN ELEKTRONIK", isi: "Informasi Elektronik dan/atau Dokumen Elektronik dan/atau hasil cetaknya merupakan alat bukti hukum yang sah." },
    ],
  },
  {
    uri: "/akn/id/act/uu/2016/19", jenis: "UU", nomor: "19", tahun: 2016, judul: "Perubahan atas Undang-Undang Nomor 11 Tahun 2008 tentang Informasi dan Transaksi Elektronik",
    instansi: "Presiden Republik Indonesia", bidang: "KOMUNIKASI DAN INFORMATIKA", bpkId: "37582", tanggal: "2016-11-25",
    pasal: [{ nomor: "I", isi: "Beberapa ketentuan dalam Undang-Undang Nomor 11 Tahun 2008 tentang Informasi dan Transaksi Elektronik diubah." }],
  },
  {
    uri: "/akn/id/act/uu/1974/1", jenis: "UU", nomor: "1", tahun: 1974, judul: "Perkawinan",
    status: "diubah", instansi: "Presiden Republik Indonesia", bidang: "HUKUM KELUARGA", bpkId: "47406", tanggal: "1974-01-02",
    pasal: [
      { nomor: "1", bab: "BAB I DASAR PERKAWINAN", isi: "Perkawinan ialah ikatan lahir batin antara seorang pria dengan seorang wanita sebagai suami isteri dengan tujuan membentuk keluarga (rumah tangga) yang bahagia dan kekal berdasarkan Ketuhanan Yang Maha Esa." },
      { nomor: "7", ayat: "1", bab: "BAB II SYARAT-SYARAT PERKAWINAN", isi: "Perkawinan hanya diizinkan apabila pihak pria dan wanita sudah mencapai umur 19 (sembilan belas) tahun." },
    ],
  },
  {
    uri: "/akn/id/act/uu/2019/16", jenis: "UU", nomor: "16", tahun: 2019, judul: "Perubahan atas Undang-Undang Nomor 1 Tahun 1974 tentang Perkawinan",
    instansi: "Presiden Republik Indonesia", bidang: "HUKUM KELUARGA", bpkId: "122740", tanggal: "2019-10-15",
    pasal: [{ nomor: "I", isi: "Ketentuan Pasal 7 Undang-Undang Nomor 1 Tahun 1974 tentang Perkawinan diubah sehingga batas usia perkawinan bagi pria dan wanita sama, yaitu 19 (sembilan belas) tahun." }],
  },
  {
    uri: "/akn/id/act/uu/2014/28", jenis: "UU", nomor: "28", tahun: 2014, judul: "Hak Cipta",
    instansi: "Presiden Republik Indonesia", bidang: "HAK KEKAYAAN INTELEKTUAL", bpkId: "38690", tanggal: "2014-10-16",
    pasal: [
      { nomor: "1", ayat: "1", bab: "BAB I KETENTUAN UMUM", isi: "Hak Cipta adalah hak eksklusif pencipta yang timbul secara otomatis berdasarkan prinsip deklaratif setelah suatu ciptaan diwujudkan dalam bentuk nyata tanpa mengurangi pembatasan sesuai dengan ketentuan peraturan perundang-undangan." },
      { nomor: "42", bab: "BAB V PEMBATASAN HAK CIPTA", isi: "Tidak ada Hak Cipta atas hasil rapat terbuka lembaga negara, peraturan perundang-undangan, pidato kenegaraan atau pidato pejabat pemerintah, putusan pengadilan atau penetapan hakim, dan kitab suci atau simbol keagamaan." },
    ],
  },
  {
    uri: "/akn/id/act/perpres/2018/16", jenis: "PERPRES", nomor: "16", tahun: 2018, judul: "Pengadaan Barang/Jasa Pemerintah",
    instansi: "Presiden Republik Indonesia", bidang: "KEUANGAN NEGARA", bpkId: "73888", tanggal: "2018-03-22",
    // Sengaja di luar cakupan (UUD, Tap MPR, UU, Perppu, PP): tersimpan di D1 tetapi tidak tampil di mana pun,
    // seperti baris Perpres, Permen, dan POJK yang sudah ada di produksi. Memperagakan dan menguji penyembunyiannya.
  },
];

export const RELASI_CONTOH: RelasiUji[] = [
  { dari: "/akn/id/act/uu/2020/11", ke: "/akn/id/act/uu/2023/6", jenis: "dicabut_oleh", keterangan: "UU 6/2023" },
  { dari: "/akn/id/act/uu/2023/6", ke: "/akn/id/act/uu/2020/11", jenis: "mencabut", keterangan: "UU 11/2020" },
  { dari: "/akn/id/act/uu/2003/13", ke: "/akn/id/act/uu/2020/11", jenis: "diubah_oleh", keterangan: "diubah sebagian oleh UU Cipta Kerja" },
  { dari: "/akn/id/act/pp/2021/35", ke: "/akn/id/act/uu/2003/13", jenis: "melaksanakan", keterangan: "UU 13/2003" },
  { dari: "/akn/id/act/pp/2021/35", ke: "/akn/id/act/uu/2020/11", jenis: "melaksanakan", keterangan: "UU 11/2020" },
  { dari: "/akn/id/act/uu/2008/11", ke: "/akn/id/act/uu/2016/19", jenis: "diubah_oleh", keterangan: "UU 19/2016" },
  { dari: "/akn/id/act/uu/2016/19", ke: "/akn/id/act/uu/2008/11", jenis: "mengubah", keterangan: "UU 11/2008" },
  { dari: "/akn/id/act/uu/1974/1", ke: "/akn/id/act/uu/2019/16", jenis: "diubah_oleh", keterangan: "UU 16/2019" },
  { dari: "/akn/id/act/uu/2019/16", ke: "/akn/id/act/uu/1974/1", jenis: "mengubah", keterangan: "UU 1/1974" },
  { dari: "/akn/id/act/uu/2003/13", ke: "/akn/id/act/uu/1999/99", jenis: "terkait", keterangan: "peraturan di luar indeks" },
];

/** Pilih beberapa sitasi dari prompt Tanya Lexa dan susun jawaban yang jelas-jelas contoh. */
export function jawabanContoh(prompt: string): string {
  const kutipan = [...prompt.matchAll(/### ([^\n]+)\n([^\n]+)/g)].slice(0, 3);
  if (!kutipan.length) return "Dasar yang cukup tidak ditemukan.";
  const baris = kutipan.map(([, judul, isi]) => `- **${judul.replace(/ \[PERHATIAN.*$/, "")}**: ${isi.length > 150 ? `${isi.slice(0, 150)}…` : isi}`);
  return `Berdasarkan kutipan pasal yang tersedia (jawaban contoh dari pratinjau lokal, bukan dari model AI):\n\n${baris.join("\n")}\n\nPeriksa pasal yang dikutip untuk memastikan ketentuannya sesuai dengan kasus Anda.`;
}

export async function isiDataContoh(l: Lingkungan, sisipkan: (l: Lingkungan, d: PeraturanUji[]) => Promise<void>, sisipkanRelasi: (l: Lingkungan, d: RelasiUji[]) => Promise<void>) {
  await sisipkan(l, PERATURAN_CONTOH);
  for (const p of PERATURAN_CONTOH) {
    await l.db
      .prepare(`UPDATE laws SET tanggal_penetapan = ?, ringkasan = ? WHERE frbr_uri = ?`)
      .bind(p.tanggal ?? null, p.ringkasan ?? null, p.uri)
      .run();
  }
  await sisipkanRelasi(l, RELASI_CONTOH);
}
