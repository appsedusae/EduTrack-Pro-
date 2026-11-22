/* grafik.js — grafik SVG ringan tanpa pustaka luar (tampil instan, tanpa CDN):
   area bergaris halus + isian gradasi, batang berkelompok (ujung membulat 4px), donat lubang 62% berikon amplop,
   sparkline KPI. Semua grafik ber-tooltip saat disentuh/diarahkan (crosshair untuk garis). */
(function (w) {
  'use strict';
  const EA = w.EA, esc = EA.esc;
  let uidN = 0;
  const ro = 'ResizeObserver' in w ? new ResizeObserver((ents) => ents.forEach((en) => {
    const el = en.target, g = el._grafik;
    if (g && Math.abs((g.lebar || 0) - el.clientWidth) > 4) gambar(el, g.tipe, g.cfg);
  })) : null;

  function langkahBagus(maks, n) {
    const kasar = Math.max(1, maks) / n, p = Math.pow(10, Math.floor(Math.log10(kasar)));
    const f = kasar / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }
  function skalaY(maks) {
    const st = langkahBagus(Math.max(maks, 4), 4);
    const atas = Math.max(st * 4, Math.ceil(maks / st) * st);
    const t = []; for (let v = 0; v <= atas + 1e-9; v += st) t.push(Math.round(v * 100) / 100);
    return { atas, ticks: t };
  }
  /** Kurva monoton (Fritsch–Carlson): halus tanpa melampaui data (tidak turun di bawah 0). */
  function jalurHalus(pt) {
    const n = pt.length;
    if (n < 2) return n ? 'M' + pt[0][0] + ',' + pt[0][1] : '';
    const dx = [], dy = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx.push(pt[i + 1][0] - pt[i][0]); dy.push(pt[i + 1][1] - pt[i][1]); m.push(dy[i] / dx[i]); }
    t.push(m[0]);
    for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]));
    t.push(m[n - 2]);
    let d = 'M' + pt[0][0].toFixed(1) + ',' + pt[0][1].toFixed(1);
    for (let i = 0; i < n - 1; i++) {
      const c1x = pt[i][0] + dx[i] / 3, c1y = pt[i][1] + (t[i] * dx[i]) / 3, c2x = pt[i + 1][0] - dx[i] / 3, c2y = pt[i + 1][1] - (t[i + 1] * dx[i]) / 3;
      d += ' C' + c1x.toFixed(1) + ',' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ',' + c2y.toFixed(1) + ' ' + pt[i + 1][0].toFixed(1) + ',' + pt[i + 1][1].toFixed(1);
    }
    return d;
  }
  function tooltip(el) {
    let t = el.querySelector('.tooltip');
    if (!t) { t = document.createElement('div'); t.className = 'tooltip'; t.setAttribute('role', 'status'); el.appendChild(t); }
    return t;
  }
  const baris = (warna, nama, nilai) => '<div class="tt-r"><i style="background:' + warna + '"></i>' + esc(nama) + '<span>' + esc(nilai) + '</span></div>';

  function area(el, c) {
    const W = Math.max(260, el.clientWidth || 600), H = c.tinggi || 230, pl = 34, pr = 12, pt0 = 12, pb = 26;
    const n = c.label.length, maks = Math.max(0, ...c.seri.flatMap((s) => s.data));
    const sy = skalaY(maks), pw = W - pl - pr, ph = H - pt0 - pb;
    const x = (i) => pl + (n > 1 ? (i * pw) / (n - 1) : pw / 2), y = (v) => pt0 + ph - (v / sy.atas) * ph;
    const id = 'g' + (++uidN);
    const langkahX = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 64))));
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" height="' + H + '" role="img" aria-label="' + esc(c.aria || 'Grafik') + '"><defs>';
    c.seri.forEach((se, k) => { s += '<linearGradient id="' + id + k + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + se.warna + '" stop-opacity=".26"/><stop offset="1" stop-color="' + se.warna + '" stop-opacity=".02"/></linearGradient>'; });
    s += '</defs><g class="sumbu">';
    sy.ticks.forEach((t) => { s += '<line class="grid-l" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(t) + '" y2="' + y(t) + '"/><text x="' + (pl - 8) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + EA.angka(t) + '</text>'; });
    c.label.forEach((l, i) => { if (i % langkahX === 0 || i === n - 1) s += '<text x="' + x(i) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(l) + '</text>'; });
    s += '</g>';
    c.seri.forEach((se, k) => {
      const pts = se.data.map((v, i) => [x(i), y(v)]);
      const d = jalurHalus(pts);
      if (n > 1) s += '<path d="' + d + ' L' + x(n - 1) + ',' + y(0) + ' L' + x(0) + ',' + y(0) + ' Z" fill="url(#' + id + k + ')"/>';
      s += '<path d="' + d + '" fill="none" stroke="' + se.warna + '" stroke-width="2.25" stroke-linecap="round"' + (se.putus ? ' stroke-dasharray="5 4"' : '') + '/>';
    });
    s += '<g class="hover" style="display:none"><line x1="0" x2="0" y1="' + pt0 + '" y2="' + (pt0 + ph) + '" stroke="#94A3B8" stroke-width="1" stroke-dasharray="3 3"/>';
    c.seri.forEach((se) => { s += '<circle r="5" fill="' + se.warna + '" stroke="#fff" stroke-width="2"/>'; });
    s += '</g><rect x="' + pl + '" y="' + pt0 + '" width="' + pw + '" height="' + ph + '" fill="transparent" class="hit"/></svg>';
    el.innerHTML = s;
    const svg = el.querySelector('svg'), g = svg.querySelector('.hover'), tt = tooltip(el);
    const pindah = (e) => {
      const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - pl) / (pw || 1)) * (n - 1))));
      g.style.display = '';
      g.querySelector('line').setAttribute('x1', x(i)); g.querySelector('line').setAttribute('x2', x(i));
      g.querySelectorAll('circle').forEach((ci, k) => { ci.setAttribute('cx', x(i)); ci.setAttribute('cy', y(c.seri[k].data[i])); });
      tt.innerHTML = '<b>' + esc(c.judulX ? c.judulX[i] : c.label[i]) + '</b>' + c.seri.map((se) => baris(se.warna, se.nama, EA.angka(se.data[i]))).join('');
      tt.style.left = (x(i) / W) * r.width + 'px';
      tt.style.top = (Math.min(...c.seri.map((se) => y(se.data[i]))) / H) * r.height + 'px';
      tt.classList.add('on');
    };
    const keluar = () => { g.style.display = 'none'; tt.classList.remove('on'); };
    const hit = svg.querySelector('.hit');
    hit.addEventListener('pointermove', pindah); hit.addEventListener('pointerdown', pindah); hit.addEventListener('pointerleave', keluar);
    return W;
  }

  function jalurBatang(x, yTop, w2, base, r) {
    const hgt = base - yTop; if (hgt <= 0) return '';
    r = Math.min(r, w2 / 2, hgt);
    return 'M' + x + ',' + base + ' V' + (yTop + r) + ' Q' + x + ',' + yTop + ' ' + (x + r) + ',' + yTop + ' H' + (x + w2 - r) + ' Q' + (x + w2) + ',' + yTop + ' ' + (x + w2) + ',' + (yTop + r) + ' V' + base + ' Z';
  }
  function batang(el, c) {
    const W = Math.max(260, el.clientWidth || 600), H = c.tinggi || 220, pl = 34, pr = 8, pt0 = 10, pb = 26;
    const n = c.label.length, k = c.seri.length, maks = Math.max(0, ...c.seri.flatMap((s) => s.data));
    const sy = skalaY(maks), pw = W - pl - pr, ph = H - pt0 - pb, gw = pw / n;
    const bw = Math.max(3, Math.min(16, (gw * 0.68 - (k - 1) * 2) / k)), base = pt0 + ph;
    const y = (v) => pt0 + ph - (v / sy.atas) * ph;
    let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" height="' + H + '" role="img" aria-label="' + esc(c.aria || 'Grafik batang') + '"><g class="sumbu">';
    sy.ticks.forEach((t) => { s += '<line class="grid-l" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(t) + '" y2="' + y(t) + '"/><text x="' + (pl - 8) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + EA.angka(t) + '</text>'; });
    c.label.forEach((l, i) => { s += '<text x="' + (pl + gw * i + gw / 2) + '" y="' + (H - 6) + '" text-anchor="middle"' + (c.sorot === i ? ' style="fill:#2563EB;font-weight:700"' : '') + '>' + esc(l) + '</text>'; });
    s += '</g><rect class="band" x="0" y="' + pt0 + '" width="' + gw + '" height="' + ph + '" fill="#F1F5F9" style="display:none" rx="6"/>';
    for (let i = 0; i < n; i++) {
      const x0 = pl + gw * i + (gw - (bw * k + 2 * (k - 1))) / 2;
      c.seri.forEach((se, j) => { s += '<path d="' + jalurBatang(x0 + j * (bw + 2), y(se.data[i]), bw, base, 4) + '" fill="' + se.warna + '"/>'; });
    }
    s += '<rect class="hit" x="' + pl + '" y="' + pt0 + '" width="' + pw + '" height="' + ph + '" fill="transparent"/></svg>';
    el.innerHTML = s;
    const svg = el.querySelector('svg'), band = svg.querySelector('.band'), tt = tooltip(el);
    svg.insertBefore(band, svg.querySelector('path'));
    const pindah = (e) => {
      const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(n - 1, Math.floor((px - pl) / gw)));
      band.style.display = ''; band.setAttribute('x', pl + gw * i);
      tt.innerHTML = '<b>' + esc(c.judulX ? c.judulX[i] : c.label[i]) + '</b>' + c.seri.map((se) => baris(se.warna, se.nama, EA.angka(se.data[i]))).join('');
      tt.style.left = ((pl + gw * i + gw / 2) / W) * r.width + 'px';
      tt.style.top = (Math.min(...c.seri.map((se) => y(se.data[i]))) / H) * r.height + 'px';
      tt.classList.add('on');
    };
    const hit = svg.querySelector('.hit');
    hit.addEventListener('pointermove', pindah); hit.addEventListener('pointerdown', pindah);
    hit.addEventListener('pointerleave', () => { band.style.display = 'none'; tt.classList.remove('on'); });
    return W;
  }

  function donat(el, c) {
    const S = c.ukuran || 170, R = S / 2 - 3, r0 = R * 0.62, cx = S / 2, cy = S / 2;
    const total = c.data.reduce((a, d) => a + d.nilai, 0);
    let s = '<svg viewBox="0 0 ' + S + ' ' + S + '" width="' + S + '" height="' + S + '" role="img" aria-label="' + esc(c.aria || 'Grafik donat') + '">';
    if (!total) s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + ((R + r0) / 2) + '" fill="none" stroke="#E2E8F0" stroke-width="' + (R - r0) + '"/>';
    let a0 = -Math.PI / 2;
    const busur = (a1, a2, ro, ri) => {
      const besar = a2 - a1 > Math.PI ? 1 : 0, p = (r2, a) => (cx + r2 * Math.cos(a)).toFixed(2) + ',' + (cy + r2 * Math.sin(a)).toFixed(2);
      return 'M' + p(ro, a1) + ' A' + ro + ',' + ro + ' 0 ' + besar + ' 1 ' + p(ro, a2) + ' L' + p(ri, a2) + ' A' + ri + ',' + ri + ' 0 ' + besar + ' 0 ' + p(ri, a1) + ' Z';
    };
    c.data.forEach((d, i) => {
      if (!d.nilai) return;
      const sudut = (d.nilai / total) * Math.PI * 2, a1 = a0, a2 = a0 + Math.min(sudut, Math.PI * 2 - 0.0001);
      s += '<path data-i="' + i + '" d="' + busur(a1, a2, R, r0) + '" fill="' + d.warna + '" stroke="#fff" stroke-width="2" style="cursor:pointer;transition:opacity .15s"/>';
      a0 += sudut;
    });
    s += '<g transform="translate(' + (cx - 11) + ',' + (cy - 24) + ')" fill="none" stroke="#475569" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="20" height="14" rx="2"/><path d="m21 5-10 6.5L1 5"/></g>';
    s += '<text x="' + cx + '" y="' + (cy + 12) + '" text-anchor="middle" style="font:700 17px Poppins,system-ui;fill:#0F172A">' + EA.angka(total) + '</text>';
    s += '<text x="' + cx + '" y="' + (cy + 27) + '" text-anchor="middle" style="font:600 9.5px Inter,system-ui;fill:#64748B;letter-spacing:.08em">' + esc(c.tengah || 'TOTAL') + '</text></svg>';
    el.innerHTML = s;
    const tt = tooltip(el), svg = el.querySelector('svg');
    el.querySelectorAll('path[data-i]').forEach((p) => {
      const tampil = (e) => {
        const d = c.data[Number(p.dataset.i)], r = el.getBoundingClientRect();
        el.querySelectorAll('path[data-i]').forEach((q) => { q.style.opacity = q === p ? '1' : '.45'; });
        tt.innerHTML = '<b>' + esc(d.nama) + '</b>' + baris(d.warna, EA.angka(d.nilai) + ' surat', EA.desimal(EA.persen(d.nilai, total)) + '%');
        tt.style.left = (e.clientX - r.left) + 'px'; tt.style.top = (e.clientY - r.top) + 'px';
        tt.classList.add('on');
      };
      p.addEventListener('pointermove', tampil); p.addEventListener('pointerdown', tampil);
      p.addEventListener('pointerleave', () => { el.querySelectorAll('path[data-i]').forEach((q) => { q.style.opacity = '1'; }); tt.classList.remove('on'); });
    });
    return svg ? S : 0;
  }

  function gambar(el, tipe, cfg) {
    const fn = { area, batang, donat }[tipe];
    el.classList.add('grafik');
    const lebar = fn(el, cfg);
    el._grafik = { tipe, cfg, lebar: el.clientWidth || lebar };
    if (ro && !el._diamati) { ro.observe(el); el._diamati = true; }
  }
  EA.grafik = {
    area: (el, c) => gambar(el, 'area', c),
    batang: (el, c) => gambar(el, 'batang', c),
    donat: (el, c) => gambar(el, 'donat', c),
    /** Sparkline dekoratif untuk kartu KPI (putih transparan). */
    spark(data) {
      const n = data.length;
      if (n < 2) return EA.raw('<svg viewBox="0 0 100 30" preserveAspectRatio="none"></svg>');
      const maks = Math.max(1, ...data), pts = data.map((v, i) => [(i / (n - 1)) * 100, 28 - (v / maks) * 22]);
      const d = jalurHalus(pts);
      return EA.raw('<svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + ' L100,30 L0,30 Z" fill="rgba(255,255,255,.18)"/><path d="' + d + '" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>');
    }
  };
})(window);
