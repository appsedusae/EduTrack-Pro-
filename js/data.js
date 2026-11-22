/* data.js — penyimpanan data lokal (memori + IndexedDB) & sinkronisasi delta dengan server.
   Semua menu & filter dihitung dari data lokal sehingga perpindahan halaman instan; server hanya mengirim yang berubah. */
(function (w) {
  'use strict';
  const EA = w.EA;
  const S = EA.S = { cfg: {}, vc: '', mst: { bidang: [], klasifikasi: [], direktori: [], stafPerBidang: {} }, vm: '', user: null, th: EA.tahunIni(), tahun: {}, meta: { antrean: 0, tahunList: [] }, rev: 0, sinkronTerakhir: 0, online: true, info: null };

  function wadah(th) {
    if (!S.tahun[th]) S.tahun[th] = { sm: new Map(), sk: new Map(), dsp: new Map(), v: {}, s: {}, sc: '', dimuat: false };
    return S.tahun[th];
  }

  /* ---------- Snapshot IndexedDB per pengguna ---------- */
  const kunciSnap = () => 'snap:' + (EA.sesi && EA.sesi.user ? EA.sesi.user.email : '-');
  const kemas = (map) => { const arr = Array.from(map.values()); if (!arr.length) return { h: [], r: [] }; const h = Object.keys(arr[0]); return { h, r: arr.map((o) => h.map((k) => o[k])) }; };
  const urai = (p) => { const m = new Map(); if (p && p.h) p.r.forEach((a) => { const o = {}; p.h.forEach((k, i) => { o[k] = a[i]; }); m.set(o.ID, o); }); return m; };
  let simpanT = null;
  function simpanSnapshot() {
    clearTimeout(simpanT);
    simpanT = setTimeout(() => {
      if (!EA.sesi) return;
      const tahun = {};
      Object.keys(S.tahun).forEach((th) => { const y = S.tahun[th]; if (y.dimuat) tahun[th] = { sm: kemas(y.sm), sk: kemas(y.sk), dsp: kemas(y.dsp), v: y.v, s: y.s, sc: y.sc }; });
      EA.kv.set(kunciSnap(), { cfg: S.cfg, vc: S.vc, mst: S.mst, vm: S.vm, user: S.user, meta: S.meta, tahun, t: S.sinkronTerakhir, versi: 1 });
    }, 900);
  }
  EA.data = {};
  EA.data.muatSnapshot = async () => {
    const s = await EA.kv.get(kunciSnap());
    if (!s || s.versi !== 1) return false;
    Object.assign(S, { cfg: s.cfg || {}, vc: s.vc || '', mst: s.mst || S.mst, vm: s.vm || '', user: s.user || null, meta: s.meta || S.meta, sinkronTerakhir: s.t || 0 });
    Object.keys(s.tahun || {}).forEach((th) => {
      const y = wadah(Number(th)), p = s.tahun[th];
      y.sm = urai(p.sm); y.sk = urai(p.sk); y.dsp = urai(p.dsp); y.v = p.v || {}; y.s = p.s || {}; y.sc = p.sc || ''; y.dimuat = true;
    });
    S.rev++;
    return !!S.user;
  };
  EA.data.hapusLokal = async () => { await EA.kv.bersihkan(); S.tahun = {}; S.cfg = {}; S.vc = ''; S.vm = ''; S.user = null; S.rev++; };

  /* ---------- Sinkron ---------- */
  const berjalan = {};
  function terapkan(r) {
    if (r.cfg) { S.cfg = r.cfg.d; S.vc = r.cfg.v; }
    if (r.mst) { S.mst = r.mst.d; S.vm = r.mst.v; }
    if (r.u) S.user = r.u;
    if (r.meta) S.meta = r.meta;
    const y = wadah(r.th);
    ['sm', 'sk', 'dsp'].forEach((j) => {
      const b = r[j];
      if (!b) return;
      if (b.penuh) y[j] = new Map();
      b.r.forEach((arr) => { const o = {}; b.h.forEach((k, i) => { o[k] = arr[i]; }); y[j].set(o.ID, o); });
      (b.del || []).forEach((id) => y[j].delete(id));
      y.v[j] = b.v; y.s[j] = r.t;
    });
    y.sc = r.sc; y.dimuat = true;
    S.sinkronTerakhir = Date.now();
    S.rev++;
  }
  /** Sinkron satu tahun. Panggilan bersamaan untuk tahun yang sama digabung. */
  EA.data.sinkron = (th, opsi) => {
    th = Number(th || S.th);
    if (berjalan[th]) return berjalan[th];
    const y = wadah(th);
    const d = { th, vc: S.vc, vm: S.vm, sc: y.sc, sm: { v: y.v.sm, s: y.s.sm }, sk: { v: y.v.sk, s: y.s.sk }, dsp: { v: y.v.dsp, s: y.s.dsp } };
    EA.emit('sinkron-mulai', th);
    const p = EA.api.baca('sinkron', d).then((r) => {
      const ada = !!(r.cfg || r.mst || r.sm || r.sk || r.dsp);
      terapkan(r);
      if (ada || (opsi && opsi.paksaEmit)) EA.emit('data', { th });
      EA.emit('sinkron-selesai', { th, ada });
      simpanSnapshot();
      return r;
    }).finally(() => { delete berjalan[th]; });
    berjalan[th] = p;
    return p;
  };
  /** Pastikan data tahun tersedia (memuat bila belum). */
  EA.data.pastikan = (th) => { const y = wadah(Number(th)); return y.dimuat ? Promise.resolve() : EA.data.sinkron(th); };
  EA.data.dimuat = (th) => wadah(Number(th)).dimuat;

  /** Gabungkan baris hasil aksi tulis agar UI langsung berubah tanpa menunggu sinkron. */
  EA.data.gabung = (jenis, rows) => {
    (Array.isArray(rows) ? rows : [rows]).filter(Boolean).forEach((o) => {
      const th = jenis === 'dsp' ? tahunId(o.IDSuratMasuk) : (Number(o.Tahun) || tahunId(o.ID));
      wadah(th)[jenis].set(o.ID, Object.assign({}, wadah(th)[jenis].get(o.ID) || {}, o));
    });
    S.rev++;
    EA.emit('data', { lokal: true });
    simpanSnapshot();
  };
  EA.data.setCfg = (cfg) => { S.cfg = Object.assign({}, S.cfg, cfg); S.rev++; EA.emit('data', { lokal: true }); simpanSnapshot(); };
  EA.data.ubahMaster = (fn) => { fn(S.mst); S.rev++; EA.emit('data', { lokal: true }); simpanSnapshot(); };

  /* ---------- Akses data turunan (memo per revisi) ---------- */
  const tahunId = (id) => { const m = String(id || '').match(/^(?:SM|SK|DSP)-(\d{4})-/); return m ? Number(m[1]) : S.th; };
  EA.data.tahunId = tahunId;
  const memo = {};
  function ingat(k, fn) { const m = memo[k]; if (m && m.rev === S.rev) return m.v; const v = fn(); memo[k] = { rev: S.rev, v }; return v; }
  EA.data.sm = (th) => ingat('sm' + th, () => Array.from(wadah(th).sm.values()).sort((a, b) => (a.TglTerima === b.TglTerima ? (b.NoAgenda > a.NoAgenda ? 1 : -1) : a.TglTerima < b.TglTerima ? 1 : -1)));
  EA.data.smAktif = (th) => ingat('sma' + th, () => EA.data.sm(th).filter((x) => !x.Dihapus));
  EA.data.sk = (th) => ingat('sk' + th, () => Array.from(wadah(th).sk.values()).sort((a, b) => (Number(b.NoUrut) || 0) - (Number(a.NoUrut) || 0)));
  EA.data.dsp = (th) => ingat('dsp' + th, () => Array.from(wadah(th).dsp.values()));
  EA.data.dspPerSm = (th) => ingat('dps' + th, () => {
    const m = new Map();
    EA.data.dsp(th).forEach((d) => { if (!m.has(d.IDSuratMasuk)) m.set(d.IDSuratMasuk, []); m.get(d.IDSuratMasuk).push(d); });
    m.forEach((arr) => arr.sort((a, b) => (Number(a.TglDikirim) || 0) - (Number(b.TglDikirim) || 0)));
    return m;
  });
  EA.data.smById = (id) => wadah(tahunId(id)).sm.get(id) || null;
  EA.data.skById = (id) => wadah(tahunId(id)).sk.get(id) || null;
  EA.data.dspById = (id) => {
    for (const th of Object.keys(S.tahun)) { const d = S.tahun[th].dsp.get(id); if (d) return d; }
    return null;
  };
  EA.data.dspUntukSm = (idSm) => EA.data.dspPerSm(tahunId(idSm)).get(idSm) || [];
  /** Semua disposisi dari tahun yang sudah dimuat (untuk kotak disposisi lintas tahun). */
  EA.data.semuaDsp = () => ingat('alldsp', () => { let a = []; Object.keys(S.tahun).forEach((th) => { a = a.concat(EA.data.dsp(th)); }); return a; });
  EA.data.semuaSm = () => ingat('allsm', () => { let a = []; Object.keys(S.tahun).forEach((th) => { a = a.concat(EA.data.smAktif(th)); }); return a; });

  /* ---------- Master & pengguna ---------- */
  EA.data.bidang = (id) => (S.mst.bidang || []).find((b) => b.IDBidang === id) || null;
  EA.data.namaBidang = (id) => { const b = EA.data.bidang(id); return b ? b.NamaBidang : (id || '-'); };
  EA.data.kodeBidang = (id) => { const b = EA.data.bidang(id); return b ? b.Kode : (id || '-'); };
  EA.data.klasifikasi = (kode) => (S.mst.klasifikasi || []).find((k) => k.Kode === kode) || null;
  EA.data.nama = (email) => {
    if (!email) return '-';
    if (email === 'darurat') return 'Akses Darurat';
    if (String(email).indexOf('impor:') === 0) return 'Impor data lama';
    const d = (S.mst.direktori || []).find((x) => x.e === String(email).toLowerCase());
    return d ? d.n : email;
  };

  /* ---------- Status turunan ---------- */
  EA.data.terlambat = (d) => d.Status !== 'Selesai' && d.BatasWaktu && d.BatasWaktu < EA.hariIni();
  EA.data.statusTampil = (d) => (EA.data.terlambat(d) ? 'Terlambat' : d.Status);
  EA.data.tepatWaktu = (d) => d.Status === 'Selesai' && d.TglSelesai && EA.isoDariMs(d.TglSelesai) <= d.BatasWaktu;
  /** Hitung mundur: { teks, kelas } */
  EA.data.hitungMundur = (d) => {
    if (d.Status === 'Selesai') return { teks: 'Selesai ' + EA.tglPendek(EA.isoDariMs(d.TglSelesai)), kelas: 'selesai' };
    if (!d.BatasWaktu) return { teks: '-', kelas: 'selesai' };
    const n = EA.selisihHari(EA.hariIni(), d.BatasWaktu);
    if (n < 0) return { teks: 'Terlambat ' + (-n) + ' hari', kelas: 'telat' };
    if (n === 0) return { teks: 'Batas hari ini', kelas: 'dekat' };
    if (n === 1) return { teks: 'Sisa 1 hari', kelas: 'dekat' };
    return { teks: 'Sisa ' + n + ' hari', kelas: 'aman' };
  };

  /* ---------- Hak akses di UI (server tetap memeriksa setiap permintaan) ---------- */
  const peran = () => (S.user ? S.user.peran : '');
  EA.boleh = {
    admin: () => peran() === 'Admin',
    pimpinan: () => peran() === 'Pimpinan',
    staf: () => peran() === 'Staf',
    catatSM: () => peran() === 'Admin',
    disposisi: () => peran() === 'Pimpinan' || (peran() === 'Admin' && /^ya$/i.test(String(S.cfg.AdminBolehDisposisi || 'Ya'))),
    ambilNomor: () => peran() === 'Admin' || peran() === 'Staf',
    kelolaSK: (sk) => peran() === 'Admin' || (peran() === 'Staf' && sk && sk.IDBidang === S.user.idBidang),
    tindakDsp: (d) => peran() === 'Staf' && d && d.KepadaBidang === S.user.idBidang,
    log: () => peran() === 'Admin' || peran() === 'Pimpinan',
    bukuAgenda: () => peran() === 'Admin' || peran() === 'Pimpinan'
  };

  /* ---------- Penghitung (untuk pratinjau nomor) ---------- */
  EA.data.penghitung = (jenis, th) => Number(S.cfg['Penghitung_' + jenis + '_' + th]) || 0;
  EA.data.nomorBerikut = (klas, tgl, idBidang) => {
    const t = tgl || EA.hariIni(), th = Number(t.slice(0, 4));
    const b = EA.data.bidang(idBidang);
    return EA.formatNomor(S.cfg.FormatNomorKeluar, { no: EA.data.penghitung('Keluar', th) + 1, klas, instansi: S.cfg.KodeInstansi, tgl: t, bidang: b ? b.Kode : '' });
  };
  EA.data.klasTerakhir = () => { const sk = EA.data.sk(S.th)[0]; return sk ? sk.KodeKlasifikasi : ''; };
})(window);
