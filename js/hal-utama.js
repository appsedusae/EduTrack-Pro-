/* hal-utama.js — Dashboard, Surat Masuk, Disposisi, Surat Keluar, dan Arsip.
   Semua daftar & statistik dihitung dari data lokal (instan); aksi tulis memperbarui data lokal dari respons server. */
(function (w) {
  'use strict';
  const EA = w.EA, S = EA.S, h = EA.h, ik = EA.ikon, D = EA.data;
  EA.hal = EA.hal || {};
  const WARNA = { masuk: '#2563EB', keluar: '#16A34A', tepat: '#16A34A', telat: '#B91C1C' };
  const WARNA_SIFAT = { Biasa: '#0891B2', Penting: '#FB923C', Segera: '#B91C1C', Rahasia: '#7C3AED' };
  const SIFAT = ['Biasa', 'Penting', 'Segera', 'Rahasia'];
  const INSTRUKSI = ['Untuk diketahui', 'Tindak lanjuti', 'Koordinasikan', 'Siapkan jawaban', 'Wakili/hadiri', 'Arsipkan'];
  const IKON_BIDANG = ['sekolah', 'grup', 'alat', 'toa', 'map', 'dompet', 'toga', 'gedung'];
  const per = 20;

  /* ================= Panel detail (laci) terhubung dengan rute ================= */
  EA.panel = null;
  EA.bukaPanel = (jenis, id, bangun) => {
    if (EA.panel && EA.panel.jenis === jenis && EA.panel.id === id) { EA.panel.segar(); return; }
    EA.tutupPanel(true);
    const obj = EA.laci({ judul: 'Memuat…', lebar: true, onTutup: () => { EA.panel = null; EA.kembaliKeDaftar(); } });
    EA.panel = { jenis, id, obj, segar: () => { if (obj.el.isConnected) bangun(obj); } };
    bangun(obj);
  };
  EA.tutupPanel = (diam) => { if (EA.panel) { const p = EA.panel; EA.panel = null; p.obj.tutup(diam); } };
  EA.kembaliKeDaftar = () => {
    const base = '#/' + (location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] || 'dashboard');
    if (location.hash === base) return;
    if (EA.navDariDaftar) { EA.navDariDaftar = false; history.back(); }
    else { history.replaceState(null, '', base); EA.rute(); }
  };
  EA.keDetail = (hash) => { EA.navDariDaftar = true; location.hash = hash; };

  /* ================= Utilitas bersama ================= */
  const cocokQ = (teks, q) => { if (!q) return true; const t = EA.norm(teks); return q.split(' ').every((k) => t.indexOf(k) > -1); };
  const sapa = () => { const j = Number(EA.jam(Date.now()).slice(0, 2)); return j < 11 ? 'Selamat pagi' : j < 15 ? 'Selamat siang' : j < 18 ? 'Selamat sore' : 'Selamat malam'; };
  const tren = (a, b) => {
    if (!b) return a ? h`${ik('naik', 'k')} baru bulan ini` : h`— sama dengan bln lalu`;
    const p = ((a - b) / b) * 100;
    return h`${ik(p >= 0 ? 'naik' : 'turun', 'k')} ${EA.desimal(Math.abs(p))}% vs bln lalu`;
  };
  const opsiTahun = (pilih) => {
    const daftar = Array.from(new Set([EA.tahunIni(), ...(S.meta.tahunList || [])])).sort((a, b) => b - a);
    return daftar.map((t) => h`<option value="${t}" ${t === pilih ? 'selected' : ''}>Tahun ${t}</option>`);
  };
  const kodeBidangDsp = (list) => Array.from(new Set(list.map((d) => D.kodeBidang(d.KepadaBidang)))).join(', ');
  const statusSmTampil = (sm, dsps) => {
    if (sm.StatusDisposisi !== 'Selesai' && dsps.some(D.terlambat)) return 'Terlambat';
    return sm.StatusDisposisi || 'Belum';
  };
  const lcCountdown = (d) => { const c = D.hitungMundur(d); return h`<span class="hitung ${c.kelas}">${ik(c.kelas === 'telat' ? 'awas' : c.kelas === 'selesai' ? 'cekL' : 'jam', 'k')} ${c.teks}</span>`; };
  async function cetakLembar(idSm, btn) {
    await EA.sibuk(btn, async () => {
      try {
        const r = await EA.api.baca('dsp.lembar', { idSuratMasuk: idSm });
        const blob = EA.b64KeBlob(r.b64, 'application/pdf');
        const m = EA.modal({ judul: 'Lembar Disposisi', sub: 'PDF ber-QR — siap dicetak atau diunduh', ikon: 'cetak', kelas: 'lebar', isi: h`<div class="pratinjau" id="pr-ld"></div>`,
          kaki: h`<button class="btn" data-batal>Tutup</button><button class="btn" id="ld-unduh">${ik('unduh', 'k')} Unduh PDF</button><a class="btn p" id="ld-cetak" target="_blank" rel="noopener">${ik('cetak', 'k')} Buka & Cetak</a>` });
        EA.tampilBlob(EA.$('#pr-ld', m.el), blob, r.nama);
        EA.$('#ld-unduh', m.el).onclick = () => EA.unduhBlob(blob, r.nama);
        EA.$('#ld-cetak', m.el).href = URL.createObjectURL(blob);
      } catch (e) { EA.galat(e); }
    }, ' Menyiapkan…');
  }
  EA.cetakLembar = cetakLembar;
  /** Setelah aksi yang membuat notifikasi: kirim antrean WA di latar belakang (tidak menahan UI). */
  EA.kurasNotif = (nq) => { if (nq) setTimeout(() => EA.api.panggil('notif.kuras', {}, { ulang: 0, timeout: 45000 }).catch(() => {}), 300); };

  /* ================= DASHBOARD ================= */
  const stDash = { tren: 'bulan', donat: 'bulan', ring: 'bulan', asal: 'bulan' };
  function hitungDasbor() {
    const th = S.th, hari = EA.hariIni(), bln = EA.bulanIni(), lalu = EA.bulanSebelum(bln);
    const sm = D.smAktif(th), skSemua = D.sk(th), sk = skSemua.filter((x) => x.Status !== 'Batal'), dsp = D.dsp(th).filter((d) => D.smById(d.IDSuratMasuk) && !D.smById(d.IDSuratMasuk).Dihapus);
    const smL = lalu.slice(0, 4) !== String(th) && D.dimuat(th - 1) ? D.smAktif(th - 1) : sm;
    const skL = lalu.slice(0, 4) !== String(th) && D.dimuat(th - 1) ? D.sk(th - 1).filter((x) => x.Status !== 'Batal') : sk;
    const nHari = Number(hari.slice(8, 10));
    const harian = (arr, f) => { const a = new Array(nHari).fill(0); arr.forEach((x) => { const t = f(x); if (t && t.slice(0, 7) === bln) a[Number(t.slice(8, 10)) - 1]++; }); return a; };
    const bulanan = (arr, f) => { const a = new Array(12).fill(0); arr.forEach((x) => { const t = f(x); if (t && t.slice(0, 4) === String(th)) a[Number(t.slice(5, 7)) - 1]++; }); return a; };
    const selesai = dsp.filter((d) => d.Status === 'Selesai' && d.TglSelesai && d.TglDikirim);
    const rata = (arr) => (arr.length ? arr.reduce((a, d) => a + (d.TglSelesai - d.TglDikirim) / 86400000, 0) / arr.length : 0);
    const selBln = selesai.filter((d) => EA.isoDariMs(d.TglSelesai).slice(0, 7) === bln), selLalu = selesai.filter((d) => EA.isoDariMs(d.TglSelesai).slice(0, 7) === lalu);
    return {
      th, hari, bln, sm, sk, skSemua, dsp,
      smBln: sm.filter((x) => x.TglTerima.slice(0, 7) === bln).length, smLalu: smL.filter((x) => x.TglTerima.slice(0, 7) === lalu).length,
      skBln: sk.filter((x) => x.TglSurat.slice(0, 7) === bln).length, skLalu: skL.filter((x) => x.TglSurat.slice(0, 7) === lalu).length,
      spSm: harian(sm, (x) => x.TglTerima), spSk: harian(sk, (x) => x.TglSurat), spDsp: harian(dsp, (d) => EA.isoDariMs(d.TglDikirim)),
      aktif: dsp.filter((d) => d.Status !== 'Selesai'), dspHariIni: dsp.filter((d) => EA.isoDariMs(d.TglDikirim) === hari).length,
      rataBln: rata(selBln), rataLalu: rata(selLalu), spRata: Array.from({ length: Number(bln.slice(5, 7)) }, (x, i) => rata(selesai.filter((d) => Number(EA.isoDariMs(d.TglSelesai).slice(5, 7)) === i + 1))),
      telat: dsp.filter(D.terlambat), bulananSm: bulanan(sm, (x) => x.TglTerima), bulananSk: bulanan(sk, (x) => x.TglSurat),
      spTelat: bulanan(dsp.filter((d) => D.terlambat(d) || (d.Status === 'Selesai' && !D.tepatWaktu(d))), (d) => d.BatasWaktu).slice(0, Number(bln.slice(5, 7))),
      selesai
    };
  }
  function kpiKartu(g, label, nilai, ikon, bawah, spark, aksi, satuan) {
    return h`<${aksi ? 'button' : 'div'} class="kpi ${g}" ${aksi ? h`data-aksi="${aksi}"` : ''}><div class="kpi-h"><div class="kpi-l">${label}</div><div class="kpi-ik">${ik(ikon)}</div></div>
      <div class="kpi-n angka">${nilai}${satuan ? h`<small>${satuan}</small>` : ''}</div><div class="kpi-t">${bawah}</div><div class="kpi-sp">${EA.grafik.spark(spark || [])}</div></${aksi ? 'button' : 'div'}>`;
  }
  EA.hal.dashboard = {
    judul: 'Dashboard',
    render(root) {
      if (EA.boleh.staf()) { this.renderStaf(root); return; }
      const bln = EA.bulanIni();
      if (bln.slice(5) === '01' && !D.dimuat(S.th - 1)) D.pastikan(S.th - 1).then(() => this.segar(root)).catch(() => {});
      root.innerHTML = '<div id="dash"></div>';
      root.onclick = (e) => {
        const t = e.target.closest('[data-aksi]'); if (!t) return;
        const a = t.dataset.aksi;
        if (a === 'catat') EA.formSM();
        else if (a === 'nomor') EA.modalAmbilNomor();
        else if (a === 'sm') location.hash = '#/surat-masuk';
        else if (a === 'sk') location.hash = '#/surat-keluar';
        else if (a === 'dsp') location.hash = '#/disposisi';
        else if (a === 'telat') location.hash = '#/disposisi?tab=telat';
        else if (a === 'arsip') location.hash = '#/arsip';
        else if (a === 'buka-sm') EA.keDetail('#/surat-masuk/' + t.dataset.id);
        else if (a === 'buka-sk') EA.keDetail('#/surat-keluar/' + t.dataset.id);
      };
      root.onchange = (e) => { const s = e.target.closest('[data-periode]'); if (s) { stDash[s.dataset.periode] = s.value; this.segar(root); } };
      this.segar(root);
    },
    segar(root) {
      if (EA.boleh.staf()) { this.segarStaf(root); return; }
      const el = EA.$('#dash', root); if (!el) return;
      const g = hitungDasbor(), u = S.user, th = g.th;
      const pilih = (k, opsi) => h`<select class="pilih-periode" data-periode="${k}" aria-label="Periode">${opsi.map(([v, l]) => h`<option value="${v}" ${stDash[k] === v ? 'selected' : ''}>${l}</option>`)}</select>`;
      const dalam = (k, iso) => (stDash[k] === 'bulan' ? iso.slice(0, 7) === g.bln : iso.slice(0, 4) === String(th));
      // komposisi sifat (masuk + keluar)
      const komp = SIFAT.map((s) => ({ nama: s, warna: WARNA_SIFAT[s], nilai: g.sm.filter((x) => x.Sifat === s && dalam('donat', x.TglTerima)).length + g.sk.filter((x) => x.Sifat === s && dalam('donat', x.TglSurat)).length }));
      const totKomp = komp.reduce((a, x) => a + x.nilai, 0);
      // ringkasan status disposisi
      const dspR = stDash.ring === 'aktif' ? g.dsp.filter((d) => d.Status !== 'Selesai') : g.dsp.filter((d) => dalam('ring', EA.isoDariMs(d.TglDikirim)));
      const nSt = (s) => dspR.filter((d) => d.Status === s).length;
      // asal terbanyak
      const peta = new Map();
      g.sm.filter((x) => dalam('asal', x.TglTerima)).forEach((x) => { const k = EA.normKunci(x.AsalSurat); const o = peta.get(k) || { nama: x.AsalSurat, n: 0 }; o.n++; peta.set(k, o); });
      const asal = Array.from(peta.values()).sort((a, b) => b.n - a.n).slice(0, 5), totAsal = g.sm.filter((x) => dalam('asal', x.TglTerima)).length;
      // arsip
      const smScan = g.sm.filter((x) => x.FileID).length, skNonBatal = g.sk.length, skScan = g.sk.filter((x) => x.FileID).length;
      const skTanpaScan7 = g.sk.filter((x) => x.Status === 'Nomor Diambil' && Date.now() - x.DibuatPada > 7 * 86400000);
      // mendesak
      const besok = EA.tambahHari(g.hari, 1);
      const mendesak = g.dsp.filter((d) => d.Status !== 'Selesai' && d.BatasWaktu && d.BatasWaktu <= besok).sort((a, b) => (a.BatasWaktu < b.BatasWaktu ? -1 : 1));
      // terbaru
      const terbaru = g.sm.map((x) => ({ j: 'sm', t: x.DibuatPada, o: x })).concat(D.sk(th).map((x) => ({ j: 'sk', t: x.DibuatPada, o: x }))).sort((a, b) => b.t - a.t).slice(0, 6);
      // kinerja per bidang
      const kin = (S.mst.bidang || []).filter((b) => b.Aktif !== false).map((b) => {
        const ds = g.dsp.filter((d) => d.KepadaBidang === b.IDBidang);
        const tepat = ds.filter(D.tepatWaktu).length, telat = ds.filter((d) => (d.Status === 'Selesai' && !D.tepatWaktu(d)) || D.terlambat(d)).length;
        return { b, tepat, telat, tot: tepat + telat };
      }).filter((x) => x.tot);
      const lalu = h`${sapa()}, <b>${u.nama}</b> · Pantauan persuratan & disposisi ${EA.tglPanjang(g.hari)}.`;
      el.innerHTML = h`
      <div class="kepala kartu"><div><h1>Dashboard <span class="pill">Tahun ${th}</span></h1><p>${lalu}</p></div>
        <div class="aksi">${EA.boleh.ambilNomor() ? h`<button class="btn" data-aksi="nomor">${ik('pagar', 'k')} Ambil Nomor</button>` : ''}
        ${EA.boleh.catatSM() ? h`<button class="btn p" data-aksi="catat">${ik('tambahL', 'k')} Catat Surat Masuk</button>` : ''}
        ${EA.boleh.pimpinan() ? h`<button class="btn p" data-aksi="dsp">${ik('teruskan', 'k')} Beri Disposisi</button>` : ''}</div></div>
      <div class="kpi-baris">
        ${kpiKartu('g1', 'Surat Masuk Bulan Ini', EA.angka(g.smBln), 'masuk', tren(g.smBln, g.smLalu), g.spSm, 'sm')}
        ${kpiKartu('g2', 'Surat Keluar Bulan Ini', EA.angka(g.skBln), 'keluar', tren(g.skBln, g.skLalu), g.spSk, 'sk')}
        ${kpiKartu('g3', 'Disposisi Aktif', EA.angka(g.aktif.length), 'disposisi', h`${ik('tambahL', 'k')} ${g.dspHariIni} dikirim hari ini`, g.spDsp, 'dsp')}
        ${kpiKartu('g4', 'Rata-rata Waktu Selesai', EA.desimal(g.rataBln), 'jampasir', g.rataLalu ? h`${ik(g.rataBln <= g.rataLalu ? 'turun' : 'naik', 'k')} ${EA.desimal(Math.abs(g.rataBln - g.rataLalu))} hari ${g.rataBln <= g.rataLalu ? 'lebih cepat' : 'lebih lambat'}` : h`bulan ini`, g.spRata, 'dsp', 'hari')}
        ${kpiKartu('g5', 'Disposisi Terlambat', EA.angka(g.telat.length), 'awas', g.telat.length ? h`${ik('awas', 'k')} Tindak lanjuti` : h`${ik('cekL', 'k')} Semua tepat waktu`, g.spTelat, 'telat')}
        ${kpiKartu('g6', 'Total Arsip ' + th, EA.angka(g.sm.length + g.sk.length), 'arsip', h`${ik('naik', 'k')} ${EA.desimal(EA.persen(smScan + skScan, g.sm.length + skNonBatal))}% terscan`, g.bulananSm.map((v, i) => v + g.bulananSk[i]).slice(0, Number(g.bln.slice(5, 7))), 'arsip')}
      </div>
      <div class="g3k lebar-kiri">
        <div class="kartu"><div class="kartu-h"><div><h3>Tren Surat Masuk & Keluar</h3><div class="sub">${stDash.tren === 'bulan' ? 'Per hari, ' + EA.namaBulan(g.bln) : 'Per bulan, tahun ' + th}</div></div>${pilih('tren', [['bulan', 'Bulan Ini'], ['tahun', 'Tahun Ini']])}</div>
          <div class="kartu-b"><div class="legenda" style="margin-bottom:6px"><span><i style="background:${WARNA.masuk}"></i>Masuk</span><span><i style="background:${WARNA.keluar}"></i>Keluar</span></div><div id="gr-tren"></div></div></div>
        <div class="kartu"><div class="kartu-h"><div><h3>Komposisi Sifat Surat</h3><div class="sub">${EA.angka(totKomp)} surat masuk & keluar</div></div>${pilih('donat', [['bulan', 'Bulan Ini'], ['tahun', 'Tahun Ini']])}</div>
          <div class="kartu-b cq"><div class="donat-wrap"><div id="gr-donat"></div><div class="donat-leg">${komp.map((k) => h`<div class="d"><i style="background:${k.warna}"></i><span>${k.nama}</span><b>${EA.angka(k.nilai)}</b><small>${EA.desimal(EA.persen(k.nilai, totKomp))}%</small></div>`)}</div></div></div></div>
        <div class="kartu"><div class="kartu-h"><div><h3>Ringkasan Disposisi</h3></div>${pilih('ring', [['bulan', 'Bulan Ini'], ['tahun', 'Tahun Ini'], ['aktif', 'Masih aktif']])}</div>
          <div class="kartu-b"><div class="status-r">
            ${[['Baru', 'biru', 'lonceng'], ['Dibaca', 'teal', 'mata'], ['Diproses', 'oranye', 'jampasir'], ['Selesai', 'hijau', 'cekL']].map(([s, c, i]) => h`<div class="it" style="background:var(--latar)"><span class="ik-chip ${c}">${ik(i, 'k')}</span><b>${s}</b><span class="n angka">${EA.angka(nSt(s))}</span><small>tugas</small></div>`)}
          </div><p style="margin:14px 0 0;display:flex;justify-content:space-between;gap:8px;align-items:baseline"><span class="redup kecil">Total</span><b style="color:var(--sukses);font:700 18px var(--f-judul)">${EA.angka(dspR.length)} disposisi <small style="font-size:13px">(${EA.desimal(EA.persen(nSt('Selesai'), dspR.length))}% selesai)</small></b></p></div></div>
      </div>
      <div class="g3k">
        <div class="kartu"><div class="kartu-h"><div><h3>${ik('gedung')} 5 Asal Surat Terbanyak</h3></div>${pilih('asal', [['bulan', 'Bulan Ini'], ['tahun', 'Tahun Ini']])}</div>
          <div class="kartu-b">${asal.length ? h`<div class="rank">${asal.map((a, i) => h`<div class="r"><span class="no">#${i + 1}</span><span class="nm" title="${a.nama}">${a.nama}</span><b class="angka">${EA.angka(a.n)}</b><span class="pct">${EA.desimal(EA.persen(a.n, totAsal))}%</span></div>`)}</div>` : EA.kosong('gedung', 'Belum ada surat masuk', '')}</div>
          <div class="kartu-f"><a href="#/laporan">Lihat statistik lengkap →</a></div></div>
        <div class="kartu"><div class="kartu-h"><div><h3>${ik('awan')} Ringkasan Arsip</h3><div class="sub">Google Drive · tahun ${th}</div></div><span class="lc hijau">● Terhubung</span></div>
          <div class="kartu-b"><div class="ring-k"><span>Surat masuk terscan</span><b>${EA.angka(smScan)} / ${EA.angka(g.sm.length)} <small class="redup">(${EA.desimal(EA.persen(smScan, g.sm.length))}%)</small></b></div><div class="batang-prog"><i style="width:${EA.persen(smScan, g.sm.length)}%"></i></div>
            <div class="ring-k"><span>Surat keluar terscan</span><b>${EA.angka(skScan)} / ${EA.angka(skNonBatal)} <small class="redup">(${EA.desimal(EA.persen(skScan, skNonBatal))}%)</small></b></div><div class="batang-prog"><i class="hijau" style="width:${EA.persen(skScan, skNonBatal)}%"></i></div>
            ${g.sm.length - smScan || skTanpaScan7.length ? h`<div class="kotak-info kuning">${ik('awas')}<div>${g.sm.length - smScan ? h`<b>${g.sm.length - smScan}</b> surat masuk belum ada scan. ` : ''}${skTanpaScan7.length ? h`<b>${skTanpaScan7.length}</b> nomor keluar &gt; 7 hari belum ada scan.` : ''}</div></div>` : h`<div class="kotak-info hijau">${ik('cekL')}<div>Semua surat sudah terscan.</div></div>`}
            <p class="redup kecil" style="margin:12px 0 0">Nomor keluar terakhir: <b class="mono" style="color:var(--teks)">${(D.sk(th)[0] || {}).NomorSurat || '-'}</b></p></div>
          <div class="kartu-f"><a href="#/arsip">Buka arsip →</a></div></div>
        <div class="kartu alert"><div class="kartu-h"><div><h3>${ik('galat')} Disposisi Terlambat / Mendekati Batas</h3></div><span class="lc merah">${mendesak.length} item</span></div>
          <div class="kartu-b"><div class="stack" style="gap:8px">${mendesak.length ? mendesak.slice(0, 4).map((d) => {
            const sm = D.smById(d.IDSuratMasuk) || {}, n = EA.selisihHari(g.hari, d.BatasWaktu);
            return h`<button class="alert-i" data-aksi="buka-sm" data-id="${d.IDSuratMasuk}"><div class="a1"><b>${sm.Perihal || '-'}</b><span class="lc ${n < 0 ? 'merah' : 'kuning'}">${n < 0 ? 'Telat ' + (-n) + ' hari' : n === 0 ? 'Hari ini (H-0)' : 'Besok (H-1)'}</span></div>
              <div class="a2"><span>Tujuan: <b>${D.namaBidang(d.KepadaBidang)}</b></span><span class="bt">Batas: ${EA.tglBulan(d.BatasWaktu)}</span></div></button>`;
          }) : EA.kosong('cekL', 'Tidak ada yang mendesak', 'Semua disposisi masih dalam batas waktu.')}</div></div>
          <div class="kartu-f"><a href="#/disposisi?tab=telat" style="color:var(--bahaya-tua)">Tindak lanjuti semua disposisi →</a></div></div>
      </div>
      <div class="g3k">
        <div class="kartu"><div class="kartu-h"><div><h3>Surat per Bulan (${th})</h3><div class="sub">Perbandingan masuk & keluar</div></div><div class="legenda kotak"><span><i style="background:${WARNA.masuk}"></i>Masuk</span><span><i style="background:${WARNA.keluar}"></i>Keluar</span></div></div>
          <div class="kartu-b"><div id="gr-bulan"></div><p class="redup kecil" style="margin:8px 0 0">Rata-rata per bulan: <b>${EA.angka(Math.round((g.sm.length + g.sk.length) / Math.max(1, Number(g.bln.slice(5, 7)))))} surat</b></p></div></div>
        <div class="kartu"><div class="kartu-h"><div><h3>${ik('riwayat')} Surat Terbaru</h3></div><span class="redup kecil">Langsung</span></div>
          <div class="kartu-b"><div class="dl">${terbaru.length ? terbaru.map((x) => h`<button class="dl-i" data-aksi="${x.j === 'sm' ? 'buka-sm' : 'buka-sk'}" data-id="${x.o.ID}"><span class="ik-chip ${x.j === 'sm' ? 'biru' : 'hijau'}">${ik(x.j === 'sm' ? 'masuk' : 'keluar', 'k')}</span>
            <span class="isi-i"><b class="mono" style="color:var(--primer-tua);font-size:12px">${x.o.ID}</b><b>${x.j === 'sm' ? 'No: ' + x.o.NoSurat : x.o.NomorSurat}</b><span>${x.j === 'sm' ? 'Dari: ' + x.o.AsalSurat : 'Tujuan: ' + x.o.Tujuan} · ${EA.relatif(x.t)}</span></span>
            <span class="kanan">${EA.lcSifat(x.o.Sifat)}</span></button>`) : EA.kosong('surat', 'Belum ada surat', '')}</div></div>
          <div class="kartu-f"><a href="#/arsip">Lihat semua di Buku Agenda →</a></div></div>
        <div class="kartu"><div class="kartu-h"><div><h3>Kinerja per Bidang</h3><div class="sub">Ketepatan waktu disposisi ${th}</div></div><div class="legenda"><span><i style="background:${WARNA.tepat}"></i>Tepat</span><span><i style="background:${WARNA.telat}"></i>Telat</span></div></div>
          <div class="kartu-b">${kin.length ? h`<div class="kinerja">${kin.map((k) => h`<div class="kb" title="${k.b.NamaBidang}: ${k.tepat} tepat waktu, ${k.telat} terlambat"><div class="kb-h"><span>${k.b.NamaBidang}</span><b style="color:${EA.persen(k.tepat, k.tot) >= 80 ? WARNA.tepat : WARNA.telat}">${EA.desimal(EA.persen(k.tepat, k.tot))}%</b></div>
            <div class="kb-bar">${k.tepat ? h`<i style="width:${EA.persen(k.tepat, k.tot)}%;background:${WARNA.tepat}"></i>` : ''}${k.telat ? h`<i class="pola-telat" style="width:${EA.persen(k.telat, k.tot)}%;background-color:${WARNA.telat}"></i>` : ''}</div></div>`)}</div>` : EA.kosong('laporan', 'Belum ada disposisi', '')}</div>
          <div class="kartu-f"><a href="#/laporan">Laporan kinerja →</a></div></div>
      </div>`.s;
      // grafik
      const nTren = stDash.tren === 'bulan';
      const lbl = nTren ? g.spSm.map((x, i) => EA.pad(i + 1, 2)) : EA.BLN.slice(0, Number(g.bln.slice(5, 7)));
      EA.grafik.area(EA.$('#gr-tren', el), {
        label: lbl, judulX: nTren ? lbl.map((d) => d + ' ' + EA.namaBulan(g.bln)) : EA.BULAN.slice(0, lbl.length).map((b) => b + ' ' + th), tinggi: 230, aria: 'Tren surat masuk dan keluar',
        seri: [{ nama: 'Masuk', warna: WARNA.masuk, data: nTren ? g.spSm : g.bulananSm.slice(0, lbl.length) }, { nama: 'Keluar', warna: WARNA.keluar, data: nTren ? g.spSk : g.bulananSk.slice(0, lbl.length), putus: true }]
      });
      EA.grafik.donat(EA.$('#gr-donat', el), { data: komp, ukuran: window.innerWidth < 768 ? 130 : 160, tengah: 'SURAT', aria: 'Komposisi sifat surat' });
      EA.grafik.batang(EA.$('#gr-bulan', el), { label: EA.BLN, judulX: EA.BULAN.map((b) => b + ' ' + th), tinggi: 210, sorot: Number(g.bln.slice(5, 7)) - 1, aria: 'Surat per bulan', seri: [{ nama: 'Masuk', warna: WARNA.masuk, data: g.bulananSm }, { nama: 'Keluar', warna: WARNA.keluar, data: g.bulananSk }] });
    },
    renderStaf(root) {
      root.innerHTML = '<div id="dash"></div>';
      root.onclick = (e) => {
        const t = e.target.closest('[data-aksi]'); if (!t) return;
        const a = t.dataset.aksi;
        if (a === 'nomor') EA.modalAmbilNomor();
        else if (a === 'dsp') location.hash = '#/disposisi' + (t.dataset.tab ? '?tab=' + t.dataset.tab : '');
        else if (a === 'sk') location.hash = '#/surat-keluar';
        else if (a === 'buka-dsp') EA.keDetail('#/disposisi/' + t.dataset.id);
        else if (a === 'buka-sk') EA.keDetail('#/surat-keluar/' + t.dataset.id);
      };
      this.segarStaf(root);
    },
    segarStaf(root) {
      const el = EA.$('#dash', root); if (!el) return;
      const u = S.user, bln = EA.bulanIni();
      const dsp = D.semuaDsp().filter((d) => d.KepadaBidang === u.idBidang && D.smById(d.IDSuratMasuk));
      const baru = dsp.filter((d) => d.Status === 'Baru' || d.Status === 'Dibaca'), proses = dsp.filter((d) => d.Status === 'Diproses');
      const telat = dsp.filter(D.terlambat), selBln = dsp.filter((d) => d.Status === 'Selesai' && EA.isoDariMs(d.TglSelesai).slice(0, 7) === bln);
      const sk = D.sk(S.th).filter((x) => x.IDBidang === u.idBidang);
      const dekat = dsp.filter((d) => d.Status !== 'Selesai').sort((a, b) => (a.BatasWaktu < b.BatasWaktu ? -1 : 1)).slice(0, 6);
      const tunggu = sk.filter((x) => x.Status === 'Nomor Diambil').slice(0, 5);
      el.innerHTML = h`<div class="kepala kartu"><div><h1>Halo, ${u.nama.split(' ')[0]} <span class="pill">${u.namaBidang || 'Bidang'}</span></h1><p>${sapa()} · ${EA.tglPanjang(EA.hariIni())}. Berikut disposisi untuk bidang Anda.</p></div>
        <div class="aksi"><button class="btn" data-aksi="dsp">${ik('disposisi', 'k')} Kotak Disposisi</button><button class="btn p" data-aksi="nomor">${ik('pagar', 'k')} Ambil Nomor</button></div></div>
        <div class="kpi-baris k5">
          ${kpiKartu('g1', 'Disposisi Baru', EA.angka(baru.length), 'lonceng', h`${baru.filter((d) => d.Status === 'Baru').length} belum dibuka`, [], 'dsp')}
          ${kpiKartu('g3', 'Sedang Diproses', EA.angka(proses.length), 'jampasir', h`dalam pengerjaan`, [], 'dsp')}
          ${kpiKartu('g5', 'Terlambat', EA.angka(telat.length), 'awas', telat.length ? h`${ik('awas', 'k')} Segera selesaikan` : h`${ik('cekL', 'k')} Tidak ada`, [], 'dsp')}
          ${kpiKartu('g2', 'Selesai Bulan Ini', EA.angka(selBln.length), 'cekL', h`${EA.namaBulan(bln)}`, [], 'dsp')}
          ${kpiKartu('g6', 'Surat Keluar Bidang', EA.angka(sk.length), 'keluar', h`${sk.filter((x) => x.Status === 'Nomor Diambil').length} menunggu scan`, [], 'sk')}
        </div>
        <div class="g2k">
          <div class="kartu"><div class="kartu-h"><div><h3>${ik('jam')} Disposisi Terdekat Batas Waktu</h3><div class="sub">Urut dari batas paling dekat</div></div></div>
            <div class="kartu-b"><div class="dl">${dekat.length ? dekat.map((d) => { const sm = D.smById(d.IDSuratMasuk) || {}; return h`<button class="dl-i" data-aksi="buka-dsp" data-id="${d.ID}"><span class="ik-chip ${D.terlambat(d) ? 'merah' : 'biru'}">${ik('disposisi', 'k')}</span>
              <span class="isi-i"><b>${sm.Perihal || '-'}</b><span>${sm.AsalSurat || ''} · ${d.Instruksi}</span></span><span class="kanan">${EA.lcStatus(D.statusTampil(d))}${lcCountdown(d)}</span></button>`; }) : EA.kosong('cekL', 'Tidak ada disposisi aktif', 'Semua tugas bidang Anda sudah selesai.')}</div></div>
            <div class="kartu-f"><a href="#/disposisi">Buka kotak disposisi →</a></div></div>
          <div class="kartu"><div class="kartu-h"><div><h3>${ik('keluar')} Surat Keluar Menunggu Scan</h3><div class="sub">Unggah scan final agar berstatus Terkirim</div></div></div>
            <div class="kartu-b"><div class="dl">${tunggu.length ? tunggu.map((x) => h`<button class="dl-i" data-aksi="buka-sk" data-id="${x.ID}"><span class="ik-chip hijau">${ik('keluar', 'k')}</span><span class="isi-i"><b class="mono">${x.NomorSurat}</b><span>${x.Tujuan} · ${EA.tglPendek(x.TglSurat)}</span></span>
              <span class="kanan">${Date.now() - x.DibuatPada > 7 * 86400000 ? h`<span class="lc merah">${ik('awas', 'k')} &gt; 7 hari</span>` : EA.lcStatus(x.Status)}</span></button>`) : EA.kosong('cekL', 'Tidak ada yang menunggu', '')}</div></div>
            <div class="kartu-f"><a href="#/surat-keluar">Lihat surat keluar →</a></div></div>
        </div>`.s;
    }
  };

  /* ================= SURAT MASUK ================= */
  const fSM = { q: '', periode: '', dari: '', sampai: '', sifat: '', status: '', klas: '', th: null, hal: 1, urut: 'tgl', arah: -1, dihapus: false };
  function saringSM() {
    const th = fSM.th || S.th, q = EA.norm(fSM.q), hari = EA.hariIni(), bln = EA.bulanIni();
    let rows = D.sm(th).filter((x) => (fSM.dihapus ? x.Dihapus : !x.Dihapus));
    if (fSM.periode === 'bulan') rows = rows.filter((x) => x.TglTerima.slice(0, 7) === bln);
    if (fSM.periode === '7hari') rows = rows.filter((x) => x.TglTerima >= EA.tambahHari(hari, -6));
    if (fSM.periode === 'rentang') rows = rows.filter((x) => (!fSM.dari || x.TglTerima >= fSM.dari) && (!fSM.sampai || x.TglTerima <= fSM.sampai));
    if (fSM.sifat) rows = rows.filter((x) => x.Sifat === fSM.sifat);
    if (fSM.klas) rows = rows.filter((x) => x.KodeKlasifikasi === fSM.klas);
    if (fSM.status) rows = rows.filter((x) => (fSM.status === 'Terlambat' ? statusSmTampil(x, D.dspUntukSm(x.ID)) === 'Terlambat' : fSM.status === 'TanpaScan' ? !x.FileID : x.StatusDisposisi === fSM.status));
    if (q) rows = rows.filter((x) => cocokQ([x.NoAgenda, x.NoSurat, x.Perihal, x.AsalSurat, x.Lampiran, x.KodeKlasifikasi].join(' '), q));
    const k = { tgl: (x) => x.TglTerima + x.NoAgenda, agenda: (x) => x.NoAgenda, asal: (x) => EA.norm(x.AsalSurat), sifat: (x) => SIFAT.indexOf(x.Sifat) }[fSM.urut];
    return rows.slice().sort((a, b) => (k(a) > k(b) ? 1 : k(a) < k(b) ? -1 : 0) * fSM.arah);
  }
  EA.saringSM = saringSM;
  EA.hal['surat-masuk'] = {
    judul: 'Surat Masuk',
    render(root, p) {
      if (p.q) fSM.q = p.q;
      fSM.th = fSM.th || S.th;
      const klasOps = (S.mst.klasifikasi || []).map((k) => h`<option value="${k.Kode}" ${fSM.klas === k.Kode ? 'selected' : ''}>${k.Kode} – ${k.Uraian}</option>`);
      root.innerHTML = h`<div class="kepala"><div><span class="pill">● Tahun ${fSM.th}</span><h1 style="margin-top:8px">Surat Masuk</h1><p>Buku agenda kendali surat masuk dan jalur disposisi digital${S.cfg.NamaInstansi ? ' ' + S.cfg.NamaInstansi : ''}.</p></div>
        <div class="aksi">${EA.boleh.bukuAgenda() ? h`<button class="btn" data-aksi="buku">${ik('cetak', 'k')} Cetak Buku Agenda</button>` : ''}<button class="btn" data-aksi="ekspor">${ik('unduh', 'k')} Ekspor Excel</button>
        ${EA.boleh.catatSM() ? h`<button class="btn p" data-aksi="catat">${ik('tambahL', 'k')} Catat Surat Masuk</button>` : ''}</div></div>
        <div class="mini-kpi" id="sm-kpi"></div>
        <div class="kartu" style="margin-bottom:16px"><div class="saring">
          <label class="cari"><span class="sr">Cari</span>${ik('cari')}<input id="sm-q" type="search" placeholder="Cari nomor surat, perihal, asal instansi…" value="${fSM.q}"></label>
          <select id="sm-th" aria-label="Tahun">${opsiTahun(fSM.th)}</select>
          <select id="sm-periode" aria-label="Periode"><option value="">Semua tanggal</option><option value="bulan" ${fSM.periode === 'bulan' ? 'selected' : ''}>Bulan ini</option><option value="7hari" ${fSM.periode === '7hari' ? 'selected' : ''}>7 hari terakhir</option><option value="rentang" ${fSM.periode === 'rentang' ? 'selected' : ''}>Rentang tanggal…</option></select>
          <input type="date" id="sm-dari" value="${fSM.dari}" aria-label="Dari tanggal" ${fSM.periode === 'rentang' ? '' : 'hidden'}><input type="date" id="sm-sampai" value="${fSM.sampai}" aria-label="Sampai tanggal" ${fSM.periode === 'rentang' ? '' : 'hidden'}>
          <select id="sm-sifat" aria-label="Sifat"><option value="">Sifat: Semua</option>${SIFAT.map((s) => h`<option ${fSM.sifat === s ? 'selected' : ''}>${s}</option>`)}</select>
          <select id="sm-status" aria-label="Status disposisi"><option value="">Disposisi: Semua</option>${[['Belum', 'Belum didisposisi'], ['Proses', 'Dalam proses'], ['Selesai', 'Selesai'], ['Terlambat', 'Terlambat'], ['TanpaScan', 'Belum ada scan']].map(([v, l]) => h`<option value="${v}" ${fSM.status === v ? 'selected' : ''}>${l}</option>`)}</select>
          <select id="sm-klas" aria-label="Klasifikasi"><option value="">Klasifikasi: Semua</option>${klasOps}</select>
          ${EA.boleh.admin() ? h`<label class="cek kecil"><input type="checkbox" id="sm-del" ${fSM.dihapus ? 'checked' : ''}> Terhapus</label>` : ''}
          <button class="btn g k" data-aksi="reset">${ik('putarKiri', 'k')} Reset</button></div><div class="chip-aktif" id="sm-chip"></div></div>
        <div class="kartu"><div class="kartu-h" style="padding-bottom:12px"><h3>${ik('surat')} Daftar Registrasi Surat Masuk <span class="pill" id="sm-n">0</span></h3><span class="redup kecil" id="sm-sinkron"></span></div>
          <div id="sm-daftar"></div></div>
        ${EA.boleh.catatSM() ? h`<button class="fab" data-aksi="catat" aria-label="Catat surat masuk">${ik('tambah', 'b')}</button>` : ''}`.s;
      const ubah = () => { fSM.hal = 1; this.segar(root); };
      const qIn = EA.$('#sm-q', root);
      qIn.addEventListener('input', EA.debounce(() => { fSM.q = qIn.value; ubah(); }, 120));
      root.onchange = (e) => {
        const id = e.target.id;
        if (id === 'sm-th') { fSM.th = Number(e.target.value); D.pastikan(fSM.th).then(() => this.render(root, {})).catch(EA.galat); return; }
        if (id === 'sm-periode') { fSM.periode = e.target.value; EA.$('#sm-dari', root).hidden = EA.$('#sm-sampai', root).hidden = fSM.periode !== 'rentang'; }
        if (id === 'sm-dari') fSM.dari = e.target.value;
        if (id === 'sm-sampai') fSM.sampai = e.target.value;
        if (id === 'sm-sifat') fSM.sifat = e.target.value;
        if (id === 'sm-status') fSM.status = e.target.value;
        if (id === 'sm-klas') fSM.klas = e.target.value;
        if (id === 'sm-del') fSM.dihapus = e.target.checked;
        ubah();
      };
      root.onclick = (e) => {
        const t = e.target.closest('[data-aksi],[data-hal],[data-urut]'); if (!t) return;
        if (t.dataset.hal) { fSM.hal = Number(t.dataset.hal); this.segar(root); EA.$('#sm-daftar', root).scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
        if (t.dataset.urut) { fSM.arah = fSM.urut === t.dataset.urut ? -fSM.arah : -1; fSM.urut = t.dataset.urut; this.segar(root); return; }
        const a = t.dataset.aksi;
        if (a === 'catat') EA.formSM();
        else if (a === 'buka') EA.keDetail('#/surat-masuk/' + t.dataset.id);
        else if (a === 'buku') location.hash = '#/laporan?tab=buku&jenis=masuk';
        else if (a === 'ekspor') eksporSM(t);
        else if (a === 'reset') { Object.assign(fSM, { q: '', periode: '', dari: '', sampai: '', sifat: '', status: '', klas: '', hal: 1, dihapus: false }); this.render(root, {}); }
        else if (a === 'hapus-f') { fSM[t.dataset.k] = ''; if (t.dataset.k === 'periode') { fSM.dari = fSM.sampai = ''; } this.render(root, {}); }
        else if (a === 'kpi') { Object.assign(fSM, { status: t.dataset.status || '', sifat: '', periode: t.dataset.periode || '', hal: 1 }); this.render(root, {}); }
      };
      this.segar(root);
    },
    segar(root) {
      const daftar = EA.$('#sm-daftar', root); if (!daftar) return;
      const th = fSM.th || S.th, semua = D.smAktif(th), bln = EA.bulanIni();
      const nBln = semua.filter((x) => x.TglTerima.slice(0, 7) === bln).length, nLalu = semua.filter((x) => x.TglTerima.slice(0, 7) === EA.bulanSebelum(bln)).length;
      const belum = semua.filter((x) => x.StatusDisposisi === 'Belum').length, tanpa = semua.filter((x) => !x.FileID).length, sr = semua.filter((x) => (x.Sifat === 'Segera' || x.Sifat === 'Rahasia') && x.StatusDisposisi !== 'Selesai').length;
      EA.html(EA.$('#sm-kpi', root), h`
        <button class="mkpi b1" data-aksi="kpi" data-periode="bulan"><div class="l">Surat Masuk Bulan Ini</div><div class="n">${EA.angka(nBln)}<span>${tren(nBln, nLalu)}</span></div><div class="s">${EA.namaBulan(bln)}</div><div class="ik-bg">${ik('masuk')}</div></button>
        <button class="mkpi b2" data-aksi="kpi" data-status="Belum"><div class="l">Perlu Disposisi</div><div class="n">${EA.angka(belum)}<span>Menunggu pimpinan</span></div><div class="s">Belum didisposisikan</div><div class="ik-bg">${ik('disposisi')}</div></button>
        <button class="mkpi b3" data-aksi="kpi" data-status="TanpaScan"><div class="l">Belum Ada Scan</div><div class="n">${EA.angka(tanpa)}<span>Perlu unggah</span></div><div class="s">Dokumen fisik belum dipindai</div><div class="ik-bg">${ik('kamera')}</div></button>
        <button class="mkpi b4" data-aksi="kpi"><div class="l">Segera / Rahasia Aktif</div><div class="n">${EA.angka(sr)}<span>Prioritas</span></div><div class="s">Belum selesai ditindaklanjuti</div><div class="ik-bg">${ik('gembok')}</div></button>`);
      const chips = [];
      if (fSM.periode) chips.push(['periode', fSM.periode === 'bulan' ? 'Bulan ini' : fSM.periode === '7hari' ? '7 hari terakhir' : 'Rentang ' + (fSM.dari ? EA.tglPendek(fSM.dari) : '…') + ' – ' + (fSM.sampai ? EA.tglPendek(fSM.sampai) : '…')]);
      if (fSM.sifat) chips.push(['sifat', 'Sifat: ' + fSM.sifat]);
      if (fSM.status) chips.push(['status', 'Status: ' + fSM.status]);
      if (fSM.klas) chips.push(['klas', 'Klasifikasi: ' + fSM.klas]);
      if (fSM.q) chips.push(['q', 'Cari: ' + fSM.q]);
      EA.html(EA.$('#sm-chip', root), chips.length ? h`<span class="lbl">Filter aktif:</span>${chips.map(([k, l]) => h`<span class="chip-f">${l}<button data-aksi="hapus-f" data-k="${k}" aria-label="Hapus filter">${ik('x', 'k')}</button></span>`)}<button class="tautan" data-aksi="reset">Hapus semua filter</button>` : '');
      const rows = saringSM(), total = rows.length, n = Math.max(1, Math.ceil(total / per));
      if (fSM.hal > n) fSM.hal = n;
      const hal = rows.slice((fSM.hal - 1) * per, fSM.hal * per);
      EA.$('#sm-n', root).textContent = EA.angka(total) + ' berkas';
      EA.$('#sm-sinkron', root).textContent = S.sinkronTerakhir ? 'Diperbarui ' + EA.jam(S.sinkronTerakhir) : '';
      const kepala = (k, l) => h`<button data-urut="${k}">${l}${fSM.urut === k ? ik(fSM.arah > 0 ? 'naik' : 'turun', 'k') : ''}</button>`;
      if (!total) { EA.html(daftar, EA.kosong('masuk', D.dimuat(th) ? 'Tidak ada surat masuk' : 'Memuat data…', D.dimuat(th) ? 'Ubah filter atau catat surat baru.' : '')); return; }
      EA.html(daftar, h`<div class="tbl-wrap bisa-kartu"><table class="tbl"><thead><tr><th>${kepala('agenda', 'Agenda')}</th><th>${kepala('tgl', 'Tgl Terima')}</th><th>No. & Tgl Surat</th><th>${kepala('asal', 'Asal Instansi')}</th><th>Perihal / Ringkasan</th><th class="c">${kepala('sifat', 'Sifat')}</th><th>Disposisi</th></tr></thead><tbody>
        ${hal.map((x) => { const ds = D.dspUntukSm(x.ID), st = statusSmTampil(x, ds); return h`<tr data-aksi="buka" data-id="${x.ID}" class="${x.Dihapus ? 'dihapus' : ''}">
          <td><span class="agenda ${x.Sifat === 'Rahasia' ? 'rahasia' : ''}">${x.NoAgenda}</span></td>
          <td>${EA.tglPendek(x.TglTerima)}<div class="sub mono">${EA.jam(x.DibuatPada)} WIB</div></td>
          <td><span class="nomor">${x.NoSurat}</span><div class="sub">Tgl Surat: ${EA.tglPendek(x.TglSurat)}</div></td>
          <td class="asal">${x.AsalSurat}</td>
          <td><div class="perihal">${x.Sifat === 'Rahasia' ? ik('gembok', 'k') : ''}${x.Perihal}</div><div class="sub">${x.FileID ? h`${ik('klip', 'k')} Scan tersedia` : h`<span style="color:var(--bahaya-tua)">Belum ada scan</span>`}${x.Lampiran ? ' · ' + x.Lampiran : ''}</div></td>
          <td class="c">${EA.lcSifat(x.Sifat)}</td>
          <td>${EA.lcStatus(x.Dihapus ? 'Batal' : st)}${ds.length ? h`<span class="kode-b">${kodeBidangDsp(ds)}</span>` : ''}</td></tr>`; })}
        </tbody></table></div>
        <div class="kartu-hp">${hal.map((x) => { const ds = D.dspUntukSm(x.ID); return h`<button class="kh" data-aksi="buka" data-id="${x.ID}"><div class="kh-1"><span class="agenda mono tebal" style="color:var(--primer-tua)">${x.NoAgenda}</span>${EA.lcSifat(x.Sifat)}</div>
          <div class="kh-p">${x.Perihal}</div><div class="kh-s">${x.AsalSurat} · ${EA.tglPendek(x.TglTerima)}</div><div class="kh-f">${EA.lcStatus(statusSmTampil(x, ds))}${ds.length ? h`<span class="kode-b">${kodeBidangDsp(ds)}</span>` : ''}${x.FileID ? '' : h`<span class="lc merah">Tanpa scan</span>`}</div></button>`; })}</div>
        <div class="tbl-kaki"><span>Menampilkan <b>${(fSM.hal - 1) * per + 1}–${Math.min(total, fSM.hal * per)}</b> dari <b>${EA.angka(total)}</b> surat masuk</span>${EA.paginasi(total, fSM.hal, per)}</div>`);
    },
    buka(id) { EA.detailSM(id); }
  };
  async function eksporSM(btn) {
    const rows = saringSM();
    await EA.sibuk(btn, () => EA.xlsx('Surat-Masuk-' + (fSM.th || S.th) + '.xlsx', {
      nama: 'Surat Masuk', judul: 'Surat Masuk ' + (S.cfg.NamaInstansi || '') + ' — ' + (fSM.th || S.th), baris: rows,
      kolom: [
        { label: 'No Agenda', lebar: 11, ambil: (x) => x.NoAgenda }, { label: 'Tgl Terima', lebar: 12, tipe: 'tanggal', ambil: (x) => x.TglTerima },
        { label: 'No Surat', lebar: 26, ambil: (x) => x.NoSurat }, { label: 'Tgl Surat', lebar: 12, tipe: 'tanggal', ambil: (x) => x.TglSurat },
        { label: 'Asal Surat', lebar: 30, ambil: (x) => x.AsalSurat }, { label: 'Perihal', lebar: 50, ambil: (x) => x.Perihal },
        { label: 'Sifat', lebar: 10, ambil: (x) => x.Sifat }, { label: 'Klasifikasi', lebar: 12, ambil: (x) => x.KodeKlasifikasi },
        { label: 'Lampiran', lebar: 14, ambil: (x) => x.Lampiran }, { label: 'Status Disposisi', lebar: 14, ambil: (x) => x.StatusDisposisi },
        { label: 'Diteruskan ke', lebar: 30, ambil: (x) => D.dspUntukSm(x.ID).map((d) => D.namaBidang(d.KepadaBidang)).join(', ') },
        { label: 'Scan', lebar: 8, ambil: (x) => (x.FileID ? 'Ada' : 'Belum') }
      ]
    }));
  }

  /* ---------- Detail surat masuk ---------- */
  function garisWaktu(sm, dsps) {
    if (!dsps.length) return EA.kosong('teruskan', 'Belum didisposisikan', 'Surat ini menunggu disposisi pimpinan.');
    return h`${dsps.map((d) => {
      const tl = [h`<div class="tl-i info"><span class="tit">${ik('kirim')}</span><div><b>Disposisi dikirim</b><div class="w">${EA.waktu(d.TglDikirim)} · oleh ${D.nama(d.Dari)}${d.DicatatOleh && d.DicatatOleh !== d.Dari ? ' (dicatat ' + D.nama(d.DicatatOleh) + ')' : ''}</div>
        <div class="kd-ins" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${String(d.Instruksi || '').split(';').filter(Boolean).map((s) => h`<span class="lc abu">${s.trim()}</span>`)}</div>${d.Catatan ? h`<div class="tg">“${d.Catatan}”</div>` : ''}</div></div>`];
      if (d.TglDibaca) tl.push(h`<div class="tl-i info"><span class="tit">${ik('mata')}</span><div><b>Dibaca</b><div class="w">${EA.waktu(d.TglDibaca)} · ${D.nama(d.DibacaOleh)}</div></div></div>`);
      if (d.TglDiproses && d.Status !== 'Baru' && d.Status !== 'Dibaca') tl.push(h`<div class="tl-i proses"><span class="tit">${ik('jampasir')}</span><div><b>Diproses</b><div class="w">${EA.waktu(d.TglDiproses)}</div>${d.Status !== 'Selesai' && d.Tanggapan ? h`<div class="tg">${d.Tanggapan}</div>` : ''}</div></div>`);
      if (d.Status === 'Selesai') tl.push(h`<div class="tl-i ok"><span class="tit">${ik('cek')}</span><div><b>Selesai ${D.tepatWaktu(d) ? '· tepat waktu' : '· terlambat'}</b><div class="w">${EA.waktu(d.TglSelesai)} · ${D.nama(d.DiselesaikanOleh)}</div>${d.Tanggapan ? h`<div class="tg">${d.Tanggapan}</div>` : ''}
        ${d.FileTanggapan ? h`<button class="tautan" style="margin-top:6px" data-aksi="lampiran" data-id="${d.ID}" data-file="${d.FileTanggapan}">${ik('klip', 'k')} Lihat lampiran tanggapan</button>` : ''}</div></div>`);
      else if (D.terlambat(d)) tl.push(h`<div class="tl-i telat"><span class="tit">${ik('awas')}</span><div><b>Melewati batas waktu</b><div class="w">Batas ${EA.tglPanjang(d.BatasWaktu)}</div></div></div>`);
      return h`<div class="dsp-blok"><div class="dsp-h"><div><b>${D.namaBidang(d.KepadaBidang)}</b><div class="redup kecil mono">${d.ID} · batas ${EA.tglPendek(d.BatasWaktu)}</div></div><div class="baris-flex">${EA.lcStatus(D.statusTampil(d))}${lcCountdown(d)}</div></div><div class="tl">${tl}</div></div>`;
    })}`;
  }
  EA.garisWaktu = garisWaktu;
  function isiDataSM(sm) {
    const k = D.klasifikasi(sm.KodeKlasifikasi);
    return h`<div class="dt-grid">
      <div class="dt"><div class="l">No. Surat</div><div class="v mono">${sm.NoSurat}</div></div><div class="dt"><div class="l">Tgl Surat</div><div class="v">${EA.tglPanjang(sm.TglSurat)}</div></div>
      <div class="dt"><div class="l">Tgl Terima</div><div class="v">${EA.tglPanjang(sm.TglTerima)}</div></div><div class="dt"><div class="l">Sifat</div><div class="v">${EA.lcSifat(sm.Sifat)}</div></div>
      <div class="dt penuh"><div class="l">Asal Surat</div><div class="v">${sm.AsalSurat}</div></div>
      <div class="dt penuh"><div class="l">Perihal</div><div class="v" style="font-weight:600">${sm.Perihal}</div></div>
      <div class="dt"><div class="l">Klasifikasi</div><div class="v">${sm.KodeKlasifikasi}${k ? ' – ' + k.Uraian : ''}</div></div><div class="dt"><div class="l">Lampiran</div><div class="v">${sm.Lampiran || '-'}</div></div>
      <div class="dt"><div class="l">Dicatat oleh</div><div class="v">${D.nama(sm.DicatatOleh)}</div></div><div class="dt"><div class="l">Waktu catat</div><div class="v">${EA.waktu(sm.DibuatPada)}</div></div></div>`;
  }
  EA.isiDataSM = isiDataSM;
  EA.detailSM = (id) => {
    const bangun = (obj) => {
      const sm = D.smById(id);
      if (!sm) {
        if (!D.dimuat(D.tahunId(id))) { obj.atur({ judul: 'Memuat…', isi: h`<div class="kosong"><div class="putar gelap" style="margin:0 auto"></div></div>` }); D.pastikan(D.tahunId(id)).then(() => EA.panel && EA.panel.segar()).catch(EA.galat); return; }
        obj.atur({ judul: 'Tidak ditemukan', aksi: '', kaki: '', isi: EA.kosong('galat', 'Surat tidak ditemukan', 'Mungkin terhapus atau bukan untuk bidang Anda.') }); return;
      }
      const ds = D.dspUntukSm(id), st = statusSmTampil(sm, ds);
      const pratinjauLama = obj.b.querySelector('#pr-sm');
      const pertahankan = pratinjauLama && pratinjauLama.dataset.file === (sm.FileID || '-');
      obj.atur({
        judul: 'No. Agenda ' + sm.NoAgenda, chip: h` ${EA.lcSifat(sm.Sifat)} ${EA.lcStatus(sm.Dihapus ? 'Batal' : st)}`, sub: sm.ID + ' · diterima ' + EA.tglPanjang(sm.TglTerima),
        aksi: h`${!sm.Dihapus && EA.boleh.disposisi() && sm.StatusDisposisi !== 'Selesai' ? h`<button class="btn p k" data-aksi="disposisi">${ik('teruskan', 'k')} Disposisikan</button>` : ''}
          ${ds.length ? h`<button class="btn k" data-aksi="lembar">${ik('cetak', 'k')} Cetak Lembar Disposisi</button>` : ''}
          ${EA.boleh.admin() && !sm.Dihapus ? h`<button class="btn k" data-aksi="edit">${ik('pensil', 'k')} Edit</button><button class="btn k" data-aksi="unggah">${ik('unggah', 'k')} ${sm.FileID ? 'Ganti scan' : 'Unggah scan'}</button><button class="btn g k" data-aksi="hapus" style="color:var(--bahaya-tua)">${ik('sampah', 'k')} Hapus</button>` : ''}
          ${EA.boleh.admin() && sm.Dihapus ? h`<button class="btn k" data-aksi="pulihkan">${ik('putarKiri', 'k')} Pulihkan</button>` : ''}`,
        isi: h`${sm.Dihapus ? h`<div class="kotak-info merah" style="margin-bottom:14px">${ik('sampah')}<div>Surat ini sudah dihapus (soft delete) dan tidak tampil untuk pengguna lain.</div></div>` : ''}
          <div class="seksi"><h4>${ik('pdf', 'k')} Pratinjau Scan</h4><div class="pratinjau" id="pr-sm" data-file="${sm.FileID || '-'}"></div></div>
          <div class="seksi"><h4>${ik('info', 'k')} Data Surat</h4>${isiDataSM(sm)}</div>
          <div class="seksi"><h4>${ik('teruskan', 'k')} Garis Waktu Disposisi</h4>${garisWaktu(sm, ds)}</div>`
      });
      const pr = obj.b.querySelector('#pr-sm');
      if (pertahankan && pratinjauLama._isi) { pr.replaceWith(pratinjauLama); } else { EA.pratinjau(pr, 'sm', sm.ID, sm.FileID); pr._isi = true; }
      obj.el.onclick = async (e) => {
        const t = e.target.closest('[data-aksi]'); if (!t) return;
        const a = t.dataset.aksi;
        if (a === 'disposisi') EA.modalDisposisi(sm);
        else if (a === 'lembar') cetakLembar(sm.ID, t);
        else if (a === 'edit') EA.formSM(sm);
        else if (a === 'unggah') EA.modalUnggah({ judul: 'Unggah scan surat masuk', sub: 'No. Agenda ' + sm.NoAgenda + ' · ' + sm.Perihal, aksi: 'sm.unggah', id: sm.ID, jenis: 'sm' });
        else if (a === 'lampiran') { const m = EA.modal({ judul: 'Lampiran tanggapan', kelas: 'lebar', ikon: 'klip', isi: h`<div class="pratinjau" id="pr-tg"></div>`, kaki: h`<button class="btn" data-batal>Tutup</button>` }); EA.pratinjau(EA.$('#pr-tg', m.el), 'tg', t.dataset.id, t.dataset.file); }
        else if (a === 'hapus') {
          const k = await EA.konfirmasi({ judul: 'Hapus surat masuk?', pesan: 'Surat No. Agenda ' + sm.NoAgenda + ' akan disembunyikan (soft delete) dan bisa dipulihkan Admin.', bahaya: true, ya: 'Hapus', input: { label: 'Alasan (opsional)', placeholder: 'mis. salah catat' } });
          if (!k.ok) return;
          await EA.sibuk(t, async () => { try { const r = await EA.api.tulis('sm.hapus', { ID: sm.ID, alasan: k.nilai }); D.gabung('sm', r.sm); EA.toast('Surat dihapus.'); } catch (er) { EA.galat(er); } });
        } else if (a === 'pulihkan') {
          await EA.sibuk(t, async () => { try { const r = await EA.api.tulis('sm.pulihkan', { ID: sm.ID }); D.gabung('sm', r.sm); EA.toast('Surat dipulihkan.'); } catch (er) { EA.galat(er); } });
        }
      };
    };
    EA.bukaPanel('sm', id, bangun);
  };

  /* ---------- Unggah scan (umum) ---------- */
  EA.modalUnggah = (o) => {
    let pemindai;
    const m = EA.modal({
      judul: o.judul, sub: o.sub, ikon: 'unggah', kelas: 'sedang', isi: h`<div id="mu-p"></div><div class="prog" style="width:100%;margin-top:12px" hidden id="mu-prog"><i></i></div>`,
      kaki: h`<button class="btn g" data-batal>Batal</button><button class="btn p" id="mu-ok">${ik('unggah', 'k')} Unggah</button>`
    });
    pemindai = new EA.Pemindai(EA.$('#mu-p', m.el), { judul: 'Pindai / pilih scan' });
    EA.$('#mu-ok', m.el).onclick = (e) => EA.sibuk(e.currentTarget, async () => {
      try {
        if (!pemindai.jumlah()) throw new Error('Tambahkan minimal satu halaman/berkas.');
        const berkas = await pemindai.hasil();
        const pr = EA.$('#mu-prog', m.el); pr.hidden = false;
        const r = await EA.api.unggah(o.aksi, { ID: o.id, berkas }, (p) => { pr.firstChild.style.width = Math.round(p * 100) + '%'; });
        if (r.sm) D.gabung('sm', r.sm);
        if (r.sk) D.gabung('sk', r.sk);
        m.tutup();
        EA.toast(o.jenis === 'sk' ? 'Scan terunggah · status Terkirim.' : 'Scan berhasil diunggah.');
      } catch (er) { EA.galat(er); }
    }, ' Mengunggah…');
  };

  /* ---------- Form catat / edit surat masuk (drawer) ---------- */
  EA.formSM = (lama) => {
    const edit = !!lama, s = Object.assign({ TglTerima: EA.hariIni(), TglSurat: '', NoSurat: '', AsalSurat: '', Perihal: '', Sifat: 'Biasa', KodeKlasifikasi: '', Lampiran: '' }, lama || {});
    const nextNo = EA.pad(D.penghitung('Agenda', Number(s.TglTerima.slice(0, 4))) + 1, 4);
    const asalPeta = new Map();
    D.semuaSm().forEach((x) => { const k = EA.normKunci(x.AsalSurat); const o = asalPeta.get(k) || { n: 0, t: x.AsalSurat }; o.n++; asalPeta.set(k, o); });
    const asalSering = Array.from(asalPeta.values()).sort((a, b) => b.n - a.n);
    let pemindai, klas, laci;
    const isi = h`<form id="f-sm" novalidate>
      <div class="kotak-info biru" style="margin-bottom:16px">${ik('perisai')}<div><b>Pencegahan ganda aktif:</b> kombinasi No Surat & Asal Surat diperiksa otomatis agar surat tidak tercatat dua kali.</div></div>
      <div class="stack">
        <div class="grid2"><div class="f"><label for="sm-tt">Tgl Terima <span class="w">*</span></label><input type="date" id="sm-tt" name="TglTerima" value="${s.TglTerima}" max="${EA.tambahHari(EA.hariIni(), 1)}" required></div>
          <div class="f"><label for="sm-ts">Tgl Surat <span class="w">*</span></label><input type="date" id="sm-ts" name="TglSurat" value="${s.TglSurat}" required></div></div>
        <div class="f"><label for="sm-no">Nomor Surat <span class="w">*</span></label><input id="sm-no" name="NoSurat" value="${s.NoSurat}" maxlength="100" placeholder="mis. 421.5/142/Disdik/2026" required autocomplete="off" class="mono"></div>
        <div class="f"><label for="sm-asal">Asal Instansi Pengirim <span class="w">*</span></label><input id="sm-asal" name="AsalSurat" value="${s.AsalSurat}" maxlength="200" list="dl-asal" placeholder="mis. Dinas Pendidikan Provinsi" required autocomplete="off">
          <datalist id="dl-asal">${asalSering.slice(0, 200).map((a) => h`<option value="${a.t}">`)}</datalist>
          ${asalSering.length ? h`<div class="chip-cepat"><span class="redup">Pilihan cepat:</span>${asalSering.slice(0, 3).map((a) => h`<button type="button" data-asal="${a.t}">${a.t.length > 26 ? a.t.slice(0, 25) + '…' : a.t}</button>`)}</div>` : ''}
          <div class="salah" id="sm-ganda"></div></div>
        <div class="f"><label for="sm-per">Isi Ringkas / Perihal <span class="w">*</span></label><textarea id="sm-per" name="Perihal" maxlength="500" rows="2" required>${s.Perihal}</textarea></div>
        <div class="f"><span class="lbl-f">Tingkat / Sifat Surat <span class="w">*</span></span><div class="seg" id="sm-sifat">${SIFAT.map((x) => h`<button type="button" data-v="${x}" class="${s.Sifat === x ? 'on' : ''}">${x}</button>`)}</div></div>
        <div class="grid2"><div class="f"><label for="sm-klas">Kode Klasifikasi <span class="w">*</span></label><div id="sm-klas"></div></div>
          <div class="f"><label for="sm-lamp">Lampiran <small>(opsional)</small></label><input id="sm-lamp" name="Lampiran" value="${s.Lampiran}" maxlength="100" placeholder="mis. 1 berkas"></div></div>
        <div id="sm-pindai"></div>
        ${edit ? h`<p class="redup kecil" style="margin:0">Kosongkan bagian scan bila tidak ingin mengganti berkas.</p>` : h`<label class="cek kecil"><input type="checkbox" id="sm-menyusul"> Scan menyusul (unggah nanti — tercatat sebagai "belum ada scan")</label>`}
        <div class="prog" style="width:100%" hidden id="sm-prog"><i></i></div>
      </div></form>`;
    laci = EA.laci({
      judul: edit ? 'Edit Surat Masuk' : 'Catat Surat Masuk', pill: edit ? 'No Agenda ' + s.NoAgenda : 'No Agenda otomatis: ' + nextNo,
      sub: edit ? 'Perubahan tercatat di log aktivitas.' : 'Entri registrasi berkas fisik & digitalisasi persuratan.', isi,
      kaki: h`<button class="btn g kiri" data-tutup-laci>Batal</button>${edit ? '' : h`<button class="btn" data-simpan="lagi">Simpan & Catat Lagi</button>`}<button class="btn p" data-simpan="tutup">${ik('cek', 'k')} ${edit ? 'Simpan Perubahan' : 'Simpan Surat Masuk'}</button>`,
      onTutup: () => {}
    });
    const el = laci.el;
    pemindai = new EA.Pemindai(EA.$('#sm-pindai', el), { judul: edit ? 'Ganti scan (opsional)' : 'Pindai / Unggah Berkas Fisik' });
    klas = EA.pilihCari(EA.$('#sm-klas', el), { opsi: EA.opsiKlasifikasi, nilai: s.KodeKlasifikasi, placeholder: 'Cari kode atau uraian…', id: 'sm-klas-in' });
    let sifat = s.Sifat;
    EA.$('#sm-sifat', el).onclick = (e) => { const b = e.target.closest('button[data-v]'); if (!b) return; sifat = b.dataset.v; EA.$$('#sm-sifat button', el).forEach((x) => x.classList.toggle('on', x === b)); };
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-asal]'); if (b) { EA.$('#sm-asal', el).value = b.dataset.asal; cekGanda(); } if (e.target.closest('[data-tutup-laci]')) laci.tutup(); });
    const cekGanda = () => {
      const no = EA.normKunci(EA.$('#sm-no', el).value), asal = EA.normKunci(EA.$('#sm-asal', el).value);
      const g = no && asal ? D.semuaSm().filter((x) => x.ID !== s.ID && EA.normKunci(x.NoSurat) === no && EA.normKunci(x.AsalSurat) === asal) : [];
      EA.$('#sm-ganda', el).textContent = g.length ? '⚠ Peringatan dobel catat: sudah tercatat sebagai No Agenda ' + g.map((x) => x.NoAgenda + '/' + x.Tahun).join(', ') + '.' : '';
    };
    EA.$('#sm-no', el).addEventListener('input', EA.debounce(cekGanda, 200));
    EA.$('#sm-asal', el).addEventListener('input', EA.debounce(cekGanda, 200));
    const simpan = async (btn, lagi, abaikanGanda) => {
      const f = EA.$('#f-sm', el);
      EA.$$('.f.err', f).forEach((x) => x.classList.remove('err'));
      const v = { TglTerima: EA.$('#sm-tt', el).value, TglSurat: EA.$('#sm-ts', el).value, NoSurat: EA.$('#sm-no', el).value.trim(), AsalSurat: EA.$('#sm-asal', el).value.trim(), Perihal: EA.$('#sm-per', el).value.trim(), Sifat: sifat, KodeKlasifikasi: klas.nilai(), Lampiran: EA.$('#sm-lamp', el).value.trim() };
      const kurang = [['TglTerima', '#sm-tt'], ['TglSurat', '#sm-ts'], ['NoSurat', '#sm-no'], ['AsalSurat', '#sm-asal'], ['Perihal', '#sm-per'], ['KodeKlasifikasi', '#sm-klas-in']].filter(([k]) => !v[k]);
      kurang.forEach(([, sel]) => EA.$(sel, el).closest('.f').classList.add('err'));
      if (kurang.length) { EA.toast('Lengkapi kolom bertanda *.', 'galat'); return; }
      if (v.TglSurat > v.TglTerima) { EA.$('#sm-ts', el).closest('.f').classList.add('err'); EA.toast('Tgl Surat tidak boleh setelah Tgl Terima.', 'galat'); return; }
      const menyusul = !edit && EA.$('#sm-menyusul', el).checked;
      if (!edit && !pemindai.jumlah() && !menyusul) { EA.toast('Unggah scan surat, atau centang "Scan menyusul".', 'galat'); return; }
      await EA.sibuk(btn, async () => {
        try {
          const berkas = pemindai.jumlah() ? await pemindai.hasil() : null;
          const d = Object.assign({}, v, { berkas, scanMenyusul: menyusul, abaikanGanda: !!abaikanGanda });
          if (edit) d.ID = s.ID;
          const pr = EA.$('#sm-prog', el); pr.hidden = !berkas;
          const r = await EA.api.unggah('sm.simpan', d, (p) => { pr.firstChild.style.width = Math.round(p * 100) + '%'; });
          D.gabung('sm', r.sm);
          EA.kurasNotif(r.nq);
          EA.toast((edit ? 'Perubahan disimpan' : 'Tersimpan') + ' · No Agenda ' + r.sm.NoAgenda);
          if (lagi) {
            ['#sm-no', '#sm-per', '#sm-lamp'].forEach((x) => { EA.$(x, el).value = ''; });
            pemindai.kosongkan(); EA.$('#sm-ganda', el).textContent = ''; pr.hidden = true;
            laci.atur({ pill: 'No Agenda otomatis: ' + EA.pad(Number(r.sm.NoAgenda) + 1, 4) });
            EA.$('#sm-no', el).focus();
          } else { laci.tutup(); }
        } catch (er) {
          if (er.kode === 'GANDA') {
            const k = await EA.konfirmasi({ judul: 'Kemungkinan dobel catat', pesan: er.message + ' Tetap simpan sebagai surat baru?', ya: 'Tetap simpan', ikon: 'awas' });
            if (k.ok) return simpan(btn, lagi, true);
          } else EA.galat(er);
        }
      }, ' Menyimpan…');
    };
    EA.$$('[data-simpan]', el).forEach((b) => { b.onclick = () => simpan(b, b.dataset.simpan === 'lagi'); });
  };

  /* ================= DISPOSISI ================= */
  const fDsp = { tab: '', bidang: '', q: '' };
  EA.modalDisposisi = (sm) => {
    const cfg = S.cfg, hari = EA.hariIni();
    const bawaan = Number(cfg['BatasWaktu_' + sm.Sifat]) || ({ Segera: 1, Penting: 3, Biasa: 7, Rahasia: 3 }[sm.Sifat] || 3);
    const sudah = D.dspUntukSm(sm.ID).filter((d) => d.Status !== 'Selesai').map((d) => d.KepadaBidang);
    const bidang = (S.mst.bidang || []).filter((b) => b.Aktif !== false);
    const pilih = new Set(), instr = new Set();
    const m = EA.modal({
      judul: 'Disposisi Surat Masuk', ikon: 'pensil', kelas: 'lebar', chip: h` <span class="pill mono">No. Agenda ${sm.NoAgenda}</span>${EA.boleh.admin() ? h` <span class="pill" style="background:#FEF9C3;color:#854D0E">Atas nama pimpinan</span>` : h` <span class="pill">${ik('perisai', 'k')} Otoritas Pimpinan</span>`}`,
      sub: sm.Perihal,
      isi: h`<div class="kotak-info biru" style="margin-bottom:16px;flex-wrap:wrap">${ik('gedung')}<div>Asal: <b>${sm.AsalSurat}</b> · Nomor: <span class="mono">${sm.NoSurat}</span></div>${EA.lcSifat(sm.Sifat)}${sm.FileID ? h`<span class="lc abu">${ik('pdf', 'k')} Scan tersedia</span>` : ''}</div>
        <div class="seksi"><h4>Tujuan bidang / unit pengolah <span class="w" style="color:var(--bahaya)">*</span><span class="redup" style="margin-left:auto;text-transform:none;letter-spacing:0;font-weight:500;font-style:italic">Bisa memilih lebih dari satu</span></h4>
          <div class="pilih-bidang">${bidang.map((b, i) => { const n = (S.mst.stafPerBidang || {})[b.IDBidang] || 0, sdh = sudah.indexOf(b.IDBidang) > -1; return h`<button type="button" class="bd" data-b="${b.IDBidang}" ${sdh ? 'disabled title="Sudah menerima disposisi yang belum selesai"' : ''} style="${sdh ? 'opacity:.5' : ''}"><span class="ik-chip ${['biru', 'hijau', 'oranye', 'teal', 'ungu', 'merah', 'abu'][i % 7]}">${ik(IKON_BIDANG[i % IKON_BIDANG.length], 'k')}</span><span><b>${b.NamaBidang}</b><small>${ik('grup', 'k')} ${sdh ? 'sudah didisposisi' : n + ' staf aktif'}</small></span><span class="cekb">${ik('cek')}</span></button>`; })}</div></div>
        <div class="seksi"><h4>Instruksi tindak lanjut <span class="w" style="color:var(--bahaya)">*</span></h4><div class="ins">${INSTRUKSI.map((x) => h`<button type="button" data-i="${x}">${ik('cekL', 'k')} ${x}</button>`)}</div></div>
        <div class="seksi"><div class="f"><label for="ds-cat">Catatan & arahan khusus <small id="ds-n">0 / 1000</small></label>
          <div class="chip-cepat" style="margin-bottom:6px"><span class="redup">Template cepat:</span>${['Hadiri & buat notula', 'Pelajari & beri masukan', 'Siapkan berkas pendukung', 'Koordinasikan dengan bidang terkait', 'Laporkan hasilnya'].map((t) => h`<button type="button" data-tpl="${t}">+ ${t}</button>`)}</div>
          <textarea id="ds-cat" rows="3" maxlength="1000" placeholder="Arahan untuk bidang tujuan…"></textarea></div></div>
        <div class="grid2"><div class="f"><label for="ds-batas">Batas waktu target selesai <span class="w">*</span></label><input type="date" id="ds-batas" min="${hari}" value="${EA.tambahHari(hari, bawaan)}">
          <div class="chip-cepat"><span class="lc ${sm.Sifat === 'Segera' ? 'merah' : 'abu'}">${ik('petir', 'k')} Otomatis ${bawaan} hari (${sm.Sifat})</span>${[1, 2, 3, 7].map((n) => h`<button type="button" data-plus="${n}">+${n} hr</button>`)}</div></div>
          <div class="kotak-info hijau" style="align-self:end">${ik('wa')}<div id="ds-notif">Pilih bidang tujuan untuk melihat penerima notifikasi WhatsApp & email.</div></div></div>`,
      kaki: h`<span class="redup kecil kiri">${ik('tandaTangan', 'k')} Tercatat atas nama ${EA.boleh.admin() ? 'pimpinan (oleh Admin)' : S.user.nama}</span><button class="btn g" data-batal>Batal</button><button class="btn p" id="ds-kirim">${ik('kirim', 'k')} Kirim Disposisi</button>`
    });
    const el = m.el, cat = EA.$('#ds-cat', el);
    const perbarui = () => {
      const n = Array.from(pilih).reduce((a, b) => a + ((S.mst.stafPerBidang || {})[b] || 0), 0);
      EA.$('#ds-notif', el).innerHTML = pilih.size ? h`Notifikasi otomatis dikirim ke <b>${n} staf</b> pada <b>${pilih.size} bidang</b> (${Array.from(pilih).map(D.namaBidang).join(', ')}).`.s : 'Pilih bidang tujuan untuk melihat penerima notifikasi WhatsApp & email.';
      EA.$('#ds-n', el).textContent = cat.value.length + ' / 1000';
    };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-b]'), i = e.target.closest('[data-i]'), t = e.target.closest('[data-tpl]'), p = e.target.closest('[data-plus]');
      if (b && !b.disabled) { pilih.has(b.dataset.b) ? pilih.delete(b.dataset.b) : pilih.add(b.dataset.b); b.classList.toggle('on'); perbarui(); }
      if (i) { instr.has(i.dataset.i) ? instr.delete(i.dataset.i) : instr.add(i.dataset.i); i.classList.toggle('on'); }
      if (t) { cat.value = (cat.value ? cat.value.replace(/\s+$/, '') + '. ' : '') + t.dataset.tpl; perbarui(); }
      if (p) EA.$('#ds-batas', el).value = EA.tambahHari(hari, Number(p.dataset.plus));
    });
    cat.addEventListener('input', perbarui);
    EA.$('#ds-kirim', el).onclick = (e) => {
      if (!pilih.size) { EA.toast('Pilih minimal satu bidang tujuan.', 'galat'); return; }
      if (!instr.size) { EA.toast('Pilih minimal satu instruksi.', 'galat'); return; }
      const batas = EA.$('#ds-batas', el).value;
      if (!batas || batas < hari) { EA.toast('Batas waktu tidak boleh sebelum hari ini.', 'galat'); return; }
      EA.sibuk(e.currentTarget, async () => {
        try {
          const r = await EA.api.tulis('dsp.kirim', { idSuratMasuk: sm.ID, bidang: Array.from(pilih), instruksi: INSTRUKSI.filter((x) => instr.has(x)), catatan: cat.value.trim(), batas });
          D.gabung('dsp', r.dsp); D.gabung('sm', r.sm);
          EA.kurasNotif(r.nq);
          m.tutup();
          EA.toast('Disposisi terkirim ke ' + r.dsp.length + ' bidang · notifikasi ke ' + r.staf + ' staf.');
        } catch (er) { EA.galat(er); }
      }, ' Mengirim…');
    };
  };

  EA.modalTanggapan = (d, status) => {
    let pemindai;
    const selesai = status === 'Selesai';
    const m = EA.modal({
      judul: selesai ? 'Laporkan Selesai' : 'Tandai Diproses', ikon: selesai ? 'cekL' : 'jampasir', kelas: 'sedang', sub: (D.smById(d.IDSuratMasuk) || {}).Perihal,
      isi: h`<div class="stack"><div class="f"><label for="tg-isi">Tanggapan / laporan tindak lanjut ${selesai ? h`<span class="w">*</span>` : h`<small>(opsional)</small>`}</label>
        <textarea id="tg-isi" rows="4" maxlength="2000" placeholder="${selesai ? 'Jelaskan hasil tindak lanjut…' : 'Catatan progres (opsional)…'}">${d.Tanggapan || ''}</textarea></div>
        ${selesai ? h`<div id="tg-p"></div>` : ''}<div class="prog" style="width:100%" hidden id="tg-prog"><i></i></div></div>`,
      kaki: h`<button class="btn g" data-batal>Batal</button><button class="btn ${selesai ? 'h' : 'p'}" id="tg-ok">${ik(selesai ? 'cek' : 'jampasir', 'k')} ${selesai ? 'Tandai Selesai' : 'Simpan & Proses'}</button>`
    });
    if (selesai) pemindai = new EA.Pemindai(EA.$('#tg-p', m.el), { judul: 'Lampiran tanggapan (opsional)' });
    EA.$('#tg-ok', m.el).onclick = (e) => EA.sibuk(e.currentTarget, async () => {
      try {
        const tanggapan = EA.$('#tg-isi', m.el).value.trim();
        if (selesai && tanggapan.length < 3) throw new Error('Isi tanggapan sebelum menandai Selesai.');
        const berkas = pemindai && pemindai.jumlah() ? await pemindai.hasil() : null;
        const pr = EA.$('#tg-prog', m.el); pr.hidden = !berkas;
        const r = await EA.api.unggah('dsp.status', { id: d.ID, status, tanggapan, berkas }, (p) => { pr.firstChild.style.width = Math.round(p * 100) + '%'; });
        D.gabung('dsp', r.dsp); if (r.sm) D.gabung('sm', r.sm);
        EA.kurasNotif(r.nq);
        m.tutup();
        EA.toast(selesai ? 'Disposisi selesai · pimpinan diberi tahu.' : 'Status: Diproses.');
      } catch (er) { EA.galat(er); }
    }, ' Menyimpan…');
  };

  EA.detailDsp = (id) => {
    const bangun = (obj) => {
      const d = D.dspById(id);
      if (!d) { obj.atur({ judul: 'Tidak ditemukan', isi: EA.kosong('galat', 'Disposisi tidak ditemukan', 'Mungkin bukan untuk bidang Anda.'), aksi: '', kaki: '' }); return; }
      const sm = D.smById(d.IDSuratMasuk) || {};
      // FR-23: pertama kali dibuka staf → Dibaca (optimistis)
      EA._dibaca = EA._dibaca || new Set();
      if (EA.boleh.tindakDsp(d) && d.Status === 'Baru' && !EA._dibaca.has(d.ID)) {
        EA._dibaca.add(d.ID);
        D.gabung('dsp', Object.assign({}, d, { Status: 'Dibaca', TglDibaca: Date.now(), DibacaOleh: S.user.email }));
        EA.api.tulis('dsp.baca', { id: d.ID }).then((r) => D.gabung('dsp', r.dsp)).catch(() => D.gabung('dsp', d));
        return;
      }
      const boleh = EA.boleh.tindakDsp(d);
      const pratinjauLama = obj.b.querySelector('#pr-dsp');
      obj.atur({
        judul: 'Disposisi untuk ' + D.namaBidang(d.KepadaBidang), chip: h` ${EA.lcStatus(D.statusTampil(d))}`, sub: d.ID + ' · No. Agenda ' + (sm.NoAgenda || '-') + ' · batas ' + EA.tglPanjang(d.BatasWaktu),
        aksi: h`${boleh && d.Status !== 'Selesai' && d.Status !== 'Diproses' ? h`<button class="btn k" data-aksi="proses">${ik('jampasir', 'k')} Mulai Proses</button>` : ''}
          ${boleh && d.Status !== 'Selesai' ? h`<button class="btn h k" data-aksi="selesai">${ik('cek', 'k')} Laporkan Selesai</button>` : ''}
          <button class="btn k" data-aksi="lembar">${ik('cetak', 'k')} Cetak Lembar</button><button class="btn g k" data-aksi="surat">${ik('surat', 'k')} Lihat surat</button>`,
        isi: h`<div class="kotak-info ${D.terlambat(d) ? 'merah' : 'biru'}" style="margin-bottom:14px">${ik(D.terlambat(d) ? 'awas' : 'jam')}<div><b>${D.hitungMundur(d).teks}</b> · Instruksi: ${d.Instruksi}${d.Catatan ? h`<div style="margin-top:4px">Catatan: “${d.Catatan}”</div>` : ''}</div></div>
          <div class="seksi"><h4>${ik('pdf', 'k')} Scan Surat</h4><div class="pratinjau" id="pr-dsp" data-file="${sm.FileID || '-'}"></div></div>
          <div class="seksi"><h4>${ik('info', 'k')} Data Surat</h4>${sm.ID ? isiDataSM(sm) : ''}</div>
          <div class="seksi"><h4>${ik('teruskan', 'k')} Garis Waktu</h4>${sm.ID ? garisWaktu(sm, D.dspUntukSm(sm.ID)) : ''}</div>`
      });
      const pr = obj.b.querySelector('#pr-dsp');
      if (pratinjauLama && pratinjauLama.dataset.file === pr.dataset.file && pratinjauLama._isi) pr.replaceWith(pratinjauLama);
      else { EA.pratinjau(pr, 'sm', sm.ID, sm.FileID); pr._isi = true; }
      obj.el.onclick = (e) => {
        const t = e.target.closest('[data-aksi]'); if (!t) return;
        const a = t.dataset.aksi;
        if (a === 'proses') EA.modalTanggapan(d, 'Diproses');
        else if (a === 'selesai') EA.modalTanggapan(d, 'Selesai');
        else if (a === 'lembar') cetakLembar(d.IDSuratMasuk, t);
        else if (a === 'surat') EA.keDetail('#/surat-masuk/' + d.IDSuratMasuk);
        else if (a === 'lampiran') { const m = EA.modal({ judul: 'Lampiran tanggapan', kelas: 'lebar', ikon: 'klip', isi: h`<div class="pratinjau" id="pr-tg"></div>`, kaki: h`<button class="btn" data-batal>Tutup</button>` }); EA.pratinjau(EA.$('#pr-tg', m.el), 'tg', t.dataset.id, t.dataset.file); }
      };
    };
    EA.bukaPanel('dsp', id, bangun);
  };

  EA.hal.disposisi = {
    judul: 'Disposisi',
    render(root, p) {
      const staf = EA.boleh.staf();
      if (p.tab) fDsp.tab = p.tab;
      if (!fDsp.tab) fDsp.tab = staf ? 'baru' : 'perlu';
      root.innerHTML = h`<div class="kepala"><div><h1>${staf ? 'Kotak Disposisi' : 'Disposisi'} ${staf ? h`<span class="pill">${S.user.namaBidang}</span>` : ''}</h1><p>${staf ? 'Disposisi pimpinan untuk bidang Anda. Status menjadi Dibaca saat pertama dibuka.' : 'Pantau surat yang perlu didisposisikan dan perkembangan tindak lanjut tiap bidang.'}</p></div></div>
        <div class="tab" id="dsp-tab" role="tablist"></div>
        <div class="kartu" style="margin-bottom:16px"><div class="saring"><label class="cari"><span class="sr">Cari</span>${ik('cari')}<input id="dsp-q" type="search" placeholder="Cari perihal, asal, nomor…" value="${fDsp.q}"></label>
          ${staf ? '' : h`<select id="dsp-b" aria-label="Bidang"><option value="">Semua bidang</option>${(S.mst.bidang || []).map((b) => h`<option value="${b.IDBidang}" ${fDsp.bidang === b.IDBidang ? 'selected' : ''}>${b.NamaBidang}</option>`)}</select>`}</div></div>
        <div id="dsp-isi"></div>`.s;
      EA.$('#dsp-q', root).addEventListener('input', EA.debounce((e) => { fDsp.q = e.target.value; this.segar(root); }, 120));
      root.onchange = (e) => { if (e.target.id === 'dsp-b') { fDsp.bidang = e.target.value; this.segar(root); } };
      root.onclick = (e) => {
        const t = e.target.closest('[data-tab],[data-aksi]'); if (!t) return;
        if (t.dataset.tab) { fDsp.tab = t.dataset.tab; history.replaceState(null, '', '#/disposisi?tab=' + fDsp.tab); this.segar(root); return; }
        const a = t.dataset.aksi;
        if (a === 'buka-dsp') EA.keDetail('#/disposisi/' + t.dataset.id);
        if (a === 'buka-sm') EA.keDetail('#/surat-masuk/' + t.dataset.id);
        if (a === 'beri') { e.stopPropagation(); const sm = D.smById(t.dataset.id); if (sm) EA.modalDisposisi(sm); }
      };
      this.segar(root);
    },
    segar(root) {
      const isi = EA.$('#dsp-isi', root); if (!isi) return;
      const staf = EA.boleh.staf(), q = EA.norm(fDsp.q);
      let semua = D.semuaDsp().filter((d) => { const sm = D.smById(d.IDSuratMasuk); return sm && !sm.Dihapus; });
      if (staf) semua = semua.filter((d) => d.KepadaBidang === S.user.idBidang);
      if (fDsp.bidang) semua = semua.filter((d) => d.KepadaBidang === fDsp.bidang);
      const cocok = (d) => { const sm = D.smById(d.IDSuratMasuk) || {}; return cocokQ([sm.Perihal, sm.AsalSurat, sm.NoSurat, sm.NoAgenda, d.Instruksi, d.Catatan, D.namaBidang(d.KepadaBidang)].join(' '), q); };
      semua = semua.filter(cocok);
      let tabs, daftar;
      if (staf) {
        const grup = { baru: semua.filter((d) => d.Status === 'Baru' || d.Status === 'Dibaca'), proses: semua.filter((d) => d.Status === 'Diproses'), selesai: semua.filter((d) => d.Status === 'Selesai') };
        tabs = [['baru', 'Baru', grup.baru.length], ['proses', 'Diproses', grup.proses.length], ['selesai', 'Selesai', grup.selesai.length]];
        if (!grup[fDsp.tab]) fDsp.tab = 'baru';
        daftar = grup[fDsp.tab];
      } else {
        const perlu = D.semuaSm().filter((x) => x.StatusDisposisi === 'Belum' && cocokQ([x.Perihal, x.AsalSurat, x.NoSurat, x.NoAgenda].join(' '), q));
        const grup = { berjalan: semua.filter((d) => d.Status !== 'Selesai'), telat: semua.filter(D.terlambat), selesai: semua.filter((d) => d.Status === 'Selesai') };
        tabs = [['perlu', 'Perlu Disposisi', perlu.length], ['berjalan', 'Berjalan', grup.berjalan.length], ['telat', 'Terlambat', grup.telat.length], ['selesai', 'Selesai', grup.selesai.length]];
        if (fDsp.tab === 'perlu') {
          EA.html(EA.$('#dsp-tab', root), h`${tabs.map(([k, l, n]) => h`<button role="tab" data-tab="${k}" class="${fDsp.tab === k ? 'on' : ''}">${l}<span class="n">${n}</span></button>`)}`);
          const urut = perlu.slice().sort((a, b) => SIFAT.indexOf(b.Sifat) - SIFAT.indexOf(a.Sifat) || (a.TglTerima < b.TglTerima ? -1 : 1));
          EA.html(isi, urut.length ? h`<div class="kd-grid">${urut.slice(0, 120).map((x) => h`<div class="kd st-Belum" role="button" tabindex="0" data-aksi="buka-sm" data-id="${x.ID}"><div class="kd-1"><span class="mono">${x.NoAgenda}</span>${EA.lcSifat(x.Sifat)}<span>· diterima ${EA.tglPendek(x.TglTerima)}</span></div>
            <div class="kd-p">${x.Perihal}</div><div class="kd-a">${x.AsalSurat} · ${x.NoSurat}</div>
            <div class="kd-f"><span class="redup">${x.FileID ? h`${ik('klip', 'k')} Scan tersedia` : 'Belum ada scan'}</span>${EA.boleh.disposisi() ? h`<button class="btn p kk" data-aksi="beri" data-id="${x.ID}">${ik('teruskan', 'k')} Disposisikan</button>` : ''}</div></div>`)}</div>` : EA.kosong('cekL', 'Semua surat sudah didisposisikan', 'Tidak ada surat yang menunggu.'));
          return;
        }
        if (!grup[fDsp.tab]) fDsp.tab = 'berjalan';
        daftar = grup[fDsp.tab];
      }
      EA.html(EA.$('#dsp-tab', root), h`${tabs.map(([k, l, n]) => h`<button role="tab" data-tab="${k}" class="${fDsp.tab === k ? 'on' : ''}">${l}<span class="n">${n}</span></button>`)}`);
      const urut = daftar.slice().sort((a, b) => (fDsp.tab === 'selesai' ? b.TglSelesai - a.TglSelesai : (a.BatasWaktu < b.BatasWaktu ? -1 : a.BatasWaktu > b.BatasWaktu ? 1 : 0)));
      EA.html(isi, urut.length ? h`<div class="kd-grid">${urut.slice(0, 150).map((d) => {
        const sm = D.smById(d.IDSuratMasuk) || {}, st = D.statusTampil(d);
        return h`<button class="kd st-${st}" data-aksi="buka-dsp" data-id="${d.ID}"><div class="kd-1"><span class="mono">${sm.NoAgenda}</span>${EA.lcSifat(sm.Sifat)}${EA.lcStatus(st)}${staf ? '' : h`<span class="lc abu">${D.namaBidang(d.KepadaBidang)}</span>`}</div>
          <div class="kd-p">${sm.Perihal}</div><div class="kd-a">${sm.AsalSurat}</div>
          <div class="kd-ins">${String(d.Instruksi || '').split(';').filter(Boolean).map((s) => h`<span>${s.trim()}</span>`)}</div>
          <div class="kd-f">${lcCountdown(d)}<span class="redup">Batas ${EA.tglPendek(d.BatasWaktu)}</span></div></button>`;
      })}</div>` : EA.kosong('disposisi', staf ? 'Tidak ada disposisi di sini' : 'Tidak ada data', staf && fDsp.tab === 'baru' ? 'Disposisi baru dari pimpinan akan muncul di sini.' : ''));
    },
    buka(id) { if (/^SM-/.test(id)) EA.detailSM(id); else EA.detailDsp(id); }
  };

  /* ================= SURAT KELUAR ================= */
  const fSK = { q: '', status: '', sifat: '', bidang: '', periode: '', th: null, hal: 1 };
  function saringSK() {
    const th = fSK.th || S.th, q = EA.norm(fSK.q), bln = EA.bulanIni();
    let rows = D.sk(th);
    if (fSK.status === 'Lama') rows = rows.filter((x) => x.Status === 'Nomor Diambil' && Date.now() - x.DibuatPada > 7 * 86400000);
    else if (fSK.status) rows = rows.filter((x) => x.Status === fSK.status);
    if (fSK.sifat) rows = rows.filter((x) => x.Sifat === fSK.sifat);
    if (fSK.bidang) rows = rows.filter((x) => x.IDBidang === fSK.bidang);
    if (fSK.periode === 'bulan') rows = rows.filter((x) => x.TglSurat.slice(0, 7) === bln);
    if (q) rows = rows.filter((x) => cocokQ([x.NomorSurat, x.Tujuan, x.Perihal, D.namaBidang(x.IDBidang)].join(' '), q));
    return rows;
  }
  EA.hal['surat-keluar'] = {
    judul: 'Surat Keluar',
    render(root) {
      fSK.th = fSK.th || S.th;
      const staf = EA.boleh.staf();
      root.innerHTML = h`<div class="kepala"><div><span class="pill">● Tahun ${fSK.th}</span><h1 style="margin-top:8px">Buku Agenda Surat Keluar</h1><p>Nomor surat keluar diterbitkan otomatis, urut dan anti-dobel. Nomor yang dibatalkan tidak dipakai ulang.</p></div>
        <div class="aksi">${EA.boleh.bukuAgenda() ? h`<button class="btn" data-aksi="buku">${ik('cetak', 'k')} Cetak Buku Agenda</button>` : ''}<button class="btn" data-aksi="ekspor">${ik('unduh', 'k')} Ekspor Excel</button>
        ${EA.boleh.ambilNomor() ? h`<button class="btn p" data-aksi="nomor">${ik('pagar', 'k')} Ambil Nomor</button>` : ''}</div></div>
        <div id="sk-peringatan"></div><div class="mini-kpi" id="sk-kpi"></div>
        <div class="kartu" style="margin-bottom:16px"><div class="saring"><label class="cari"><span class="sr">Cari</span>${ik('cari')}<input id="sk-q" type="search" placeholder="Cari nomor, tujuan, perihal…" value="${fSK.q}"></label>
          <select id="sk-th" aria-label="Tahun">${opsiTahun(fSK.th)}</select>
          <select id="sk-status" aria-label="Status"><option value="">Status: Semua</option>${[['Nomor Diambil', 'Nomor diambil (belum scan)'], ['Terkirim', 'Terkirim'], ['Batal', 'Batal'], ['Lama', '> 7 hari tanpa scan']].map(([v, l]) => h`<option value="${v}" ${fSK.status === v ? 'selected' : ''}>${l}</option>`)}</select>
          <select id="sk-sifat" aria-label="Sifat"><option value="">Sifat: Semua</option>${SIFAT.map((s) => h`<option ${fSK.sifat === s ? 'selected' : ''}>${s}</option>`)}</select>
          ${staf ? '' : h`<select id="sk-bidang" aria-label="Bidang"><option value="">Bidang: Semua</option>${(S.mst.bidang || []).map((b) => h`<option value="${b.IDBidang}" ${fSK.bidang === b.IDBidang ? 'selected' : ''}>${b.NamaBidang}</option>`)}</select>`}
          <select id="sk-periode" aria-label="Periode"><option value="">Semua tanggal</option><option value="bulan" ${fSK.periode === 'bulan' ? 'selected' : ''}>Bulan ini</option></select></div></div>
        <div class="kartu"><div class="kartu-h" style="padding-bottom:12px"><h3>${ik('keluar')} Daftar Nomor Surat Keluar <span class="pill" id="sk-n">0</span></h3></div><div id="sk-daftar"></div></div>
        ${EA.boleh.ambilNomor() ? h`<button class="fab" data-aksi="nomor" aria-label="Ambil nomor">${ik('tambah', 'b')}</button>` : ''}`.s;
      EA.$('#sk-q', root).addEventListener('input', EA.debounce((e) => { fSK.q = e.target.value; fSK.hal = 1; this.segar(root); }, 120));
      root.onchange = (e) => {
        const id = e.target.id;
        if (id === 'sk-th') { fSK.th = Number(e.target.value); D.pastikan(fSK.th).then(() => this.render(root)).catch(EA.galat); return; }
        const k = { 'sk-status': 'status', 'sk-sifat': 'sifat', 'sk-bidang': 'bidang', 'sk-periode': 'periode' }[id];
        if (k) { fSK[k] = e.target.value; fSK.hal = 1; this.segar(root); }
      };
      root.onclick = async (e) => {
        const t = e.target.closest('[data-aksi],[data-hal]'); if (!t) return;
        if (t.dataset.hal) { fSK.hal = Number(t.dataset.hal); this.segar(root); return; }
        const a = t.dataset.aksi, sk = t.dataset.id ? D.skById(t.dataset.id) : null;
        if (a === 'nomor') EA.modalAmbilNomor();
        else if (a === 'buka') EA.keDetail('#/surat-keluar/' + t.dataset.id);
        else if (a === 'buku') location.hash = '#/laporan?tab=buku&jenis=keluar';
        else if (a === 'ekspor') eksporSK(t);
        else if (a === 'lama') { fSK.status = 'Lama'; this.render(root); }
        else if (a === 'kpi') { fSK.status = t.dataset.status || ''; fSK.periode = t.dataset.periode || ''; fSK.hal = 1; this.render(root); }
        else if (a === 'salin') { e.stopPropagation(); if (await EA.salin(sk.NomorSurat)) EA.toast('Nomor disalin: ' + sk.NomorSurat); }
        else if (a === 'unggah') { e.stopPropagation(); EA.modalUnggah({ judul: 'Unggah scan final', sub: sk.NomorSurat + ' · ' + sk.Perihal, aksi: 'sk.unggah', id: sk.ID, jenis: 'sk' }); }
        else if (a === 'batal') { e.stopPropagation(); batalSK(sk); }
      };
      this.segar(root);
    },
    segar(root) {
      const daftar = EA.$('#sk-daftar', root); if (!daftar) return;
      const th = fSK.th || S.th, semua = D.sk(th), bln = EA.bulanIni();
      const lama = semua.filter((x) => x.Status === 'Nomor Diambil' && Date.now() - x.DibuatPada > 7 * 86400000);
      EA.html(EA.$('#sk-peringatan', root), lama.length ? h`<div class="kotak-info kuning" style="margin-bottom:14px">${ik('awas')}<div><b>${lama.length} nomor</b> sudah lebih dari 7 hari belum ada scan finalnya. Segera unggah agar arsip lengkap.</div><button class="btn k" data-aksi="lama">Lihat</button></div>` : '');
      const nBln = semua.filter((x) => x.TglSurat.slice(0, 7) === bln && x.Status !== 'Batal').length;
      EA.html(EA.$('#sk-kpi', root), h`
        <button class="mkpi b5" data-aksi="kpi" data-periode="bulan"><div class="l">Surat Keluar Bulan Ini</div><div class="n">${EA.angka(nBln)}</div><div class="s">${EA.namaBulan(bln)}</div><div class="ik-bg">${ik('keluar')}</div></button>
        <button class="mkpi b1" data-aksi="kpi" data-status="Nomor Diambil"><div class="l">Menunggu Scan</div><div class="n">${EA.angka(semua.filter((x) => x.Status === 'Nomor Diambil').length)}</div><div class="s">Nomor diambil, belum diunggah</div><div class="ik-bg">${ik('unggah')}</div></button>
        <button class="mkpi b6" data-aksi="kpi" data-status="Terkirim"><div class="l">Terkirim</div><div class="n">${EA.angka(semua.filter((x) => x.Status === 'Terkirim').length)}</div><div class="s">Scan final tersimpan</div><div class="ik-bg">${ik('cekL')}</div></button>
        <button class="mkpi b7" data-aksi="kpi" data-status="Batal"><div class="l">Dibatalkan</div><div class="n">${EA.angka(semua.filter((x) => x.Status === 'Batal').length)}</div><div class="s">Nomor tidak dipakai ulang</div><div class="ik-bg">${ik('batal')}</div></button>`);
      const rows = saringSK(), total = rows.length, n = Math.max(1, Math.ceil(total / per));
      if (fSK.hal > n) fSK.hal = n;
      const hal = rows.slice((fSK.hal - 1) * per, fSK.hal * per);
      EA.$('#sk-n', root).textContent = EA.angka(total) + ' nomor';
      if (!total) { EA.html(daftar, EA.kosong('keluar', 'Belum ada nomor surat keluar', EA.boleh.ambilNomor() ? 'Tekan "Ambil Nomor" untuk menerbitkan nomor.' : '')); return; }
      const statusSel = (x) => (x.Status === 'Nomor Diambil' && Date.now() - x.DibuatPada > 7 * 86400000 ? h`<span class="lc merah">${ik('awas', 'k')} ${Math.floor((Date.now() - x.DibuatPada) / 86400000)} hari tanpa scan</span>` : EA.lcStatus(x.Status));
      EA.html(daftar, h`<div class="tbl-wrap bisa-kartu"><table class="tbl"><thead><tr><th>Nomor Surat</th><th>Tgl Surat</th><th>Tujuan</th><th>Perihal</th><th class="c">Sifat</th><th>Bidang</th><th>Status</th><th class="r">Aksi</th></tr></thead><tbody>
        ${hal.map((x) => h`<tr data-aksi="buka" data-id="${x.ID}"><td><span class="nomor" style="${x.Status === 'Batal' ? 'text-decoration:line-through;color:var(--teks-3)' : ''}">${x.NomorSurat}</span><div class="sub">${x.ID}</div></td>
          <td>${EA.tglPendek(x.TglSurat)}</td><td class="asal">${x.Tujuan}</td><td><div class="perihal">${x.Perihal}</div>${x.Status === 'Batal' ? h`<div class="sub">Batal: ${x.AlasanBatal}</div>` : ''}</td>
          <td class="c">${EA.lcSifat(x.Sifat)}</td><td>${D.namaBidang(x.IDBidang)}</td><td>${statusSel(x)}</td>
          <td class="r"><div class="aksi-baris"><button class="btn-ik" data-aksi="salin" data-id="${x.ID}" title="Salin nomor" aria-label="Salin nomor">${ik('salin', 'k')}</button>
            ${x.Status !== 'Batal' && EA.boleh.kelolaSK(x) ? h`<button class="btn-ik" data-aksi="unggah" data-id="${x.ID}" title="${x.FileID ? 'Ganti scan' : 'Unggah scan'}" aria-label="Unggah scan">${ik('unggah', 'k')}</button>` : ''}
            ${x.Status === 'Nomor Diambil' && EA.boleh.kelolaSK(x) ? h`<button class="btn-ik" data-aksi="batal" data-id="${x.ID}" title="Batalkan nomor" aria-label="Batalkan nomor" style="color:var(--bahaya-tua)">${ik('batal', 'k')}</button>` : ''}</div></td></tr>`)}
        </tbody></table></div>
        <div class="kartu-hp">${hal.map((x) => h`<button class="kh" data-aksi="buka" data-id="${x.ID}"><div class="kh-1"><span class="mono tebal" style="color:var(--primer-tua);word-break:break-all">${x.NomorSurat}</span>${EA.lcSifat(x.Sifat)}</div>
          <div class="kh-p">${x.Perihal}</div><div class="kh-s">${x.Tujuan} · ${EA.tglPendek(x.TglSurat)}</div><div class="kh-f">${statusSel(x)}<span class="lc abu">${D.kodeBidang(x.IDBidang)}</span></div></button>`)}</div>
        <div class="tbl-kaki"><span>Menampilkan <b>${(fSK.hal - 1) * per + 1}–${Math.min(total, fSK.hal * per)}</b> dari <b>${EA.angka(total)}</b></span>${EA.paginasi(total, fSK.hal, per)}</div>`);
    },
    buka(id) { EA.detailSK(id); }
  };
  async function eksporSK(btn) {
    await EA.sibuk(btn, () => EA.xlsx('Surat-Keluar-' + (fSK.th || S.th) + '.xlsx', {
      nama: 'Surat Keluar', judul: 'Surat Keluar ' + (S.cfg.NamaInstansi || '') + ' — ' + (fSK.th || S.th), baris: saringSK(),
      kolom: [
        { label: 'No Urut', lebar: 9, tipe: 'angka', ambil: (x) => x.NoUrut }, { label: 'Nomor Surat', lebar: 30, ambil: (x) => x.NomorSurat },
        { label: 'Tgl Surat', lebar: 12, tipe: 'tanggal', ambil: (x) => x.TglSurat }, { label: 'Tujuan', lebar: 32, ambil: (x) => x.Tujuan },
        { label: 'Perihal', lebar: 50, ambil: (x) => x.Perihal }, { label: 'Sifat', lebar: 10, ambil: (x) => x.Sifat },
        { label: 'Klasifikasi', lebar: 12, ambil: (x) => x.KodeKlasifikasi }, { label: 'Bidang Pengolah', lebar: 22, ambil: (x) => D.namaBidang(x.IDBidang) },
        { label: 'Status', lebar: 14, ambil: (x) => x.Status }, { label: 'Keterangan', lebar: 30, ambil: (x) => (x.Status === 'Batal' ? 'BATAL: ' + x.AlasanBatal : '') }
      ]
    }));
  }
  async function batalSK(sk) {
    const k = await EA.konfirmasi({ judul: 'Batalkan nomor ' + sk.NomorSurat + '?', pesan: 'Nomor yang dibatalkan tidak dipakai ulang dan tetap tercatat di Buku Agenda dengan keterangan BATAL.', bahaya: true, ya: 'Batalkan Nomor', input: { label: 'Alasan pembatalan', wajib: true, min: 5, pesanMin: 'Alasan minimal 5 karakter.', placeholder: 'mis. salah tujuan surat' } });
    if (!k.ok) return;
    try { const r = await EA.api.tulis('sk.batal', { ID: sk.ID, alasan: k.nilai }); D.gabung('sk', r.sk); EA.toast('Nomor dibatalkan.'); } catch (e) { EA.galat(e); }
  }
  EA.detailSK = (id) => {
    EA.bukaPanel('sk', id, (obj) => {
      const sk = D.skById(id);
      if (!sk) {
        if (!D.dimuat(D.tahunId(id))) { D.pastikan(D.tahunId(id)).then(() => EA.panel && EA.panel.segar()).catch(EA.galat); obj.atur({ judul: 'Memuat…', isi: '' }); return; }
        obj.atur({ judul: 'Tidak ditemukan', isi: EA.kosong('galat', 'Surat keluar tidak ditemukan', ''), aksi: '' }); return;
      }
      const k = D.klasifikasi(sk.KodeKlasifikasi), kelola = EA.boleh.kelolaSK(sk) && sk.Status !== 'Batal';
      const lama = obj.b.querySelector('#pr-sk');
      obj.atur({
        judul: sk.NomorSurat, chip: h` ${EA.lcSifat(sk.Sifat)} ${EA.lcStatus(sk.Status)}`, sub: sk.ID + ' · ' + D.namaBidang(sk.IDBidang),
        aksi: h`<button class="btn k" data-aksi="salin">${ik('salin', 'k')} Salin Nomor</button>${kelola ? h`<button class="btn p k" data-aksi="unggah">${ik('unggah', 'k')} ${sk.FileID ? 'Ganti scan' : 'Unggah scan final'}</button>` : ''}
          ${kelola && (sk.Status === 'Nomor Diambil' || EA.boleh.admin()) ? h`<button class="btn g k" data-aksi="batal" style="color:var(--bahaya-tua)">${ik('batal', 'k')} Batalkan</button>` : ''}${EA.boleh.admin() && sk.Status !== 'Batal' ? h`<button class="btn g k" data-aksi="ubah">${ik('pensil', 'k')} Koreksi</button>` : ''}`,
        isi: h`${sk.Status === 'Batal' ? h`<div class="kotak-info merah" style="margin-bottom:14px">${ik('batal')}<div><b>Nomor dibatalkan.</b> Alasan: ${sk.AlasanBatal}</div></div>` : ''}
          ${sk.Status === 'Nomor Diambil' ? h`<div class="kotak-info kuning" style="margin-bottom:14px">${ik('unggah')}<div>Setelah surat ditandatangani, unggah scan finalnya agar status menjadi <b>Terkirim</b>.</div></div>` : ''}
          <div class="seksi"><h4>${ik('info', 'k')} Data Surat Keluar</h4><div class="dt-grid">
            <div class="dt penuh"><div class="l">Nomor Surat</div><div class="v mono" style="font-size:16px;font-weight:700;color:var(--primer-tua)">${sk.NomorSurat}</div></div>
            <div class="dt"><div class="l">Tgl Surat</div><div class="v">${EA.tglPanjang(sk.TglSurat)}</div></div><div class="dt"><div class="l">No Urut</div><div class="v">${sk.NoUrut}</div></div>
            <div class="dt penuh"><div class="l">Tujuan</div><div class="v">${sk.Tujuan}</div></div><div class="dt penuh"><div class="l">Perihal</div><div class="v" style="font-weight:600">${sk.Perihal}</div></div>
            <div class="dt"><div class="l">Klasifikasi</div><div class="v">${sk.KodeKlasifikasi}${k ? ' – ' + k.Uraian : ''}</div></div><div class="dt"><div class="l">Bidang Pengolah</div><div class="v">${D.namaBidang(sk.IDBidang)}</div></div>
            <div class="dt"><div class="l">Diambil oleh</div><div class="v">${D.nama(sk.DibuatOleh)}</div></div><div class="dt"><div class="l">Waktu</div><div class="v">${EA.waktu(sk.DibuatPada)}</div></div></div></div>
          <div class="seksi"><h4>${ik('pdf', 'k')} Scan Final</h4><div class="pratinjau" id="pr-sk" data-file="${sk.FileID || '-'}"></div></div>`
      });
      const pr = obj.b.querySelector('#pr-sk');
      if (lama && lama.dataset.file === pr.dataset.file && lama._isi) pr.replaceWith(lama); else { EA.pratinjau(pr, 'sk', sk.ID, sk.FileID); pr._isi = true; }
      obj.el.onclick = async (e) => {
        const t = e.target.closest('[data-aksi]'); if (!t) return;
        const a = t.dataset.aksi;
        if (a === 'salin') { if (await EA.salin(sk.NomorSurat)) EA.toast('Nomor disalin.'); }
        else if (a === 'unggah') EA.modalUnggah({ judul: 'Unggah scan final', sub: sk.NomorSurat, aksi: 'sk.unggah', id: sk.ID, jenis: 'sk' });
        else if (a === 'batal') batalSK(sk);
        else if (a === 'ubah') {
          const m = EA.modal({ judul: 'Koreksi surat keluar', sub: 'Nomor, tanggal, dan klasifikasi tetap terkunci (FR-34).', ikon: 'pensil', kelas: 'sedang',
            isi: h`<div class="stack"><div class="f"><label for="ku-t">Tujuan</label><input id="ku-t" value="${sk.Tujuan}" maxlength="200"></div><div class="f"><label for="ku-p">Perihal</label><textarea id="ku-p" maxlength="500">${sk.Perihal}</textarea></div>
              <div class="f"><span class="lbl-f">Sifat</span><div class="seg" id="ku-s">${SIFAT.map((x) => h`<button type="button" data-v="${x}" class="${sk.Sifat === x ? 'on' : ''}">${x}</button>`)}</div></div></div>`,
            kaki: h`<button class="btn g" data-batal>Batal</button><button class="btn p" id="ku-ok">Simpan</button>` });
          let sifat = sk.Sifat;
          EA.$('#ku-s', m.el).onclick = (ev) => { const b = ev.target.closest('[data-v]'); if (!b) return; sifat = b.dataset.v; EA.$$('#ku-s button', m.el).forEach((x) => x.classList.toggle('on', x === b)); };
          EA.$('#ku-ok', m.el).onclick = (ev) => EA.sibuk(ev.currentTarget, async () => { try { const r = await EA.api.tulis('sk.ubah', { ID: sk.ID, Tujuan: EA.$('#ku-t', m.el).value, Perihal: EA.$('#ku-p', m.el).value, Sifat: sifat }); D.gabung('sk', r.sk); m.tutup(); EA.toast('Koreksi disimpan.'); } catch (er) { EA.galat(er); } });
        }
      };
    });
  };
  EA.modalAmbilNomor = () => {
    const staf = EA.boleh.staf(), hari = EA.hariIni();
    let sifat = 'Biasa', klas, idB = staf ? S.user.idBidang : ((S.mst.bidang || []).find((b) => b.Aktif !== false) || {}).IDBidang || '';
    const m = EA.modal({
      judul: 'Ambil Nomor Surat Keluar', ikon: 'pagar', kelas: 'sedang', sub: h`${ik('gembok', 'k')} Penomoran otomatis terjamin urut & anti-dobel (LockService)`,
      isi: h`<div class="nomor-pratinjau"><div class="np-h"><span>${ik('pagar', 'k')} Nomor surat (pratinjau)</span><span class="lc hijau">● Dikunci saat disimpan</span></div>
          <div class="np-n"><div><b id="an-no">—</b><small>Formula: <span class="mono">${S.cfg.FormatNomorKeluar || '{NO:3}/{KLASIFIKASI}/{INSTANSI}/{BULAN_ROMAWI}/{TAHUN}'}</span></small></div></div></div>
        <div class="stack" style="margin-top:16px">
          <div class="grid2"><div class="f"><label for="an-tgl">Tanggal Surat <span class="w">*</span></label><input type="date" id="an-tgl" value="${hari}"><span class="bantu">Bawaan: hari ini</span></div>
            <div class="f"><label for="an-b">Bidang Pengolah <span class="w">*</span></label><select id="an-b" ${staf ? 'disabled' : ''}>${(S.mst.bidang || []).filter((b) => b.Aktif !== false || b.IDBidang === idB).map((b) => h`<option value="${b.IDBidang}" ${b.IDBidang === idB ? 'selected' : ''}>${b.NamaBidang}</option>`)}</select></div></div>
          <div class="f"><label for="an-k-in">Kode Klasifikasi <span class="w">*</span></label><div id="an-k"></div></div>
          <div class="f"><label for="an-t">Tujuan / Instansi Penerima <span class="w">*</span></label><input id="an-t" maxlength="200" placeholder="mis. Kepala Dinas Pendidikan Provinsi" autocomplete="off"></div>
          <div class="f"><label for="an-p">Perihal / Ringkasan Isi <span class="w">*</span> <small>Maks. 500 karakter</small></label><textarea id="an-p" rows="2" maxlength="500"></textarea></div>
          <div class="f"><span class="lbl-f">Sifat Surat</span><div class="seg" id="an-s">${SIFAT.map((x) => h`<button type="button" data-v="${x}" class="${x === sifat ? 'on' : ''}">${x}</button>`)}</div></div>
          <div class="kotak-info merah">${ik('galat')}<div><b>Peringatan kearsipan:</b> nomor yang telah diterbitkan tidak dapat dihapus atau diubah. Bila surat batal, gunakan pembatalan resmi dengan alasan tertulis.</div></div></div>`,
      kaki: h`<button class="btn g" data-batal>Tutup & Batal</button><button class="btn p" id="an-ok">${ik('perisai', 'k')} Simpan & Terbitkan Nomor</button>`
    });
    const el = m.el;
    const pratinjau = () => { EA.$('#an-no', el).textContent = D.nomorBerikut(klas.nilai() || '…', EA.$('#an-tgl', el).value || hari, EA.$('#an-b', el).value); };
    klas = EA.pilihCari(EA.$('#an-k', el), { opsi: EA.opsiKlasifikasi, nilai: D.klasTerakhir(), id: 'an-k-in', onUbah: pratinjau });
    EA.$('#an-s', el).onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b) return; sifat = b.dataset.v; EA.$$('#an-s button', el).forEach((x) => x.classList.toggle('on', x === b)); };
    EA.$('#an-tgl', el).onchange = pratinjau; EA.$('#an-b', el).onchange = pratinjau;
    pratinjau();
    EA.$('#an-ok', el).onclick = (e) => {
      const d = { TglSurat: EA.$('#an-tgl', el).value, IDBidang: EA.$('#an-b', el).value, KodeKlasifikasi: klas.nilai(), Tujuan: EA.$('#an-t', el).value.trim(), Perihal: EA.$('#an-p', el).value.trim(), Sifat: sifat };
      const kurang = [['TglSurat', 'Tanggal'], ['KodeKlasifikasi', 'Klasifikasi'], ['Tujuan', 'Tujuan'], ['Perihal', 'Perihal']].filter(([k]) => !d[k]).map(([, l]) => l);
      if (kurang.length) { EA.toast('Lengkapi: ' + kurang.join(', ') + '.', 'galat'); return; }
      EA.sibuk(e.currentTarget, async () => {
        try {
          const r = await EA.api.tulis('sk.ambil', d);
          D.gabung('sk', r.sk);
          D.setCfg({ ['Penghitung_Keluar_' + r.sk.Tahun]: String(r.sk.NoUrut) });
          m.tutup();
          hasilNomor(r.sk);
        } catch (er) { EA.galat(er); }
      }, ' Mengunci nomor…');
    };
  };
  function hasilNomor(sk) {
    const m = EA.modal({
      judul: 'Nomor berhasil diterbitkan', ikon: 'cekL', kelas: 'sedang',
      isi: h`<div class="nomor-besar"><small>Nomor Surat Keluar</small><b id="hn-no">${sk.NomorSurat}</b><small>${sk.Tujuan} · ${EA.tglPanjang(sk.TglSurat)}</small></div>
        <div class="kotak-info biru" style="margin-top:14px">${ik('info')}<div>Setelah surat ditandatangani, unggah scan finalnya di menu Surat Keluar agar status menjadi <b>Terkirim</b>.</div></div>`,
      kaki: h`<button class="btn" id="hn-scan">${ik('unggah', 'k')} Unggah Scan Sekarang</button><button class="btn p" id="hn-salin">${ik('salin', 'k')} Salin Nomor</button>`
    });
    EA.$('#hn-salin', m.el).onclick = async () => { if (await EA.salin(sk.NomorSurat)) { EA.toast('Nomor disalin.'); } };
    EA.$('#hn-scan', m.el).onclick = () => { m.tutup(); EA.modalUnggah({ judul: 'Unggah scan final', sub: sk.NomorSurat, aksi: 'sk.unggah', id: sk.ID, jenis: 'sk' }); };
  }

  /* ================= ARSIP (pencarian lintas tahun, FR-40) ================= */
  const fAr = { q: '', jenis: '', tahun: '', server: null, memuat: false, kunci: '' };
  EA.hal.arsip = {
    judul: 'Arsip',
    render(root, p) {
      if (p.q !== undefined) fAr.q = p.q;
      root.innerHTML = h`<div class="kepala"><div><h1>Arsip & Pencarian</h1><p>Cari nomor surat, No Agenda, perihal, asal atau tujuan di seluruh tahun. Hasil mengikuti hak akses Anda.</p></div></div>
        <div class="kartu" style="margin-bottom:16px"><div class="saring"><label class="cari" style="flex-basis:420px"><span class="sr">Cari arsip</span>${ik('cari')}<input id="ar-q" type="search" placeholder="Ketik minimal 2 huruf…" value="${fAr.q}" autofocus></label>
          <select id="ar-j" aria-label="Jenis"><option value="">Masuk & keluar</option><option value="sm" ${fAr.jenis === 'sm' ? 'selected' : ''}>Surat masuk</option><option value="sk" ${fAr.jenis === 'sk' ? 'selected' : ''}>Surat keluar</option></select>
          <select id="ar-t" aria-label="Tahun"><option value="">Semua tahun</option>${Array.from(new Set([EA.tahunIni(), ...(S.meta.tahunList || [])])).sort((a, b) => b - a).map((t) => h`<option value="${t}" ${String(fAr.tahun) === String(t) ? 'selected' : ''}>${t}</option>`)}</select></div></div>
        <div class="kartu"><div id="ar-hasil"></div></div>`.s;
      const q = EA.$('#ar-q', root);
      const cariServer = EA.debounce(() => this.cariServer(root), 450);
      q.addEventListener('input', () => { fAr.q = q.value; history.replaceState(null, '', '#/arsip' + (fAr.q ? '?q=' + encodeURIComponent(fAr.q) : '')); this.segar(root); cariServer(); });
      root.onchange = (e) => { if (e.target.id === 'ar-j') fAr.jenis = e.target.value; if (e.target.id === 'ar-t') fAr.tahun = e.target.value; this.segar(root); this.cariServer(root); };
      root.onclick = (e) => { const t = e.target.closest('[data-aksi]'); if (!t) return; EA.keDetail('#/' + (t.dataset.j === 'sm' ? 'surat-masuk/' : 'surat-keluar/') + t.dataset.id); };
      this.segar(root); this.cariServer(root);
    },
    async cariServer(root) {
      const q = fAr.q.trim();
      if (q.length < 2) { fAr.server = null; return; }
      const kunci = q + '|' + fAr.jenis + '|' + fAr.tahun;
      fAr.kunci = kunci; fAr.memuat = true; this.segar(root);
      try {
        const r = await EA.api.baca('arsip.cari', { q, jenis: fAr.jenis, tahun: fAr.tahun });
        if (fAr.kunci !== kunci) return;
        fAr.server = r.hasil;
      } catch (e) { if (fAr.kunci === kunci) fAr.server = null; }
      fAr.memuat = false;
      if (root.isConnected) this.segar(root);
    },
    segar(root) {
      const el = EA.$('#ar-hasil', root); if (!el) return;
      const q = EA.norm(fAr.q);
      if (q.length < 2) { EA.html(el, EA.kosong('cari', 'Mulai mengetik untuk mencari', 'Contoh: "undangan rapat", "421/309", "Dinas Pendidikan", atau No Agenda "0045".')); return; }
      const lokal = [];
      Object.keys(S.tahun).forEach((th) => {
        if (fAr.tahun && String(th) !== String(fAr.tahun)) return;
        if (fAr.jenis !== 'sk') D.smAktif(th).forEach((x) => { if (cocokQ([x.NoAgenda, x.NoSurat, x.Perihal, x.AsalSurat, x.ID].join(' '), q)) lokal.push({ j: 'sm', id: x.ID, th: x.Tahun, no: x.NoAgenda, nomor: x.NoSurat, tgl: x.TglTerima, pihak: x.AsalSurat, perihal: x.Perihal, sifat: x.Sifat, status: x.StatusDisposisi }); });
        if (fAr.jenis !== 'sm') D.sk(th).forEach((x) => { if (cocokQ([x.NomorSurat, x.Perihal, x.Tujuan, x.ID].join(' '), q)) lokal.push({ j: 'sk', id: x.ID, th: x.Tahun, no: String(x.NoUrut), nomor: x.NomorSurat, tgl: x.TglSurat, pihak: x.Tujuan, perihal: x.Perihal, sifat: x.Sifat, status: x.Status }); });
      });
      const peta = new Map();
      lokal.concat(fAr.server || []).forEach((x) => peta.set(x.id, x));
      const hasil = Array.from(peta.values()).sort((a, b) => (a.tgl < b.tgl ? 1 : -1));
      EA.html(el, h`<div class="kartu-h" style="padding-bottom:12px"><h3>${EA.angka(hasil.length)} hasil</h3><span class="redup kecil">${fAr.memuat ? h`<span class="putar gelap" style="display:inline-block;vertical-align:middle;width:14px;height:14px"></span> mencari di semua tahun…` : fAr.server ? 'Termasuk hasil dari semua tahun' : ''}</span></div>
        ${hasil.length ? h`<div class="dl" style="padding:0 12px 12px">${hasil.slice(0, 200).map((x) => h`<button class="dl-i" data-aksi="buka" data-j="${x.j}" data-id="${x.id}"><span class="ik-chip ${x.j === 'sm' ? 'biru' : 'hijau'}">${ik(x.j === 'sm' ? 'masuk' : 'keluar', 'k')}</span>
          <span class="isi-i"><b>${x.perihal}</b><span class="mono">${x.j === 'sm' ? 'Agenda ' + x.no + '/' + x.th + ' · ' + x.nomor : x.nomor}</span><span>${x.j === 'sm' ? 'Dari: ' : 'Tujuan: '}${x.pihak} · ${EA.tglPendek(x.tgl)}</span></span>
          <span class="kanan">${EA.lcSifat(x.sifat)}${EA.lcStatus(x.status)}</span></button>`)}</div>` : (fAr.memuat ? '' : EA.kosong('cari', 'Tidak ditemukan', 'Coba kata kunci lain.'))}`);
    }
  };
})(window);
