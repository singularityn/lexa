// @ts-check
/**
 * Gestur zoom untuk penampil PDF: cubit dua jari, ketuk dua kali, dan Ctrl + roda (cubit di trackpad). Selama gerakan berlangsung
 * halaman cukup diskalakan lewat CSS (`transform`, tanpa menggambar ulang) supaya terasa seketika; saat selesai, penampil
 * diminta memasang zoom sebenarnya dan menggambar ulang halaman yang terlihat. Rumusnya (murni, diuji di test/pdf-cari.test.ts)
 * ada di pdfZoom.js.
 */

import { jarakSentuh, jepit, ketukDua, rasioCubit } from "./pdfZoom.js";

/**
 * Bentuk acara yang dipakai di sini, ditulis sendiri: pustaka tipe DOM yang dipakai proyek ini tak memuat TouchEvent dan WheelEvent.
 * @typedef {Event & { touches: ArrayLike<{ clientX: number, clientY: number }> }} AcaraSentuh
 * @typedef {Event & { ctrlKey: boolean, clientX: number, clientY: number, deltaY: number }} AcaraRoda
 */

/**
 * @typedef {{
 *   ambilZoom: () => number,
 *   min: number,
 *   maks: number,
 *   atur: (zoomBaru: number, fokus: { x: number, y: number }, letakDiLayar: { x: number, y: number }) => void,
 *   ketukDuaDi: (letakDiLayar: { x: number, y: number }, fokus: { x: number, y: number }) => void,
 * }} OpsiGestur
 */

/**
 * Pasang gestur pada penggulir. `lapis` adalah elemen yang diskalakan sementara (isi penggulir). Mengembalikan fungsi pelepas.
 * @param {HTMLElement} gulir
 * @param {HTMLElement} lapis
 * @param {OpsiGestur} o
 * @returns {() => void}
 */
export function pasangGestur(gulir, lapis, o) {
  /** @type {{ jarak: number, zoom: number, rasio: number, fokus: { x: number, y: number }, layar: { x: number, y: number } } | null} */
  let cubitan = null;
  /** @type {{ waktu: number, x: number, y: number } | null} */
  let ketukTerakhir = null;
  /** @type {{ waktu: number, x: number, y: number } | null} */
  let sentuhAwal = null;

  /** Titik di layar (klien) menjadi letak relatif pada penggulir dan titik di dalam isi yang tergulir. @param {number} x @param {number} y */
  function titik(x, y) {
    const k = gulir.getBoundingClientRect();
    const layar = { x: x - k.left, y: y - k.top };
    return { layar, fokus: { x: gulir.scrollLeft + layar.x, y: gulir.scrollTop + layar.y } };
  }

  /** @param {number} rasio @param {{ x: number, y: number }} fokus */
  function skalakan(rasio, fokus) {
    lapis.style.transformOrigin = `${fokus.x}px ${fokus.y}px`;
    lapis.style.transform = rasio === 1 ? "" : `scale(${rasio})`;
  }

  function selesaikan() {
    if (!cubitan) return;
    const { zoom, rasio, fokus, layar } = cubitan;
    cubitan = null;
    skalakan(1, fokus);
    lapis.style.transformOrigin = "";
    if (Math.abs(rasio - 1) > 0.01) o.atur(zoom * rasio, fokus, layar);
  }

  /** @param {AcaraSentuh} e */
  function saatSentuhMulai(e) {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const p = titik((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      cubitan = { jarak: jarakSentuh(a, b), zoom: o.ambilZoom(), rasio: 1, fokus: p.fokus, layar: p.layar };
      sentuhAwal = null;
    } else if (e.touches.length === 1) {
      sentuhAwal = { waktu: Date.now(), x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else {
      sentuhAwal = null;
    }
  }

  /** @param {AcaraSentuh} e */
  function saatSentuhGerak(e) {
    if (cubitan && e.touches.length === 2) {
      e.preventDefault();
      cubitan.rasio = rasioCubit(cubitan.jarak, jarakSentuh(e.touches[0], e.touches[1]), cubitan.zoom, o.min, o.maks);
      skalakan(cubitan.rasio, cubitan.fokus);
      return;
    }
    if (sentuhAwal && e.touches.length === 1 && Math.hypot(e.touches[0].clientX - sentuhAwal.x, e.touches[0].clientY - sentuhAwal.y) > 10) sentuhAwal = null;
  }

  /** @param {AcaraSentuh} e */
  function saatSentuhSelesai(e) {
    if (cubitan) {
      if (e.touches.length < 2) selesaikan();
      sentuhAwal = null;
      ketukTerakhir = null;
      return;
    }
    // Ketukan: satu jari, nyaris tak bergeser, dan singkat.
    if (sentuhAwal && e.touches.length === 0 && Date.now() - sentuhAwal.waktu < 280) {
      const ini = { waktu: Date.now(), x: sentuhAwal.x, y: sentuhAwal.y };
      if (ketukTerakhir && ketukDua(ketukTerakhir, ini)) {
        e.preventDefault();
        const p = titik(ini.x, ini.y);
        ketukTerakhir = null;
        o.ketukDuaDi(p.layar, p.fokus);
      } else {
        ketukTerakhir = ini;
      }
    }
    sentuhAwal = null;
  }

  function saatSentuhBatal() {
    if (cubitan) {
      const { fokus } = cubitan;
      cubitan = null;
      skalakan(1, fokus);
      lapis.style.transformOrigin = "";
    }
    sentuhAwal = null;
  }

  // Ctrl + roda (juga cubitan di trackpad): rasio dikumpulkan selama roda berputar, lalu dipasang sekali.
  /** @type {{ rasio: number, fokus: { x: number, y: number }, layar: { x: number, y: number }, zoom: number } | null} */
  let roda = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let pewaktuRoda;
  const hentikanPewaktu = () => {
    if (pewaktuRoda !== undefined) clearTimeout(pewaktuRoda);
  };

  /** @param {AcaraRoda} e */
  function saatRoda(e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    if (!roda) {
      const p = titik(e.clientX, e.clientY);
      roda = { rasio: 1, fokus: p.fokus, layar: p.layar, zoom: o.ambilZoom() };
    }
    roda.rasio = jepit(roda.rasio * Math.exp(-e.deltaY * 0.01), o.min / roda.zoom, o.maks / roda.zoom);
    skalakan(roda.rasio, roda.fokus);
    hentikanPewaktu();
    pewaktuRoda = setTimeout(() => {
      if (!roda) return;
      const { rasio, zoom, fokus, layar } = roda;
      roda = null;
      skalakan(1, fokus);
      lapis.style.transformOrigin = "";
      if (Math.abs(rasio - 1) > 0.01) o.atur(zoom * rasio, fokus, layar);
    }, 140);
  }

  /** @type {Array<[string, (e: any) => void, AddEventListenerOptions]>} */
  const pendengar = [
    ["touchstart", saatSentuhMulai, { passive: true }],
    ["touchmove", saatSentuhGerak, { passive: false }],
    ["touchend", saatSentuhSelesai, { passive: false }],
    ["touchcancel", saatSentuhBatal, { passive: true }],
    ["wheel", saatRoda, { passive: false }],
  ];
  for (const [nama, fn, opsi] of pendengar) gulir.addEventListener(nama, fn, opsi);
  return () => {
    hentikanPewaktu();
    for (const [nama, fn] of pendengar) gulir.removeEventListener(nama, fn);
  };
}
