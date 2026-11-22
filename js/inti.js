/* inti.js — utilitas dasar E-Agenda: template aman (anti-XSS), format id-ID, ikon SVG, IndexedDB, panggilan API
   (fetch text/plain anti-preflight, dedup in-flight, batcher, ulang otomatis dengan rid idempoten, unggah ber-progres). */
(function (w) {
  'use strict';
  const EA = w.EA = w.EA || {};
  const TZ = 'Asia/Jakarta';
  EA.TZ = TZ;

  /* ---------- Template aman ---------- */
  class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
  const PETA = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => PETA[c]);
  const isi = (v) => (v == null || v === false ? '' : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(isi).join('') : esc(v));
  EA.h = (str, ...vals) => new Raw(str.reduce((a, s, i) => a + s + (i < vals.length ? isi(vals[i]) : ''), ''));
  EA.raw = (s) => new Raw(String(s == null ? '' : s));
  EA.esc = esc;
  EA.html = (el, tpl) => { el.innerHTML = tpl instanceof Raw ? tpl.s : esc(tpl); return el; };

  /* ---------- Peristiwa ---------- */
  const pendengar = {};
  EA.on = (ev, fn) => { (pendengar[ev] = pendengar[ev] || []).push(fn); return () => { pendengar[ev] = pendengar[ev].filter((f) => f !== fn); }; };
  EA.emit = (ev, data) => (pendengar[ev] || []).slice().forEach((f) => { try { f(data); } catch (e) { console.error(e); } });

  /* ---------- Utilitas ---------- */
  EA.$ = (s, r) => (r || document).querySelector(s);
  EA.$$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  EA.uid = () => (w.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  EA.tidur = (ms) => new Promise((r) => setTimeout(r, ms));
  EA.debounce = (fn, ms) => { let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; };
  EA.norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  EA.normKunci = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  EA.pad = (n, w2) => String(n).padStart(w2, '0');
  /** Inisial avatar: gelar depan (Dr., H., Hj., Drs., Ir., Prof.) & gelar belakang (setelah koma) diabaikan. */
  EA.inisial = (nama) => {
    const kata = String(nama || '').split(',')[0].split(/\s+/).filter((x) => x && /[A-Za-z]/.test(x[0]) && !/^(dr|drs|dra|h|hj|ir|prof|kh|ny|tn|r|rr|st)\.?$/i.test(x));
    if (!kata.length) return '?';
    return (kata[0][0] + (kata.length > 1 ? kata[kata.length - 1][0] : '')).toUpperCase();
  };
  EA.ukuran = (b) => (b >= 1048576 ? (b / 1048576).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
  EA.salin = async (teks) => {
    try { await navigator.clipboard.writeText(teks); return true; } catch (e) {
      const ta = document.createElement('textarea'); ta.value = teks; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (x) { ok = false; } ta.remove(); return ok;
    }
  };

  /* ---------- Format angka & tanggal (id-ID) ---------- */
  const fAngka = new Intl.NumberFormat('id-ID');
  const fDes = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const fTglPendek = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const fTglPanjang = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const fTglBulan = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const fHari = new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
  const fJam = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
  const fIso = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
  const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  EA.BULAN = BULAN;
  EA.BLN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  EA.angka = (n) => fAngka.format(Number(n) || 0);
  EA.desimal = (n) => fDes.format(Number(n) || 0);
  EA.persen = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  const keTgl = (s) => new Date(String(s).slice(0, 10) + 'T12:00:00Z');
  const sahTgl = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').slice(0, 10));
  EA.tglPendek = (s) => (sahTgl(s) ? fTglPendek.format(keTgl(s)) : '-');
  EA.tglPanjang = (s) => (sahTgl(s) ? fTglPanjang.format(keTgl(s)) : '-');
  EA.tglBulan = (s) => (sahTgl(s) ? fTglBulan.format(keTgl(s)) : '-');
  EA.hariTgl = (d) => fHari.format(d || new Date());
  EA.jam = (ms) => (ms ? fJam.format(new Date(Number(ms))) : '-');
  EA.isoDariMs = (ms) => (ms ? fIso.format(new Date(Number(ms))) : '');
  EA.waktu = (ms) => (ms ? EA.tglPendek(EA.isoDariMs(ms)) + ' ' + EA.jam(ms) : '-');
  EA.hariIni = () => fIso.format(new Date());
  EA.tahunIni = () => Number(EA.hariIni().slice(0, 4));
  EA.bulanIni = () => EA.hariIni().slice(0, 7);
  EA.tambahHari = (s, n) => { const d = keTgl(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  EA.selisihHari = (a, b) => Math.round((keTgl(b) - keTgl(a)) / 86400000);
  EA.bulanSebelum = (ym) => { const [y, m] = ym.split('-').map(Number); return m === 1 ? (y - 1) + '-12' : y + '-' + EA.pad(m - 1, 2); };
  EA.namaBulan = (ym) => BULAN[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4);
  EA.hariDalamBulan = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
  EA.relatif = (ms) => {
    if (!ms) return '-';
    const d = (Date.now() - Number(ms)) / 1000;
    if (d < 60) return 'baru saja';
    if (d < 3600) return Math.floor(d / 60) + ' menit lalu';
    if (d < 86400) return Math.floor(d / 3600) + ' jam lalu';
    const hr = EA.selisihHari(EA.isoDariMs(ms), EA.hariIni());
    return hr === 1 ? 'kemarin ' + EA.jam(ms) : EA.waktu(ms);
  };
  const ROMAWI = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  /** Format nomor surat keluar (sama dengan server) — dipakai untuk pratinjau. */
  EA.formatNomor = (fmt, p) => String(fmt || '{NO:3}/{KLASIFIKASI}/{INSTANSI}/{BULAN_ROMAWI}/{TAHUN}').replace(/\{([A-Z_]+)(?::(\d+))?\}/g, (m, k, wd) => {
    switch (k) {
      case 'NO': return wd ? EA.pad(p.no, Number(wd)) : String(p.no);
      case 'KLASIFIKASI': return p.klas || '…';
      case 'INSTANSI': return p.instansi || '';
      case 'BULAN_ROMAWI': return ROMAWI[Number(String(p.tgl).slice(5, 7))] || '';
      case 'BULAN': return String(p.tgl).slice(5, 7);
      case 'TAHUN': return String(p.tgl).slice(0, 4);
      case 'BIDANG': return p.bidang || '';
      default: return m;
    }
  });
  /** FR-53 — 08xx → 628xx; '' bila tidak valid. */
  EA.normalWA = (no) => {
    let s = String(no || '').replace(/[^\d+]/g, '').replace(/^\+/, '');
    if (!s) return '';
    if (s[0] === '0') s = '62' + s.slice(1); else if (s[0] === '8') s = '62' + s;
    return /^62\d{8,13}$/.test(s) ? s : '';
  };

  /* ---------- Ikon (gaya garis 24px; sebagian berbasis Feather Icons, MIT) ---------- */
  const P = {
    dasbor: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    masuk: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    keluar: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/>',
    disposisi: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="m9 14 2 2 4-4"/>',
    arsip: '<path d="M21 8v13H3V8"/><rect x="1" y="3" width="22" height="5" rx="1"/><path d="M10 12h4"/>',
    laporan: '<path d="M18 20V10M12 20V4M6 20v-6"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
    pengguna: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    orang: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    wa: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
    gir: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    riwayat: '<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    cari: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
    lonceng: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    menu: '<path d="M3 12h18M3 6h18M3 18h18"/>',
    layar: '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
    kalender: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    tambah: '<path d="M12 5v14M5 12h14"/>',
    tambahL: '<circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    cek: '<path d="M20 6 9 17l-5-5"/>',
    cekL: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/>',
    lingkar: '<circle cx="12" cy="12" r="9"/>',
    bawah: '<path d="m6 9 6 6 6-6"/>',
    kanan: '<path d="m9 18 6-6-6-6"/>',
    kiri: '<path d="m15 18-6-6 6-6"/>',
    panahK: '<path d="M5 12h14M12 5l7 7-7 7"/>',
    mata: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    unggah: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
    unduh: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
    kamera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    berkas: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
    pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 15h1.5a1.5 1.5 0 0 0 0-3H8v6M14 12v6M17 12h-2v6M15 15h2"/>',
    cetak: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    salin: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    sampah: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>',
    pensil: '<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    putar: '<path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
    putarKiri: '<path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
    saring: '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
    gembok: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    awas: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    galat: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
    perisai: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    tautan: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>',
    pagar: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
    jam: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    jampasir: '<path d="M6 2h12M6 22h12M7 2v4a5 5 0 0 0 10 0V2M7 22v-4a5 5 0 0 1 10 0v4"/>',
    naik: '<path d="m23 6-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>',
    turun: '<path d="m23 18-9.5-9.5-5 5L1 6"/><path d="M17 18h6v-6"/>',
    petir: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
    klip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    gedung: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
    surat: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
    awan: '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>',
    awanOff: '<path d="M22.61 16.95A5 5 0 0 0 18 10h-1.26a8 8 0 0 0-7.05-6M5 5a8 8 0 0 0 4 15h9a5 5 0 0 0 1.7-.3"/><path d="m1 1 22 22"/>',
    batal: '<circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 14.14 14.14"/>',
    kunci: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
    hp: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
    buku: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    donat: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
    teruskan: '<path d="m15 14 5-5-5-5"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/>',
    kirim: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
    sekolah: '<path d="m22 10-10-6-10 6 10 6z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
    grup: '<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M16 3.13a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0-3-3.85"/>',
    toga: '<path d="m22 10-10-6-10 6 10 6 10-6v6"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
    alat: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/>',
    toa: '<path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14"/>',
    dompet: '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
    map: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    tandaTangan: '<path d="M3 17c3 0 4-7 6-7s1 7 3 7 3-4 4-4 1 2 2 2h3"/><path d="M3 21h18"/>',
    google: '<path d="M21.6 12.23c0-.68-.06-1.36-.18-2.02H12v3.83h5.4a4.6 4.6 0 0 1-2 3.03v2.5h3.24c1.9-1.75 2.96-4.33 2.96-7.34z" fill="#4285F4" stroke="none"/><path d="M12 22c2.7 0 4.98-.9 6.64-2.43l-3.24-2.5c-.9.6-2.05.95-3.4.95-2.6 0-4.82-1.76-5.6-4.12H3.06v2.58A10 10 0 0 0 12 22z" fill="#34A853" stroke="none"/><path d="M6.4 13.9a6 6 0 0 1 0-3.8V7.52H3.06a10 10 0 0 0 0 8.96z" fill="#FBBC05" stroke="none"/><path d="M12 5.98c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.94 5.52L6.4 10.1C7.18 7.74 9.4 5.98 12 5.98z" fill="#EA4335" stroke="none"/>'
  };
  EA.ikon = (n, kls, warna) => EA.raw('<svg class="ik ' + (kls || '') + '" viewBox="0 0 24 24" fill="none" stroke="' + (warna || 'currentColor') + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[n] || P.info) + '</svg>');

  /* ---------- IndexedDB (kunci–nilai) ---------- */
  EA.kv = (() => {
    let dbp = null;
    const buka = () => dbp || (dbp = new Promise((res, rej) => {
      try {
        const r = indexedDB.open('e-agenda', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    }));
    const tx = async (mode, fn) => {
      const db = await buka();
      return new Promise((res, rej) => {
        const t = db.transaction('kv', mode), q = fn(t.objectStore('kv'));
        t.oncomplete = () => res(q ? q.result : undefined);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      });
    };
    return {
      get: (k) => tx('readonly', (s) => s.get(k)).catch(() => undefined),
      set: (k, v) => tx('readwrite', (s) => s.put(v, k)).catch(() => undefined),
      del: (k) => tx('readwrite', (s) => s.delete(k)).catch(() => undefined),
      keys: () => tx('readonly', (s) => s.getAllKeys()).catch(() => []),
      bersihkan: () => tx('readwrite', (s) => s.clear()).catch(() => undefined)
    };
  })();

  /* ---------- Sesi ---------- */
  const KUNCI_SESI = 'ea_sesi';
  EA.sesi = (() => { try { const s = JSON.parse(localStorage.getItem(KUNCI_SESI) || 'null'); return s && s.exp > Date.now() ? s : null; } catch (e) { return null; } })();
  EA.simpanSesi = (s) => { EA.sesi = s; try { if (s) localStorage.setItem(KUNCI_SESI, JSON.stringify(s)); else localStorage.removeItem(KUNCI_SESI); } catch (e) { /* mode privat */ } };

  /* ---------- API ---------- */
  EA.GAS_URL = (w.APP_CONFIG && w.APP_CONFIG.GAS_URL) || '';
  EA.konfigSah = () => /^https:\/\/script\.google(usercontent)?\.com\/macros\/s\/[\w-]+\/exec/.test(EA.GAS_URL) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(EA.GAS_URL);
  function buatGalat(pesan, kode, data) { const e = new Error(pesan); e.kode = kode; if (data) e.data = data; return e; }
  function galatDari(res) {
    const e = buatGalat(res.message || 'Permintaan gagal.', res.code || 'GALAT', res.data);
    if (e.kode === 'SESI') EA.emit('sesi-habis', e);
    return e;
  }
  async function kirim(body, opsi) {
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), opsi.timeout || 60000);
    let r;
    try {
      r = await fetch(EA.GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ctrl.signal, credentials: 'omit', redirect: 'follow' });
    } catch (e) {
      throw buatGalat(e.name === 'AbortError' ? 'Server terlalu lama merespons. Coba lagi.' : 'Tidak dapat terhubung ke server. Periksa koneksi internet.', 'JARINGAN');
    } finally { clearTimeout(tm); }
    if (!r.ok) throw buatGalat('Server membalas HTTP ' + r.status + '.', 'JARINGAN');
    const teks = await r.text();
    try { return JSON.parse(teks); } catch (e) { throw buatGalat('Server membalas tidak valid. Pastikan URL berakhiran /exec dan akses deployment "Siapa saja".', 'KONFIG'); }
  }
  /** Panggil satu aksi. opsi: { tulis, publik, ulang, timeout, rid } */
  async function panggil(a, d, opsi) {
    opsi = opsi || {};
    if (!EA.konfigSah()) throw buatGalat('Konfigurasi belum lengkap: isi GAS_URL di js/config.js.', 'KONFIG');
    const body = { a, d: d || {} };
    if (!opsi.publik && EA.sesi) body.t = EA.sesi.token;
    if (opsi.tulis) body.rid = opsi.rid || EA.uid();
    const maks = opsi.ulang == null ? 2 : opsi.ulang;
    for (let coba = 0; ; coba++) {
      try {
        const res = await kirim(body, opsi);
        EA.emit('online', true);
        if (!res.success) throw galatDari(res);
        return res.data;
      } catch (e) {
        if (e.kode === 'JARINGAN') EA.emit('online', false);
        if (e.kode !== 'JARINGAN' || coba >= maks) throw e;
        await EA.tidur(700 * (coba + 1) * (coba + 1));
      }
    }
  }
  const inflight = new Map();
  let antri = [], terjadwal = false;
  async function kuras() {
    terjadwal = false;
    const q = antri; antri = [];
    if (!q.length) return;
    if (q.length === 1) { panggil(q[0].a, q[0].d).then(q[0].res, q[0].rej); return; }
    try {
      const hasil = await panggil('batch', { calls: q.map((c) => ({ a: c.a, d: c.d })) });
      hasil.forEach((r, i) => (r.success ? q[i].res(r.data) : q[i].rej(galatDari(r))));
    } catch (e) { q.forEach((c) => c.rej(e)); }
  }
  EA.api = {
    panggil,
    /** Aksi baca: digabung (batch) dalam satu tick & permintaan kembar menumpang promise yang sama. */
    baca(a, d) {
      const k = a + '|' + JSON.stringify(d || {});
      if (inflight.has(k)) return inflight.get(k);
      const p = new Promise((res, rej) => { antri.push({ a, d, res, rej }); if (!terjadwal) { terjadwal = true; setTimeout(kuras, 0); } });
      inflight.set(k, p);
      p.then(() => inflight.delete(k), () => inflight.delete(k));
      return p;
    },
    tulis: (a, d, opsi) => panggil(a, d, Object.assign({ tulis: true }, opsi || {})),
    publik: (a, d) => panggil(a, d, { publik: true }),
    /** Unggah ber-progres (XHR) dengan rid yang sama saat diulang. */
    unggah(a, d, onProg) {
      if (!EA.konfigSah()) return Promise.reject(buatGalat('Konfigurasi belum lengkap: isi GAS_URL di js/config.js.', 'KONFIG'));
      const body = JSON.stringify({ a, d, t: EA.sesi && EA.sesi.token, rid: EA.uid() });
      const sekali = () => new Promise((res, rej) => {
        const x = new XMLHttpRequest();
        x.open('POST', EA.GAS_URL);
        x.setRequestHeader('Content-Type', 'text/plain;charset=utf-8');
        x.timeout = 240000;
        x.upload.onprogress = (e) => { if (e.lengthComputable && onProg) onProg(Math.min(0.97, e.loaded / e.total)); };
        x.onload = () => {
          let r; try { r = JSON.parse(x.responseText); } catch (e) { rej(buatGalat('Server membalas tidak valid.', 'KONFIG')); return; }
          if (onProg) onProg(1);
          if (r.success) res(r.data); else rej(galatDari(r));
        };
        x.onerror = () => rej(buatGalat('Koneksi terputus saat mengunggah.', 'JARINGAN'));
        x.ontimeout = () => rej(buatGalat('Unggah terlalu lama. Coba lagi dengan koneksi lebih stabil.', 'JARINGAN'));
        x.send(body);
      });
      return sekali().catch((e) => (e.kode === 'JARINGAN' ? EA.tidur(1200).then(sekali) : Promise.reject(e)));
    },
    /** GET publik (verifikasi & info). */
    async get(param) {
      const u = EA.GAS_URL + (EA.GAS_URL.indexOf('?') > -1 ? '&' : '?') + new URLSearchParams(param).toString();
      const r = await fetch(u, { credentials: 'omit' });
      return r.json();
    }
  };

  /* ---------- Muat skrip/pustaka secara malas ---------- */
  const dimuat = {};
  EA.muatSkrip = (src) => dimuat[src] || (dimuat[src] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = res; s.onerror = () => { delete dimuat[src]; rej(new Error('Gagal memuat ' + src)); };
    document.head.appendChild(s);
  }));
  EA.berkasKeB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  EA.b64KeBlob = (b64, mime) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: mime }); };
  EA.unduhBlob = (blob, nama) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nama; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); };
})(window);
