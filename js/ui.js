/* ui.js — komponen antarmuka: toast, modal, laci (panel samping), konfirmasi, lencana, paginasi, pilihan bercari,
   pemindai kamera/unggah (gabung jadi 1 PDF), dan pratinjau berkas (PDF.js / penampil bawaan). */
(function (w) {
  'use strict';
  const EA = w.EA, h = EA.h, ik = EA.ikon;

  /* ---------- Toast ---------- */
  EA.toast = (pesan, jenis, lama) => {
    let wrap = EA.$('.toast-wrap');
    if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; wrap.setAttribute('role', 'status'); wrap.setAttribute('aria-live', 'polite'); document.body.appendChild(wrap); }
    const t = document.createElement('div');
    t.className = 'toast ' + (jenis || 'ok');
    EA.html(t, h`${ik(jenis === 'galat' ? 'galat' : jenis === 'info' ? 'info' : 'cekL')}<div>${pesan}</div>`);
    wrap.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, lama || (jenis === 'galat' ? 5200 : 2800));
  };
  EA.galat = (e) => { console.warn(e); EA.toast((e && e.message) || String(e), 'galat'); };

  /* ---------- Modal ---------- */
  const tumpukan = [];
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && tumpukan.length) { const t = tumpukan[tumpukan.length - 1]; if (!t.kunci) t.tutup(); }
  });
  EA.modal = (o) => {
    const lap = document.createElement('div');
    lap.className = 'lapisan';
    lap.innerHTML = h`<div class="modal ${o.kelas || ''}" role="dialog" aria-modal="true" aria-label="${o.judul}">
      <div class="modal-h">${o.ikon ? h`<div class="ik-besar">${ik(o.ikon)}</div>` : ''}
        <div style="min-width:0"><h2>${o.judul}${o.chip || ''}</h2>${o.sub ? h`<p>${o.sub}</p>` : ''}</div>
        <button class="btn-ik tutup" data-tutup aria-label="Tutup">${ik('x')}</button></div>
      <div class="modal-b"></div>${o.kaki ? h`<div class="modal-f">${o.kaki}</div>` : ''}</div>`.s;
    const b = lap.querySelector('.modal-b');
    if (o.isi) EA.html(b, o.isi);
    const fokusAsal = document.activeElement;
    const obj = {
      el: lap, b, kunci: !!o.kunci,
      tutup: () => { const i = tumpukan.indexOf(obj); if (i > -1) tumpukan.splice(i, 1); lap.remove(); if (o.onTutup) o.onTutup(); if (fokusAsal && fokusAsal.focus) fokusAsal.focus(); }
    };
    lap.addEventListener('mousedown', (e) => { if (e.target === lap && !obj.kunci) obj.tutup(); });
    lap.querySelector('[data-tutup]').onclick = () => obj.tutup();
    lap.addEventListener('click', (e) => { if (e.target.closest('[data-batal]')) obj.tutup(); });
    document.body.appendChild(lap);
    tumpukan.push(obj);
    if (o.onBuka) o.onBuka(lap, obj);
    const f = lap.querySelector('[autofocus]') || lap.querySelector('.modal-b input:not([type=hidden]), .modal-b textarea, .modal-b select');
    if (f && window.innerWidth > 767) setTimeout(() => f.focus(), 30);
    return obj;
  };

  /* ---------- Laci (panel samping; layar penuh di HP) ---------- */
  EA.laci = (o) => {
    const lap = document.createElement('div');
    lap.className = 'laci-l';
    const el = document.createElement('aside');
    el.className = 'laci ' + (o.lebar ? 'lebar' : '');
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML = h`<div class="laci-h"><div style="min-width:0;flex:1"><h2></h2><p hidden></p></div><button class="btn-ik" data-tutup aria-label="Tutup">${ik('x')}</button></div>
      <div class="laci-aksi" hidden></div><div class="laci-b"></div><div class="laci-f" hidden></div>`.s;
    const obj = {
      el, lap,
      atur(p) {
        if (p.judul !== undefined) EA.html(el.querySelector('.laci-h h2'), h`${p.judul}${p.pill ? h`<span class="pill">${p.pill}</span>` : ''}${p.chip || ''}`);
        if (p.sub !== undefined) { const s = el.querySelector('.laci-h p'); s.hidden = !p.sub; EA.html(s, p.sub || ''); }
        if (p.aksi !== undefined) { const a = el.querySelector('.laci-aksi'); a.hidden = !p.aksi; EA.html(a, p.aksi || ''); }
        if (p.isi !== undefined) EA.html(el.querySelector('.laci-b'), p.isi);
        if (p.kaki !== undefined) { const f = el.querySelector('.laci-f'); f.hidden = !p.kaki; EA.html(f, p.kaki || ''); }
      },
      b: el.querySelector('.laci-b'),
      tutup: (diam) => { const i = tumpukan.indexOf(obj); if (i > -1) tumpukan.splice(i, 1); lap.remove(); el.remove(); if (!diam && o.onTutup) o.onTutup(); },
      kunci: false
    };
    obj.atur(o);
    lap.onclick = () => obj.tutup();
    el.querySelector('[data-tutup]').onclick = () => obj.tutup();
    document.body.appendChild(lap); document.body.appendChild(el);
    tumpukan.push(obj);
    if (o.onBuka) o.onBuka(el, obj);
    return obj;
  };

  /* ---------- Konfirmasi ---------- */
  EA.konfirmasi = (o) => new Promise((selesai) => {
    let ok = false;
    const m = EA.modal({
      judul: o.judul, kelas: 'kecil', ikon: o.bahaya ? 'awas' : (o.ikon || 'info'),
      isi: h`<p style="margin:0 0 12px">${o.pesan || ''}</p>${o.input ? h`<div class="f"><label>${o.input.label}${o.input.wajib ? h` <span class="w">*</span>` : ''}</label>
        <textarea id="kf-in" rows="3" placeholder="${o.input.placeholder || ''}" maxlength="${o.input.maks || 300}"></textarea><div class="salah" id="kf-err"></div></div>` : ''}`,
      kaki: h`<button class="btn g" data-batal>Batal</button><button class="btn ${o.bahaya ? 'b' : 'p'}" id="kf-ya">${o.ya || 'Ya, lanjutkan'}</button>`,
      onTutup: () => selesai({ ok, nilai: o.input ? EA.$('#kf-in', m.el).value.trim() : '' })
    });
    EA.$('#kf-ya', m.el).onclick = () => {
      if (o.input && o.input.wajib) {
        const v = EA.$('#kf-in', m.el).value.trim();
        if (v.length < (o.input.min || 1)) { EA.$('#kf-err', m.el).textContent = o.input.pesanMin || 'Wajib diisi.'; return; }
      }
      ok = true; m.tutup();
    };
  });

  /* ---------- Tombol sibuk ---------- */
  EA.sibuk = async (btn, fn, teks) => {
    if (!btn || btn.disabled) return;
    const asal = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="putar"></span>' + (teks ? EA.esc(teks) : '');
    try { return await fn(); } finally { if (btn.isConnected) { btn.disabled = false; btn.innerHTML = asal; } }
  };

  /* ---------- Lencana ---------- */
  EA.lcSifat = (s) => h`<span class="lc s-${s}">${s === 'Rahasia' ? ik('gembok', 'k') : s === 'Segera' ? ik('petir', 'k') : ''}${s || '-'}</span>`;
  EA.lcStatus = (s) => h`<span class="lc st-${String(s || '').replace(/\s/g, '')}">${s || '-'}</span>`;
  EA.lcPeran = (p) => h`<span class="lc p-${p}">${p}</span>`;
  EA.kosong = (ikon, judul, teks, aksi) => h`<div class="kosong"><div class="ik-k">${ik(ikon || 'arsip', 'b')}</div><b>${judul}</b>${teks || ''}${aksi ? h`<div style="margin-top:14px">${aksi}</div>` : ''}</div>`;

  /** Paginasi: tombol [data-hal]. */
  EA.paginasi = (total, hal, per) => {
    const n = Math.max(1, Math.ceil(total / per));
    if (n <= 1) return h``;
    const daftar = [];
    for (let i = 1; i <= n; i++) if (i === 1 || i === n || Math.abs(i - hal) <= 1) daftar.push(i); else if (daftar[daftar.length - 1] !== '…') daftar.push('…');
    return h`<div class="hal"><button data-hal="${hal - 1}" ${hal <= 1 ? 'disabled' : ''} aria-label="Sebelumnya">${ik('kiri', 'k')}</button>
      ${daftar.map((x) => (x === '…' ? h`<span class="el">…</span>` : h`<button data-hal="${x}" class="${x === hal ? 'on' : ''}">${x}</button>`))}
      <button data-hal="${hal + 1}" ${hal >= n ? 'disabled' : ''} aria-label="Berikutnya">${ik('kanan', 'k')}</button></div>`;
  };

  /* ---------- Menu tarik (dropdown) ---------- */
  let menuAktif = null;
  EA.menuTarik = (anchor, isi, kelas) => {
    if (menuAktif) { const lama = menuAktif; menuAktif = null; lama.remove(); if (lama._anchor === anchor) return null; }
    const m = document.createElement('div');
    m.className = 'menu-tarik ' + (kelas || '');
    EA.html(m, isi);
    m._anchor = anchor;
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    const lebar = m.offsetWidth;
    m.style.top = (window.scrollY + r.bottom + 8) + 'px';
    m.style.left = Math.max(8, Math.min(window.innerWidth - lebar - 8, r.right - lebar)) + 'px';
    menuAktif = m;
    setTimeout(() => {
      const tutup = (e) => { if (!m.contains(e.target) || e.target.closest('a,button[data-tutup-menu]')) { m.remove(); if (menuAktif === m) menuAktif = null; document.removeEventListener('click', tutup, true); } };
      document.addEventListener('click', tutup, true);
    }, 0);
    return m;
  };
  EA.tutupMenu = () => { if (menuAktif) { menuAktif.remove(); menuAktif = null; } };

  /* ---------- Pilihan bercari (combobox) ---------- */
  EA.pilihCari = (wadah, o) => {
    let nilai = o.nilai || '';
    wadah.classList.add('cb');
    wadah.innerHTML = h`<input class="in" type="text" autocomplete="off" placeholder="${o.placeholder || 'Ketik untuk mencari…'}" aria-autocomplete="list" ${o.id ? h`id="${o.id}"` : ''}><div class="cb-daftar" hidden></div>`.s;
    const inp = wadah.querySelector('input'), daf = wadah.querySelector('.cb-daftar');
    const label = (v) => { const x = o.opsi().find((p) => p.nilai === v); return x ? x.label : v; };
    inp.value = nilai ? label(nilai) : '';
    let aktif = -1, daftar = [];
    const gambar = () => {
      const q = EA.norm(inp.value === label(nilai) ? '' : inp.value);
      daftar = o.opsi().filter((p) => !q || EA.norm(p.nilai + ' ' + p.cari).indexOf(q) > -1).slice(0, 60);
      aktif = daftar.findIndex((p) => p.nilai === nilai);
      daf.innerHTML = daftar.length ? daftar.map((p, i) => h`<button type="button" data-i="${i}" class="${i === aktif ? 'on' : ''}"><b>${p.nilai}</b><span>${p.teks}</span></button>`).join('') : '<div class="kosong-cb">Tidak ditemukan</div>';
      daf.hidden = false;
    };
    const pilih = (p) => { nilai = p.nilai; inp.value = p.label; daf.hidden = true; if (o.onUbah) o.onUbah(nilai); };
    inp.addEventListener('focus', () => { inp.select(); gambar(); });
    inp.addEventListener('input', gambar);
    inp.addEventListener('keydown', (e) => {
      if (daf.hidden) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); aktif = Math.max(0, Math.min(daftar.length - 1, aktif + (e.key === 'ArrowDown' ? 1 : -1))); EA.$$('button', daf).forEach((b, i) => b.classList.toggle('on', i === aktif)); const b = daf.children[aktif]; if (b && b.scrollIntoView) b.scrollIntoView({ block: 'nearest' }); }
      if (e.key === 'Enter') { e.preventDefault(); if (daftar[aktif]) pilih(daftar[aktif]); else if (daftar.length === 1) pilih(daftar[0]); }
      if (e.key === 'Escape') { daf.hidden = true; }
    });
    daf.addEventListener('mousedown', (e) => { const b = e.target.closest('button[data-i]'); if (b) { e.preventDefault(); pilih(daftar[Number(b.dataset.i)]); } });
    inp.addEventListener('blur', () => setTimeout(() => { daf.hidden = true; inp.value = nilai ? label(nilai) : ''; }, 120));
    return { nilai: () => nilai, setNilai: (v) => { nilai = v; inp.value = v ? label(v) : ''; }, input: inp };
  };
  EA.opsiKlasifikasi = () => (EA.S.mst.klasifikasi || []).filter((k) => k.Aktif !== false).map((k) => ({ nilai: k.Kode, label: k.Kode + ' – ' + k.Uraian, teks: k.Uraian, cari: k.Uraian }));

  /* ---------- Pemindai: kamera & unggah, gabung jadi 1 PDF (FR-13) ---------- */
  const MAKS = 10 * 1024 * 1024;
  async function kompres(file, putar) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) {
      bmp = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Gambar tidak dapat dibaca')); im.src = URL.createObjectURL(file); });
    }
    const sw = bmp.width, sh = bmp.height, sk = Math.min(1, 1700 / Math.max(sw, sh));
    const dw = Math.round(sw * sk), dh = Math.round(sh * sk), tegak = putar % 180 !== 0;
    const c = document.createElement('canvas');
    c.width = tegak ? dh : dw; c.height = tegak ? dw : dh;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.translate(c.width / 2, c.height / 2); x.rotate((putar * Math.PI) / 180);
    x.drawImage(bmp, -dw / 2, -dh / 2, dw, dh);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.72));
    return { blob, w: c.width, h: c.height };
  }
  EA.Pemindai = function (wadah, o) {
    o = o || {};
    const hal = []; // {jenis:'img'|'pdf', asli:File, blob, url, putar, nama, ukuran}
    const self = this;
    wadah.innerHTML = h`<div class="pindai">
      <div class="pindai-h"><b>${ik('kamera')} ${o.judul || 'Pindai / Unggah Berkas'}</b>
        <div class="baris-flex"><button type="button" class="btn l k" data-kamera>${ik('kamera', 'k')} Ambil Foto</button>
        <button type="button" class="btn k" data-pilih>${ik('klip', 'k')} Pilih Berkas (PDF/JPG/PNG)</button></div></div>
      <input type="file" accept="image/*" capture="environment" hidden data-in-kamera>
      <input type="file" accept="application/pdf,image/jpeg,image/png" multiple hidden data-in-berkas>
      <div class="thumbs"></div><div class="kotak-info hijau" style="margin-top:12px" hidden data-ringkas></div></div>`.s;
    const thumbs = wadah.querySelector('.thumbs'), ringkas = wadah.querySelector('[data-ringkas]');
    const inKam = wadah.querySelector('[data-in-kamera]'), inBer = wadah.querySelector('[data-in-berkas]');
    wadah.querySelector('[data-kamera]').onclick = () => inKam.click();
    wadah.querySelector('[data-pilih]').onclick = () => inBer.click();
    const tambah = async (files) => {
      for (const f of Array.from(files)) {
        if (f.type === 'application/pdf') {
          if (f.size > MAKS) { EA.toast('PDF ' + f.name + ' melebihi 10 MB.', 'galat'); continue; }
          hal.push({ jenis: 'pdf', asli: f, blob: f, nama: f.name, ukuran: f.size });
        } else if (/^image\/(jpeg|png|webp|heic|heif)/.test(f.type) || /\.(jpe?g|png|heic)$/i.test(f.name)) {
          try { const k = await kompres(f, 0); hal.push({ jenis: 'img', asli: f, blob: k.blob, url: URL.createObjectURL(k.blob), putar: 0, nama: f.name, ukuran: k.blob.size }); } catch (e) { EA.toast('Gambar ' + f.name + ' tidak dapat dibaca.', 'galat'); }
        } else EA.toast('Jenis berkas tidak didukung: ' + f.name, 'galat');
      }
      gambar();
    };
    inKam.onchange = () => { tambah(inKam.files); inKam.value = ''; };
    inBer.onchange = () => { tambah(inBer.files); inBer.value = ''; };
    thumbs.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.tambah !== undefined) { inKam.click(); return; }
      const i = Number(b.dataset.i), p = hal[i];
      if (b.dataset.hapus !== undefined) { if (p.url) URL.revokeObjectURL(p.url); hal.splice(i, 1); gambar(); }
      if (b.dataset.putar !== undefined && p.jenis === 'img') {
        p.putar = (p.putar + 90) % 360;
        const k = await kompres(p.asli, p.putar);
        URL.revokeObjectURL(p.url); p.blob = k.blob; p.url = URL.createObjectURL(k.blob); p.ukuran = k.blob.size; gambar();
      }
    });
    function gambar() {
      thumbs.innerHTML = hal.map((p, i) => h`<div class="thumb"><span class="lbl-h">Hal ${i + 1}</span>
        <div class="tb-aksi">${p.jenis === 'img' ? h`<button type="button" data-putar data-i="${i}" aria-label="Putar">${ik('putar')}</button>` : ''}<button type="button" class="hapus" data-hapus data-i="${i}" aria-label="Hapus">${ik('sampah')}</button></div>
        ${p.jenis === 'img' ? h`<img src="${p.url}" alt="Halaman ${i + 1}">` : h`<div class="pdf-ik">${ik('pdf', 'b')}<span>${p.nama}</span></div>`}
        <span class="ukuran">${EA.ukuran(p.ukuran)}</span></div>`).join('') +
        h`<button type="button" class="tambah-hal" data-tambah>${ik('tambahL', 'b')}+ Tambah Hal ${hal.length + 1}<span>Pindai lanjutan</span></button>`.s;
      const total = hal.reduce((a, p) => a + p.ukuran, 0);
      ringkas.hidden = !hal.length;
      EA.html(ringkas, h`${ik('cekL')}<div>${hal.length} halaman siap digabung otomatis menjadi 1 PDF (±${EA.ukuran(total)})</div>`);
      if (o.onUbah) o.onUbah(hal.length);
    }
    gambar();
    self.jumlah = () => hal.length;
    self.kosongkan = () => { hal.splice(0).forEach((p) => p.url && URL.revokeObjectURL(p.url)); gambar(); };
    /** Gabungkan semua halaman → {mime, b64, ukuran}. */
    self.hasil = async () => {
      if (!hal.length) return null;
      if (hal.length === 1 && hal[0].jenis === 'pdf') return { mime: 'application/pdf', b64: await EA.berkasKeB64(hal[0].blob), ukuran: hal[0].ukuran };
      await EA.muatSkrip('js/vendor/pdf-lib.min.js');
      const doc = await w.PDFLib.PDFDocument.create();
      for (const p of hal) {
        const buf = await p.blob.arrayBuffer();
        if (p.jenis === 'pdf') {
          const src = await w.PDFLib.PDFDocument.load(buf, { ignoreEncryption: true });
          (await doc.copyPages(src, src.getPageIndices())).forEach((pg) => doc.addPage(pg));
        } else {
          const img = await doc.embedJpg(buf);
          const lebar = 595.28, tinggi = (img.height / img.width) * lebar;
          const pg = doc.addPage([lebar, tinggi]);
          pg.drawImage(img, { x: 0, y: 0, width: lebar, height: tinggi });
        }
      }
      const bytes = await doc.save();
      if (bytes.length > MAKS) throw new Error('Ukuran PDF gabungan ' + EA.ukuran(bytes.length) + ' melebihi 10 MB. Kurangi jumlah halaman.');
      return { mime: 'application/pdf', b64: await EA.berkasKeB64(new Blob([bytes], { type: 'application/pdf' })), ukuran: bytes.length };
    };
  };

  /* ---------- Pratinjau berkas (cache IndexedDB) ---------- */
  const BATAS_CACHE = 80 * 1024 * 1024;
  async function cacheBerkas(kunci, blob) {
    const idx = (await EA.kv.get('berkas-indeks')) || [];
    idx.push({ k: kunci, u: blob.size, t: Date.now() });
    let total = idx.reduce((a, x) => a + x.u, 0);
    while (total > BATAS_CACHE && idx.length > 1) { const x = idx.shift(); total -= x.u; await EA.kv.del(x.k); }
    await EA.kv.set(kunci, blob);
    await EA.kv.set('berkas-indeks', idx);
  }
  /** Ambil berkas lewat API (potongan 3 MB) → Blob. */
  EA.ambilBerkas = async (jenis, id, fileId, onProg) => {
    const kunci = 'berkas:' + jenis + ':' + id + ':' + (fileId || '');
    const ada = await EA.kv.get(kunci);
    if (ada instanceof Blob && ada.size) return { blob: ada, nama: id, mime: ada.type };
    const bagian = [];
    let total = 1, mime = 'application/pdf', nama = id;
    for (let i = 0; i < total; i++) {
      const r = await EA.api.baca('berkas.unduh', { jenis, id, bagian: i });
      total = r.total; mime = r.mime; nama = r.nama;
      bagian.push(EA.b64KeBlob(r.b64, mime));
      if (onProg) onProg((i + 1) / total);
    }
    const blob = new Blob(bagian, { type: mime });
    cacheBerkas(kunci, blob).catch(() => {});
    return { blob, nama, mime };
  };
  let pdfjsP = null;
  const pdfjs = () => pdfjsP || (pdfjsP = import(new URL('js/vendor/pdfjs/pdf.min.mjs', location.href).href).then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL('js/vendor/pdfjs/pdf.worker.min.mjs', location.href).href;
    return m;
  }).catch((e) => { pdfjsP = null; throw e; }));
  /** Tampilkan Blob (PDF/gambar) di wadah. */
  EA.tampilBlob = async (el, blob, nama) => {
    const url = URL.createObjectURL(blob);
    const tombol = h`<div class="baris-flex" style="padding:8px 10px;border-top:1px solid var(--garis);background:#fff;justify-content:flex-end">
      <a class="btn k" href="${url}" target="_blank" rel="noopener">${ik('tautan', 'k')} Buka</a>
      <button class="btn k" type="button" data-unduh-blob>${ik('unduh', 'k')} Unduh</button></div>`;
    const pasangUnduh = () => { const b = el.querySelector('[data-unduh-blob]'); if (b) b.onclick = () => EA.unduhBlob(blob, nama || 'berkas'); };
    if (/^image\//.test(blob.type)) { EA.html(el, h`<img src="${url}" alt="Pratinjau scan">${tombol}`); pasangUnduh(); return; }
    const bawaan = navigator.pdfViewerEnabled === true && !matchMedia('(pointer: coarse)').matches && window.innerWidth >= 768;
    if (bawaan) { EA.html(el, h`<iframe title="Pratinjau dokumen" src="${url}#view=FitH"></iframe>${tombol}`); pasangUnduh(); return; }
    EA.html(el, h`<div class="tengah"><div class="putar gelap"></div><span>Menyiapkan pratinjau…</span></div>`);
    try {
      const lib = await pdfjs();
      const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
      EA.html(el, h`<div class="hal-pdf"></div>${tombol}`);
      pasangUnduh();
      const wad = el.querySelector('.hal-pdf');
      const io = 'IntersectionObserver' in w ? new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) { io.unobserve(en.target); gambarHal(en.target); } }), { root: wad, rootMargin: '400px' }) : null;
      const gambarHal = async (cv) => {
        const pg = await doc.getPage(Number(cv.dataset.p));
        const v1 = pg.getViewport({ scale: 1 });
        const skala = Math.min(2.2, ((wad.clientWidth || 600) - 20) / v1.width * Math.min(2, w.devicePixelRatio || 1));
        const vp = pg.getViewport({ scale: skala });
        cv.width = vp.width; cv.height = vp.height;
        await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      };
      for (let i = 1; i <= doc.numPages; i++) {
        const cv = document.createElement('canvas');
        cv.dataset.p = i; cv.setAttribute('aria-label', 'Halaman ' + i);
        cv.width = 600; cv.height = 848;
        wad.appendChild(cv);
        if (io && i > 1) io.observe(cv); else gambarHal(cv);
      }
    } catch (e) {
      console.warn(e);
      EA.html(el, h`<div class="tengah">${ik('pdf', 'b')}<span>Pratinjau tidak tersedia di perangkat ini.</span></div>${tombol}`);
      pasangUnduh();
    }
  };
  /** Pratinjau scan berdasarkan rujukan (akses dicek server). */
  EA.pratinjau = async (el, jenis, id, fileId) => {
    if (!fileId) { EA.html(el, h`<div class="tengah">${ik('berkas', 'b')}<span>Belum ada scan.</span></div>`); return; }
    if (fileId === 'DUMMY') { EA.html(el, h`<div class="tengah">${ik('berkas', 'b')}<span>Data dummy — tidak ada berkas.</span></div>`); return; }
    EA.html(el, h`<div class="tengah"><div class="putar gelap"></div><span>Memuat scan…</span><div class="prog"><i></i></div></div>`);
    try {
      const r = await EA.ambilBerkas(jenis, id, fileId, (p) => { const i = el.querySelector('.prog i'); if (i) i.style.width = Math.round(p * 100) + '%'; });
      if (!el.isConnected) return;
      await EA.tampilBlob(el, r.blob, r.nama);
    } catch (e) {
      if (el.isConnected) EA.html(el, h`<div class="tengah">${ik('galat', 'b')}<span>${e.message}</span><button class="btn k" type="button" data-ulang-pratinjau>Coba lagi</button></div>`);
      const b = el.querySelector('[data-ulang-pratinjau]'); if (b) b.onclick = () => EA.pratinjau(el, jenis, id, fileId);
    }
  };
})(window);
