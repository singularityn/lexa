// @ts-check
import { h } from "../dom.js";
import { koleksi, pantau, sesi } from "../state.js";
import { GalatApi } from "../api.js";
import { ikon } from "./ikon.js";
import { toast } from "./toast.js";

/**
 * Tombol simpan/lepas dari koleksi. Mengikuti perubahan koleksi dari tempat lain
 * (mis. tombol yang sama di kartu lain) lewat peristiwa "koleksi".
 *
 * @param {{ uri: string, sitasi: string, judul: string }} peraturan
 * @param {{ denganTeks?: boolean }} [opsi]
 */
export function tombolTandai(peraturan, opsi = {}) {
  const tombol = /** @type {HTMLButtonElement} */ (
    h("button", { type: "button", class: ["tombol", opsi.denganTeks ? "" : "tombol-kecil tombol-hantu"].filter(Boolean).join(" ") })
  );

  function gambar() {
    const tersimpan = koleksi.ada(peraturan.uri);
    tombol.setAttribute("aria-pressed", String(tersimpan));
    tombol.classList.toggle("aktif", tersimpan);
    const label = tersimpan ? "Lepas dari koleksi" : "Simpan ke koleksi";
    tombol.title = label;
    tombol.replaceChildren(
      ikon("tandai", { isi: tersimpan }),
      opsi.denganTeks ? h("span", null, tersimpan ? "Tersimpan" : "Simpan") : h("span", { class: "sr-only" }, `${label}: ${peraturan.sitasi}`),
    );
  }

  tombol.addEventListener("click", async () => {
    tombol.disabled = true;
    try {
      if (koleksi.ada(peraturan.uri)) {
        await koleksi.hapus(peraturan.uri);
        toast("Dilepas dari koleksi.");
      } else {
        await koleksi.simpan(peraturan);
        toast(sesi.data.masuk ? "Disimpan ke koleksi akun Anda." : "Disimpan di perangkat ini.");
      }
    } catch (e) {
      toast(e instanceof GalatApi ? e.message : "Koleksi gagal diperbarui.", { galat: true });
    } finally {
      tombol.disabled = false;
      gambar();
    }
  });

  gambar();
  // Pendengar dilepas otomatis bila tombol sudah tidak ada di dokumen.
  const berhenti = pantau("koleksi", () => {
    if (!tombol.isConnected) berhenti();
    else gambar();
  });
  return tombol;
}
