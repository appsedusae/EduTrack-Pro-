/* hal-admin.js — Laporan (statistik, rekap + ekspor Excel/PDF, Buku Agenda), Master Data, Pengguna,
   Notifikasi/Antrean WA, Pengaturan (termasuk rahasia tersamar, impor Excel & migrasi), dan Log Aktivitas. */
(function (w) {
  'use strict';
  const EA = w.EA, S = EA.S, h = EA.h, ik = EA.ikon, D = EA.data;
  const SIFAT = ['Biasa', 'Penting', 'Segera', 'Rahasia'];
  const WARNA_SIFAT = { Biasa: '#0891B2', Penting: '#FB923C', Segera: '#B91C1C', Rahasia: '#7C3AED' };
  const per = 20;

  /* ================= LAPORAN ================= */
  const fL = { tab: 'statistik', dari: EA.tahunIni() + '-01-01', sampai: EA.hariIni(), bidang: '', jenis: 'masuk', sifat: '', status: '', hal: 1,
    buku: { jenis: 'masuk', mode: 'bulan', bulan: EA.bulanIni(), tahun: EA.tahunIni(), kertas: 'A4' } };
  const tahunRentang = (a, b) => { const out = []; for (let y = Number(a.slice(0, 4)); y <= Number(b.slice(0, 4)); y++) out.push(y); return out; };
  const pastikanRentang = (a, b) => Promise.all(tahunRentang(a, b).map((y) => D.pastikan(y)));
  const dalam = (iso) => iso && iso >= fL.dari && iso <= fL.sampai;
  function dataRentang() {
    let sm = [], sk = [], dsp = [];
    tahunRentang(fL.dari, fL.sampai).forEach((y) => { sm = sm.concat(D.smAktif(y)); sk = sk.concat(D.sk(y)); dsp = dsp.concat(D.dsp(y)); });
    sm = sm.filter((x) => dalam(x.TglTerima)); sk = sk.filter((x) => dalam(x.TglSurat));
    dsp = dsp.filter((d) => dalam(EA.isoDariMs(d.TglDikirim)) && D.smById(d.IDSuratMasuk) && !D.smById(d.IDSuratMasuk).Dihapus);
    if (fL.bidang) { dsp = dsp.filter((d) => d.KepadaBidang === fL.bidang); sk = sk.filter((x) => x.IDBidang === fL.bidang); const ids = new Set(dsp.map((d) => d.IDSuratMasuk)); sm = sm.filter((x) => ids.has(x.ID)); }
    return { sm, sk, dsp };
  }
  EA.hal.laporan = {
    judul: 'Laporan',
    render(root, p) {
      if (p.tab) fL.tab = p.tab;
      if (p.jenis) fL.buku.jenis = p.jenis;
      if (fL.tab === 'buku' && !EA.boleh.bukuAgenda()) fL.tab = 'statistik';
      const staf = EA.boleh.staf();
      root.innerHTML = h`<div class="kepala"><div><h1>Laporan ${staf ? h`<span class="pill">${S.user.namaBidang}</span>` : ''}</h1><p>Statistik persuratan, rekap data dengan ekspor Excel/PDF${EA.boleh.bukuAgenda() ? ', dan Buku Agenda resmi' : ''}.</p></div></div>
        <div class="tab" role="tablist"><button data-tab="statistik" class="${fL.tab === 'statistik' ? 'on' : ''}">${ik('laporan', 'k')} Statistik</button><button data-tab="rekap" class="${fL.tab === 'rekap' ? 'on' : ''}">${ik('database', 'k')} Rekap Data</button>${EA.boleh.bukuAgenda() ? h`<button data-tab="buku" class="${fL.tab === 'buku' ? 'on' : ''}">${ik('buku', 'k')} Buku Agenda</button>` : ''}</div>
        <div id="lp-isi"></div>`.s;
      root.onclick = (e) => { const t = e.target.closest('[data-tab]'); if (t) { fL.tab = t.dataset.tab; history.replaceState(null, '', '#/laporan?tab=' + fL.tab); this.render(root, {}); } };
      this.gambarTab(root);
    },
    gambarTab(root) {
      const el = EA.$('#lp-isi', root);
      const saringan = h`<div class="kartu" style="margin-bottom:16px"><div class="saring">
        <div class="f" style="flex:0 1 170px"><label for="lp-dari">Dari</label><input type="date" id="lp-dari" value="${fL.dari}"></div>
        <div class="f" style="flex:0 1 170px"><label for="lp-sampai">Sampai</label><input type="date" id="lp-sampai" value="${fL.sampai}"></div>
        <div class="f" style="flex:0 1 auto"><span class="lbl-f">Cepat</span><div class="chip-cepat"><button type="button" data-rentang="bulan">Bulan ini</button><button type="button" data-rentang="3bln">3 bulan</button><button type="button" data-rentang="tahun">Tahun ini</button><button type="button" data-rentang="lalu">Tahun lalu</button></div></div>
        ${EA.boleh.staf() ? '' : h`<div class="f" style="flex:0 1 200px"><label for="lp-bidang">Bidang</label><select id="lp-bidang"><option value="">Semua bidang</option>${(S.mst.bidang || []).map((b) => h`<option value="${b.IDBidang}" ${fL.bidang === b.IDBidang ? 'selected' : ''}>${b.NamaBidang}</option>`)}</select></div>`}
        ${fL.tab === 'rekap' ? h`<div class="f" style="flex:0 1 160px"><label for="lp-jenis">Jenis</label><select id="lp-jenis">${[['masuk', 'Surat masuk'], ['keluar', 'Surat keluar'], ['disposisi', 'Disposisi']].map(([v, l]) => h`<option value="${v}" ${fL.jenis === v ? 'selected' : ''}>${l}</option>`)}</select></div>
          <div class="f" style="flex:0 1 140px"><label for="lp-sifat">Sifat</label><select id="lp-sifat"><option value="">Semua</option>${SIFAT.map((x) => h`<option ${fL.sifat === x ? 'selected' : ''}>${x}</option>`)}</select></div>
          <div class="f" style="flex:0 1 160px"><label for="lp-status">Status</label><select id="lp-status"><option value="">Semua</option>${(fL.jenis === 'keluar' ? ['Nomor Diambil', 'Terkirim', 'Batal'] : fL.jenis === 'disposisi' ? ['Baru', 'Dibaca', 'Diproses', 'Selesai', 'Terlambat'] : ['Belum', 'Proses', 'Selesai']).map((x) => h`<option ${fL.status === x ? 'selected' : ''}>${x}</option>`)}</select></div>` : ''}
      </div></div>`;
      if (fL.tab === 'buku') { this.gambarBuku(el); return; }
      el.innerHTML = h`${saringan}<div id="lp-konten"><div class="kosong"><div class="putar gelap" style="margin:0 auto"></div></div></div>`.s;
      const muatUlang = () => { fL.hal = 1; pastikanRentang(fL.dari, fL.sampai).then(() => this.segar(el.closest('#isi') || document)).catch(EA.galat); };
      el.onchange = (e) => {
        const id = e.target.id;
        if (id === 'lp-dari') fL.dari = e.target.value || fL.dari;
        if (id === 'lp-sampai') fL.sampai = e.target.value || fL.sampai;
        if (id === 'lp-bidang') fL.bidang = e.target.value;
        if (id === 'lp-jenis') { fL.jenis = e.target.value; fL.status = ''; this.gambarTab(root); return; }
        if (id === 'lp-sifat') fL.sifat = e.target.value;
        if (id === 'lp-status') fL.status = e.target.value;
        muatUlang();
      };
      el.onclick = (e) => {
        const r = e.target.closest('[data-rentang]'), hl = e.target.closest('[data-hal]'), ex = e.target.closest('[data-ekspor]');
        if (r) {
          const hari = EA.hariIni(), th = EA.tahunIni();
          if (r.dataset.rentang === 'bulan') { fL.dari = EA.bulanIni() + '-01'; fL.sampai = hari; }
          if (r.dataset.rentang === '3bln') { fL.dari = EA.tambahHari(hari, -90); fL.sampai = hari; }
          if (r.dataset.rentang === 'tahun') { fL.dari = th + '-01-01'; fL.sampai = hari; }
          if (r.dataset.rentang === 'lalu') { fL.dari = (th - 1) + '-01-01'; fL.sampai = (th - 1) + '-12-31'; }
          EA.$('#lp-dari', el).value = fL.dari; EA.$('#lp-sampai', el).value = fL.sampai;
          muatUlang();
        }
        if (hl) { fL.hal = Number(hl.dataset.hal); this.segar(root); }
        if (ex) this.ekspor(ex.dataset.ekspor, ex);
      };
      muatUlang();
    },
    segar(root) {
      const k = EA.$('#lp-konten', document); if (!k) return;
      if (fL.tab === 'statistik') this.gambarStatistik(k); else if (fL.tab === 'rekap') this.gambarRekap(k);
    },
    gambarStatistik(k) {
      const { sm, sk, dsp } = dataRentang();
      const bulan = [];
      for (let ym = fL.dari.slice(0, 7); ym <= fL.sampai.slice(0, 7); ) { bulan.push(ym); const [y, m] = ym.split('-').map(Number); ym = m === 12 ? (y + 1) + '-01' : y + '-' + EA.pad(m + 1, 2); if (bulan.length > 60) break; }
      const hitung = (arr, f) => bulan.map((b) => arr.filter((x) => f(x).slice(0, 7) === b).length);
      const skAktif = sk.filter((x) => x.Status !== 'Batal');
      const komp = SIFAT.map((s) => ({ nama: s, warna: WARNA_SIFAT[s], nilai: sm.filter((x) => x.Sifat === s).length + skAktif.filter((x) => x.Sifat === s).length }));
      const totKomp = komp.reduce((a, x) => a + x.nilai, 0);
      const selesai = dsp.filter((d) => d.Status === 'Selesai' && d.TglSelesai);
      const rata = (arr) => (arr.length ? arr.reduce((a, d) => a + (d.TglSelesai - d.TglDikirim) / 86400000, 0) / arr.length : 0);
      const bidang = (S.mst.bidang || []).filter((b) => !fL.bidang || b.IDBidang === fL.bidang).map((b) => {
        const ds = dsp.filter((d) => d.KepadaBidang === b.IDBidang), sel = ds.filter((d) => d.Status === 'Selesai');
        const tepat = sel.filter(D.tepatWaktu).length, telat = sel.length - tepat, aktifTelat = ds.filter(D.terlambat).length;
        return { b, total: ds.length, tepat, telat, aktifTelat, rata: rata(sel) };
      }).filter((x) => x.total);
      const maksRata = Math.max(1, ...bidang.map((x) => x.rata));
      k.innerHTML = h`<div class="mini-kpi">
          <div class="mkpi b1"><div class="l">Surat Masuk</div><div class="n">${EA.angka(sm.length)}</div><div class="s">${EA.tglPendek(fL.dari)} – ${EA.tglPendek(fL.sampai)}</div></div>
          <div class="mkpi b5"><div class="l">Surat Keluar</div><div class="n">${EA.angka(skAktif.length)}</div><div class="s">${sk.length - skAktif.length} nomor batal</div></div>
          <div class="mkpi b2"><div class="l">Disposisi</div><div class="n">${EA.angka(dsp.length)}<span>${EA.desimal(EA.persen(selesai.length, dsp.length))}% selesai</span></div><div class="s">${dsp.filter(D.terlambat).length} masih terlambat</div></div>
          <div class="mkpi b6"><div class="l">Rata-rata Penyelesaian</div><div class="n">${EA.desimal(rata(selesai))}<span>hari</span></div><div class="s">${EA.desimal(EA.persen(selesai.filter(D.tepatWaktu).length, selesai.length))}% tepat waktu</div></div></div>
        <div class="g2k"><div class="kartu"><div class="kartu-h"><div><h3>Surat Masuk vs Keluar per Bulan</h3><div class="sub">Periode terpilih</div></div><div class="legenda kotak"><span><i style="background:#2563EB"></i>Masuk</span><span><i style="background:#16A34A"></i>Keluar</span></div></div><div class="kartu-b"><div id="st-bulan"></div></div></div>
          <div class="kartu"><div class="kartu-h"><div><h3>Komposisi Sifat Surat</h3><div class="sub">${EA.angka(totKomp)} surat</div></div></div><div class="kartu-b cq"><div class="donat-wrap"><div id="st-donat"></div><div class="donat-leg">${komp.map((x) => h`<div class="d"><i style="background:${x.warna}"></i><span>${x.nama}</span><b>${EA.angka(x.nilai)}</b><small>${EA.desimal(EA.persen(x.nilai, totKomp))}%</small></div>`)}</div></div></div></div></div>
        <div class="g2k"><div class="kartu"><div class="kartu-h"><div><h3>Disposisi Selesai: Tepat Waktu vs Terlambat per Bidang</h3><div class="sub">Garis arsir = terlambat</div></div><div class="legenda"><span><i style="background:#16A34A"></i>Tepat</span><span><i style="background:#B91C1C"></i>Terlambat</span></div></div>
            <div class="kartu-b">${bidang.length ? h`<div class="kinerja">${bidang.map((x) => { const t = x.tepat + x.telat; return h`<div class="kb"><div class="kb-h"><span>${x.b.NamaBidang} <small class="redup">(${x.total} disposisi${x.aktifTelat ? ', ' + x.aktifTelat + ' terlambat aktif' : ''})</small></span><b>${x.tepat} tepat · ${x.telat} telat</b></div>
              <div class="kb-bar">${x.tepat ? h`<i style="width:${EA.persen(x.tepat, t)}%;background:#16A34A"></i>` : ''}${x.telat ? h`<i class="pola-telat" style="width:${EA.persen(x.telat, t)}%;background-color:#B91C1C"></i>` : ''}</div></div>`; })}</div>` : EA.kosong('laporan', 'Belum ada disposisi pada periode ini', '')}</div></div>
          <div class="kartu"><div class="kartu-h"><div><h3>Rata-rata Waktu Penyelesaian</h3><div class="sub">Hari dari dikirim sampai selesai</div></div></div>
            <div class="kartu-b">${bidang.length ? h`<div class="kinerja">${bidang.map((x) => h`<div class="kb"><div class="kb-h"><span>${x.b.NamaBidang}</span><b>${EA.desimal(x.rata)} hari</b></div><div class="kb-bar"><i style="width:${Math.max(2, (x.rata / maksRata) * 100)}%;background:#2563EB"></i></div></div>`)}</div>` : EA.kosong('jam', 'Belum ada data', '')}</div></div></div>`.s;
      EA.grafik.batang(EA.$('#st-bulan', k), { label: bulan.map((b) => EA.BLN[Number(b.slice(5, 7)) - 1] + (bulan.length > 12 ? ' ' + b.slice(2, 4) : '')), judulX: bulan.map(EA.namaBulan), tinggi: 240, aria: 'Surat per bulan', seri: [{ nama: 'Masuk', warna: '#2563EB', data: hitung(sm, (x) => x.TglTerima) }, { nama: 'Keluar', warna: '#16A34A', data: hitung(skAktif, (x) => x.TglSurat) }] });
      EA.grafik.donat(EA.$('#st-donat', k), { data: komp, ukuran: window.innerWidth < 768 ? 130 : 160, tengah: 'SURAT' });
    },
    barisRekap() {
      const { sm, sk, dsp } = dataRentang();
      if (fL.jenis === 'masuk') return sm.filter((x) => (!fL.sifat || x.Sifat === fL.sifat) && (!fL.status || x.StatusDisposisi === fL.status)).sort((a, b) => (a.TglTerima + a.NoAgenda > b.TglTerima + b.NoAgenda ? 1 : -1));
      if (fL.jenis === 'keluar') return sk.filter((x) => (!fL.sifat || x.Sifat === fL.sifat) && (!fL.status || x.Status === fL.status)).sort((a, b) => a.NoUrut - b.NoUrut);
      return dsp.filter((d) => { const sm2 = D.smById(d.IDSuratMasuk) || {}; return (!fL.sifat || sm2.Sifat === fL.sifat) && (!fL.status || D.statusTampil(d) === fL.status); }).sort((a, b) => a.TglDikirim - b.TglDikirim);
    },
    kolomRekap() {
      if (fL.jenis === 'masuk') return [
        { label: 'No Agenda', lebar: 0.7, x: 11, ambil: (x) => x.NoAgenda }, { label: 'Tgl Terima', lebar: 0.8, x: 12, tipe: 'tanggal', ambil: (x) => x.TglTerima, tampil: (x) => EA.tglPendek(x.TglTerima) },
        { label: 'No Surat', lebar: 1.3, x: 26, ambil: (x) => x.NoSurat }, { label: 'Asal Surat', lebar: 1.4, x: 30, ambil: (x) => x.AsalSurat },
        { label: 'Perihal', lebar: 2.4, x: 50, ambil: (x) => x.Perihal }, { label: 'Sifat', lebar: 0.6, x: 10, ambil: (x) => x.Sifat },
        { label: 'Status', lebar: 0.7, x: 12, ambil: (x) => x.StatusDisposisi }, { label: 'Diteruskan ke', lebar: 1.3, x: 30, ambil: (x) => D.dspUntukSm(x.ID).map((d) => D.namaBidang(d.KepadaBidang)).join(', ') }];
      if (fL.jenis === 'keluar') return [
        { label: 'Nomor Surat', lebar: 1.5, x: 30, ambil: (x) => x.NomorSurat }, { label: 'Tgl Surat', lebar: 0.8, x: 12, tipe: 'tanggal', ambil: (x) => x.TglSurat, tampil: (x) => EA.tglPendek(x.TglSurat) },
        { label: 'Tujuan', lebar: 1.5, x: 30, ambil: (x) => x.Tujuan }, { label: 'Perihal', lebar: 2.2, x: 50, ambil: (x) => x.Perihal }, { label: 'Sifat', lebar: 0.6, x: 10, ambil: (x) => x.Sifat },
        { label: 'Bidang', lebar: 1, x: 20, ambil: (x) => D.namaBidang(x.IDBidang) }, { label: 'Status', lebar: 0.8, x: 14, ambil: (x) => x.Status + (x.Status === 'Batal' ? ' (' + x.AlasanBatal + ')' : '') }];
      return [
        { label: 'ID', lebar: 1, x: 16, ambil: (d) => d.ID }, { label: 'No Agenda', lebar: 0.7, x: 11, ambil: (d) => (D.smById(d.IDSuratMasuk) || {}).NoAgenda },
        { label: 'Perihal', lebar: 2.2, x: 46, ambil: (d) => (D.smById(d.IDSuratMasuk) || {}).Perihal }, { label: 'Bidang', lebar: 1, x: 20, ambil: (d) => D.namaBidang(d.KepadaBidang) },
        { label: 'Instruksi', lebar: 1.4, x: 30, ambil: (d) => d.Instruksi }, { label: 'Dikirim', lebar: 0.8, x: 16, ambil: (d) => EA.waktu(d.TglDikirim) },
        { label: 'Batas', lebar: 0.7, x: 12, tipe: 'tanggal', ambil: (d) => d.BatasWaktu, tampil: (d) => EA.tglPendek(d.BatasWaktu) }, { label: 'Status', lebar: 0.7, x: 12, ambil: (d) => D.statusTampil(d) },
        { label: 'Selesai', lebar: 0.8, x: 16, ambil: (d) => (d.TglSelesai ? EA.waktu(d.TglSelesai) : '') }, { label: 'Tanggapan', lebar: 1.8, x: 40, ambil: (d) => d.Tanggapan }];
    },
    gambarRekap(k) {
      const rows = this.barisRekap(), kol = this.kolomRekap(), total = rows.length, n = Math.max(1, Math.ceil(total / per));
      if (fL.hal > n) fL.hal = n;
      const hal = rows.slice((fL.hal - 1) * per, fL.hal * per);
      k.innerHTML = h`<div class="kartu"><div class="kartu-h" style="padding-bottom:12px"><h3>Rekap ${fL.jenis === 'masuk' ? 'Surat Masuk' : fL.jenis === 'keluar' ? 'Surat Keluar' : 'Disposisi'} <span class="pill">${EA.angka(total)} baris</span></h3>
          <div class="baris-flex"><button class="btn k" data-ekspor="xlsx">${ik('unduh', 'k')} Excel (.xlsx)</button><button class="btn k" data-ekspor="pdf">${ik('pdf', 'k')} PDF</button></div></div>
        ${total ? h`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>No</th>${kol.map((c) => h`<th>${c.label}</th>`)}</tr></thead><tbody>${hal.map((r, i) => h`<tr style="cursor:default"><td class="redup">${(fL.hal - 1) * per + i + 1}</td>${kol.map((c) => h`<td>${c.tampil ? c.tampil(r) : c.ambil(r)}</td>`)}</tr>`)}</tbody></table></div>
          <div class="tbl-kaki"><span>Halaman ${fL.hal} dari ${n}</span>${EA.paginasi(total, fL.hal, per)}</div>` : EA.kosong('database', 'Tidak ada data', 'Ubah periode atau filter.')}</div>`.s;
    },
    async ekspor(jenis, btn) {
      const rows = this.barisRekap(), kol = this.kolomRekap();
      const judul = 'Rekap ' + (fL.jenis === 'masuk' ? 'Surat Masuk' : fL.jenis === 'keluar' ? 'Surat Keluar' : 'Disposisi');
      const sub = 'Periode ' + EA.tglPanjang(fL.dari) + ' s.d. ' + EA.tglPanjang(fL.sampai) + (fL.bidang ? ' · ' + D.namaBidang(fL.bidang) : '');
      const nama = judul.replace(/\s+/g, '-') + '_' + fL.dari + '_' + fL.sampai;
      await EA.sibuk(btn, async () => {
        try {
          if (jenis === 'xlsx') await EA.xlsx(nama + '.xlsx', { nama: judul, judul: judul + ' — ' + sub, baris: rows, kolom: [{ label: 'No', lebar: 6, tipe: 'angka', ambil: (r, i) => i + 1 }].concat(kol.map((c) => ({ label: c.label, lebar: c.x, tipe: c.tipe, ambil: c.ambil }))) });
          else { const blob = await EA.pdfTabel({ judul, subjudul: sub, kertas: 'A4', baris: rows, kolom: [{ label: 'No', lebar: 0.35, rata: 'tengah', ambil: (r, i) => i + 1 }].concat(kol.map((c) => ({ label: c.label, lebar: c.lebar, ambil: c.tampil || c.ambil }))) }); EA.unduhBlob(blob, nama + '.pdf'); }
          EA.toast('Berkas ' + jenis.toUpperCase() + ' diunduh.');
        } catch (e) { EA.galat(e); }
      }, ' Menyiapkan…');
    },
    gambarBuku(el) {
      const b = fL.buku, th = EA.tahunIni();
      const tahunOps = Array.from(new Set([th, ...(S.meta.tahunList || [])])).sort((a, c) => c - a);
      el.innerHTML = h`<div class="kartu" style="max-width:820px"><div class="kartu-h"><div><h3>${ik('buku')} Buku Agenda Resmi</h3><div class="sub">PDF landscape ber-kop instansi, bernomor halaman, dengan blok tanda tangan pimpinan & petugas agenda.</div></div></div>
        <div class="kartu-b"><div class="stack">
          <div class="f"><span class="lbl-f">Jenis</span><div class="seg" style="grid-template-columns:repeat(2,1fr)" id="bk-jenis"><button type="button" data-v="masuk" class="${b.jenis === 'masuk' ? 'on' : ''}">Surat Masuk</button><button type="button" data-v="keluar" class="${b.jenis === 'keluar' ? 'on' : ''}">Surat Keluar</button></div></div>
          <div class="grid3"><div class="f"><label for="bk-mode">Periode</label><select id="bk-mode"><option value="bulan" ${b.mode === 'bulan' ? 'selected' : ''}>Per bulan</option><option value="tahun" ${b.mode === 'tahun' ? 'selected' : ''}>Per tahun</option></select></div>
            <div class="f" ${b.mode === 'bulan' ? '' : 'hidden'} id="bk-bln-f"><label for="bk-bln">Bulan</label><input type="month" id="bk-bln" value="${b.bulan}"></div>
            <div class="f" ${b.mode === 'tahun' ? '' : 'hidden'} id="bk-th-f"><label for="bk-th">Tahun</label><select id="bk-th">${tahunOps.map((t) => h`<option ${t === b.tahun ? 'selected' : ''}>${t}</option>`)}</select></div>
            <div class="f"><label for="bk-kertas">Kertas</label><select id="bk-kertas"><option value="A4" ${b.kertas === 'A4' ? 'selected' : ''}>A4 (297 × 210 mm)</option><option value="F4" ${b.kertas === 'F4' ? 'selected' : ''}>F4 / Folio (330 × 215 mm)</option></select></div></div>
          <div class="kotak-info biru">${ik('tandaTangan')}<div>Tanda tangan: <b>Mengetahui, ${S.cfg.Pimpinan_Jabatan || 'Pimpinan'}</b> — ${S.cfg.Pimpinan_Nama || h`<i>nama belum diisi</i>`} · <b>Petugas Agenda</b> — ${S.cfg.Petugas_Nama || h`<i>nama belum diisi</i>`}. Ubah di Pengaturan → Pimpinan & Petugas.</div></div>
          <div class="baris-flex" style="justify-content:flex-end"><button class="btn p" id="bk-buat">${ik('pdf', 'k')} Buat PDF Buku Agenda</button></div></div></div></div>`.s;
      el.onclick = (e) => { const v = e.target.closest('#bk-jenis [data-v]'); if (v) { b.jenis = v.dataset.v; EA.$$('#bk-jenis button', el).forEach((x) => x.classList.toggle('on', x === v)); } };
      el.onchange = (e) => {
        if (e.target.id === 'bk-mode') { b.mode = e.target.value; EA.$('#bk-bln-f', el).hidden = b.mode !== 'bulan'; EA.$('#bk-th-f', el).hidden = b.mode !== 'tahun'; }
        if (e.target.id === 'bk-bln') b.bulan = e.target.value || b.bulan;
        if (e.target.id === 'bk-th') b.tahun = Number(e.target.value);
        if (e.target.id === 'bk-kertas') b.kertas = e.target.value;
      };
      EA.$('#bk-buat', el).onclick = (e) => EA.sibuk(e.currentTarget, async () => {
        try {
          const th2 = b.mode === 'bulan' ? Number(b.bulan.slice(0, 4)) : b.tahun;
          await D.pastikan(th2);
          const cocok = (iso) => (b.mode === 'bulan' ? iso.slice(0, 7) === b.bulan : iso.slice(0, 4) === String(b.tahun));
          const periodeTeks = b.mode === 'bulan' ? 'Bulan ' + EA.namaBulan(b.bulan) : 'Tahun ' + b.tahun;
          let kolom, baris;
          if (b.jenis === 'masuk') {
            baris = D.smAktif(th2).filter((x) => cocok(x.TglTerima)).sort((a, c) => (a.NoAgenda > c.NoAgenda ? 1 : -1));
            kolom = [{ label: 'No', lebar: 0.35, rata: 'tengah', ambil: (r, i) => i + 1 }, { label: 'No Agenda', lebar: 0.6, rata: 'tengah', ambil: (r) => r.NoAgenda },
              { label: 'Tgl Terima', lebar: 0.75, ambil: (r) => EA.tglPendek(r.TglTerima) }, { label: 'No & Tgl Surat', lebar: 1.3, ambil: (r) => r.NoSurat + '\n' + EA.tglPendek(r.TglSurat) },
              { label: 'Asal', lebar: 1.3, ambil: (r) => r.AsalSurat }, { label: 'Perihal', lebar: 2.2, ambil: (r) => r.Perihal }, { label: 'Sifat', lebar: 0.6, ambil: (r) => r.Sifat },
              { label: 'Diteruskan ke', lebar: 1.2, ambil: (r) => D.dspUntukSm(r.ID).map((d) => D.namaBidang(d.KepadaBidang)).join(', ') || '-' },
              { label: 'Ket', lebar: 0.8, ambil: (r) => (r.StatusDisposisi === 'Selesai' ? 'Selesai' : r.StatusDisposisi === 'Proses' ? 'Proses' : 'Belum disposisi') + (r.FileID ? '' : '; tanpa scan') }];
          } else {
            baris = D.sk(th2).filter((x) => cocok(x.TglSurat)).sort((a, c) => a.NoUrut - c.NoUrut);
            kolom = [{ label: 'No', lebar: 0.35, rata: 'tengah', ambil: (r, i) => i + 1 }, { label: 'Nomor Surat', lebar: 1.5, ambil: (r) => r.NomorSurat },
              { label: 'Tgl Surat', lebar: 0.75, ambil: (r) => EA.tglPendek(r.TglSurat) }, { label: 'Tujuan', lebar: 1.5, ambil: (r) => r.Tujuan }, { label: 'Perihal', lebar: 2.2, ambil: (r) => r.Perihal },
              { label: 'Sifat', lebar: 0.6, ambil: (r) => r.Sifat }, { label: 'Bidang Pengolah', lebar: 1, ambil: (r) => D.namaBidang(r.IDBidang) },
              { label: 'Ket', lebar: 1, ambil: (r) => (r.Status === 'Batal' ? 'BATAL: ' + r.AlasanBatal : r.Status) }];
          }
          const blob = await EA.pdfTabel({
            judul: 'Buku Agenda Surat ' + (b.jenis === 'masuk' ? 'Masuk' : 'Keluar'), subjudul: periodeTeks, kertas: b.kertas, kolom, baris,
            coret: (r) => r.Status === 'Batal',
            tandaTangan: { kiri: { atas: 'Mengetahui,', jabatan: S.cfg.Pimpinan_Jabatan || 'Pimpinan', nama: S.cfg.Pimpinan_Nama, nip: S.cfg.Pimpinan_NIP },
              kanan: { atas: (S.cfg.Kota || '') + ', ' + EA.tglPanjang(EA.hariIni()), jabatan: 'Petugas Agenda', nama: S.cfg.Petugas_Nama, nip: S.cfg.Petugas_NIP } }
          });
          const nama = 'Buku-Agenda-' + (b.jenis === 'masuk' ? 'Masuk' : 'Keluar') + '_' + (b.mode === 'bulan' ? b.bulan : b.tahun) + '_' + b.kertas + '.pdf';
          const m = EA.modal({ judul: 'Buku Agenda — ' + periodeTeks, sub: baris.length + ' surat · kertas ' + b.kertas + ' landscape', ikon: 'buku', kelas: 'lebar', isi: h`<div class="pratinjau" id="bk-pr"></div>`, kaki: h`<button class="btn" data-batal>Tutup</button><button class="btn p" id="bk-unduh">${ik('unduh', 'k')} Unduh PDF</button>` });
          EA.tampilBlob(EA.$('#bk-pr', m.el), blob, nama);
          EA.$('#bk-unduh', m.el).onclick = () => EA.unduhBlob(blob, nama);
        } catch (er) { EA.galat(er); }
      }, ' Menyusun PDF…');
    }
  };

  /* ================= MASTER DATA ================= */
  const fM = { tab: 'bidang', q: '' };
  EA.hal.master = {
    judul: 'Master Data',
    render(root) {
      root.innerHTML = h`<div class="kepala"><div><h1>Master Data</h1><p>Bidang/unit pengolah dan kode klasifikasi arsip yang dipakai di seluruh formulir.</p></div>
        <div class="aksi"><button class="btn p" data-aksi="tambah">${ik('tambahL', 'k')} Tambah</button></div></div>
        <div class="tab"><button data-tab="bidang" class="${fM.tab === 'bidang' ? 'on' : ''}">${ik('gedung', 'k')} Bidang</button><button data-tab="klas" class="${fM.tab === 'klas' ? 'on' : ''}">${ik('pagar', 'k')} Kode Klasifikasi</button></div>
        <div class="kartu"><div class="saring"><label class="cari"><span class="sr">Cari</span>${ik('cari')}<input id="m-q" type="search" placeholder="Cari…" value="${fM.q}"></label></div><div id="m-isi"></div></div>`.s;
      EA.$('#m-q', root).addEventListener('input', (e) => { fM.q = e.target.value; this.segar(root); });
      root.onclick = (e) => {
        const t = e.target.closest('[data-tab],[data-aksi]'); if (!t) return;
        if (t.dataset.tab) { fM.tab = t.dataset.tab; this.render(root); return; }
        if (t.dataset.aksi === 'tambah') fM.tab === 'bidang' ? formBidang() : formKlas();
        if (t.dataset.aksi === 'edit') fM.tab === 'bidang' ? formBidang(S.mst.bidang.find((b) => b.IDBidang === t.dataset.id)) : formKlas(S.mst.klasifikasi.find((k) => k.Kode === t.dataset.id));
      };
      this.segar(root);
    },
    segar(root) {
      const el = EA.$('#m-isi', root); if (!el) return;
      const q = EA.norm(fM.q);
      if (fM.tab === 'bidang') {
        const rows = (S.mst.bidang || []).filter((b) => !q || EA.norm(b.NamaBidang + ' ' + b.Kode + ' ' + b.IDBidang).indexOf(q) > -1);
        EA.html(el, h`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>ID</th><th>Nama Bidang</th><th>Kode</th><th class="c">Staf Aktif</th><th>Status</th><th class="r">Aksi</th></tr></thead><tbody>
          ${rows.map((b) => h`<tr data-aksi="edit" data-id="${b.IDBidang}"><td class="mono">${b.IDBidang}</td><td class="tebal">${b.NamaBidang}</td><td><span class="lc abu mono">${b.Kode}</span></td><td class="c">${(S.mst.stafPerBidang || {})[b.IDBidang] || 0}</td><td>${b.Aktif !== false ? h`<span class="lc hijau">Aktif</span>` : h`<span class="lc abu">Nonaktif</span>`}</td><td class="r"><button class="btn k" data-aksi="edit" data-id="${b.IDBidang}">${ik('pensil', 'k')} Edit</button></td></tr>`)}
          </tbody></table></div>`);
      } else {
        const rows = (S.mst.klasifikasi || []).filter((k) => !q || EA.norm(k.Kode + ' ' + k.Uraian).indexOf(q) > -1).sort((a, b) => (a.Kode > b.Kode ? 1 : -1));
        EA.html(el, h`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Kode</th><th>Uraian</th><th>Status</th><th class="r">Aksi</th></tr></thead><tbody>
          ${rows.map((k) => h`<tr data-aksi="edit" data-id="${k.Kode}"><td class="mono tebal" style="color:var(--primer-tua)">${k.Kode}</td><td>${k.Uraian}</td><td>${k.Aktif !== false ? h`<span class="lc hijau">Aktif</span>` : h`<span class="lc abu">Nonaktif</span>`}</td><td class="r"><button class="btn k" data-aksi="edit" data-id="${k.Kode}">${ik('pensil', 'k')} Edit</button></td></tr>`)}
          </tbody></table></div>`);
      }
    }
  };
  function formBidang(b) {
    const m = EA.modal({ judul: b ? 'Edit Bidang' : 'Tambah Bidang', ikon: 'gedung', kelas: 'kecil',
      isi: h`<div class="stack"><div class="f"><label for="fb-n">Nama bidang <span class="w">*</span></label><input id="fb-n" value="${b ? b.NamaBidang : ''}" maxlength="80"></div>
        <div class="f"><label for="fb-k">Kode singkat <span class="w">*</span></label><input id="fb-k" value="${b ? b.Kode : ''}" maxlength="12" class="mono" placeholder="mis. KUR"><span class="bantu">Dipakai di daftar & {BIDANG} pada format nomor.</span></div>
        <label class="sakelar"><input type="checkbox" id="fb-a" ${!b || b.Aktif !== false ? 'checked' : ''}> Aktif</label></div>`,
      kaki: h`<button class="btn g" data-batal>Batal</button><button class="btn p" id="fb-ok">Simpan</button>` });
    EA.$('#fb-ok', m.el).onclick = (e) => EA.sibuk(e.currentTarget, async () => {
      try {
        const r = await EA.api.tulis('admin.bidang', { IDBidang: b ? b.IDBidang : '', NamaBidang: EA.$('#fb-n', m.el).value, Kode: EA.$('#fb-k', m.el).value, Aktif: EA.$('#fb-a', m.el).checked });
        D.ubahMaster((mst) => { const i = mst.bidang.findIndex((x) => x.IDBidang === r.bidang.IDBidang); if (i > -1) mst.bidang[i] = r.bidang; else mst.bidang.push(r.bidang); });
        m.tutup(); EA.toast('Bidang disimpan.');
      } catch (er) { EA.galat(er); }
    });
  }
  function formKlas(k) {
    const m = EA.modal({ judul: k ? 'Edit Kode Klasifikasi' : 'Tambah Kode Klasifikasi', ikon: 'pagar', kelas: 'kecil',
      isi: h`<div class="stack"><div class="f"><label for="fk-k">Kode <span class="w">*</span></label><input id="fk-k" value="${k ? k.Kode : ''}" maxlength="20" class="mono" ${k ? 'readonly' : ''} placeholder="mis. 421.3"></div>
        <div class="f"><label for="fk-u">Uraian <span class="w">*</span></label><input id="fk-u" value="${k ? k.Uraian : ''}" maxlength="150"></div>
        <label class="sakelar"><input type="checkbox" id="fk-a" ${!k || k.Aktif !== false ? 'checked' : ''}> Aktif (tampil di pilihan)</label></div>`,
      kaki: h`<button class="btn g" data-batal>Batal</button><button class="btn p" id="fk-ok">Simpan</button>` });
    EA.$('#fk-ok', m.el).onclick = (e) => EA.sibuk(e.currentTarget, async () => {
      try {
        const r = await EA.api.tulis('admin.klasifikasi', { Kode: EA.$('#fk-k', m.el).value.trim(), Uraian: EA.$('#fk-u', m.el).value, Aktif: EA.$('#fk-a', m.el).checked, baru: !k });
        D.ubahMaster((mst) => { const i = mst.klasifikasi.findIndex((x) => x.Kode === r.klasifikasi.Kode); if (i > -1) mst.klasifikasi[i] = r.klasifikasi; else mst.klasifikasi.push(r.klasifikasi); });
        m.tutup(); EA.toast('Kode klasifikasi disimpan.');
      } catch (er) { EA.galat(er); }
    });
  }

  /* ================= PENGGUNA ================= */
  const fP = { q: '', peran: '' };
  EA.hal.pengguna = {
    judul: 'Pengguna',
    render(root) {
      root.innerHTML = h`<div class="kepala"><div><h1>Pengguna</h1><p>Hanya email yang terdaftar & aktif di sini yang bisa masuk (FR-01). Pengguna yang dinonaktifkan langsung tertolak walau sesinya masih berjalan.</p></div>
        <div class="aksi"><button class="btn p" data-aksi="tambah">${ik('tambahL', 'k')} Tambah Pengguna</button></div></div>
        <div class="kartu"><div class="saring"><label class="cari"><span class="sr">Cari</span>${ik('cari')}<input id="p-q" type="search" placeholder="Cari nama, email, NIP…" value="${fP.q}"></label>
          <select id="p-peran" aria-label="Peran"><option value="">Semua peran</option>${['Admin', 'Pimpinan', 'Staf'].map((p) => h`<option ${fP.peran === p ? 'selected' : ''}>${p}</option>`)}</select></div><div id="p-isi"></div></div>`.s;
      EA.$('#p-q', root).addEventListener('input', (e) => { fP.q = e.target.value; this.segar(root); });
      root.onchange = (e) => { if (e.target.id === 'p-peran') { fP.peran = e.target.value; this.segar(root); } };
      root.onclick = (e) => {
        const t = e.target.closest('[data-aksi]'); if (!t) return;
        if (t.dataset.aksi === 'tambah') formPengguna();
        if (t.dataset.aksi === 'edit') formPengguna((S.mst.pengguna || []).find((u) => u.Email === t.dataset.id));
      };
      this.segar(root);
    },
    segar(root) {
      const el = EA.$('#p-isi', root); if (!el) return;
      const q = EA.norm(fP.q);
      const rows = (S.mst.pengguna || []).filter((u) => (!fP.peran || u.Peran === fP.peran) && (!q || EA.norm([u.Nama, u.Email, u.NIP, u.Jabatan].join(' ')).indexOf(q) > -1)).sort((a, b) => (a.Nama > b.Nama ? 1 : -1));
      EA.html(el, rows.length ? h`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nama</th><th>Peran</th><th>Bidang</th><th>No. WA</th><th>Status</th><th>Terakhir Login</th><th class="r">Aksi</th></tr></thead><tbody>
        ${rows.map((u) => h`<tr data-aksi="edit" data-id="${u.Email}"><td><div style="display:flex;gap:10px;align-items:center"><span class="avatar" style="width:34px;height:34px;font-size:12px">${EA.inisial(u.Nama)}</span><div><b>${u.Nama}</b><div class="sub">${u.Email}${u.Jabatan ? ' · ' + u.Jabatan : ''}</div></div></div></td>
          <td>${EA.lcPeran(u.Peran)}</td><td>${u.IDBidang ? D.namaBidang(u.IDBidang) : '-'}</td>
          <td>${u.NoWA ? h`<span class="mono">${u.NoWA}</span>${u.WAValid === false ? h` <span class="lc merah">tidak valid</span>` : ''}` : h`<span class="redup">— (email cadangan)</span>`}</td>
          <td>${u.Aktif ? h`<span class="lc hijau">Aktif</span>` : h`<span class="lc abu">Nonaktif</span>`}</td><td class="redup">${u.TerakhirLogin ? EA.relatif(u.TerakhirLogin) : 'Belum pernah'}</td>
          <td class="r"><button class="btn k" data-aksi="edit" data-id="${u.Email}">${ik('pensil', 'k')} Edit</button></td></tr>`)}</tbody></table></div>` : EA.kosong('pengguna', 'Tidak ada pengguna', ''));
    }
  };
  function formPengguna(u) {
    const baru = !u;
    u = u || { Email: '', Nama: '', NIP: '', Jabatan: '', Peran: 'Staf', IDBidang: '', NoWA: '', Aktif: true };
    const m = EA.modal({ judul: baru ? 'Tambah Pengguna' : 'Edit Pengguna', ikon: 'orang', kelas: 'sedang',
      isi: h`<div class="stack"><div class="grid2"><div class="f"><label for="fp-e">Email Google <span class="w">*</span></label><input id="fp-e" type="email" value="${u.Email}" ${baru ? '' : 'readonly'} placeholder="nama@sekolah.sch.id"></div>
          <div class="f"><label for="fp-n">Nama lengkap <span class="w">*</span></label><input id="fp-n" value="${u.Nama}" maxlength="120"></div></div>
        <div class="grid2"><div class="f"><label for="fp-nip">NIP</label><input id="fp-nip" value="${u.NIP}" maxlength="30" class="mono"></div><div class="f"><label for="fp-j">Jabatan</label><input id="fp-j" value="${u.Jabatan}" maxlength="120"></div></div>
        <div class="grid2"><div class="f"><label for="fp-p">Peran <span class="w">*</span></label><select id="fp-p">${['Admin', 'Pimpinan', 'Staf'].map((p) => h`<option ${u.Peran === p ? 'selected' : ''}>${p}</option>`)}</select></div>
          <div class="f"><label for="fp-b">Bidang <small>(wajib untuk Staf)</small></label><select id="fp-b"><option value="">—</option>${(S.mst.bidang || []).map((b) => h`<option value="${b.IDBidang}" ${u.IDBidang === b.IDBidang ? 'selected' : ''}>${b.NamaBidang}</option>`)}</select></div></div>
        <div class="f"><label for="fp-wa">No. WhatsApp</label><input id="fp-wa" value="${u.NoWA}" inputmode="tel" placeholder="08xx… (otomatis jadi 628xx…)"><span class="bantu" id="fp-wa-b">Kosongkan bila tidak punya WA — notifikasi dikirim lewat email.</span></div>
        <label class="sakelar"><input type="checkbox" id="fp-a" ${u.Aktif ? 'checked' : ''}> Aktif (boleh masuk)</label></div>`,
      kaki: h`<button class="btn g" data-batal>Batal</button><button class="btn p" id="fp-ok">Simpan</button>` });
    const wa = EA.$('#fp-wa', m.el), bantu = EA.$('#fp-wa-b', m.el);
    wa.addEventListener('input', () => { const n = EA.normalWA(wa.value); bantu.textContent = !wa.value ? 'Kosongkan bila tidak punya WA — notifikasi dikirim lewat email.' : n ? '✓ Akan disimpan sebagai ' + n : '⚠ Nomor tidak valid — notifikasi akan dikirim lewat email.'; bantu.style.color = wa.value && !n ? 'var(--bahaya-tua)' : ''; });
    EA.$('#fp-ok', m.el).onclick = (e) => EA.sibuk(e.currentTarget, async () => {
      try {
        const r = await EA.api.tulis('admin.pengguna', { baru, Email: EA.$('#fp-e', m.el).value, Nama: EA.$('#fp-n', m.el).value, NIP: EA.$('#fp-nip', m.el).value, Jabatan: EA.$('#fp-j', m.el).value, Peran: EA.$('#fp-p', m.el).value, IDBidang: EA.$('#fp-b', m.el).value, NoWA: wa.value, Aktif: EA.$('#fp-a', m.el).checked });
        D.ubahMaster((mst) => {
          mst.pengguna = mst.pengguna || [];
          const i = mst.pengguna.findIndex((x) => x.Email === r.pengguna.Email); if (i > -1) mst.pengguna[i] = r.pengguna; else mst.pengguna.push(r.pengguna);
          const d = (mst.direktori || []).find((x) => x.e === r.pengguna.Email); if (d) { d.n = r.pengguna.Nama; d.p = r.pengguna.Peran; d.b = r.pengguna.IDBidang; } else (mst.direktori = mst.direktori || []).push({ e: r.pengguna.Email, n: r.pengguna.Nama, p: r.pengguna.Peran, b: r.pengguna.IDBidang, a: 1 });
        });
        m.tutup(); EA.toast('Pengguna disimpan.');
      } catch (er) { EA.galat(er); }
    });
  }

  /* ================= NOTIFIKASI (antrean WA & email) ================= */
  const fN = { status: '', hal: 1, cari: '', data: null };
  EA.hal.notifikasi = {
    judul: 'Notifikasi WA',
    render(root) {
      root.innerHTML = h`<div class="kepala"><div><h1>Notifikasi WhatsApp & Email</h1><p>WhatsApp (Fonnte) sebagai kanal utama; email cadangan bila WA gagal 3× atau nomor kosong. Pesan dikirim lewat antrean agar aplikasi tetap cepat.</p></div>
        <div class="aksi"><button class="btn" data-aksi="proses">${ik('kirim', 'k')} Proses Antrean Sekarang</button><button class="btn" data-aksi="ulang-semua">${ik('putar', 'k')} Kirim Ulang Semua Gagal</button><a class="btn l" href="#/pengaturan?bagian=notifikasi">${ik('gir', 'k')} Template Pesan</a></div></div>
        <div id="n-kpi" class="mini-kpi"></div>
        <div class="g2k"><div class="kartu"><div class="saring"><select id="n-st" aria-label="Status"><option value="">Semua status</option>${['Menunggu', 'Terkirim', 'Gagal'].map((x) => h`<option ${fN.status === x ? 'selected' : ''}>${x}</option>`)}</select>
            <label class="cari"><span class="sr">Cari</span>${ik('cari')}<input id="n-q" type="search" placeholder="Cari nomor, email, event…" value="${fN.cari}"></label><button class="btn k" data-aksi="muat">${ik('putar', 'k')} Muat ulang</button></div><div id="n-isi"><div class="kosong"><div class="putar gelap" style="margin:0 auto"></div></div></div></div>
          <div class="kartu"><div class="kartu-h"><div><h3>${ik('wa')} Uji Kirim WA</h3><div class="sub">Memastikan token Fonnte & perangkat aktif</div></div></div>
            <div class="kartu-b"><div class="stack"><div class="f"><label for="u-no">Nomor tujuan</label><input id="u-no" inputmode="tel" placeholder="08xx…"></div><div class="f"><label for="u-ps">Pesan</label><textarea id="u-ps" rows="3" placeholder="✅ Uji kirim WA dari E-Agenda"></textarea></div>
              <button class="btn p" data-aksi="uji">${ik('kirim', 'k')} Kirim Uji</button><div id="u-hasil"></div></div></div></div></div>`.s;
      EA.$('#n-q', root).addEventListener('input', EA.debounce((e) => { fN.cari = e.target.value; fN.hal = 1; this.muat(root); }, 350));
      root.onchange = (e) => { if (e.target.id === 'n-st') { fN.status = e.target.value; fN.hal = 1; this.muat(root); } };
      root.onclick = async (e) => {
        const t = e.target.closest('[data-aksi],[data-hal]'); if (!t) return;
        if (t.dataset.hal) { fN.hal = Number(t.dataset.hal); this.muat(root); return; }
        const a = t.dataset.aksi;
        if (a === 'muat') this.muat(root);
        if (a === 'proses') await EA.sibuk(t, async () => { try { const r = await EA.api.panggil('admin.sistemAksi', { aksi: 'prosesAntrean' }, { timeout: 60000 }); EA.toast(r.dilewati ? 'Antrean sedang diproses oleh pemicu lain.' : 'Terkirim ' + (r.terkirim || 0) + ', gagal ' + (r.gagal || 0) + ', menunggu ' + (r.menunggu || 0) + '.'); this.muat(root); } catch (er) { EA.galat(er); } });
        if (a === 'ulang-semua') await EA.sibuk(t, async () => { try { const r = await EA.api.tulis('notif.ulang', { semuaGagal: true }); EA.toast(r.diulang + ' pesan dijadwalkan ulang.'); EA.kurasNotif(r.diulang); this.muat(root); } catch (er) { EA.galat(er); } });
        if (a === 'ulang') await EA.sibuk(t, async () => { try { await EA.api.tulis('notif.ulang', { id: t.dataset.id }); EA.toast('Dijadwalkan ulang.'); EA.kurasNotif(1); this.muat(root); } catch (er) { EA.galat(er); } });
        if (a === 'uji') await EA.sibuk(t, async () => {
          const hasil = EA.$('#u-hasil', root);
          try { const r = await EA.api.panggil('notif.uji', { nomor: EA.$('#u-no', root).value, pesan: EA.$('#u-ps', root).value }); EA.html(hasil, r.ok ? h`<div class="kotak-info hijau">${ik('cekL')}<div>Terkirim ke ${r.nomor}. Periksa WhatsApp tujuan.</div></div>` : h`<div class="kotak-info merah">${ik('galat')}<div>Gagal: ${r.error}</div></div>`); } catch (er) { EA.html(hasil, h`<div class="kotak-info merah">${ik('galat')}<div>${er.message}</div></div>`); }
        });
        if (a === 'pesan') { const it = (fN.data.baris || []).find((x) => x.ID === t.dataset.id); if (it) EA.modal({ judul: 'Isi pesan', ikon: 'wa', kelas: 'sedang', isi: h`<div class="pra-wa">${it.Pesan}</div>${it.Error ? h`<div class="kotak-info merah" style="margin-top:12px">${ik('galat')}<div>${it.Error}</div></div>` : ''}`, kaki: h`<button class="btn" data-batal>Tutup</button>` }); }
      };
      this.muat(root);
    },
    async muat(root) {
      try {
        fN.data = await EA.api.baca('notif.daftar', { status: fN.status, hal: fN.hal, cari: fN.cari });
        this.segar(root);
      } catch (e) { const el = EA.$('#n-isi', root); if (el) EA.html(el, EA.kosong('galat', 'Gagal memuat antrean', e.message)); }
    },
    segar(root) {
      const el = EA.$('#n-isi', root), d = fN.data; if (!el || !d) return;
      EA.html(EA.$('#n-kpi', root), h`<div class="mkpi b2"><div class="l">Menunggu</div><div class="n">${EA.angka(d.ringkas.Menunggu)}</div><div class="s">Akan dikirim ±5 menit</div></div>
        <div class="mkpi b5"><div class="l">Terkirim</div><div class="n">${EA.angka(d.ringkas.Terkirim)}</div><div class="s">2.000 entri terakhir</div></div>
        <div class="mkpi b3"><div class="l">Gagal</div><div class="n">${EA.angka(d.ringkas.Gagal)}</div><div class="s">Bisa dikirim ulang</div></div>
        <div class="mkpi ${d.tokenAda ? 'b6' : 'b7'}"><div class="l">Status Kanal</div><div class="n" style="font-size:18px">${d.tokenAda ? 'Fonnte aktif' : 'Token belum diisi'}</div><div class="s">Kuota email tersisa: ${d.kuotaEmail < 0 ? '-' : EA.angka(d.kuotaEmail)}</div></div>`);
      EA.html(el, d.baris.length ? h`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Waktu</th><th>Kanal</th><th>Tujuan</th><th>Event</th><th>Status</th><th class="r">Aksi</th></tr></thead><tbody>
        ${d.baris.map((x) => h`<tr data-aksi="pesan" data-id="${x.ID}"><td>${EA.waktu(x.DibuatPada)}<div class="sub">${x.TerkirimPada ? 'terkirim ' + EA.jam(x.TerkirimPada) : ''}</div></td><td>${x.Kanal === 'WA' ? h`<span class="lc hijau">${ik('wa', 'k')} WA</span>` : h`<span class="lc abu">${ik('surat', 'k')} Email</span>`}</td>
          <td class="mono" style="word-break:break-all">${x.Tujuan}<div class="sub">${D.nama(x.Penerima)}</div></td><td>${x.Event}<div class="sub mono">${x.RefID}</div></td>
          <td>${EA.lcStatus(x.Status)}${Number(x.Percobaan) ? h`<div class="sub">${x.Percobaan}× coba</div>` : ''}${x.Error ? h`<div class="sub" style="color:var(--bahaya-tua)">${String(x.Error).slice(0, 60)}</div>` : ''}</td>
          <td class="r">${x.Status === 'Gagal' ? h`<button class="btn k" data-aksi="ulang" data-id="${x.ID}">${ik('putar', 'k')} Ulang</button>` : ''}</td></tr>`)}</tbody></table></div>
        <div class="tbl-kaki"><span>${EA.angka(d.total)} entri</span>${EA.paginasi(d.total, d.hal, d.per)}</div>` : EA.kosong('wa', 'Antrean kosong', 'Notifikasi akan muncul di sini.'));
    }
  };

  /* ================= PENGATURAN ================= */
  const BAGIAN = [['instansi', 'Instansi & Kop', 'gedung'], ['penomoran', 'Penomoran', 'pagar'], ['disposisi', 'Disposisi & Sesi', 'disposisi'], ['pejabat', 'Pimpinan & Petugas', 'tandaTangan'],
    ['notifikasi', 'Notifikasi & Template', 'wa'], ['integrasi', 'Integrasi & Keamanan', 'perisai'], ['sistem', 'Sistem', 'gir'], ['impor', 'Impor & Migrasi', 'unggah']];
  const fS = { bagian: 'instansi', rahasia: null, sistem: null, impor: { jenis: 'sm', berkas: null, baris: [], hasil: null }, migrasi: { sumber: '', laporan: null } };
  EA.hal.pengaturan = {
    judul: 'Pengaturan',
    render(root, p) {
      if (p.bagian) fS.bagian = p.bagian;
      root.innerHTML = h`<div class="kepala"><div><h1>Pengaturan</h1><p>Identitas instansi, penomoran, notifikasi, integrasi, dan perawatan sistem. Rahasia (token) hanya disimpan di Script Properties dan ditampilkan tersamar.</p></div></div>
        <div class="set-lay"><nav class="kartu set-nav" aria-label="Bagian pengaturan">${BAGIAN.map(([k, l, i]) => h`<button data-bagian="${k}" class="${fS.bagian === k ? 'on' : ''}">${ik(i, 'k')} ${l}</button>`)}</nav><div id="set-isi"></div></div>`.s;
      root.onclick = (e) => { const b = e.target.closest('[data-bagian]'); if (b) { fS.bagian = b.dataset.bagian; history.replaceState(null, '', '#/pengaturan?bagian=' + fS.bagian); EA.$$('.set-nav button', root).forEach((x) => x.classList.toggle('on', x === b)); this.segar(root, true); } };
      this.segar(root, true);
    },
    segar(root, paksa) {
      const el = EA.$('#set-isi', root); if (!el) return;
      if (!paksa && (fS.bagian !== 'sistem')) return; // jangan menimpa isian yang sedang diketik
      const c = S.cfg, f = (k, l, o) => { o = o || {}; return h`<div class="f"><label for="c-${k}">${l}${o.bantuLabel ? h` <small>${o.bantuLabel}</small>` : ''}</label>${o.area ? h`<textarea id="c-${k}" data-k="${k}" rows="${o.baris || 3}" maxlength="${o.maks || 300}">${c[k] || ''}</textarea>` : h`<input id="c-${k}" data-k="${k}" value="${c[k] || ''}" ${o.tipe ? h`type="${o.tipe}"` : ''} ${o.mono ? 'class="mono"' : ''} maxlength="${o.maks || 300}" ${o.ph ? h`placeholder="${o.ph}"` : ''}>`}${o.bantu ? h`<span class="bantu">${o.bantu}</span>` : ''}</div>`; };
      const ya = (k, l, b) => h`<label class="sakelar" style="justify-content:space-between;width:100%;padding:10px 0;border-bottom:1px solid var(--garis-2)"><span><b style="font-weight:600">${l}</b>${b ? h`<span class="bantu" style="display:block;font-weight:400;color:var(--teks-2);font-size:12px">${b}</span>` : ''}</span><input type="checkbox" data-k="${k}" data-ya ${/^ya$/i.test(c[k] || '') ? 'checked' : ''}></label>`;
      const simpan = h`<div class="baris-flex" style="justify-content:flex-end;margin-top:16px"><button class="btn p" data-aksi="simpan">${ik('cek', 'k')} Simpan Perubahan</button></div>`;
      const th = EA.tahunIni(), B = fS.bagian;
      let isi;
      if (B === 'instansi') {
        isi = h`<div class="kartu"><div class="kartu-h"><h3>Identitas Instansi & Kop</h3></div><div class="kartu-b"><div class="stack">
          <div class="baris-flex" style="gap:16px"><div class="sb-logo" style="width:72px;height:72px;border:1px solid var(--garis)">${S.info && S.info.logo ? h`<img src="${S.info.logo}" alt="Logo">` : ik('gedung')}</div>
            <div><button class="btn k" data-aksi="logo">${ik('unggah', 'k')} Unggah Logo</button><input type="file" id="c-logo" accept="image/png,image/jpeg" hidden><div class="bantu redup kecil" style="margin-top:6px">PNG/JPG persegi, otomatis diperkecil. Tampil di sidebar, login, kop, dan lembar disposisi.</div></div></div>
          ${f('NamaInstansi', 'Nama instansi')}<div class="grid2">${f('KopBaris1', 'Kop baris 1', { bantu: 'mis. PEMERINTAH PROVINSI …' })}${f('KopBaris2', 'Kop baris 2', { bantu: 'mis. DINAS PENDIDIKAN' })}</div>
          ${f('Alamat', 'Alamat')}<div class="grid2">${f('Kontak', 'Kontak (telp · email · laman)')}${f('Kota', 'Kota (untuk tanggal tanda tangan)')}</div>${f('KodeInstansi', 'Kode instansi', { mono: true, bantu: 'Mengisi {INSTANSI} pada nomor surat keluar.' })}
        </div>${simpan}</div></div>`;
      } else if (B === 'penomoran') {
        const contoh = EA.formatNomor(c.FormatNomorKeluar, { no: D.penghitung('Keluar', th) + 1, klas: '005', instansi: c.KodeInstansi, tgl: EA.hariIni(), bidang: 'KUR' });
        isi = h`<div class="kartu"><div class="kartu-h"><h3>Format Nomor Surat Keluar</h3></div><div class="kartu-b"><div class="stack">
          ${f('FormatNomorKeluar', 'Format', { mono: true })}<div class="tpl-bantu">Penanda: ${['{NO:3}', '{NO}', '{KLASIFIKASI}', '{INSTANSI}', '{BULAN_ROMAWI}', '{BULAN}', '{TAHUN}', '{BIDANG}'].map((t) => h`<code data-sisip="${t}">${t}</code>`)}</div>
          <div class="nomor-pratinjau"><div class="np-h"><span>Contoh nomor berikutnya</span></div><div class="np-n"><b id="c-contoh">${contoh}</b></div></div></div></div></div>
          <div class="kartu" style="margin-top:16px"><div class="kartu-h"><div><h3>Penghitung Awal Tahun ${th}</h3><div class="sub">Isi agar nomor melanjutkan urutan tahun berjalan (mis. bila sebelumnya memakai buku manual). Tidak bisa lebih kecil dari nomor yang sudah terpakai.</div></div></div>
          <div class="kartu-b"><div class="grid3">${f('Penghitung_Agenda_' + th, 'No Agenda terakhir', { tipe: 'number', bantu: 'Surat masuk berikutnya: ' + EA.pad(D.penghitung('Agenda', th) + 1, 4) })}
            ${f('Penghitung_Keluar_' + th, 'No surat keluar terakhir', { tipe: 'number', bantu: 'Surat keluar berikutnya: ' + (D.penghitung('Keluar', th) + 1) })}${f('Penghitung_Disposisi_' + th, 'No disposisi terakhir', { tipe: 'number' })}</div>${simpan}</div></div>`;
      } else if (B === 'disposisi') {
        isi = h`<div class="kartu"><div class="kartu-h"><div><h3>Batas Waktu Bawaan Disposisi</h3><div class="sub">Dalam hari, mengikuti sifat surat (bisa diubah saat memberi disposisi).</div></div></div><div class="kartu-b"><div class="grid2">
          ${SIFAT.map((s) => f('BatasWaktu_' + s, s, { tipe: 'number' }))}</div>
          <div style="margin-top:16px">${ya('AdminBolehDisposisi', 'Admin boleh memberi disposisi atas nama pimpinan', 'Tercatat: Dari = pimpinan, DicatatOleh = admin.')}</div>
          <div class="grid2" style="margin-top:12px">${f('SesiJam', 'Lama sesi login (jam)', { tipe: 'number', bantu: 'Bawaan 8 jam (FR-02).' })}</div>${simpan}</div></div>`;
      } else if (B === 'pejabat') {
        isi = h`<div class="kartu"><div class="kartu-h"><div><h3>Pimpinan & Petugas Agenda</h3><div class="sub">Dipakai pada blok tanda tangan Lembar Disposisi dan Buku Agenda.</div></div></div><div class="kartu-b"><div class="stack">
          <div class="grid3">${f('Pimpinan_Jabatan', 'Jabatan pimpinan')}${f('Pimpinan_Nama', 'Nama pimpinan')}${f('Pimpinan_NIP', 'NIP pimpinan', { mono: true })}</div>
          <div class="grid3">${f('Petugas_Nama', 'Nama petugas agenda')}${f('Petugas_NIP', 'NIP petugas', { mono: true })}</div></div>${simpan}</div></div>`;
      } else if (B === 'notifikasi') {
        const vars = ['{nama}', '{perihal}', '{batas}', '{tautan}', '{asal}', '{noagenda}', '{sifat}', '{bidang}', '{instruksi}', '{catatan}', '{tanggapan}', '{instansi}'];
        isi = h`<div class="kartu"><div class="kartu-h"><h3>Pemicu Notifikasi</h3></div><div class="kartu-b">
          ${ya('Notif_SuratPenting', 'Surat Segera/Penting → WA ke pimpinan', 'FR-17')}${ya('Notif_Disposisi', 'Disposisi baru → WA ke staf bidang tujuan', 'FR-22')}${ya('Notif_EmailDisposisi', 'Disposisi baru → email juga', 'FR-22 (kuota email dicek sebelum kirim)')}
          ${ya('Notif_Selesai', 'Disposisi selesai → WA ke pimpinan', 'FR-24')}${ya('Notif_Pengingat', 'Pengingat H-1 & saat terlambat (07.00 WIB)', 'FR-25')}${ya('Notif_EmailCadangan', 'Email cadangan bila WA gagal 3× / nomor kosong', 'FR-50')}
          <div class="grid2" style="margin-top:12px">${f('JedaWA_Detik', 'Jeda antarpesan WA (detik)', { tipe: 'number', bantu: 'Mencegah nomor pengirim diblokir.' })}</div></div></div>
          <div class="kartu" style="margin-top:16px"><div class="kartu-h"><div><h3>Template Pesan WhatsApp</h3><div class="sub">Format WA: *tebal*, _miring_. Klik penanda untuk menyisipkan.</div></div></div><div class="kartu-b"><div class="stack">
          ${[['TemplateWA_SuratPenting', 'Surat penting masuk'], ['TemplateWA_Disposisi', 'Disposisi baru'], ['TemplateWA_Selesai', 'Disposisi selesai'], ['TemplateWA_PengingatH1', 'Pengingat H-1'], ['TemplateWA_Terlambat', 'Disposisi terlambat']].map(([k, l]) => h`<div class="grid2" style="align-items:start">${f(k, l, { area: true, baris: 7, maks: 2000 })}<div class="f"><span class="lbl-f">Pratinjau</span><div class="pra-wa" data-pra="${k}"></div></div></div>`)}
          <div class="tpl-bantu">Penanda: ${vars.map((v) => h`<code data-sisip="${v}">${v}</code>`)}</div></div>${simpan}</div></div>`;
      } else if (B === 'integrasi') {
        const r = fS.rahasia;
        isi = h`<div class="kartu"><div class="kartu-h"><div><h3>Alamat Aplikasi</h3><div class="sub">Untuk tautan di notifikasi WA/email dan QR verifikasi lembar disposisi.</div></div></div><div class="kartu-b">
          ${f('URLAplikasi', 'URL frontend (GitHub Pages)', { ph: 'https://nama.github.io/e-agenda/', mono: true })}<div class="baris-flex" style="margin-top:8px"><button class="btn k" data-aksi="url-ini">${ik('tautan', 'k')} Pakai alamat ini (${location.origin + location.pathname})</button></div>${simpan}</div></div>
          <div class="kartu" style="margin-top:16px"><div class="kartu-h"><div><h3>${ik('perisai')} Rahasia & Kredensial</h3><div class="sub">Disimpan di Script Properties, tidak pernah dikirim utuh ke browser (allowlist R5).</div></div></div><div class="kartu-b">
          ${r ? h`<div class="stack">
            <div class="f"><label for="r-cid">Google OAuth Client ID ${r.OAUTH_CLIENT_ID.ada ? h`<span class="lc hijau">terpasang</span>` : h`<span class="lc merah">belum</span>`}</label><input id="r-cid" class="mono" placeholder="${r.OAUTH_CLIENT_ID.nilai || '1234…apps.googleusercontent.com'}"><span class="bantu">Kosongkan = tidak berubah. Diperlukan untuk tombol "Masuk dengan Google".</span></div>
            <div class="f"><label for="r-fon">Token Fonnte (WhatsApp) ${r.FONNTE_TOKEN.ada ? h`<span class="lc hijau">${r.FONNTE_TOKEN.samar}</span>` : h`<span class="lc merah">belum</span>`}</label><input id="r-fon" type="password" autocomplete="off" placeholder="Tempel token baru…"><span class="bantu">Kosongkan = tidak berubah. Tulis __HAPUS__ untuk menghapus.</span></div>
            <div class="baris-flex" style="justify-content:flex-end"><button class="btn p" data-aksi="rahasia">${ik('gembok', 'k')} Simpan Rahasia</button></div>
            <div class="kotak-info ${r.darurat.terkunciSampai ? 'merah' : 'biru'}">${ik('kunci')}<div><b>Akses darurat</b> ${r.darurat.aktif ? 'aktif' : 'belum disiapkan'}${r.darurat.terkunciSampai ? ' · terkunci sampai ' + EA.jam(r.darurat.terkunciSampai) : ''}. Lupa sandinya? Jalankan fungsi <code>resetAksesDarurat</code> di editor Apps Script.</div></div></div>` : h`<div class="kosong"><div class="putar gelap" style="margin:0 auto"></div></div>`}</div></div>`;
        if (!r) EA.api.baca('admin.rahasia', {}).then((x) => { fS.rahasia = x; this.segar(root, true); }).catch(EA.galat);
      } else if (B === 'sistem') {
        const s = fS.sistem;
        isi = h`<div class="kartu"><div class="kartu-h"><div><h3>Status Sistem</h3><div class="sub">E-Agenda v${S.cfg._versi || ''} · zona waktu ${S.cfg._tz || 'Asia/Jakarta'}</div></div><button class="btn k" data-aksi="muat-sistem">${ik('putar', 'k')} Muat ulang</button></div><div class="kartu-b">
          ${s ? h`<div class="dt-grid"><div class="dt"><div class="l">Pemilik skrip</div><div class="v">${s.pemilik}</div></div><div class="dt"><div class="l">Kuota email tersisa</div><div class="v">${s.kuotaEmail < 0 ? '-' : EA.angka(s.kuotaEmail)}</div></div>
            <div class="dt penuh"><div class="l">Pemicu aktif</div><div class="v">${['prosesAntrean', 'pengingatHarian', 'saatSheetDiedit'].map((p) => h`<span class="lc ${s.pemicu.indexOf(p) > -1 ? 'hijau' : 'merah'}" style="margin:0 6px 6px 0">${s.pemicu.indexOf(p) > -1 ? '✓' : '✗'} ${p}</span>`)}</div></div>
            <div class="dt"><div class="l">Jumlah baris</div><div class="v">${Object.keys(s.jumlah).map((k) => k + ': ' + EA.angka(s.jumlah[k])).join(' · ')}</div></div><div class="dt"><div class="l">Antrean menunggu</div><div class="v">${EA.angka(s.antrean)}</div></div></div>
            <div class="baris-flex" style="margin-top:16px">${s.spreadsheetUrl ? h`<a class="btn k" href="${s.spreadsheetUrl}" target="_blank" rel="noopener">${ik('database', 'k')} Buka Spreadsheet</a>` : ''}${s.folderUrl ? h`<a class="btn k" href="${s.folderUrl}" target="_blank" rel="noopener">${ik('map', 'k')} Folder Drive</a>` : ''}${s.templateUrl ? h`<a class="btn k" href="${s.templateUrl}" target="_blank" rel="noopener">${ik('berkas', 'k')} Template Lembar Disposisi</a>` : ''}</div>` : h`<div class="kosong"><div class="putar gelap" style="margin:0 auto"></div></div>`}</div></div>
          <div class="kartu" style="margin-top:16px"><div class="kartu-h"><h3>Perawatan</h3></div><div class="kartu-b"><div class="stack">
            <div class="kotak-info biru">${ik('putar')}<div><b>Segarkan cache</b> — gunakan setelah mengedit spreadsheet secara langsung (pemicu onEdit biasanya sudah otomatis).</div><button class="btn k" data-aksi="sis" data-x="segarkanCache">Segarkan</button></div>
            <div class="kotak-info biru">${ik('jam')}<div><b>Pasang ulang pemicu</b> — antrean WA tiap 5 menit & pengingat harian 07.00 WIB.</div><button class="btn k" data-aksi="sis" data-x="pasangPemicu">Pasang</button></div>
            <div class="kotak-info biru">${ik('berkas')}<div><b>Buat ulang template</b> lembar disposisi (Google Docs). Template lama tidak dihapus.</div><button class="btn k" data-aksi="sis" data-x="buatTemplate">Buat</button></div>
            <div class="kotak-info kuning">${ik('hp')}<div><b>Data lokal perangkat ini</b> — hapus cache browser (data akan diunduh ulang).</div><button class="btn k" data-aksi="hapus-lokal">Hapus</button></div></div></div></div>`;
        if (!s) EA.api.baca('admin.sistem', {}).then((x) => { fS.sistem = x; this.segar(root, true); }).catch(EA.galat);
      } else if (B === 'impor') {
        isi = this.isiImpor();
      }
      EA.html(el, isi);
      this.pasang(root, el);
    },
    isiImpor() {
      const im = fS.impor, mg = fS.migrasi;
      return h`<div class="kartu"><div class="kartu-h"><div><h3>${ik('unggah')} Impor Agenda Lama dari Excel/CSV (FR-73)</h3><div class="sub">Pindai dulu (tanpa menulis), periksa hasilnya, lalu impor. Impor ulang tidak membuat data ganda.</div></div></div><div class="kartu-b"><div class="stack">
        <div class="baris-flex"><div class="seg" style="grid-template-columns:repeat(2,1fr);min-width:280px" id="im-jenis"><button type="button" data-v="sm" class="${im.jenis === 'sm' ? 'on' : ''}">Surat Masuk</button><button type="button" data-v="sk" class="${im.jenis === 'sk' ? 'on' : ''}">Surat Keluar</button></div>
          <button class="btn k" data-aksi="tpl-impor">${ik('unduh', 'k')} Unduh Template Excel</button></div>
        <div class="f"><label for="im-file">Berkas (.xlsx / .csv)</label><input type="file" id="im-file" accept=".xlsx,.csv"></div>
        ${im.baris.length ? h`<div class="kotak-info biru">${ik('database')}<div><b>${EA.angka(im.baris.length)} baris</b> terbaca dari ${im.berkas}. Kolom: ${Object.keys(im.baris[0]).join(', ')}</div></div>` : ''}
        ${im.hasil ? h`<div class="kotak-info ${im.hasil.galat.length ? 'kuning' : 'hijau'}">${ik(im.hasil.galat.length ? 'awas' : 'cekL')}<div>${im.hasil.dryRun ? 'Hasil pindai (belum ada yang ditulis)' : 'Impor selesai'}: <b>${im.hasil.tambah}</b> ${im.hasil.dryRun ? 'akan ditambahkan' : 'ditambahkan'}${im.hasil.ubah ? h`, <b>${im.hasil.ubah}</b> ${im.hasil.dryRun ? 'akan diperbarui' : 'diperbarui'}` : ''}, <b>${im.hasil.lewati}</b> dilewati (sudah ada)${im.hasil.galat.length ? h`, <b>${im.hasil.galat.length}</b> baris bermasalah:<ul style="margin:6px 0 0;padding-left:18px">${im.hasil.galat.slice(0, 8).map((g) => h`<li>Baris ${g.baris + 1}: ${g.pesan}</li>`)}</ul>` : ''}</div></div>` : ''}
        <div class="baris-flex" style="justify-content:flex-end"><button class="btn" data-aksi="impor" data-dry="1" ${im.baris.length ? '' : 'disabled'}>${ik('mata', 'k')} Pindai (dry-run)</button><button class="btn p" data-aksi="impor" data-dry="0" ${im.hasil && im.hasil.dryRun ? '' : 'disabled'}>${ik('unggah', 'k')} Impor Sekarang</button></div></div></div></div>
        <div class="kartu" style="margin-top:16px"><div class="kartu-h"><div><h3>${ik('database')} Migrasi dari Spreadsheet E-Agenda Lama</h3><div class="sub">Untuk upgrade versi: spreadsheet lama hanya DIBACA, dicocokkan berdasarkan nama kolom, aman diulang (delta-sync sebelum peralihan).</div></div></div><div class="kartu-b"><div class="stack">
          <div class="kotak-info kuning">${ik('info')}<div>Spreadsheet lama harus milik <b>akun Google yang sama</b> dengan pemilik aplikasi agar ID berkas scan di Drive tetap berlaku.</div></div>
          <div class="f"><label for="mg-src">URL atau ID spreadsheet lama</label><input id="mg-src" class="mono" value="${mg.sumber}" placeholder="https://docs.google.com/spreadsheets/d/…"></div>
          ${mg.laporan ? h`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Sheet</th><th class="r">Baris sumber</th><th class="r">Tambah</th><th class="r">Perbarui</th><th class="r">Lewati</th><th>Status</th></tr></thead><tbody>${mg.laporan.map((r) => h`<tr style="cursor:default"><td class="tebal">${r.sheet}</td><td class="r">${r.ada ? EA.angka(r.sumber) : '-'}</td><td class="r">${EA.angka(r.tambah)}</td><td class="r">${EA.angka(r.ubah)}</td><td class="r">${EA.angka(r.lewati)}</td><td>${!r.ada ? h`<span class="lc abu">tidak ada</span>` : r.selesai ? h`<span class="lc hijau">✓ dimigrasi</span>` : h`<span class="lc kuning">pindai</span>`}</td></tr>`)}</tbody></table></div>` : ''}
          <div class="baris-flex" style="justify-content:flex-end"><button class="btn" data-aksi="mg-pindai">${ik('mata', 'k')} Pindai</button><button class="btn p" data-aksi="mg-jalan" ${mg.laporan ? '' : 'disabled'}>${ik('unggah', 'k')} Jalankan Migrasi</button></div></div></div></div>`;
    },
    pasang(root, el) {
      const pra = () => EA.$$('[data-pra]', el).forEach((p) => {
        const ta = EA.$('#c-' + p.dataset.pra, el);
        const contoh = { nama: S.user.nama, perihal: 'Undangan Rapat Koordinasi BOS', batas: EA.tglPanjang(EA.tambahHari(EA.hariIni(), 3)), tautan: (S.cfg.URLAplikasi || location.origin + location.pathname) + '#/disposisi/DSP-' + EA.tahunIni() + '-00001', asal: 'Dinas Pendidikan Provinsi', noagenda: '0045', sifat: 'Segera', bidang: 'Kurikulum', instruksi: 'Tindak lanjuti; Koordinasikan', catatan: 'Mohon hadir tepat waktu', tanggapan: 'Sudah dilaksanakan', instansi: S.cfg.NamaInstansi };
        p.textContent = (ta ? ta.value : '').replace(/\{(\w+)\}/g, (m, k) => (contoh[k] !== undefined ? contoh[k] : m));
      });
      pra();
      let terakhir = null;
      if (el._fokus) el.removeEventListener('focusin', el._fokus);
      el._fokus = (e) => { if (e.target.matches('input[data-k], textarea[data-k]')) terakhir = e.target; };
      el.addEventListener('focusin', el._fokus);
      el.oninput = (e) => {
        if (e.target.dataset.k === 'FormatNomorKeluar') { const c = EA.$('#c-contoh', el); if (c) c.textContent = EA.formatNomor(e.target.value, { no: D.penghitung('Keluar', EA.tahunIni()) + 1, klas: '005', instansi: (EA.$('#c-KodeInstansi', el) || {}).value || S.cfg.KodeInstansi, tgl: EA.hariIni(), bidang: 'KUR' }); }
        if (/^TemplateWA_/.test(e.target.dataset.k || '')) pra();
      };
      el.onchange = async (e) => {
        if (e.target.id === 'c-logo' && e.target.files[0]) {
          try {
            const bmp = await createImageBitmap(e.target.files[0]);
            const sk = Math.min(1, 256 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
            c.width = Math.round(bmp.width * sk); c.height = Math.round(bmp.height * sk); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
            const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
            const r = await EA.api.tulis('admin.logo', { berkas: { mime: 'image/png', b64: await EA.berkasKeB64(blob) } });
            S.info = r.info; EA.emit('info', r.info); EA.toast('Logo diperbarui.'); this.segar(root, true);
          } catch (er) { EA.galat(er); }
        }
        if (e.target.id === 'im-file' && e.target.files[0]) {
          try { const t = await EA.bacaTabel(e.target.files[0]); fS.impor.baris = t.baris; fS.impor.berkas = e.target.files[0].name; fS.impor.hasil = null; this.segar(root, true); } catch (er) { EA.galat(new Error('Berkas tidak dapat dibaca: ' + er.message)); }
        }
      };
      el.onclick = async (e) => {
        const sisip = e.target.closest('[data-sisip]');
        if (sisip && terakhir) { const s = terakhir.selectionStart || terakhir.value.length; terakhir.value = terakhir.value.slice(0, s) + sisip.dataset.sisip + terakhir.value.slice(terakhir.selectionEnd || s); terakhir.focus(); terakhir.dispatchEvent(new Event('input', { bubbles: true })); return; }
        const jn = e.target.closest('#im-jenis [data-v]');
        if (jn) { fS.impor.jenis = jn.dataset.v; fS.impor.hasil = null; this.segar(root, true); return; }
        const t = e.target.closest('[data-aksi]'); if (!t) return;
        const a = t.dataset.aksi;
        if (a === 'logo') EA.$('#c-logo', el).click();
        if (a === 'url-ini') { const i = EA.$('#c-URLAplikasi', el); if (i) i.value = location.origin + location.pathname; }
        if (a === 'simpan') {
          const pasangan = {};
          EA.$$('[data-k]', el).forEach((i) => { const v = i.dataset.ya !== undefined ? (i.checked ? 'Ya' : 'Tidak') : i.value; if (String(S.cfg[i.dataset.k] == null ? '' : S.cfg[i.dataset.k]) !== String(v)) pasangan[i.dataset.k] = v; });
          if (!Object.keys(pasangan).length) { EA.toast('Tidak ada perubahan.', 'info'); return; }
          await EA.sibuk(t, async () => { try { const r = await EA.api.tulis('admin.pengaturan', { pasangan }); D.setCfg(r.cfg); EA.toast('Pengaturan disimpan.'); this.segar(root, true); if (pasangan.NamaInstansi || pasangan.KodeInstansi || pasangan.KopBaris1) EA.emit('info-segar'); } catch (er) { EA.galat(er); } });
        }
        if (a === 'rahasia') {
          await EA.sibuk(t, async () => {
            try {
              const cid = EA.$('#r-cid', el).value.trim(), fon = EA.$('#r-fon', el).value.trim();
              if (cid) fS.rahasia = await EA.api.panggil('admin.rahasia', { aksi: 'simpan', kunci: 'OAUTH_CLIENT_ID', nilai: cid });
              if (fon) fS.rahasia = await EA.api.panggil('admin.rahasia', { aksi: 'simpan', kunci: 'FONNTE_TOKEN', nilai: fon });
              if (!cid && !fon) { EA.toast('Tidak ada yang diubah.', 'info'); return; }
              EA.toast('Rahasia disimpan di Script Properties.'); this.segar(root, true); EA.emit('info-segar');
            } catch (er) { EA.galat(er); }
          });
        }
        if (a === 'muat-sistem') { fS.sistem = null; this.segar(root, true); }
        if (a === 'sis') await EA.sibuk(t, async () => { try { const r = await EA.api.panggil('admin.sistemAksi', { aksi: t.dataset.x }, { timeout: 90000 }); EA.toast(t.dataset.x === 'buatTemplate' ? 'Template baru dibuat.' : 'Selesai.'); if (t.dataset.x === 'buatTemplate' && r.templateUrl) w.open(r.templateUrl, '_blank', 'noopener'); fS.sistem = null; this.segar(root, true); if (t.dataset.x === 'segarkanCache') D.sinkron(S.th); } catch (er) { EA.galat(er); } });
        if (a === 'hapus-lokal') { const k = await EA.konfirmasi({ judul: 'Hapus data lokal?', pesan: 'Data di perangkat ini dihapus lalu diunduh ulang dari server. Anda tetap masuk.', ya: 'Hapus & muat ulang' }); if (k.ok) { await EA.kv.bersihkan(); location.reload(); } }
        if (a === 'tpl-impor') {
          const sm = fS.impor.jenis === 'sm';
          const kol = sm ? ['NoAgenda', 'TglTerima', 'NoSurat', 'TglSurat', 'AsalSurat', 'Perihal', 'Sifat', 'KodeKlasifikasi', 'Lampiran'] : ['NomorSurat', 'TglSurat', 'Tujuan', 'Perihal', 'Sifat', 'KodeKlasifikasi', 'Bidang', 'Keterangan'];
          const contoh = sm ? [{ NoAgenda: '1', TglTerima: EA.tahunIni() + '-01-03', NoSurat: '421/1/Disdik/' + EA.tahunIni(), TglSurat: EA.tahunIni() + '-01-02', AsalSurat: 'Dinas Pendidikan', Perihal: 'Contoh perihal', Sifat: 'Biasa', KodeKlasifikasi: '005', Lampiran: '1 berkas' }]
            : [{ NomorSurat: '001/005/' + (S.cfg.KodeInstansi || 'INST') + '/I/' + EA.tahunIni(), TglSurat: EA.tahunIni() + '-01-05', Tujuan: 'Dinas Pendidikan', Perihal: 'Contoh perihal', Sifat: 'Biasa', KodeKlasifikasi: '005', Bidang: 'Kurikulum', Keterangan: '' }];
          await EA.xlsx('Template-Impor-' + (sm ? 'Surat-Masuk' : 'Surat-Keluar') + '.xlsx', { nama: 'Impor', baris: contoh, kolom: kol.map((k) => ({ label: k, lebar: /Perihal|Asal|Tujuan|Nomor/.test(k) ? 32 : 14, tipe: /^Tgl/.test(k) ? 'tanggal' : undefined, ambil: (r) => r[k] })) });
        }
        if (a === 'impor') {
          const dry = t.dataset.dry === '1', im = fS.impor;
          const baris = im.baris.map((r) => { const o = Object.assign({}, r); ['TglTerima', 'TglSurat'].forEach((k) => { if (o[k] !== undefined) o[k] = EA.keTglIso(o[k]); }); return o; });
          await EA.sibuk(t, async () => {
            try {
              const total = { tambah: 0, ubah: 0, lewati: 0, galat: [], dryRun: dry };
              for (let i = 0; i < baris.length; i += 400) {
                const r = await EA.api.panggil('admin.impor', { jenis: im.jenis, baris: baris.slice(i, i + 400), dryRun: dry, offset: i }, { timeout: 120000 });
                total.tambah += r.tambah; total.ubah += r.ubah; total.lewati += r.lewati; total.galat = total.galat.concat(r.galat);
              }
              im.hasil = total;
              if (!dry) { EA.toast(total.tambah + ' data diimpor.'); Object.keys(S.tahun).forEach((th) => D.sinkron(th)); }
              this.segar(root, true);
            } catch (er) { EA.galat(er); }
          }, dry ? ' Memindai…' : ' Mengimpor…');
        }
        if (a === 'mg-pindai') {
          fS.migrasi.sumber = EA.$('#mg-src', el).value.trim();
          await EA.sibuk(t, async () => { try { const r = await EA.api.panggil('admin.migrasi', { aksi: 'pindai', sumber: fS.migrasi.sumber }, { timeout: 180000 }); fS.migrasi.laporan = r.laporan; EA.toast('Pindai selesai: ' + r.nama); this.segar(root, true); } catch (er) { EA.galat(er); } }, ' Memindai…');
        }
        if (a === 'mg-jalan') {
          const k = await EA.konfirmasi({ judul: 'Jalankan migrasi?', pesan: 'Data dari spreadsheet lama ditambahkan/diperbarui ke aplikasi ini, per sheet. Spreadsheet lama tidak diubah. Aman diulang.', ya: 'Jalankan' });
          if (!k.ok) return;
          await EA.sibuk(t, async () => {
            try {
              for (const r of fS.migrasi.laporan.filter((x) => x.ada)) {
                const x = await EA.api.panggil('admin.migrasi', { aksi: 'jalankan', sumber: fS.migrasi.sumber, sheet: r.sheet }, { timeout: 300000 });
                Object.assign(r, x, { selesai: true }); this.segar(root, true);
              }
              EA.toast('Migrasi selesai.'); Object.keys(S.tahun).forEach((th) => D.sinkron(th));
            } catch (er) { EA.galat(er); }
          }, ' Migrasi…');
        }
      };
    }
  };

  /* ================= LOG AKTIVITAS ================= */
  const fG = { hal: 1, cari: '', modul: '', aksi: '', dari: '', sampai: '', data: null };
  EA.hal.log = {
    judul: 'Log Aktivitas',
    render(root) {
      root.innerHTML = h`<div class="kepala"><div><h1>Log Aktivitas</h1><p>Semua aksi tulis tercatat (FR-72): siapa, kapan, apa. Rahasia tidak pernah ditulis ke log.</p></div></div>
        <div class="kartu"><div class="saring"><label class="cari"><span class="sr">Cari</span>${ik('cari')}<input id="g-q" type="search" placeholder="Cari email, ID, detail…" value="${fG.cari}"></label>
          <select id="g-modul" aria-label="Modul"><option value="">Semua modul</option>${['Auth', 'SuratMasuk', 'SuratKeluar', 'Disposisi', 'Pengguna', 'Bidang', 'Klasifikasi', 'Pengaturan', 'Notifikasi', 'Sistem'].map((m) => h`<option ${fG.modul === m ? 'selected' : ''}>${m}</option>`)}</select>
          <select id="g-aksi" aria-label="Aksi"><option value="">Semua aksi</option>${['LOGIN', 'TAMBAH', 'UBAH', 'HAPUS', 'DISPOSISI', 'BACA', 'PROSES', 'SELESAI', 'AMBIL_NOMOR', 'BATAL_NOMOR', 'UNGGAH_SCAN', 'CETAK_LEMBAR', 'IMPOR', 'MIGRASI'].map((m) => h`<option ${fG.aksi === m ? 'selected' : ''}>${m}</option>`)}</select>
          <input type="date" id="g-dari" value="${fG.dari}" aria-label="Dari"><input type="date" id="g-sampai" value="${fG.sampai}" aria-label="Sampai"></div><div id="g-isi"><div class="kosong"><div class="putar gelap" style="margin:0 auto"></div></div></div></div>`.s;
      EA.$('#g-q', root).addEventListener('input', EA.debounce((e) => { fG.cari = e.target.value; fG.hal = 1; this.muat(root); }, 400));
      root.onchange = (e) => { const k = { 'g-modul': 'modul', 'g-aksi': 'aksi', 'g-dari': 'dari', 'g-sampai': 'sampai' }[e.target.id]; if (k) { fG[k] = e.target.value; fG.hal = 1; this.muat(root); } };
      root.onclick = (e) => { const t = e.target.closest('[data-hal]'); if (t) { fG.hal = Number(t.dataset.hal); this.muat(root); } };
      this.muat(root);
    },
    async muat(root) {
      try { fG.data = await EA.api.baca('admin.log', { hal: fG.hal, cari: fG.cari, modul: fG.modul, aksi: fG.aksi, dari: fG.dari, sampai: fG.sampai }); this.segar(root); }
      catch (e) { const el = EA.$('#g-isi', root); if (el) EA.html(el, EA.kosong('galat', 'Gagal memuat log', e.message)); }
    },
    segar(root) {
      const el = EA.$('#g-isi', root), d = fG.data; if (!el || !d) return;
      EA.html(el, d.baris.length ? h`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Waktu</th><th>Pengguna</th><th>Aksi</th><th>Modul</th><th>Rujukan</th><th>Detail</th></tr></thead><tbody>
        ${d.baris.map((x) => h`<tr style="cursor:default"><td style="white-space:nowrap">${EA.waktu(x.Waktu)}</td><td>${D.nama(x.Email)}<div class="sub">${x.Email} · ${x.Peran}</div></td><td><span class="lc ${/HAPUS|BATAL/.test(x.Aksi) ? 'merah' : /LOGIN|LOGOUT/.test(x.Aksi) ? 'abu' : 'hijau'}">${x.Aksi}</span></td><td>${x.Modul}</td><td class="mono" style="font-size:12px">${x.RefID}</td><td style="max-width:420px">${x.Detail}</td></tr>`)}</tbody></table></div>
        <div class="tbl-kaki"><span>${EA.angka(d.total)} entri${d.terbatas ? ' (pencarian dibatasi 30.000 baris terbaru)' : ''}</span>${EA.paginasi(d.total, d.hal, d.per)}</div>` : EA.kosong('riwayat', 'Tidak ada entri', ''));
    }
  };
})(window);
