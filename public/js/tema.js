// Dimuat sinkron di <head> agar tema tersimpan terpasang sebelum halaman digambar
// (tanpa kilatan terang saat tema gelap dipilih). Sengaja berkas terpisah: CSP
// melarang skrip sebaris.
try {
  var t = localStorage.getItem("lexa:tema");
  if (t === "terang" || t === "gelap") document.documentElement.dataset.tema = t;
} catch (e) {
  // Penyimpanan diblokir (mode privat): ikuti pengaturan sistem.
}
