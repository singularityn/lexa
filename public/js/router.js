// @ts-check
/**
 * Router sisi klien berbasis History API.
 *
 * Rute dicocokkan persis menurut path (parameter berada di query string, mis.
 * `/peraturan?uri=...`, sehingga cocok dengan URL pada sitemap). Setiap halaman
 * dimuat malas lewat import() dan menggambar dirinya sendiri ke elemen <main>.
 */

/**
 * @typedef {{
 *   url: URL,
 *   params: URLSearchParams,
 *   akar: HTMLElement,
 *   sinyal: AbortSignal,
 *   setJudul: (judul: string, deskripsi?: string) => void,
 *   pergi: (url: string, opsi?: { ganti?: boolean }) => void,
 *   perbaruiUrl: (url: string) => void,
 *   saatKeluar: (fn: () => void) => void,
 *   keJangkar: () => void,
 * }} Konteks
 * @typedef {{ halaman: string, muat: () => Promise<{ default: (ctx: Konteks) => Promise<void> | void }> }} Rute
 */

const NAMA_SITUS = "Lexa";

/**
 * @param {{ rute: Record<string, Rute>, akar: HTMLElement, pengumuman: HTMLElement, tidakDitemukan: Rute, saatBerubah?: (path: string) => void }} opsi
 */
export function buatRouter({ rute, akar, pengumuman, tidakDitemukan, saatBerubah }) {
  /** @type {AbortController | null} */
  let pengendali = null;
  /** @type {Array<() => void>} */
  let pembersih = [];
  let nomor = 0;
  /** Kunci path+query yang sedang tergambar, untuk membedakan perubahan hash saja. */
  let kunciSaatIni = "";

  /** @param {string} path */
  const normal = (path) => (path.length > 1 ? path.replace(/\/+$/, "") : path) || "/";

  function bersihkan() {
    for (const fn of pembersih.splice(0)) {
      try {
        fn();
      } catch (e) {
        console.error("pembersih halaman gagal", e);
      }
    }
    pengendali?.abort();
    pengendali = null;
  }

  /** Gulir ke elemen pada hash (bila ada), kalau tidak ke atas. */
  function keJangkar() {
    const id = decodeURIComponent(location.hash.slice(1));
    const el = id ? document.getElementById(id) : null;
    if (el) {
      el.scrollIntoView({ block: "start" });
      el.classList.add("disorot");
      setTimeout(() => el.classList.remove("disorot"), 2500);
    }
  }

  /** @param {{ gulir?: boolean }} [opsi] */
  async function tampil(opsi = {}) {
    const giliran = ++nomor;
    bersihkan();
    const url = new URL(location.href);
    const path = normal(url.pathname);
    kunciSaatIni = path + url.search;
    saatBerubah?.(path);

    const entri = rute[path] ?? tidakDitemukan;
    pengendali = new AbortController();
    const sinyal = pengendali.signal;

    /** @type {Konteks} */
    const ctx = {
      url,
      params: url.searchParams,
      akar,
      sinyal,
      setJudul(judul, deskripsi) {
        if (giliran !== nomor) return;
        document.title = judul === NAMA_SITUS ? `${NAMA_SITUS}: cari peraturan perundang-undangan Indonesia` : `${judul} · ${NAMA_SITUS}`;
        pengumuman.textContent = judul;
        if (deskripsi) document.querySelector('meta[name="description"]')?.setAttribute("content", deskripsi);
      },
      pergi: (tujuan, o) => navigasi(tujuan, o),
      perbaruiUrl(tujuan) {
        history.replaceState(null, "", tujuan);
        const u = new URL(location.href);
        kunciSaatIni = normal(u.pathname) + u.search;
      },
      saatKeluar: (fn) => void pembersih.push(fn),
      keJangkar,
    };

    akar.setAttribute("aria-busy", "true");
    try {
      const modul = await entri.muat();
      if (giliran !== nomor) return;
      await modul.default(ctx);
    } catch (e) {
      if (giliran !== nomor || (e instanceof DOMException && e.name === "AbortError")) return;
      console.error(e);
      akar.replaceChildren(
        Object.assign(document.createElement("div"), {
          className: "galat bungkus",
          textContent: "Halaman ini gagal dimuat. Muat ulang halaman atau coba beberapa saat lagi.",
        }),
      );
    } finally {
      if (giliran === nomor) akar.removeAttribute("aria-busy");
    }
    if (giliran !== nomor) return;

    if (opsi.gulir !== false) {
      if (location.hash) keJangkar();
      else window.scrollTo(0, 0);
      akar.focus({ preventScroll: true });
    }
  }

  /**
   * @param {string} tujuan
   * @param {{ ganti?: boolean }} [opsi]
   */
  function navigasi(tujuan, opsi = {}) {
    const u = new URL(tujuan, location.origin);
    if (u.origin !== location.origin) {
      location.href = u.href;
      return;
    }
    const sama = u.pathname + u.search === location.pathname + location.search;
    if (opsi.ganti || (sama && u.hash === location.hash)) history.replaceState(null, "", u.pathname + u.search + u.hash);
    else history.pushState(null, "", u.pathname + u.search + u.hash);
    return void tampil();
  }

  /** @param {MouseEvent} e */
  function saatKlik(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = /** @type {Element | null} */ (e.target instanceof Element ? e.target : null)?.closest("a[href]");
    if (!(a instanceof HTMLAnchorElement)) return;
    if (a.target && a.target !== "_self") return;
    if (a.hasAttribute("download") || a.dataset.luar !== undefined) return;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin) return;
    // Berkas statis dan API ditangani peramban, bukan router.
    if (u.pathname.startsWith("/api/") || /\.[a-z0-9]{2,5}$/i.test(u.pathname)) return;
    // Hash pada halaman yang sama: biarkan peramban menggulir.
    if (u.pathname + u.search === location.pathname + location.search && u.hash) return;
    e.preventDefault();
    navigasi(u.pathname + u.search + u.hash);
  }

  return {
    mulai() {
      document.addEventListener("click", saatKlik);
      window.addEventListener("popstate", () => {
        const u = new URL(location.href);
        // Perubahan hash saja (mis. tombol kembali antar-jangkar) tidak menggambar ulang halaman.
        if (normal(u.pathname) + u.search === kunciSaatIni) {
          if (location.hash) keJangkar();
          return;
        }
        void tampil({ gulir: !location.hash });
        if (location.hash) setTimeout(keJangkar, 60);
      });
      return tampil();
    },
    pergi: navigasi,
    /** @param {string} tujuan */
    perbaruiUrl(tujuan) {
      history.replaceState(null, "", tujuan);
      const u = new URL(location.href);
      kunciSaatIni = normal(u.pathname) + u.search;
    },
  };
}
