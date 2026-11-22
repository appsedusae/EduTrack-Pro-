/* ekspor.js — dibuat di browser (PRD 6: hemat waktu eksekusi server):
   Excel .xlsx (tulis & baca, via JSZip), PDF tabel resmi ber-kop + nomor halaman + blok tanda tangan (via pdf-lib). */
(function (w) {
  'use strict';
  const EA = w.EA;
  const xmlEsc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const kol = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const serial = (iso) => { const [y, m, d] = iso.split('-').map(Number); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000; };

  /** Tulis XLSX: kolom = [{label, lebar, tipe:'teks'|'angka'|'tanggal', ambil(row)}] */
  EA.xlsx = async (namaBerkas, lembar) => {
    await EA.muatSkrip('js/vendor/jszip.min.js');
    const zip = new w.JSZip();
    const daftar = Array.isArray(lembar) ? lembar : [lembar];
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      daftar.map((x, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      daftar.map((x, i) => '<sheet name="' + xmlEsc(String(x.nama || 'Data').replace(/[\\/?*[\]:]/g, '-').slice(0, 31)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>');
    zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      daftar.map((x, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
      '<Relationship Id="rId' + (daftar.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
    zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="13"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B1437"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment vertical="top"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>');
    daftar.forEach((lb, si) => {
      const k = lb.kolom, rows = lb.baris || [];
      const judul = lb.judul ? 1 : 0;
      let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="' + (1 + judul) + '" topLeftCell="A' + (2 + judul) + '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>' +
        k.map((c, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.lebar || 16) + '" customWidth="1"/>').join('') + '</cols><sheetData>';
      if (judul) xml += '<row r="1"><c r="A1" t="inlineStr" s="4"><is><t>' + xmlEsc(lb.judul) + '</t></is></c></row>';
      const rh = 1 + judul;
      xml += '<row r="' + rh + '">' + k.map((c, i) => '<c r="' + kol(i) + rh + '" t="inlineStr" s="1"><is><t>' + xmlEsc(c.label) + '</t></is></c>').join('') + '</row>';
      rows.forEach((r, ri) => {
        const n = ri + rh + 1;
        xml += '<row r="' + n + '">' + k.map((c, i) => {
          const v = c.ambil(r, ri), ref = kol(i) + n;
          if (v === '' || v == null) return '<c r="' + ref + '" s="3"/>';
          if (c.tipe === 'angka' && !isNaN(Number(v))) return '<c r="' + ref + '" s="3"><v>' + Number(v) + '</v></c>';
          if (c.tipe === 'tanggal' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return '<c r="' + ref + '" s="2"><v>' + serial(v) + '</v></c>';
          return '<c r="' + ref + '" t="inlineStr" s="3"><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>';
        }).join('') + '</row>';
      });
      xml += '</sheetData><autoFilter ref="A' + rh + ':' + kol(k.length - 1) + (rh + rows.length) + '"/><pageSetup orientation="landscape" paperSize="9"/></worksheet>';
      zip.file('xl/worksheets/sheet' + (si + 1) + '.xml', xml);
    });
    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
    EA.unduhBlob(blob, namaBerkas);
    return blob;
  };

  /** Baca XLSX/CSV → { header, baris: [ {Header: nilai} ] } (lembar pertama). Tanggal seri Excel → yyyy-mm-dd. */
  EA.bacaTabel = async (file) => {
    if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
      const teks = await file.text();
      const pemisah = (teks.split('\n')[0].match(/;/g) || []).length > (teks.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
      const rows = [];
      let r = [], f = '', q = false;
      for (let i = 0; i < teks.length; i++) {
        const ch = teks[i];
        if (q) { if (ch === '"' && teks[i + 1] === '"') { f += '"'; i++; } else if (ch === '"') q = false; else f += ch; }
        else if (ch === '"') q = true; else if (ch === pemisah) { r.push(f); f = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && teks[i + 1] === '\n') i++; r.push(f); rows.push(r); r = []; f = ''; } else f += ch;
      }
      if (f || r.length) { r.push(f); rows.push(r); }
      return susun(rows.filter((x) => x.join('').trim()));
    }
    await EA.muatSkrip('js/vendor/jszip.min.js');
    const zip = await w.JSZip.loadAsync(await file.arrayBuffer());
    const parse = (s) => new DOMParser().parseFromString(s, 'application/xml');
    const wb = parse(await zip.file('xl/workbook.xml').async('string'));
    const sheet1 = wb.getElementsByTagName('sheet')[0];
    const rid = sheet1.getAttribute('r:id') || sheet1.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const rels = parse(await zip.file('xl/_rels/workbook.xml.rels').async('string'));
    let target = 'worksheets/sheet1.xml';
    Array.from(rels.getElementsByTagName('Relationship')).forEach((r) => { if (r.getAttribute('Id') === rid) target = r.getAttribute('Target'); });
    target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
    const ss = [];
    if (zip.file('xl/sharedStrings.xml')) {
      const d = parse(await zip.file('xl/sharedStrings.xml').async('string'));
      Array.from(d.getElementsByTagName('si')).forEach((si) => ss.push(Array.from(si.getElementsByTagName('t')).map((t) => t.textContent).join('')));
    }
    const sh = parse(await zip.file('xl/' + target).async('string'));
    const rows = [];
    Array.from(sh.getElementsByTagName('row')).forEach((row) => {
      const arr = [];
      Array.from(row.getElementsByTagName('c')).forEach((c) => {
        const ref = c.getAttribute('r') || '', huruf = ref.replace(/\d+/g, '');
        let idx = 0; for (let i = 0; i < huruf.length; i++) idx = idx * 26 + (huruf.charCodeAt(i) - 64);
        const t = c.getAttribute('t'), v = c.getElementsByTagName('v')[0];
        let val = '';
        if (t === 's') val = ss[Number(v && v.textContent)] || '';
        else if (t === 'inlineStr') val = Array.from(c.getElementsByTagName('t')).map((x) => x.textContent).join('');
        else if (t === 'b') val = v && v.textContent === '1' ? 'TRUE' : 'FALSE';
        else val = v ? v.textContent : '';
        arr[idx - 1] = val;
      });
      rows.push(Array.from(arr, (x) => (x === undefined ? '' : x)));
    });
    return susun(rows.filter((x) => x.join('').trim()));
  };
  function susun(rows) {
    if (!rows.length) return { header: [], baris: [] };
    const header = rows[0].map((x) => String(x).trim());
    return { header, baris: rows.slice(1).map((r) => { const o = {}; header.forEach((k, i) => { if (k) o[k] = r[i] === undefined ? '' : r[i]; }); return o; }) };
  }
  /** Nilai tanggal dari Excel/CSV → yyyy-mm-dd */
  EA.keTglIso = (v) => {
    const s = String(v == null ? '' : v).trim();
    if (/^\d{4,5}(\.\d+)?$/.test(s) && Number(s) > 20000 && Number(s) < 80000) return new Date(Math.round((Number(s) - 25569) * 86400000)).toISOString().slice(0, 10);
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return m[1] + '-' + EA.pad(m[2], 2) + '-' + EA.pad(m[3], 2);
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/); if (m) return m[3] + '-' + EA.pad(m[2], 2) + '-' + EA.pad(m[1], 2);
    return '';
  };

  /* ---------- PDF tabel resmi (pdf-lib, huruf standar Helvetica) ---------- */
  const PENGGANTI = { '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', ' ': ' ', '•': '-', '·': '-', '☑': 'x', '☐': '-' };
  /** Huruf standar PDF hanya WinAnsi: karakter lain diganti agar tidak galat. */
  const aman = (s) => String(s == null ? '' : s).replace(/[–—‘’“”… •·☑☐]/g, (c) => PENGGANTI[c]).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E¡-ÿ\n]/g, '?');
  function bungkus(teks, font, uk, lebar) {
    const hasil = [];
    String(teks).split('\n').forEach((par) => {
      const kata = par.split(/\s+/);
      let baris = '';
      kata.forEach((k) => {
        while (font.widthOfTextAtSize(k, uk) > lebar && k.length > 1) {
          let n = k.length; while (n > 1 && font.widthOfTextAtSize(k.slice(0, n), uk) > lebar) n--;
          if (baris) { hasil.push(baris); baris = ''; }
          hasil.push(k.slice(0, n)); k = k.slice(n);
        }
        const coba = baris ? baris + ' ' + k : k;
        if (font.widthOfTextAtSize(coba, uk) <= lebar) baris = coba; else { if (baris) hasil.push(baris); baris = k; }
      });
      hasil.push(baris);
    });
    return hasil;
  }
  /**
   * o = { judul, subjudul, kertas:'A4'|'F4', kolom:[{label, lebar(rel), ambil(row,i), rata}], baris, kop:true,
   *       tandaTangan:{kiri:{atas,jabatan,nama,nip}, kanan:{...}}, coret(row) }
   */
  EA.pdfTabel = async (o) => {
    await EA.muatSkrip('js/vendor/pdf-lib.min.js');
    const L = w.PDFLib, S = EA.S, cfg = S.cfg;
    const doc = await L.PDFDocument.create();
    doc.setTitle(aman(o.judul)); doc.setCreator('E-Agenda'); doc.setProducer('E-Agenda');
    const f = await doc.embedFont(L.StandardFonts.Helvetica), fb = await doc.embedFont(L.StandardFonts.HelveticaBold);
    const ukuranKertas = o.kertas === 'F4' ? [935.43, 609.45] : [841.89, 595.28];
    const [PW, PH] = ukuranKertas, M = 32, lebarIsi = PW - M * 2;
    const tinta = L.rgb(0.06, 0.09, 0.16), abu = L.rgb(0.39, 0.45, 0.55), garis = L.rgb(0.8, 0.84, 0.88), kepala = L.rgb(0.043, 0.078, 0.216);
    let logo = null;
    if (o.kop !== false && S.info && S.info.logo) {
      try { const b = EA.b64KeBlob(S.info.logo.split(',')[1], S.info.logo.slice(5).split(';')[0]); const buf = await b.arrayBuffer(); logo = /png/.test(b.type) ? await doc.embedPng(buf) : await doc.embedJpg(buf); } catch (e) { logo = null; }
    }
    const totalRel = o.kolom.reduce((a, c) => a + (c.lebar || 1), 0);
    const lebarKol = o.kolom.map((c) => ((c.lebar || 1) / totalRel) * lebarIsi);
    const UK = 8.2, LH = 10.4, PAD = 4;
    let pg, y;
    const halBaru = (pertama) => {
      pg = doc.addPage(ukuranKertas); y = PH - M;
      if (pertama && o.kop !== false) {
        const tengah = PW / 2;
        if (logo) { const t = 54, l = (logo.width / logo.height) * t; pg.drawImage(logo, { x: M + 6, y: y - t + 2, width: l, height: t }); }
        const tulisT = (s, font, uk) => { s = aman(s); if (!s) return; const lw = font.widthOfTextAtSize(s, uk); pg.drawText(s, { x: tengah - lw / 2, y: y - uk, size: uk, font, color: tinta }); y -= uk + 3; };
        tulisT(cfg.KopBaris1, fb, 11); tulisT(cfg.KopBaris2, fb, 11); tulisT(cfg.NamaInstansi, fb, 15); tulisT(cfg.Alamat, f, 8.5); tulisT(cfg.Kontak, f, 8.5);
        y = Math.min(y, PH - M - 58) - 4;
        pg.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 2, color: tinta });
        pg.drawLine({ start: { x: M, y: y - 3 }, end: { x: PW - M, y: y - 3 }, thickness: 0.6, color: tinta });
        y -= 20;
        const j = aman(o.judul).toUpperCase(), jw = fb.widthOfTextAtSize(j, 13);
        pg.drawText(j, { x: tengah - jw / 2, y, size: 13, font: fb, color: tinta });
        y -= 14;
        if (o.subjudul) { const s = aman(o.subjudul), sw = f.widthOfTextAtSize(s, 9.5); pg.drawText(s, { x: tengah - sw / 2, y, size: 9.5, font: f, color: abu }); y -= 12; }
        y -= 6;
      }
      // kepala tabel
      const kepalaBaris = o.kolom.map((c, i) => bungkus(aman(c.label), fb, UK, lebarKol[i] - PAD * 2));
      const tinggi = Math.max(...kepalaBaris.map((b) => b.length)) * LH + PAD * 2;
      pg.drawRectangle({ x: M, y: y - tinggi, width: lebarIsi, height: tinggi, color: kepala });
      let x = M;
      kepalaBaris.forEach((b, i) => { b.forEach((t, k) => pg.drawText(t, { x: x + PAD, y: y - PAD - UK - k * LH + 1, size: UK, font: fb, color: L.rgb(1, 1, 1) })); x += lebarKol[i]; });
      y -= tinggi;
    };
    halBaru(true);
    o.baris.forEach((r, ri) => {
      const sel = o.kolom.map((c, i) => bungkus(aman(c.ambil(r, ri)), f, UK, lebarKol[i] - PAD * 2));
      const tinggi = Math.max(...sel.map((b) => b.length)) * LH + PAD * 2;
      if (y - tinggi < M + 22) halBaru(false);
      if (ri % 2) pg.drawRectangle({ x: M, y: y - tinggi, width: lebarIsi, height: tinggi, color: L.rgb(0.973, 0.98, 0.988) });
      const coret = o.coret && o.coret(r);
      let x = M;
      sel.forEach((b, i) => {
        b.forEach((t, k) => {
          const tw = f.widthOfTextAtSize(t, UK);
          const tx = o.kolom[i].rata === 'tengah' ? x + (lebarKol[i] - tw) / 2 : o.kolom[i].rata === 'kanan' ? x + lebarKol[i] - PAD - tw : x + PAD;
          pg.drawText(t, { x: tx, y: y - PAD - UK - k * LH + 1, size: UK, font: f, color: coret ? abu : tinta });
        });
        pg.drawLine({ start: { x, y }, end: { x, y: y - tinggi }, thickness: 0.4, color: garis });
        x += lebarKol[i];
      });
      pg.drawLine({ start: { x: M + lebarIsi, y }, end: { x: M + lebarIsi, y: y - tinggi }, thickness: 0.4, color: garis });
      pg.drawLine({ start: { x: M, y: y - tinggi }, end: { x: M + lebarIsi, y: y - tinggi }, thickness: 0.4, color: garis });
      y -= tinggi;
    });
    if (!o.baris.length) { pg.drawText('Tidak ada data pada periode ini.', { x: M + 6, y: y - 16, size: 9.5, font: f, color: abu }); y -= 24; }
    if (o.tandaTangan) {
      if (y < M + 120) halBaru(false);
      y -= 26;
      const blok = (b, x0) => {
        let yy = y;
        [[b.atas, f], [b.jabatan, f]].forEach(([t, font]) => { if (t) { pg.drawText(aman(t), { x: x0, y: yy, size: 9.5, font, color: tinta }); yy -= 13; } });
        yy -= 46;
        const nm = aman(b.nama || '..............................');
        pg.drawText(nm, { x: x0, y: yy, size: 9.5, font: fb, color: tinta });
        pg.drawLine({ start: { x: x0, y: yy - 2 }, end: { x: x0 + fb.widthOfTextAtSize(nm, 9.5), y: yy - 2 }, thickness: 0.6, color: tinta });
        if (b.nip) pg.drawText(aman('NIP. ' + b.nip), { x: x0, y: yy - 13, size: 9, font: f, color: tinta });
      };
      if (o.tandaTangan.kiri) blok(o.tandaTangan.kiri, M + 30);
      if (o.tandaTangan.kanan) blok(o.tandaTangan.kanan, PW - M - 230);
    }
    const hal = doc.getPages(), dicetak = 'Dicetak dari E-Agenda ' + EA.waktu(Date.now()) + ' WIB';
    hal.forEach((p, i) => {
      const t = 'Halaman ' + (i + 1) + ' dari ' + hal.length;
      p.drawText(t, { x: PW - M - f.widthOfTextAtSize(t, 8), y: 16, size: 8, font: f, color: abu });
      p.drawText(aman(dicetak), { x: M, y: 16, size: 8, font: f, color: abu });
    });
    return new Blob([await doc.save()], { type: 'application/pdf' });
  };
})(window);
