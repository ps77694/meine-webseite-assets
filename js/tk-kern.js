/* Transportkarte – Kern: Bescheid lesen, Streckentext zerlegen, Prüfungen.
   Reine Funktionen, laufen im Browser und in Node (Tests). Keine Abhängigkeiten.
   2026. */
(function (root) {
  'use strict';
  var TK = root.TK = root.TK || {};

  /* ---------- 1. Kleiner XML-Leser (ohne Bibliothek) ---------- */
  function entities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, function (m, e) {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
    });
  }
  function parseXml(text) {
    var rootEl = { tag: '#root', kids: [], text: '' }, stack = [rootEl], i = 0, n = text.length;
    while (i < n) {
      var lt = text.indexOf('<', i);
      if (lt < 0) lt = n;
      if (lt > i) stack[stack.length - 1].text += entities(text.slice(i, lt));
      if (lt >= n) break;
      if (text.startsWith('<!--', lt)) { i = text.indexOf('-->', lt) + 3; continue; }
      if (text.startsWith('<![CDATA[', lt)) { var ce = text.indexOf(']]>', lt); stack[stack.length - 1].text += text.slice(lt + 9, ce); i = ce + 3; continue; }
      if (text[lt + 1] === '?' || text[lt + 1] === '!') { i = text.indexOf('>', lt) + 1; continue; }
      var gt = text.indexOf('>', lt);
      var inner = text.slice(lt + 1, gt);
      if (inner[0] === '/') { if (stack.length > 1) stack.pop(); i = gt + 1; continue; }
      var self = inner[inner.length - 1] === '/';
      var name = inner.replace(/\/$/, '').trim().split(/\s+/)[0];
      var el = { tag: name.split(':').pop(), kids: [], text: '' };
      stack[stack.length - 1].kids.push(el);
      if (!self) stack.push(el);
      i = gt + 1;
    }
    return rootEl;
  }
  // Pfad-Suche: q(el, 'A/B/C') -> Liste
  function q(el, path) {
    var cur = [el];
    path.split('/').forEach(function (p) {
      var nxt = [];
      cur.forEach(function (c) { c.kids.forEach(function (k) { if (k.tag === p) nxt.push(k); }); });
      cur = nxt;
    });
    return cur;
  }
  function t1(el, path) { var r = q(el, path); return r.length ? r[0].text.trim() : ''; }
  function deep(el, tag) { var out = []; (function w(e) { e.kids.forEach(function (k) { if (k.tag === tag) out.push(k); w(k); }); })(el); return out; }
  function num(s) { var v = parseFloat(String(s || '').replace(',', '.')); return isNaN(v) ? null : v; }

  /* ---------- 2. Bescheid aus XML ---------- */
  TK.leseBescheid = function (xmlText) {
    var doc = parseXml(xmlText);
    var top = deep(doc, 'BescheidAsXML')[0];
    if (!top) throw new Error('Kein VEMAGS-Bescheid (BescheidAsXML fehlt)');
    var antrag = deep(top, 'AntragDetailXML')[0];
    var bes = deep(top, 'BescheidXML')[0];
    if (!antrag) throw new Error('AntragDetailXML fehlt');
    function geo(g) {
      if (!g) return null;
      return {
        strasse: t1(g, 'Adresse/Strasse'), hausnummer: t1(g, 'Adresse/Hausnummer'),
        plz: t1(g, 'Adresse/Postleitzahl'), ort: t1(g, 'Adresse/Ort'),
        beschreibung: t1(g, 'Ortsbeschreibung'),
        lat: num(t1(g, 'GeoKoordinate/Breite') || t1(g, 'GeoKoordinate/Latitude')),
        lon: num(t1(g, 'GeoKoordinate/Laenge') || t1(g, 'GeoKoordinate/Longitude'))
      };
    }
    var teile = [];
    q(antrag, 'Fahrtwege').forEach(function (fw, fwi) {
      var fwPos = num(t1(fw, 'Position')); if (fwPos === null) fwPos = fwi;
      q(fw, 'Fahrtwegteile').forEach(function (ft, fti) {
        var pos = num(t1(ft, 'Position')); if (pos === null) pos = fti;
        var segs = q(ft, 'FahrtwegSegmente').map(function (s) { return { pos: num(t1(s, 'Position')) || 0, text: t1(s, 'Beschreibung') }; })
          .sort(function (a, b) { return a.pos - b.pos; });
        teile.push({
          fahrtweg: fwPos, pos: pos, zuordnung: (fwPos + 1) + '.' + (pos + 1),
          lastfahrt: t1(ft, 'Lastfahrt') === 'true',
          start: geo(q(ft, 'StartGeoPunkt')[0]), ziel: geo(q(ft, 'ZielGeoPunkt')[0]),
          segmente: segs.map(function (s) { return s.text; }).filter(Boolean),
          routing: t1(ft, 'Routingversion'), quelle: t1(ft, 'Quelle/Quelle')
        });
      });
    });
    teile.sort(function (a, b) { return a.fahrtweg - b.fahrtweg || a.pos - b.pos; });
    var auflagen = [];
    deep(top, 'StellungnahmeStreckenAuflagenXML').forEach(function (st) {
      var land = t1(st, 'Bundesland'), beh = t1(st, 'Behoerde');
      q(st, 'StreckenauflageXML').forEach(function (a) {
        auflagen.push({
          land: land, behoerde: beh, zuordnung: t1(a, 'FahrtwegteilZuordnung'), strasse: t1(a, 'Strasse'),
          bauwerk: t1(a, 'Bauwerksnummer'), nkVon: t1(a, 'NetzknotenVon'), nkNach: t1(a, 'NetzknotenNach'),
          kmVon: num(t1(a, 'KM_von')), kmBis: num(t1(a, 'KM_bis')), art: t1(a, 'Widerstandsart'), hinweis: t1(a, 'Hinweis')
        });
      });
    });
    var gv = bes ? t1(bes, 'Geltungsdauer/Von') : '', gb = bes ? t1(bes, 'Geltungsdauer/Bis') : '';
    if (!gv) gv = t1(antrag, 'Geltungsdauer/Von');
    if (!gb) gb = t1(antrag, 'Geltungsdauer/Bis');
    var bLad = num(t1(antrag, 'Ladung/Breite')), bLast = num(t1(antrag, 'Lastfahrt/Abmessung/Breite'));
    var aid = (bes && t1(bes, 'Bescheidversion/AntragsID')) || t1(antrag, 'Antragsversion/AntragsID');
    var ver = (bes && t1(bes, 'Bescheidversion/Versionsnummer')) || '';
    var kz = q(antrag, 'Fahrzeugkonfiguration/FahrzeugZulassungen').map(function (z) { return t1(z, 'Kennzeichen'); }).filter(Boolean);
    return {
      id: aid + (ver ? '_B' + ver : ''), antragsId: aid, version: ver,
      art: bes ? t1(bes, 'Bescheidart') : '', behoerde: bes ? t1(bes, 'EGB') : '',
      antragsteller: t1(top, 'AntragXML/AntragStellerXML/Kurzname'),
      gueltigVon: gv, gueltigBis: gb,
      ladung: { text: t1(antrag, 'Ladung/Beschreibung'), breite: bLad, laenge: num(t1(antrag, 'Ladung/Laenge')), hoehe: num(t1(antrag, 'Ladung/Hoehe')), masse: num(t1(antrag, 'Ladung/Masse')) },
      lastfahrt: { breite: bLast, laenge: num(t1(antrag, 'Lastfahrt/Abmessung/Laenge')), hoehe: num(t1(antrag, 'Lastfahrt/Abmessung/Hoehe')), gewicht: num(t1(antrag, 'Lastfahrt/GesamtGewicht')) },
      breite: Math.max(bLad || 0, bLast || 0) || null,
      kennzeichen: kz, fahrten: num(t1(antrag, 'AnzahlFahrten')),
      teile: teile, auflagen: auflagen
    };
  };

  /* ---------- 3. Geometrie-Helfer ---------- */
  var R = 6371008.8, rad = Math.PI / 180;
  function dist(a, b) { // [lat,lon] -> Meter
    var dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  // Abstand Punkt zu Strecke (Meter), lokale Ebene
  function distSeg(p, a, b) {
    var k = Math.cos(p[0] * rad), x = (p[1] - a[1]) * k, y = p[0] - a[0], dx = (b[1] - a[1]) * k, dy = b[0] - a[0];
    var l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, (x * dx + y * dy) / l2)) : 0;
    var ex = x - t * dx, ey = y - t * dy;
    return Math.sqrt(ex * ex + ey * ey) * 111194.9;
  }
  function distLine(p, line) { var m = Infinity; for (var i = 1; i < line.length; i++) { var d = distSeg(p, line[i - 1], line[i]); if (d < m) m = d; } if (line.length === 1) m = dist(p, line[0]); return m; }
  function lineLen(line) { var s = 0; for (var i = 1; i < line.length; i++) s += dist(line[i - 1], line[i]); return s; }
  // Peilung in Grad (0 = Nord, im Uhrzeigersinn)
  TK.peilung = function (a, b) { var y = Math.sin((b[1] - a[1]) * rad) * Math.cos(b[0] * rad), x = Math.cos(a[0] * rad) * Math.sin(b[0] * rad) - Math.sin(a[0] * rad) * Math.cos(b[0] * rad) * Math.cos((b[1] - a[1]) * rad); return (Math.atan2(y, x) / rad + 360) % 360; };
  TK.geo = { dist: dist, distSeg: distSeg, distLine: distLine, lineLen: lineLen };

  // Vereinfachen (Douglas-Peucker, Toleranz in Metern)
  TK.vereinfache = function (line, tol) {
    if (line.length < 3) return line.slice();
    var keep = new Uint8Array(line.length); keep[0] = keep[line.length - 1] = 1;
    var st = [[0, line.length - 1]];
    while (st.length) {
      var se = st.pop(), a = se[0], b = se[1], mx = -1, mi = -1;
      for (var i = a + 1; i < b; i++) { var d = distSeg(line[i], line[a], line[b]); if (d > mx) { mx = d; mi = i; } }
      if (mx > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
    }
    return line.filter(function (_, i) { return keep[i]; });
  };

  /* ---------- 4. Koordinaten aus Text ---------- */
  TK.koordAusText = function (s) {
    if (!s) return null;
    var m = s.match(/(\d{1,2})\s*°\s*(\d{1,2})\s*['′´]\s*([\d.,]+)\s*(?:"|''|″)?\s*([NS])[\s,;]+(\d{1,3})\s*°\s*(\d{1,2})\s*['′´]\s*([\d.,]+)\s*(?:"|''|″)?\s*([EOW])/i);
    if (m) {
      var la = +m[1] + m[2] / 60 + num(m[3]) / 3600, lo = +m[5] + m[6] / 60 + num(m[7]) / 3600;
      if (/S/i.test(m[4])) la = -la; if (/W/i.test(m[8])) lo = -lo;
      return [la, lo];
    }
    m = s.match(/\b(4[7-9]|5[0-5])[.,](\d{3,})\s*[,;/ ]\s*(\d{1,2})[.,](\d{3,})\b/);
    if (m) { var a = +(m[1] + '.' + m[2]), b = +(m[3] + '.' + m[4]); if (b > 5 && b < 16) return [a, b]; }
    return null;
  };

  /* ---------- 5. Streckentext zerlegen ---------- */
  var STR_SUFFIX = /(str\.?|straße|strasse|weg|ring|allee|platz|damm|kai|chaussee|gasse|ufer|steig|pfad|wall|markt|brücke|bruecke|tor|feld|hof|kamp)$/i;
  var STR_PREFIX = /^(am|an der|an den|an dem|im|in der|in den|zum|zur|auf dem|auf der|hinter dem|unter den|alte|alter|altes|neue|neuer|große|großer|kleine|kleiner)\s+\S/i;
  var NOISE = /\b(kv|kreisverkehr|ausfahrt|wp|windpark|zufahrt|ausfahrt|wenden|gv|gegenverkehr|baustelle|ol|ortslage|fr|fahrtrichtung|ziel|normalverkehr|wirtschaftsweg\w*|zubringer|übergang|uebergang|ende|betriebshof|lagerplatz|gmbh|kg|anlagenstandort\w*|analgenstandort\w*|befahren|durch|richtung|abfahrt|auffahrt|einfahrt|geradeaus|links|rechts|li|re|bis|nach|von|über|ueber|via|auf|zur|zum|in|im|den|der|die|das|ast|spur|fahrstreifen|innerhalb|außerhalb|nutzung)\b/gi;

  function normRef(s) { var m = String(s).toUpperCase().replace(/\s+/g, '').match(/^([ABLKS]|ST)(\d{1,4}[A-Z]?)$/); return m ? m[1] + m[2] : null; }
  TK.normRef = normRef;
  function refsIn(s) {
    var out = [], re = /(?:^|[^\wäöüÄÖÜß])((?:A|B|L|K|St)\s?\d{1,4}[a-z]?)(?![\w])/g, m;
    while ((m = re.exec(s))) { var r = normRef(m[1]); if (r && out.indexOf(r) < 0) out.push(r); }
    return out;
  }
  var JUNC_RE = /^(AS|AK|AD|Anschlussstelle|Autobahnkreuz|Autobahndreieck|Kreuz|Dreieck|Kr\.|Dr\.)\s+(.+)$/i;
  var JUNC_SUFFIX_RE = /^(.+?)\s+(Kreuz|Dreieck)$/i;

  function stripManeuver(s) {
    return s.replace(/^\s*(re\.?|li\.?|rechts|links|geradeaus|weiter|dann|anschließend)\s+(?=\S)/i, '')
      .replace(/^\s*(auf|in|Auf|In)\s+(?=\S)/, '')
      .replace(/^\s*(re\.?|li\.?|rechts|links|geradeaus)\s+(?=\S)/i, '').trim();
  }
  function streetName(s) {
    // Nimmt einen Rest-Text und liefert einen Straßennamen oder null
    s = s.replace(/\b(A|B|L|K|St)\s?\d{1,4}[a-z]?\b/g, ' ').replace(/[(){}]/g, ' ').replace(/\s+/g, ' ').trim();
    s = s.replace(/^[,/;:.\s]+|[,/;:\s]+$/g, '');
    if (!s || s.length < 4) return null;
    if (/\d{5}|gmbh|& co|\bkg\b/i.test(s)) return null;
    var words = s.split(' ');
    if (words.length > 4) return null;
    if (!/^[A-ZÄÖÜ]/.test(s)) return null;
    if (STR_SUFFIX.test(s) || STR_PREFIX.test(s)) {
      // Rauschwörter am Anfang weg ("WP Zufahrt" ist keine Straße)
      if (/^(WP|KV|OL|FR|GV)\b/.test(s)) return null;
      if (/^(Zufahrt|Ausfahrt|Einfahrt|Wirtschaftsweg|Wirtschaftswege|Betriebshof)\b/i.test(s)) return null;
      return s;
    }
    return null;
  }

  // Liefert geordnete Liste von Elementen: {art:'knoten', typ:'A|K|D', name} | {art:'strasse', refs:[], name, autobahn:bool}
  TK.zerlegeStrecke = function (segmente) {
    var items = [], roh = [];
    segmente.forEach(function (seg, si) {
      var teile = seg.replace(/[–—]/g, ' – ').split(/\s+[–-]\s*|\s*[–-]\s+|\s*[;|]\s*/);
      teile.forEach(function (p) { if (p && p.trim()) roh.push({ text: p.trim(), seg: si }); });
    });
    roh.forEach(function (r) {
      var p = stripManeuver(r.text);
      // Unterteilen an Verbindungswörtern (klein geschrieben)
      var sub = p.split(/\s+(?:auf|via|zur|zum|über|ueber|in)\s+(?=(?:[ABLK]\s?\d|St\s?\d|AS\b|AK\b|AD\b|[A-ZÄÖÜ]))|\s+(?:re\.|li\.|Re\.|Li\.|rechts|links|geradeaus)\s+/);
      sub.forEach(function (s0) {
        var s = stripManeuver(s0).replace(/\bFR\s+\S+(\s+\S+)?$/, '').replace(/\bin\s+FR\s+.*$/i, '').trim();
        if (!s) return;
        var jm = s.match(JUNC_RE), js = s.match(JUNC_SUFFIX_RE);
        if (jm || (js && !/str|weg/i.test(js[1]))) {
          var typWort = jm ? jm[1].toLowerCase() : js[2].toLowerCase();
          var typ = /^(ak|autobahnkreuz|kreuz|kr\.)$/.test(typWort) ? 'K' : /^(ad|autobahndreieck|dreieck|dr\.)$/.test(typWort) ? 'D' : 'A';
          var name = jm ? jm[2] : js[1];
          // Anhängsel abschneiden: "Musterstadt-Nord auf A1", "Beispielort-Süd geradeaus"
          name = name.replace(/\s+(auf|in|geradeaus|weiter|re\.?|li\.?|rechts|links|FR|Richtung|nach)\b.*$/i, '').replace(/\s+(A|B)\s?\d+.*$/, '').trim();
          if (name.length >= 3) items.push({ art: 'knoten', typ: typ, name: name, text: r.text, seg: r.seg });
          var rest = s.slice(s.indexOf(name) + name.length);
          refsIn(rest).forEach(function (rf) { items.push({ art: 'strasse', refs: [rf], name: null, autobahn: rf[0] === 'A', text: r.text, seg: r.seg }); });
          return;
        }
        var refs = refsIn(s);
        var nm = streetName(s.replace(NOISE, function (w, _g, off) { if (off === 0 && /^(Zum|Zur|Am|Im|An|In|Auf)$/.test(w)) return w; return /^[A-ZÄÖÜ]/.test(w) && w.length > 3 && !/^(Zufahrt|Ausfahrt|Wenden|Baustelle|Ziel|Zubringer|Übergang|Ende|Betriebshof|Lagerplatz|Wirtschaftsweg\w*|Normalverkehr|Gegenverkehr|Kreisverkehr|Ortslage|Fahrtrichtung|Richtung|Abfahrt|Auffahrt|Einfahrt|Innerhalb|Durch)$/i.test(w) ? w : ' '; }).replace(/\s+/g, ' ').trim());
        if (!refs.length && !nm) return;
        items.push({ art: 'strasse', refs: refs, name: nm, autobahn: refs.length > 0 && refs.every(function (x) { return x[0] === 'A'; }), text: r.text, seg: r.seg });
      });
    });
    // Aufeinanderfolgende gleiche Straßen zusammenfassen
    var out = [];
    items.forEach(function (it) {
      var prev = out[out.length - 1];
      if (prev && prev.art === 'strasse' && it.art === 'strasse') {
        var same = it.refs.some(function (x) { return prev.refs.indexOf(x) >= 0; }) || (it.name && prev.name && normName(it.name) === normName(prev.name));
        if (same) {
          it.refs.forEach(function (x) { if (prev.refs.indexOf(x) < 0) prev.refs.push(x); });
          if (!prev.name && it.name) prev.name = it.name;
          prev.autobahn = prev.autobahn && it.autobahn;
          return;
        }
      }
      if (prev && prev.art === 'knoten' && it.art === 'knoten' && normName(prev.name) === normName(it.name)) return;
      out.push(it);
    });
    return out;
  };

  /* ---------- 6. Namen vergleichen ---------- */
  function fold(s) {
    return String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function normName(s) {
    return fold(s).replace(/\bstr\b|\bstrasse\b/g, 'strasse').replace(/(\w)str\b/g, '$1strasse').replace(/(\w)strasse\b/g, '$1strasse').replace(/\s+/g, ' ');
  }
  TK.normName = normName;
  // Straßennamen-Vergleich: "Eicklinger Str." == "Eicklinger Straße"
  TK.gleicherStrassenname = function (a, b) {
    var x = normName(a).replace(/\s/g, ''), y = normName(b).replace(/\s/g, '');
    return !!x && x === y;
  };
  var ABK = { bs: 'braunschweig', h: 'hannover', hb: 'bremen', hh: 'hamburg', b: 'berlin', m: 'muenchen', k: 'koeln', f: 'frankfurt', d: 'duesseldorf', do: 'dortmund', e: 'essen', du: 'duisburg', bi: 'bielefeld', os: 'osnabrueck', ms: 'muenster', pb: 'paderborn', ol: 'oldenburg', hro: 'rostock', l: 'leipzig', dd: 'dresden', n: 'nuernberg', s: 'stuttgart', ka: 'karlsruhe', ma: 'mannheim', wob: 'wolfsburg', ce: 'celle', hi: 'hildesheim', ki: 'kiel', hl: 'luebeck', md: 'magdeburg', ef: 'erfurt', kas: 'kassel', ks: 'kassel', ge: 'gelsenkirchen', bo: 'bochum', wu: 'wuppertal', mg: 'moenchengladbach', ac: 'aachen', bn: 'bonn', ko: 'koblenz', wi: 'wiesbaden', mz: 'mainz', da: 'darmstadt', wue: 'wuerzburg', r: 'regensburg', a: 'augsburg', ul: 'ulm', fr: 'freiburg', sb: 'saarbruecken', og: 'offenburg', hst: 'stralsund', sn: 'schwerin', c: 'chemnitz', z: 'zwickau', hal: 'halle', j: 'jena', g: 'gera', ol2: 'oldenburg' };
  var TYPW = { kreuz: 'K', dreieck: 'D', ak: 'K', ad: 'D', as: 'A', autobahnkreuz: 'K', autobahndreieck: 'D', anschlussstelle: 'A' };
  function stem(w) { return w.replace(/(er|en|e|s)$/, ''); }
  function tokJ(s) {
    var f = fold(s).split(' ').filter(Boolean), typ = null, toks = [];
    f.forEach(function (w, i) {
      if (TYPW[w]) { if (TYPW[w] !== 'A' || i === 0) typ = typ || TYPW[w]; return; }
      if (w === 'bad' || w === 'an' || w === 'der' || w === 'am' || w === 'i' || w === 'h' && i > 0) return;
      if (i === 0 && ABK[w]) w = ABK[w];
      else if (ABK[w] && w.length <= 3 && i <= 1) w = ABK[w];
      toks.push(w);
    });
    return { typ: typ || 'A', toks: toks };
  }
  function tokEq(a, b) {
    if (a === b) return true;
    if (a.length >= 4 && b.length >= 4 && stem(a) === stem(b)) return true;
    if (a.length >= 5 && b.length >= 5 && (a.indexOf(b) === 0 || b.indexOf(a) === 0)) return true;
    return false;
  }
  TK.knotenAehnlich = function (vemagsName, vemagsTyp, osmName) {
    var A = tokJ(vemagsName), B = tokJ(osmName);
    if (!A.toks.length || !B.toks.length) return 0;
    var used = [], hit = 0;
    A.toks.forEach(function (a) { for (var j = 0; j < B.toks.length; j++) if (!used[j] && tokEq(a, B.toks[j])) { used[j] = 1; hit++; return; } });
    var s = 2 * hit / (A.toks.length + B.toks.length);
    var typ = vemagsTyp || A.typ;
    if (typ !== B.typ) s -= (typ === 'A' || B.typ === 'A') ? 0.3 : 0.15;
    return s;
  };
  // Kandidaten aus der Liste [name, [[lat,lon],...]]
  TK.sucheKnoten = function (liste, name, typ, max) {
    var c = [];
    for (var i = 0; i < liste.length; i++) {
      var sc = TK.knotenAehnlich(name, typ, liste[i][0]);
      if (sc >= 0.55) c.push({ name: liste[i][0], score: sc, punkte: liste[i][1] });
    }
    c.sort(function (a, b) { return b.score - a.score; });
    // Gleich benannte Knoten weit auseinander (z. B. zwei "Bielefeld") bleiben getrennt; Nahe zusammenfassen
    return c.slice(0, max || 8).map(function (k) {
      var la = 0, lo = 0; k.punkte.forEach(function (p) { la += p[0]; lo += p[1]; });
      k.mitte = [la / k.punkte.length, lo / k.punkte.length];
      return k;
    });
  };

  /* ---------- 7. TK25-Kartenblatt aus Netzknoten ---------- */
  // Netzknoten-Nummer: erste 4 Ziffern = TK25-Blatt (Zeile, Spalte). Blatt = 6' Breite x 10' Länge.
  TK.tk25Blatt = function (nk) {
    var m = String(nk || '').match(/^(\d{2})(\d{2})\d{3}[A-Z]?$/);
    if (!m) return null;
    var row = +m[1], col = +m[2];
    if (row < 1 || col < 1 || row > 99 || col > 99) return null;
    var top = 55.9 - (row - 1) * 0.1, left = 5 + 50 / 60 + (col - 1) / 6;
    return { blatt: m[1] + m[2], s: top - 0.1, n: top, w: left, o: left + 1 / 6 };
  };

  /* ---------- 8. Prüfung einer fertigen Route ---------- */
  // route: {coords:[[lat,lon]...], schritte:[{ref,name,dist}], legs:[{dist, von, nach}] }
  TK.pruefe = function (bescheid, teilIdx, items, route, extra) {
    extra = extra || {};
    var befunde = [], coords = route.coords;
    function add(stufe, text, ort) { befunde.push({ stufe: stufe, text: text, ort: ort || null }); }
    // a) Straßen aus dem Bescheid benutzt?
    var refsRoute = {}, namesRoute = [];
    route.schritte.forEach(function (s) {
      String(s.ref || '').split(/[;,/]/).forEach(function (r) { var n = normRef(r); if (n) refsRoute[n] = (refsRoute[n] || 0) + s.dist; });
      if (s.name) namesRoute.push(s.name);
    });
    var strassen = items.filter(function (i) { return i.art === 'strasse'; });
    // Meter je Straßenname auf der (fertigen, ggf. gekürzten) Strecke
    var namesMeter = {};
    route.schritte.forEach(function (s) { if (s.name) String(s.name).split(/[;,]/).forEach(function (x) { x = x.trim(); if (x) namesMeter[x] = (namesMeter[x] || 0) + s.dist; }); });
    function nameMeter(name) { var m = 0; Object.keys(namesMeter).forEach(function (n) { if (TK.gleicherStrassenname(n, name)) m += namesMeter[n]; }); return m; }
    var fehlend = [], kurz = [];
    strassen.forEach(function (it) {
      // Nummerierte Straße zählt erst ab 300 m als befahren, Straßenname ab 30 m (nur kurz berührt = Hinweis)
      var mRef = 0; it.refs.forEach(function (r) { mRef += refsRoute[r] || 0; });
      var mName = it.name ? nameMeter(it.name) : 0;
      var ok = it.refs.length ? (mRef >= 300 || mName >= 300) : mName >= 30;
      it.benutzt = ok; it.meter = Math.round(Math.max(mRef, mName));
      if (!ok && (mRef > 0 || mName > 0)) kurz.push(it); else if (!ok) fehlend.push(it);
    });
    function nm(i) { return (i.refs.join('/') + (i.name ? ' ' + i.name : '')).trim(); }
    var anteil = strassen.length ? (strassen.length - fehlend.length - kurz.length) / strassen.length : 1;
    if (fehlend.length) add(fehlend.length > 2 || anteil < 0.75 ? 'rot' : 'gelb', 'Im Bescheid genannt, aber nicht auf der berechneten Strecke: ' + fehlend.map(nm).join(', '));
    if (kurz.length) add('gelb', 'Im Bescheid genannt, aber nur kurz befahren: ' + kurz.map(function (i) { return nm(i) + ' (' + i.meter + ' m)'; }).join(', ') + '. Bitte prüfen.');
    if (!fehlend.length && !kurz.length && strassen.length) add('gruen', 'Alle ' + strassen.length + ' genannten Straßen liegen auf der Strecke.');
    // b) Nicht genannte nummerierte Straßen (Autobahn, Bundes-, Landes-, Kreisstraße) über 2 km
    var genannt = {}; strassen.forEach(function (i) { i.refs.forEach(function (r) { genannt[r] = 1; }); });
    var fremd = Object.keys(refsRoute).filter(function (r) { return !genannt[r] && refsRoute[r] > 2000; });
    if (fremd.length) add('gelb', 'Strecke nutzt Straßen, die im Bescheid nicht stehen: ' + fremd.map(function (r) { return r + ' (' + (refsRoute[r] / 1000).toFixed(1).replace('.', ',') + ' km)'; }).join(', ') + '. Bitte prüfen.');
    // c) Knoten (Anschlussstellen/Kreuze) passiert?
    var knoten = items.filter(function (i) { return i.art === 'knoten'; });
    var kFehl = knoten.filter(function (k) { return !k.gewaehlt || distLine(k.gewaehlt.mitte, coords) > 1500; });
    knoten.forEach(function (k) { k.passiert = kFehl.indexOf(k) < 0; });
    if (kFehl.length) add('rot', 'Anschlussstelle/Kreuz nicht gefunden oder nicht auf der Strecke: ' + kFehl.map(function (k) { return k.name; }).join(', '));
    else if (knoten.length) add('gruen', 'Alle ' + knoten.length + ' Anschlussstellen/Kreuze liegen auf der Strecke.');
    // d) Kartenblätter der Streckenauflagen (Netzknoten)
    var teil = bescheid.teile[teilIdx], blaetter = {}, nkGes = 0;
    bescheid.auflagen.forEach(function (a) {
      if (a.zuordnung !== teil.zuordnung) return;
      [a.nkVon, a.nkNach].forEach(function (nk) { var b = TK.tk25Blatt(nk); if (b) { blaetter[b.blatt] = b; nkGes++; } });
    });
    var bl = Object.keys(blaetter), blFehl = [];
    bl.forEach(function (k) {
      var b = blaetter[k], pad = 0.01, hit = false;
      for (var i = 0; i < coords.length && !hit; i++) { var c = coords[i]; if (c[0] >= b.s - pad && c[0] <= b.n + pad && c[1] >= b.w - pad && c[1] <= b.o + pad) hit = true; }
      if (!hit) blFehl.push(k);
    });
    if (bl.length) {
      if (blFehl.length) add(blFehl.length / bl.length > 0.2 ? 'rot' : 'gelb', 'Grobe Gegenprobe mit den Orten der Auflagen: ' + (bl.length - blFehl.length) + ' von ' + bl.length + ' Kartenausschnitten (je etwa 11 km groß) liegen an der Strecke.');
      else add('gruen', 'Grobe Gegenprobe mit den Orten der Auflagen: ' + (bl.length === 1 ? 'der Kartenausschnitt (etwa 11 km groß) liegt' : 'alle ' + bl.length + ' Kartenausschnitte (je etwa 11 km groß) liegen') + ' an der Strecke.');
    }
    // e) Umweg / Schleifen
    var lang = lineLen(coords), anker = (extra.anker && extra.anker.length > 1) ? extra.anker : [coords[0], coords[coords.length - 1]];
    var gerade = 0; for (var ai = 1; ai < anker.length; ai++) gerade += dist(anker[ai - 1], anker[ai]);
    // Vergleich mit der Luftlinie über alle Punkte aus dem Bescheid (Start, Kreuze, Kreuzungen, Ziel)
    if (gerade > 5000 && lang / gerade > 1.7) add('gelb', 'Die Strecke ist ' + (lang / gerade).toFixed(1).replace('.', ',') + '-mal so lang wie die Verbindung der Punkte aus dem Bescheid. Bitte auf Umwege prüfen.');
    var gvText = /gegenverkehr|\bGV\b|entgegen der fahrtrichtung/i.test(teil.segmente.join(' '));
    (route.gekuerzt || []).forEach(function (g) {
      if (g.art === 'runde') add('gelb', 'Hier fuhr die Berechnung eine Runde von ' + String(g.km).replace('.', ',') + ' km doppelt. Die zweite Runde wurde herausgeschnitten. Bitte kurz prüfen.', g.ort);
      else add('gelb', 'Hier fuhr die Berechnung ' + String(g.km).replace('.', ',') + ' km weiter und wendete. Die Wendeschleife wurde herausgeschnitten (vermutlich fehlt im Kartenmaterial eine Auffahrt' + (gvText ? ' oder der Bescheid erlaubt hier Gegenverkehr' : '') + '). Bitte kurz prüfen.', g.ort);
    });
    (route.schleifen || []).forEach(function (s) {
      add('gelb', 'Umweg: ' + s.text + '. Vermutlich fehlt hier im Kartenmaterial eine Auffahrt' + (gvText ? ' oder der Bescheid erlaubt eine Fahrt im Gegenverkehr' : '') + '. Bitte prüfen; mit „Strecke korrigieren“ lässt sich die Stelle als gerade Linie verbinden.', s.ort);
    });
    // f) Start/Ziel-Genauigkeit
    (extra.ungenau || []).forEach(function (u) { add('gelb', u.text, u.ort); });
    var stufe = befunde.some(function (b) { return b.stufe === 'rot'; }) ? 'rot' : befunde.some(function (b) { return b.stufe === 'gelb'; }) ? 'gelb' : 'gruen';
    return { stufe: stufe, befunde: befunde, laengeKm: Math.round(lang / 100) / 10, strassenAnteil: anteil, blaetter: bl.length, blaetterFehl: blFehl.length };
  };

  TK._intern = { parseXml: parseXml, fold: fold, tokJ: tokJ, refsIn: refsIn, streetName: streetName };
})(typeof window !== 'undefined' ? window : globalThis);
