/* app.js — kerangka aplikasi E-Agenda: login (Google + akses darurat), boot instan dari snapshot IndexedDB,
   router hash, sidebar/bilah atas/navigasi bawah sesuai peran, lonceng pemberitahuan, polling adaptif, dan PWA. */
(function (w) {
  'use strict';
  const EA = w.EA, S = EA.S, h = EA.h, ik = EA.ikon, D = EA.data;
  const VERSI = '1.0.0';
  const KUNCI_INFO = 'ea_info', KUNCI_PESAN = 'ea_pesan', KUNCI_CIUT = 'ea_ciut';

  /* ---------- Menu & hak akses halaman (server tetap memeriksa setiap permintaan) ---------- */
  const MENU = [
    { grup: 'Menu Utama' },
    { k: 'dashboard', l: 'Dashboard', i: 'dasbor', w: '#60A5FA' },
    { k: 'surat-masuk', l: 'Surat Masuk', i: 'masuk', w: '#34D399' },
    { k: 'surat-keluar', l: 'Surat Keluar', i: 'keluar', w: '#FBBF24' },
    { k: 'disposisi', l: 'Disposisi', i: 'disposisi', w: '#F472B6' },
    { k: 'arsip', l: 'Arsip Surat', i: 'arsip', w: '#A78BFA' },
    { k: 'laporan', l: 'Laporan', i: 'laporan', w: '#22D3EE' },
    { grup: 'Administrasi', peran: ['Admin', 'Pimpinan'] },
    { k: 'master', l: 'Master Data', i: 'database', w: '#FB923C', peran: ['Admin'] },
    { k: 'pengguna', l: 'Pengguna', i: 'pengguna', w: '#4ADE80', peran: ['Admin'] },
    { k: 'notifikasi', l: 'Notifikasi WA', i: 'wa', w: '#2DD4BF', peran: ['Admin'] },
    { k: 'pengaturan', l: 'Pengaturan', i: 'gir', w: '#CBD5E1', peran: ['Admin'] },
    { k: 'log', l: 'Log Aktivitas', i: 'riwayat', w: '#FCA5A5', peran: ['Admin', 'Pimpinan'] }
  ];
  const AKSES = {};
  MENU.forEach((m) => { if (m.k) AKSES[m.k] = m.peran || '*'; });
  const boleh = (k) => { const a = AKSES[k]; return !!a && (a === '*' || a.indexOf(S.user.peran) > -1); };
  const BAWAH = {
    Admin: [['dashboard', 'Dashboard', 'dasbor'], ['surat-masuk', 'S. Masuk', 'masuk'], ['disposisi', 'Disposisi', 'disposisi'], ['surat-keluar', 'S. Keluar', 'keluar'], ['arsip', 'Cari', 'cari']],
    lain: [['dashboard', 'Dashboard', 'dasbor'], ['disposisi', 'Disposisi', 'disposisi'], ['surat-keluar', 'Surat Keluar', 'keluar'], ['arsip', 'Cari', 'cari']]
  };

  /* ---------- Info publik (logo, nama instansi, Client ID) — disimpan lokal agar halaman login tampil instan ---------- */
  S.info = (() => { try { return JSON.parse(localStorage.getItem(KUNCI_INFO) || 'null'); } catch (e) { return null; } })();
  function setInfo(info) {
    if (!info || typeof info !== 'object') return;
    S.info = info;
    try { localStorage.setItem(KUNCI_INFO, JSON.stringify(info)); } catch (e) { /* kuota penuh / mode privat */ }
    const el = EA.$('#sb-logo'); if (el) EA.html(el, logoHtml());
  }
  const segarInfo = () => EA.api.publik('publik.info').then(setInfo).catch(() => {});
  EA.on('info', setInfo);
  EA.on('info-segar', segarInfo);
  const logoHtml = () => (S.info && S.info.logo ? h`<img src="${S.info.logo}" alt="Logo ${S.info.nama || 'instansi'}">` : ik('sekolah'));
  const namaInstansi = () => (S.cfg && S.cfg.NamaInstansi) || (S.info && S.info.nama) || '';
  const ikonWarna = (n, warna) => EA.raw(String(ik(n)).replace('<svg ', '<svg style="color:' + warna + '" '));

  /* ---------- Splash ---------- */
  function hapusSplash() {
    const s = EA.$('#splash');
    if (!s) return;
    s.style.opacity = '0';
    setTimeout(() => s.remove(), 260);
  }
  function splash(teks) {
    let s = EA.$('#splash');
    if (!s) { s = document.createElement('div'); s.id = 'splash'; s.className = 'splash'; document.body.appendChild(s); }
    s.style.opacity = '1';
    EA.html(s, h`<div class="logo-s"><div class="putar"></div><span>E-Agenda</span><small style="font:400 13px var(--f-teks);color:#C7D2FE">${teks || 'Memuat…'}</small></div>`);
  }

  /* ================= LOGIN ================= */
  let gisSiap = false;
  function tampilLogin(o) {
    o = o || {};
    hapusSplash();
    const app = EA.$('#app');
    app.className = '';
    const info = S.info || {};
    const darurat = /^#darurat/.test(location.hash) || !info.clientId;
    app.innerHTML = h`<div class="login">
      <section class="login-kiri">
        <div style="position:relative;z-index:1">
          <div class="login-logo">${logoHtml()}</div>
          <h1>E-Agenda</h1><div class="tag">Agenda &amp; Disposisi Digital</div>
          <div class="inst">${info.nama || 'Instansi Anda'}${info.alamat ? h`<br><span style="opacity:.8;font-size:13.5px">${info.alamat}</span>` : ''}</div>
          <div class="fitur">
            <div>${ik('kamera')}<span><b>Catat surat dari HP</b> — foto dokumen langsung digabung menjadi satu PDF.</span></div>
            <div>${ik('wa')}<span><b>Disposisi digital</b> dengan notifikasi WhatsApp dan hitung mundur batas waktu.</span></div>
            <div>${ik('pagar')}<span><b>Nomor surat keluar otomatis</b> — urut, anti-dobel, langsung bisa disalin.</span></div>
            <div>${ik('perisai')}<span><b>Lembar disposisi ber-QR</b> yang bisa diverifikasi publik & Buku Agenda resmi.</span></div>
          </div>
        </div>
        <div class="kaki-login">© ${EA.tahunIni()} ${info.nama || 'E-Agenda'} · v${VERSI}</div>
      </section>
      <section class="login-kanan">
        <div class="kartu-login">
          <div class="logo-hp"><div class="login-logo">${logoHtml()}</div><b style="font:700 20px var(--f-judul)">E-Agenda</b><span class="redup">${info.nama || ''}</span></div>
          <h2>Masuk</h2>
          <p>Gunakan akun Google yang terdaftar di E-Agenda.</p>
          <div id="lg-pesan" aria-live="polite">${o.pesan ? h`<div class="kotak-info ${o.jenis || 'biru'}" style="margin-bottom:16px">${ik(o.jenis === 'merah' ? 'galat' : 'info')}<div>${o.pesan}</div></div>` : ''}</div>
          <div class="gsi-wadah" id="gsi">${info.clientId ? h`<div class="putar gelap"></div>` : h`<div class="kotak-info kuning">${ik('info')}<div>Login Google belum dikonfigurasi. Admin: masuk lewat <b>akses darurat</b>, lalu isi Client ID di Pengaturan → Integrasi & Keamanan.</div></div>`}</div>
          <div class="pemisah">atau</div>
          <button class="btn g" type="button" id="lg-dar-buka" style="width:100%" ${darurat ? 'hidden' : ''}>${ik('kunci', 'k')} Akses darurat (Admin)</button>
          <form id="lg-dar" class="stack" ${darurat ? '' : 'hidden'} autocomplete="on">
            <div class="f"><label for="lg-u">Nama pengguna</label><input id="lg-u" name="username" value="darurat" autocomplete="username" autocapitalize="off" spellcheck="false" required></div>
            <div class="f"><label for="lg-p">Kata sandi darurat</label><input id="lg-p" name="password" type="password" autocomplete="current-password" required></div>
            <button class="btn p" type="submit" id="lg-dar-ok" style="width:100%">${ik('gembok', 'k')} Masuk dengan Akses Darurat</button>
            <span class="bantu redup kecil">Untuk Admin bila login Google belum siap/bermasalah. 5× salah = terkunci 15 menit.</span>
          </form>
        </div>
      </section></div>`.s;
    EA.$('#lg-dar-buka').onclick = (e) => { e.currentTarget.hidden = true; EA.$('#lg-dar').hidden = false; EA.$('#lg-p').focus(); };
    EA.$('#lg-dar').onsubmit = (e) => {
      e.preventDefault();
      const btn = EA.$('#lg-dar-ok');
      EA.sibuk(btn, () => masukDengan(EA.api.publik('auth.darurat', { user: EA.$('#lg-u').value.trim(), pass: EA.$('#lg-p').value })), ' Memeriksa…');
    };
    if (info.clientId) pasangGIS(info.clientId);
    // segarkan info publik di latar (logo/Client ID terbaru); gambar ulang bila Client ID berubah
    EA.api.publik('publik.info').then((baru) => {
      const lama = S.info || {};
      setInfo(baru);
      if (baru && (baru.clientId !== lama.clientId || baru.logo !== lama.logo || baru.nama !== lama.nama) && EA.$('.login')) {
        const pesan = EA.$('#lg-pesan') ? EA.$('#lg-pesan').innerHTML : '';
        tampilLogin(o); if (pesan && EA.$('#lg-pesan')) EA.$('#lg-pesan').innerHTML = pesan;
      }
    }).catch((e) => { if (e.kode === 'KONFIG') pesanLogin(e.message, 'merah'); });
  }
  function pesanLogin(teks, jenis) {
    const el = EA.$('#lg-pesan'); if (!el) return;
    EA.html(el, teks ? h`<div class="kotak-info ${jenis || 'merah'}" style="margin-bottom:16px">${ik(jenis === 'biru' ? 'info' : 'galat')}<div>${teks}</div></div>` : '');
  }
  function pasangGIS(clientId) {
    const el = EA.$('#gsi');
    EA.muatSkrip('https://accounts.google.com/gsi/client').then(() => {
      if (!el.isConnected || !w.google || !w.google.accounts) return;
      if (!gisSiap || gisSiap !== clientId) {
        w.google.accounts.id.initialize({
          client_id: clientId, ux_mode: 'popup', auto_select: false, cancel_on_tap_outside: true, context: 'signin',
          callback: (resp) => masukDengan(EA.api.publik('auth.google', { credential: resp.credential }))
        });
        gisSiap = clientId;
      }
      el.innerHTML = '';
      w.google.accounts.id.renderButton(el, { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', logo_alignment: 'left', locale: 'id', width: Math.max(220, Math.min(360, el.clientWidth || 320)) });
    }).catch(() => {
      if (el.isConnected) EA.html(el, h`<div class="kotak-info merah">${ik('galat')}<div>Tombol Google gagal dimuat. Periksa koneksi internet lalu muat ulang halaman, atau gunakan akses darurat.</div></div>`);
    });
  }
  async function masukDengan(janji) {
    pesanLogin('');
    let r;
    try { r = await janji; } catch (e) { pesanLogin(e.message, e.kode === 'TERKUNCI' ? 'kuning' : 'merah'); return; }
    EA.simpanSesi({ token: r.token, exp: r.exp, user: r.user, foto: r.foto || '' });
    const kartu = EA.$('.kartu-login');
    if (kartu) EA.html(kartu, h`<div class="kosong" style="padding:40px 10px"><div class="putar gelap" style="margin:0 auto 14px;width:28px;height:28px;border-width:3px"></div><b>Halo, ${r.user.nama}</b>Menyiapkan data Anda…</div>`);
    await bukaAplikasi();
  }

  /* ================= BOOT ================= */
  async function bukaAplikasi() {
    let adaSnap = false;
    try { adaSnap = await D.muatSnapshot(); } catch (e) { adaSnap = false; }
    if (adaSnap && D.dimuat(S.th)) {
      bangunShell();
      EA.rute();
      sinkronSekarang({ awal: true });
      return;
    }
    if (!EA.$('.login')) splash('Mengunduh data agenda…');
    try {
      await Promise.all([D.sinkron(S.th), EA.api.baca('publik.info', {}).then(setInfo).catch(() => {})]);
    } catch (e) {
      if (e.kode === 'SESI') return; // ditangani oleh pendengar 'sesi-habis'
      tampilGagal(e);
      return;
    }
    bangunShell();
    EA.rute();
    setelahSinkronPertama();
  }
  function tampilGagal(e) {
    hapusSplash();
    const app = EA.$('#app');
    app.className = '';
    app.innerHTML = h`<div class="login"><section class="login-kanan" style="grid-column:1/-1"><div class="kartu-login" style="text-align:center">
      <div class="login-logo" style="margin:0 auto 16px">${logoHtml()}</div><h2>Belum dapat memuat data</h2><p>${e.message}</p>
      <div class="stack"><button class="btn p" id="gg-ulang">${ik('putar', 'k')} Coba lagi</button><button class="btn g" id="gg-keluar">${ik('logout', 'k')} Keluar</button></div></div></section></div>`.s;
    EA.$('#gg-ulang').onclick = (ev) => EA.sibuk(ev.currentTarget, () => bukaAplikasi());
    EA.$('#gg-keluar').onclick = () => keluar(false);
  }
  function tampilKonfig() {
    hapusSplash();
    EA.$('#app').innerHTML = h`<div class="login"><section class="login-kanan" style="grid-column:1/-1"><div class="kartu-login">
      <div class="login-logo" style="margin:0 auto 16px">${ik('gir')}</div><h2>Konfigurasi belum lengkap</h2>
      <p>Isi <code>GAS_URL</code> di berkas <code>js/config.js</code> dengan URL Web App Apps Script (berakhiran <code>/exec</code>), lalu muat ulang halaman ini.</p>
      <pre class="kode-blok">window.APP_CONFIG = { GAS_URL: 'https://script.google.com/macros/s/…/exec' };</pre></div></section></div>`.s;
  }

  /* ================= KERANGKA (shell) ================= */
  let rootAktif = null, halAktif = null, kueriAktif = '', idAktif = '', shellKunci = '';
  function bangunShell() {
    hapusSplash();
    const u = S.user, app = EA.$('#app');
    shellKunci = u.peran + ':' + u.idBidang + ':' + u.nama;
    app.className = 'app' + (localStorage.getItem(KUNCI_CIUT) === '1' ? ' ciut' : '');
    const bawah = BAWAH[u.peran] || BAWAH.lain;
    app.innerHTML = h`
      <aside class="sb" id="sb" aria-label="Navigasi utama">
        <div class="sb-kepala"><div class="sb-logo" id="sb-logo">${logoHtml()}</div><div class="sb-judul"><b>E-Agenda</b><span>Agenda &amp; Disposisi Digital</span></div></div>
        <nav class="sb-nav" id="sb-nav">${menuHtml()}</nav>
        <div class="sb-widget" id="sb-widget"></div>
        <div class="sb-bawah"><a class="sb-a keluar" href="#" data-keluar>${ik('logout')}<span class="lbl">Keluar</span></a></div>
      </aside>
      <div class="scrim" id="scrim"></div>
      <div class="utama">
        <header class="tb">
          <button class="btn-ik" id="tb-menu" type="button" aria-label="Buka/tutup menu">${ik('menu')}</button>
          <div class="judul-hp" id="judul-hp"></div>
          <form class="tb-cari" id="tb-cari" role="search"><label class="sr" for="tb-q">Cari arsip</label>${ik('cari')}<input id="tb-q" type="search" placeholder="Cari nomor, perihal, atau asal surat…" title="Tekan / untuk mencari" aria-keyshortcuts="/" enterkeyhint="search" autocomplete="off"></form>
          <div class="tb-ruang"></div>
          <span class="chip-tgl">${ik('kalender', 'k')}<span id="tb-tgl">${EA.hariTgl()}</span></span>
          <button class="btn-ik cari-hp" id="tb-cari-hp" type="button" aria-label="Cari">${ik('cari')}</button>
          <button class="btn-ik" id="tb-lonceng" type="button" aria-label="Pemberitahuan" aria-haspopup="menu">${ik('lonceng')}<span class="titik-m" id="tb-bdg" hidden></span></button>
          <button class="btn-ik layar" id="tb-layar" type="button" aria-label="Layar penuh">${ik('layar')}</button>
          ${u.peran === 'Admin' ? h`<a class="btn-ik hp-sembunyi" href="#/pengaturan" aria-label="Pengaturan" title="Pengaturan">${ik('gir')}</a>` : ''}
          <span class="tb-garis"></span>
          <button class="profil" id="tb-profil" type="button" aria-haspopup="menu" aria-label="Menu akun"></button>
        </header>
        <main class="isi" id="isi"></main>
      </div>
      <nav class="bn" id="bn" aria-label="Navigasi bawah" ${bawah.length === 5 ? h`style="grid-template-columns:repeat(5,1fr)"` : ''}>
        ${bawah.map(([k, l, i]) => h`<a href="#/${k}" data-k="${k}">${ik(i)}<span>${l}</span><span class="bdg" data-bdg="${k}" hidden></span></a>`)}
      </nav>
      <div class="offline" id="offline" role="status" ${S.online === false ? '' : 'hidden'}>${ik('awanOff', 'k')} Offline — menampilkan data tersimpan</div>`.s;
    rootAktif = EA.$('#isi'); halAktif = null; kueriAktif = ''; idAktif = '';
    gambarProfil();
    gambarWidget();
    perbaruiLencana();
    pasangKejadianShell();
    pasangTimerSesi();
    jadwalPoll();
  }
  function menuHtml() {
    const p = S.user.peran, out = [];
    let grup = null;
    MENU.forEach((m) => {
      if (m.peran && m.peran.indexOf(p) < 0) return;
      if (m.grup) { grup = m.grup; return; }
      if (grup) { out.push(h`<div class="sb-grup">${grup}</div>`); grup = null; }
      out.push(h`<a class="sb-a" href="#/${m.k}" data-k="${m.k}" title="${m.l}">${ikonWarna(m.i, m.w)}<span class="lbl">${m.l}</span><span class="bdg" data-bdg="${m.k}" hidden></span></a>`);
    });
    return out;
  }
  function gambarProfil() {
    const u = S.user, el = EA.$('#tb-profil'); if (!el) return;
    const foto = EA.sesi && EA.sesi.foto;
    const sub = u.peran + (u.namaBidang ? ' · ' + u.namaBidang : u.jabatan ? ' · ' + u.jabatan : '');
    EA.html(el, h`<i class="avatar">${foto ? h`<img src="${foto}" alt="" referrerpolicy="no-referrer">` : EA.inisial(u.nama)}</i><span class="nm"><b>${u.nama}</b><span>${sub}</span></span>${ik('bawah', 'k hp-sembunyi')}`);
  }
  function gambarWidget() {
    const el = EA.$('#sb-widget'); if (!el || !S.user) return;
    const no = D.nomorBerikut(D.klasTerakhir(), EA.hariIni(), S.user.idBidang);
    const st = S.online === false ? 'off' : sinkronJalan ? 'sibuk' : '';
    const ket = S.online === false ? 'Offline — data tersimpan' : S.user.peran === 'Admin' ? 'Antrean WA: ' + EA.angka(S.meta.antrean || 0) + ' menunggu' : sinkronJalan ? 'Menyinkronkan…' : 'Data tersinkron';
    EA.html(el, h`<div class="lbl">Nomor Surat Keluar Berikutnya</div><div class="no">${no}</div>
      <div class="baris"><span class="titik ${st}"></span><span>${ket}</span><span class="jam" title="Pembaruan terakhir">${S.sinkronTerakhir ? EA.jam(S.sinkronTerakhir) : '--:--'}</span></div>`);
  }

  /* ---------- Kejadian kerangka ---------- */
  function bukaSidebar() { EA.$('#sb').classList.add('buka'); EA.$('#scrim').classList.add('buka'); }
  function tutupSidebar() { const sb = EA.$('#sb'), sc = EA.$('#scrim'); if (sb) sb.classList.remove('buka'); if (sc) sc.classList.remove('buka'); }
  function pasangKejadianShell() {
    EA.$('#tb-menu').onclick = () => {
      if (w.innerWidth >= 1280) {
        const ciut = EA.$('#app').classList.toggle('ciut');
        try { localStorage.setItem(KUNCI_CIUT, ciut ? '1' : '0'); } catch (e) { /* abaikan */ }
      } else if (EA.$('#sb').classList.contains('buka')) tutupSidebar(); else bukaSidebar();
    };
    EA.$('#scrim').onclick = tutupSidebar;
    EA.$('#sb').addEventListener('click', (e) => {
      if (e.target.closest('[data-keluar]')) { e.preventDefault(); konfirmasiKeluar(); return; }
      if (e.target.closest('a.sb-a')) tutupSidebar();
    });
    EA.$('#tb-cari').onsubmit = (e) => {
      e.preventDefault();
      const q = EA.$('#tb-q').value.trim();
      ke('#/arsip' + (q ? '?q=' + encodeURIComponent(q) : ''), true);
    };
    EA.$('#tb-cari-hp').onclick = () => { ke('#/arsip', false); setTimeout(() => { const i = EA.$('#ar-q'); if (i) i.focus(); }, 60); };
    EA.$('#tb-lonceng').onclick = (e) => bukaLonceng(e.currentTarget);
    EA.$('#tb-profil').onclick = (e) => bukaProfil(e.currentTarget);
    EA.$('#tb-layar').onclick = () => {
      try {
        if (document.fullscreenElement) document.exitFullscreen();
        else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
      } catch (er) { /* tidak didukung */ }
    };
  }
  /** Navigasi; bila hash sama, paksa render ulang (mis. cari kata yang sama dua kali). */
  function ke(hash, paksa) {
    if (location.hash === hash) { if (paksa) EA.rute({ paksa: true }); }
    else location.hash = hash;
  }
  EA.ke = ke;

  /* ================= ROUTER ================= */
  function urai(hash) {
    const s = String(hash || '').replace(/^#\/?/, '');
    const i = s.indexOf('?');
    const jalur = i > -1 ? s.slice(0, i) : s, kueri = i > -1 ? s.slice(i + 1) : '';
    const bagian = jalur.split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch (e) { return x; } });
    const p = {};
    try { new URLSearchParams(kueri).forEach((v, k) => { p[k] = v; }); } catch (e) { /* abaikan */ }
    return { hal: bagian[0] || 'dashboard', id: bagian[1] || '', p, kueri };
  }
  function tandaiMenu(k) {
    EA.$$('.sb-a[data-k]').forEach((a) => { const on = a.dataset.k === k; a.classList.toggle('aktif', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    EA.$$('.bn a[data-k]').forEach((a) => a.classList.toggle('aktif', a.dataset.k === k));
  }
  EA.rute = (opsi) => {
    if (!S.user || !rootAktif) return;
    EA.tutupMenu();
    const r = urai(location.hash);
    let hal = r.hal;
    if (!EA.hal[hal] || !boleh(hal)) {
      if (EA.hal[hal] && hal !== 'dashboard') EA.toast('Halaman itu tidak tersedia untuk peran Anda.', 'info');
      hal = 'dashboard'; r.id = ''; r.p = {}; r.kueri = '';
      history.replaceState(null, '', '#/dashboard');
    }
    const tutupDetail = !!idAktif && !r.id && hal === halAktif;
    const render = hal !== halAktif || (opsi && opsi.paksa) || (!tutupDetail && !r.id && !!r.kueri && r.kueri !== kueriAktif);
    if (render) {
      EA.tutupPanel(true);
      const pindah = hal !== halAktif;
      const baru = document.createElement('main');
      baru.className = 'isi'; baru.id = 'isi';
      rootAktif.replaceWith(baru); rootAktif = baru; // elemen baru = semua pendengar halaman lama ikut terlepas
      halAktif = hal; kueriAktif = r.id ? '' : r.kueri;
      const pg = EA.hal[hal];
      tandaiMenu(hal);
      document.title = pg.judul + ' · E-Agenda' + (namaInstansi() ? ' ' + namaInstansi() : '');
      EA.$('#judul-hp').textContent = pg.judul;
      try { pg.render(baru, r.p || {}); } catch (e) { console.error(e); EA.html(baru, EA.kosong('galat', 'Halaman gagal ditampilkan', e.message)); }
      if (pindah) w.scrollTo(0, 0);
      tutupSidebar();
      if (Date.now() - S.sinkronTerakhir > 20000) sinkronSekarang();
    } else if (!r.id) kueriAktif = r.kueri;
    idAktif = r.id;
    if (r.id) {
      const pg = EA.hal[hal];
      if (pg.buka) { try { pg.buka(r.id); } catch (e) { console.error(e); } }
    } else if (EA.panel) { EA.navDariDaftar = false; EA.tutupPanel(true); }
  };
  w.addEventListener('hashchange', () => { if (S.user && rootAktif) EA.rute(); });

  /* ================= SEGARKAN TAMPILAN SAAT DATA BERUBAH ================= */
  let rafSegar = 0;
  EA.on('data', () => {
    if (rafSegar) return;
    rafSegar = requestAnimationFrame(() => { rafSegar = 0; segarTampilan(); });
  });
  function segarTampilan() {
    if (!S.user || !rootAktif) return;
    const kunci = S.user.peran + ':' + S.user.idBidang + ':' + S.user.nama;
    if (kunci !== shellKunci) { const hal = halAktif; bangunShell(); halAktif = null; if (hal) EA.rute(); return; } // peran/bidang berubah oleh Admin
    perbaruiLencana();
    gambarWidget();
    const pg = EA.hal[halAktif];
    if (pg && pg.segar) { try { pg.segar(rootAktif); } catch (e) { console.error(e); } }
    if (EA.panel) { try { EA.panel.segar(); } catch (e) { console.error(e); } }
  }

  /* ================= LENCANA & LONCENG ================= */
  const msHari = (iso) => Date.parse(iso + 'T00:00:00+07:00');
  const kunciLihat = () => 'ea_lonceng:' + (S.user ? S.user.email : '-');
  const lihatTerakhir = () => Number(localStorage.getItem(kunciLihat()) || 0);
  function ringkasan() {
    const u = S.user, staf = u.peran === 'Staf';
    const dsp = D.semuaDsp().filter((d) => { const sm = D.smById(d.IDSuratMasuk); return sm && !sm.Dihapus; });
    const milik = staf ? dsp.filter((d) => d.KepadaBidang === u.idBidang) : dsp;
    const perlu = staf ? [] : D.semuaSm().filter((x) => x.StatusDisposisi === 'Belum');
    const telat = milik.filter(D.terlambat);
    let lencana;
    if (staf) lencana = milik.filter((d) => d.Status === 'Baru' || d.Status === 'Dibaca').length;
    else if (EA.boleh.disposisi()) lencana = perlu.length;
    else lencana = telat.length;
    return { dsp: milik, perlu, telat, lencana };
  }
  function itemLonceng(x) {
    const u = S.user, out = [], hari = EA.hariIni(), besok = EA.tambahHari(hari, 1);
    const sm = (d) => D.smById(d.IDSuratMasuk) || {};
    const maks = (arr, f) => arr.reduce((m, o) => Math.max(m, Number(f(o)) || 0), 0);
    if (u.peran === 'Staf') {
      x.dsp.filter((d) => d.Status === 'Baru').forEach((d) => out.push({ t: d.TglDikirim, ikon: 'disposisi', warna: 'biru', judul: 'Disposisi baru: ' + (sm(d).Perihal || ''), sub: 'Dari ' + D.nama(d.Dari) + ' · batas ' + EA.tglPendek(d.BatasWaktu), href: '#/disposisi/' + d.ID, belumDibaca: true }));
      x.dsp.filter((d) => d.Status !== 'Selesai' && (d.BatasWaktu === hari || d.BatasWaktu === besok)).forEach((d) => out.push({ t: msHari(hari), ikon: 'jam', warna: 'oranye', judul: (d.BatasWaktu === hari ? 'Batas hari ini: ' : 'Batas besok: ') + (sm(d).Perihal || ''), sub: 'Status ' + d.Status + ' · No. Agenda ' + (sm(d).NoAgenda || '-'), href: '#/disposisi/' + d.ID }));
      x.telat.forEach((d) => out.push({ t: msHari(EA.tambahHari(d.BatasWaktu, 1)), ikon: 'awas', warna: 'merah', judul: 'Terlambat ' + EA.selisihHari(d.BatasWaktu, hari) + ' hari: ' + (sm(d).Perihal || ''), sub: 'Batas ' + EA.tglPanjang(d.BatasWaktu), href: '#/disposisi/' + d.ID }));
    } else {
      if (EA.boleh.disposisi() && x.perlu.length) {
        const penting = x.perlu.filter((s) => s.Sifat === 'Segera' || s.Sifat === 'Penting');
        penting.forEach((s) => out.push({ t: s.DibuatPada, ikon: 'petir', warna: 'merah', judul: 'Surat ' + s.Sifat + ' perlu disposisi', sub: s.Perihal + ' · ' + s.AsalSurat, href: '#/surat-masuk/' + s.ID }));
        const lain = x.perlu.filter((s) => penting.indexOf(s) < 0);
        if (lain.length) out.push({ t: maks(lain, (s) => s.DibuatPada), ikon: 'masuk', warna: 'biru', judul: lain.length + ' surat lain menunggu disposisi', sub: 'Buka tab Perlu Disposisi', href: '#/disposisi?tab=perlu' });
      }
      const seminggu = Date.now() - 7 * 86400000;
      x.dsp.filter((d) => d.Status === 'Selesai' && d.TglSelesai > seminggu).forEach((d) => out.push({ t: d.TglSelesai, ikon: 'cekL', warna: 'hijau', judul: D.namaBidang(d.KepadaBidang) + ' menyelesaikan disposisi', sub: sm(d).Perihal || '', href: '#/disposisi/' + d.ID }));
      if (x.telat.length) out.push({ t: msHari(hari), ikon: 'awas', warna: 'merah', judul: x.telat.length + ' disposisi terlambat', sub: Array.from(new Set(x.telat.map((d) => D.namaBidang(d.KepadaBidang)))).join(', '), href: '#/disposisi?tab=telat' });
      if (u.peran === 'Admin') {
        const tanpa = D.semuaSm().filter((s) => !s.FileID);
        if (tanpa.length) out.push({ t: maks(tanpa, (s) => s.DibuatPada), ikon: 'kamera', warna: 'oranye', judul: tanpa.length + ' surat masuk belum ada scan', sub: 'Unggah scan menyusul dari halaman detail surat', href: '#/surat-masuk' });
        if (Number(S.meta.antrean) > 0) out.push({ t: S.sinkronTerakhir, ikon: 'wa', warna: 'teal', judul: S.meta.antrean + ' notifikasi WA dalam antrean', sub: 'Dikirim otomatis ±5 menit', href: '#/notifikasi' });
      }
    }
    if (u.peran !== 'Pimpinan') {
      const lama = D.sk(S.th).filter((s) => s.Status === 'Nomor Diambil' && Date.now() - s.DibuatPada > 7 * 86400000 && (u.peran !== 'Staf' || s.IDBidang === u.idBidang));
      if (lama.length) out.push({ t: msHari(hari), ikon: 'keluar', warna: 'ungu', judul: lama.length + ' surat keluar belum diunggah scan > 7 hari', sub: lama.slice(0, 3).map((s) => s.NomorSurat).join(', '), href: '#/surat-keluar' });
    }
    return out.sort((a, b) => (Number(b.t) || 0) - (Number(a.t) || 0)).slice(0, 40);
  }
  function hitungLonceng(x, items) {
    if (S.user.peran === 'Staf') return x.dsp.filter((d) => d.Status === 'Baru').length; // FR-50: disposisi belum dibaca
    const batas = lihatTerakhir();
    return items.filter((i) => (Number(i.t) || 0) > batas).length;
  }
  function perbaruiLencana() {
    if (!S.user) return;
    const x = ringkasan();
    EA.$$('[data-bdg="disposisi"]').forEach((b) => { b.hidden = !x.lencana; b.textContent = x.lencana > 99 ? '99+' : x.lencana; });
    const n = hitungLonceng(x, itemLonceng(x)), bdg = EA.$('#tb-bdg');
    if (bdg) { bdg.hidden = !n; bdg.textContent = n > 99 ? '99+' : n; }
    const lc = EA.$('#tb-lonceng'); if (lc) lc.setAttribute('aria-label', 'Pemberitahuan' + (n ? ' (' + n + ' baru)' : ''));
    if ('setAppBadge' in navigator) { try { (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {}); } catch (e) { /* abaikan */ } }
  }
  function bukaLonceng(anchor) {
    const x = ringkasan(), items = itemLonceng(x), batas = lihatTerakhir();
    const m = EA.menuTarik(anchor, h`<div class="mt-h" style="display:flex;justify-content:space-between;align-items:center;gap:10px"><b>Pemberitahuan</b><span class="redup kecil">${items.length ? items.length + ' item' : ''}</span></div>
      ${items.length ? items.map((i) => h`<a class="l-i ${(Number(i.t) || 0) > batas || i.belumDibaca ? 'baru' : ''}" href="${i.href}"><span class="ik-chip ${i.warna}">${ik(i.ikon, 'k')}</span><span class="isi-i"><b>${i.judul}</b><span>${i.sub}</span><span class="redup" style="font-size:11px">${i.t ? EA.relatif(i.t) : ''}</span></span></a>`)
        : h`<div class="kosong" style="padding:26px 10px">${ik('cekL', 'b')}<b>Tidak ada pemberitahuan</b>Semua beres untuk saat ini.</div>`}`, 'lonceng');
    if (!m) return;
    try { localStorage.setItem(kunciLihat(), String(Date.now())); } catch (e) { /* abaikan */ }
    perbaruiLencana();
  }
  function bukaProfil(anchor) {
    const u = S.user;
    const m = EA.menuTarik(anchor, h`<div class="mt-h"><b>${u.nama}</b><div class="redup kecil" style="word-break:break-all">${u.email === 'darurat' ? 'Akses darurat (sementara)' : u.email}</div>
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${EA.lcPeran(u.peran)}${u.namaBidang ? h`<span class="lc abu">${u.namaBidang}</span>` : ''}</div></div>
      ${u.peran === 'Admin' ? h`<a href="#/pengaturan">${ik('gir', 'k')} Pengaturan</a>` : ''}
      <button type="button" data-m="segar">${ik('putar', 'k')} Muat ulang data dari server</button>
      ${promptPasang ? h`<button type="button" data-m="pasang">${ik('hp', 'k')} Pasang aplikasi di perangkat ini</button>` : ''}
      <button type="button" data-m="semua">${ik('perisai', 'k')} Keluar dari semua perangkat</button>
      <button type="button" data-m="keluar" style="color:var(--bahaya-tua)">${ik('logout', 'k')} Keluar</button>
      <div class="redup kecil" style="padding:6px 12px 4px">E-Agenda v${VERSI}${S.sinkronTerakhir ? ' · sinkron ' + EA.jam(S.sinkronTerakhir) : ''}</div>`);
    if (!m) return;
    m.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      EA.tutupMenu();
      const a = b.dataset.m;
      if (a === 'segar') { muatUlangPenuh(); }
      if (a === 'pasang' && promptPasang) { const p = promptPasang; promptPasang = null; try { p.prompt(); await p.userChoice; } catch (er) { /* dibatalkan */ } }
      if (a === 'keluar') konfirmasiKeluar();
      if (a === 'semua') {
        const k = await EA.konfirmasi({ judul: 'Keluar dari semua perangkat?', pesan: 'Semua sesi akun Anda (HP, laptop lain) akan diakhiri. Anda perlu masuk ulang di setiap perangkat.', ya: 'Keluar dari semua', bahaya: true });
        if (k.ok) keluar(true);
      }
    });
  }
  async function muatUlangPenuh() {
    S.vc = ''; S.vm = '';
    Object.keys(S.tahun).forEach((th) => { const y = S.tahun[th]; y.v = {}; y.s = {}; y.sc = ''; });
    EA.toast('Memuat ulang data dari server…', 'info');
    try { await Promise.all(Object.keys(S.tahun).map((th) => D.sinkron(Number(th), { paksaEmit: true }))); EA.toast('Data diperbarui.'); } catch (e) { EA.galat(e); }
  }

  /* ================= SINKRON & POLLING ADAPTIF (gas-scale-turbo) ================= */
  const POLL = { aktif: 30000, diam: 120000, batasDiam: 180000 };
  let sinkronJalan = false, pollT = null, putaran = 0, interaksi = Date.now(), urlDiatur = false;
  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach((ev) => w.addEventListener(ev, () => { interaksi = Date.now(); }, { passive: true, capture: true }));
  async function sinkronSekarang(o) {
    if (!EA.sesi || !S.user || sinkronJalan) return;
    sinkronJalan = true; gambarWidget();
    try {
      putaran++;
      const tugas = [D.sinkron(S.th)];
      // tahun lain yang sedang dibuka ikut disegarkan sesekali (jarang berubah)
      if (putaran % 5 === 0) Object.keys(S.tahun).map(Number).filter((th) => th !== S.th && S.tahun[th].dimuat).forEach((th) => tugas.push(D.sinkron(th)));
      if (o && o.awal) tugas.push(EA.api.baca('publik.info', {}).then(setInfo).catch(() => {}));
      await Promise.all(tugas);
      if (o && o.awal) setelahSinkronPertama();
    } catch (e) {
      if (e.kode !== 'SESI' && e.kode !== 'JARINGAN') console.warn('Sinkron:', e.message);
    } finally { sinkronJalan = false; gambarWidget(); }
  }
  EA.sinkronSekarang = sinkronSekarang;
  function jadwalPoll() {
    clearTimeout(pollT);
    if (!EA.sesi || document.visibilityState !== 'visible') return;
    const jeda = Date.now() - interaksi > POLL.batasDiam ? POLL.diam : POLL.aktif;
    pollT = setTimeout(async () => { await sinkronSekarang(); jadwalPoll(); }, jeda);
  }
  document.addEventListener('visibilitychange', () => {
    if (!S.user) return;
    if (document.visibilityState === 'visible') { if (Date.now() - S.sinkronTerakhir > 15000) sinkronSekarang(); jadwalPoll(); }
    else clearTimeout(pollT);
  });
  w.addEventListener('online', () => { EA.emit('online', true); if (S.user) sinkronSekarang(); });
  w.addEventListener('offline', () => EA.emit('online', false));
  EA.on('online', (v) => {
    if (S.online === v) return;
    S.online = v;
    const el = EA.$('#offline'); if (el) el.hidden = !!v;
    gambarWidget();
  });
  /** Admin: catat alamat aplikasi sekali agar tautan WA & QR verifikasi mengarah ke frontend ini. */
  function setelahSinkronPertama() {
    if (urlDiatur || !S.user || S.user.peran !== 'Admin' || S.cfg.URLAplikasi || location.protocol !== 'https:') return;
    urlDiatur = true;
    const url = (location.origin + location.pathname).replace(/index\.html$/, '');
    EA.api.panggil('admin.sistemAksi', { aksi: 'setURL', url }, { ulang: 0 }).then((r) => { if (r && r.urlAplikasi) D.setCfg({ URLAplikasi: r.urlAplikasi }); }).catch(() => {});
  }

  /* ================= SESI ================= */
  let timerSesi = null;
  function pasangTimerSesi() {
    clearTimeout(timerSesi);
    if (!EA.sesi) return;
    const sisa = EA.sesi.exp - Date.now();
    timerSesi = setTimeout(() => EA.emit('sesi-habis', { message: 'Sesi Anda sudah berakhir. Silakan masuk kembali.' }), Math.max(1000, Math.min(sisa, 2147483000)));
  }
  let habis = false;
  EA.on('sesi-habis', (e) => {
    if (habis) return;
    habis = true;
    EA.simpanSesi(null);
    try { sessionStorage.setItem(KUNCI_PESAN, JSON.stringify({ pesan: (e && e.message) || 'Sesi Anda berakhir. Silakan masuk kembali.', jenis: 'biru' })); } catch (er) { /* abaikan */ }
    location.reload(); // muat ulang bersih: state halaman tidak terbawa ke sesi berikutnya
  });
  async function konfirmasiKeluar() {
    const k = await EA.konfirmasi({ judul: 'Keluar dari E-Agenda?', pesan: 'Sesi di perangkat ini diakhiri dan data tersimpan lokal dihapus.', ya: 'Keluar', ikon: 'logout' });
    if (k.ok) keluar(false);
  }
  async function keluar(semua) {
    splash('Keluar…');
    try { if (EA.sesi) await Promise.race([EA.api.panggil('auth.keluar', { semua: !!semua }, { ulang: 0, timeout: 8000 }), EA.tidur(semua ? 8000 : 2500)]); } catch (e) { /* tetap keluar */ }
    EA.simpanSesi(null);
    try { await EA.kv.bersihkan(); } catch (e) { /* abaikan */ }
    if (w.google && w.google.accounts && w.google.accounts.id) { try { w.google.accounts.id.disableAutoSelect(); } catch (e) { /* abaikan */ } }
    try { sessionStorage.setItem(KUNCI_PESAN, JSON.stringify({ pesan: semua ? 'Anda telah keluar dari semua perangkat.' : 'Anda telah keluar.', jenis: 'hijau' })); } catch (e) { /* abaikan */ }
    history.replaceState(null, '', location.pathname + location.search + '#/');
    location.reload();
  }

  /* ================= PWA: service worker & pemasangan ================= */
  let promptPasang = null;
  w.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); promptPasang = e; });
  w.addEventListener('appinstalled', () => { promptPasang = null; EA.toast('E-Agenda terpasang di perangkat ini.'); });
  function pasangSW() {
    if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) return;
    if (w.APP_CONFIG && w.APP_CONFIG.TANPA_SW) return;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      const tawarkan = () => {
        if (!reg.waiting || EA.$('#pembaruan')) return;
        const b = document.createElement('div');
        b.id = 'pembaruan'; b.className = 'offline pembaruan'; b.setAttribute('role', 'status');
        EA.html(b, h`${ik('putar', 'k')}<span>Versi baru E-Agenda tersedia.</span><button class="btn k l" type="button">Muat ulang</button>`);
        b.querySelector('button').onclick = () => { if (reg.waiting) reg.waiting.postMessage('lewati'); };
        document.body.appendChild(b);
      };
      if (reg.waiting && navigator.serviceWorker.controller) tawarkan();
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing; if (!nw) return;
        nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) tawarkan(); });
      });
      setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
    }).catch(() => {});
    let dimuatUlang = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (dimuatUlang) return; dimuatUlang = true; location.reload(); });
  }

  /* ================= LAIN-LAIN ================= */
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const a = document.activeElement;
    if (a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return;
    const i = EA.$('#tb-q');
    if (i && i.offsetParent) { e.preventDefault(); i.focus(); }
  });
  let hariTerakhir = EA.hariIni();
  setInterval(() => {
    const hr = EA.hariIni();
    if (hr === hariTerakhir) return;
    hariTerakhir = hr;
    const t = EA.$('#tb-tgl'); if (t) t.textContent = EA.hariTgl();
    if (S.user) { S.rev++; EA.emit('data', { lokal: true }); } // status "terlambat" & hitung mundur berganti hari
  }, 60000);
  w.addEventListener('unhandledrejection', (e) => { console.warn('Tidak tertangani:', e.reason); });

  /* ================= MULAI ================= */
  function mulai() {
    pasangSW();
    if (!EA.konfigSah()) { tampilKonfig(); return; }
    let pesan = null;
    try { pesan = JSON.parse(sessionStorage.getItem(KUNCI_PESAN) || 'null'); sessionStorage.removeItem(KUNCI_PESAN); } catch (e) { pesan = null; }
    if (EA.sesi) bukaAplikasi();
    else tampilLogin(pesan || {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mulai); else mulai();
})(window);
