/* ============================================================================
   EduTrack Pro v2 — js/app.js (Frontend statis untuk GitHub Pages)
   Arsitektur gas-pro-api: frontend terpisah ↔ Google Apps Script sebagai REST API JSON.
   - Semua panggilan lewat fetch(GAS_URL) POST {action, args} dengan Content-Type text/plain
     (simple request → tanpa preflight CORS). Tanpa jembatan HtmlService, tanpa iframe.
   - js/config.js hanya berisi GAS_URL (publik). Tidak ada rahasia di frontend:
     token sesi dikirim di BODY (bukan URL) dan disimpan di storage perangkat.
   Prinsip instant UX & gas-scale-turbo:
   1) SPA klien         : pindah menu 0 ms, semua halaman dirender di klien
   2) Snapshot lokal    : data terakhir tampil seketika saat dibuka, disegarkan diam-diam
   3) Optimistic UI     : aksi langsung tampil, rollback bila server menolak
   4) Dedupe in-flight  : permintaan baca kembar menumpang satu fetch (epoch tulis)
   5) Antrean notifikasi: email dikirim di luar jalur respons (nq → kurasAntrean latar)
   6) Telemetri         : setiap respons membawa ms server; tampil di Pengaturan admin
   ============================================================================ */
(function () {
  'use strict';

  // ==========================================================================
  // 1. STATE & KONSTANTA
  // ==========================================================================
  const S = {
    token: null, data: null, rute: 'beranda', param: {}, riwayat: [],
    kotor: new Set(), muatTerakhir: 0,
    filter: { status: 'semua', kategori: '', cari: '' },
    belajar: { idKursus: null, idModul: null, tab: 'ringkasan', pratinjau: false, putar: null },
    editor: { idKursus: null, modeUrut: false, tipe: 'semua' },
    adm: { tabMember: 'akses', cariAkses: '', kursusAkses: 'semua', statusAkses: 'semua', cariProgres: '', kursusProgres: 'semua', statusProgres: 'semua', batas: 100, cariLynk: '', statusLynk: 'semua' },
    grafik: { periode: 'minggu', jenis: 'jam' },
    outbox: [], sinkron: { jalan: false, gagal: 0, timer: null },
    unduh: new Set(), unduhCache: new Map(), chart: {},
    masuk: { email: '', ingat: true, hitung: null },
    publik: null
  };
  const I = {}; // indeks turunan dari S.data
  const VIEW_ADMIN = ['editor', 'member'];
  const MENU = {
    member: [['beranda', 'bi-house-door', 'Beranda'], ['kursus', 'bi-mortarboard', 'Kursus'], ['progres', 'bi-bar-chart-line', 'Progres'], ['pesan', 'bi-envelope', 'Pesan'], ['profil', 'bi-person', 'Profil'], ['pengaturan', 'bi-gear', 'Pengaturan']],
    admin: [['beranda', 'bi-grid-1x2', 'Beranda'], ['kursus', 'bi-mortarboard', 'Kursus'], ['member', 'bi-people', 'Member'], ['progres', 'bi-bar-chart-line', 'Progres'], ['pesan', 'bi-megaphone', 'Pesan'], ['profil', 'bi-person', 'Profil'], ['pengaturan', 'bi-gear', 'Pengaturan']]
  };
  const BAWAH = { member: ['beranda', 'kursus', 'progres', 'pesan', 'profil'], admin: ['beranda', 'kursus', 'member', 'progres', 'profil'] };
  const INDUK = { belajar: 'kursus', editor: 'kursus' };
  const TIPE = {
    video: { label: 'Video YouTube', ikon: 'bi-play-btn', pendek: 'Video' },
    dokumen: { label: 'Dokumen', ikon: 'bi-file-earmark-text', pendek: 'Dokumen' },
    zip: { label: 'Berkas ZIP', ikon: 'bi-file-earmark-zip', pendek: 'ZIP' },
    tautan: { label: 'Tautan & Tugas', ikon: 'bi-box-arrow-up-right', pendek: 'Tautan' }
  };
  const MAKS_UNGGAH = 50 * 1024 * 1024, MAKS_SAMPUL = 5 * 1024 * 1024;
  const EXT_DOKUMEN = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.csv';
  const EXT_ZIP = '.zip,.rar,.7z';
  const EXT_LAMPIRAN = EXT_DOKUMEN + ',' + EXT_ZIP + ',.png,.jpg,.jpeg,.webp';
  const HARI = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

  // ==========================================================================
  // 2. UTILITAS
  // ==========================================================================
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = v => String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tidur = ms => new Promise(r => setTimeout(r, ms));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('et_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('et_' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem('et_' + k); } catch (e) { } }
  };
  const SS = {
    get(k, d) { try { const v = sessionStorage.getItem('et_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { sessionStorage.setItem('et_' + k, JSON.stringify(v)); } catch (e) { } },
    del(k) { try { sessionStorage.removeItem('et_' + k); } catch (e) { } }
  };
  const kunciUser = e => String(e || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
  const angkaID = (n, d) => Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: d === undefined ? 1 : d });
  function fmtUkuran(b) {
    b = Number(b) || 0;
    if (b < 1024) return b + ' B';
    if (b < 1048576) return angkaID(b / 1024, 0) + ' KB';
    return angkaID(b / 1048576, 1) + ' MB';
  }
  function fmtDurasi(m) {
    m = Math.round(Number(m) || 0);
    if (!m) return '—';
    if (m < 60) return m + ' menit';
    return Math.floor(m / 60) + ' j ' + (m % 60 ? (m % 60) + ' m' : '');
  }
  const fmtMenitPendek = m => { m = Math.round(Number(m) || 0); return m < 60 ? m + 'm' : angkaID(m / 60) + 'j'; };
  function tgl(v) { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d : null; }
  function fmtTanggal(v, opsi) {
    const d = tgl(v); if (!d) return '—';
    return d.toLocaleDateString('id-ID', opsi || { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtRelatif(v) {
    const d = tgl(v); if (!d) return '—';
    const s = (Date.now() - d.getTime()) / 1000;
    if (s < 60) return 'baru saja';
    if (s < 3600) return Math.floor(s / 60) + ' menit lalu';
    if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
    if (s < 86400 * 7) return Math.floor(s / 86400) + ' hari lalu';
    return fmtTanggal(d);
  }
  function hariKey(d) { d = d instanceof Date ? d : new Date(d); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function inisial(n) { const p = String(n || '?').trim().split(/[\s@._-]+/).filter(Boolean); return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase(); }
  function ytId(url) {
    const m = String(url || '').trim().match(/^(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/|youtube-nocookie\.com\/embed\/)([A-Za-z0-9_-]{11})(?:[?&#/].*)?$/i);
    return m ? m[1] : '';
  }
  const urlValid = u => /^https:\/\/[^\s<>"']+$/i.test(String(u || ''));
  const emailValid = e => /^[^\s@,;<>]+@[^\s@,;<>]+\.[A-Za-z]{2,}$/.test(String(e || '').trim());
  function autolink(t) {
    return esc(t).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, u => '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + '</a>');
  }
  function ambilTautan(t) { return (String(t || '').match(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g) || []).filter((u, i, a) => a.indexOf(u) === i); }
  function ekstensi(n) { const m = String(n || '').toLowerCase().match(/\.([a-z0-9]{1,5})$/); return m ? m[1] : ''; }
  function kelasBerkas(n) { const x = ekstensi(n); return x === 'pdf' ? 'pdf' : ['doc', 'docx', 'txt', 'md'].includes(x) ? 'doc' : ['zip', 'rar', '7z'].includes(x) ? 'zip' : 'lain'; }
  function mimeDariNama(n) {
    return ({ pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' })[ekstensi(n)] || 'application/octet-stream';
  }
  const PALET = [['kat-indigo', 'g-indigo'], ['kat-oranye', 'g-oranye'], ['kat-hijau', 'g-hijau'], ['kat-ungu', 'g-ungu'], ['kat-emas', 'g-emas'], ['kat-biru', 'g-biru'], ['kat-pink', 'g-pink'], ['kat-merah', 'g-merah']];
  function warnaKat(kat) {
    const k = String(kat || '').toLowerCase();
    const peta = [
      [/front|develop|pengembang|program|web|dev|coding|kode/, 0, 'bi-code-slash'], [/back|server|data/, 7, 'bi-hdd-stack'],
      [/desain|design|ui|ux|grafis/, 1, 'bi-palette'], [/bugar|fitness|sehat|health|olahraga/, 2, 'bi-heart-pulse'],
      [/musik|music|vokal/, 3, 'bi-music-note-beamed'], [/produktiv|product|manaj/, 4, 'bi-lightning-charge'],
      [/bisnis|market|jual|business/, 5, 'bi-briefcase'], [/bahasa|language|english/, 6, 'bi-translate']
    ];
    for (const [re, i, ikon] of peta) if (re.test(k)) return { kat: PALET[i][0], g: PALET[i][1], ikon };
    let h = 0; for (const c of k) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const p = PALET[h % PALET.length];
    return { kat: p[0], g: p[1], ikon: 'bi-journal-bookmark' };
  }
  function b64KeBytes(b64) { const bin = atob(b64 || ''); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  function blobKeBase64(blob) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  }
  function simpanBlob(blob, nama) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nama || 'berkas'; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 8000);
  }
  function csv(rows) {
    const sel = v => { let s = String(v === undefined || v === null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return String.fromCharCode(0xFEFF) + rows.map(r => r.map(sel).join(',')).join('\r\n');
  }
  function salin(teks) {
    try { navigator.clipboard.writeText(teks).then(() => toast('Disalin ke papan klip.', 'sukses')); }
    catch (e) { toast('Tidak dapat menyalin otomatis.', 'peringatan'); }
  }

  // ==========================================================================
  // 3. JEMBATAN REST API (fetch → doPost GAS)
  // ==========================================================================
  const API_URL = String((typeof GAS_URL !== 'undefined' && GAS_URL) || window.EDUTRACK_GAS_URL || '').trim();
  const apiSiap = () => /^https?:\/\/[^\s]+$/.test(API_URL) && API_URL.indexOf('GANTI_DENGAN') === -1;
  const AKSI_LAMA = new Set(['unggahPotongan', 'mulaiUnggah', 'unduhBerkas', 'buatLaporanPdf', 'migrasiPindai', 'migrasiJalankan']);
  const AKSI_BACA = new Set(['muatAwal', 'cekVideoYouTube', 'unduhBerkas', 'migrasiPindai', 'simulasiLynk']);
  const TELEMETRI = { n: 0, total: 0, server: 0, terakhir: 0, lambat: 0 };
  const _inflight = new Map();
  let pending = 0, timerProg = null, epochTulis = 0, timerKuras = null;
  function progresAtas(aktif) {
    const el = $('#topProgress'); if (!el) return;
    clearTimeout(timerProg);
    if (aktif) { el.classList.remove('selesai'); requestAnimationFrame(() => el.classList.add('aktif')); }
    else { el.classList.remove('aktif'); el.classList.add('selesai'); timerProg = setTimeout(() => el.classList.remove('selesai'), 700); }
  }
  function galatKode(pesan, kode, asli) { const e = new Error(pesan); e.kode = kode; if (asli) e.asli = asli; return e; }
  function catatTelemetri(fn, msKlien, msServer) {
    TELEMETRI.n++; TELEMETRI.total += msKlien; TELEMETRI.server += Number(msServer) || 0; TELEMETRI.terakhir = msKlien;
    if (msKlien > 3000) TELEMETRI.lambat++;
    const el = $('#infoLatensi'); if (el) el.textContent = teksLatensi();
  }
  function teksLatensi() {
    if (!TELEMETRI.n) return 'Belum ada panggilan di sesi ini.';
    return TELEMETRI.n + ' panggilan · rata-rata ' + Math.round(TELEMETRI.total / TELEMETRI.n) + ' ms (server ' + Math.round(TELEMETRI.server / TELEMETRI.n) + ' ms) · terakhir ' + Math.round(TELEMETRI.terakhir) + ' ms';
  }
  /** Email/notifikasi diantrekan server (nq>0) → minta server mengirimnya di eksekusi terpisah (fire-and-forget). */
  function jadwalKuras() {
    clearTimeout(timerKuras);
    timerKuras = setTimeout(() => { kirimApi('kurasAntrean', [], { diam: true }).catch(() => { }); }, 1200);
  }
  async function kirimApi(fn, args, opsi) {
    opsi = opsi || {};
    if (!apiSiap()) throw galatKode('URL backend belum diatur. Isi GAS_URL di js/config.js.', 'KONFIG');
    if (!opsi.diam) { pending++; progresAtas(true); }
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, AKSI_LAMA.has(fn) ? 180000 : 45000);
    const t0 = performance.now();
    try {
      let res;
      try {
        res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // WAJIB text/plain: tanpa preflight CORS
          body: JSON.stringify({ action: fn, args: args || [], asal: location.href.split('#')[0], api: API_URL }),
          credentials: 'omit', redirect: 'follow', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined
        });
      } catch (err) {
        throw galatKode(err && err.name === 'AbortError' ? 'Server terlalu lama merespons. Coba lagi sebentar lagi.' : 'Koneksi ke server gagal. Periksa internet Anda lalu coba lagi.', 'JARINGAN', err);
      }
      const teks = await res.text();
      let j = null;
      try { j = JSON.parse(teks); } catch (x) { }
      if (!j || typeof j !== 'object') {
        throw galatKode(res.ok ? 'Respons server bukan JSON. Pastikan Web App di-deploy dengan "Execute as: Me" + "Who has access: Anyone" dan GAS_URL di js/config.js berakhiran /exec.' : 'Server mengembalikan HTTP ' + res.status + '. Coba lagi.', 'SERVER');
      }
      catatTelemetri(fn, performance.now() - t0, j.ms);
      if (j.nq && fn !== 'kurasAntrean') jadwalKuras();
      if (j.success) return j.data;
      const e = galatKode(j.message || 'Terjadi kesalahan.', j.kode || 'SERVER');
      if (e.kode === 'SESI_HABIS') sesiHabis(e.message);
      throw e;
    } finally {
      clearTimeout(timer);
      if (!opsi.diam) { pending = Math.max(0, pending - 1); if (!pending) progresAtas(false); }
    }
  }
  /**
   * server(aksi, ...args) → Promise<data>. Antarmuka sama dengan v1 sehingga seluruh view tidak berubah.
   * Aksi baca kembar yang sedang berjalan menumpang promise yang sama; aksi tulis menaikkan epoch
   * agar baca sesudahnya selalu mengambil data baru.
   */
  // Aksi tulis yang aman diulang bila server sibuk (SIBUK = gagal dapat kunci, belum ada yang ditulis)
  const AKSI_ULANG = new Set(['simpanKursus', 'simpanModul', 'urutkanModul', 'simpanProdukLynk', 'simpanPengaturan', 'ubahAkses']);
  async function kirimDenganUlang(fn, args) {
    for (let coba = 0; ; coba++) {
      try { return await kirimApi(fn, args); }
      catch (e) { if (e.kode !== 'SIBUK' || !AKSI_ULANG.has(fn) || coba >= 2) throw e; await tidur(2500 * (coba + 1)); }
    }
  }
  function server(fn, ...args) {
    if (!AKSI_BACA.has(fn)) { epochTulis++; return kirimDenganUlang(fn, args); }
    const k = epochTulis + '|' + fn + '|' + JSON.stringify(args);
    if (_inflight.has(k)) return _inflight.get(k);
    const p = kirimApi(fn, args);
    _inflight.set(k, p);
    const lepas = () => { _inflight.delete(k); };
    p.then(lepas, lepas);
    return p;
  }
  /** GET publik (branding + Client ID Google). Sekaligus "membangunkan" container GAS sebelum login. */
  async function ambilPublik() {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, 25000);
    const t0 = performance.now();
    try {
      const res = await fetch(API_URL + (API_URL.indexOf('?') > -1 ? '&' : '?') + 'action=publik', { credentials: 'omit', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
      let j = null;
      try { j = JSON.parse(await res.text()); } catch (x) { }
      if (!j) throw galatKode('Backend tidak mengembalikan JSON. Periksa deployment Web App (Execute as: Me, Who has access: Anyone).', 'SERVER');
      catatTelemetri('publik', performance.now() - t0, j.ms);
      if (!j.success) throw galatKode(j.message || 'Gagal memuat konfigurasi.', j.kode || 'SERVER');
      return j.data;
    } catch (e) {
      if (!e.kode) throw galatKode('Backend belum dapat dihubungi. Periksa koneksi atau GAS_URL.', 'JARINGAN', e);
      throw e;
    } finally { clearTimeout(timer); }
  }

  /** Panggilan server dengan batas waktu — dipakai sinkron latar agar antrean tidak pernah macet. */
  function serverBatas(ms, fn, ...args) {
    return Promise.race([server(fn, ...args), new Promise((_, rej) => setTimeout(() => { const e = new Error('Server tidak merespons. Akan dicoba lagi.'); e.kode = 'JARINGAN'; rej(e); }, ms))]);
  }

  // ==========================================================================
  // 4. TOAST, DIALOG KONFIRMASI, MODAL
  // ==========================================================================
  function toast(pesan, jenis, opsi) {
    jenis = jenis || 'info'; opsi = opsi || {};
    const ikon = { sukses: 'bi-check-circle-fill', galat: 'bi-x-octagon-fill', info: 'bi-info-circle-fill', peringatan: 'bi-exclamation-triangle-fill' }[jenis];
    const el = document.createElement('div');
    el.className = 'toast ' + jenis;
    el.setAttribute('role', jenis === 'galat' ? 'alert' : 'status');
    el.innerHTML = '<i class="bi ' + ikon + ' ikon" aria-hidden="true"></i><div class="pesan">' + esc(pesan) + '</div>' + (opsi.aksi ? '<button type="button">' + esc(opsi.aksi.teks) + '</button>' : '');
    const wrap = $('#toastWrap');
    wrap.appendChild(el);
    while (wrap.children.length > 3) wrap.firstChild.remove();
    const tutup = () => { el.classList.add('keluar'); setTimeout(() => el.remove(), 220); };
    if (opsi.aksi) el.querySelector('button').addEventListener('click', () => { tutup(); opsi.aksi.fn(); });
    setTimeout(tutup, opsi.durasi || (jenis === 'galat' ? 6500 : 3800));
  }

  let fokusSebelum = null;
  function jebakFokus(kotak, e) {
    const f = $$('button:not([disabled]), [href], input:not([disabled]):not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])', kotak).filter(x => x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }
  function konfirmasi(o) {
    return new Promise(resolve => {
      const box = $('#dialog'), kotak = $('#dialogKotak');
      kotak.innerHTML = '<div class="modal-kepala"><div class="judul-wrap"><h2 id="dialogJudul">' + esc(o.judul) + '</h2><p>' + esc(o.pesan || '') + '</p></div></div>' +
        '<div class="modal-kaki"><span class="catatan"></span><button type="button" class="btn btn-garis" data-k="0">' + esc(o.batal || 'Batal') + '</button>' +
        '<button type="button" class="btn ' + (o.bahaya ? 'btn-bahaya' : 'btn-utama') + '" data-k="1">' + esc(o.ya || 'Lanjutkan') + '</button></div>';
      box.hidden = false;
      const selesai = v => { box.hidden = true; kotak.innerHTML = ''; document.removeEventListener('keydown', key, true); resolve(v); };
      const key = e => { if (e.key === 'Escape') { e.stopPropagation(); selesai(false); } if (e.key === 'Tab') jebakFokus(kotak, e); };
      document.addEventListener('keydown', key, true);
      kotak.querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', () => selesai(b.dataset.k === '1')));
      setTimeout(() => kotak.querySelector('[data-k="1"]').focus(), 30);
    });
  }
  let modalTutupCb = null;
  function bukaModal(html, opsi) {
    opsi = opsi || {};
    fokusSebelum = document.activeElement;
    const box = $('#modal'), kotak = $('#modalKotak');
    kotak.className = 'modal-kotak' + (opsi.kecil ? ' modal-kecil' : '');
    kotak.innerHTML = html;
    box.hidden = false;
    document.body.style.overflow = 'hidden';
    modalTutupCb = opsi.sebelumTutup || null;
    setTimeout(() => { const f = kotak.querySelector('[autofocus]') || kotak.querySelector('input, select, textarea, button'); if (f) f.focus({ preventScroll: true }); }, 40);
  }
  async function tutupModal(paksa) {
    if (!paksa && modalTutupCb && !(await modalTutupCb())) return;
    modalTutupCb = null;
    $('#modal').hidden = true;
    $('#modalKotak').innerHTML = '';
    document.body.style.overflow = '';
    if (fokusSebelum && fokusSebelum.focus) try { fokusSebelum.focus({ preventScroll: true }); } catch (e) { }
  }
  const modalTerbuka = () => !$('#modal').hidden;
  function tutupPopover() { ['#cariHasil', '#popFilter', '#popNotif'].forEach(s => { const p = $(s); if (p) p.hidden = true; }); $('#cariWrap') && $('#cariWrap').classList.remove('terbuka-mobile'); }

  // ==========================================================================
  // 5. TEMA
  // ==========================================================================
  function temaPilihan() { try { return localStorage.getItem('et_tema') || 'sistem'; } catch (e) { return 'sistem'; } }
  function terapkanTema(t) {
    try { localStorage.setItem('et_tema', t); } catch (e) { }
    const gelap = t === 'gelap' || (t === 'sistem' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', gelap ? 'dark' : 'light');
    const ik = $('#ikonTema'); if (ik) ik.className = gelap ? 'bi bi-sun' : 'bi bi-moon-stars';
    Object.keys(S.chart).forEach(k => { try { S.chart[k].destroy(); } catch (e) { } delete S.chart[k]; });
    if (S.data) { tandaiKotor(); renderUlang(true); }
  }

  // ==========================================================================
  // 6. MEREK, SESI & BOOT
  // ==========================================================================
  function terapkanMerek(p) {
    if (!p) return;
    const nama = p.NAMA_APP || 'EduTrack Pro';
    $$('[data-nama-app]').forEach(e => { e.textContent = nama; });
    $$('[data-tagline]').forEach(e => { e.textContent = p.TAGLINE || ''; });
    $$('[data-logo]').forEach(e => {
      if (p.LOGO_URL && urlValid(p.LOGO_URL)) e.innerHTML = '<img src="' + esc(p.LOGO_URL) + '" alt="">';
      else e.textContent = inisial(nama)[0];
    });
  }
  function tampil(layar) {
    $('#layarInfo').hidden = layar !== 'info';
    $('#layarMasuk').hidden = layar !== 'masuk';
    $('#aplikasi').hidden = layar !== 'app';
  }
  function tampilInfo(html) { $('#layarInfo').innerHTML = '<div class="info-kartu">' + html + '</div>'; tampil('info'); }

  function simpanToken(token, email, ingat) {
    const v = { token, email, ingat: !!ingat };
    if (ingat) { LS.set('sesi', v); SS.del('sesi'); } else { SS.set('sesi', v); LS.del('sesi'); }
  }
  function ambilSesiLokal() { return LS.get('sesi', null) || SS.get('sesi', null); }
  function hapusSesiLokal() { LS.del('sesi'); SS.del('sesi'); }
  const kunciSnap = () => 'snap_' + kunciUser(S.data && S.data.user && S.data.user.email);
  const simpanSnapshot = debounce(() => { if (S.data) LS.set(kunciSnap(), { v: 1, waktu: Date.now(), data: S.data }); }, 600);
  const kunciOutbox = () => 'outbox_' + kunciUser(S.data && S.data.user && S.data.user.email);

  function init() {
    pasangEvent();
    terapkanTema(temaPilihan());
    if (!apiSiap()) {
      tampilInfo('<span class="logo logo-besar">E</span><h1>Backend belum terhubung</h1><p class="teks-2">Buka berkas <b>js/config.js</b>, isi <code>GAS_URL</code> dengan URL <b>/exec</b> dari Deploy → Web app di Apps Script, lalu kirim ulang ke GitHub (<code>git add . &amp;&amp; git commit -m "config" &amp;&amp; git push</code>).</p>');
      return;
    }
    const pub = LS.get('publik', null);
    if (pub && pub.pengaturan) { S.publik = pub; terapkanMerek(pub.pengaturan); }
    muatPublik(); // paralel: branding terbaru + membangunkan container GAS
    const lokal = ambilSesiLokal();
    if (lokal && lokal.token) {
      const snap = LS.get('snap_' + kunciUser(lokal.email), null);
      if (snap && snap.data) { mulaiSesi(lokal.token, snap.data, { ingat: lokal.ingat, dariSnapshot: true }); return; }
      tampilMemuat();
      server('muatAwal', lokal.token).then(r => {
        if (r.tokenBaru) simpanToken(r.tokenBaru, lokal.email, lokal.ingat);
        mulaiSesi(r.tokenBaru || lokal.token, r.data, { ingat: lokal.ingat });
      }).catch(e => { if (e.kode !== 'SESI_HABIS') { tampilMasuk(); toast(e.message, 'galat'); } });
      return;
    }
    tampilMasuk();
  }
  function tampilMemuat() {
    tampilInfo('<span class="logo logo-besar" data-logo>E</span><h1 data-nama-app>EduTrack Pro</h1><p class="teks-2"><i class="bi bi-arrow-repeat putar"></i> Menghubungkan ke server…</p>');
    if (S.publik) terapkanMerek(S.publik.pengaturan);
  }
  function muatPublik() {
    return ambilPublik().then(d => {
      if (!d) return;
      if (d.perluSetup) {
        if (!S.token) tampilInfo('<span class="logo logo-besar">E</span><h1>Backend belum di-setup</h1><p class="teks-2">Buka editor Apps Script, pilih fungsi <b>setupAppEnvironment</b>, lalu klik Run. Setelah selesai, muat ulang halaman ini.</p>');
        return;
      }
      S.publik = Object.assign({}, S.publik || {}, { pengaturan: d.pengaturan, auth: d.auth || {}, waktu: Date.now() });
      LS.set('publik', S.publik);
      if (!S.data) terapkanMerek(d.pengaturan);
      if (!$('#layarMasuk').hidden) siapkanGoogle();
    }).catch(e => {
      console.warn('[EduTrack] publik:', e.message);
      if (!$('#layarMasuk').hidden && !S.publik) toast(e.message, 'peringatan', { durasi: 9000 });
    });
  }

  function mulaiSesi(token, data, opsi) {
    opsi = opsi || {};
    S.token = token;
    simpanToken(token, data.user.email, opsi.ingat);
    S.data = null; S.riwayat = []; S.unduhCache.clear();
    S.outbox = LS.get('outbox_' + kunciUser(data.user.email), []); // antrean progres offline milik user ini
    terapkanData(data);
    bangunNav();
    tampil('app');
    const terakhir = LS.get('rute_' + kunciUser(data.user.email), null);
    const rute = terakhir && terakhir[0] && bolehRute(terakhir[0]) ? terakhir : ['beranda', {}];
    go(rute[0], rute[1] || {}, { catat: false });
    if (opsi.dariSnapshot) segarkan(true); else S.muatTerakhir = Date.now();
    flushOutbox();
  }

  function terapkanData(data, opsi) {
    opsi = opsi || {};
    data.kursus = data.kursus || []; data.modul = data.modul || []; data.progres = data.progres || [];
    data.pengumuman = data.pengumuman || []; data.akses = data.akses || []; data.katalog = data.katalog || [];
    // Gabungkan progres yang masih antre (optimistic) agar tidak "hilang" saat data server datang
    const ada = new Set(data.progres.map(p => p.id_modul));
    const lama = (S.data && S.data.progres) || [];
    (S.outbox || []).forEach(id => {
      if (ada.has(id)) return;
      const p = lama.find(x => x.id_modul === id);
      const m = data.modul.find(x => x.id_modul === id);
      if (m) data.progres.push({ id_modul: id, id_kursus: m.id_kursus, waktu: p ? p.waktu : new Date().toISOString(), _antre: true });
    });
    S.data = data;
    if (data.auth) S.publik = Object.assign({}, S.publik || {}, { auth: data.auth });
    if (data.lynk && S.lynkAktifTunda !== undefined) data.lynk.aktif = S.lynkAktifTunda; // jangan ditimpa respons lama
    bangunIndeks();
    terapkanMerek(data.pengaturan);
    perbaruiKepala();
    tandaiKotor();
    if (opsi.simpan !== false) simpanSnapshot();
  }

  function segarkan(diam) {
    if (!S.token) return Promise.resolve();
    return server('muatAwal', S.token).then(r => {
      if (r.tokenBaru) { S.token = r.tokenBaru; const l = ambilSesiLokal(); simpanToken(r.tokenBaru, r.data.user.email, l ? l.ingat : false); }
      const peranLama = S.data && S.data.user.peran;
      terapkanData(r.data);
      S.muatTerakhir = Date.now();
      if (peranLama !== r.data.user.peran) { bangunNav(); go('beranda', {}, { catat: false }); }
      else renderUlang(true);
      if (!diam) toast('Data terbaru sudah dimuat.', 'sukses');
    }).catch(e => { if (!diam && e.kode !== 'SESI_HABIS') toast(e.message, 'galat'); });
  }

  function sesiHabis(pesan) {
    if (!S.token) return;
    const emailLama = S.data && S.data.user && S.data.user.email;
    S.token = null;
    hapusSesiLokal();
    if (emailLama) LS.del('snap_' + kunciUser(emailLama)); // T-08: jangan tinggalkan snapshot data setelah sesi habis
    S.data = null;
    tutupModal(true);
    tampilMasuk();
    toast(pesan || 'Sesi berakhir. Silakan masuk kembali.', 'peringatan');
  }

  async function keluar() {
    const antre = S.outbox.length;
    const ok = await konfirmasi({ judul: 'Keluar dari akun?', pesan: antre ? 'Ada ' + antre + ' progres yang belum tersinkron. Progres tersebut akan dikirim saat Anda masuk lagi di perangkat ini.' : 'Data offline di perangkat ini akan dihapus.', ya: 'Keluar', bahaya: true });
    if (!ok) return;
    if (!antre) LS.del(kunciOutbox());
    LS.del(kunciSnap());
    hapusSesiLokal();
    try { if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect(); } catch (e) { }
    S.token = null; S.data = null; S.riwayat = [];
    Object.keys(S.chart).forEach(k => { try { S.chart[k].destroy(); } catch (e) { } delete S.chart[k]; });
    tampilMasuk();
  }

  // ==========================================================================
  // 7. LAYAR MASUK (kode email 6 digit + akses darurat)
  // ==========================================================================
  function tampilMasuk() {
    tampil('masuk');
    langkahMasuk(1);
    $('#infoGoogle').innerHTML = '';
    siapkanGoogle();
    const email = LS.get('email_terakhir', '');
    if (email) $('#inEmail').value = email;
    setTimeout(() => $('#inEmail').focus(), 60);
  }
  // ---- Login dengan Google (opsional; aktif bila admin mengisi Client ID). Token diverifikasi di server. ----
  let gisMuat = null, gisCid = '';
  function muatGis() {
    if (window.google && google.accounts && google.accounts.id) return Promise.resolve();
    if (gisMuat) return gisMuat;
    gisMuat = new Promise((res, rej) => {
      const sc = document.createElement('script');
      sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true; sc.defer = true;
      sc.onload = () => res(); sc.onerror = () => { gisMuat = null; rej(new Error('Google Sign-In gagal dimuat.')); };
      document.head.appendChild(sc);
    });
    return gisMuat;
  }
  function siapkanGoogle() {
    const area = $('#areaGoogle'); if (!area) return;
    const cid = (S.publik && S.publik.auth && S.publik.auth.googleClientId) || '';
    if (!cid) { area.hidden = true; return; }
    muatGis().then(() => {
      if ($('#layarMasuk').hidden) return;
      if (gisCid !== cid) {
        google.accounts.id.initialize({ client_id: cid, callback: masukGoogle, auto_select: false, cancel_on_tap_outside: true, context: 'signin', ux_mode: 'popup', itp_support: true });
        gisCid = cid;
      }
      const lebar = Math.max(200, Math.min(380, Math.round(($('#tombolGoogle').parentElement || {}).clientWidth || 320)));
      $('#tombolGoogle').innerHTML = '';
      google.accounts.id.renderButton($('#tombolGoogle'), { type: 'standard', theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'filled_black' : 'outline', size: 'large', shape: 'pill', text: 'signin_with', logo_alignment: 'left', width: lebar, locale: 'id' });
      area.hidden = false;
    }).catch(e => { area.hidden = true; console.warn('[EduTrack]', e.message); });
  }
  async function masukGoogle(resp) {
    if (!resp || !resp.credential) return;
    const info = $('#infoGoogle');
    info.innerHTML = '<p class="teks-2 kecil"><i class="bi bi-arrow-repeat putar"></i> Memverifikasi akun Google…</p>';
    try {
      const ingat = $('#inIngat').checked;
      const r = await server('masukGoogle', resp.credential, ingat);
      info.innerHTML = '';
      mulaiSesi(r.token, r.data, { ingat });
      toast('Selamat datang, ' + (r.data.user.nama || r.data.user.email) + '!', 'sukses');
    } catch (e) {
      info.innerHTML = '<div class="kotak-google"><i class="bi bi-google"></i><div>' + esc(e.message) + '</div></div>';
    }
  }
  function langkahMasuk(n) {
    $('#masukLangkah1').hidden = n !== 1;
    $('#masukLangkah2').hidden = n !== 2;
    $('#masukDarurat').hidden = n !== 3;
  }
  function setTombol(btn, sibuk, teks) {
    if (!btn) return;
    if (sibuk) { btn.dataset.teks = btn.dataset.teks || btn.innerHTML; btn.disabled = true; btn.innerHTML = '<i class="bi bi-arrow-repeat putar"></i> ' + esc(teks || 'Memproses…'); }
    else { btn.disabled = false; if (btn.dataset.teks) btn.innerHTML = btn.dataset.teks; delete btn.dataset.teks; }
  }
  function mulaiHitungUlang() {
    const b = $('#btnKirimUlang'); let n = 60;
    clearInterval(S.masuk.hitung);
    b.disabled = true; b.textContent = 'Kirim ulang kode (' + n + ' d)';
    S.masuk.hitung = setInterval(() => {
      n--;
      if (n <= 0) { clearInterval(S.masuk.hitung); b.disabled = false; b.textContent = 'Kirim ulang kode'; }
      else b.textContent = 'Kirim ulang kode (' + n + ' d)';
    }, 1000);
  }
  async function kirimKode(e) {
    if (e) e.preventDefault();
    const email = $('#inEmail').value.trim().toLowerCase();
    const g = $('#galatEmail');
    g.textContent = '';
    if (!emailValid(email)) { g.textContent = 'Masukkan alamat email yang valid.'; $('#inEmail').classList.add('galat'); $('#inEmail').focus(); return; }
    $('#inEmail').classList.remove('galat');
    S.masuk.email = email; S.masuk.ingat = $('#inIngat').checked;
    LS.set('email_terakhir', email);
    const btn = $('#btnKirimKode');
    setTombol(btn, true, 'Mengirim kode…');
    try {
      const r = await server('mintaKodeMasuk', email);
      $('#emailTujuan').textContent = email;
      langkahMasuk(2);
      $$('#otpBox input').forEach(i => { i.value = ''; });
      $('#galatKode').textContent = '';
      setTimeout(() => $('#otpBox input').focus(), 50);
      mulaiHitungUlang();
      toast(r.pesan, 'info', { durasi: 6000 });
    } catch (err) { g.textContent = err.message; }
    finally { setTombol(btn, false); }
  }
  async function verifikasi(e) {
    if (e) e.preventDefault();
    if ($('#btnVerifikasi').disabled) return; // cegah kirim ganda (auto-submit + klik)
    const kode = $$('#otpBox input').map(i => i.value).join('');
    const g = $('#galatKode');
    if (!/^\d{6}$/.test(kode)) { g.textContent = 'Masukkan 6 digit kode dari email.'; return; }
    const btn = $('#btnVerifikasi');
    setTombol(btn, true, 'Memverifikasi…');
    try {
      const r = await server('verifikasiKode', S.masuk.email, kode, S.masuk.ingat);
      clearInterval(S.masuk.hitung);
      mulaiSesi(r.token, r.data, { ingat: S.masuk.ingat });
      toast('Selamat datang, ' + (r.data.user.nama || r.data.user.email) + '!', 'sukses');
    } catch (err) {
      g.textContent = err.message;
      $$('#otpBox input').forEach(i => { i.value = ''; });
      $('#otpBox input').focus();
    } finally { setTombol(btn, false); }
  }
  async function masukDarurat(e) {
    e.preventDefault();
    const btn = $('#btnDarurat'), g = $('#galatDarurat');
    g.textContent = '';
    setTombol(btn, true, 'Memeriksa…');
    try {
      const r = await server('masukDarurat', $('#inDUser').value, $('#inDPass').value);
      $('#inDPass').value = '';
      mulaiSesi(r.token, r.data, { ingat: false });
      toast('Masuk dengan akses darurat. Segera tambahkan admin email.', 'peringatan', { durasi: 7000 });
    } catch (err) { g.textContent = err.message; }
    finally { setTombol(btn, false); }
  }
  function pasangOtp() {
    const ins = $$('#otpBox input');
    ins.forEach((inp, i) => {
      inp.addEventListener('input', () => {
        inp.value = inp.value.replace(/\D/g, '').slice(-1);
        if (inp.value && ins[i + 1]) ins[i + 1].focus();
        if (ins.every(x => x.value)) verifikasi();
      });
      inp.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !inp.value && ins[i - 1]) { ins[i - 1].focus(); ins[i - 1].value = ''; }
        if (e.key === 'ArrowLeft' && ins[i - 1]) ins[i - 1].focus();
        if (e.key === 'ArrowRight' && ins[i + 1]) ins[i + 1].focus();
      });
      inp.addEventListener('paste', e => {
        const t = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
        if (!t) return;
        e.preventDefault();
        ins.forEach((x, j) => { x.value = t[j] || ''; });
        (ins[Math.min(t.length, 5)]).focus();
        if (t.length === 6) verifikasi();
      });
    });
  }

  // ==========================================================================
  // 8. INDEKS & PERHITUNGAN (semua di klien → 0 RTT)
  // ==========================================================================
  const isAdmin = () => !!(S.data && S.data.user && S.data.user.peran === 'admin');
  function bangunIndeks() {
    const d = S.data;
    I.kursus = new Map(d.kursus.map(k => [k.id_kursus, k]));
    I.modul = new Map(d.modul.map(m => [m.id_modul, m]));
    I.modulKursus = new Map();
    d.modul.forEach(m => { if (!I.modulKursus.has(m.id_kursus)) I.modulKursus.set(m.id_kursus, []); I.modulKursus.get(m.id_kursus).push(m); });
    I.modulKursus.forEach(l => l.sort((a, b) => a.urutan - b.urutan));
    I.selesai = new Map(d.progres.map(p => [p.id_modul, p.waktu]));
    I.pengguna = new Map((d.pengguna || []).map(u => [u.email, u]));
    I.perMember = new Map(((d.ringkas && d.ringkas.per) || []).map(p => [p[0] + '|' + p[1], { selesai: p[2], terakhir: p[3] }]));
  }
  const semuaModul = idK => I.modulKursus.get(idK) || [];
  const modulTerbit = idK => semuaModul(idK).filter(m => m.status !== 'draf');
  function prasyaratOk(m, list) {
    const p = String(m.prasyarat || 'SEBELUMNYA').trim();
    if (p === 'TIDAK_ADA') return true;
    if (p !== 'SEBELUMNYA' && list.some(x => x.id_modul === p)) return I.selesai.has(p);
    const i = list.indexOf(m);
    return i <= 0 || I.selesai.has(list[i - 1].id_modul);
  }
  function statusModul(m, list) {
    if (isAdmin()) return 'terbuka';
    if (I.selesai.has(m.id_modul)) return 'selesai';
    return prasyaratOk(m, list || modulTerbit(m.id_kursus)) ? 'terbuka' : 'terkunci';
  }
  function progresKursus(idK) {
    const list = modulTerbit(idK);
    const sel = list.filter(m => I.selesai.has(m.id_modul));
    let terakhir = 0;
    sel.forEach(m => { const w = new Date(I.selesai.get(m.id_modul)).getTime() || 0; if (w > terakhir) terakhir = w; });
    const berikut = list.find(m => !I.selesai.has(m.id_modul) && prasyaratOk(m, list)) || list.find(m => !I.selesai.has(m.id_modul)) || null;
    return {
      total: list.length, selesai: sel.length, persen: list.length ? Math.round(sel.length / list.length * 100) : 0,
      terakhir, berikut, menit: sel.reduce((a, m) => a + (m.durasi_menit || 0), 0), totalMenit: list.reduce((a, m) => a + (m.durasi_menit || 0), 0)
    };
  }
  function statistikMember() {
    let selesai = 0, berjalan = 0, belum = 0;
    S.data.kursus.forEach(k => { const p = progresKursus(k.id_kursus); if (p.total && p.persen === 100) selesai++; else if (p.selesai) berjalan++; else belum++; });
    const perHari = new Map(), perHariN = new Map();
    let menit = 0;
    S.data.progres.forEach(p => {
      const m = I.modul.get(p.id_modul); const dm = m ? (m.durasi_menit || 0) : 0;
      menit += dm;
      const d = tgl(p.waktu); if (!d) return;
      const k = hariKey(d);
      perHari.set(k, (perHari.get(k) || 0) + dm);
      perHariN.set(k, (perHariN.get(k) || 0) + 1);
    });
    let streak = 0;
    const d = new Date();
    if (!perHariN.has(hariKey(d))) d.setDate(d.getDate() - 1);
    while (perHariN.has(hariKey(d))) { streak++; d.setDate(d.getDate() - 1); }
    const awalMinggu = new Date(); awalMinggu.setHours(0, 0, 0, 0); awalMinggu.setDate(awalMinggu.getDate() - 6);
    let menitMinggu = 0;
    perHari.forEach((v, k) => { if (new Date(k + 'T00:00:00') >= awalMinggu) menitMinggu += v; });
    return { total: S.data.kursus.length, selesai, berjalan, belum, menit, streak, perHari, perHariN, menitMinggu };
  }
  function lanjutkanTarget() {
    const ks = S.data.kursus.map(k => ({ k, p: progresKursus(k.id_kursus) })).filter(x => x.p.total && x.p.persen < 100);
    ks.sort((a, b) => b.p.terakhir - a.p.terakhir || b.p.persen - a.p.persen);
    return ks[0] || (S.data.kursus[0] ? { k: S.data.kursus[0], p: progresKursus(S.data.kursus[0].id_kursus) } : null);
  }
  function belumDibaca() {
    const t = LS.get('baca_' + kunciUser(S.data.user.email), 0);
    return S.data.pengumuman.filter(p => (new Date(p.dibuat).getTime() || 0) > t);
  }

  // ==========================================================================
  // 9. NAVIGASI SPA (0 ms) — tampil/sembunyi section, tanpa reload / tanpa URL
  // ==========================================================================
  function bolehRute(r) { return !!VIEWS[r] && (isAdmin() || !VIEW_ADMIN.includes(r)); }
  function bangunNav() {
    const peran = isAdmin() ? 'admin' : 'member';
    $('#railNav').innerHTML = MENU[peran].map(([id, ikon, label]) =>
      '<button type="button" class="rail-item" data-act="nav" data-to="' + id + '" data-ikon="' + ikon + '" aria-label="' + label + '" title="' + label + '"><i class="bi ' + ikon + '"></i></button>').join('');
    $('#bottomNav').innerHTML = BAWAH[peran].map(id => {
      const it = MENU[peran].find(x => x[0] === id);
      return '<button type="button" data-act="nav" data-to="' + id + '" data-ikon="' + it[1] + '"><i class="bi ' + it[1] + '"></i><span>' + it[2] + '</span></button>';
    }).join('');
    $('#inCari').placeholder = isAdmin() ? 'Cari kursus, modul, atau member' : 'Cari kursus, modul, atau topik';
  }
  function aktifkanNav() {
    const aktif = INDUK[S.rute] || S.rute;
    $$('#railNav [data-to], #bottomNav [data-to]').forEach(b => {
      const on = b.dataset.to === aktif;
      b.classList.toggle('aktif', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      const i = b.querySelector('i'); if (i) i.className = 'bi ' + b.dataset.ikon + (on ? '-fill' : '');
    });
    const n = belumDibaca().length;
    $$('[data-to="pesan"]').forEach(b => { const l = b.querySelector('.lencana'); if (n && !l) b.insertAdjacentHTML('beforeend', '<span class="lencana"></span>'); if (!n && l) l.remove(); });
  }
  function go(rute, param, opsi) {
    param = param || {}; opsi = opsi || {};
    if (!bolehRute(rute)) rute = 'beranda';
    tutupPopover();
    const sama = S.rute === rute && JSON.stringify(param) === JSON.stringify(S.param);
    if (opsi.catat !== false && !sama && S.rute) { S.riwayat.push([S.rute, S.param]); if (S.riwayat.length > 30) S.riwayat.shift(); }
    if (rute === 'belajar') {
      if (param.id !== S.belajar.idKursus || param.modul !== S.belajar.idModul) S.belajar.putar = null;
      S.belajar.idKursus = param.id; S.belajar.idModul = param.modul || null; S.belajar.pratinjau = !!param.pratinjau;
      if (!sama) S.belajar.tab = 'ringkasan';
    }
    if (rute === 'editor' && param.id !== S.editor.idKursus) { S.editor.idKursus = param.id; S.editor.tipe = 'semua'; S.editor.modeUrut = false; }
    if (rute === 'kursus' && param.status) S.filter.status = param.status;
    const berubah = S.rute !== rute || !sama;
    S.rute = rute; S.param = param;
    $$('.view').forEach(v => { v.hidden = v.dataset.view !== rute; });
    if (berubah || S.kotor.has(rute)) render(rute);
    aktifkanNav();
    breadcrumb();
    window.scrollTo(0, 0);
    const v = $('#v-' + rute); if (v && opsi.fokus !== false) try { v.focus({ preventScroll: true }); } catch (e) { }
    if (S.data) LS.set('rute_' + kunciUser(S.data.user.email), [rute, param]);
  }
  function kembali() {
    const p = S.riwayat.pop();
    if (p) go(p[0], p[1], { catat: false }); else go('beranda', {}, { catat: false });
  }
  function tandaiKotor(...views) { (views.length ? views : Object.keys(VIEWS)).forEach(v => S.kotor.add(v)); }
  function render(rute) {
    const fn = VIEWS[rute]; if (!fn || !S.data) return;
    S.kotor.delete(rute);
    try { fn(); } catch (err) {
      console.error(err);
      $('#v-' + rute).innerHTML = kosongHtml('bi-bug', 'Halaman gagal ditampilkan', String(err.message || err), '<button class="btn btn-ghost" data-act="segarkan"><i class="bi bi-arrow-clockwise"></i> Muat ulang data</button>');
    }
  }
  /** Render ulang halaman aktif. Mode lembut menjaga video/editor yang sedang dipakai. */
  function renderUlang(lembut) {
    if (!S.data) return;
    if (lembut && S.rute === 'belajar' && $('#blInfo')) { perbaruiBelajarParsial(); S.kotor.delete('belajar'); }
    else if (lembut && S.rute === 'editor' && $('#daftarModul') && document.activeElement && document.activeElement.closest('#v-editor')) { renderDaftarModul(); S.kotor.delete('editor'); }
    else if (S.kotor.has(S.rute)) render(S.rute);
    aktifkanNav(); breadcrumb(); perbaruiKepala();
  }
  function breadcrumb() {
    const nav = $('#breadcrumb'); if (!nav || !S.data) return;
    const adm = isAdmin();
    const k = I.kursus && I.kursus.get(S.rute === 'belajar' ? S.belajar.idKursus : S.editor.idKursus);
    const btn = (t, to, p) => '<button type="button" data-act="nav" data-to="' + to + '"' + (p ? ' data-param=\'' + esc(JSON.stringify(p)) + '\'' : '') + '>' + esc(t) + '</button>';
    const sep = '<i class="bi bi-chevron-right sep" aria-hidden="true"></i>';
    let remah = [], kini = '';
    const nama = { beranda: adm ? 'Dasbor Admin' : 'Beranda', kursus: adm ? 'Kelola Kursus' : 'Kursus Saya', member: 'Member & Akses', progres: adm ? 'Progres Member' : 'Progres Belajar', pesan: adm ? 'Pengumuman' : 'Pesan', profil: 'Profil', pengaturan: 'Pengaturan' };
    if (S.rute === 'belajar') {
      const m = I.modul.get(S.belajar.idModul);
      remah = [btn(adm ? 'Kursus' : 'Kursus Saya', 'kursus'), k ? '<span class="potong" style="max-width:240px">' + esc(k.judul) + '</span>' : ''];
      const list = k ? (adm ? semuaModul(k.id_kursus) : modulTerbit(k.id_kursus)) : [];
      kini = m ? 'Modul ' + (list.indexOf(m) + 1) + ': ' + m.judul : 'Belajar';
    } else if (S.rute === 'editor') {
      remah = [btn('Panel Admin', 'beranda'), btn('Kursus', 'kursus'), k ? '<span class="potong" style="max-width:240px">' + esc(k.judul) + '</span>' : ''];
      kini = 'Editor Roadmap';
    } else {
      if (adm && S.rute !== 'beranda') remah = [btn('Panel Admin', 'beranda')];
      kini = nama[S.rute] || '';
      if (S.rute === 'beranda' && !adm) kini = 'Halo, ' + (S.data.user.nama || '').split(' ')[0];
    }
    nav.innerHTML = '<span class="remah">' + remah.filter(Boolean).map(r => r + sep).join('') + '</span><b class="kini potong">' + esc(kini) + '</b>';
    document.title = kini + ' · ' + ((S.data.pengaturan && S.data.pengaturan.NAMA_APP) || 'EduTrack Pro');
  }
  function perbaruiKepala() {
    if (!S.data) return;
    const u = S.data.user;
    $('#avatarSaya').textContent = inisial(u.nama || u.email);
    $('#namaSaya').textContent = u.nama || u.email;
    $('#peranSaya').textContent = u.peran === 'admin' ? 'Admin · Creator' : 'Member';
    $('#titikNotif').hidden = !belumDibaca().length;
    perbaruiSyncChip();
  }

  // ==========================================================================
  // 10. KOMPONEN HTML
  // ==========================================================================
  function kosongHtml(ikon, judul, teks, aksi) {
    return '<div class="kosong"><i class="bi ' + ikon + '" aria-hidden="true"></i><h3>' + esc(judul) + '</h3><p>' + esc(teks || '') + '</p>' + (aksi || '') + '</div>';
  }
  function chipKat(kat) { return '<span class="chip ' + warnaKat(kat).kat + '">' + esc(kat || 'Umum') + '</span>'; }
  function barHtml(persen, kelas) { return '<div class="bar ' + (kelas || '') + '" role="progressbar" aria-valuenow="' + persen + '" aria-valuemin="0" aria-valuemax="100"><span style="width:' + Math.max(0, Math.min(100, persen)) + '%"></span></div>'; }
  function ringHtml(persen, atas, bawah) {
    const p = Math.max(0, Math.min(100, persen || 0));
    return '<div class="ring" aria-hidden="true"><svg viewBox="0 0 64 64"><circle class="trk" cx="32" cy="32" r="26"/><circle class="val" cx="32" cy="32" r="26" pathLength="100" stroke-dasharray="' + (p ? Math.max(p, 2) : 0) + ' 100"/></svg><div class="isi"><b>' + esc(atas) + '</b>' + (bawah ? '<small>' + esc(bawah) + '</small>' : '') + '</div></div>';
  }
  function sampulGagal(img) {
    const m = String(img.src).match(/(?:lh3\.googleusercontent\.com\/d\/|[?&]id=)([-\w]{25,})/);
    const n = Number(img.dataset.coba || 0);
    if (m && n < 2) {
      img.dataset.coba = n + 1;
      img.src = n === 0 ? 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w1000' : 'https://drive.google.com/uc?export=view&id=' + m[1];
    } else img.remove();
  }
  // CSP melarang onerror inline; 'error' tidak menggelembung, jadi pakai fase capture.
  document.addEventListener('error', function (e) {
    const t = e.target;
    if (t && t.tagName === 'IMG' && t.dataset && t.dataset.sampul) sampulGagal(t);
  }, true);
  function sampulHtml(k, ekstra) {
    const w = warnaKat(k.kategori);
    const isi = k.thumbnail_url && urlValid(k.thumbnail_url)
      ? '<img src="' + esc(k.thumbnail_url) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-sampul="1">' : '';
    return '<div class="sampul">' + '<div class="sampul-gen ' + w.g + '"><i class="bi ' + w.ikon + '" aria-hidden="true"></i><b>' + esc(k.judul) + '</b></div>' + isi + (ekstra || '') + '</div>';
  }
  function kartuKursus(k, mode) {
    const p = mode === 'member' ? progresKursus(k.id_kursus) : null;
    const katalog = mode === 'katalog';
    const kontak = (S.data.pengaturan && S.data.pengaturan.KONTAK_EMAIL) || '';
    const aksi = katalog
      ? (k.url_beli && urlValid(k.url_beli) ? '<a class="btn btn-utama btn-sm btn-beli" href="' + esc(k.url_beli) + '" target="_blank" rel="noopener" aria-label="Beli ' + esc(k.judul) + '"><i class="bi bi-bag"></i> Beli</a>' : '') + (kontak && !(k.url_beli && urlValid(k.url_beli)) ? '<a class="ikon-bulat" href="mailto:' + esc(kontak) + '?subject=' + encodeURIComponent('Permintaan akses kursus: ' + k.judul) + '" target="_blank" rel="noopener" aria-label="Minta akses ' + esc(k.judul) + '" title="Minta akses"><i class="bi bi-envelope"></i></a>' : '')
      : '<span class="ikon-bulat" aria-hidden="true"><i class="bi bi-play-fill"></i></span>';
    const pita = p && p.persen === 100 ? '<span class="chip sukses pita"><i class="bi bi-patch-check-fill"></i> Selesai</span>' : '';
    return '<article class="kk" ' + (katalog ? '' : 'tabindex="0" role="button" data-act="buka-kursus" data-id="' + esc(k.id_kursus) + '" aria-label="Buka kursus ' + esc(k.judul) + '"') + '>' +
      sampulHtml(k, (katalog ? '<div class="gembok"><i class="bi bi-lock-fill"></i></div>' : '') + pita) +
      '<div class="kk-meta">' + chipKat(k.kategori) + (k.rating ? '<span class="rating"><i class="bi bi-star-fill"></i> ' + angkaID(k.rating) + '</span>' : '') + '</div>' +
      '<h3 class="potong-2">' + esc(k.judul) + '</h3>' +
      (p ? '<div class="kk-progres"><div class="baris"><span>' + p.selesai + '/' + p.total + ' modul</span><b>' + p.persen + '%</b></div>' + barHtml(p.persen, p.persen === 100 ? 'sukses' : '') + '</div>' : '') +
      (katalog ? '<p class="teks-2 kecil potong-2" style="padding:0 4px">' + esc(k.deskripsi) + '</p>' : '') +
      '<div class="kk-kaki"><span class="avatar kecil">' + esc(inisial(k.creator)) + '</span><div class="info"><b>' + esc(k.creator || 'Tim Pengajar') + '</b><small>' + (katalog ? (k.jumlah_modul || 0) + ' modul · ' + esc(k.level) : esc(k.level) + ' · ' + fmtDurasi(p ? p.totalMenit : 0)) + '</small></div>' + aksi + '</div>' +
      '</article>';
  }
  function kartuPaket(p) {
    const beli = p.url_beli ? '<a class="btn btn-utama btn-sm btn-blok" href="' + esc(p.url_beli) + '" target="_blank" rel="noopener" aria-label="Beli ' + esc(p.judul) + '"><i class="bi bi-bag"></i> Beli paket</a>' : '<span class="teks-2 kecil">Hubungi admin untuk membeli paket ini.</span>';
    return '<article class="kk paket">' +
      '<div class="paket-kepala"><span class="chip emas"><i class="bi bi-gift"></i> Paket hemat</span>' + (p.hemat_persen ? '<span class="chip sukses normal-case">Hemat ' + p.hemat_persen + '%</span>' : '') + '</div>' +
      '<h3>' + esc(p.judul) + '</h3>' + (p.deskripsi ? '<p class="teks-2 kecil">' + esc(p.deskripsi) + '</p>' : '') +
      '<ul class="paket-isi">' + p.kursus.map(k => '<li class="' + (k.dimiliki ? 'punya' : '') + '"><i class="bi ' + (k.dimiliki ? 'bi-check-circle-fill' : 'bi-mortarboard') + '" aria-hidden="true"></i><span class="potong">' + esc(k.judul) + '</span><small>' + (k.dimiliki ? 'Sudah dimiliki' : k.jumlah_modul + ' modul') + '</small></li>').join('') + '</ul>' +
      '<div class="paket-harga">' + (p.harga_normal ? '<s>' + esc(rupiah(p.harga_normal)) + '</s>' : '') + '<b>' + esc(rupiah(p.harga)) + '</b><small>' + p.kursus.length + ' kursus sekaligus</small></div>' + beli + '</article>';
  }
  function bagianPaket() {
    const list = (S.data && S.data.paket) || [];
    if (isAdmin() || !list.length) return '';
    return '<section><div class="kepala-bagian"><h2>Paket Hemat</h2><span class="teks-2 kecil">Beli sekali, dapat beberapa kelas</span></div><div class="grid-kursus">' + list.map(kartuPaket).join('') + '</div></section>';
  }
  function kartuKursusAdmin(k) {
    const list = semuaModul(k.id_kursus);
    const akses = S.data.akses.filter(a => a.id_kursus === k.id_kursus && a.status_aktif === 'aktif');
    const terbit = list.filter(m => m.status !== 'draf').length;
    let total = 0;
    akses.forEach(a => { const pm = I.perMember.get(a.email + '|' + k.id_kursus); total += terbit ? Math.min(100, ((pm ? pm.selesai : 0) / terbit) * 100) : 0; });
    const rata = akses.length ? Math.round(total / akses.length) : 0;
    return '<article class="kk" tabindex="0" role="button" data-act="editor" data-id="' + esc(k.id_kursus) + '" aria-label="Edit roadmap ' + esc(k.judul) + '">' +
      sampulHtml(k, '<span class="chip pita ' + (k.status_terbit === 'terbit' ? 'sukses' : 'netral') + '">' + (k.status_terbit === 'terbit' ? 'Terbit' : 'Draf') + '</span>') +
      '<div class="kk-meta">' + chipKat(k.kategori) + '<span class="mini teks-2 mono">' + esc(k.id_kursus) + '</span></div>' +
      '<h3 class="potong-2">' + esc(k.judul) + '</h3>' +
      '<div class="kk-progres"><div class="baris"><span><i class="bi bi-collection"></i> ' + list.length + ' modul · <i class="bi bi-people"></i> ' + akses.length + ' member</span><b>' + rata + '%</b></div>' + barHtml(rata) + '</div>' +
      '<div class="kk-kaki"><span class="avatar kecil">' + esc(inisial(k.creator)) + '</span><div class="info"><b>' + esc(k.creator || '—') + '</b><small>Rata-rata progres member</small></div>' +
      '<button type="button" class="ikon-bulat" data-act="pratinjau-siswa" data-id="' + esc(k.id_kursus) + '" aria-label="Pratinjau sebagai siswa" title="Pratinjau siswa"><i class="bi bi-eye"></i></button></div></article>';
  }
  function itemPengumuman(p, baru) {
    const k = p.id_kursus !== 'SEMUA' && I.kursus.get(p.id_kursus);
    return '<div class="info-item' + (baru ? ' baru' : '') + '"><span class="ikon"><i class="bi bi-megaphone"></i></span><div class="flex-grow-1" style="min-width:0">' +
      '<div class="d-flex justify-content-between gap-2 flex-wrap"><h3>' + esc(p.judul) + (baru ? ' <span class="chip">Baru</span>' : '') + '</h3><small class="teks-2">' + fmtRelatif(p.dibuat) + '</small></div>' +
      '<small class="teks-2">' + esc(k ? k.judul : 'Semua member') + (p.oleh ? ' · ' + esc(p.oleh) : '') + '</small><p>' + autolink(p.isi) + '</p></div></div>';
  }

  // ==========================================================================
  // 11. GRAFIK (Chart.js; fallback batang CSS bila CDN belum siap)
  // ==========================================================================
  const antreChart = [];
  window.addEventListener('load', () => { while (antreChart.length) antreChart.shift()(); });
  function grafikGaris(id, labels, nilai, fmt, opsi) {
    opsi = opsi || {};
    const el = document.getElementById(id); if (!el) return;
    if (S.chart[id]) { try { S.chart[id].destroy(); } catch (e) { } delete S.chart[id]; }
    if (!window.Chart) {
      const maks = Math.max(1, ...nilai);
      el.parentElement.innerHTML = '<div class="grafik-fallback">' + labels.map((l, i) => '<div class="kol"><small>' + esc(fmt(nilai[i])) + '</small><span style="height:' + Math.round(nilai[i] / maks * 100) + '%"></span>' + esc(l) + '</div>').join('') + '</div>';
      if (document.readyState !== 'complete') antreChart.push(() => { tandaiKotor(S.rute); renderUlang(); });
      return;
    }
    const css = getComputedStyle(document.documentElement);
    const v = n => css.getPropertyValue(n).trim();
    const primer = v('--primary') || '#7C5CFF', teks2 = v('--teks-2'), garis = v('--garis-2'), surface = v('--surface'), teks = v('--teks');
    const ctx = el.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, el.parentElement.clientHeight || 230);
    grad.addColorStop(0, 'rgba(124,92,255,.28)'); grad.addColorStop(1, 'rgba(124,92,255,0)');
    const labelPil = {
      id: 'labelPil',
      afterDatasetsDraw(chart) {
        const c = chart.ctx; const meta = chart.getDatasetMeta(0);
        c.save(); c.font = '600 11px Inter, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
        meta.data.forEach((pt, i) => {
          const val = chart.data.datasets[0].data[i]; if (opsi.sembunyiNol && !val) return;
          const t = fmt(val); const w = c.measureText(t).width + 14, h = 20, x = pt.x, y = pt.y - 20;
          c.fillStyle = surface; c.strokeStyle = garis; c.lineWidth = 1;
          c.beginPath(); if (c.roundRect) c.roundRect(x - w / 2, y - h / 2, w, h, 7); else c.rect(x - w / 2, y - h / 2, w, h);
          c.fill(); c.stroke(); c.fillStyle = teks; c.fillText(t, x, y + .5);
        });
        c.restore();
      }
    };
    S.chart[id] = new Chart(el, {
      type: 'line',
      data: { labels, datasets: [{ data: nilai, borderColor: primer, borderWidth: 3, tension: .42, fill: true, backgroundColor: grad, pointRadius: 4, pointHoverRadius: 7, pointBackgroundColor: surface, pointBorderColor: primer, pointBorderWidth: 2.5 }] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
        layout: { padding: { top: 30, left: 4, right: 10 } },
        interaction: { intersect: false, mode: 'index' },
        plugins: { legend: { display: false }, tooltip: { displayColors: false, callbacks: { label: c => fmt(c.parsed.y) } } },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: teks2, font: { size: 11 } } },
          y: { beginAtZero: true, grace: '15%', grid: { color: garis }, border: { display: false }, ticks: { color: teks2, font: { size: 11 }, maxTicksLimit: 5, callback: x => fmt(x, true) } }
        }
      },
      plugins: [labelPil]
    });
  }
  function seriMember(st) {
    const labels = [], jam = [], modul = [];
    if (S.grafik.periode === 'minggu') {
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i); const k = hariKey(d);
        labels.push(HARI[d.getDay()]); jam.push(+((st.perHari.get(k) || 0) / 60).toFixed(1)); modul.push(st.perHariN.get(k) || 0);
      }
    } else {
      for (let w = 3; w >= 0; w--) {
        let m = 0, n = 0;
        for (let i = 0; i < 7; i++) { const d = new Date(); d.setDate(d.getDate() - (w * 7 + i)); const k = hariKey(d); m += st.perHari.get(k) || 0; n += st.perHariN.get(k) || 0; }
        const a = new Date(); a.setDate(a.getDate() - (w * 7 + 6));
        labels.push(a.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })); jam.push(+(m / 60).toFixed(1)); modul.push(n);
      }
    }
    return { labels, jam, modul };
  }
  function kartuStatistikHtml(idCanvas) {
    return '<div class="kartu"><div class="kartu-judul"><h2>Statistik Anda</h2><div class="seg" role="group" aria-label="Periode">' +
      '<button type="button" data-act="grafik-periode" data-v="minggu" aria-pressed="' + (S.grafik.periode === 'minggu') + '">Mingguan</button>' +
      '<button type="button" data-act="grafik-periode" data-v="bulan" aria-pressed="' + (S.grafik.periode === 'bulan') + '">Bulanan</button></div></div>' +
      '<div class="grafik-tab" role="tablist"><button type="button" role="tab" data-act="grafik-jenis" data-v="jam" aria-selected="' + (S.grafik.jenis === 'jam') + '">Jam Belajar</button>' +
      '<button type="button" role="tab" data-act="grafik-jenis" data-v="modul" aria-selected="' + (S.grafik.jenis === 'modul') + '">Modul Selesai</button></div>' +
      '<div class="grafik-wrap"><canvas id="' + idCanvas + '" aria-label="Grafik statistik belajar" role="img"></canvas></div><p class="mini teks-2 mt-2" id="' + idCanvas + 'Ket"></p></div>';
  }
  function gambarStatistik(idCanvas, st) {
    const s = seriMember(st);
    const target = Number((S.data.pengaturan || {}).TARGET_MINGGUAN_JAM) || 5;
    if (S.grafik.jenis === 'jam') grafikGaris(idCanvas, s.labels, s.jam, (x, sumbu) => angkaID(x) + (sumbu ? '' : 'j'));
    else grafikGaris(idCanvas, s.labels, s.modul, x => String(Math.round(x)));
    const ket = $('#' + idCanvas + 'Ket');
    if (ket) {
      const jm = st.menitMinggu / 60;
      ket.innerHTML = '<i class="bi bi-bullseye"></i> ' + angkaID(jm) + ' dari target ' + target + ' jam minggu ini ' + (jm >= target ? '<b class="text-success">— target tercapai!</b>' : '');
    }
  }

  // ==========================================================================
  // 12. VIEW: BERANDA
  // ==========================================================================
  function renderBeranda() {
    if (isAdmin()) return renderBerandaAdmin();
    const el = $('#v-beranda'), P = S.data.pengaturan || {};
    const st = statistikMember();
    const lanjut = lanjutkanTarget();
    const kursus = S.data.kursus.slice().sort((a, b) => progresKursus(b.id_kursus).terakhir - progresKursus(a.id_kursus).terakhir);
    const terbaru = S.data.pengumuman[0];
    el.innerHTML = '<div class="tata-2"><div class="kolom">' +
      '<section class="hero"><div><div class="label-sm">' + esc(P.HERO_LABEL || 'KURSUS ONLINE') + '</div><h1>' + esc(P.HERO_JUDUL || 'Tingkatkan Keterampilan Anda') + '</h1>' +
      '<p>' + esc(lanjut && lanjut.p.berikut ? 'Lanjutkan: ' + lanjut.p.berikut.judul : (P.HERO_SUB || '')) + '</p>' +
      '<button type="button" class="btn btn-hero mt-1" data-act="lanjutkan">' + esc(P.HERO_TOMBOL || 'Mulai Belajar') + ' <span class="ikon-bulat"><i class="bi bi-play-fill"></i></span></button></div>' +
      '<div class="hero-hias" aria-hidden="true"><div class="hero-kartu"><i class="bi bi-mortarboard"></i></div>' +
      (lanjut ? '<span class="hero-tag t1">' + esc(lanjut.k.kategori) + '</span><span class="hero-tag t2">' + lanjut.p.persen + '% selesai</span>' : '') + '</div></section>' +
      '<section><div class="kepala-bagian"><h2>Kursus Saya</h2><div class="d-flex gap-1 sembunyi-mobile">' +
      '<button type="button" class="ikon-btn kotak btn-garis" data-act="gulir" data-target="gulirSaya" data-arah="-1" aria-label="Geser ke kiri"><i class="bi bi-chevron-left"></i></button>' +
      '<button type="button" class="ikon-btn kotak btn-garis" data-act="gulir" data-target="gulirSaya" data-arah="1" aria-label="Geser ke kanan"><i class="bi bi-chevron-right"></i></button></div></div>' +
      (kursus.length ? '<div class="gulir-x" id="gulirSaya">' + kursus.map(k => kartuKursus(k, 'member')).join('') + '</div>'
        : '<div class="kartu">' + kosongHtml('bi-journal-plus', 'Belum ada kursus aktif', 'Hubungi admin untuk mengaktifkan akses kursus Anda.', '') + '</div>') + '</section>' +
      bagianPaket() +
      (S.data.katalog.length ? '<section><div class="kepala-bagian"><h2>Jelajahi Kursus Lain</h2><button type="button" class="btn btn-teks btn-sm" data-act="nav" data-to="kursus">Lihat semua</button></div>' +
        '<div class="gulir-x">' + S.data.katalog.slice(0, 8).map(k => kartuKursus(k, 'katalog')).join('') + '</div></section>' : '') +
      '</div><aside class="kolom">' +
      '<div class="grid-statistik">' +
      '<div class="stat">' + ringHtml(st.total ? st.selesai / st.total * 100 : 0, st.selesai + '/' + st.total) + '<div class="teks"><b>Kursus</b><small>selesai</small></div></div>' +
      '<div class="stat">' + ringHtml(st.total ? st.berjalan / st.total * 100 : 0, st.berjalan + '/' + st.total) + '<div class="teks"><b>Kursus</b><small>sedang berjalan</small></div></div>' +
      '<div class="stat">' + ringHtml(Math.min(100, st.menit / 60 / Math.max(1, Number(P.TARGET_MINGGUAN_JAM) * 4) * 100), angkaID(st.menit / 60), 'jam') + '<div class="teks"><b>Total</b><small>waktu belajar</small></div></div>' +
      '<div class="stat">' + ringHtml(Math.min(100, st.streak / 7 * 100), st.streak, 'hari') + '<div class="teks"><b>Streak</b><small>belajar harian</small></div></div>' +
      '</div>' + kartuStatistikHtml('grafikBeranda') +
      (terbaru ? '<div class="promo"><span class="label-sm" style="color:var(--primary-teks)">Pengumuman terbaru</span><h3 class="mt-1">' + esc(terbaru.judul) + '</h3><p>' + esc(String(terbaru.isi).slice(0, 140)) + '</p><button type="button" class="btn btn-utama btn-sm" data-act="nav" data-to="pesan">Baca selengkapnya</button><i class="bi bi-megaphone-fill megafon" aria-hidden="true"></i></div>'
        : '<div class="promo"><h3>' + esc(P.PROMO_JUDUL || '') + '</h3><p>' + esc(P.PROMO_TEKS || '') + '</p>' + (P.KONTAK_EMAIL ? '<a class="btn btn-utama btn-sm" href="mailto:' + esc(P.KONTAK_EMAIL) + '" target="_blank" rel="noopener">' + esc(P.PROMO_TOMBOL || 'Hubungi Admin') + '</a>' : '') + '<i class="bi bi-megaphone-fill megafon" aria-hidden="true"></i></div>') +
      '</aside></div>';
    gambarStatistik('grafikBeranda', st);
  }

  function renderBerandaAdmin() {
    const el = $('#v-beranda'), d = S.data;
    const terbit = d.kursus.filter(k => k.status_terbit === 'terbit').length;
    const aksesAktif = d.akses.filter(a => a.status_aktif === 'aktif');
    const memberAktif = new Set(aksesAktif.map(a => a.email)).size;
    const totalModul = d.modul.length;
    const harian = (d.ringkas && d.ringkas.harian) || {};
    const labels = [], nilai = [];
    let minggu = 0, mingguLalu = 0;
    for (let i = 13; i >= 0; i--) {
      const t = new Date(); t.setDate(t.getDate() - i); const k = hariKey(t); const n = harian[k] ? harian[k][0] : 0;
      labels.push(t.toLocaleDateString('id-ID', { day: 'numeric', month: 'numeric' })); nilai.push(n);
      if (i < 7) minggu += n; else mingguLalu += n;
    }
    // Rata-rata progres semua akses aktif
    let jml = 0, sumPct = 0;
    aksesAktif.forEach(a => { const t = modulTerbit(a.id_kursus).length; if (!t) return; const pm = I.perMember.get(a.email + '|' + a.id_kursus); sumPct += Math.min(100, (pm ? pm.selesai : 0) / t * 100); jml++; });
    const rata = jml ? Math.round(sumPct / jml) : 0;
    const ins = insightAdmin(minggu, mingguLalu);
    const akt = ((d.ringkas && d.ringkas.aktivitas) || []).slice(0, 8);
    el.innerHTML = '<div class="kepala-halaman"><div><h1>Halo, ' + esc((d.user.nama || '').split(' ')[0] || 'Admin') + '</h1><p>Ringkasan portal belajar hari ini, ' + new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' }) + '.</p></div>' +
      '<div class="d-flex gap-2 flex-wrap"><button type="button" class="btn btn-garis" data-act="tambah-akses"><i class="bi bi-person-plus"></i> Tambah Akses</button><button type="button" class="btn btn-utama" data-act="buat-kursus"><i class="bi bi-plus-lg"></i> Kursus Baru</button></div></div>' +
      '<div class="grid-kpi mb-4">' +
      kpi('bi-mortarboard', 'kat-ungu', terbit + '/' + d.kursus.length, 'Kursus terbit') +
      kpi('bi-people', 'kat-hijau', memberAktif, 'Member aktif') +
      kpi('bi-collection-play', 'kat-indigo', totalModul, 'Total modul') +
      kpi('bi-graph-up-arrow', 'kat-oranye', rata + '%', 'Rata-rata progres') + '</div>' +
      '<div class="tata-2"><div class="kolom">' +
      '<div class="kartu"><div class="kartu-judul"><h2>Modul diselesaikan (14 hari)</h2><span class="chip ' + (minggu >= mingguLalu ? 'sukses' : 'bahaya') + ' normal-case"><i class="bi bi-arrow-' + (minggu >= mingguLalu ? 'up' : 'down') + '-right"></i> ' + minggu + ' minggu ini</span></div><div class="grafik-wrap"><canvas id="grafikAdmin" role="img" aria-label="Grafik modul selesai per hari"></canvas></div></div>' +
      '<div class="kartu"><div class="kartu-judul"><h2>Kursus & tingkat penyelesaian</h2><button type="button" class="btn btn-teks btn-sm" data-act="nav" data-to="kursus">Kelola</button></div>' + tabelKursusRingkas() + '</div>' +
      '</div><aside class="kolom">' +
      '<div class="kartu"><div class="kartu-judul"><h2><span class="ikon-judul"><i class="bi bi-stars"></i></span>Insight otomatis</h2></div><div class="insight">' + ins + '</div></div>' +
      '<div class="kartu"><div class="kartu-judul"><h2>Aktivitas terbaru</h2></div><div class="aktivitas">' +
      (akt.length ? akt.map(a => { const m = I.modul.get(a[1]); const u = I.pengguna.get(a[0]); return '<div class="aktivitas-item"><span class="avatar kecil">' + esc(inisial(u ? u.nama : a[0])) + '</span><div class="flex-grow-1" style="min-width:0"><b>' + esc(u ? u.nama : a[0]) + '</b> menyelesaikan <span class="teks-2">' + esc(m ? m.judul : a[1]) + '</span><br><small class="teks-2">' + fmtRelatif(a[2]) + '</small></div></div>'; }).join('') : '<p class="teks-2">Belum ada aktivitas.</p>') +
      '</div></div></aside></div>';
    grafikGaris('grafikAdmin', labels, nilai, x => String(Math.round(x)), { sembunyiNol: true });
  }
  function kpi(ikon, kelas, nilai, label) {
    return '<div class="kartu rapat"><div class="kpi"><span class="ikon ' + kelas + '"><i class="bi ' + ikon + '"></i></span><div><div class="nilai angka">' + esc(nilai) + '</div><small>' + esc(label) + '</small></div></div></div>';
  }
  function statKursusAdmin(k) {
    const t = modulTerbit(k.id_kursus).length;
    const akses = S.data.akses.filter(a => a.id_kursus === k.id_kursus && a.status_aktif === 'aktif');
    let selesai = 0, sum = 0, belum = 0;
    akses.forEach(a => { const pm = I.perMember.get(a.email + '|' + k.id_kursus); const n = pm ? pm.selesai : 0; const pct = t ? Math.min(100, n / t * 100) : 0; sum += pct; if (t && n >= t) selesai++; if (!n) belum++; });
    return { t, member: akses.length, selesai, belum, rata: akses.length ? Math.round(sum / akses.length) : 0 };
  }
  function tabelKursusRingkas() {
    if (!S.data.kursus.length) return kosongHtml('bi-mortarboard', 'Belum ada kursus', '', '');
    return '<div class="tabel-wrap"><table class="tabel kartu-mobile"><thead><tr><th>Kursus</th><th>Member</th><th>Lulus</th><th>Rata-rata</th></tr></thead><tbody>' +
      S.data.kursus.map(k => { const s = statKursusAdmin(k); return '<tr><td class="utama"><button type="button" class="link-btn" style="min-height:0;text-align:left" data-act="editor" data-id="' + esc(k.id_kursus) + '">' + esc(k.judul) + '</button></td><td data-label="Member">' + s.member + '</td><td data-label="Lulus">' + s.selesai + '</td><td data-label="Rata-rata"><div class="bar-sel">' + barHtml(s.rata) + '<b class="angka">' + s.rata + '%</b></div></td></tr>'; }).join('') +
      '</tbody></table></div>';
  }
  function insightAdmin(minggu, mingguLalu) {
    const d = S.data, out = [];
    const item = (ikon, teks, aksi) => out.push('<div class="insight-item"><i class="bi ' + ikon + '"></i><div><p>' + teks + '</p>' + (aksi || '') + '</div></div>');
    if (mingguLalu || minggu) {
      const ubah = mingguLalu ? Math.round((minggu - mingguLalu) / mingguLalu * 100) : 100;
      item(ubah >= 0 ? 'bi-graph-up-arrow' : 'bi-graph-down-arrow', 'Penyelesaian modul minggu ini <b>' + minggu + '</b> (' + (ubah >= 0 ? '+' : '') + ubah + '% dibanding minggu lalu).');
    }
    // Titik berhenti (drop-off): modul yang paling banyak menahan member
    const henti = new Map();
    d.akses.filter(a => a.status_aktif === 'aktif').forEach(a => {
      const list = modulTerbit(a.id_kursus); const pm = I.perMember.get(a.email + '|' + a.id_kursus); const n = pm ? pm.selesai : 0;
      if (n > 0 && n < list.length) { const m = list[n]; henti.set(m.id_modul, (henti.get(m.id_modul) || 0) + 1); }
    });
    const top = [...henti.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 1) { const m = I.modul.get(top[0]); const k = m && I.kursus.get(m.id_kursus); item('bi-sign-stop', '<b>' + top[1] + ' member</b> tertahan di modul <b>' + esc(m ? m.judul : '') + '</b>' + (k ? ' (' + esc(k.judul) + ')' : '') + '. Pertimbangkan menambah lampiran atau penjelasan.', m ? '<button type="button" class="btn btn-teks btn-sm mt-1" data-act="editor" data-id="' + esc(m.id_kursus) + '">Buka editor</button>' : ''); }
    const belum = d.akses.filter(a => a.status_aktif === 'aktif' && !I.perMember.get(a.email + '|' + a.id_kursus)).length;
    if (belum) item('bi-hourglass-split', '<b>' + belum + ' akses aktif</b> belum memulai modul pertama. Kirim pengumuman pengingat agar mereka mulai belajar.', '<button type="button" class="btn btn-teks btn-sm mt-1" data-act="nav" data-to="pesan">Tulis pengumuman</button>');
    const terbaik = d.kursus.map(k => ({ k, s: statKursusAdmin(k) })).filter(x => x.s.member).sort((a, b) => b.s.rata - a.s.rata)[0];
    if (terbaik) item('bi-trophy', 'Kursus dengan progres rata-rata tertinggi: <b>' + esc(terbaik.k.judul) + '</b> (' + terbaik.s.rata + '%).');
    const kosongModul = d.kursus.filter(k => !semuaModul(k.id_kursus).length);
    if (kosongModul.length) item('bi-exclamation-diamond', '<b>' + kosongModul.length + ' kursus</b> belum memiliki modul: ' + kosongModul.slice(0, 2).map(k => esc(k.judul)).join(', ') + '.');
    if (d.info && d.info.kuotaEmail >= 0 && d.info.kuotaEmail < 20) item('bi-envelope-exclamation', 'Sisa kuota email hari ini tinggal <b>' + d.info.kuotaEmail + '</b>. Login member baru bisa terhambat.');
    return out.length ? out.join('') : '<p class="teks-2">Insight akan muncul setelah member mulai belajar.</p>';
  }

  // ==========================================================================
  // 13. VIEW: KURSUS (member & admin)
  // ==========================================================================
  function renderKursus() {
    const el = $('#v-kursus');
    const adm = isAdmin();
    const q = S.filter.cari.toLowerCase();
    const kat = S.filter.kategori;
    const sumber = S.data.kursus;
    const daftarKat = [...new Set(sumber.concat(S.data.katalog).map(k => k.kategori).filter(Boolean))];
    const opsiStatus = adm ? [['semua', 'Semua'], ['terbit', 'Terbit'], ['draf', 'Draf']] : [['semua', 'Semua'], ['berjalan', 'Sedang berjalan'], ['selesai', 'Selesai'], ['belum', 'Belum dimulai']];
    const lolos = k => {
      if (kat && k.kategori !== kat) return false;
      if (q && !(k.judul + ' ' + k.kategori + ' ' + k.creator + ' ' + k.deskripsi).toLowerCase().includes(q)) return false;
      if (S.filter.status === 'semua') return true;
      if (adm) return k.status_terbit === S.filter.status;
      const p = progresKursus(k.id_kursus);
      return S.filter.status === 'selesai' ? p.total && p.persen === 100 : S.filter.status === 'berjalan' ? p.selesai && p.persen < 100 : !p.selesai;
    };
    const list = sumber.filter(lolos);
    const katalog = adm ? [] : S.data.katalog.filter(k => (!kat || k.kategori === kat) && (!q || (k.judul + ' ' + k.kategori).toLowerCase().includes(q)));
    el.innerHTML = '<div class="kepala-halaman"><div><h1>' + (adm ? 'Kelola Kursus' : 'Kursus Saya') + '</h1><p>' + (adm ? 'Buat kursus, susun roadmap modul, dan atur status terbit.' : 'Lanjutkan roadmap belajar Anda dari modul terakhir.') + '</p></div>' +
      (adm ? '<button type="button" class="btn btn-utama" data-act="buat-kursus"><i class="bi bi-plus-lg"></i> Buat Kursus Baru</button>' : '') + '</div>' +
      '<div class="alat"><div class="seg" role="group" aria-label="Filter status">' + opsiStatus.map(([v, t]) => '<button type="button" data-act="filter-status" data-v="' + v + '" aria-pressed="' + (S.filter.status === v) + '">' + t + '</button>').join('') + '</div>' +
      '<select class="select" data-ubah="filter-kategori" aria-label="Filter kategori" style="max-width:240px"><option value="">Semua kategori</option>' + daftarKat.map(c => '<option' + (c === kat ? ' selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>' +
      (q ? '<span class="chip normal-case">Pencarian: "' + esc(S.filter.cari) + '" <button type="button" class="ikon-btn" style="width:24px;height:24px;font-size:12px" data-act="hapus-cari" aria-label="Hapus pencarian"><i class="bi bi-x"></i></button></span>' : '') + '</div>' +
      (list.length ? '<div class="grid-kursus">' + list.map(k => adm ? kartuKursusAdmin(k) : kartuKursus(k, 'member')).join('') + '</div>'
        : '<div class="kartu">' + kosongHtml('bi-search', 'Tidak ada kursus yang cocok', 'Ubah filter atau kata kunci pencarian.', '') + '</div>') +
      (bagianPaket() ? '<div class="mt-4">' + bagianPaket() + '</div>' : '') +
      (katalog.length ? '<div class="kepala-bagian mt-4"><h2>Katalog — belum dimiliki</h2><span class="teks-2 kecil">' + (katalog.some(x => x.url_beli) ? 'Beli sekali — akses terbuka otomatis setelah pembayaran' : 'Klik ikon email untuk meminta akses ke admin') + '</span></div><div class="grid-kursus">' + katalog.map(k => kartuKursus(k, 'katalog')).join('') + '</div>' : '');
  }

  // ==========================================================================
  // 14. VIEW: HALAMAN BELAJAR (player, roadmap checklist, berkas)
  // ==========================================================================
  function listBelajar(idK) { return isAdmin() ? semuaModul(idK) : modulTerbit(idK); }
  function modulAktifBelajar() {
    const idK = S.belajar.idKursus, list = listBelajar(idK);
    let m = I.modul.get(S.belajar.idModul);
    if (!m || m.id_kursus !== idK) { const p = progresKursus(idK); m = p.berikut || list[list.length - 1] || null; }
    if (m) S.belajar.idModul = m.id_modul;
    return { list, m };
  }
  function renderBelajar() {
    const el = $('#v-belajar');
    const k = I.kursus.get(S.belajar.idKursus);
    if (!k) { el.innerHTML = '<div class="kartu">' + kosongHtml('bi-journal-x', 'Kursus tidak tersedia', 'Kursus ini tidak ditemukan atau akses Anda sudah tidak aktif.', '<button type="button" class="btn btn-ghost" data-act="nav" data-to="kursus">Kembali ke kursus</button>') + '</div>'; return; }
    const { list, m } = modulAktifBelajar();
    if (!m) { el.innerHTML = '<div class="kartu">' + kosongHtml('bi-collection', 'Belum ada modul', 'Roadmap kursus ini sedang disiapkan.', isAdmin() ? '<button type="button" class="btn btn-utama" data-act="editor" data-id="' + esc(k.id_kursus) + '">Buka Editor Roadmap</button>' : '') + '</div>'; return; }
    el.innerHTML = (isAdmin() ? '<div class="banner-sync info"><i class="bi bi-eye"></i><div class="isi"><b>Mode pratinjau siswa.</b> Semua modul terbuka dan progres tidak dicatat.</div><button type="button" class="btn btn-garis btn-sm" data-act="editor" data-id="' + esc(k.id_kursus) + '">Kembali ke editor</button></div>' : '') +
      '<div class="tata-belajar"><div class="kolom"><div id="blPlayer">' + playerHtml(k, m, list) + '</div><div class="kartu info-modul" id="blInfo">' + infoModulHtml(k, m, list) + '</div>' +
      '<div class="kartu" id="blTab">' + tabBelajarHtml(m) + '</div><div id="blBerkas">' + berkasHtml(m, list) + '</div></div>' +
      '<aside class="kolom lekat" id="blAside">' + asideBelajarHtml(k, m, list) + '</aside></div>';
  }
  function perbaruiBelajarParsial() {
    const k = I.kursus.get(S.belajar.idKursus); if (!k) return render('belajar');
    const { list, m } = modulAktifBelajar(); if (!m) return render('belajar');
    const st = statusModul(m, list);
    const player = $('#blPlayer');
    if (player && !(S.belajar.putar === m.id_modul && st !== 'terkunci')) player.innerHTML = playerHtml(k, m, list);
    $('#blInfo').innerHTML = infoModulHtml(k, m, list);
    $('#blBerkas').innerHTML = berkasHtml(m, list);
    $('#blAside').innerHTML = asideBelajarHtml(k, m, list);
    breadcrumb();
  }
  function playerHtml(k, m, list) {
    const st = statusModul(m, list);
    if (st === 'terkunci') {
      return '<div class="player panel-berkas panel-terkunci"><div><div class="ikon-besar"><i class="bi bi-lock-fill"></i></div><h2>Modul masih terkunci</h2><p class="mt-2">Selesaikan modul sebelumnya untuk membuka materi ini.</p>' +
        '<button type="button" class="btn btn-putih mt-3" data-act="buka-modul" data-id="' + esc(progresKursus(k.id_kursus).berikut ? progresKursus(k.id_kursus).berikut.id_modul : '') + '">Ke modul yang harus diselesaikan</button></div></div>';
    }
    if (m.tipe === 'video') {
      const id = ytId(m.sumber);
      if (!id) return '<div class="player panel-berkas"><div><div class="ikon-besar"><i class="bi bi-exclamation-triangle"></i></div><h2>URL video tidak valid</h2></div></div>';
      if (S.belajar.putar === m.id_modul) return '<div class="player"><iframe src="https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&modestbranding=1&playsinline=1" title="' + esc(m.judul) + '" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe></div>';
      return '<div class="player"><img class="poster" src="https://i.ytimg.com/vi/' + id + '/hqdefault.jpg" alt="" loading="eager"><div class="lapis"></div>' +
        '<div class="judul-video"><span class="chip">M' + (list.indexOf(m) + 1) + '</span><span class="potong">' + esc(m.judul) + '</span></div>' +
        '<button type="button" class="tombol-putar" data-act="putar-video" aria-label="Putar video ' + esc(m.judul) + '"><i class="bi bi-play-fill"></i></button></div>';
    }
    if (m.tipe === 'tautan') {
      let host = ''; try { host = new URL(m.sumber).hostname; } catch (e) { }
      return '<div class="player panel-berkas"><div><div class="ikon-besar"><i class="bi bi-box-arrow-up-right"></i></div><h2>' + esc(m.judul) + '</h2><p class="mt-2">Materi atau tugas di ' + esc(host || 'situs eksternal') + '</p>' +
        '<a class="btn btn-putih mt-3" href="' + esc(m.sumber) + '" target="_blank" rel="noopener noreferrer"><i class="bi bi-box-arrow-up-right"></i> Buka Tautan</a></div></div>';
    }
    const kb = kelasBerkas(m.nama_berkas);
    return '<div class="player panel-berkas"><div><div class="ikon-besar"><i class="bi ' + (m.tipe === 'zip' ? 'bi-file-earmark-zip' : 'bi-file-earmark-text') + '"></i></div><h2>' + esc(m.nama_berkas || m.judul) + '</h2>' +
      '<p class="mt-2">' + (m.tipe === 'zip' ? 'Berkas proyek ZIP' : 'Dokumen materi') + ' · ' + fmtUkuran(m.ukuran_berkas) + ' · disimpan privat di Google Drive</p>' +
      '<div class="d-flex gap-2 justify-content-center flex-wrap mt-3"><button type="button" class="btn btn-putih" data-act="unduh" data-modul="' + esc(m.id_modul) + '" data-berkas="' + esc(m.sumber) + '" data-nama="' + esc(m.nama_berkas) + '" data-unduh-id="' + esc(m.sumber) + '"><i class="bi bi-download"></i> Unduh</button>' +
      (kb === 'pdf' ? '<button type="button" class="btn btn-hero" data-act="pratinjau-pdf" data-modul="' + esc(m.id_modul) + '" data-berkas="' + esc(m.sumber) + '" data-nama="' + esc(m.nama_berkas) + '"><i class="bi bi-eye"></i> Pratinjau</button>' : '') + '</div></div></div>';
  }
  function infoModulHtml(k, m, list) {
    const st = statusModul(m, list), i = list.indexOf(m);
    const prev = list[i - 1], next = list[i + 1];
    const nextSt = next ? statusModul(next, list) : null;
    let tombol;
    if (isAdmin()) tombol = '<button type="button" class="btn btn-garis" disabled title="Admin tidak mencatat progres"><i class="bi bi-eye"></i> Mode Pratinjau</button>';
    else if (st === 'selesai') tombol = '<button type="button" class="btn btn-selesai sudah" aria-disabled="true"><i class="bi bi-check-circle-fill"></i> Selesai ' + esc(fmtRelatif(I.selesai.get(m.id_modul))) + '</button>';
    else tombol = '<button type="button" class="btn btn-utama btn-selesai" data-act="tandai-selesai" data-id="' + esc(m.id_modul) + '"' + (st === 'terkunci' ? ' disabled' : '') + '><i class="bi bi-check-circle"></i> Tandai Selesai</button>';
    return '<div class="atas"><div style="min-width:0;flex:1 1 300px"><div class="d-flex gap-2 flex-wrap mb-2">' + chipKat(k.kategori) + '<span class="chip netral normal-case">Level: ' + esc(k.level) + '</span>' + (m.status === 'draf' ? '<span class="chip emas">Draf</span>' : '') + '</div>' +
      '<h1 style="font-size:22px;line-height:30px">' + esc(m.judul) + '</h1><div class="meta-baris mt-2"><span><i class="bi bi-clock"></i> ' + fmtDurasi(m.durasi_menit) + '</span><span><i class="bi ' + TIPE[m.tipe].ikon + '"></i> ' + TIPE[m.tipe].pendek + '</span><span><i class="bi bi-arrow-repeat"></i> Diperbarui ' + fmtRelatif(m.diperbarui) + '</span></div></div>' + tombol + '</div>' +
      '<div class="nav-modul"><button type="button" data-act="buka-modul" data-id="' + esc(prev ? prev.id_modul : '') + '"' + (prev ? '' : ' disabled') + ' aria-label="Modul sebelumnya"><i class="bi bi-arrow-left"></i><span>Sebelumnya</span></button>' +
      '<div class="tengah">Modul <b>' + (i + 1) + '</b> dari ' + list.length + '<br><span class="potong d-inline-block" style="max-width:220px">' + esc(k.judul) + '</span></div>' +
      '<button type="button" class="kanan" data-act="buka-modul" data-id="' + esc(next ? next.id_modul : '') + '"' + (next && nextSt !== 'terkunci' ? '' : ' disabled') + ' aria-label="Modul berikutnya" title="' + (next && nextSt === 'terkunci' ? 'Tandai modul ini selesai untuk membuka' : '') + '"><span>Berikutnya</span><i class="bi bi-arrow-right"></i></button></div>';
  }
  function tabBelajarHtml(m) {
    const tautan = ambilTautan(m.deskripsi).concat(m.tipe === 'tautan' ? [m.sumber] : []).filter((u, i, a) => a.indexOf(u) === i);
    const tab = S.belajar.tab;
    const tombol = (id, t, n) => '<button type="button" role="tab" data-act="tab-belajar" data-v="' + id + '" aria-selected="' + (tab === id) + '">' + t + (n ? '<span class="hitung">' + n + '</span>' : '') + '</button>';
    let isi = '';
    if (tab === 'ringkasan') isi = m.deskripsi ? '<div class="prosa">' + autolink(m.deskripsi) + '</div>' : '<p class="teks-2">Belum ada ringkasan untuk modul ini.</p>';
    else if (tab === 'catatan') isi = '<label class="label" for="catatanModul">Catatan pribadi (tersimpan di perangkat ini)</label><textarea class="textarea" id="catatanModul" data-ketik="catatan" data-id="' + esc(m.id_modul) + '" placeholder="Tulis poin penting, pertanyaan, atau ringkasan Anda…">' + esc(LS.get('catatan_' + m.id_modul, '')) + '</textarea><p class="bantuan" id="catatanStatus">Tersimpan otomatis.</p>';
    else isi = tautan.length ? '<div class="daftar-berkas">' + tautan.map(u => '<a class="berkas" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer" style="text-decoration:none;color:inherit"><span class="tipe lain"><i class="bi bi-link-45deg" style="font-size:18px"></i></span><span class="info"><b>' + esc(u.replace(/^https?:\/\//, '')) + '</b><small>Tautan eksternal</small></span><i class="bi bi-box-arrow-up-right teks-2"></i></a>').join('') + '</div>' : '<p class="teks-2">Tidak ada tautan eksternal.</p>';
    return '<div class="tabs" role="tablist">' + tombol('ringkasan', 'Ringkasan') + tombol('catatan', 'Catatan Saya') + tombol('tautan', 'Tautan Eksternal', tautan.length) + '</div><div role="tabpanel">' + isi + '</div>';
  }
  function berkasModul(m) {
    const out = [];
    if ((m.tipe === 'dokumen' || m.tipe === 'zip') && m.sumber) out.push({ id: m.sumber, nama: m.nama_berkas || 'Berkas utama', ukuran: m.ukuran_berkas, utama: true });
    (m.lampiran || []).forEach(l => out.push({ id: l.id, nama: l.nama, ukuran: l.ukuran }));
    return out;
  }
  function berkasHtml(m, list) {
    const b = berkasModul(m);
    if (!b.length) return '';
    const kunci = statusModul(m, list) === 'terkunci';
    return '<div class="kartu"><div class="kartu-judul"><h2><span class="ikon-judul"><i class="bi bi-folder2-open"></i></span><span>Materi & Berkas Unduhan<br><small class="teks-2 kecil" style="font-family:var(--font-isi);font-weight:400">Disimpan privat — diunduh lewat server setelah akses diperiksa</small></span></h2><span class="chip netral normal-case">' + b.length + ' berkas</span></div><div class="daftar-berkas">' +
      b.map(f => { const kb = kelasBerkas(f.nama); return '<div class="berkas"><span class="tipe ' + kb + '">' + esc((ekstensi(f.nama) || 'file').toUpperCase()) + '</span><div class="info"><b>' + esc(f.nama) + '</b><small>' + fmtUkuran(f.ukuran) + (f.utama ? ' · Materi utama' : ' · Lampiran pendukung') + '</small></div>' +
        (kb === 'pdf' && !kunci ? '<button type="button" class="ikon-btn" data-act="pratinjau-pdf" data-modul="' + esc(m.id_modul) + '" data-berkas="' + esc(f.id) + '" data-nama="' + esc(f.nama) + '" aria-label="Pratinjau ' + esc(f.nama) + '"><i class="bi bi-eye"></i></button>' : '') +
        '<button type="button" class="ikon-btn btn-unduh" data-act="unduh" data-modul="' + esc(m.id_modul) + '" data-berkas="' + esc(f.id) + '" data-nama="' + esc(f.nama) + '" data-unduh-id="' + esc(f.id) + '"' + (kunci ? ' disabled' : '') + ' aria-label="Unduh ' + esc(f.nama) + '"><i class="bi ' + (kunci ? 'bi-lock' : 'bi-download') + '"></i></button></div>'; }).join('') + '</div></div>';
  }
  function asideBelajarHtml(k, m, list) {
    const p = progresKursus(k.id_kursus);
    const P = S.data.pengaturan || {};
    const items = list.map((x, i) => {
      const st = statusModul(x, list); const kini = x === m;
      const ikon = st === 'selesai' ? 'bi-check-lg' : st === 'terkunci' ? 'bi-lock-fill' : kini ? 'bi-play-fill' : (i + 1);
      return '<button type="button" class="rm-item ' + st + (kini ? ' kini' : '') + '" data-act="buka-modul" data-id="' + esc(x.id_modul) + '"' + (st === 'terkunci' ? ' aria-disabled="true"' : '') + ' aria-current="' + (kini ? 'step' : 'false') + '">' +
        '<span class="rm-tanda">' + (typeof ikon === 'number' ? ikon : '<i class="bi ' + ikon + '"></i>') + '</span><span class="rm-teks">' + (kini && st !== 'selesai' ? '<span class="status">Sedang dipelajari</span>' : '') +
        '<b>' + (i + 1) + '. ' + esc(x.judul) + '</b><small>' + fmtMenitPendek(x.durasi_menit) + ' · ' + TIPE[x.tipe].pendek + (st === 'selesai' ? ' · Selesai' : st === 'terkunci' ? ' · Selesaikan modul sebelumnya' : '') + (x.status === 'draf' ? ' · Draf' : '') + '</small></span></button>';
    }).join('');
    return '<div class="kartu"><div class="kartu-judul"><h2><span class="ikon-judul"><i class="bi bi-map"></i></span>Roadmap</h2><span class="label-sm teks-2">' + list.length + ' modul</span></div>' +
      (isAdmin() ? '' : '<div class="ringkas-progres"><div class="baris"><span>Progres kursus</span><b>' + p.persen + '%</b></div>' + barHtml(p.persen, p.persen === 100 ? 'sukses tebal' : 'tebal') + '<div class="baris"><small class="teks-2">' + p.selesai + ' dari ' + p.total + ' modul selesai</small><small class="teks-2">' + fmtMenitPendek(p.menit) + ' / ' + fmtMenitPendek(p.totalMenit) + '</small></div></div>') +
      '<nav class="roadmap" aria-label="Daftar modul">' + items + '</nav></div>' +
      '<div class="kartu"><div class="instruktur"><span class="avatar" style="width:52px;height:52px">' + esc(inisial(k.creator)) + '</span><div style="min-width:0"><b class="d-block">' + esc(k.creator || 'Tim Pengajar') + '</b><small class="teks-2">Instruktur · ' + esc(k.kategori) + '</small>' + (k.rating ? '<div class="rating mt-1"><i class="bi bi-star-fill"></i> ' + angkaID(k.rating) + '</div>' : '') + '</div></div>' +
      '<p class="teks-2 kecil mt-3">Ada kendala dengan materi ini? Kirim pertanyaan ke instruktur melalui email admin.</p>' +
      (P.KONTAK_EMAIL ? '<a class="btn btn-ghost btn-blok mt-3" href="mailto:' + esc(P.KONTAK_EMAIL) + '?subject=' + encodeURIComponent('Pertanyaan: ' + k.judul + ' — ' + m.judul) + '" target="_blank" rel="noopener"><i class="bi bi-chat-left-text"></i> Tanya Instruktur</a>' : '') + '</div>';
  }

  // ---- Tandai selesai (optimistic + antrean offline) ----
  function tandaiSelesai(id) {
    if (isAdmin()) { toast('Mode pratinjau admin: progres tidak dicatat.', 'info'); return; }
    const m = I.modul.get(id); if (!m || I.selesai.has(id)) return;
    const list = modulTerbit(m.id_kursus);
    if (statusModul(m, list) === 'terkunci') { toast('Selesaikan modul sebelumnya terlebih dahulu.', 'peringatan'); return; }
    const waktu = new Date().toISOString();
    S.data.progres.push({ id_modul: id, id_kursus: m.id_kursus, waktu, _antre: true });
    I.selesai.set(id, waktu);
    if (!S.outbox.includes(id)) S.outbox.push(id);
    LS.set(kunciOutbox(), S.outbox);
    tandaiKotor('beranda', 'kursus', 'progres', 'profil');
    if (S.rute === 'belajar') perbaruiBelajarParsial();
    const p = progresKursus(m.id_kursus);
    const next = list[list.indexOf(m) + 1];
    if (p.persen === 100) toast('Luar biasa! Anda menyelesaikan seluruh kursus ini.', 'sukses', { durasi: 6000 });
    else toast('Modul selesai. ' + (next ? 'Modul berikutnya terbuka.' : ''), 'sukses', next ? { aksi: { teks: 'Lanjut', fn: () => go('belajar', { id: m.id_kursus, modul: next.id_modul }) } } : null);
    simpanSnapshot();
    flushOutbox();
  }
  function flushOutbox() {
    perbaruiSyncChip();
    if (S.sinkron.jalan || !S.outbox.length || !S.token || isAdmin()) return;
    S.sinkron.jalan = true; perbaruiSyncChip();
    const ids = S.outbox.slice();
    serverBatas(45000, 'tandaiSelesai', S.token, ids).then(r => {
      S.sinkron.jalan = false; S.sinkron.gagal = 0;
      const beres = new Set(r.tersimpan.map(x => x.id_modul).concat(r.sudah, r.ditolak.map(x => x.id)));
      S.outbox = S.outbox.filter(id => !beres.has(id));
      LS.set(kunciOutbox(), S.outbox);
      r.tersimpan.forEach(x => { const p = S.data.progres.find(q => q.id_modul === x.id_modul); if (p) { p.waktu = x.waktu; delete p._antre; } I.selesai.set(x.id_modul, x.waktu); });
      r.sudah.forEach(id => { const p = S.data.progres.find(q => q.id_modul === id); if (p) delete p._antre; });
      if (r.ditolak.length) {
        const tolak = new Set(r.ditolak.map(x => x.id));
        S.data.progres = S.data.progres.filter(p => !tolak.has(p.id_modul));
        bangunIndeks(); tandaiKotor(); renderUlang(true);
        toast(r.ditolak.length + ' progres ditolak server: ' + r.ditolak[0].alasan, 'galat');
      }
      simpanSnapshot(); perbaruiSyncChip();
      if (S.outbox.length) flushOutbox();
    }).catch(e => {
      S.sinkron.jalan = false; S.sinkron.gagal++; perbaruiSyncChip();
      if (e.kode === 'SESI_HABIS') return;
      if (['JARINGAN', 'SIBUK', 'SERVER'].includes(e.kode)) {
        clearTimeout(S.sinkron.timer);
        S.sinkron.timer = setTimeout(flushOutbox, Math.min(60000, 3000 * Math.pow(2, S.sinkron.gagal)));
      } else toast(e.message, 'galat');
    });
  }
  function perbaruiSyncChip() {
    const c = $('#syncChip'); if (!c) return;
    const n = S.outbox.length;
    if (S.sinkron.jalan) { c.className = 'sync tampil proses'; c.innerHTML = '<i class="bi bi-arrow-repeat putar"></i><span class="sembunyi-mobile">Menyimpan…</span>'; }
    else if (n) { c.className = 'sync tampil menunggu'; c.innerHTML = '<i class="bi bi-cloud-arrow-up"></i>' + n + '<span class="sembunyi-mobile">&nbsp;tertunda</span>'; c.title = n + ' progres menunggu sinkron ke server'; }
    else { c.className = 'sync'; c.innerHTML = ''; }
  }

  // ---- Unduh berkas privat ber-potongan ----
  function tombolUnduh(id) { return $$('[data-unduh-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]'); }
  function setProgresUnduh(id, f) {
    tombolUnduh(id).forEach(b => {
      if (f === null) { b.disabled = false; if (b.dataset.asli) { b.innerHTML = b.dataset.asli; delete b.dataset.asli; } return; }
      if (!b.dataset.asli) b.dataset.asli = b.innerHTML;
      b.disabled = true;
      b.innerHTML = b.classList.contains('ikon-btn') ? '<i class="bi bi-arrow-repeat putar"></i><span class="sr">' + Math.round(f * 100) + '%</span>' : '<i class="bi bi-arrow-repeat putar"></i> ' + Math.round(f * 100) + '%';
    });
  }
  async function ambilBerkas(idModul, idBerkas, nama) {
    const c = S.unduhCache.get(idBerkas); if (c) return c;
    if (S.unduh.has(idBerkas)) throw Object.assign(new Error('Berkas sedang diunduh.'), { kode: 'SIBUK' });
    S.unduh.add(idBerkas);
    setProgresUnduh(idBerkas, 0);
    try {
      let off = 0, total = 1, mime = 'application/octet-stream';
      const parts = [];
      do {
        const r = await server('unduhBerkas', S.token, idModul, idBerkas, off);
        parts.push(b64KeBytes(r.data)); total = r.total; off = r.berikut; mime = r.mime; nama = r.nama || nama;
        setProgresUnduh(idBerkas, total ? off / total : 1);
      } while (off < total);
      const hasil = { blob: new Blob(parts, { type: mime }), nama };
      if (hasil.blob.size < 20 * 1048576) S.unduhCache.set(idBerkas, hasil);
      return hasil;
    } finally { S.unduh.delete(idBerkas); setProgresUnduh(idBerkas, null); }
  }
  async function unduh(el) {
    try { const r = await ambilBerkas(el.dataset.modul, el.dataset.berkas, el.dataset.nama); simpanBlob(r.blob, r.nama); toast(r.nama + ' siap disimpan.', 'sukses'); }
    catch (e) { if (e.kode !== 'SIBUK') toast(e.message, 'galat'); }
  }
  async function pratinjauPdf(el) {
    bukaModal('<div class="modal-kepala"><div class="judul-wrap"><h2 id="modalJudul">' + esc(el.dataset.nama) + '</h2><p>Pratinjau dokumen privat</p></div><button type="button" class="ikon-btn" data-act="tutup-modal" aria-label="Tutup"><i class="bi bi-x-lg"></i></button></div><div class="modal-isi" id="isiPdf"><div class="skel" style="height:60vh"></div></div>' +
      '<div class="modal-kaki"><span class="catatan"><i class="bi bi-shield-lock"></i> Berkas tidak memiliki tautan publik</span><button type="button" class="btn btn-garis" data-act="tutup-modal">Tutup</button><button type="button" class="btn btn-utama" data-act="unduh" data-modul="' + esc(el.dataset.modul) + '" data-berkas="' + esc(el.dataset.berkas) + '" data-nama="' + esc(el.dataset.nama) + '" data-unduh-id="' + esc(el.dataset.berkas) + '"><i class="bi bi-download"></i> Unduh</button></div>');
    try {
      const r = await ambilBerkas(el.dataset.modul, el.dataset.berkas, el.dataset.nama);
      const isi = $('#isiPdf'); if (!isi) return;
      const url = URL.createObjectURL(r.blob.type === 'application/pdf' ? r.blob : new Blob([r.blob], { type: 'application/pdf' }));
      isi.innerHTML = '<iframe class="pdf-frame" src="' + url + '" title="Pratinjau ' + esc(r.nama) + '"></iframe><p class="bantuan">Jika pratinjau tidak tampil di browser Anda, gunakan tombol Unduh.</p>';
    } catch (e) { const isi = $('#isiPdf'); if (isi) isi.innerHTML = '<p class="galat-field">' + esc(e.message) + '</p>'; }
  }

  // ==========================================================================
  // 15. VIEW: PROGRES (member & admin)
  // ==========================================================================
  function renderProgres() {
    if (isAdmin()) return renderProgresAdmin();
    const el = $('#v-progres');
    const st = statistikMember();
    const P = S.data.pengaturan || {};
    // Heatmap 5 minggu (Senin–Minggu)
    const awal = new Date(); awal.setHours(0, 0, 0, 0);
    const offset = (awal.getDay() + 6) % 7;
    awal.setDate(awal.getDate() - offset - 28);
    let heat = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map(h => '<span class="hd">' + h + '</span>').join('');
    const hariIni = hariKey(new Date());
    for (let i = 0; i < 35; i++) {
      const d = new Date(awal); d.setDate(awal.getDate() + i); const k = hariKey(d); const n = st.perHariN.get(k) || 0;
      heat += '<span data-l="' + (n >= 3 ? 3 : n) + '" class="' + (k === hariIni ? 'hari-ini' : '') + '" title="' + d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short' }) + ': ' + n + ' modul"></span>';
      if (d > new Date()) break;
    }
    const riwayat = S.data.progres.slice().sort((a, b) => String(b.waktu).localeCompare(String(a.waktu))).slice(0, 10);
    el.innerHTML = '<div class="kepala-halaman"><div><h1>Progres Belajar</h1><p>Pantau kemajuan setiap kursus, jam belajar, dan konsistensi harian Anda.</p></div></div>' +
      '<div class="grid-kpi mb-4">' +
      '<div class="stat">' + ringHtml(st.total ? st.selesai / st.total * 100 : 0, st.selesai + '/' + st.total) + '<div class="teks"><b>Kursus selesai</b><small>dari kursus aktif</small></div></div>' +
      '<div class="stat">' + ringHtml(st.total ? st.berjalan / st.total * 100 : 0, st.berjalan) + '<div class="teks"><b>Sedang berjalan</b><small>kursus</small></div></div>' +
      '<div class="stat">' + ringHtml(Math.min(100, st.menitMinggu / 60 / (Number(P.TARGET_MINGGUAN_JAM) || 5) * 100), angkaID(st.menit / 60), 'jam') + '<div class="teks"><b>Total jam belajar</b><small>' + angkaID(st.menitMinggu / 60) + ' j minggu ini</small></div></div>' +
      '<div class="stat">' + ringHtml(Math.min(100, st.streak / 7 * 100), st.streak, 'hari') + '<div class="teks"><b>Streak harian</b><small>hari berturut-turut</small></div></div></div>' +
      '<div class="tata-2"><div class="kolom">' + kartuStatistikHtml('grafikProgres') +
      '<div class="kartu"><div class="kartu-judul"><h2>Progres per kursus</h2></div>' +
      (S.data.kursus.length ? '<div class="daftar-berkas">' + S.data.kursus.map(k => {
        const p = progresKursus(k.id_kursus);
        return '<div class="berkas" style="align-items:flex-start;flex-wrap:wrap"><div class="info" style="flex:1 1 220px"><b>' + esc(k.judul) + '</b><small>' + p.selesai + '/' + p.total + ' modul · ' + fmtMenitPendek(p.menit) + ' dari ' + fmtMenitPendek(p.totalMenit) + (p.terakhir ? ' · terakhir ' + fmtRelatif(p.terakhir) : '') + '</small><div class="mt-2">' + barHtml(p.persen, p.persen === 100 ? 'sukses' : '') + '</div></div>' +
          '<div class="d-flex align-items-center gap-2"><b class="angka">' + p.persen + '%</b><button type="button" class="btn btn-ghost btn-sm" data-act="buka-kursus" data-id="' + esc(k.id_kursus) + '">' + (p.persen === 100 ? 'Ulas' : p.selesai ? 'Lanjutkan' : 'Mulai') + '</button></div></div>';
      }).join('') + '</div>' : kosongHtml('bi-journal', 'Belum ada kursus', '', '')) + '</div></div>' +
      '<aside class="kolom"><div class="kartu"><div class="kartu-judul"><h2>Konsistensi 5 minggu</h2></div><div class="heatmap">' + heat + '</div>' +
      '<div class="d-flex align-items-center gap-2 mt-3 mini teks-2">Sedikit <span style="width:14px;height:14px;border-radius:4px;background:#DDD6FE"></span><span style="width:14px;height:14px;border-radius:4px;background:#A78BFA"></span><span style="width:14px;height:14px;border-radius:4px;background:#7C5CFF"></span> Banyak</div></div>' +
      '<div class="kartu"><div class="kartu-judul"><h2>Riwayat penyelesaian</h2></div>' + (riwayat.length ? '<div class="aktivitas">' + riwayat.map(p => { const m = I.modul.get(p.id_modul); return '<div class="aktivitas-item"><i class="bi bi-check-circle-fill" style="color:var(--sukses)"></i><div class="flex-grow-1" style="min-width:0"><b class="potong d-block">' + esc(m ? m.judul : p.id_modul) + '</b><small class="teks-2">' + fmtRelatif(p.waktu) + (p._antre ? ' · menunggu sinkron' : '') + '</small></div></div>'; }).join('') + '</div>' : '<p class="teks-2">Belum ada modul yang diselesaikan.</p>') + '</div></aside></div>';
    gambarStatistik('grafikProgres', st);
  }
  function barisProgresAdmin() {
    const d = S.data, q = S.adm.cariProgres.toLowerCase();
    return d.akses.map(a => {
      const k = I.kursus.get(a.id_kursus); if (!k) return null;
      const t = modulTerbit(a.id_kursus).length; const pm = I.perMember.get(a.email + '|' + a.id_kursus);
      const n = pm ? pm.selesai : 0, pct = t ? Math.min(100, Math.round(n / t * 100)) : 0, last = pm ? pm.terakhir : 0;
      const u = I.pengguna.get(a.email);
      let status = pct === 100 ? 'selesai' : n ? 'berjalan' : 'belum';
      if (status === 'berjalan' && last && Date.now() - last > 7 * 864e5) status = 'pasif';
      if (a.status_aktif !== 'aktif') status = 'nonaktif';
      return { a, k, nama: u ? u.nama : a.email.split('@')[0], n, t, pct, last, status };
    }).filter(Boolean).filter(r =>
      (S.adm.kursusProgres === 'semua' || r.a.id_kursus === S.adm.kursusProgres) &&
      (S.adm.statusProgres === 'semua' || r.status === S.adm.statusProgres) &&
      (!q || (r.a.email + ' ' + r.nama + ' ' + r.k.judul).toLowerCase().includes(q))
    ).sort((x, y) => y.last - x.last || y.pct - x.pct);
  }
  const LABEL_STATUS = { selesai: ['sukses', 'Selesai'], berjalan: ['', 'Berjalan'], belum: ['netral', 'Belum mulai'], pasif: ['emas', 'Pasif >7 hari'], nonaktif: ['bahaya', 'Akses nonaktif'] };
  function renderProgresAdmin() {
    const el = $('#v-progres');
    const rows = barisProgresAdmin();
    const tampilRows = rows.slice(0, S.adm.batas);
    el.innerHTML = '<div class="kepala-halaman"><div><h1>Progres Member</h1><p>Pantau kemajuan setiap member per kursus. Data diperbarui otomatis saat member menandai modul.</p></div>' +
      '<div class="d-flex gap-2 flex-wrap"><button type="button" class="btn btn-garis" data-act="csv-progres"><i class="bi bi-filetype-csv"></i> Unduh CSV</button><button type="button" class="btn btn-utama" data-act="pdf-progres"><i class="bi bi-file-earmark-pdf"></i> Ringkasan PDF</button></div></div>' +
      '<div class="kartu"><div class="alat"><div class="input-ikon"><i class="bi bi-search"></i><input class="input" type="search" placeholder="Cari email, nama, atau kursus" value="' + esc(S.adm.cariProgres) + '" data-ketik="cari-progres" aria-label="Cari progres"></div>' +
      '<select class="select" data-ubah="kursus-progres" aria-label="Filter kursus"><option value="semua">Semua kursus</option>' + S.data.kursus.map(k => '<option value="' + esc(k.id_kursus) + '"' + (S.adm.kursusProgres === k.id_kursus ? ' selected' : '') + '>' + esc(k.judul) + '</option>').join('') + '</select>' +
      '<select class="select" data-ubah="status-progres" aria-label="Filter status"><option value="semua">Semua status</option>' + Object.keys(LABEL_STATUS).map(s => '<option value="' + s + '"' + (S.adm.statusProgres === s ? ' selected' : '') + '>' + LABEL_STATUS[s][1] + '</option>').join('') + '</select></div>' +
      '<p class="teks-2 kecil mb-2">' + rows.length + ' baris</p>' +
      (rows.length ? '<div class="tabel-wrap"><table class="tabel kartu-mobile"><thead><tr><th>Member</th><th>Kursus</th><th>Progres</th><th>Modul</th><th>Terakhir aktif</th><th>Status</th></tr></thead><tbody>' +
        tampilRows.map(r => '<tr><td class="utama"><div class="orang"><span class="avatar kecil">' + esc(inisial(r.nama)) + '</span><div style="min-width:0"><b>' + esc(r.nama) + '</b><small>' + esc(r.a.email) + '</small></div></div></td><td data-label="Kursus">' + esc(r.k.judul) + '</td>' +
          '<td data-label="Progres"><div class="bar-sel">' + barHtml(r.pct, r.pct === 100 ? 'sukses' : '') + '<b class="angka">' + r.pct + '%</b></div></td><td data-label="Modul" class="angka">' + r.n + '/' + r.t + '</td><td data-label="Terakhir">' + (r.last ? fmtRelatif(r.last) : '—') + '</td>' +
          '<td data-label="Status"><span class="chip ' + LABEL_STATUS[r.status][0] + ' normal-case">' + LABEL_STATUS[r.status][1] + '</span></td></tr>').join('') +
        '</tbody></table></div>' + (rows.length > S.adm.batas ? '<div class="text-center mt-3"><button type="button" class="btn btn-ghost" data-act="lebih-banyak">Tampilkan lebih banyak</button></div>' : '')
        : kosongHtml('bi-clipboard-data', 'Tidak ada data', 'Belum ada progres yang cocok dengan filter.', '')) + '</div>';
  }

  // ==========================================================================
  // 16. VIEW: PESAN / PENGUMUMAN
  // ==========================================================================
  function renderPesan() {
    const el = $('#v-pesan');
    const baru = new Set(belumDibaca().map(p => p.id));
    if (!isAdmin()) {
      el.innerHTML = '<div class="kepala-halaman"><div><h1>Pesan & Pengumuman</h1><p>Informasi terbaru dari admin dan instruktur.</p></div></div><div class="kartu">' +
        (S.data.pengumuman.length ? S.data.pengumuman.map(p => itemPengumuman(p, baru.has(p.id))).join('') : kosongHtml('bi-envelope-open', 'Belum ada pengumuman', 'Pengumuman dari admin akan tampil di sini.', '')) + '</div>';
      tandaiDibaca();
      return;
    }
    tandaiDibaca();
    el.innerHTML = '<div class="kepala-halaman"><div><h1>Pengumuman</h1><p>Kirim informasi ke semua member atau member kursus tertentu. Email opsional.</p></div></div>' +
      '<div class="tata-2"><div class="kolom"><div class="kartu"><div class="kartu-judul"><h2>Riwayat pengumuman</h2></div>' +
      (S.data.pengumuman.length ? S.data.pengumuman.map(p => '<div class="d-flex gap-2 align-items-start">' + '<div class="flex-grow-1" style="min-width:0">' + itemPengumuman(p, false) + '</div>' +
        '<button type="button" class="ikon-btn bahaya mt-2" data-act="hapus-pengumuman" data-id="' + esc(p.id) + '" aria-label="Hapus pengumuman"><i class="bi bi-trash3"></i></button></div>').join('') : kosongHtml('bi-megaphone', 'Belum ada pengumuman', '', '')) +
      '</div></div><aside class="kolom"><form class="kartu" id="formPengumuman" data-kirim="pengumuman" novalidate><div class="kartu-judul"><h2><span class="ikon-judul"><i class="bi bi-send"></i></span>Tulis pengumuman</h2></div>' +
      '<div class="field"><label class="label" for="pgTarget">Kirim ke</label><select class="select" id="pgTarget"><option value="SEMUA">Semua member</option>' + S.data.kursus.map(k => '<option value="' + esc(k.id_kursus) + '">Member: ' + esc(k.judul) + '</option>').join('') + '</select></div>' +
      '<div class="field"><label class="label" for="pgJudul">Judul</label><input class="input" id="pgJudul" maxlength="150" required></div>' +
      '<div class="field"><label class="label" for="pgIsi">Isi pengumuman</label><textarea class="textarea" id="pgIsi" maxlength="5000" required></textarea></div>' +
      '<label class="switch mb-3"><input type="checkbox" id="pgEmail"' + ((S.data.pengaturan || {}).EMAIL_NOTIF_AKTIF === 'ya' ? '' : ' disabled') + '><span class="jalur"></span><span>Kirim juga lewat email' + (S.data.info ? ' <small class="teks-2">(sisa kuota ' + S.data.info.kuotaEmail + ')</small>' : '') + '</span></label>' +
      '<p class="galat-field" id="pgGalat"></p><button class="btn btn-utama btn-blok" type="submit" id="pgKirim"><i class="bi bi-send"></i> Kirim Pengumuman</button></form></aside></div>';
  }
  function tandaiDibaca() {
    LS.set('baca_' + kunciUser(S.data.user.email), Date.now());
    $('#titikNotif').hidden = true;
    aktifkanNav();
  }
  async function kirimPengumuman(form) {
    const judul = $('#pgJudul').value.trim(), isi = $('#pgIsi').value.trim(), g = $('#pgGalat');
    g.textContent = '';
    if (judul.length < 3 || isi.length < 3) { g.textContent = 'Judul dan isi wajib diisi (minimal 3 karakter).'; return; }
    const data = { id_kursus: $('#pgTarget').value, judul, isi, kirimEmail: $('#pgEmail').checked };
    const sementara = { id: 'tmp-' + Date.now(), id_kursus: data.id_kursus, judul, isi, dibuat: new Date().toISOString(), oleh: S.data.user.nama, email_terkirim: 0 };
    S.data.pengumuman.unshift(sementara); render('pesan');
    try {
      const r = await server('kirimPengumuman', S.token, data);
      const i = S.data.pengumuman.findIndex(p => p.id === sementara.id); if (i > -1) S.data.pengumuman[i] = r.pengumuman;
      render('pesan'); simpanSnapshot();
      toast('Pengumuman terbit' + (r.emailDiantre ? ' · email ke ' + r.emailDiantre + ' penerima dikirim di latar' : '') + '.', 'sukses');
    } catch (e) {
      S.data.pengumuman = S.data.pengumuman.filter(p => p.id !== sementara.id); render('pesan');
      $('#pgJudul').value = judul; $('#pgIsi').value = isi;
      toast(e.message, 'galat');
    }
  }

  // ==========================================================================
  // 17. VIEW: PROFIL & PENGATURAN
  // ==========================================================================
  function renderProfil() {
    const el = $('#v-profil'), u = S.data.user, adm = isAdmin();
    const pg = I.pengguna.get(u.email);
    const st = adm ? null : statistikMember();
    el.innerHTML = '<div class="tata-2"><div class="kolom"><div class="kartu"><div class="profil-kepala"><span class="avatar besar">' + esc(inisial(u.nama || u.email)) + '</span><div style="min-width:0;flex:1"><h1>' + esc(u.nama || u.email) + '</h1><p class="teks-2">' + esc(u.email) + '</p><div class="d-flex gap-2 mt-2 flex-wrap"><span class="chip">' + (adm ? 'Admin / Creator' : 'Member') + '</span>' + (u.darurat ? '<span class="chip emas">Akses darurat</span>' : '') + '</div></div></div>' +
      (u.darurat ? '' : '<form class="mt-4" data-kirim="profil" novalidate><label class="label" for="inNama">Nama tampilan</label><div class="d-flex gap-2 flex-wrap"><input class="input" id="inNama" value="' + esc(u.nama) + '" maxlength="80" style="flex:1 1 220px"><button class="btn btn-ghost" type="submit">Simpan nama</button></div><p class="galat-field" id="galatNama"></p></form>') + '</div>' +
      (st ? '<div class="grid-kpi">' + kpi('bi-trophy', 'kat-emas', st.selesai, 'Kursus selesai') + kpi('bi-clock-history', 'kat-ungu', angkaID(st.menit / 60) + ' j', 'Total belajar') + kpi('bi-fire', 'kat-oranye', st.streak + ' hari', 'Streak') + kpi('bi-check2-square', 'kat-hijau', S.data.progres.length, 'Modul selesai') + '</div>' : '') +
      '<div class="kartu"><div class="kartu-judul"><h2>Akses kursus</h2></div>' + (adm ? '<p class="teks-2">Admin dapat membuka semua kursus.</p>' :
        (S.data.akses.length ? '<div class="daftar-berkas">' + S.data.akses.map(a => { const k = I.kursus.get(a.id_kursus) || S.data.katalog.find(x => x.id_kursus === a.id_kursus); return '<div class="berkas"><span class="tipe lain"><i class="bi bi-mortarboard" style="font-size:18px"></i></span><div class="info"><b>' + esc(k ? k.judul : a.id_kursus) + '</b><small>Aktif sejak ' + fmtTanggal(a.tanggal_beli) + '</small></div><span class="chip ' + (a.status_aktif === 'aktif' ? 'sukses' : 'bahaya') + ' normal-case">' + (a.status_aktif === 'aktif' ? 'Aktif' : 'Nonaktif') + '</span></div>'; }).join('') + '</div>' : '<p class="teks-2">Belum ada akses kursus.</p>')) + '</div></div>' +
      '<aside class="kolom"><div class="kartu"><div class="kartu-judul"><h2>Akun & sesi</h2></div><div class="daftar-set">' +
      '<div class="set-item"><div class="t"><b>Terakhir masuk</b><small>' + (pg && pg.terakhir_masuk ? fmtRelatif(pg.terakhir_masuk) : '—') + '</small></div></div>' +
      '<div class="set-item"><div class="t"><b>Muat ulang data</b><small>Ambil data terbaru dari server</small></div><button type="button" class="btn btn-garis btn-sm" data-act="segarkan"><i class="bi bi-arrow-clockwise"></i> Segarkan</button></div>' +
      '<div class="set-item"><div class="t"><b>Keluar dari semua perangkat</b><small>Mencabut semua sesi aktif akun ini</small></div><button type="button" class="btn btn-bahaya btn-sm" data-act="keluar-semua">Cabut sesi</button></div>' +
      '</div><div class="d-grid gap-2 mt-3">' + (adm ? '<button type="button" class="btn btn-ghost" data-act="nav" data-to="pesan"><i class="bi bi-megaphone"></i> Pengumuman</button>' : '') +
      '<button type="button" class="btn btn-ghost" data-act="nav" data-to="pengaturan"><i class="bi bi-gear"></i> Pengaturan</button><button type="button" class="btn btn-bahaya" data-act="keluar"><i class="bi bi-box-arrow-left"></i> Keluar</button></div></div></aside></div>';
  }
  const VERSI_FE = '2.0.0';
  function kartuAuthHtml(info) {
    const cid = (S.data.auth && S.data.auth.googleClientId) || info.googleClientId || '';
    return '<form class="kartu" data-kirim="auth" novalidate><div class="kartu-judul"><h2><span class="ikon-judul"><i class="bi bi-person-badge"></i></span>Login dengan Google</h2><span class="chip ' + (cid ? 'sukses' : 'netral') + ' normal-case">' + (cid ? 'Aktif' : 'Nonaktif') + '</span></div>' +
      '<p class="teks-2 kecil mb-3">Opsional, di samping kode email. Buat <b>OAuth Client ID (Web application)</b> di Google Cloud Console dengan <i>Authorized JavaScript origins</i>: <span class="mono">' + esc(location.origin) + '</span>. ID token diverifikasi di server; hanya email terdaftar yang bisa masuk.</p>' +
      '<div class="field"><label class="label" for="inClientId">Google OAuth Client ID</label><input class="input mono" id="inClientId" value="' + esc(cid) + '" placeholder="1234567890-abc….apps.googleusercontent.com" autocomplete="off" spellcheck="false"><p class="bantuan">Client ID bersifat publik. Kosongkan lalu simpan untuk menonaktifkan.</p></div>' +
      '<p class="galat-field" id="galatAuth"></p><button class="btn btn-utama btn-sm" type="submit" id="btnSimpanAuth">Simpan</button></form>';
  }
  async function simpanAuthForm() {
    const cid = $('#inClientId').value.trim(), g = $('#galatAuth');
    g.textContent = '';
    if (cid && !/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(cid)) { g.textContent = 'Format Client ID tidak valid (contoh: 1234567890-abc123.apps.googleusercontent.com).'; return; }
    const btn = $('#btnSimpanAuth'); setTombol(btn, true, 'Menyimpan…');
    try {
      const a = await server('simpanKonfigurasiAuth', S.token, { googleClientId: cid });
      S.data.auth = a; if (S.data.info) S.data.info.googleClientId = a.googleClientId;
      S.publik = Object.assign({}, S.publik || {}, { auth: a }); LS.set('publik', S.publik);
      simpanSnapshot(); render('pengaturan');
      toast(a.googleClientId ? 'Login dengan Google aktif di layar masuk.' : 'Login dengan Google dinonaktifkan.', 'sukses');
    } catch (e) { g.textContent = e.message; }
    finally { setTombol(btn, false); }
  }
  function renderPengaturan() {
    const el = $('#v-pengaturan'), adm = isAdmin(), t = temaPilihan(), P = S.data.pengaturan || {}, info = S.data.info || {};
    const field = (k, label, tipe, bantu) => '<div class="field"><label class="label" for="set_' + k + '">' + label + '</label>' + (tipe === 'area' ? '<textarea class="textarea" id="set_' + k + '" data-set="' + k + '" style="min-height:80px">' + esc(P[k]) + '</textarea>' : '<input class="input" id="set_' + k + '" data-set="' + k + '" value="' + esc(P[k]) + '"' + (tipe ? ' type="' + tipe + '"' : '') + '>') + (bantu ? '<p class="bantuan">' + bantu + '</p>' : '') + '</div>';
    el.innerHTML = '<div class="kepala-halaman"><div><h1>Pengaturan</h1><p>' + (adm ? 'Tampilan, identitas portal, integrasi Google Workspace, dan migrasi data.' : 'Atur tampilan dan data di perangkat ini.') + '</p></div></div>' +
      '<div class="tata-2"><div class="kolom">' +
      '<div class="kartu"><div class="kartu-judul"><h2><span class="ikon-judul"><i class="bi bi-palette"></i></span>Tampilan</h2></div><div class="daftar-set">' +
      '<div class="set-item"><div class="t"><b>Tema</b><small>Mode gelap mengurangi silau saat belajar malam</small></div><div class="seg" role="group" aria-label="Tema">' +
      [['terang', 'Terang', 'bi-sun'], ['gelap', 'Gelap', 'bi-moon-stars'], ['sistem', 'Sistem', 'bi-circle-half']].map(([v, l, i]) => '<button type="button" data-act="set-tema" data-v="' + v + '" aria-pressed="' + (t === v) + '"><i class="bi ' + i + '"></i> ' + l + '</button>').join('') + '</div></div>' +
      '<div class="set-item"><div class="t"><b>Data offline perangkat</b><small>Snapshot data & catatan disimpan agar aplikasi terbuka instan</small></div><button type="button" class="btn btn-garis btn-sm" data-act="hapus-lokal"><i class="bi bi-eraser"></i> Bersihkan</button></div></div></div>' +
      (adm ? '<form class="kartu" data-kirim="pengaturan" novalidate><div class="kartu-judul"><h2><span class="ikon-judul"><i class="bi bi-sliders"></i></span>Identitas & konten portal</h2><button class="btn btn-utama btn-sm" type="submit" id="btnSimpanSet">Simpan</button></div>' +
        '<div class="row g-3"><div class="col-md-6">' + field('NAMA_APP', 'Nama aplikasi') + '</div><div class="col-md-6">' + field('TAGLINE', 'Tagline') + '</div></div>' +
        field('LOGO_URL', 'URL logo (opsional)', 'url', 'Gambar persegi https. Kosongkan untuk logo huruf otomatis.') +
        '<div class="row g-3"><div class="col-md-6">' + field('HERO_LABEL', 'Label banner') + '</div><div class="col-md-6">' + field('HERO_TOMBOL', 'Teks tombol banner') + '</div></div>' +
        field('HERO_JUDUL', 'Judul banner') + field('HERO_SUB', 'Subjudul banner', 'area') +
        '<div class="row g-3"><div class="col-md-6">' + field('PROMO_JUDUL', 'Judul kartu promosi') + '</div><div class="col-md-6">' + field('PROMO_TOMBOL', 'Tombol promosi') + '</div></div>' + field('PROMO_TEKS', 'Isi kartu promosi', 'area') +
        '<div class="row g-3"><div class="col-md-6">' + field('KONTAK_EMAIL', 'Email kontak admin', 'email') + '</div><div class="col-md-6">' + field('TARGET_MINGGUAN_JAM', 'Target jam belajar / minggu', 'number') + '</div></div>' +
        field('URL_PORTAL', 'URL portal (GitHub Pages)', 'url', 'Tautan tombol di email. Kosongkan = otomatis memakai alamat frontend yang terakhir dibuka admin' + (info.urlFrontend ? ' (<span class="mono">' + esc(info.urlFrontend) + '</span>)' : '') + '.') +
        '<label class="switch"><input type="checkbox" id="set_EMAIL_NOTIF_AKTIF"' + (P.EMAIL_NOTIF_AKTIF === 'ya' ? ' checked' : '') + '><span class="jalur"></span><span>Kirim email saat akses diaktifkan & pengumuman</span></label><p class="galat-field" id="galatSet"></p></form>' +
        '<div class="kartu"><div class="kartu-judul"><h2><span class="ikon-judul"><i class="bi bi-arrow-left-right"></i></span>Migrasi & sinkronisasi database</h2></div>' +
        '<p class="teks-2 kecil mb-3">Impor data dari spreadsheet EduTrack versi lama (akun Google yang sama). Spreadsheet lama hanya <b>dibaca</b>. Pencocokan memakai nama kolom, impor idempoten (aman diulang), dan status yang sudah Anda ubah di aplikasi ini tidak ditimpa.</p>' +
        '<div class="field"><label class="label" for="inMigrasi">ID atau URL spreadsheet lama</label><input class="input" id="inMigrasi" placeholder="https://docs.google.com/spreadsheets/d/…" value="' + esc(LS.get('migrasi_sumber', '')) + '"></div>' +
        '<div class="d-flex gap-2 flex-wrap"><button type="button" class="btn btn-garis" data-act="migrasi-pindai"><i class="bi bi-search"></i> Pindai (dry-run)</button><button type="button" class="btn btn-utama" data-act="migrasi-jalan" id="btnMigrasi" disabled><i class="bi bi-cloud-arrow-down"></i> Jalankan Migrasi</button></div><div id="hasilMigrasi" class="migrasi-hasil"></div></div>' : '') +
      '</div><aside class="kolom">' +
      (adm ? '<div class="kartu"><div class="kartu-judul"><h2><span class="ikon-judul"><i class="bi bi-google"></i></span>Integrasi Google Workspace</h2></div>' +
        '<div class="integrasi-item"><i class="bi bi-table"></i><div class="flex-grow-1"><b>Google Sheets (database)</b><br><small class="teks-2">Sheet: Kursus, Modul, Akses, Progres, Pengguna</small><br>' + (info.spreadsheetUrl ? '<a href="' + esc(info.spreadsheetUrl) + '" target="_blank" rel="noopener" class="kecil">Buka spreadsheet <i class="bi bi-box-arrow-up-right"></i></a>' : '') + '</div></div>' +
        '<div class="integrasi-item"><i class="bi bi-folder-symlink"></i><div class="flex-grow-1"><b>Google Drive</b> <span class="chip sukses">Terkoneksi</span><br><small class="teks-2">' + esc(info.folderNama || '') + ' — materi privat</small><br>' + (info.folderUrl ? '<a href="' + esc(info.folderUrl) + '" target="_blank" rel="noopener" class="kecil">Buka folder <i class="bi bi-box-arrow-up-right"></i></a>' : '') + '</div></div>' +
        '<div class="integrasi-item"><i class="bi bi-envelope-at"></i><div class="flex-grow-1"><b>Gmail (MailApp)</b><br><small class="teks-2">Sisa kuota hari ini: <b>' + (info.kuotaEmail >= 0 ? info.kuotaEmail : '—') + '</b></small></div></div>' +
        '<div class="integrasi-item"><i class="bi bi-shield-lock"></i><div class="flex-grow-1"><b>Rahasia (Script Properties)</b><br><small class="teks-2">Session secret: <span class="mono">' + esc(info.sessionSecret || '—') + '</span><br>Akses darurat: ' + (info.daruratAktif ? (info.daruratTerkunci ? 'terkunci sementara' : 'aktif') : 'belum dibuat') + '</small></div></div>' +
        '<div class="integrasi-item"><i class="bi bi-lightning-charge"></i><div class="flex-grow-1"><b>Trigger & antrean notifikasi</b><br><small class="teks-2">' + (info.trigger || 0) + ' trigger aktif · ' + ((info.antrean || {}).menunggu || 0) + ' email menunggu' + ((info.antrean || {}).gagal ? ' · <b style="color:var(--bahaya-teks)">' + info.antrean.gagal + ' gagal</b>' : '') + '</small>' + ((info.trigger || 0) < 2 ? '<br><small class="teks-2">Jalankan <span class="kode-inline">pasangUlangTrigger</span> di editor.</small>' : '') + '</div></div>' +
        '</div>' + kartuAuthHtml(info) + '<div class="kartu"><div class="kartu-judul"><h2>Pemeliharaan</h2></div><div class="daftar-set">' +
        '<div class="set-item"><div class="t"><b>Segarkan cache server</b><small>Pakai setelah mengubah sheet Akses secara manual</small></div><button type="button" class="btn btn-garis btn-sm" data-act="segarkan-server"><i class="bi bi-arrow-repeat"></i> Segarkan</button></div>' +
        '<div class="set-item"><div class="t"><b>Kirim antrean email sekarang</b><small>Otomatis tiap menit oleh trigger</small></div><button type="button" class="btn btn-garis btn-sm" data-act="kuras-antrean"><i class="bi bi-send"></i> Kirim</button></div>' +
        '<div class="set-item"><div class="t"><b>Latensi API</b><small id="infoLatensi">' + esc(teksLatensi()) + '</small></div></div>' +
        '<div class="set-item"><div class="t"><b>Versi</b><small>backend ' + esc(info.versi || '') + ' · frontend ' + VERSI_FE + ' · skema ' + esc(info.skemaVersi || '') + '</small></div></div>' +
        (info.urlWebApp ? '<div class="set-item"><div class="t"><b>URL Web App</b><small class="mono potong d-block">' + esc(info.urlWebApp) + '</small></div><button type="button" class="btn btn-garis btn-sm" data-act="salin" data-teks="' + esc(info.urlWebApp) + '"><i class="bi bi-clipboard"></i> Salin</button></div>' : '') +
        '</div></div>' : '<div class="kartu"><div class="kartu-judul"><h2>Tentang</h2></div><p class="teks-2">' + esc(P.NAMA_APP || 'EduTrack Pro') + ' — ' + esc(P.TAGLINE || '') + '</p><p class="teks-2 kecil mt-2">Progres Anda disimpan di perangkat lebih dulu, lalu disinkronkan ke server otomatis — aman walau sinyal putus-sambung.</p></div>') +
      '</aside></div>';
  }
  async function simpanPengaturanForm() {
    const obj = {};
    $$('[data-set]').forEach(i => { obj[i.dataset.set] = i.value.trim(); });
    obj.EMAIL_NOTIF_AKTIF = $('#set_EMAIL_NOTIF_AKTIF').checked ? 'ya' : 'tidak';
    const g = $('#galatSet'); g.textContent = '';
    if (obj.NAMA_APP.length < 2) { g.textContent = 'Nama aplikasi minimal 2 karakter.'; return; }
    for (const k of ['LOGO_URL', 'URL_PORTAL']) if (obj[k] && !urlValid(obj[k])) { g.textContent = k + ' harus diawali https://'; return; }
    if (obj.KONTAK_EMAIL && !emailValid(obj.KONTAK_EMAIL)) { g.textContent = 'Email kontak tidak valid.'; return; }
    const lama = Object.assign({}, S.data.pengaturan);
    S.data.pengaturan = Object.assign({}, S.data.pengaturan, obj);
    terapkanMerek(S.data.pengaturan); tandaiKotor('beranda'); breadcrumb();
    const btn = $('#btnSimpanSet'); setTombol(btn, true, 'Menyimpan…');
    try { S.data.pengaturan = await server('simpanPengaturan', S.token, obj); simpanSnapshot(); toast('Pengaturan tersimpan.', 'sukses'); }
    catch (e) { S.data.pengaturan = lama; terapkanMerek(lama); g.textContent = e.message; }
    finally { setTombol(btn, false); }
  }
  let rencanaMigrasi = null;
  async function migrasiPindai() {
    const sumber = $('#inMigrasi').value.trim(), out = $('#hasilMigrasi');
    if (!sumber) { out.innerHTML = '<p class="galat-field">Masukkan ID atau URL spreadsheet lama.</p>'; return; }
    LS.set('migrasi_sumber', sumber);
    out.innerHTML = '<div class="skel" style="height:120px"></div>';
    try {
      const r = await server('migrasiPindai', S.token, sumber);
      rencanaMigrasi = { sumber, hasil: r.hasil };
      out.innerHTML = '<p class="kecil teks-2">Sumber: <b>' + esc(r.sumber) + '</b> — hasil simulasi (belum ada yang ditulis):</p>' + r.hasil.map(h => h.tidakAda
        ? '<div class="migrasi-baris"><b>' + h.sheet + '</b><span class="teks-2" style="grid-column:span 3">sheet tidak ada di sumber</span></div>'
        : '<div class="migrasi-baris"><b>' + h.sheet + '</b><span class="chip sukses normal-case">+' + h.ditambah + ' baru</span><span class="chip info normal-case">' + h.diperbarui + ' diperbarui</span><span class="chip netral normal-case">' + h.dilewati + ' dilewati</span></div>').join('');
      $('#btnMigrasi').disabled = !r.hasil.some(h => !h.tidakAda && (h.ditambah || h.diperbarui));
    } catch (e) { out.innerHTML = '<p class="galat-field">' + esc(e.message) + '</p>'; }
  }
  async function migrasiJalan() {
    if (!rencanaMigrasi) return;
    const ok = await konfirmasi({ judul: 'Jalankan migrasi?', pesan: 'Data akan ditulis ke database aplikasi ini per sheet. Proses aman diulang (delta-sync) dan tidak mengubah spreadsheet lama.', ya: 'Jalankan' });
    if (!ok) return;
    const btn = $('#btnMigrasi'), out = $('#hasilMigrasi');
    const daftar = rencanaMigrasi.hasil.filter(h => !h.tidakAda).map(h => h.sheet);
    let html = '';
    for (let i = 0; i < daftar.length; i++) {
      setTombol(btn, true, 'Migrasi ' + daftar[i] + ' (' + (i + 1) + '/' + daftar.length + ')…');
      try {
        const r = await server('migrasiJalankan', S.token, rencanaMigrasi.sumber, daftar[i]);
        html += '<div class="migrasi-baris"><b><i class="bi bi-check-circle-fill" style="color:var(--sukses)"></i> ' + r.sheet + '</b><span class="chip sukses normal-case">+' + r.ditambah + '</span><span class="chip info normal-case">' + r.diperbarui + ' diperbarui</span><span class="chip netral normal-case">' + r.dilewati + ' dilewati</span></div>';
      } catch (e) { html += '<div class="migrasi-baris"><b>' + daftar[i] + '</b><span class="galat-field" style="grid-column:span 3">' + esc(e.message) + '</span></div>'; }
      out.innerHTML = html;
    }
    setTombol(btn, false); btn.disabled = true;
    toast('Migrasi selesai. Memuat data terbaru…', 'sukses');
    segarkan(true);
  }

  // ==========================================================================
  // 18. VIEW ADMIN: MEMBER & AKSES
  // ==========================================================================
  function renderMember() {
    const el = $('#v-member'), tab = S.adm.tabMember;
    el.innerHTML = '<div class="kepala-halaman"><div><h1>Member & Akses</h1><p>Kelola siapa yang boleh membuka kursus. Email wajib valid dan unik per kursus.</p></div>' +
      '<div class="d-flex gap-2 flex-wrap"><button type="button" class="btn btn-garis" data-act="csv-akses"><i class="bi bi-filetype-csv"></i> CSV</button><button type="button" class="btn btn-garis" data-act="tambah-pengguna"><i class="bi bi-person-gear"></i> Tambah Admin/Pengguna</button><button type="button" class="btn btn-utama" data-act="tambah-akses"><i class="bi bi-person-plus"></i> Tambah Akses</button></div></div>' +
      '<div class="tabs" role="tablist"><button type="button" role="tab" data-act="tab-member" data-v="akses" aria-selected="' + (tab === 'akses') + '">Akses Kursus<span class="hitung">' + S.data.akses.length + '</span></button><button type="button" role="tab" data-act="tab-member" data-v="pengguna" aria-selected="' + (tab === 'pengguna') + '">Pengguna & Peran<span class="hitung">' + (S.data.pengguna || []).length + '</span></button>' +
      '<button type="button" role="tab" data-act="tab-member" data-v="lynk" aria-selected="' + (tab === 'lynk') + '"><i class="bi bi-lightning-charge"></i> Order Lynk' + (hitungLynkTinjau() ? '<span class="hitung lencana-angka" title="Perlu ditinjau">' + hitungLynkTinjau() + '</span>' : '<span class="hitung">' + (lynkData().order || []).length + '</span>') + '</button></div>' +
      (tab === 'lynk' ? '<div id="isiMember">' + lynkHtml() + '</div>' : '<div class="kartu" id="isiMember">' + (tab === 'akses' ? tabelAksesHtml() : tabelPenggunaHtml()) + '</div>');
  }
  function barisAkses() {
    const q = S.adm.cariAkses.toLowerCase();
    return S.data.akses.filter(a =>
      (S.adm.kursusAkses === 'semua' || a.id_kursus === S.adm.kursusAkses) &&
      (S.adm.statusAkses === 'semua' || a.status_aktif === S.adm.statusAkses) &&
      (!q || (a.email + ' ' + ((I.pengguna.get(a.email) || {}).nama || '') + ' ' + ((I.kursus.get(a.id_kursus) || {}).judul || '') + ' ' + a.catatan).toLowerCase().includes(q))
    ).sort((x, y) => String(y.tanggal_beli).localeCompare(String(x.tanggal_beli)));
  }
  function tabelAksesHtml() {
    const rows = barisAkses(), tampilRows = rows.slice(0, S.adm.batas);
    return '<div class="alat"><div class="input-ikon"><i class="bi bi-search"></i><input class="input" type="search" placeholder="Cari email, nama, catatan" value="' + esc(S.adm.cariAkses) + '" data-ketik="cari-akses" aria-label="Cari akses"></div>' +
      '<select class="select" data-ubah="kursus-akses" aria-label="Filter kursus"><option value="semua">Semua kursus</option>' + S.data.kursus.map(k => '<option value="' + esc(k.id_kursus) + '"' + (S.adm.kursusAkses === k.id_kursus ? ' selected' : '') + '>' + esc(k.judul) + '</option>').join('') + '</select>' +
      '<select class="select" data-ubah="status-akses" aria-label="Filter status"><option value="semua">Semua status</option><option value="aktif"' + (S.adm.statusAkses === 'aktif' ? ' selected' : '') + '>Aktif</option><option value="nonaktif"' + (S.adm.statusAkses === 'nonaktif' ? ' selected' : '') + '>Nonaktif</option></select></div>' +
      '<div id="tabelAkses">' + (rows.length ? '<div class="tabel-wrap"><table class="tabel kartu-mobile"><thead><tr><th>Member</th><th>Kursus</th><th>Tgl beli</th><th>Status</th><th>Catatan</th><th><span class="sr">Aksi</span></th></tr></thead><tbody>' +
        tampilRows.map(a => { const u = I.pengguna.get(a.email); const k = I.kursus.get(a.id_kursus); const kunci = esc(a.email) + '|' + esc(a.id_kursus);
          return '<tr><td class="utama"><div class="orang"><span class="avatar kecil">' + esc(inisial(u ? u.nama : a.email)) + '</span><div style="min-width:0"><b>' + esc(u ? u.nama : a.email.split('@')[0]) + '</b><small>' + esc(a.email) + '</small></div></div></td>' +
            '<td data-label="Kursus">' + esc(k ? k.judul : a.id_kursus) + '</td><td data-label="Tgl beli">' + fmtTanggal(a.tanggal_beli) + '</td>' +
            '<td data-label="Status"><label class="switch"><input type="checkbox" data-ubah="status-akses-baris" data-kunci="' + kunci + '"' + (a.status_aktif === 'aktif' ? ' checked' : '') + ' aria-label="Status akses ' + esc(a.email) + '"><span class="jalur"></span><span class="kecil">' + (a.status_aktif === 'aktif' ? 'Aktif' : 'Nonaktif') + '</span></label></td>' +
            '<td data-label="Catatan"><span class="teks-2 kecil">' + esc(a.catatan || '—') + '</span></td>' +
            '<td data-label="Aksi"><button type="button" class="ikon-btn" data-act="edit-catatan" data-kunci="' + kunci + '" aria-label="Ubah catatan"><i class="bi bi-pencil"></i></button><button type="button" class="ikon-btn bahaya" data-act="hapus-akses" data-kunci="' + kunci + '" aria-label="Hapus akses"><i class="bi bi-trash3"></i></button></td></tr>';
        }).join('') + '</tbody></table></div>' + (rows.length > S.adm.batas ? '<div class="text-center mt-3"><button type="button" class="btn btn-ghost" data-act="lebih-banyak">Tampilkan lebih banyak</button></div>' : '')
        : kosongHtml('bi-person-x', 'Belum ada akses', 'Tambahkan email member ke kursus untuk memberi akses.', '<button type="button" class="btn btn-utama" data-act="tambah-akses">Tambah Akses</button>')) + '</div>';
  }
  function tabelPenggunaHtml() {
    const utama = (S.data.info && S.data.info.adminUtama) || '';
    const list = (S.data.pengguna || []).slice().sort((a, b) => (a.peran === b.peran ? a.email.localeCompare(b.email) : a.peran === 'admin' ? -1 : 1));
    return '<div class="tabel-wrap"><table class="tabel kartu-mobile"><thead><tr><th>Pengguna</th><th>Peran</th><th>Status</th><th>Terakhir masuk</th><th><span class="sr">Aksi</span></th></tr></thead><tbody>' +
      list.map(u => { const isUtama = u.email === utama, diri = u.email === S.data.user.email;
        return '<tr><td class="utama"><div class="orang"><span class="avatar kecil">' + esc(inisial(u.nama)) + '</span><div style="min-width:0"><b>' + esc(u.nama) + (isUtama ? ' <span class="chip">Utama</span>' : '') + '</b><small>' + esc(u.email) + '</small></div></div></td>' +
          '<td data-label="Peran"><select class="select" style="min-height:38px;width:auto" data-ubah="peran-pengguna" data-email="' + esc(u.email) + '"' + (isUtama ? ' disabled' : '') + ' aria-label="Peran ' + esc(u.email) + '"><option value="member"' + (u.peran === 'member' ? ' selected' : '') + '>Member</option><option value="admin"' + (u.peran === 'admin' ? ' selected' : '') + '>Admin</option></select></td>' +
          '<td data-label="Status"><label class="switch"><input type="checkbox" data-ubah="status-pengguna" data-email="' + esc(u.email) + '"' + (u.status === 'aktif' ? ' checked' : '') + (isUtama || diri ? ' disabled' : '') + ' aria-label="Status ' + esc(u.email) + '"><span class="jalur"></span><span class="kecil">' + (u.status === 'aktif' ? 'Aktif' : 'Nonaktif') + '</span></label></td>' +
          '<td data-label="Terakhir">' + (u.terakhir_masuk ? fmtRelatif(u.terakhir_masuk) : '—') + '</td>' +
          '<td data-label="Aksi"><button type="button" class="btn btn-teks btn-sm" data-act="cabut-sesi" data-email="' + esc(u.email) + '"><i class="bi bi-door-closed"></i> Cabut sesi</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function cariAkses(kunci) { const [email, id] = kunci.split('|'); return S.data.akses.find(a => a.email === email && a.id_kursus === id); }
  async function ubahStatusAkses(el) {
    const a = cariAkses(el.dataset.kunci); if (!a) return;
    const lama = a.status_aktif, baru = el.checked ? 'aktif' : 'nonaktif';
    a.status_aktif = baru;
    const lbl = el.parentElement.querySelector('.kecil'); if (lbl) lbl.textContent = baru === 'aktif' ? 'Aktif' : 'Nonaktif';
    tandaiKotor('beranda', 'kursus', 'progres');
    try { await server('ubahAkses', S.token, a.email, a.id_kursus, { status_aktif: baru, kirimEmail: baru === 'aktif' }); simpanSnapshot(); toast('Akses ' + a.email + ' ' + (baru === 'aktif' ? 'diaktifkan' : 'dinonaktifkan') + '.', 'sukses'); }
    catch (e) { a.status_aktif = lama; el.checked = lama === 'aktif'; if (lbl) lbl.textContent = lama === 'aktif' ? 'Aktif' : 'Nonaktif'; toast(e.message, 'galat'); }
  }
  async function hapusAksesAksi(el) {
    const a = cariAkses(el.dataset.kunci); if (!a) return;
    const k = I.kursus.get(a.id_kursus);
    if (!(await konfirmasi({ judul: 'Hapus akses?', pesan: a.email + ' tidak bisa lagi membuka "' + (k ? k.judul : a.id_kursus) + '". Riwayat progres tetap tersimpan.', ya: 'Hapus', bahaya: true }))) return;
    const i = S.data.akses.indexOf(a); S.data.akses.splice(i, 1);
    $('#isiMember').innerHTML = tabelAksesHtml(); tandaiKotor('beranda', 'kursus', 'progres');
    try { await server('hapusAkses', S.token, a.email, a.id_kursus); simpanSnapshot(); toast('Akses dihapus.', 'sukses'); }
    catch (e) { S.data.akses.splice(i, 0, a); $('#isiMember').innerHTML = tabelAksesHtml(); toast(e.message, 'galat'); }
  }
  function modalCatatan(el) {
    const a = cariAkses(el.dataset.kunci); if (!a) return;
    bukaModal('<form data-kirim="catatan-akses" data-kunci="' + esc(el.dataset.kunci) + '" novalidate><div class="modal-kepala"><div class="judul-wrap"><h2 id="modalJudul">Ubah data akses</h2><p>' + esc(a.email) + '</p></div><button type="button" class="ikon-btn" data-act="tutup-modal" aria-label="Tutup"><i class="bi bi-x-lg"></i></button></div>' +
      '<div class="modal-isi"><div class="field"><label class="label" for="caTgl">Tanggal beli</label><input class="input" type="date" id="caTgl" value="' + esc(String(a.tanggal_beli || '').slice(0, 10)) + '"></div><div class="field"><label class="label" for="caCatatan">Catatan</label><textarea class="textarea" id="caCatatan" maxlength="300" autofocus>' + esc(a.catatan) + '</textarea></div></div>' +
      '<div class="modal-kaki"><span class="catatan"></span><button type="button" class="btn btn-garis" data-act="tutup-modal">Batal</button><button type="submit" class="btn btn-utama">Simpan</button></div></form>', { kecil: true });
  }
  async function simpanCatatanAkses(form) {
    const a = cariAkses(form.dataset.kunci); if (!a) return;
    const lama = { catatan: a.catatan, tanggal_beli: a.tanggal_beli };
    const patch = { catatan: $('#caCatatan').value.trim(), tanggal_beli: $('#caTgl').value };
    a.catatan = patch.catatan; if (patch.tanggal_beli) a.tanggal_beli = new Date(patch.tanggal_beli + 'T00:00:00').toISOString();
    tutupModal(true); $('#isiMember').innerHTML = tabelAksesHtml();
    try { await server('ubahAkses', S.token, a.email, a.id_kursus, patch); simpanSnapshot(); toast('Data akses diperbarui.', 'sukses'); }
    catch (e) { Object.assign(a, lama); $('#isiMember').innerHTML = tabelAksesHtml(); toast(e.message, 'galat'); }
  }
  function modalTambahAkses() {
    const hariIni = hariKey(new Date());
    bukaModal('<form data-kirim="akses" novalidate><div class="modal-kepala"><div class="judul-wrap"><h2 id="modalJudul">Tambah akses member</h2><p>Satu email per baris (atau pisahkan dengan koma). Bisa banyak email × banyak kursus sekaligus.</p></div><button type="button" class="ikon-btn" data-act="tutup-modal" aria-label="Tutup"><i class="bi bi-x-lg"></i></button></div>' +
      '<div class="modal-isi"><div class="field"><label class="label" for="akEmail">Email member</label><textarea class="textarea" id="akEmail" data-ketik="hitung-email" placeholder="budi@gmail.com&#10;ayu@gmail.com" autofocus></textarea><p class="bantuan" id="akHitung">0 email</p></div>' +
      '<div class="field"><label class="label" for="akNama">Nama (opsional, untuk satu email)</label><input class="input" id="akNama" maxlength="80"></div>' +
      '<div class="field"><span class="label">Kursus</span><div class="chip-pilih" id="akKursus">' + S.data.kursus.map(k => '<button type="button" data-act="toggle-pilih" data-id="' + esc(k.id_kursus) + '" aria-pressed="' + (S.adm.kursusAkses === k.id_kursus) + '">' + esc(k.judul) + (k.status_terbit !== 'terbit' ? ' (draf)' : '') + '</button>').join('') + '</div></div>' +
      '<div class="row g-3"><div class="col-sm-6"><div class="field"><label class="label" for="akTgl">Tanggal beli</label><input class="input" type="date" id="akTgl" value="' + hariIni + '"></div></div><div class="col-sm-6"><div class="field"><label class="label" for="akCatatan">Catatan</label><input class="input" id="akCatatan" maxlength="300" placeholder="mis. Transfer BCA 12/11"></div></div></div>' +
      '<label class="switch"><input type="checkbox" id="akKirim"' + ((S.data.pengaturan || {}).EMAIL_NOTIF_AKTIF === 'ya' ? ' checked' : ' disabled') + '><span class="jalur"></span><span>Kirim email pemberitahuan akses aktif</span></label><p class="galat-field" id="akGalat"></p></div>' +
      '<div class="modal-kaki"><span class="catatan"><i class="bi bi-table"></i><span>Disimpan ke Google Sheets (<span class="mono">Sheet: Akses</span>)</span></span><button type="button" class="btn btn-garis" data-act="tutup-modal">Batal</button><button type="submit" class="btn btn-utama" id="akSimpan"><i class="bi bi-person-plus"></i> Simpan Akses</button></div></form>');
  }
  const pisahEmail = t => String(t || '').split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i);
  async function simpanAkses() {
    const emails = pisahEmail($('#akEmail').value);
    const kursus = $$('#akKursus [aria-pressed="true"]').map(b => b.dataset.id);
    const g = $('#akGalat'); g.textContent = '';
    const salah = emails.filter(e => !emailValid(e));
    if (!emails.length) { g.textContent = 'Masukkan minimal satu email.'; return; }
    if (salah.length) { g.textContent = 'Email tidak valid: ' + salah.slice(0, 3).join(', '); return; }
    if (!kursus.length) { g.textContent = 'Pilih minimal satu kursus.'; return; }
    const dup = [];
    emails.forEach(e => kursus.forEach(k => { const a = S.data.akses.find(x => x.email === e && x.id_kursus === k && x.status_aktif === 'aktif'); if (a) dup.push(e); }));
    if (dup.length === emails.length * kursus.length) { g.textContent = 'Semua email sudah memiliki akses aktif ke kursus yang dipilih.'; return; }
    const btn = $('#akSimpan'); setTombol(btn, true, 'Menyimpan…');
    try {
      const r = await server('simpanAksesBatch', S.token, { emails, id_kursus: kursus, tanggal_beli: $('#akTgl').value, catatan: $('#akCatatan').value.trim(), nama: $('#akNama').value.trim(), kirimEmail: $('#akKirim').checked });
      S.data.akses = r.akses; S.data.pengguna = r.pengguna; bangunIndeks();
      tutupModal(true); tandaiKotor(); render('member'); simpanSnapshot();
      let pesan = r.ditambah + ' akses ditambahkan';
      if (r.diaktifkan) pesan += ', ' + r.diaktifkan + ' diaktifkan kembali';
      if (r.duplikat.length) pesan += ', ' + r.duplikat.length + ' duplikat dilewati';
      if (r.emailDiantre) pesan += ', ' + r.emailDiantre + ' email dikirim di latar';
      toast(pesan + '.', 'sukses', { durasi: 6000 });
    } catch (e) { g.textContent = e.message; }
    finally { setTombol(btn, false); }
  }
  function modalPengguna() {
    bukaModal('<form data-kirim="pengguna" novalidate><div class="modal-kepala"><div class="judul-wrap"><h2 id="modalJudul">Tambah pengguna</h2><p>Untuk menambah admin/creator baru, atau member tanpa kursus.</p></div><button type="button" class="ikon-btn" data-act="tutup-modal" aria-label="Tutup"><i class="bi bi-x-lg"></i></button></div>' +
      '<div class="modal-isi"><div class="field"><label class="label" for="puEmail">Email</label><input class="input" type="email" id="puEmail" autofocus></div><div class="field"><label class="label" for="puNama">Nama</label><input class="input" id="puNama" maxlength="80"></div>' +
      '<div class="field"><label class="label" for="puPeran">Peran</label><select class="select" id="puPeran"><option value="admin">Admin / Creator</option><option value="member">Member</option></select></div><p class="galat-field" id="puGalat"></p></div>' +
      '<div class="modal-kaki"><span class="catatan"></span><button type="button" class="btn btn-garis" data-act="tutup-modal">Batal</button><button type="submit" class="btn btn-utama" id="puSimpan">Simpan</button></div></form>', { kecil: true });
  }
  async function simpanPengguna(data, el, lama) {
    try {
      const u = await server('simpanPengguna', S.token, data);
      const i = (S.data.pengguna || []).findIndex(x => x.email === u.email);
      if (i > -1) S.data.pengguna[i] = u; else S.data.pengguna.push(u);
      bangunIndeks(); simpanSnapshot();
      toast('Pengguna ' + u.email + ' disimpan.', 'sukses');
      return u;
    } catch (e) {
      if (el && lama !== undefined) { if (el.type === 'checkbox') el.checked = lama; else el.value = lama; }
      toast(e.message, 'galat');
      throw e;
    }
  }

  // ==========================================================================
  // 19. VIEW ADMIN: EDITOR ROADMAP (drag-and-drop + tombol naik/turun)
  // ==========================================================================
  function renderEditor() {
    const el = $('#v-editor');
    const k = I.kursus.get(S.editor.idKursus);
    if (!k) { el.innerHTML = '<div class="kartu">' + kosongHtml('bi-journal-x', 'Kursus tidak ditemukan', 'Kursus mungkin sudah dihapus.', '<button type="button" class="btn btn-ghost" data-act="nav" data-to="kursus">Kembali</button>') + '</div>'; return; }
    const info = S.data.info || {};
    const daftarKat = [...new Set(S.data.kursus.map(x => x.kategori).filter(Boolean).concat(['Frontend', 'Backend', 'Desain', 'Produktivitas', 'Kebugaran', 'Musik', 'Bisnis']))];
    el.innerHTML = '<div id="bannerEditor"></div>' +
      '<div class="kartu mb-4"><div class="d-flex justify-content-between gap-3 flex-wrap align-items-start"><div style="min-width:0;flex:1 1 320px"><h1>Editor Roadmap Kursus</h1><p class="teks-2 mt-1">Kelola struktur sekuensial materi, jenis berkas penyimpanan, dan syarat kelulusan.</p>' +
      '<span class="chip ' + (k.status_terbit === 'terbit' ? 'sukses' : 'netral') + ' mt-2" id="chipStatusKursus">' + (k.status_terbit === 'terbit' ? '<i class="bi bi-broadcast"></i> Terbit (live)' : 'Draf') + '</span></div>' +
      '<div class="d-flex gap-2 flex-wrap"><button type="button" class="btn btn-garis" data-act="pratinjau-siswa" data-id="' + esc(k.id_kursus) + '"><i class="bi bi-eye"></i> Pratinjau Siswa</button><button type="button" class="btn btn-garis" data-act="simpan-kursus" id="btnSimpanKursus"><i class="bi bi-cloud-check"></i> Simpan Perubahan</button>' +
      '<button type="button" class="btn btn-utama" data-act="tambah-modul"><i class="bi bi-plus-lg"></i> Tambah Modul Baru</button></div></div></div>' +
      '<div class="tata-editor"><div class="kolom">' +
      '<form class="kartu" id="formKursus" novalidate><div class="kartu-judul"><h2><span class="ikon-judul"><i class="bi bi-gear"></i></span>Detail & Pengaturan</h2><span class="mono teks-2">' + esc(k.id_kursus) + '</span></div>' +
      '<div class="field"><label class="label" for="kJudul">Judul kursus</label><input class="input" id="kJudul" data-ketik="kursus-field" value="' + esc(k.judul) + '" maxlength="150"></div>' +
      '<div class="field"><label class="label" for="kKategori">Kategori program</label><input class="input" id="kKategori" list="dlKategori" data-ketik="kursus-field" value="' + esc(k.kategori) + '" maxlength="40"><datalist id="dlKategori">' + daftarKat.map(c => '<option value="' + esc(c) + '">').join('') + '</datalist></div>' +
      '<div class="row g-3"><div class="col-6"><div class="field"><label class="label" for="kLevel">Level</label><select class="select" id="kLevel" data-ubah="kursus-field">' + ['Pemula', 'Menengah', 'Mahir'].map(l => '<option' + (k.level === l ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></div></div>' +
      '<div class="col-6"><div class="field"><label class="label" for="kRating">Rating</label><input class="input" id="kRating" type="number" min="0" max="5" step="0.1" data-ketik="kursus-field" value="' + esc(k.rating || '') + '"></div></div></div>' +
      '<div class="field"><label class="label" for="kCreator">Instruktur / creator</label><input class="input" id="kCreator" data-ketik="kursus-field" value="' + esc(k.creator) + '" maxlength="80"></div>' +
      '<div class="field"><label class="label" for="kUrlBeli">URL pembelian (Lynk.id)</label><input class="input" id="kUrlBeli" type="url" inputmode="url" data-ketik="kursus-field" value="' + esc(k.url_beli || '') + '" placeholder="https://lynk.id/akun-anda/produk"><p class="bantuan">Tampil sebagai tombol <b>Beli</b> di katalog member. Setelah dibayar, webhook Lynk membuka akses otomatis.</p></div>' +
      '<div class="field"><label class="label" for="kDesk">Ringkasan & silabus singkat</label><textarea class="textarea" id="kDesk" data-ketik="kursus-field" maxlength="5000">' + esc(k.deskripsi) + '</textarea></div>' +
      '<div class="field"><div class="d-flex justify-content-between align-items-center mb-2"><span class="label mb-0">Cover kursus (16:9)</span><button type="button" class="btn btn-teks btn-sm" data-act="ganti-sampul"><i class="bi bi-image"></i> Ganti gambar</button></div>' +
      '<div class="sampul-edit" id="sampulEdit">' + sampulHtml(k) + '</div><input type="file" id="fileSampul" accept="image/png,image/jpeg,image/webp,image/gif" data-ubah="file-sampul" hidden>' +
      '<input class="input mt-2" id="kThumb" type="url" data-ketik="kursus-field" placeholder="atau tempel URL gambar https://" value="' + esc(k.thumbnail_url) + '"><p class="bantuan" id="statusSampul"></p></div>' +
      '<div class="set-item" style="border:0;padding-bottom:0"><div class="t"><b>Status terbit</b><small>Jika aktif, member berhak dapat membuka kursus ini di portal.</small></div><label class="switch"><input type="checkbox" id="kTerbit" data-ubah="status-terbit"' + (k.status_terbit === 'terbit' ? ' checked' : '') + '><span class="jalur"></span></label></div>' +
      '<p class="galat-field" id="galatKursus"></p></form>' +
      '<div class="kartu"><div class="kartu-judul"><h2><span class="ikon-judul"><i class="bi bi-google"></i></span>Integrasi Google Workspace</h2></div>' +
      '<div class="integrasi-item"><i class="bi bi-folder-symlink"></i><div class="flex-grow-1"><div class="d-flex justify-content-between gap-2"><b>Drive folder storage</b><span class="chip sukses">Terkoneksi</span></div><small class="teks-2">' + esc(info.folderNama || 'EduTrack_Pro_Storage') + ' · berkas dilindungi otentikasi berbasis peran</small>' + (info.folderUrl ? '<br><a class="kecil" href="' + esc(info.folderUrl) + '" target="_blank" rel="noopener">Buka folder <i class="bi bi-box-arrow-up-right"></i></a>' : '') + '</div></div>' +
      '<div class="integrasi-item"><i class="bi bi-table"></i><div class="flex-grow-1"><div class="d-flex justify-content-between gap-2"><b>Google Sheet sync</b><span class="chip netral normal-case">Auto-saved</span></div><small class="teks-2">Spreadsheet DB · Tab: <span class="mono">Modul</span></small>' + (info.spreadsheetUrl ? '<br><a class="kecil" href="' + esc(info.spreadsheetUrl) + '" target="_blank" rel="noopener">Buka spreadsheet <i class="bi bi-box-arrow-up-right"></i></a>' : '') + '</div></div>' +
      '<button type="button" class="btn btn-bahaya btn-sm mt-3" data-act="hapus-kursus" data-id="' + esc(k.id_kursus) + '"><i class="bi bi-trash3"></i> Hapus kursus</button></div>' +
      '</div><div class="kolom"><div class="kartu"><div class="kartu-judul"><div><h2>Urutan Modul & Jalur Belajar <span class="chip normal-case" id="jumlahModul"></span></h2><p class="teks-2 kecil mt-1">Tarik (drag) modul untuk mengubah urutan, atau aktifkan mode urutkan di layar sentuh.</p></div>' +
      '<div class="d-flex gap-1"><button type="button" class="btn btn-garis btn-sm" data-act="mode-urut" aria-pressed="' + S.editor.modeUrut + '" id="btnModeUrut"><i class="bi bi-arrow-down-up"></i> Urutkan</button><button type="button" class="btn btn-ghost btn-sm" data-act="tambah-modul"><i class="bi bi-plus-lg"></i> Tambah</button></div></div>' +
      '<div class="filter-tipe" id="filterTipe" role="group" aria-label="Filter tipe modul"></div></div>' +
      '<div class="daftar-modul' + (S.editor.modeUrut ? ' mode-urut' : '') + '" id="daftarModul"></div>' +
      '<button type="button" class="sisip-akhir" data-act="tambah-modul"><i class="bi bi-plus-lg"></i> Sisipkan Modul Baru di Akhir Jalur Belajar</button></div></div>';
    renderDaftarModul();
  }
  function renderDaftarModul() {
    const box = $('#daftarModul'); if (!box) return;
    const idK = S.editor.idKursus;
    const semua = semuaModul(idK);
    const hitung = { semua: semua.length };
    Object.keys(TIPE).forEach(t => { hitung[t] = semua.filter(m => m.tipe === t).length; });
    $('#filterTipe').innerHTML = [['semua', 'Semua']].concat(Object.keys(TIPE).map(t => [t, TIPE[t].pendek])).map(([v, l]) => '<button type="button" data-act="filter-tipe" data-v="' + v + '" aria-pressed="' + (S.editor.tipe === v) + '">' + l + ' (' + hitung[v] + ')</button>').join('');
    $('#jumlahModul').textContent = semua.length + ' modul';
    const list = S.editor.tipe === 'semua' ? semua : semua.filter(m => m.tipe === S.editor.tipe);
    box.classList.toggle('mode-urut', S.editor.modeUrut);
    if (!list.length) { box.innerHTML = '<div class="kartu">' + kosongHtml('bi-signpost-split', semua.length ? 'Tidak ada modul tipe ini' : 'Roadmap masih kosong', semua.length ? '' : 'Tambahkan modul pertama: video YouTube, dokumen, ZIP, atau tautan tugas.', semua.length ? '' : '<button type="button" class="btn btn-utama" data-act="tambah-modul"><i class="bi bi-plus-lg"></i> Tambah Modul</button>') + '</div>'; return; }
    const bisaSeret = S.editor.tipe === 'semua';
    box.innerHTML = list.map(m => {
      const no = semua.indexOf(m) + 1, t = TIPE[m.tipe];
      const sumber = m.tipe === 'video' ? 'YouTube · ' + m.sumber.replace(/^https:\/\/(www\.)?/, '') : m.tipe === 'tautan' ? m.sumber.replace(/^https:\/\//, '') : 'Google Drive Storage · ' + (m.nama_berkas || '');
      const pras = m.prasyarat === 'TIDAK_ADA' ? '<span class="chip netral normal-case"><i class="bi bi-unlock"></i> Bebas akses</span>' : m.prasyarat !== 'SEBELUMNYA' && I.modul.get(m.prasyarat) ? '<span class="chip emas normal-case"><i class="bi bi-lock"></i> Setelah: ' + esc(I.modul.get(m.prasyarat).judul.slice(0, 24)) + '</span>' : (no > 1 ? '<span class="chip netral normal-case"><i class="bi bi-lock"></i> Prasyarat: modul ' + (no - 1) + '</span>' : '<span class="chip info normal-case">Modul pembuka</span>');
      return '<div class="mrow' + (m.status === 'draf' ? ' draf' : '') + '" data-id="' + esc(m.id_modul) + '"' + (m._tmp ? ' aria-busy="true"' : '') + '>' +
        (bisaSeret ? '<button type="button" class="pegangan" aria-label="Seret untuk mengubah urutan" title="Seret"><i class="bi bi-grip-vertical"></i></button>' : '') +
        '<span class="nomor">' + String(no).padStart(2, '0') + '</span><span class="ikon-tipe"><i class="bi ' + t.ikon + '"></i></span>' +
        '<div class="isi"><b>' + esc(m.judul) + '</b><div class="tag"><span class="chip normal-case">' + t.pendek + (m.tipe === 'dokumen' || m.tipe === 'zip' ? ' (' + fmtUkuran(m.ukuran_berkas) + ')' : m.durasi_menit ? ' (' + m.durasi_menit + 'm)' : '') + '</span>' + pras +
        (m.lampiran && m.lampiran.length ? '<span class="chip netral normal-case"><i class="bi bi-paperclip"></i> ' + m.lampiran.length + '</span>' : '') + (m.status === 'draf' ? '<span class="chip emas">Draf</span>' : '') + (m._tmp ? '<span class="chip info normal-case"><i class="bi bi-arrow-repeat putar"></i> Menyimpan…</span>' : '') + '</div>' +
        '<small>' + esc(sumber) + (m.deskripsi ? ' · ' + esc(m.deskripsi.slice(0, 80)) : '') + '</small></div>' +
        '<div class="aksi"><div class="geser-btn"><button type="button" data-act="geser-modul" data-id="' + esc(m.id_modul) + '" data-arah="-1" aria-label="Naikkan"' + (no === 1 || !bisaSeret ? ' disabled' : '') + '><i class="bi bi-chevron-up"></i></button><button type="button" data-act="geser-modul" data-id="' + esc(m.id_modul) + '" data-arah="1" aria-label="Turunkan"' + (no === semua.length || !bisaSeret ? ' disabled' : '') + '><i class="bi bi-chevron-down"></i></button></div>' +
        '<span class="aksi-edit d-flex"><button type="button" class="ikon-btn" data-act="edit-modul" data-id="' + esc(m.id_modul) + '" aria-label="Ubah modul ' + esc(m.judul) + '"' + (m._tmp ? ' disabled' : '') + '><i class="bi bi-pencil"></i></button>' +
        '<button type="button" class="ikon-btn bahaya" data-act="hapus-modul" data-id="' + esc(m.id_modul) + '" aria-label="Hapus modul ' + esc(m.judul) + '"' + (m._tmp ? ' disabled' : '') + '><i class="bi bi-trash3"></i></button></span></div></div>';
    }).join('');
  }
  function bannerEditor(html, jenis) {
    const b = $('#bannerEditor'); if (!b) return;
    b.innerHTML = '<div class="banner-sync ' + (jenis || '') + '" role="status"><i class="bi ' + (jenis === 'peringatan' ? 'bi-exclamation-triangle-fill' : 'bi-check-circle-fill') + '"></i><div class="isi">' + html + '</div><small class="mono">Baru saja</small><button type="button" class="ikon-btn" style="width:32px;height:32px" data-act="tutup-banner" aria-label="Tutup"><i class="bi bi-x"></i></button></div>';
    clearTimeout(bannerEditor.t); bannerEditor.t = setTimeout(() => { if ($('#bannerEditor')) $('#bannerEditor').innerHTML = ''; }, 7000);
  }
  // ---- Simpan urutan (debounce, hanya kirim daftar ID) ----
  function terapkanUrutanLokal(idK, ids) {
    ids.forEach((id, i) => { const m = I.modul.get(id); if (m) m.urutan = i + 1; });
    const l = I.modulKursus.get(idK); if (l) l.sort((a, b) => a.urutan - b.urutan);
    tandaiKotor('beranda', 'kursus', 'belajar');
  }
  const simpanUrutan = debounce(async idK => {
    const ids = semuaModul(idK).filter(m => !m._tmp).map(m => m.id_modul);
    try {
      const r = await server('urutkanModul', S.token, idK, ids);
      Object.keys(r.urutan).forEach(id => { const m = I.modul.get(id); if (m) m.urutan = r.urutan[id]; });
      simpanSnapshot();
      bannerEditor('<b>Sinkronisasi sukses:</b> urutan modul tersimpan otomatis ke Google Sheets (<code>Sheet: Modul</code>).');
    } catch (e) {
      bannerEditor(esc(e.message), 'peringatan');
      segarkan(true);
    }
  }, 700);
  function pindahModul(id, keIndex) {
    const idK = S.editor.idKursus, list = semuaModul(idK).slice();
    const dari = list.findIndex(m => m.id_modul === id); if (dari < 0) return;
    keIndex = Math.max(0, Math.min(list.length - 1, keIndex));
    if (dari === keIndex) return;
    const [m] = list.splice(dari, 1); list.splice(keIndex, 0, m);
    terapkanUrutanLokal(idK, list.map(x => x.id_modul));
    renderDaftarModul();
    const row = $('.mrow[data-id="' + id + '"]'); if (row) { const b = row.querySelector('[data-act="geser-modul"]:not([disabled])'); if (b && S.editor.modeUrut) b.focus(); }
    simpanUrutan(idK);
  }
  // ---- Drag & drop (desktop) ----
  let seret = null;
  function pasangDnD() {
    document.addEventListener('pointerdown', e => { const h = e.target.closest('#daftarModul .pegangan'); if (h) h.closest('.mrow').setAttribute('draggable', 'true'); });
    document.addEventListener('dragstart', e => {
      const row = e.target.closest && e.target.closest('#daftarModul .mrow'); if (!row) return;
      seret = row.dataset.id; row.classList.add('seret');
      e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', seret); } catch (x) { }
    });
    document.addEventListener('dragover', e => {
      const box = e.target.closest && e.target.closest('#daftarModul'); if (!box || !seret) return;
      e.preventDefault();
      const rows = $$('.mrow', box).filter(r => r.dataset.id !== seret);
      let idx = rows.length;
      for (let i = 0; i < rows.length; i++) { const b = rows[i].getBoundingClientRect(); if (e.clientY < b.top + b.height / 2) { idx = i; break; } }
      let pen = $('.penanda-lepas', box);
      if (!pen) { pen = document.createElement('div'); pen.className = 'penanda-lepas'; }
      pen.innerHTML = '<span><i class="bi bi-arrow-down"></i> Lepas di sini untuk urutan ke-' + String(idx + 1).padStart(2, '0') + '</span>';
      pen.dataset.idx = idx;
      if (rows[idx]) box.insertBefore(pen, rows[idx]); else box.appendChild(pen);
    });
    document.addEventListener('drop', e => {
      const box = e.target.closest && e.target.closest('#daftarModul'); if (!box || !seret) return;
      e.preventDefault();
      const pen = $('.penanda-lepas', box); const idx = pen ? Number(pen.dataset.idx) : -1;
      const id = seret; selesaiSeret();
      if (idx > -1) pindahModul(id, idx);
    });
    document.addEventListener('dragend', selesaiSeret);
  }
  function selesaiSeret() {
    $$('#daftarModul .mrow').forEach(r => { r.classList.remove('seret'); r.removeAttribute('draggable'); });
    const pen = $('#daftarModul .penanda-lepas'); if (pen) pen.remove();
    seret = null;
  }
  // ---- Simpan detail kursus (autosave debounce) ----
  function bacaFormKursus() {
    const k = I.kursus.get(S.editor.idKursus);
    return Object.assign({}, k, {
      judul: $('#kJudul').value.trim(), kategori: $('#kKategori').value.trim(), level: $('#kLevel').value, rating: $('#kRating').value,
      creator: $('#kCreator').value.trim(), deskripsi: $('#kDesk').value.trim(), thumbnail_url: $('#kThumb').value.trim(), url_beli: $('#kUrlBeli') ? $('#kUrlBeli').value.trim() : (k.url_beli || ''), status_terbit: $('#kTerbit').checked ? 'terbit' : 'draf'
    });
  }
  async function simpanKursus(segera) {
    const form = $('#formKursus'); if (!form) return;
    const data = bacaFormKursus(), g = $('#galatKursus');
    g.textContent = '';
    const tolak = pesan => { g.textContent = pesan; toast('Belum tersimpan: ' + pesan, 'galat', { durasi: 7000 }); };
    if (data.judul.length < 3) return tolak('Judul kursus minimal 3 karakter.');
    if (data.thumbnail_url && !urlValid(data.thumbnail_url)) return tolak('URL cover harus diawali https://');
    if (data.url_beli && !urlValid(data.url_beli)) return tolak('URL pembelian Lynk harus diawali https:// (kosongkan bila belum dipakai).');
    const k = I.kursus.get(data.id_kursus), lama = Object.assign({}, k);
    Object.assign(k, data, { rating: Number(data.rating) || 0 });
    tandaiKotor('beranda', 'kursus', 'belajar'); breadcrumb();
    const chip = $('#chipStatusKursus'); if (chip) { chip.className = 'chip mt-2 ' + (k.status_terbit === 'terbit' ? 'sukses' : 'netral'); chip.innerHTML = k.status_terbit === 'terbit' ? '<i class="bi bi-broadcast"></i> Terbit (live)' : 'Draf'; }
    const btn = $('#btnSimpanKursus'); if (segera) setTombol(btn, true, 'Menyimpan…');
    try {
      const r = await server('simpanKursus', S.token, data);
      Object.assign(k, r); simpanSnapshot();
      bannerEditor('<b>Tersimpan:</b> detail kursus disinkronkan ke Google Sheets (<code>Sheet: Kursus</code>).');
    } catch (e) { Object.assign(k, lama); g.textContent = e.message; bannerEditor(esc(e.message), 'peringatan'); toast('Belum tersimpan: ' + e.message, 'galat', { durasi: 7000 }); }
    finally { if (segera) setTombol(btn, false); }
  }
  const autosaveKursus = debounce(() => simpanKursus(false), 1200);
  async function unggahSampul(file) {
    const st = $('#statusSampul');
    if (!/^image\//.test(file.type)) { st.textContent = 'Pilih berkas gambar.'; return; }
    if (file.size > MAKS_SAMPUL) { st.textContent = 'Ukuran cover maksimal 5 MB.'; return; }
    const lokal = URL.createObjectURL(file);
    $('#sampulEdit').innerHTML = '<div class="sampul"><img src="' + lokal + '" alt=""></div>';
    try {
      const r = await unggah(file, 'sampul', f => { st.textContent = 'Mengunggah cover… ' + Math.round(f * 100) + '%'; });
      if (r.url) { $('#kThumb').value = r.url; const im = new Image(); im.onerror = () => { st.textContent += ' Catatan: gambar belum bisa dimuat dari Drive; pastikan berkas dibagikan "Siapa saja yang memiliki link".'; }; im.referrerPolicy = 'no-referrer'; im.src = r.url; st.textContent = 'Cover terunggah ke Drive. Menyimpan kursus…'; await simpanKursus(false); if (!$('#galatKursus').textContent) st.textContent = 'Cover tersimpan di Drive dan kursus sudah disimpan.'; else st.textContent = 'Cover terunggah, tetapi kursus belum tersimpan: ' + $('#galatKursus').textContent; }
      else { st.textContent = r.peringatan || 'Cover terunggah tanpa URL publik.'; }
    } catch (e) { st.textContent = e.message; }
  }
  async function hapusKursus(id) {
    const k = I.kursus.get(id); if (!k) return;
    if (!(await konfirmasi({ judul: 'Hapus kursus "' + k.judul + '"?', pesan: 'Semua modul dan data akses kursus ini akan dihapus. Riwayat progres tetap disimpan. Berkas di Drive tidak dihapus. Pertimbangkan mengubah status menjadi Draf.', ya: 'Hapus permanen', bahaya: true }))) return;
    try {
      await server('hapusKursus', S.token, id);
      S.data.kursus = S.data.kursus.filter(x => x.id_kursus !== id);
      S.data.modul = S.data.modul.filter(m => m.id_kursus !== id);
      S.data.akses = S.data.akses.filter(a => a.id_kursus !== id);
      bangunIndeks(); tandaiKotor(); simpanSnapshot();
      go('kursus'); toast('Kursus dihapus.', 'sukses');
    } catch (e) { toast(e.message, 'galat'); }
  }
  function modalKursusBaru() {
    bukaModal('<form data-kirim="kursus-baru" novalidate><div class="modal-kepala"><div class="judul-wrap"><h2 id="modalJudul">Buat kursus baru</h2><p>Detail lain bisa dilengkapi di Editor Roadmap.</p></div><button type="button" class="ikon-btn" data-act="tutup-modal" aria-label="Tutup"><i class="bi bi-x-lg"></i></button></div>' +
      '<div class="modal-isi"><div class="field"><label class="label" for="kbJudul">Judul kursus</label><input class="input" id="kbJudul" maxlength="150" autofocus placeholder="mis. Dasar Analisis Data dengan Spreadsheet"></div>' +
      '<div class="row g-3"><div class="col-sm-6"><div class="field"><label class="label" for="kbKategori">Kategori</label><input class="input" id="kbKategori" list="dlKatBaru" maxlength="40" placeholder="Frontend"><datalist id="dlKatBaru">' + [...new Set(S.data.kursus.map(k => k.kategori))].map(c => '<option value="' + esc(c) + '">').join('') + '</datalist></div></div>' +
      '<div class="col-sm-6"><div class="field"><label class="label" for="kbLevel">Level</label><select class="select" id="kbLevel"><option>Pemula</option><option>Menengah</option><option>Mahir</option></select></div></div></div><p class="galat-field" id="kbGalat"></p></div>' +
      '<div class="modal-kaki"><span class="catatan"><i class="bi bi-info-circle"></i> Kursus baru berstatus Draf</span><button type="button" class="btn btn-garis" data-act="tutup-modal">Batal</button><button type="submit" class="btn btn-utama" id="kbSimpan">Buat & buka editor</button></div></form>', { kecil: true });
  }
  async function buatKursus() {
    const judul = $('#kbJudul').value.trim(), g = $('#kbGalat');
    if (judul.length < 3) { g.textContent = 'Judul minimal 3 karakter.'; return; }
    const btn = $('#kbSimpan'); setTombol(btn, true, 'Membuat…');
    try {
      const k = await server('simpanKursus', S.token, { judul, kategori: $('#kbKategori').value.trim() || 'Umum', level: $('#kbLevel').value, status_terbit: 'draf', creator: S.data.user.nama });
      S.data.kursus.push(k); bangunIndeks(); tandaiKotor(); simpanSnapshot();
      tutupModal(true); go('editor', { id: k.id_kursus });
      toast('Kursus dibuat. Tambahkan modul pertama.', 'sukses');
    } catch (e) { g.textContent = e.message; setTombol(btn, false); }
  }

  // ---- Modal tambah / ubah modul ----
  let MF = null; // state formulir modul
  function bukaModalModul(idModul) {
    const idK = S.editor.idKursus, semua = semuaModul(idK);
    const m = idModul ? I.modul.get(idModul) : null;
    MF = m ? JSON.parse(JSON.stringify(m)) : { id_modul: '', id_kursus: idK, tipe: 'video', judul: '', sumber: '', deskripsi: '', durasi_menit: '', prasyarat: 'SEBELUMNYA', status: 'terbit', nama_berkas: '', ukuran_berkas: 0, lampiran: [] };
    MF.unggah = { utama: null, lampiran: [] };
    MF.yt = null;
    const urutan = m ? semua.indexOf(m) + 1 : semua.length + 1;
    bukaModal('<form data-kirim="modul" novalidate><div class="modal-kepala"><div class="judul-wrap"><h2 id="modalJudul">' + (m ? 'Ubah Modul Pembelajaran' : 'Tambah Modul Pembelajaran') + ' <span class="chip netral normal-case mono">Urutan ke-' + String(urutan).padStart(2, '0') + '</span></h2><p>Tentukan tipe konten, prasyarat penyelesaian, dan integrasi penyimpanan Drive/YouTube.</p></div>' +
      '<button type="button" class="ikon-btn" data-act="tutup-modal" aria-label="Tutup"><i class="bi bi-x-lg"></i></button></div><div class="modal-isi">' +
      '<span class="label">Tipe konten pembelajaran</span><div class="tipe-pilih mb-4" role="group" aria-label="Tipe konten">' +
      Object.keys(TIPE).map(t => '<button type="button" data-act="modul-tipe" data-v="' + t + '" aria-pressed="' + (MF.tipe === t) + '"><i class="bi ' + TIPE[t].ikon + '"></i>' + TIPE[t].label + '</button>').join('') + '</div>' +
      '<div class="field"><label class="label" for="mfJudul">Judul lengkap modul</label><input class="input" id="mfJudul" data-ketik="mf" data-f="judul" value="' + esc(MF.judul) + '" maxlength="200" autofocus placeholder="mis. Pengenalan Arsitektur State Management"></div>' +
      '<div id="mfTipe"></div>' +
      '<div class="field"><div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2"><span class="label mb-0">Lampiran pendukung (Google Drive)</span><span class="mono teks-2 mini">Folder: /' + esc((S.data.info || {}).folderNama || 'EduTrack_Pro_Storage') + '/Materi</span></div>' +
      '<label class="dropzone" data-drop="lampiran"><i class="bi bi-cloud-arrow-up"></i><b>Tarik & lepas berkas PDF, DOCX, atau ZIP ke sini, atau telusuri</b><small class="teks-2">Maks 50 MB per berkas · tersimpan privat di Drive admin</small><input type="file" multiple accept="' + EXT_LAMPIRAN + '" data-ubah="file-lampiran"></label><div id="mfLampiran"></div></div>' +
      '<div class="field"><label class="label" for="mfDesk">Ringkasan & catatan modul</label><textarea class="textarea" id="mfDesk" data-ketik="mf" data-f="deskripsi" maxlength="8000" placeholder="Jelaskan tujuan belajar, poin penting, dan tautan referensi (https://…)">' + esc(MF.deskripsi) + '</textarea></div>' +
      '<div class="row g-3"><div class="col-sm-6"><div class="field"><label class="label" for="mfDurasi">Estimasi durasi belajar</label><div class="input-ikon dengan-akhir"><i class="bi bi-clock"></i><input class="input" id="mfDurasi" type="number" min="0" max="600" data-ketik="mf" data-f="durasi_menit" value="' + esc(MF.durasi_menit) + '" placeholder="15"><span class="akhir teks-2 kecil">menit</span></div></div></div>' +
      '<div class="col-sm-6"><div class="field"><label class="label" for="mfPras">Prasyarat</label><select class="select" id="mfPras" data-ubah="mf" data-f="prasyarat"><option value="SEBELUMNYA">Selesaikan modul sebelumnya</option><option value="TIDAK_ADA"' + (MF.prasyarat === 'TIDAK_ADA' ? ' selected' : '') + '>Tanpa prasyarat (bebas)</option>' +
      semua.filter(x => x.id_modul !== MF.id_modul && !x._tmp).map((x, i) => '<option value="' + esc(x.id_modul) + '"' + (MF.prasyarat === x.id_modul ? ' selected' : '') + '>Setelah modul ' + (semua.indexOf(x) + 1) + ': ' + esc(x.judul.slice(0, 40)) + '</option>').join('') + '</select></div></div></div>' +
      '<div class="field mb-0"><span class="label">Status visibilitas modul</span><div class="seg" role="group" aria-label="Status visibilitas"><button type="button" data-act="mf-status" data-v="terbit" aria-pressed="' + (MF.status === 'terbit') + '"><i class="bi bi-broadcast"></i> Terbit / siap dipelajari</button><button type="button" data-act="mf-status" data-v="draf" aria-pressed="' + (MF.status === 'draf') + '"><i class="bi bi-pencil-square"></i> Draf</button></div></div>' +
      '<p class="galat-field mt-3" id="mfGalat"></p></div>' +
      '<div class="modal-kaki"><span class="catatan"><i class="bi bi-arrow-repeat"></i><span>Disinkronkan otomatis ke Google Sheets (<span class="mono">Sheet: Modul</span>)</span></span><button type="button" class="btn btn-garis" data-act="tutup-modal">Batal</button><button type="submit" class="btn btn-utama" id="mfSimpan"><i class="bi bi-save"></i> Simpan Modul</button></div></form>',
      { sebelumTutup: async () => { if (!MF || !adaUnggahAktif()) return true; const ok = await konfirmasi({ judul: 'Batalkan unggahan?', pesan: 'Berkas yang sedang diunggah akan dibatalkan.', ya: 'Batalkan unggahan', bahaya: true }); if (ok) batalSemuaUnggah(); return ok; } });
    renderBagianTipe(); renderLampiranMF(); perbaruiTombolMF();
    if (MF.tipe === 'video' && MF.sumber) validasiYt(true);
  }
  function adaUnggahAktif() { return !!MF && ((MF.unggah.utama && !MF.unggah.utama.selesai && !MF.unggah.utama.galat) || MF.unggah.lampiran.some(u => !u.selesai && !u.galat)); }
  function batalSemuaUnggah() { if (!MF) return; if (MF.unggah.utama) MF.unggah.utama.dibatalkan = true; MF.unggah.lampiran.forEach(u => { u.dibatalkan = true; }); }
  function renderBagianTipe() {
    const box = $('#mfTipe'); if (!box || !MF) return;
    if (MF.tipe === 'video') {
      box.innerHTML = '<div class="field"><div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2"><label class="label mb-0" for="mfUrl"><i class="bi bi-play-btn"></i> URL video YouTube (unlisted)</label><span id="ytStatus" class="status-validasi"></span></div>' +
        '<div class="input-ikon"><i class="bi bi-youtube"></i><input class="input mono" id="mfUrl" data-ketik="mf-url" value="' + esc(MF.sumber) + '" placeholder="https://www.youtube.com/watch?v=…" inputmode="url"></div>' +
        '<p class="bantuan">Hanya menerima URL YouTube unlisted/publik. Format valid: <span class="mono">https://youtu.be/…</span> atau <span class="mono">https://www.youtube.com/watch?v=…</span></p><div id="ytPratinjau"></div></div>';
      pratinjauYt();
    } else if (MF.tipe === 'tautan') {
      box.innerHTML = '<div class="field"><label class="label" for="mfUrl">URL tautan / tugas</label><div class="input-ikon"><i class="bi bi-link-45deg"></i><input class="input" id="mfUrl" data-ketik="mf-url" value="' + esc(MF.sumber) + '" placeholder="https://forms.gle/… atau https://classroom.github.com/…" inputmode="url"></div><p class="bantuan">Google Form, GitHub Classroom, dokumen referensi, dan sejenisnya. Wajib https://.</p></div>';
    } else {
      const akses = MF.tipe === 'zip' ? EXT_ZIP : EXT_DOKUMEN;
      const u = MF.unggah.utama;
      let isi;
      if (u && !u.selesai) isi = itemUnggahHtml(u, 'utama');
      else if (MF.sumber && MF.nama_berkas) isi = '<div class="unggah-item"><span class="berkas" style="padding:0;flex:1;min-width:0"><span class="tipe ' + kelasBerkas(MF.nama_berkas) + '">' + esc(ekstensi(MF.nama_berkas).toUpperCase() || 'FILE') + '</span><span class="info"><b>' + esc(MF.nama_berkas) + '</b><small>' + fmtUkuran(MF.ukuran_berkas) + ' · tersimpan di Drive <i class="bi bi-check-circle-fill" style="color:var(--sukses)"></i></small></span></span><label class="btn btn-garis btn-sm" style="cursor:pointer">Ganti<input type="file" hidden accept="' + akses + '" data-ubah="file-utama"></label></div>';
      else isi = '<label class="dropzone" data-drop="utama"><i class="bi bi-file-earmark-arrow-up"></i><b>Tarik & lepas ' + (MF.tipe === 'zip' ? 'berkas ZIP' : 'dokumen PDF/DOCX') + ' di sini atau telusuri</b><small class="teks-2">Batas kuota GAS Google Drive: maks 50 MB per berkas</small><input type="file" accept="' + akses + '" data-ubah="file-utama"></label>';
      box.innerHTML = '<div class="field"><span class="label">' + (MF.tipe === 'zip' ? 'Berkas ZIP utama' : 'Dokumen utama') + '</span>' + isi + '</div>';
    }
  }
  function itemUnggahHtml(u, jenis, idx) {
    return '<div class="unggah-item"><i class="bi ' + (u.galat ? 'bi-exclamation-triangle-fill' : 'bi-cloud-arrow-up') + '" style="color:' + (u.galat ? 'var(--bahaya)' : 'var(--primary)') + '"></i><div style="flex:1;min-width:0"><b class="potong d-block kecil">' + esc(u.nama) + '</b>' +
      (u.galat ? '<small class="galat-field d-block mt-0">' + esc(u.galat) + '</small>' : barHtml(Math.round(u.f * 100)) + '<small class="teks-2">' + Math.round(u.f * 100) + '% dari ' + fmtUkuran(u.ukuran) + '</small>') + '</div>' +
      '<button type="button" class="ikon-btn" data-act="batal-unggah" data-jenis="' + jenis + '" data-idx="' + (idx === undefined ? '' : idx) + '" aria-label="Batalkan"><i class="bi bi-x-lg"></i></button></div>';
  }
  function renderLampiranMF() {
    const box = $('#mfLampiran'); if (!box || !MF) return;
    box.innerHTML = MF.lampiran.map((l, i) => '<div class="unggah-item"><span class="berkas" style="padding:0;flex:1;min-width:0"><span class="tipe ' + kelasBerkas(l.nama) + '">' + esc((ekstensi(l.nama) || 'file').toUpperCase()) + '</span><span class="info"><b>' + esc(l.nama) + '</b><small>' + fmtUkuran(l.ukuran) + '</small></span></span><button type="button" class="ikon-btn bahaya" data-act="hapus-lampiran" data-idx="' + i + '" aria-label="Lepas lampiran"><i class="bi bi-x-lg"></i></button></div>').join('') +
      MF.unggah.lampiran.map((u, i) => u.selesai ? '' : itemUnggahHtml(u, 'lampiran', i)).join('');
  }
  function perbaruiTombolMF() {
    const btn = $('#mfSimpan'); if (!btn || !MF) return;
    const aktif = adaUnggahAktif();
    btn.disabled = aktif;
    btn.innerHTML = aktif ? '<i class="bi bi-arrow-repeat putar"></i> Menunggu unggahan…' : '<i class="bi bi-save"></i> Simpan Modul';
  }
  function pratinjauYt() {
    const box = $('#ytPratinjau'), st = $('#ytStatus'); if (!box || !MF) return;
    const id = ytId(MF.sumber);
    if (!MF.sumber) { box.innerHTML = ''; st.className = 'status-validasi'; st.innerHTML = ''; return; }
    if (!id) { box.innerHTML = ''; st.className = 'status-validasi galat'; st.innerHTML = '<i class="bi bi-x-circle-fill"></i> Bukan URL YouTube'; return; }
    const yt = MF.yt && MF.yt.id === id ? MF.yt : null;
    st.className = 'status-validasi ' + (yt ? (yt.valid ? 'ok' : 'galat') : 'proses');
    st.innerHTML = yt ? (yt.valid ? '<i class="bi bi-patch-check-fill"></i> Tervalidasi: YouTube' : '<i class="bi bi-x-circle-fill"></i> ' + esc(yt.pesan)) : '<i class="bi bi-arrow-repeat putar"></i> Memeriksa video…';
    box.innerHTML = '<div class="pratinjau-yt"><img src="https://i.ytimg.com/vi/' + id + '/mqdefault.jpg" alt=""><div style="min-width:0"><b class="potong-2">' + esc(yt && yt.judul ? yt.judul : 'Video YouTube · ' + id) + '</b><small class="teks-2">' + esc(yt && yt.kanal ? yt.kanal + ' · ' : '') + (MF.durasi_menit ? 'Durasi: ' + MF.durasi_menit + ' menit' : 'Isi estimasi durasi di bawah') + '</small></div></div>';
  }
  const validasiYt = debounce(async () => {
    if (!MF || MF.tipe !== 'video') return;
    const id = ytId(MF.sumber); if (!id) return;
    try { const r = await server('cekVideoYouTube', S.token, MF.sumber); if (MF && ytId(MF.sumber) === r.id) { MF.yt = r; if (r.valid && !MF.judul && $('#mfJudul')) { MF.judul = r.judul; $('#mfJudul').value = r.judul; } pratinjauYt(); } }
    catch (e) { if (MF) { MF.yt = { id, valid: false, pesan: e.message }; pratinjauYt(); } }
  }, 600);
  function pilihBerkasMF(files, jenis) {
    if (!MF) return;
    Array.from(files).slice(0, jenis === 'utama' ? 1 : 10).forEach(file => {
      const ext = '.' + ekstensi(file.name);
      const izin = (jenis === 'utama' ? (MF.tipe === 'zip' ? EXT_ZIP : EXT_DOKUMEN) : EXT_LAMPIRAN).split(',');
      if (!izin.includes(ext)) { toast('Tipe berkas ' + ext + ' tidak diizinkan.', 'peringatan'); return; }
      if (file.size > MAKS_UNGGAH) { toast(file.name + ' melebihi 50 MB.', 'peringatan'); return; }
      if (!file.size) { toast(file.name + ' kosong.', 'peringatan'); return; }
      const u = { nama: file.name, ukuran: file.size, f: 0, selesai: false, galat: '', dibatalkan: false };
      if (jenis === 'utama') { MF.unggah.utama = u; renderBagianTipe(); } else { MF.unggah.lampiran.push(u); renderLampiranMF(); }
      perbaruiTombolMF();
      const tampilkan = debounce(() => { if (jenis === 'utama') renderBagianTipe(); else renderLampiranMF(); }, 120);
      unggah(file, 'materi', f => { u.f = f; tampilkan(); }, u).then(r => {
        u.selesai = true;
        if (!MF || u.dibatalkan) return;
        if (jenis === 'utama') { MF.sumber = r.id; MF.nama_berkas = r.nama; MF.ukuran_berkas = r.ukuran; renderBagianTipe(); if (!MF.judul && $('#mfJudul')) { MF.judul = r.nama.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '); $('#mfJudul').value = MF.judul; } }
        else { MF.lampiran.push({ id: r.id, nama: r.nama, ukuran: r.ukuran, mime: r.mime }); renderLampiranMF(); }
        perbaruiTombolMF();
      }).catch(e => { u.galat = e.kode === 'BATAL' ? 'Dibatalkan' : e.message; if (MF) { if (jenis === 'utama') renderBagianTipe(); else renderLampiranMF(); perbaruiTombolMF(); } });
    });
  }
  async function unggah(file, jenis, onProg, kendali) {
    const meta = await server('mulaiUnggah', S.token, { nama: file.name, mime: file.type || mimeDariNama(file.name), ukuran: file.size, jenis });
    const UK = meta.potongan || 4194304;
    let mulai = 0;
    while (mulai < file.size) {
      if (kendali && kendali.dibatalkan) throw Object.assign(new Error('Unggahan dibatalkan.'), { kode: 'BATAL' });
      const b64 = await blobKeBase64(file.slice(mulai, Math.min(file.size, mulai + UK)));
      let r, coba = 0;
      for (; ;) {
        try { r = await server('unggahPotongan', S.token, meta.uploadId, b64, mulai); break; }
        catch (e) { if (++coba > 2 || ['KEDALUWARSA', 'AKSES_DITOLAK', 'SESI_HABIS'].includes(e.kode)) throw e; await tidur(1500 * coba); }
      }
      if (r.selesai) { if (onProg) onProg(1); return r; }
      mulai = r.diterima;
      if (onProg) onProg(mulai / file.size);
    }
    throw new Error('Unggahan tidak selesai. Coba lagi.');
  }
  function validasiMF() {
    const m = MF;
    if (m.judul.trim().length < 3) return ['mfJudul', 'Judul modul minimal 3 karakter.'];
    if (m.tipe === 'video' && !ytId(m.sumber)) return ['mfUrl', 'URL video harus berasal dari YouTube.'];
    if (m.tipe === 'tautan' && !urlValid(m.sumber)) return ['mfUrl', 'Tautan harus diawali https://'];
    if ((m.tipe === 'dokumen' || m.tipe === 'zip') && !m.sumber) return [null, 'Unggah berkas ' + (m.tipe === 'zip' ? 'ZIP' : 'dokumen') + ' utama terlebih dahulu.'];
    const d = Number(m.durasi_menit || 0); if (d < 0 || d > 600) return ['mfDurasi', 'Durasi 0–600 menit.'];
    return null;
  }
  async function simpanModul() {
    if (!MF) return;
    const g = $('#mfGalat'); g.textContent = '';
    $$('.modal-isi .input.galat').forEach(x => x.classList.remove('galat'));
    const err = validasiMF();
    if (err) { g.textContent = err[1]; if (err[0] && $('#' + err[0])) { $('#' + err[0]).classList.add('galat'); $('#' + err[0]).focus(); } return; }
    if (adaUnggahAktif()) { g.textContent = 'Tunggu unggahan selesai.'; return; }
    const kirim = { id_modul: MF.id_modul, id_kursus: MF.id_kursus, tipe: MF.tipe, judul: MF.judul.trim(), sumber: MF.sumber.trim(), deskripsi: MF.deskripsi, durasi_menit: Number(MF.durasi_menit) || 0, prasyarat: MF.prasyarat, status: MF.status, nama_berkas: MF.nama_berkas, ukuran_berkas: MF.ukuran_berkas, lampiran: MF.lampiran };
    const salinan = JSON.parse(JSON.stringify(MF));
    // Optimistic: tampil di daftar seketika
    const lama = MF.id_modul ? Object.assign({}, I.modul.get(MF.id_modul)) : null;
    let tmp = null;
    if (lama) { Object.assign(I.modul.get(MF.id_modul), kirim, { _tmp: true }); }
    else {
      tmp = Object.assign({}, kirim, { id_modul: 'tmp-' + Date.now(), urutan: semuaModul(MF.id_kursus).length + 1, diperbarui: new Date().toISOString(), _tmp: true });
      S.data.modul.push(tmp); bangunIndeks();
    }
    MF = null; tutupModal(true); renderDaftarModul(); tandaiKotor('beranda', 'kursus', 'belajar');
    try {
      const r = await server('simpanModul', S.token, kirim);
      if (lama) { const m = I.modul.get(r.id_modul); Object.assign(m, r); delete m._tmp; }
      else { const i = S.data.modul.indexOf(tmp); S.data.modul[i] = r; }
      bangunIndeks(); renderDaftarModul(); simpanSnapshot();
      bannerEditor('<b>Sinkronisasi sukses:</b> modul "' + esc(r.judul) + '" tersimpan ke Google Sheets (<code>Sheet: Modul</code>).');
    } catch (e) {
      if (lama) { const m = I.modul.get(lama.id_modul); Object.keys(m).forEach(k => delete m[k]); Object.assign(m, lama); }
      else { S.data.modul = S.data.modul.filter(x => x !== tmp); }
      bangunIndeks(); renderDaftarModul();
      toast('Gagal menyimpan modul: ' + e.message, 'galat', { durasi: 9000, aksi: { teks: 'Buka lagi', fn: () => bukaUlangMF(salinan) } });
    }
  }
  function bukaUlangMF(salinan) {
    bukaModalModul(salinan.id_modul || null);
    Object.assign(MF, salinan, { unggah: { utama: null, lampiran: [] } });
    $('#mfJudul').value = MF.judul; $('#mfDesk').value = MF.deskripsi; $('#mfDurasi').value = MF.durasi_menit;
    $$('[data-act="modul-tipe"]').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === MF.tipe));
    renderBagianTipe(); renderLampiranMF();
  }
  async function hapusModul(id) {
    const m = I.modul.get(id); if (!m) return;
    if (!(await konfirmasi({ judul: 'Hapus modul?', pesan: '"' + m.judul + '" akan dihapus dari roadmap dan urutan modul lain disesuaikan. Berkas di Drive tidak dihapus.', ya: 'Hapus modul', bahaya: true }))) return;
    const i = S.data.modul.indexOf(m);
    S.data.modul.splice(i, 1); bangunIndeks();
    terapkanUrutanLokal(m.id_kursus, semuaModul(m.id_kursus).map(x => x.id_modul));
    renderDaftarModul();
    try {
      const r = await server('hapusModul', S.token, id);
      Object.keys(r.urutan || {}).forEach(k => { const x = I.modul.get(k); if (x) x.urutan = r.urutan[k]; });
      bangunIndeks(); renderDaftarModul(); simpanSnapshot();
      bannerEditor('<b>Modul dihapus.</b> Urutan roadmap disinkronkan ke Google Sheets (<code>Sheet: Modul</code>).');
    } catch (e) { S.data.modul.splice(i, 0, m); bangunIndeks(); renderDaftarModul(); toast(e.message, 'galat'); }
  }

  // ==========================================================================
  // 20. PENCARIAN GLOBAL, FILTER & NOTIFIKASI (lokal, tanpa server)
  // ==========================================================================
  function cari(qRaw) {
    const box = $('#cariHasil'), q = String(qRaw || '').trim().toLowerCase();
    if (q.length < 2) { box.hidden = true; return; }
    const kursus = S.data.kursus.filter(k => (k.judul + ' ' + k.kategori + ' ' + k.creator).toLowerCase().includes(q)).slice(0, 5);
    const modul = S.data.modul.filter(m => (m.judul + ' ' + m.deskripsi).toLowerCase().includes(q) && I.kursus.has(m.id_kursus)).slice(0, 6);
    const orang = isAdmin() ? (S.data.pengguna || []).filter(u => (u.email + ' ' + u.nama).toLowerCase().includes(q)).slice(0, 5) : [];
    let html = '';
    if (kursus.length) html += '<div class="hasil-grup">Kursus</div>' + kursus.map(k => '<button type="button" class="hasil-item" data-act="hasil" data-jenis="kursus" data-id="' + esc(k.id_kursus) + '"><span class="ikon"><i class="bi ' + warnaKat(k.kategori).ikon + '"></i></span><span class="t"><b>' + esc(k.judul) + '</b><small>' + esc(k.kategori) + ' · ' + esc(k.creator) + '</small></span></button>').join('');
    if (modul.length) html += '<div class="hasil-grup">Modul</div>' + modul.map(m => '<button type="button" class="hasil-item" data-act="hasil" data-jenis="modul" data-id="' + esc(m.id_modul) + '"><span class="ikon"><i class="bi ' + TIPE[m.tipe].ikon + '"></i></span><span class="t"><b>' + esc(m.judul) + '</b><small>' + esc((I.kursus.get(m.id_kursus) || {}).judul || '') + '</small></span></button>').join('');
    if (orang.length) html += '<div class="hasil-grup">Pengguna</div>' + orang.map(u => '<button type="button" class="hasil-item" data-act="hasil" data-jenis="orang" data-id="' + esc(u.email) + '"><span class="ikon"><i class="bi bi-person"></i></span><span class="t"><b>' + esc(u.nama) + '</b><small>' + esc(u.email) + ' · ' + u.peran + '</small></span></button>').join('');
    box.innerHTML = html || '<p class="teks-2 p-3 mb-0">Tidak ada hasil untuk "' + esc(qRaw) + '".</p>';
    box.hidden = false;
  }
  function bukaHasil(el) {
    const id = el.dataset.id;
    $('#inCari').value = ''; tutupPopover();
    if (el.dataset.jenis === 'kursus') return isAdmin() ? go('editor', { id }) : go('belajar', { id });
    if (el.dataset.jenis === 'modul') { const m = I.modul.get(id); if (!m) return; return isAdmin() ? (go('editor', { id: m.id_kursus }), bukaModalModul(id)) : go('belajar', { id: m.id_kursus, modul: id }); }
    S.adm.tabMember = 'akses'; S.adm.cariAkses = id; go('member', {}); render('member');
  }
  function bukaFilter() {
    const p = $('#popFilter');
    if (!p.hidden) { p.hidden = true; return; }
    tutupPopover();
    const kat = [...new Set(S.data.kursus.concat(S.data.katalog).map(k => k.kategori).filter(Boolean))];
    p.innerHTML = '<b class="d-block mb-2">Filter kursus</b><span class="label">Kategori</span><div class="chip-pilih mb-3"><button type="button" data-act="pilih-kat" data-v="" aria-pressed="' + (!S.filter.kategori) + '">Semua</button>' + kat.map(c => '<button type="button" data-act="pilih-kat" data-v="' + esc(c) + '" aria-pressed="' + (S.filter.kategori === c) + '">' + esc(c) + '</button>').join('') + '</div>' +
      '<button type="button" class="btn btn-utama btn-sm btn-blok" data-act="nav" data-to="kursus">Lihat hasil</button>';
    p.hidden = false;
  }
  function bukaNotif() {
    const p = $('#popNotif');
    if (!p.hidden) { p.hidden = true; return; }
    tutupPopover();
    const baru = new Set(belumDibaca().map(x => x.id));
    const list = S.data.pengumuman.slice(0, 5);
    p.innerHTML = '<div class="d-flex justify-content-between align-items-center px-2 pt-1"><b>Notifikasi</b><button type="button" class="btn btn-teks btn-sm" data-act="nav" data-to="pesan">Lihat semua</button></div>' +
      (list.length ? list.map(x => '<button type="button" class="hasil-item" data-act="nav" data-to="pesan"><span class="ikon"' + (baru.has(x.id) ? ' style="background:var(--primary-kuat);color:#fff"' : '') + '><i class="bi bi-megaphone"></i></span><span class="t"><b>' + esc(x.judul) + '</b><small>' + fmtRelatif(x.dibuat) + ' · ' + esc(String(x.isi).slice(0, 60)) + '</small></span></button>').join('') : '<p class="teks-2 p-3 mb-0">Belum ada notifikasi.</p>');
    p.hidden = false;
    if (!isAdmin()) tandaiDibaca();
  }

  // ==========================================================================
  // 21. PETA VIEW & AKSI (event delegation tunggal)
  // ==========================================================================
  // ==========================================================================
  // 18b. VIEW ADMIN: ORDER LYNK.ID (webhook → akses otomatis)
  // ==========================================================================
  const LABEL_LYNK = { diproses: ['sukses', 'Diproses'], manual: ['info', 'Manual'], sebagian: ['emas', 'Sebagian'], perlu_tinjau: ['bahaya', 'Perlu tinjau'], diabaikan: ['netral', 'Diabaikan'], duplikat: ['netral', 'Duplikat'], nonaktif: ['netral', 'Nonaktif'] };
  const rupiah = n => 'Rp' + Math.round(Number(n) || 0).toLocaleString('id-ID');
  const rupiahRingkas = n => { n = Number(n) || 0; return n >= 1e9 ? 'Rp' + angkaID(n / 1e9) + ' M' : n >= 1e6 ? 'Rp' + angkaID(n / 1e6) + ' jt' : n >= 1e4 ? 'Rp' + angkaID(n / 1e3, 0) + ' rb' : rupiah(n); };
  /** Pasang data Lynk dari respons server tanpa menimpa perubahan switch yang belum dikonfirmasi (anti-race). */
  function terapkanLynk(baru) {
    if (!baru) return;
    if (S.lynkAktifTunda !== undefined) baru.aktif = S.lynkAktifTunda;
    S.data.lynk = baru;
  }
  function lynkData() {
    const L = (S.data && S.data.lynk) || {};
    L.produk = L.produk || []; L.order = L.order || []; L.ringkas = L.ringkas || {};
    if (S.data) S.data.lynk = L;
    return L;
  }
  const perluTinjau = o => o.status === 'perlu_tinjau' || o.status === 'sebagian';
  function hitungLynkTinjau() { return lynkData().order.filter(perluTinjau).length; }
  function chipKursusHtml(ids) {
    return '<div class="chip-kursus">' + (ids || []).map(id => { const k = I.kursus.get(id); return '<span class="chip normal-case">' + esc(k ? k.judul : id) + '</span>'; }).join('') + '</div>';
  }
  function lynkHtml() {
    const L = lynkData(), R = L.ringkas;
    return '<div class="grid-kpi mb-4">' + kpi('bi-receipt', 'kat-indigo', R.total || 0, 'Order tercatat') + kpi('bi-unlock', 'kat-hijau', (R.diproses || 0) + (R.manual || 0), 'Akses dibuka') +
      kpi('bi-exclamation-diamond', 'kat-oranye', (R.perlu_tinjau || 0) + (R.sebagian || 0), 'Perlu tinjau') + kpi('bi-cash-stack', 'kat-emas', rupiahRingkas(R.omzet), 'Omzet Lynk') + '</div>' +
      '<div class="tata-2"><div class="kolom"><div class="kartu"><div class="kartu-judul"><h2><span class="ikon-judul"><i class="bi bi-receipt"></i></span>Order masuk</h2><span class="teks-2 kecil">' + (L.order.length >= 200 ? '200 terbaru' : L.order.length + ' order') + '</span></div>' +
      '<div class="alat"><div class="input-ikon"><i class="bi bi-search"></i><input class="input" type="search" placeholder="Cari ref, email, produk" value="' + esc(S.adm.cariLynk) + '" data-ketik="cari-lynk" aria-label="Cari order Lynk"></div>' +
      '<select class="select" data-ubah="status-lynk" aria-label="Filter status order">' + [['semua', 'Semua status'], ['tinjau', 'Perlu tindakan'], ['diproses', 'Diproses'], ['manual', 'Manual'], ['sebagian', 'Sebagian'], ['perlu_tinjau', 'Perlu tinjau'], ['diabaikan', 'Diabaikan']].map(([v, l]) => '<option value="' + v + '"' + (S.adm.statusLynk === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></div>' +
      '<div id="tabelLynk">' + tabelOrderHtml() + '</div></div></div>' +
      '<aside class="kolom">' +
      '<div class="kartu"><div class="kartu-judul"><h2><span class="ikon-judul"><i class="bi bi-lightning-charge"></i></span>Webhook Lynk.id</h2><label class="switch"><input type="checkbox" data-ubah="lynk-aktif"' + (L.aktif ? ' checked' : '') + ' aria-label="Terima webhook Lynk"><span class="jalur"></span><span class="kecil">' + (L.aktif ? 'Aktif' : 'Nonaktif') + '</span></label></div>' +
      '<p class="teks-2 kecil mb-2">Saat order dibayar, Lynk mengirim data ke URL ini. Script menambah baris di sheet <span class="mono">Akses</span> (email, kursus, aktif). Kiriman ulang order yang sama tidak dicatat dua kali.</p>' +
      '<div class="lynk-url"><i class="bi bi-link-45deg" aria-hidden="true"></i><span class="mono" title="Token disamarkan">' + esc(L.urlSamaran || 'URL muncul setelah Web App di-deploy') + '</span></div>' +
      '<ol class="langkah-lynk"><li>Di editor Apps Script jalankan <span class="kode-inline">tampilkanUrlWebhookLynk</span> lalu salin URL lengkap dari log — token rahasia hanya tampil di sana.</li><li>Dashboard Lynk.id → menu <b>Webhook</b> → tempel URL → simpan.</li><li>Petakan judul produk di bawah, lalu cek dengan <b>Simulasi</b>.</li></ol>' +
      '<p class="teks-2 kecil mt-2">' + (R.kirimUlang ? '<i class="bi bi-shield-check"></i> ' + R.kirimUlang + ' kiriman ulang diabaikan otomatis. ' : '') + (R.terakhir ? 'Order terakhir ' + fmtRelatif(R.terakhir) + '.' : 'Belum ada order masuk.') + '</p></div>' +
      '<div class="kartu"><div class="kartu-judul"><h2><span class="ikon-judul"><i class="bi bi-diagram-3"></i></span>Produk → kursus</h2><button type="button" class="btn btn-utama btn-sm" data-act="lynk-produk"><i class="bi bi-plus-lg"></i> Tambah</button></div>' +
      (L.produk.length ? '<div class="daftar-set">' + L.produk.map(p => '<div class="set-item"><div class="t" style="min-width:0"><b class="potong d-block">' + esc(p.judul_produk) + '</b><small>' + (p.tampil_paket === 'ya' ? '<span class="chip emas normal-case" style="height:20px">Paket hemat</span> ' : '') + (p.aktif === 'ya' ? 'Aktif' : 'Nonaktif') + (p.harga_min ? ' · min ' + rupiah(p.harga_min) : '') + (p.catatan ? ' · ' + esc(p.catatan) : '') + '</small><div class="mt-1">' + chipKursusHtml(p.id_kursus) + '</div></div>' +
        '<div class="d-flex"><button type="button" class="ikon-btn" data-act="lynk-produk" data-id="' + esc(p.id) + '" aria-label="Ubah pemetaan ' + esc(p.judul_produk) + '"><i class="bi bi-pencil"></i></button><button type="button" class="ikon-btn bahaya" data-act="lynk-hapus-produk" data-id="' + esc(p.id) + '" aria-label="Hapus pemetaan ' + esc(p.judul_produk) + '"><i class="bi bi-trash3"></i></button></div></div>').join('') + '</div>'
        : '<p class="teks-2 kecil">Belum ada pemetaan. Tanpa pemetaan, judul produk Lynk dicocokkan dengan judul kursus; bila tidak cocok, order masuk "Perlu tinjau".</p>') +
      '<form class="mt-3" data-kirim="lynk-simulasi" novalidate><b class="d-block mb-2">Simulasi order <span class="teks-2 kecil">(tidak menulis data)</span></b><div class="field"><label class="label" for="simJudul">Judul produk di Lynk</label><input class="input" id="simJudul" maxlength="200" placeholder="mis. Kelas UI/UX Mastery"></div>' +
      '<div class="field"><label class="label" for="simTotal">Total bayar (opsional)</label><input class="input" id="simTotal" type="number" min="0" step="1000" inputmode="numeric" placeholder="149000"></div><button type="submit" class="btn btn-garis btn-blok" id="btnSimulasi"><i class="bi bi-play"></i> Uji pencocokan</button><div id="hasilSimulasi" class="simulasi-hasil" aria-live="polite"></div></form></div>' +
      '</aside></div>';
  }
  function barisOrder() {
    const q = S.adm.cariLynk.toLowerCase(), st = S.adm.statusLynk;
    return lynkData().order.filter(o => (st === 'semua' || (st === 'tinjau' ? perluTinjau(o) : o.status === st)) &&
      (!q || (o.ref_id + ' ' + o.email + ' ' + o.nama + ' ' + o.produk + ' ' + o.telepon).toLowerCase().includes(q)));
  }
  function tabelOrderHtml() {
    const rows = barisOrder(), ada = lynkData().order.length;
    if (!rows.length) return kosongHtml('bi-inbox', ada ? 'Tidak ada order yang cocok' : 'Belum ada order', ada ? 'Ubah filter atau kata kunci pencarian.' : 'Order Lynk yang sudah dibayar akan muncul di sini dan langsung membuka akses kursus.');
    return '<div class="tabel-wrap"><table class="tabel kartu-mobile"><thead><tr><th>Order</th><th>Pembeli</th><th>Produk → kursus</th><th>Total</th><th>Status</th><th><span class="sr">Aksi</span></th></tr></thead><tbody>' +
      rows.slice(0, S.adm.batas).map(o => {
        const [kls, lbl] = LABEL_LYNK[o.status] || ['netral', o.status || '—'];
        return '<tr><td class="utama"><div style="min-width:0"><b class="mono">#' + esc(o.ref_id) + '</b><small class="order-meta"><span>' + fmtRelatif(o.diterima) + '</span>' + (o.kirim_ulang ? '<span><i class="bi bi-arrow-repeat"></i> dikirim ulang ' + o.kirim_ulang + '×</span>' : '') + '</small></div></td>' +
          '<td data-label="Pembeli"><div class="sel"><b>' + esc(o.nama || '—') + '</b><small class="d-block teks-2">' + esc(o.email || 'email kosong') + '</small></div></td>' +
          '<td data-label="Produk"><div class="sel"><span class="kecil">' + esc(o.produk || '—') + '</span>' + (o.id_kursus.length ? '<div class="mt-1">' + chipKursusHtml(o.id_kursus) + '</div>' : '') + (o.catatan ? '<small class="d-block teks-2 mt-1">' + esc(o.catatan) + '</small>' : '') + '</div></td>' +
          '<td data-label="Total" class="nowrap">' + rupiah(o.total) + '</td>' +
          '<td data-label="Status"><span class="chip ' + kls + ' normal-case">' + esc(lbl) + '</span></td>' +
          '<td data-label="Aksi">' + (perluTinjau(o) || o.payload ? '<div class="d-flex gap-1 flex-wrap justify-content-end align-items-center">' + (perluTinjau(o) ? '<button type="button" class="btn btn-utama btn-sm" data-act="lynk-proses" data-ref="' + esc(o.ref_id) + '">Proses</button><button type="button" class="btn btn-teks btn-sm" data-act="lynk-abaikan" data-ref="' + esc(o.ref_id) + '">Abaikan</button>' : '') +
          (o.payload ? '<button type="button" class="ikon-btn" data-act="lynk-payload" data-ref="' + esc(o.ref_id) + '" aria-label="Lihat payload order ' + esc(o.ref_id) + '" title="Lihat data mentah"><i class="bi bi-code-slash"></i></button>' : '') + '</div>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (rows.length > S.adm.batas ? '<div class="text-center mt-3"><button type="button" class="btn btn-ghost" data-act="lebih-banyak">Tampilkan lebih banyak</button></div>' : '');
  }
  const segarTabelLynk = () => { const t = $('#tabelLynk'); if (t) t.innerHTML = tabelOrderHtml(); };
  function pilihKursusHtml(id, dipilih) {
    return '<div class="chip-pilih" id="' + id + '">' + S.data.kursus.map(k => '<button type="button" data-act="toggle-pilih" data-id="' + esc(k.id_kursus) + '" aria-pressed="' + (dipilih || []).includes(k.id_kursus) + '">' + esc(k.judul) + (k.status_terbit !== 'terbit' ? ' (draf)' : '') + '</button>').join('') + '</div>';
  }
  const tutupX = '<button type="button" class="ikon-btn" data-act="tutup-modal" aria-label="Tutup"><i class="bi bi-x-lg"></i></button>';
  function modalProdukLynk(el) {
    const p = el && el.dataset.id ? lynkData().produk.find(x => x.id === el.dataset.id) : null;
    bukaModal('<form data-kirim="lynk-produk" data-id="' + esc(p ? p.id : '') + '" novalidate><div class="modal-kepala"><div class="judul-wrap"><h2 id="modalJudul">' + (p ? 'Ubah pemetaan produk' : 'Pemetaan produk baru') + '</h2><p>Tulis judul produk persis seperti di Lynk (huruf besar/kecil & tanda baca diabaikan). Pilih beberapa kursus untuk produk paket/bundle.</p></div>' + tutupX + '</div>' +
      '<div class="modal-isi"><div class="field"><label class="label" for="plJudul">Judul produk di Lynk</label><input class="input" id="plJudul" maxlength="200" value="' + esc(p ? p.judul_produk : '') + '" autofocus></div>' +
      '<div class="field"><span class="label">Kursus yang dibuka</span>' + pilihKursusHtml('plKursus', p ? p.id_kursus : []) + '</div>' +
      '<div class="row g-3"><div class="col-sm-6"><div class="field"><label class="label" for="plHarga">Harga minimal (opsional)</label><input class="input" id="plHarga" type="number" min="0" step="1000" inputmode="numeric" value="' + esc(p && p.harga_min ? p.harga_min : '') + '" placeholder="149000"><p class="bantuan">Total di bawah angka ini → "Perlu tinjau" (cegah kupon/harga salah).</p></div></div>' +
      '<div class="col-sm-6"><div class="field"><label class="label" for="plCatatan">Catatan</label><input class="input" id="plCatatan" maxlength="300" value="' + esc(p ? p.catatan : '') + '"></div></div></div>' +
      '<div class="kartu-paket-form"><label class="switch"><input type="checkbox" id="plPaket"' + (p && p.tampil_paket === 'ya' ? ' checked' : '') + '><span class="jalur"></span><span><b>Tampilkan sebagai Paket Hemat</b> di Beranda & menu Kursus member</span></label>' +
      '<p class="bantuan">Perlu minimal 2 kursus. Paket hanya tampil bagi member yang belum memiliki semua kursusnya.</p>' +
      '<div class="row g-3 mt-1"><div class="col-sm-6"><div class="field"><label class="label" for="plHargaTampil">Harga paket</label><input class="input" id="plHargaTampil" type="number" min="0" step="1000" inputmode="numeric" value="' + esc(p && p.harga_tampil ? p.harga_tampil : '') + '" placeholder="199000"></div></div>' +
      '<div class="col-sm-6"><div class="field"><label class="label" for="plHargaNormal">Harga normal (dicoret, opsional)</label><input class="input" id="plHargaNormal" type="number" min="0" step="1000" inputmode="numeric" value="' + esc(p && p.harga_normal ? p.harga_normal : '') + '" placeholder="349000"></div></div></div>' +
      '<div class="field"><label class="label" for="plUrlBeli">Link beli paket di Lynk</label><input class="input" id="plUrlBeli" type="url" inputmode="url" value="' + esc(p ? p.url_beli : '') + '" placeholder="https://lynk.id/akun-anda/paket"></div>' +
      '<div class="field mb-0"><label class="label" for="plDesk">Keterangan singkat (opsional)</label><input class="input" id="plDesk" maxlength="300" value="' + esc(p ? p.deskripsi : '') + '"></div></div>' +
      '<label class="switch mt-3"><input type="checkbox" id="plAktif"' + (!p || p.aktif === 'ya' ? ' checked' : '') + '><span class="jalur"></span><span>Pemetaan aktif</span></label><p class="galat-field" id="plGalat"></p></div>' +
      '<div class="modal-kaki"><span class="catatan"><i class="bi bi-table"></i><span>Sheet: <span class="mono">ProdukLynk</span></span></span><button type="button" class="btn btn-garis" data-act="tutup-modal">Batal</button><button type="submit" class="btn btn-utama" id="plSimpan">Simpan</button></div></form>');
  }
  async function simpanProdukLynkForm(form) {
    const data = { id: form.dataset.id || '', judul_produk: $('#plJudul').value.trim(), id_kursus: $$('#plKursus [aria-pressed="true"]').map(b => b.dataset.id), harga_min: $('#plHarga').value, catatan: $('#plCatatan').value.trim(), aktif: $('#plAktif').checked ? 'ya' : 'tidak',
      tampil_paket: $('#plPaket').checked ? 'ya' : 'tidak', harga_tampil: $('#plHargaTampil').value, harga_normal: $('#plHargaNormal').value, url_beli: $('#plUrlBeli').value.trim(), deskripsi: $('#plDesk').value.trim() };
    const g = $('#plGalat'); g.textContent = '';
    if (data.judul_produk.length < 2) { g.textContent = 'Isi judul produk persis seperti di Lynk.'; return; }
    if (!data.id_kursus.length) { g.textContent = 'Pilih minimal satu kursus.'; return; }
    if (data.tampil_paket === 'ya' && data.id_kursus.length < 2) { g.textContent = 'Paket hemat perlu minimal 2 kursus.'; return; }
    if (data.tampil_paket === 'ya' && !Number(data.harga_tampil)) { g.textContent = 'Isi harga paket agar tampil sebagai Paket Hemat.'; return; }
    if (data.url_beli && !urlValid(data.url_beli)) { g.textContent = 'Link beli paket harus diawali https://'; return; }
    const btn = $('#plSimpan'); setTombol(btn, true, 'Menyimpan…');
    try {
      const p = await server('simpanProdukLynk', S.token, data);
      const L = lynkData(), i = L.produk.findIndex(x => x.id === p.id);
      if (i > -1) L.produk[i] = p; else L.produk.push(p);
      tutupModal(true); render('member'); simpanSnapshot();
      toast('Pemetaan "' + p.judul_produk + '" disimpan.', 'sukses');
    } catch (e) { g.textContent = e.message; }
    finally { setTombol(btn, false); }
  }
  async function hapusProdukLynkAksi(el) {
    const L = lynkData(), p = L.produk.find(x => x.id === el.dataset.id); if (!p) return;
    if (!(await konfirmasi({ judul: 'Hapus pemetaan?', pesan: 'Order "' + p.judul_produk + '" berikutnya akan dicocokkan dengan judul kursus, atau masuk "Perlu tinjau".', ya: 'Hapus', bahaya: true }))) return;
    const i = L.produk.indexOf(p); L.produk.splice(i, 1); render('member');
    try { await server('hapusProdukLynk', S.token, p.id); simpanSnapshot(); toast('Pemetaan dihapus.', 'sukses'); }
    catch (e) { L.produk.splice(i, 0, p); render('member'); toast(e.message, 'galat'); }
  }
  function modalProsesOrder(el) {
    const o = lynkData().order.find(x => x.ref_id === el.dataset.ref); if (!o) return;
    bukaModal('<form data-kirim="lynk-proses" data-ref="' + esc(o.ref_id) + '" novalidate><div class="modal-kepala"><div class="judul-wrap"><h2 id="modalJudul">Proses order #' + esc(o.ref_id) + '</h2><p>' + esc(o.produk || 'Produk tidak terbaca') + ' · ' + rupiah(o.total) + (o.nama ? ' · ' + esc(o.nama) : '') + '</p></div>' + tutupX + '</div>' +
      '<div class="modal-isi">' + (o.catatan ? '<p class="kecil teks-2 mb-3"><i class="bi bi-info-circle"></i> ' + esc(o.catatan) + '</p>' : '') +
      '<div class="field"><label class="label" for="poEmail">Email pembeli</label><input class="input" type="email" id="poEmail" value="' + esc(o.email) + '" autofocus></div>' +
      '<div class="field"><span class="label">Kursus yang dibuka</span>' + pilihKursusHtml('poKursus', o.id_kursus) + '</div>' +
      (o.produk ? '<label class="switch"><input type="checkbox" id="poPeta" checked><span class="jalur"></span><span>Simpan sebagai pemetaan agar order "' + esc(o.produk) + '" berikutnya otomatis</span></label>' : '') + '<p class="galat-field" id="poGalat"></p></div>' +
      '<div class="modal-kaki"><span class="catatan"></span><button type="button" class="btn btn-garis" data-act="tutup-modal">Batal</button><button type="submit" class="btn btn-utama" id="poSimpan"><i class="bi bi-unlock"></i> Buka akses</button></div></form>');
  }
  async function prosesOrderForm(form) {
    const ref = form.dataset.ref, o = lynkData().order.find(x => x.ref_id === ref);
    const email = $('#poEmail').value.trim().toLowerCase(), ids = $$('#poKursus [aria-pressed="true"]').map(b => b.dataset.id), g = $('#poGalat');
    g.textContent = '';
    if (!emailValid(email)) { g.textContent = 'Email pembeli tidak valid.'; return; }
    if (!ids.length) { g.textContent = 'Pilih minimal satu kursus.'; return; }
    const btn = $('#poSimpan'); setTombol(btn, true, 'Membuka akses…');
    try {
      const r = await server('prosesOrderLynk', S.token, ref, { email, id_kursus: ids, simpanPemetaan: !!($('#poPeta') && $('#poPeta').checked), judulProduk: o ? o.produk : '' });
      terapkanLynk(r.lynk); S.data.akses = r.akses; S.data.pengguna = r.pengguna; bangunIndeks();
      tutupModal(true); tandaiKotor(); render('member'); simpanSnapshot();
      toast('Akses dibuka untuk ' + email + '.', 'sukses');
    } catch (e) { g.textContent = e.message; }
    finally { setTombol(btn, false); }
  }
  async function abaikanOrderAksi(el) {
    const ref = el.dataset.ref;
    if (!(await konfirmasi({ judul: 'Abaikan order #' + ref + '?', pesan: 'Order ditandai "Diabaikan" tanpa membuka akses — cocok untuk order uji, refund, atau produk di luar EduTrack.', ya: 'Abaikan', bahaya: true }))) return;
    const o = lynkData().order.find(x => x.ref_id === ref), lama = o && o.status;
    if (o) { o.status = 'diabaikan'; render('member'); } // optimistic: tabel + lencana langsung berubah
    try { const r = await server('abaikanOrderLynk', S.token, ref); terapkanLynk(r.lynk); render('member'); simpanSnapshot(); toast('Order #' + ref + ' diabaikan.', 'sukses'); }
    catch (e) { if (o) o.status = lama; render('member'); toast(e.message, 'galat'); }
  }
  function modalPayload(el) {
    const o = lynkData().order.find(x => x.ref_id === el.dataset.ref); if (!o) return;
    let isi = o.payload; try { isi = JSON.stringify(JSON.parse(o.payload), null, 2); } catch (e) { }
    bukaModal('<div class="modal-kepala"><div class="judul-wrap"><h2 id="modalJudul">Data mentah order #' + esc(o.ref_id) + '</h2><p>Disimpan hanya untuk order yang perlu ditinjau, maksimal 4.000 karakter.</p></div>' + tutupX + '</div>' +
      '<div class="modal-isi"><pre class="payload-pre">' + esc(isi) + '</pre></div>' +
      '<div class="modal-kaki"><span class="catatan"></span><button type="button" class="btn btn-garis" data-act="salin" data-teks="' + esc(o.payload) + '"><i class="bi bi-clipboard"></i> Salin</button><button type="button" class="btn btn-utama" data-act="tutup-modal">Tutup</button></div>');
  }
  async function simulasiForm() {
    const judul = $('#simJudul').value.trim(), out = $('#hasilSimulasi');
    if (judul.length < 2) { out.innerHTML = '<p class="galat-field">Isi judul produk seperti di Lynk.</p>'; return; }
    const btn = $('#btnSimulasi'); setTombol(btn, true, 'Menguji…');
    try {
      const r = await server('simulasiLynk', S.token, { judul, total: $('#simTotal').value });
      const [kls, lbl] = LABEL_LYNK[r.status] || ['netral', r.status];
      out.innerHTML = '<div class="d-flex gap-2 align-items-start flex-wrap"><span class="chip ' + kls + ' normal-case">' + esc(lbl) + '</span>' + (r.ids && r.ids.length ? chipKursusHtml(r.ids) : '<span class="teks-2 kecil">tidak ada kursus yang cocok</span>') + '</div>' + (r.catatan ? '<p class="kecil teks-2 mt-2">' + esc(r.catatan) + '</p>' : '');
    } catch (e) { out.innerHTML = '<p class="galat-field">' + esc(e.message) + '</p>'; }
    finally { setTombol(btn, false); }
  }
  async function ubahLynkAktif(el) {
    const L = lynkData(), lama = !!L.aktif, lbl = el.parentElement.querySelector('.kecil');
    L.aktif = el.checked; if (lbl) lbl.textContent = el.checked ? 'Aktif' : 'Nonaktif';
    const nomor = (S.lynkAktifNo = (S.lynkAktifNo || 0) + 1);
    S.lynkAktifTunda = el.checked;
    try {
      const r = await server('aturLynk', S.token, { aktif: el.checked });
      if (nomor === S.lynkAktifNo) S.lynkAktifTunda = undefined;
      lynkData().aktif = r.aktif; simpanSnapshot();
      toast(r.aktif ? 'Webhook Lynk aktif.' : 'Webhook Lynk dinonaktifkan — order baru tidak diproses sampai diaktifkan lagi.', r.aktif ? 'sukses' : 'peringatan');
    } catch (e) {
      if (nomor === S.lynkAktifNo) S.lynkAktifTunda = undefined;
      lynkData().aktif = lama; el.checked = lama; if (lbl) lbl.textContent = lama ? 'Aktif' : 'Nonaktif'; toast(e.message, 'galat');
    }
  }

  const VIEWS = { beranda: renderBeranda, kursus: renderKursus, belajar: renderBelajar, editor: renderEditor, member: renderMember, progres: renderProgres, pesan: renderPesan, profil: renderProfil, pengaturan: renderPengaturan };
  const AKSI = {
    'nav': el => { let p = {}; try { p = el.dataset.param ? JSON.parse(el.dataset.param) : {}; } catch (e) { } go(el.dataset.to, p); },
    'kembali': kembali,
    'keluar': keluar,
    'tema': () => { const gelap = document.documentElement.getAttribute('data-theme') === 'dark'; terapkanTema(gelap ? 'terang' : 'gelap'); },
    'set-tema': el => { terapkanTema(el.dataset.v); },
    'lonceng': bukaNotif,
    'filter': bukaFilter,
    'pilih-kat': el => { S.filter.kategori = el.dataset.v; $$('#popFilter [data-act="pilih-kat"]').forEach(b => b.setAttribute('aria-pressed', b === el)); tandaiKotor('kursus'); $('[data-act="filter"]').classList.toggle('aktif', !!S.filter.kategori); },
    'buka-cari': () => { const w = $('#cariWrap'); w.classList.add('terbuka-mobile'); $('#inCari').focus(); },
    'hasil': bukaHasil,
    'hapus-cari': () => { S.filter.cari = ''; $('#inCari').value = ''; render('kursus'); },
    'tutup-modal': () => tutupModal(),
    'tutup-banner': el => { el.closest('.banner-sync').remove(); },
    'tampil-darurat': () => { langkahMasuk(3); setTimeout(() => $('#inDPass').focus(), 50); },
    'masuk-kembali': () => { langkahMasuk(1); $('#inEmail').focus(); },
    'kirim-ulang': () => kirimKode(),
    'segarkan': () => segarkan(false),
    'salin': el => salin(el.dataset.teks),
    'gulir': el => { const g = document.getElementById(el.dataset.target); if (g) g.scrollBy({ left: Number(el.dataset.arah) * g.clientWidth * .8, behavior: 'smooth' }); },
    'lanjutkan': () => { const t = lanjutkanTarget(); if (t) go('belajar', { id: t.k.id_kursus }); else go('kursus'); },
    'buka-kursus': el => go('belajar', { id: el.dataset.id }),
    'buka-modul': el => { if (!el.dataset.id) return; const m = I.modul.get(el.dataset.id); if (!m) return; if (statusModul(m) === 'terkunci') { toast('Modul terkunci. Selesaikan modul sebelumnya terlebih dahulu.', 'peringatan'); return; } go('belajar', { id: m.id_kursus, modul: m.id_modul, pratinjau: S.belajar.pratinjau || undefined }); },
    'putar-video': () => { S.belajar.putar = S.belajar.idModul; const k = I.kursus.get(S.belajar.idKursus); const { list, m } = modulAktifBelajar(); $('#blPlayer').innerHTML = playerHtml(k, m, list); },
    'tandai-selesai': el => tandaiSelesai(el.dataset.id),
    'tab-belajar': el => { S.belajar.tab = el.dataset.v; const m = I.modul.get(S.belajar.idModul); if (m) $('#blTab').innerHTML = tabBelajarHtml(m); },
    'unduh': unduh,
    'pratinjau-pdf': pratinjauPdf,
    'grafik-periode': el => { S.grafik.periode = el.dataset.v; tandaiKotor('beranda', 'progres'); render(S.rute); },
    'grafik-jenis': el => { S.grafik.jenis = el.dataset.v; tandaiKotor('beranda', 'progres'); render(S.rute); },
    'filter-status': el => { S.filter.status = el.dataset.v; render('kursus'); },
    'editor': el => go('editor', { id: el.dataset.id }),
    'pratinjau-siswa': el => go('belajar', { id: el.dataset.id, pratinjau: true }),
    'buat-kursus': modalKursusBaru,
    'simpan-kursus': () => simpanKursus(true),
    'ganti-sampul': () => $('#fileSampul').click(),
    'hapus-kursus': el => hapusKursus(el.dataset.id),
    'tambah-modul': () => bukaModalModul(null),
    'edit-modul': el => bukaModalModul(el.dataset.id),
    'hapus-modul': el => hapusModul(el.dataset.id),
    'geser-modul': el => { const list = semuaModul(S.editor.idKursus); const i = list.findIndex(m => m.id_modul === el.dataset.id); pindahModul(el.dataset.id, i + Number(el.dataset.arah)); },
    'mode-urut': el => { S.editor.modeUrut = !S.editor.modeUrut; el.setAttribute('aria-pressed', S.editor.modeUrut); if (S.editor.modeUrut && S.editor.tipe !== 'semua') S.editor.tipe = 'semua'; renderDaftarModul(); },
    'filter-tipe': el => { S.editor.tipe = el.dataset.v; renderDaftarModul(); },
    'modul-tipe': el => {
      if (!MF || MF.tipe === el.dataset.v) return;
      const fileT = t => t === 'dokumen' || t === 'zip', lama = MF.tipe, baru = el.dataset.v;
      const kosongkan = () => { if (MF.unggah.utama) MF.unggah.utama.dibatalkan = true; MF.unggah.utama = null; MF.sumber = ''; MF.nama_berkas = ''; MF.ukuran_berkas = 0; };
      if (fileT(lama) !== fileT(baru)) kosongkan(); // pindah antara berkas ↔ URL
      else if (fileT(baru) && MF.nama_berkas && (kelasBerkas(MF.nama_berkas) === 'zip') !== (baru === 'zip')) kosongkan();
      MF.tipe = baru; MF.yt = null;
      $$('[data-act="modul-tipe"]').forEach(b => b.setAttribute('aria-pressed', b === el));
      renderBagianTipe(); perbaruiTombolMF();
      if (baru === 'video' && MF.sumber) validasiYt();
    },
    'mf-status': el => { if (!MF) return; MF.status = el.dataset.v; $$('[data-act="mf-status"]').forEach(b => b.setAttribute('aria-pressed', b === el)); },
    'hapus-lampiran': el => { if (!MF) return; MF.lampiran.splice(Number(el.dataset.idx), 1); renderLampiranMF(); },
    'batal-unggah': el => { if (!MF) return; const u = el.dataset.jenis === 'utama' ? MF.unggah.utama : MF.unggah.lampiran[Number(el.dataset.idx)]; if (u) { u.dibatalkan = true; u.galat = u.galat || 'Dibatalkan'; } if (el.dataset.jenis === 'utama') { MF.unggah.utama = null; renderBagianTipe(); } else { MF.unggah.lampiran.splice(Number(el.dataset.idx), 1); renderLampiranMF(); } perbaruiTombolMF(); },
    'tab-member': el => { S.adm.tabMember = el.dataset.v; S.adm.batas = 100; render('member'); },
    'tambah-akses': modalTambahAkses,
    'toggle-pilih': el => el.setAttribute('aria-pressed', el.getAttribute('aria-pressed') !== 'true'),
    'hapus-akses': hapusAksesAksi,
    'edit-catatan': modalCatatan,
    'tambah-pengguna': modalPengguna,
    'cabut-sesi': async el => { if (!(await konfirmasi({ judul: 'Cabut semua sesi?', pesan: el.dataset.email + ' harus masuk ulang di semua perangkat.', ya: 'Cabut sesi', bahaya: true }))) return; try { await server('cabutSesiPengguna', S.token, el.dataset.email); toast('Sesi dicabut.', 'sukses'); } catch (e) { toast(e.message, 'galat'); } },
    'lebih-banyak': () => { S.adm.batas += 100; render(S.rute); },
    'csv-akses': () => { const rows = barisAkses(); simpanBlob(new Blob([csv([['email', 'nama', 'id_kursus', 'kursus', 'tanggal_beli', 'status_aktif', 'catatan']].concat(rows.map(a => [a.email, (I.pengguna.get(a.email) || {}).nama || '', a.id_kursus, (I.kursus.get(a.id_kursus) || {}).judul || '', String(a.tanggal_beli || '').slice(0, 10), a.status_aktif, a.catatan])))], { type: 'text/csv;charset=utf-8' }), 'akses-member-' + hariKey(new Date()) + '.csv'); },
    'csv-progres': () => { const rows = barisProgresAdmin(); simpanBlob(new Blob([csv([['email', 'nama', 'kursus', 'modul_selesai', 'total_modul', 'progres_persen', 'terakhir_aktif', 'status']].concat(rows.map(r => [r.a.email, r.nama, r.k.judul, r.n, r.t, r.pct, r.last ? new Date(r.last).toISOString() : '', LABEL_STATUS[r.status][1]])))], { type: 'text/csv;charset=utf-8' }), 'progres-member-' + hariKey(new Date()) + '.csv'); toast(rows.length + ' baris diekspor.', 'sukses'); },
    'pdf-progres': async el => { setTombol(el, true, 'Menyusun PDF…'); try { const r = await server('buatLaporanPdf', S.token, S.adm.kursusProgres); simpanBlob(new Blob([b64KeBytes(r.data)], { type: r.mime }), r.nama); toast('Laporan PDF siap.', 'sukses'); } catch (e) { toast(e.message, 'galat'); } finally { setTombol(el, false); } },
    'hapus-pengumuman': async el => { const p = S.data.pengumuman.find(x => x.id === el.dataset.id); if (!p || !(await konfirmasi({ judul: 'Hapus pengumuman?', pesan: '"' + p.judul + '" akan hilang dari portal member.', ya: 'Hapus', bahaya: true }))) return; const i = S.data.pengumuman.indexOf(p); S.data.pengumuman.splice(i, 1); render('pesan'); try { await server('hapusPengumuman', S.token, p.id); simpanSnapshot(); } catch (e) { S.data.pengumuman.splice(i, 0, p); render('pesan'); toast(e.message, 'galat'); } },
    'hapus-lokal': async () => { if (!(await konfirmasi({ judul: 'Bersihkan data offline?', pesan: 'Snapshot data dan catatan pribadi di perangkat ini dihapus. Progres yang belum tersinkron tetap disimpan.', ya: 'Bersihkan', bahaya: true }))) return; const simpan = { sesi: LS.get('sesi', null), outbox: LS.get(kunciOutbox(), []), tema: temaPilihan() }; try { Object.keys(localStorage).filter(k => k.indexOf('et_') === 0).forEach(k => localStorage.removeItem(k)); } catch (e) { } if (simpan.sesi) LS.set('sesi', simpan.sesi); LS.set(kunciOutbox(), simpan.outbox); terapkanTema(simpan.tema); toast('Data offline dibersihkan.', 'sukses'); },
    'segarkan-server': async el => { setTombol(el, true, 'Menyegarkan…'); try { await server('segarkanCacheServer', S.token); await segarkan(true); toast('Cache server dikosongkan & data dimuat ulang.', 'sukses'); } catch (e) { toast(e.message, 'galat'); } finally { setTombol(el, false); } },
    'migrasi-pindai': migrasiPindai,
    'migrasi-jalan': migrasiJalan,
    'lynk-produk': modalProdukLynk,
    'lynk-hapus-produk': hapusProdukLynkAksi,
    'lynk-proses': modalProsesOrder,
    'lynk-abaikan': abaikanOrderAksi,
    'lynk-payload': modalPayload,
    'kuras-antrean': async el => { setTombol(el, true, 'Mengirim…'); try { const r = await server('kurasAntrean'); toast(r && r.diproses ? r.diproses + ' notifikasi diproses.' : 'Antrean email kosong.', 'sukses'); } catch (e) { toast(e.message, 'galat'); } finally { setTombol(el, false); } },
    'keluar-semua': async () => { if (!(await konfirmasi({ judul: 'Keluar dari semua perangkat?', pesan: 'Semua sesi akun ini dicabut, termasuk perangkat ini.', ya: 'Keluar semua', bahaya: true }))) return; try { await server('keluarSemuaPerangkat', S.token); } catch (e) { } hapusSesiLokal(); LS.del(kunciSnap()); S.token = null; tampilMasuk(); toast('Semua sesi telah dicabut.', 'sukses'); }
  };
  const UBAH = {
    'filter-kategori': el => { S.filter.kategori = el.value; render('kursus'); },
    'kursus-akses': el => { S.adm.kursusAkses = el.value; S.adm.batas = 100; $('#isiMember').innerHTML = tabelAksesHtml(); },
    'status-akses': el => { S.adm.statusAkses = el.value; S.adm.batas = 100; $('#isiMember').innerHTML = tabelAksesHtml(); },
    'kursus-progres': el => { S.adm.kursusProgres = el.value; S.adm.batas = 100; render('progres'); },
    'status-progres': el => { S.adm.statusProgres = el.value; S.adm.batas = 100; render('progres'); },
    'status-akses-baris': ubahStatusAkses,
    'peran-pengguna': async el => { const lama = el.value === 'admin' ? 'member' : 'admin'; if (el.value === 'admin' && !(await konfirmasi({ judul: 'Jadikan admin?', pesan: el.dataset.email + ' akan bisa mengubah kursus, modul, dan akses member.', ya: 'Jadikan admin' }))) { el.value = lama; return; } const u = I.pengguna.get(el.dataset.email); simpanPengguna({ email: u.email, nama: u.nama, peran: el.value, status: u.status }, el, lama).catch(() => { }); },
    'status-pengguna': el => { const u = I.pengguna.get(el.dataset.email); const lbl = el.parentElement.querySelector('.kecil'); if (lbl) lbl.textContent = el.checked ? 'Aktif' : 'Nonaktif'; simpanPengguna({ email: u.email, nama: u.nama, peran: u.peran, status: el.checked ? 'aktif' : 'nonaktif' }, el, !el.checked).catch(() => { if (lbl) lbl.textContent = el.checked ? 'Aktif' : 'Nonaktif'; }); },
    'kursus-field': () => autosaveKursus(),
    'status-terbit': () => simpanKursus(false),
    'file-sampul': el => { if (el.files[0]) unggahSampul(el.files[0]); el.value = ''; },
    'file-utama': el => { pilihBerkasMF(el.files, 'utama'); el.value = ''; },
    'file-lampiran': el => { pilihBerkasMF(el.files, 'lampiran'); el.value = ''; },
    'mf': el => { if (MF) MF[el.dataset.f] = el.value; },
    'lynk-aktif': ubahLynkAktif,
    'status-lynk': el => { S.adm.statusLynk = el.value; S.adm.batas = 100; segarTabelLynk(); }
  };
  const KETIK = {
    'cari-akses': debounce(el => { S.adm.cariAkses = el.value; S.adm.batas = 100; const t = $('#tabelAkses'); if (t) { const wrap = document.createElement('div'); wrap.innerHTML = tabelAksesHtml(); t.replaceWith(wrap.querySelector('#tabelAkses')); } }, 200),
    'cari-progres': debounce(el => { S.adm.cariProgres = el.value; S.adm.batas = 100; const pos = el.selectionStart; render('progres'); const i = $('[data-ketik="cari-progres"]'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (e) { } } }, 250),
    'kursus-field': () => autosaveKursus(),
    'cari-lynk': debounce(el => { S.adm.cariLynk = el.value; S.adm.batas = 100; segarTabelLynk(); }, 150),
    'catatan': debounce(el => { LS.set('catatan_' + el.dataset.id, el.value); const s = $('#catatanStatus'); if (s) s.textContent = 'Tersimpan di perangkat ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }); }, 400),
    'hitung-email': el => { const e = pisahEmail(el.value); const salah = e.filter(x => !emailValid(x)).length; $('#akHitung').innerHTML = (e.length - salah) + ' email valid' + (salah ? ' · <span style="color:var(--bahaya-teks)">' + salah + ' tidak valid</span>' : ''); },
    'mf': el => { if (!MF) return; MF[el.dataset.f] = el.value; if (el.dataset.f === 'durasi_menit' && MF.tipe === 'video') pratinjauYt(); },
    'mf-url': el => { if (!MF) return; MF.sumber = el.value.trim(); el.classList.remove('galat'); if (MF.tipe === 'video') { pratinjauYt(); validasiYt(); } }
  };
  const KIRIM = {
    'modul': simpanModul, 'akses': simpanAkses, 'kursus-baru': buatKursus, 'pengumuman': kirimPengumuman, 'pengaturan': simpanPengaturanForm,
    'catatan-akses': simpanCatatanAkses,
    'auth': simpanAuthForm, 'lynk-produk': simpanProdukLynkForm, 'lynk-proses': prosesOrderForm, 'lynk-simulasi': simulasiForm,
    'pengguna': async () => { const email = $('#puEmail').value.trim().toLowerCase(), g = $('#puGalat'); if (!emailValid(email)) { g.textContent = 'Email tidak valid.'; return; } const btn = $('#puSimpan'); setTombol(btn, true, 'Menyimpan…'); try { await simpanPengguna({ email, nama: $('#puNama').value.trim(), peran: $('#puPeran').value, status: 'aktif' }); tutupModal(true); render('member'); } catch (e) { g.textContent = e.message; } finally { setTombol(btn, false); } },
    'profil': async () => { const nama = $('#inNama').value.trim(), g = $('#galatNama'); g.textContent = ''; if (nama.length < 2) { g.textContent = 'Nama minimal 2 karakter.'; return; } const lama = S.data.user.nama; S.data.user.nama = nama; perbaruiKepala(); try { await server('ubahProfil', S.token, { nama }); simpanSnapshot(); toast('Nama diperbarui.', 'sukses'); render('profil'); } catch (e) { S.data.user.nama = lama; perbaruiKepala(); g.textContent = e.message; } }
  };

  function pasangEvent() {
    document.addEventListener('click', e => {
      if (!e.target.closest('.popover, [data-act="lonceng"], [data-act="filter"], #inCari, [data-act="buka-cari"]')) tutupPopover();
      const el = e.target.closest('[data-act]');
      if (!el || el.disabled) return;
      const fn = AKSI[el.dataset.act];
      if (!fn) return;
      if (el.tagName === 'A') return; // tautan eksternal biasa
      e.preventDefault();
      Promise.resolve(fn(el, e)).catch(err => { console.error(err); toast(err.message || String(err), 'galat'); });
    });
    document.addEventListener('change', e => { const el = e.target.closest('[data-ubah]'); if (el && UBAH[el.dataset.ubah]) UBAH[el.dataset.ubah](el, e); });
    document.addEventListener('input', e => { const el = e.target.closest('[data-ketik]'); if (el && KETIK[el.dataset.ketik]) KETIK[el.dataset.ketik](el, e); });
    document.addEventListener('submit', e => {
      const f = e.target;
      if (f.id === 'formEmail') return kirimKode(e);
      if (f.id === 'formKode') return verifikasi(e);
      if (f.id === 'formDarurat') return masukDarurat(e);
      if (f.dataset.kirim && KIRIM[f.dataset.kirim]) { e.preventDefault(); KIRIM[f.dataset.kirim](f); }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { if (!$('#dialog').hidden) return; if (modalTerbuka()) { tutupModal(); return; } tutupPopover(); }
      if (e.key === 'Tab' && modalTerbuka() && $('#dialog').hidden) jebakFokus($('#modalKotak'), e);
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role="button"][data-act]')) { e.preventDefault(); e.target.click(); }
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !$('#aplikasi').hidden) { e.preventDefault(); $('#inCari').focus(); }
    });
    // Drag & drop berkas ke dropzone modal
    ['dragenter', 'dragover'].forEach(t => document.addEventListener(t, e => { const z = e.target.closest && e.target.closest('[data-drop]'); if (z && e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); z.classList.add('seret'); } }));
    ['dragleave', 'drop'].forEach(t => document.addEventListener(t, e => { const z = e.target.closest && e.target.closest('[data-drop]'); if (!z) return; z.classList.remove('seret'); if (t === 'drop' && e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); pilihBerkasMF(e.dataTransfer.files, z.dataset.drop); } }));
    pasangDnD();
    const inCari = $('#inCari');
    const cariDb = debounce(() => cari(inCari.value), 120);
    inCari.addEventListener('input', cariDb);
    inCari.addEventListener('focus', () => { if (inCari.value.trim().length >= 2) cari(inCari.value); });
    inCari.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); S.filter.cari = inCari.value.trim(); tutupPopover(); inCari.blur(); go('kursus'); render('kursus'); }
      if (e.key === 'ArrowDown') { const f = $('#cariHasil .hasil-item'); if (f) { e.preventDefault(); f.focus(); } }
    });
    pasangOtp();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !S.token) return;
      flushOutbox();
      if (Date.now() - S.muatTerakhir > 60000) segarkan(true);
    });
    window.addEventListener('online', () => { flushOutbox(); toast('Kembali online. Menyinkronkan…', 'info'); });
    window.addEventListener('offline', () => toast('Anda offline. Progres tetap disimpan di perangkat.', 'peringatan'));
    if (window.matchMedia) { try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (temaPilihan() === 'sistem') terapkanTema('sistem'); }); } catch (e) { } }
    window.addEventListener('beforeunload', e => { if (MF && adaUnggahAktif()) { e.preventDefault(); e.returnValue = ''; } });
  }

  // Ekspos minimal untuk debugging di konsol (tanpa data rahasia)
  window.EduTrack = { versi: VERSI_FE, go: (r, p) => go(r, p), segarkan: () => segarkan(false), state: () => ({ rute: S.rute, outbox: S.outbox.slice() }), latensi: () => Object.assign({}, TELEMETRI) };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
