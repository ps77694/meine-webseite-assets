/* Transportkarte – Baustellen-Nachweis (PDF)
   Rechnet aus den gezeigten Strecken und der Baustellenliste einen Nachweis und schreibt ihn als PDF (A4 quer, jsPDF lokal aus lib/).
   Die Routenlogik und die Prüfungen der Seite werden nicht berührt; dieser Baustein liest nur. */
(function (root) {
  'use strict';
  var TK = root.TK = root.TK || {};
  var N = {};
  var AMPEL = [
    { text: 'zu eng', farbe: '#c5221f', rgb: [197, 34, 31] },
    { text: 'knapp', farbe: '#e37400', rgb: [227, 116, 0] },
    { text: 'passt', farbe: '#188038', rgb: [24, 128, 56] }
  ];

  /* ---------- kleine Helfer ---------- */
  function p2(n) { return String(n).padStart(2, '0'); }
  function dDatum(d) { return p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' + d.getFullYear(); }
  function dUhr(d, mitSek) { return p2(d.getHours()) + ':' + p2(d.getMinutes()) + (mitSek ? ':' + p2(d.getSeconds()) : ''); }
  function isoDe(iso) { if (!iso) return ''; var p = String(iso).slice(0, 10).split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : ''; }
  function zahlDe(v, n) { return v == null || !isFinite(v) ? '-' : Number(v).toFixed(n == null ? 2 : n).replace('.', ','); }
  // Zeitzone nach Datum: MEZ (UTC+1) bzw. MESZ (UTC+2); andere Zonen nur als UTC-Abstand
  function zoneText(d) {
    var off = -d.getTimezoneOffset(), v = off < 0 ? '-' : '+', a = Math.abs(off), utc = 'UTC' + v + p2(Math.floor(a / 60)) + ':' + p2(a % 60);
    return off === 60 ? 'MEZ, ' + utc : off === 120 ? 'MESZ, ' + utc : utc;
  }
  function rgbVonHex(h) { var m = /^#?([0-9a-f]{6})$/i.exec(h || ''); if (!m) return [60, 60, 60]; var n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

  /* ---------- SHA-256 (reine JS-Fassung, unabhängig vom sicheren Kontext) ---------- */
  var K256 = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  // nur für reinen ASCII-Text (der geprüfte Text wird vorher so umgeschrieben)
  N.sha256 = function (ascii) {
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], len = ascii.length, bytes = [];
    for (var i = 0; i < len; i++) bytes.push(ascii.charCodeAt(i) & 255);
    bytes.push(0x80); while (bytes.length % 64 !== 56) bytes.push(0);
    var bits = len * 8; bytes.push(0, 0, 0, 0, (bits >>> 24) & 255, (bits >>> 16) & 255, (bits >>> 8) & 255, bits & 255);
    var w = new Array(64);
    for (var o = 0; o < bytes.length; o += 64) {
      for (var t = 0; t < 16; t++) w[t] = (bytes[o + 4 * t] << 24) | (bytes[o + 4 * t + 1] << 16) | (bytes[o + 4 * t + 2] << 8) | bytes[o + 4 * t + 3];
      for (t = 16; t < 64; t++) {
        var s0 = ((w[t - 15] >>> 7) | (w[t - 15] << 25)) ^ ((w[t - 15] >>> 18) | (w[t - 15] << 14)) ^ (w[t - 15] >>> 3);
        var s1 = ((w[t - 2] >>> 17) | (w[t - 2] << 15)) ^ ((w[t - 2] >>> 19) | (w[t - 2] << 13)) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (t = 0; t < 64; t++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7)), ch = (e & f) ^ (~e & g), t1 = (hh + S1 + ch + K256[t] + w[t]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10)), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0; h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    return h.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  };
  // Der geprüfte Text: JSON des Modells, alles außerhalb ASCII als \uXXXX
  N.pruefText = function (modell) {
    return JSON.stringify(modell).replace(/[^\x20-\x7e]/g, function (c) { return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4); });
  };
  N.pruefnummer = function (modell) { return N.sha256(N.pruefText(modell)).slice(0, 16); };

  /* ---------- Rechnung ---------- */
  function ampelFuer(strBreite, bBreite, zu) {
    if (typeof strBreite === 'number' && isFinite(strBreite) && strBreite > 0) return bBreite < strBreite ? 0 : bBreite < strBreite + zu ? 1 : 2;
    return bBreite <= 3.5 ? 0 : bBreite <= 5 ? 1 : 2; // ohne Fahrzeugbreite: dieselben Grenzen wie die Karte
  }
  function abstandM(b, linien) {
    var p = [b.lat, b.lng], best = Infinity, dLon = 1 / Math.cos(b.lat * Math.PI / 180);
    linien.forEach(function (l) {
      for (var i = 1; i < l.length; i++) {
        var a = l[i - 1], c = l[i], rand = best === Infinity ? 5 : best / 111000 + 0.01; // Grad
        if (Math.min(a[0], c[0]) - rand > p[0] || Math.max(a[0], c[0]) + rand < p[0] || Math.min(a[1], c[1]) - rand * dLon > p[1] || Math.max(a[1], c[1]) + rand * dLon < p[1]) continue;
        var d = TK.geo.distSeg(p, a, c); if (d < best) best = d;
      }
      if (l.length === 1) { var d1 = TK.geo.dist(p, l[0]); if (d1 < best) best = d1; }
    });
    return best;
  }
  /* eingabe: {jetzt:Date, stand:ISO|null, standHinweis, testbetrieb, korridorKm, von:'JJJJ-MM-TT'|'', bis, abstand, baustellen:[{lat,lng,breite,beginn,ende,titel,info,beginnText,endeText}],
               baustellenRoh, strecken:[{id,farbe,eigen,name,antragsId,version,breite,gueltigVon,gueltigBis,von,nach,km,linien,ungefaehr}], korridorHinweis} */
  /* Gemeinsame Rechnung fuer Karte UND Nachweis: welche Baustelle trifft welche Strecke, mit welcher Ampel.
     Jede Strecke mit ihrem eigenen Korridor (volle Linien), ihrem eigenen Zeitraum und ihrer eigenen Breite. Ampel eines Punktes = ungünstigste über alle Strecken, die ihn treffen.
     Option e.ueberall: kein Korridor, nur das Zeitfenster der Oberfläche (e.von/e.bis) für alle Strecken (Auswahl "Überall" auf der Karte). */
  N.klassifiziere = function (e) {
    var zu = e.abstand == null ? 0.5 : e.abstand, km = e.korridorKm;
    var zeilen = [], eindeutig = {}, schlecht = {};
    // Zeitraum je Strecke: Bescheid = Gültigkeit, eigene Strecke = eingegebener Zeitraum; fehlt eine Seite, gilt dort das Zeitfenster der Oberfläche (e.von/e.bis)
    var fenster = e.strecken.map(function (s) {
      var gv = e.ueberall ? '' : s.gueltigVon, gb = e.ueberall ? '' : s.gueltigBis;
      var v = gv || e.von || '', b = gb || e.bis || '', eigene = !!(gv && gb);
      return { von: v ? new Date(v + 'T00:00:00') : null, bis: b ? new Date(b + 'T23:59:59') : null, text: (v || b) ? isoDe(v) + ' bis ' + isoDe(b) : 'ohne Einschraenkung',
        quelle: eigene ? (s.eigen ? 'eingegebener Zeitraum der Strecke' : 'Gueltigkeit des Bescheids') : 'Zeitfenster der Oberflaeche, da keine vollstaendige Gueltigkeit angegeben ist' };
    });
    e.strecken.forEach(function (s, si) {
      var von = fenster[si].von, bis = fenster[si].bis;
      e.baustellen.forEach(function (b, bi) {
        if (b.beginn && b.ende && von && bis && (b.beginn > bis || b.ende < von)) return;
        var d = e.ueberall ? 0 : abstandM(b, s.linien); if (!e.ueberall && !(d <= km * 1000)) return;
        var a = ampelFuer(s.breite, b.breite, zu);
        zeilen.push({ s: si, a: a, bi: bi, b: b, d: d });
        if (schlecht[bi] == null || a < schlecht[bi]) schlecht[bi] = a;
        eindeutig[bi] = true;
      });
    });
    return { zeilen: zeilen, eindeutig: eindeutig, schlecht: schlecht, fenster: fenster, zu: zu };
  };
  N.ampelText = function (a) { return AMPEL[a]; };
  N.rechne = function (e) {
    var zu = e.abstand == null ? 0.5 : e.abstand, km = e.korridorKm;
    var k = N.klassifiziere(e), zeilen = k.zeilen, eindeutig = k.eindeutig, schlecht = k.schlecht, fenster = k.fenster;
    zeilen.sort(function (x, y) { return x.s - y.s || x.a - y.a || x.d - y.d || x.bi - y.bi; });
    var summe = [0, 0, 0]; Object.keys(schlecht).forEach(function (k) { summe[schlecht[k]]++; });
    var modell = {
      art: 'Baustellen-Nachweis', fassung: 1,
      abfrage: dDatum(e.jetzt) + ' ' + dUhr(e.jetzt, true), zone: zoneText(e.jetzt),
      stand: e.stand ? dDatum(new Date(e.stand)) + ' ' + dUhr(new Date(e.stand), true) : (e.standHinweis || 'nicht abrufbar'),
      testbetrieb: !!e.testbetrieb,
      korridorKm: km, korridorHinweis: e.korridorHinweis || '',
      zeitraum: 'je Strecke ihre Gueltigkeit (siehe Strecke)',
      sicherheitsabstandM: zu,
      baustellenGeprueft: e.baustellen.length, baustellenNichtPruefbar: Math.max(0, (e.baustellenRoh || e.baustellen.length) - e.baustellen.length),
      strecken: e.strecken.map(function (s, i) {
        return { nr: i + 1, name: s.name || '', vemags: s.eigen ? '' : (s.antragsId || ''), fassung: s.eigen ? '' : (s.version || ''), eigen: !!s.eigen, breiteM: s.breite == null ? null : s.breite,
          pruefZeitraum: fenster[i].text, zeitQuelle: fenster[i].quelle, gueltig: (s.gueltigVon || s.gueltigBis) ? isoDe(s.gueltigVon) + ' bis ' + isoDe(s.gueltigBis) : '', von: s.von || '', nach: s.nach || '', km: s.km == null ? null : s.km, ungefaehr: !!s.ungefaehr };
      }),
      anzahlBaustellen: Object.keys(eindeutig).length, zuEng: summe[0], knapp: summe[1], passt: summe[2],
      zeilen: zeilen.map(function (z) {
        return { strecke: z.s + 1, ampel: AMPEL[z.a].text, titel: z.b.titel, breiteM: z.b.breite, von: z.b.beginnText, bis: z.b.endeText, abstandKm: Math.round(z.d / 10) / 100, info: [z.b.info, z.b.link].filter(Boolean).join(' '), lat: z.b.lat, lng: z.b.lng };
      })
    };
    modell.pruefnummer = N.pruefnummer(modell); // Prüfnummer = SHA-256 über alles oben, erste 16 Zeichen
    return { modell: modell, zeilen: zeilen, schlecht: schlecht };
  };
  // Zum Nachrechnen: die Prüfnummer eines Modells ohne das Feld "pruefnummer"
  N.pruefnummerVon = function (modell) { var k = JSON.parse(JSON.stringify(modell)); delete k.pruefnummer; return N.pruefnummer(k); };

  /* ---------- Kartenbild aus OSM-Kacheln ---------- */
  function mercX(lng, z) { return (lng + 180) / 360 * Math.pow(2, z) * 256; }
  function mercY(lat, z) { var s = Math.sin(lat * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * Math.pow(2, z) * 256; }
  function ladeBild(url) {
    return new Promise(function (ok) {
      var im = new Image(); im.crossOrigin = 'anonymous';
      var t = setTimeout(function () { ok(null); }, 15000);
      im.onload = function () { clearTimeout(t); ok(im); };
      im.onerror = function () { clearTimeout(t); ok(null); };
      im.src = url;
    });
  }
  // liefert {dataUrl, fehlteKacheln, breite, hoehe}
  N.kartenbild = async function (e, ergebnis, W, H) {
    var s = 90, n = -90, w = 180, o = -180, hat = false;
    e.strecken.forEach(function (st) { st.linien.forEach(function (l) { l.forEach(function (c) { hat = true; if (c[0] < s) s = c[0]; if (c[0] > n) n = c[0]; if (c[1] < w) w = c[1]; if (c[1] > o) o = c[1]; }); }); });
    if (!hat) { s = 47; n = 55; w = 6; o = 15; }
    var z = 17; // größte Zoomstufe, bei der alles mit Rand ins Bild passt
    for (; z > 3; z--) { if ((mercX(o, z) - mercX(w, z)) <= W * 0.88 && (mercY(s, z) - mercY(n, z)) <= H * 0.88) break; }
    var cx = (mercX(w, z) + mercX(o, z)) / 2, cy = (mercY(s, z) + mercY(n, z)) / 2, x0 = cx - W / 2, y0 = cy - H / 2;
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H; var g = cv.getContext('2d');
    g.fillStyle = '#e9ecef'; g.fillRect(0, 0, W, H);
    var tx0 = Math.floor(x0 / 256), tx1 = Math.floor((x0 + W) / 256), ty0 = Math.floor(y0 / 256), ty1 = Math.floor((y0 + H) / 256), maxT = Math.pow(2, z), jobs = [];
    for (var ty = ty0; ty <= ty1; ty++) for (var tx = tx0; tx <= tx1; tx++) {
      if (ty < 0 || ty >= maxT) continue;
      var txw = ((tx % maxT) + maxT) % maxT;
      jobs.push({ tx: tx, ty: ty, url: (e.kacheln || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png').replace('{z}', z).replace('{x}', txw).replace('{y}', ty) });
    }
    var fehl = 0;
    await Promise.all(jobs.map(function (j) { return ladeBild(j.url).then(function (im) { if (im) g.drawImage(im, j.tx * 256 - x0, j.ty * 256 - y0); else fehl++; }); }));
    var px = function (c) { return [mercX(c[1], z) - x0, mercY(c[0], z) - y0]; };
    function linie(l, farbe, breite) { if (l.length < 2) return; g.beginPath(); l.forEach(function (c, i) { var p = px(c); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.strokeStyle = farbe; g.lineWidth = breite; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke(); }
    e.strecken.forEach(function (st) { st.linien.forEach(function (l) { linie(l, 'rgba(255,255,255,.95)', 11); }); });
    e.strecken.forEach(function (st) { st.linien.forEach(function (l) { linie(l, st.farbe, 6); }); });
    // Streckennummer an der Mitte der längsten Linie
    g.font = 'bold 22px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    e.strecken.forEach(function (st, i) {
      var best = null; st.linien.forEach(function (l) { if (l.length > 1 && (!best || l.length > best.length)) best = l; });
      if (!best) return; var p = px(best[Math.floor(best.length / 2)]);
      g.beginPath(); g.arc(p[0], p[1], 17, 0, 6.2832); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 4; g.strokeStyle = st.farbe; g.stroke(); g.fillStyle = '#111'; g.fillText(String(i + 1), p[0], p[1] + 1);
    });
    // Baustellen als Ampelpunkte (schlechteste Ampel über alle Strecken)
    Object.keys(ergebnis.schlecht).forEach(function (bi) {
      var b = e.baustellen[bi], p = px([b.lat, b.lng]);
      g.beginPath(); g.arc(p[0], p[1], 11, 0, 6.2832); g.fillStyle = AMPEL[ergebnis.schlecht[bi]].farbe; g.fill(); g.lineWidth = 3.5; g.strokeStyle = '#fff'; g.stroke();
    });
    g.font = '15px Arial, Helvetica, sans-serif'; g.textAlign = 'right'; g.textBaseline = 'alphabetic';
    var hin = e.kachelnHinweis || '© OpenStreetMap-Mitwirkende', br = g.measureText(hin).width + 14;
    g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(W - br, H - 24, br, 24); g.fillStyle = '#222'; g.fillText(hin, W - 7, H - 7);
    return { dataUrl: cv.toDataURL('image/jpeg', 0.88), fehlteKacheln: fehl, kacheln: jobs.length, zoom: z };
  };

  /* ---------- PDF ---------- */
  var libGeladen = null;
  N.ladeBibliothek = function (basis) {
    if (root.jspdf && root.jspdf.jsPDF) return Promise.resolve();
    if (libGeladen) return libGeladen;
    libGeladen = new Promise(function (ok, fail) {
      var sc = document.createElement('script'); sc.src = (basis || 'lib/') + 'jspdf.umd.min.js?v=2.5.1';
      sc.onload = function () { ok(); }; sc.onerror = function () { libGeladen = null; fail(new Error('PDF-Baustein nicht ladbar')); };
      document.head.appendChild(sc);
    });
    return libGeladen;
  };
  N.dateiname = function (d) { return 'Baustellen-Nachweis_' + d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + '_' + p2(d.getHours()) + p2(d.getMinutes()) + '.pdf'; };

  var SEITE_B = 297, SEITE_H = 210, RAND = 10, KOPF = 14, FUSS_Y = 201, UNTEN = 196;
  var TEXT = [30, 30, 30], GRAU = [105, 105, 105], LINIE = [190, 190, 190];

  N.baueDokument = async function (e, ergebnis, karte) {
    var JS = root.jspdf.jsPDF, doc = new JS({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true }), m = ergebnis.modell, y = 0;
    var hatKarte = !!karte;
    doc.setProperties({ title: m.art + ' ' + m.abfrage, subject: 'Pruefnummer ' + m.pruefnummer, keywords: N.pruefText(Object.assign({}, m, { pruefnummer: undefined })), creator: 'Transportkarte' });
    function farbeText(c) { doc.setTextColor(c[0], c[1], c[2]); }
    function schrift(art, pt, c) { doc.setFont('helvetica', art); doc.setFontSize(pt); farbeText(c || TEXT); }
    function neueSeite() { doc.addPage('a4', 'landscape'); y = KOPF + 4; }
    function platz(h) { if (y + h > UNTEN) { neueSeite(); return true; } return false; }
    function zeilen(text, breite, pt) { doc.setFontSize(pt); return doc.splitTextToSize(String(text), breite); }
    var BREITE = SEITE_B - 2 * RAND;

    /* ---- Seite 1: Kopf ---- */
    y = RAND + 7;
    schrift('bold', 22); doc.text('Baustellen-Nachweis', RAND, y);
    y += 3; doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.4); doc.line(RAND, y, SEITE_B - RAND, y); y += 7;
    if (m.testbetrieb) {
      doc.setDrawColor(197, 34, 31); doc.setLineWidth(0.8); doc.rect(RAND, y - 5, BREITE, 11);
      schrift('bold', 14, [197, 34, 31]); doc.text('Testdaten – kein Nachweis. Die Baustellen in diesem Beleg sind erfunden.', RAND + 3, y + 2.3); y += 12;
    }
    function feld(label, wert, pt) {
      schrift('bold', pt || 11.5, GRAU); doc.text(label, RAND, y);
      schrift('normal', pt || 11.5); var t = zeilen(wert, BREITE - 62, pt || 11.5); doc.text(t, RAND + 62, y); y += 5.6 * t.length + 0.6;
    }
    feld('Abgefragt am:', m.abfrage.replace(/^(\S+) (\S+)$/, '$1, $2 Uhr') + ' (Zeitzone ' + m.zone + ')');
    var standText = /^\d/.test(m.stand) ? m.stand.replace(/^(\S+) (\S+)$/, '$1, $2 Uhr') + ' (letzte Änderung der Baustellen-Datei)' : m.stand;
    feld('Stand der Baustellendaten:', standText);
    feld('Geprüfte Baustellen:', m.baustellenGeprueft + ' Baustellen in der Datei' + (m.baustellenNichtPruefbar ? ' (' + m.baustellenNichtPruefbar + ' weitere Einträge ohne Ort oder Breite konnten nicht geprüft werden)' : ''));
    y += 1.5;
    schrift('bold', 12); doc.text('Prüfeinstellungen', RAND, y); y += 5.8;
    var einst = 'Korridor: bis ' + zahlDe(m.korridorKm, m.korridorKm % 1 ? 1 : 0) + ' km an der Strecke' + (m.korridorHinweis ? ' (' + m.korridorHinweis + ')' : '') +
      '   |   Zeitraum: je Strecke ihre Gültigkeit (siehe Strecke)   |   Sicherheitsabstand: ' + zahlDe(m.sicherheitsabstandM, 1) + ' m';
    schrift('normal', 11.5); var et = zeilen(einst, BREITE, 11.5); doc.text(et, RAND, y); y += 5.6 * et.length + 3;
    schrift('bold', 12); doc.text('Ergebnis', RAND, y); y += 5.8;
    schrift('normal', 11.5);
    var erg = m.anzahlBaustellen === 0 ? 'An den gezeigten Strecken wurden 0 Baustellen gefunden.' :
      'An den gezeigten Strecken wurden ' + m.anzahlBaustellen + (m.anzahlBaustellen === 1 ? ' Baustelle' : ' Baustellen') + ' gefunden: ' + m.zuEng + ' zu eng, ' + m.knapp + ' knapp, ' + m.passt + ' passt.';
    var et2 = zeilen(erg, BREITE, 11.5); doc.text(et2, RAND, y); y += 5.6 * et2.length + 3;

    /* ---- Strecken ---- */
    schrift('bold', 12); platz(14); doc.text('Gezeigte Strecken (' + m.strecken.length + ')', RAND, y); y += 5;
    m.strecken.forEach(function (s, i) {
      var l1 = 'Strecke ' + s.nr + ': ' + (s.name || (s.eigen ? 'Eigene Strecke' : 'Bescheid'));
      var l2 = (s.eigen ? 'Eigene Strecke (ohne Bescheid)' : 'VEMAGS-Nr. ' + (s.vemags || '-') + (s.fassung ? ', Fassung ' + s.fassung : ', ohne Fassung')) +
        '   |   Fahrzeugbreite ' + (s.breiteM == null ? 'nicht angegeben' : zahlDe(s.breiteM, 2) + ' m') + '   |   ' + (s.gueltig ? 'Gültig ' + s.gueltig : 'Zeitraum nicht angegeben');
      var l3 = 'Von ' + (s.von || '-') + ' nach ' + (s.nach || '-') + (s.km != null ? '   |   ' + s.km + ' km' : '') + (s.ungefaehr ? '   |   Strecke nur ungefähr geladen' : '');
      var l4 = 'Geprüft für den Zeitraum ' + s.pruefZeitraum + ' (' + (s.zeitQuelle.indexOf('Oberfl') === 0 || s.zeitQuelle.indexOf('Zeitfenster') === 0 ? 'Zeitfenster der Oberfläche, da keine vollständige Gültigkeit angegeben ist' : s.eigen ? 'eingegebener Zeitraum der Strecke' : 'Gültigkeit des Bescheids') + ')';
      var t1 = zeilen(l1, BREITE - 8, 11.5), t2 = zeilen(l2, BREITE - 8, 10.5), t3 = zeilen(l3, BREITE - 8, 10.5), t4 = zeilen(l4, BREITE - 8, 10.5), h = 3 + 5.2 * t1.length + 4.8 * (t2.length + t3.length + t4.length) + 2;
      platz(h + 2);
      var rgb = rgbVonHex(e.strecken[i].farbe); doc.setFillColor(rgb[0], rgb[1], rgb[2]); doc.rect(RAND, y, 2.2, h, 'F');
      var yy = y + 5; schrift('bold', 11.5); doc.text(t1, RAND + 5, yy); yy += 5.2 * t1.length;
      schrift('normal', 10.5); doc.text(t2, RAND + 5, yy - 0.2); yy += 4.8 * t2.length; doc.text(t3, RAND + 5, yy - 0.2); yy += 4.8 * t3.length; doc.text(t4, RAND + 5, yy - 0.2);
      y += h + 2.5;
    });

    /* ---- Karte ---- */
    neueSeite(); schrift('bold', 14); doc.text('Karte der gezeigten Strecken und der Baustellen', RAND, y + 2); y += 6;
    var kw = BREITE, kh = kw * karte.hoehe / karte.breite;
    if (kh > UNTEN - y - 17) { kh = UNTEN - y - 17; kw = kh * karte.breite / karte.hoehe; }
    doc.addImage(karte.dataUrl, 'JPEG', RAND, y, kw, kh, undefined, 'FAST');
    doc.setDrawColor(130, 130, 130); doc.setLineWidth(0.3); doc.rect(RAND, y, kw, kh);
    y += kh + 5.5;
    // Zeichenerklärung
    var x = RAND; schrift('normal', 10);
    function gl(text, zeichne) { var br = doc.getTextWidth(text) + 11; if (x + br > SEITE_B - RAND) { x = RAND; y += 5.4; } zeichne(x, y); farbeText(TEXT); doc.text(text, x + 8, y); x += br + 4; }
    e.strecken.forEach(function (st, i) { gl('Strecke ' + (i + 1), function (px, py) { var c = rgbVonHex(st.farbe); doc.setDrawColor(c[0], c[1], c[2]); doc.setLineWidth(1.6); doc.line(px, py - 1.2, px + 6, py - 1.2); }); });
    AMPEL.forEach(function (a) { gl('Baustelle ' + a.text, function (px, py) { doc.setFillColor(a.rgb[0], a.rgb[1], a.rgb[2]); doc.circle(px + 3, py - 1.3, 1.6, 'F'); }); });
    y += 5.2; schrift('normal', 9.5, GRAU);
    doc.text('Die Farbe der Baustelle bezieht sich auf die Fahrzeugbreite der jeweiligen Strecke (bei mehreren Strecken: die engste Lage).   ' + (e.kachelnHinweis || '© OpenStreetMap-Mitwirkende'), RAND, y);
    if (karte.fehlteKacheln) { y += 4.6; farbeText([197, 34, 31]); doc.text('Hinweis: ' + karte.fehlteKacheln + ' von ' + karte.kacheln + ' Kartenkacheln konnten nicht geladen werden; der Hintergrund ist dort grau.', RAND, y); }

    /* ---- Tabelle ---- */
    neueSeite();
    schrift('bold', 14); doc.text('Baustellen an den gezeigten Strecken', RAND, y + 2); y += 8;
    if (!m.zeilen.length) {
      schrift('bold', 22, TEXT); var kt = zeilen('Keine Baustellen an den gezeigten Strecken gefunden.', BREITE, 22); doc.text(kt, RAND, y + 8); y += 9 * kt.length + 8;
      schrift('normal', 12); doc.text('Stand der Baustellendaten: ' + (/^\d/.test(m.stand) ? m.stand.replace(/^(\S+) (\S+)$/, '$1, $2 Uhr') : m.stand), RAND, y); y += 6.4;
      doc.text('Korridor: bis ' + zahlDe(m.korridorKm, m.korridorKm % 1 ? 1 : 0) + ' km an der Strecke   |   Zeitraum: ' + m.zeitraum + '   |   ' + m.baustellenGeprueft + ' Baustellen geprüft', RAND, y); y += 6.4;
    } else {
      var sp = [{ t: 'Strecke-Nr.', b: 21 }, { t: 'Ampel', b: 25 }, { t: 'Bezeichnung', b: 57 }, { t: 'Durchfahrt', b: 24 }, { t: 'Zeitraum', b: 44 }, { t: 'Abstand', b: 22 }, { t: 'Ort / Info', b: 84 }];
      var xs = []; var xa = RAND; sp.forEach(function (c) { xs.push(xa); xa += c.b; });
      var kopfZeile = function () {
        schrift('bold', 10, GRAU); sp.forEach(function (c, i) { doc.text(c.t, xs[i] + 1, y); });
        y += 1.8; doc.setDrawColor(120, 120, 120); doc.setLineWidth(0.4); doc.line(RAND, y, SEITE_B - RAND, y); y += 4.6;
      };
      kopfZeile();
      m.zeilen.forEach(function (z) {
        schrift('normal', 10);
        var tB = zeilen(z.titel, sp[2].b - 2, 10), tI = zeilen((z.info ? z.info + ' ' : '') + '(' + zahlDe(z.lat, 5) + '; ' + zahlDe(z.lng, 5) + ')', sp[6].b - 2, 10), zr = zeilen((z.von || '?') + ' bis ' + (z.bis || '?'), sp[4].b - 2, 10);
        var n = Math.max(tB.length, tI.length, zr.length), h = 4.6 * n + 2.2;
        if (y + h > UNTEN) { neueSeite(); kopfZeile(); }
        var a = AMPEL.filter(function (q) { return q.text === z.ampel; })[0];
        schrift('normal', 10); doc.text('Strecke ' + z.strecke, xs[0] + 1, y);
        doc.setFillColor(a.rgb[0], a.rgb[1], a.rgb[2]); doc.circle(xs[1] + 3, y - 1.2, 1.7, 'F'); schrift('bold', 10, a.rgb); doc.text(z.ampel, xs[1] + 6.6, y);
        schrift('normal', 10); doc.text(tB, xs[2] + 1, y); doc.text(zahlDe(z.breiteM, 2) + ' m', xs[3] + 1, y); doc.text(zr, xs[4] + 1, y);
        doc.text(zahlDe(z.abstandKm, 2) + ' km', xs[5] + 1, y); doc.text(tI, xs[6] + 1, y);
        y += h - 2.2 + 1; doc.setDrawColor(210, 210, 210); doc.setLineWidth(0.2); doc.line(RAND, y - 1.5, SEITE_B - RAND, y - 1.5); y += 1.2;
      });
      y += 2; schrift('normal', 9.5, GRAU); platz(6); doc.text(m.zeilen.length + ' Zeilen für ' + m.anzahlBaustellen + (m.anzahlBaustellen === 1 ? ' Baustelle' : ' verschiedene Baustellen') + ' (eine Baustelle erscheint je Strecke, an der sie liegt). Sortiert nach Strecke, dann Ampel, dann Abstand.', RAND, y);
    }
    y += 8; platz(16); schrift('normal', 9.5, GRAU);
    var pt = zeilen('Prüfnummer ' + m.pruefnummer + ': Kennzahl (SHA-256, erste 16 Zeichen) über alle Angaben dieses Nachweises. Wird eine Angabe geändert, stimmt die Prüfnummer nicht mehr.', BREITE, 9.5); doc.text(pt, RAND, y);

    /* ---- Kopf- und Fußzeile auf jeder Seite ---- */
    var seiten = doc.getNumberOfPages();
    for (var i = 1; i <= seiten; i++) {
      doc.setPage(i);
      if (i > 1) { schrift('normal', 9.5, GRAU); doc.text('Baustellen-Nachweis, abgefragt am ' + m.abfrage.replace(/^(\S+) (\S+)$/, '$1, $2 Uhr'), RAND, RAND + 2); }
      if (m.testbetrieb) { schrift('bold', 10, [197, 34, 31]); doc.text('Testdaten – kein Nachweis', SEITE_B - RAND, RAND + 2, { align: 'right' }); }
      doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.3); doc.line(RAND, FUSS_Y, SEITE_B - RAND, FUSS_Y);
      schrift('normal', 9.5, GRAU);
      doc.text('Seite ' + i + ' von ' + seiten, RAND, FUSS_Y + 5);
      doc.text('Abgefragt am ' + m.abfrage.replace(/^(\S+) (\S+)$/, '$1, $2 Uhr') + '   |   Daten ohne Gewähr', SEITE_B / 2, FUSS_Y + 5, { align: 'center' });
      doc.text('Prüfnummer: ' + m.pruefnummer, SEITE_B - RAND, FUSS_Y + 5, { align: 'right' });
    }
    return doc;
  };

  // Gesamtablauf: rechnen, Karte, PDF bauen, herunterladen (kein Druckdialog)
  N.erstelle = async function (e, optionen) {
    optionen = optionen || {};
    await N.ladeBibliothek(optionen.libBasis);
    var erg = N.rechne(e), karte = await N.kartenbild(e, erg, 1500, 800);
    karte.breite = 1500; karte.hoehe = 800;
    var doc = await N.baueDokument(e, erg, karte), name = N.dateiname(e.jetzt);
    if (optionen.nurBauen) return { doc: doc, name: name, modell: erg.modell, karte: karte };
    doc.save(name);
    return { name: name, modell: erg.modell, karte: { fehlteKacheln: karte.fehlteKacheln, kacheln: karte.kacheln, zoom: karte.zoom } };
  };

  TK.nachweis = N;
})(typeof window !== 'undefined' ? window : globalThis);
