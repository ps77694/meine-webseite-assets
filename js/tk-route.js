/* Transportkarte – Strecke rekonstruieren (Geocoding, OSM-Straßen, Routing, Prüfung).
   Dienste über Einstellungen austauschbar (OSRM-kompatibler Router, Nominatim, Overpass).
   2026. */
(function (root) {
  'use strict';
  var TK = root.TK = root.TK || {};
  var G = TK.geo;

  TK.standardDienste = {
    router: 'https://router.project-osrm.org/route/v1/driving/',
    nominatim: 'https://nominatim.openstreetmap.org/search',
    overpass: ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'],
    fetch: null // Standard: globales fetch
  };

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function F(d) { return d.fetch || root.fetch.bind(root); }

  /* ---------- Geocoding (Nominatim, max. 1 Anfrage/s) ---------- */
  var lastNom = 0;
  async function nominatim(d, params) {
    params = Object.assign({ limit: 3 }, params);
    var u = d.nominatim + '?format=jsonv2&countrycodes=de&' + Object.keys(params).filter(function (k) { return params[k]; }).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    var fehler = '';
    var zs = d.zwischenspeicher === false ? null : TK.zs;
    if (zs) { var gz = await zs.hole('adresse', u, ''); if (gz != null) { try { return JSON.parse(gz); } catch (e) { /* defekter Eintrag: neu holen */ } } }
    for (var v = 0; v < 4; v++) {
      var wait = (v ? 2500 * v : 1100) - (Date.now() - lastNom); if (wait > 0) await sleep(wait);
      lastNom = Date.now();
      try {
        var r = await F(d)(u);
        if (r.ok) { var nt = await r.text(), nj = JSON.parse(nt); if (zs && Array.isArray(nj) && nj.length) await zs.lege('adresse', u, '', nt); return nj; }
        fehler = 'HTTP ' + r.status;
      } catch (e) { fehler = e.message; } // z. B. kurzzeitig gesperrt (zu viele Anfragen)
    }
    throw new Error('Adresssuche nicht erreichbar (' + fehler + '). Bitte später noch einmal versuchen.');
  }
  function strassenAusText(s) {
    // z. B. "Lagerplatz Musterweg", "WP Beispielweg / Zufahrt über Dorfstr."
    var out = [];
    String(s || '').split(/[\/,;()]| über | via /).forEach(function (p) {
      p.trim().split(/\s+/).forEach(function (_, i, w) {
        for (var n = 1; n <= 3 && i + n <= w.length; n++) {
          var c = w.slice(i, i + n).join(' ');
          var nm = TK._intern.streetName(c);
          if (nm && out.indexOf(nm) < 0 && !/^(Zufahrt|WP|Lagerplatz|Parkplatz|Betriebshof|Werkhof|Bauhof|Hafen|Firmengelände)\b/i.test(nm)) out.push(nm);
        }
      });
    });
    return out;
  }
  // Liefert {punkt:[lat,lon], genau:'koordinate'|'adresse'|'strasse'|'ort', text}
  TK.findeOrt = async function (g, d) {
    var k = TK.koordAusText(g.beschreibung) || (g.lat && g.lon ? [g.lat, g.lon] : null);
    if (k) return { punkt: k, genau: 'koordinate', text: 'Koordinate aus dem Bescheid' };
    var ort = [g.plz, g.ort].filter(Boolean).join(' ');
    if (g.strasse) {
      var r = await nominatim(d, { street: (g.hausnummer ? g.hausnummer + ' ' : '') + g.strasse, postalcode: g.plz || '', city: g.ort || '' });
      if (!r.length && g.hausnummer) r = await nominatim(d, { street: g.strasse, postalcode: g.plz || '', city: g.ort || '' });
      if (r.length) return { punkt: [+r[0].lat, +r[0].lon], genau: g.hausnummer ? 'adresse' : 'strasse', text: g.strasse + (g.hausnummer ? ' ' + g.hausnummer : '') + ', ' + ort };
    }
    var str = strassenAusText(g.beschreibung);
    for (var i = 0; i < str.length; i++) {
      var r2 = await nominatim(d, { street: str[i].replace(/Str\.$/, 'Straße'), postalcode: g.plz || '', city: g.ort || '' });
      if (r2.length) return { punkt: [+r2[0].lat, +r2[0].lon], genau: 'strasse', text: str[i] + ', ' + ort };
    }
    var r3 = await nominatim(d, g.plz ? { postalcode: g.plz, city: g.ort || '' } : { city: g.ort || '' });
    if (!r3.length && g.ort) r3 = await nominatim(d, { q: g.ort });
    if (r3.length) return { punkt: [+r3[0].lat, +r3[0].lon], genau: 'ort', text: ort };
    throw new Error('Ort nicht gefunden: ' + ort + ' ' + (g.beschreibung || ''));
  };

  /* ---------- Overpass: Straßen-Geometrie ---------- */
  function nameRegex(n) {
    var s = n.trim().replace(/[\[\]{}()*+?^$|\\"]/g, '')
      .replace(/(S|s)tr\.?$/, '$1tr(aße|asse|.)').replace(/(S|s)tra(ß|ss)e$/, '$1tr(aße|asse|.)')
      .replace(/(\S)(str)(aße|asse|\.)$/i, '$1$2(aße|asse|.)').replace(/\./g, '.');
    return '^' + s + '$';
  }
  function refRegex(r) { var m = r.match(/^([A-Z]+)(\d+[A-Z]?)$/); return '(^|;) *' + m[1] + ' ?' + m[2] + ' *(;|$)'; }
  function bboxStr(b) { return b.s.toFixed(4) + ',' + b.w.toFixed(4) + ',' + b.n.toFixed(4) + ',' + b.o.toFixed(4); }
  async function overpass(d, ql, runden, wartezeit) {
    var fehler = [];
    var zs = d.zwischenspeicher === false ? null : TK.zs, zk = 'data=' + encodeURIComponent(ql);
    if (zs) { var gz = await zs.hole('strassen', d.overpass.join('|'), zk); if (gz != null) { try { return JSON.parse(gz); } catch (e) { /* defekter Eintrag */ } } }
    for (var v = 0; v < (runden || 2); v++) {
      for (var i = 0; i < d.overpass.length; i++) {
        try {
          var ab = typeof AbortController !== 'undefined' ? new AbortController() : null;
          var tm = ab ? setTimeout(function () { ab.abort(); }, wartezeit || 30000) : null;
          var r = await F(d)(d.overpass[i], { method: 'POST', body: 'data=' + encodeURIComponent(ql), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ab ? ab.signal : undefined });
          if (tm) clearTimeout(tm);
          if (r.ok) { var t = await r.text(); if (t[0] === '{') { var oj = JSON.parse(t); if (zs && !oj.remark && Array.isArray(oj.elements)) await zs.lege('strassen', d.overpass.join('|'), zk, t); return oj; } }
          fehler.push(d.overpass[i] + ' ' + r.status);
        } catch (e) { fehler.push(String(e.message || e)); }
      }
      if (v < (runden || 2) - 1) await sleep(5000 * (v + 1));
    }
    throw new Error('Straßendaten (Overpass) nicht erreichbar: ' + fehler.slice(-3).join('; '));
  }
  TK._overpass = overpass;

  /* ---------- Router (OSRM-kompatibel) ---------- */
  // richtungen: optional je Punkt null oder [Grad, Spielraum] (Fahrtrichtung am Punkt, z. B. richtige Autobahnseite)
  TK.route = async function (punkte, d, richtungen) {
    var mitR = richtungen && richtungen.some(function (x) { return x; });
    var u = d.router + punkte.map(function (p) { return p[1].toFixed(6) + ',' + p[0].toFixed(6); }).join(';') +
      '?overview=full&geometries=geojson&steps=true&continue_straight=true' +
      (mitR ? '&bearings=' + richtungen.map(function (b) { return b ? Math.round((b[0] + 360) % 360) + ',' + Math.round(b[1]) : ''; }).join(';') : '');
    var r, j, zs = d.zwischenspeicher === false ? null : TK.zs, hit = false;
    if (zs) { var gz = await zs.hole('router', u, ''); if (gz != null) { try { j = JSON.parse(gz); hit = true; } catch (e) { j = null; } } }
    for (var v = 0; v < 3 && !hit; v++) {
      try { r = await F(d)(u); if (r.ok || r.status === 400) { var rt0 = await r.text(); j = JSON.parse(rt0); if (zs && r.ok && j && j.code === 'Ok') await zs.lege('router', u, '', rt0); break; } } catch (e) { if (v === 2) throw e; }
      await sleep(1500 * (v + 1));
    }
    if (mitR && j && j.code !== 'Ok') return TK.route(punkte, d, null); // Richtung nicht erfüllbar: ohne versuchen
    if (!j || j.code !== 'Ok') throw new Error('Routenberechnung fehlgeschlagen: ' + (j ? j.code + ' ' + (j.message || '') : (r && r.status)));
    var rt = j.routes[0], schritte = [], legs = [];
    rt.legs.forEach(function (l, li) {
      legs.push({ dist: l.distance, dauer: l.duration });
      l.steps.forEach(function (s) { schritte.push({ ref: s.ref || '', name: s.name || '', dist: s.distance, leg: li, art: s.maneuver.type, mod: s.maneuver.modifier || '', ort: [s.maneuver.location[1], s.maneuver.location[0]] }); });
    });
    return {
      coords: rt.geometry.coordinates.map(function (c) { return [c[1], c[0]]; }),
      dist: rt.distance, dauer: rt.duration, schritte: schritte, legs: legs,
      wegpunkte: j.waypoints.map(function (w) { return [w.location[1], w.location[0]]; })
    };
  };

  // Strecke doppelt befahren (hin und zurück) = Schleife/Wenden. Liefert Stellen + verursachenden Zwischenpunkt.
  TK.doppelteStellen = function (c) {
    var S = [], cum = 0, schritt = 40;
    S.push({ p: c[0], m: 0, h: c.length > 1 ? TK.peilung(c[0], c[1]) : 0 });
    for (var i = 1; i < c.length; i++) {
      var dd = G.dist(c[i - 1], c[i]);
      for (var t = schritt - (cum % schritt); t < dd; t += schritt) {
        var f = t / dd; S.push({ p: [c[i - 1][0] + f * (c[i][0] - c[i - 1][0]), c[i - 1][1] + f * (c[i][1] - c[i - 1][1])], m: cum + t, h: TK.peilung(c[i - 1], c[i]) });
      }
      cum += dd;
    }
    var gitter = {}, Z = 0.0009;
    function key(p) { return Math.floor(p[0] / Z) + ':' + Math.floor(p[1] / (Z * 1.6)); }
    S.forEach(function (s, i) { var k = key(s.p); (gitter[k] = gitter[k] || []).push(i); });
    // gegen: Gegenrichtung (hin und zurück); runde: gleiche Richtung später noch einmal (Runde doppelt gefahren)
    var mark = { gegen: new Uint8Array(S.length), runde: new Uint8Array(S.length) };
    var partner = { gegen: new Float64Array(S.length), runde: new Float64Array(S.length) };
    S.forEach(function (s, i) {
      var a = Math.floor(s.p[0] / Z), b = Math.floor(s.p[1] / (Z * 1.6));
      for (var x = -1; x <= 1; x++) for (var y = -1; y <= 1; y++) {
        (gitter[(a + x) + ':' + (b + y)] || []).forEach(function (j) {
          if (Math.abs(S[j].m - s.m) <= 300) return;
          var dd = G.dist(S[j].p, s.p); if (dd >= 75) return;
          var dh = Math.abs(S[j].h - s.h) % 360; if (dh > 180) dh = 360 - dh;
          if (dh > 150) { mark.gegen[i] = 1; if (S[j].m > partner.gegen[i]) partner.gegen[i] = S[j].m; }
          else if (dh < 30 && dd < 25 && S[j].m > s.m) { mark.runde[i] = 1; if (!partner.runde[i] || S[j].m < partner.runde[i]) partner.runde[i] = S[j].m; }
        });
      }
    });
    var stellen = [];
    ['gegen', 'runde'].forEach(function (art) {
      var mk = mark[art], pt = partner[art], lauf = 0, anfang = -1;
      for (var k = 0; k <= S.length; k++) {
        if (k < S.length && mk[k]) { if (anfang < 0) anfang = k; lauf = k; }
        else if (anfang >= 0 && (k === S.length || k - lauf > 4)) {
          if ((lauf - anfang) * schritt >= 120) {
            var pm = 0;
            if (art === 'gegen') { for (var q = anfang; q <= Math.min(lauf, anfang + 3); q++) pm = Math.max(pm, pt[q]); }
            else pm = pt[anfang];
            stellen.push({ art: art, ort: S[anfang].p, bis: S[lauf].p, laenge: (lauf - anfang) * schritt, mVon: S[anfang].m, mBis: pm });
          }
          anfang = -1;
        }
      }
    });
    // jede Stelle taucht hin und zurück auf: zusammenfassen
    var out = [];
    stellen.forEach(function (s) { if (!out.some(function (o) { return G.dist(o.ort, s.ort) < 2000 || G.dist(o.ort, s.bis) < 2000 || G.dist(o.bis, s.ort) < 2000; })) out.push(s); });
    return out;
  };
  // Lage eines Punkts entlang der Linie (Meter ab Anfang) und Abstand
  function lageAuf(c, cum, p) {
    var best = { m: 0, d: Infinity };
    for (var i = 1; i < c.length; i++) {
      var a = c[i - 1], b = c[i], dx = b[1] - a[1], dy = b[0] - a[0], l2 = dx * dx + dy * dy;
      var t = l2 ? ((p[1] - a[1]) * dx + (p[0] - a[0]) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
      var q = [a[0] + t * dy, a[1] + t * dx], dd = G.dist(p, q);
      if (dd < best.d) best = { m: cum[i - 1] + t * (cum[i] - cum[i - 1]), d: dd };
    }
    return best;
  }
  // Wendeschleifen herausschneiden: Hinweg und Rückweg liegen nur eine Fahrbahnbreite auseinander.
  // schutz: Punkte aus dem Bescheid [{p, tol}] – eine Schleife wird nur geschnitten, wenn danach jeder
  // Schutzpunkt noch innerhalb seiner Toleranz an der Strecke liegt (Bescheid-Strecke geht vor).
  TK.kuerzeSchleifen = function (c, schutz) {
    var st = TK.doppelteStellen(c).filter(function (x) { return x.mBis > x.mVon && x.mBis - x.mVon < 25000; });
    if (!st.length) return { coords: c, gekuerzt: [], behalten: [] };
    var cum = [0]; for (var i = 1; i < c.length; i++) cum.push(cum[i - 1] + G.dist(c[i - 1], c[i]));
    function punkt(m) { var i = 1; while (i < c.length - 1 && cum[i] < m) i++; var f = (m - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); f = Math.max(0, Math.min(1, f)); return { i: i, p: [c[i - 1][0] + f * (c[i][0] - c[i - 1][0]), c[i - 1][1] + f * (c[i][1] - c[i - 1][1])] }; }
    function ohne(von, bis) { var o = []; for (var k = 0; k < c.length; k++) if (cum[k] < von || cum[k] > bis) o.push(c[k]); return o; }
    var lagen = (schutz || []).map(function (s) { return Object.assign({ lage: lageAuf(c, cum, s.p) }, s); });
    var out = [], ab = 0, gek = [], behalten = [];
    st.sort(function (a, b) { return a.mVon - b.mVon; }).forEach(function (x) {
      if (x.mVon < ab) return;
      var a = punkt(x.mVon), b = punkt(x.mBis);
      if (G.dist(a.p, b.p) > 120) return;
      var rest = null, verletzt = lagen.filter(function (s) {
        if (s.lage.m <= x.mVon - 200 || s.lage.m >= x.mBis + 200) return false;
        rest = rest || ohne(x.mVon, x.mBis);
        return G.distLine(s.p, rest) > s.tol;
      });
      if (verletzt.length) { behalten.push({ ort: a.p, art: x.art, km: Math.round((x.mBis - x.mVon) / 100) / 10, wegen: verletzt.map(function (s) { return s.text; }) }); return; }
      for (var k = 0; k < c.length && cum[k] < x.mVon; k++) if (cum[k] >= ab) out.push(c[k]);
      out.push(a.p, b.p); ab = x.mBis;
      gek.push({ ort: a.p, art: x.art, km: Math.round((x.mBis - x.mVon) / 100) / 10, mVon: x.mVon, mBis: x.mBis });
    });
    for (var k = 0; k < c.length; k++) if (cum[k] > ab) out.push(c[k]);
    return { coords: out, gekuerzt: gek, behalten: behalten };
  };
  // Routenschritte nach dem Schneiden: herausgeschnittene Meter abziehen (für die Straßenprüfung)
  TK.schritteNachSchnitt = function (schritte, gek) {
    if (!gek || !gek.length) return schritte;
    var m = 0;
    return schritte.map(function (s) {
      var von = m, bis = m + s.dist, weg = 0; m = bis;
      gek.forEach(function (g) { weg += Math.max(0, Math.min(bis, g.mBis) - Math.max(von, g.mVon)); });
      return Object.assign({}, s, { dist: Math.max(0, s.dist - weg) });
    }).filter(function (s) { return s.dist > 0.5 || s.art === 'arrive' || s.art === 'depart'; });
  };
  function schneide(route, schutz) {
    var kz = TK.kuerzeSchleifen(route.coords, schutz);
    if (kz.gekuerzt.length) { route.schritte = TK.schritteNachSchnitt(route.schritte, kz.gekuerzt); route.coords = kz.coords; route.dist = G.lineLen(kz.coords); route.gekuerzt = kz.gekuerzt; }
    route.behalten = kz.behalten;
    return route;
  }
  function schleifen(route, wp) {
    var out = [];
    route.schritte.forEach(function (s) {
      if (s.mod === 'uturn' || s.art === 'uturn') out.push({ ort: s.ort, text: 'Wendemanöver' });
    });
    TK.doppelteStellen(route.coords).forEach(function (s) {
      if (out.some(function (o) { return G.dist(o.ort, s.ort) < 3000; })) return;
      out.push({ ort: s.ort, bis: s.bis, text: s.art === 'runde' ? 'Strecke fährt hier eine Runde doppelt' : 'Strecke wird hin und zurück befahren (' + String(Math.round(s.laenge / 100) / 10).replace('.', ',') + ' km)' });
    });
    // verursachenden Zwischenpunkt zuordnen (nächster innerhalb 6 km)
    var pts = route.wegpunkte;
    out.forEach(function (o) {
      var best = -1, bd = 6000;
      for (var i = 1; i < pts.length - 1; i++) { var dd = Math.min(G.dist(pts[i], o.ort), o.bis ? G.dist(pts[i], o.bis) : Infinity); if (dd < bd) { bd = dd; best = i; } }
      if (best > 0) { o.wp = best; o.text += ', an der orange markierten Stelle'; }
    });
    return out;
  }

  /* ---------- Rekonstruktion eines Lastfahrt-Teils ---------- */
  TK.rekonstruiereTeil = async function (bescheid, teilIdx, dienste, melde) {
    var d = Object.assign({}, TK.standardDienste, dienste || {});
    melde = melde || function () {};
    var teil = bescheid.teile[teilIdx];
    var items = TK.zerlegeStrecke(teil.segmente);
    var ungenau = [];

    melde('Start und Ziel suchen …');
    var st = await TK.findeOrt(teil.start, d), zi = await TK.findeOrt(teil.ziel, d);
    if (st.genau === 'ort') ungenau.push({ text: 'Startpunkt nur als Ort bekannt (' + st.text + '). Bitte Start auf der Karte prüfen.', ort: st.punkt });
    if (zi.genau === 'ort') ungenau.push({ text: 'Zielpunkt nur als Ort bekannt (' + zi.text + '). Bitte Ziel auf der Karte prüfen.', ort: zi.punkt });
    if (st.genau === 'strasse') ungenau.push({ text: 'Startpunkt nur als Straße bekannt (' + st.text + '), ohne Hausnummer. Bitte Start auf der Karte prüfen.', ort: st.punkt });
    if (zi.genau === 'strasse') ungenau.push({ text: 'Zielpunkt nur als Straße bekannt (' + zi.text + '), ohne Hausnummer. Bitte Ziel auf der Karte prüfen.', ort: zi.punkt });

    // Anschlussstellen/Kreuze: Kandidaten
    var liste = root.TK_ANSCHLUSSSTELLEN || [];
    items.forEach(function (it) { if (it.art === 'knoten') it.kandidaten = TK.sucheKnoten(liste, it.name, it.typ, 5); });

    // Grobe Anker für Suchrahmen: Start, beste Knoten, Ziel
    function grob(i) { var it = items[i]; return it && it.art === 'knoten' && it.kandidaten.length ? it.kandidaten[0].mitte : null; }
    function nachbar(i, dir) { for (var k = i + dir; k >= 0 && k < items.length; k += dir) { var g = grob(k); if (g) return g; } return dir < 0 ? st.punkt : zi.punkt; }
    var lokale = items.filter(function (it) { return it.art === 'strasse' && !it.autobahn; });
    if (lokale.length) {
      melde('Straßen aus dem Bescheid in der Karte suchen … (kann 1 bis 2 Minuten dauern)');
      var parts = [];
      items.forEach(function (it, i) {
        if (it.art !== 'strasse' || it.autobahn) return;
        var a = nachbar(i, -1), b = nachbar(i, 1);
        var s = Math.min(a[0], b[0]), n = Math.max(a[0], b[0]), w = Math.min(a[1], b[1]), o = Math.max(a[1], b[1]);
        var pad = Math.max(0.06, 0.25 * Math.max(n - s, (o - w) * 0.6)); // großzügig: Einmündung kann hinter dem Ziel-Ort liegen
        it.bbox = { s: s - pad, n: n + pad, w: w - pad / 0.6, o: o + pad / 0.6 };
        var bb = bboxStr(it.bbox);
        it.refs.forEach(function (r) { parts.push('way[highway][ref~"' + refRegex(r) + '"](' + bb + ');'); });
        if (it.name) parts.push('way[highway][name~"' + nameRegex(it.name) + '",i](' + bb + ');');
      });
      try {
        var res = await overpass(d, '[out:json][timeout:60];(' + parts.join('') + ');out body geom qt;', d.overpassRunden || 1, d.overpassWartezeit || 45000);
        var ways = res.elements.filter(function (e) { return e.type === 'way' && e.geometry; });
        lokale.forEach(function (it) {
          it.wege = ways.filter(function (w) {
            var t = w.tags || {}, inBox = w.bounds && w.bounds.maxlat >= it.bbox.s && w.bounds.minlat <= it.bbox.n && w.bounds.maxlon >= it.bbox.w && w.bounds.minlon <= it.bbox.o;
            if (!inBox) return false;
            var refOk = it.refs.some(function (r) { return String(t.ref || '').split(';').some(function (x) { return TK.normRef(x) === r; }); });
            var nameOk = it.name && t.name && TK.gleicherStrassenname(t.name, it.name);
            return refOk || nameOk;
          }).map(function (w) { return { nodes: w.nodes, geom: w.geometry.map(function (g) { return [g.lat, g.lon]; }) }; });
          if (!it.wege.length) it.nichtGefunden = true;
        });
      } catch (e) {
        // Ersatzweg: Straßen über die Adresssuche (Nominatim, Teilstücke ohne Knotennummern)
        melde('Straßendienst überlastet – Ersatzweg über die Adresssuche …');
        var fehlt = 0;
        for (var li = 0; li < lokale.length; li++) {
          var it = lokale[li], b = it.bbox, wege = [];
          var fragen = it.refs.map(function (r) { return { q: r.replace(/^([A-Z]+)(\d)/, '$1 $2'), ref: true }; });
          if (it.name) fragen.push({ q: it.name.replace(/Str\.$/, 'Straße'), ref: false });
          for (var fi = 0; fi < fragen.length; fi++) {
            try {
              var rr = await nominatim(d, { q: fragen[fi].q, polygon_geojson: 1, bounded: 1, limit: 40, viewbox: b.w.toFixed(4) + ',' + b.n.toFixed(4) + ',' + b.o.toFixed(4) + ',' + b.s.toFixed(4) });
              rr.forEach(function (x) {
                if (x.category !== 'highway' || !x.geojson) return;
                if (!fragen[fi].ref && !TK.gleicherStrassenname(String(x.name || x.display_name.split(',')[0]), it.name)) return;
                var gs = x.geojson.type === 'LineString' ? [x.geojson.coordinates] : x.geojson.type === 'MultiLineString' ? x.geojson.coordinates : [];
                gs.forEach(function (g) { wege.push({ nodes: [], geom: g.map(function (c) { return [c[1], c[0]]; }) }); });
              });
            } catch (x) { /* nächste Frage */ }
          }
          it.wege = wege; if (!wege.length) { it.nichtGefunden = true; fehlt++; }
        }
        ungenau.push({ text: 'Straßendaten-Server war überlastet; Ortsstraßen über Ersatzweg geladen' + (fehlt ? ' (' + fehlt + ' nicht gefunden)' : '') + '. Bei Zweifel später „Neu berechnen“.' });
      }
    }

    // Start/Ziel an erste/letzte genannte Straße heranziehen, wenn nur ungefähr bekannt
    function naechsterAufStrasse(it, p) {
      var best = null, bd = Infinity;
      (it.wege || []).forEach(function (w) { w.geom.forEach(function (g) { var dd = G.dist(p, g); if (dd < bd) { bd = dd; best = g; } }); });
      return best ? { p: best, d: bd } : null;
    }
    var erste = items[0], letzte = items[items.length - 1];
    if (st.genau !== 'koordinate' && st.genau !== 'adresse' && erste && erste.wege) { var ns = naechsterAufStrasse(erste, st.punkt); if (ns && ns.d < 3000) { st.punkt = ns.p; st.text += ' (an ' + (erste.name || erste.refs.join('/')) + ')'; } }
    if (zi.genau !== 'koordinate' && zi.genau !== 'adresse' && letzte && letzte.wege) { var nz = naechsterAufStrasse(letzte, zi.punkt); if (nz && nz.d < 6000) { zi.punkt = nz.p; zi.text += ' (an ' + (letzte.name || letzte.refs.join('/')) + ')'; } }

    // Kette: Verbindungspunkte zwischen aufeinanderfolgenden Ortsstraßen + Knoten
    var kette = [{ art: 'start', kand: [{ p: st.punkt, pen: 0 }] }];
    items.forEach(function (it, i) {
      if (it.art === 'knoten') {
        if (it.kandidaten.length) kette.push({ art: 'knoten', item: it, kand: it.kandidaten.map(function (k) { return { p: k.mitte, pen: (1 - k.score) * 40000, k: k }; }) });
        return;
      }
      var prev = items[i - 1];
      if (!prev || prev.art !== 'strasse' || !prev.wege || !it.wege || !prev.wege.length || !it.wege.length) return;
      var ids = {}; prev.wege.forEach(function (w) { w.nodes.forEach(function (n, j) { ids[n] = w.geom[j]; }); });
      var kand = [], seen = {};
      it.wege.forEach(function (w) { w.nodes.forEach(function (n, j) { if (ids[n] && !seen[n]) { seen[n] = 1; kand.push({ p: w.geom[j], pen: 0 }); } }); });
      if (!kand.length) {
        var pairs = [];
        // Punkt der neuen Straße nahe an der vorigen Straße (Abstand zur Linie, nicht nur zu deren Stützpunkten)
        prev.wege.forEach(function (a) { it.wege.forEach(function (b) { b.geom.forEach(function (pb) {
          var dd = G.distLine(pb, a.geom); if (dd < 150) pairs.push({ p: pb, pen: dd * 5 });
        }); }); });
        pairs.sort(function (x, y) { return x.pen - y.pen; });
        pairs.forEach(function (c) { if (kand.length < 12 && kand.every(function (k) { return G.dist(k.p, c.p) > 150; })) kand.push(c); });
      }
      // Viele Kreuzungen (z. B. zwei Abschnitte derselben Straße): auf 30 nächste zur Luftlinie begrenzen
      if (kand.length > 30) kand = kand.slice(0, 30);
      if (kand.length) kette.push({ art: 'verbindung', item: it, von: prev, kand: kand });
      else it.ohneVerbindung = true;
    });
    kette.push({ art: 'ziel', kand: [{ p: zi.punkt, pen: 0 }] });

    // Viterbi: kürzeste Luftlinien-Kette
    var cost = kette[0].kand.map(function (c) { return c.pen; }), back = [];
    for (var s = 1; s < kette.length; s++) {
      var nc = [], nb = [];
      kette[s].kand.forEach(function (c) {
        var best = Infinity, bi = 0;
        kette[s - 1].kand.forEach(function (pc, pi) { var v = cost[pi] + G.dist(pc.p, c.p); if (v < best) { best = v; bi = pi; } });
        nc.push(best + c.pen); nb.push(bi);
      });
      cost = nc; back.push(nb);
    }
    var wahl = new Array(kette.length), bi = 0;
    wahl[kette.length - 1] = 0;
    for (s = kette.length - 1; s > 0; s--) { wahl[s - 1] = back[s - 1][wahl[s]]; }
    kette.forEach(function (k, i) { k.gewaehlt = k.kand[wahl[i]]; if (k.art === 'knoten') k.item.gewaehlt = k.gewaehlt.k; });

    // Wegpunkte: Start, Verbindungen, Ziel (Knoten erst bei Bedarf)
    var wp = kette.filter(function (k) { return k.art !== 'knoten'; });
    // Fahrtrichtung an Autobahn-Knoten: Einfahrt -> Richtung zum nächsten Punkt, Ausfahrt -> Richtung vom vorigen Punkt
    function richtung(k) {
      if (k.art !== 'knoten') return null;
      var ki = -1; for (var q = 0; q < kette.length; q++) if (kette[q].item === k.item) ki = q;
      if (ki <= 0 || ki >= kette.length - 1) return null;
      var ii = items.indexOf(k.item), naechstes = items[ii + 1];
      var einfahrt = naechstes && naechstes.art === 'strasse' && naechstes.autobahn || naechstes && naechstes.art === 'knoten';
      var a = einfahrt ? k.gewaehlt.p : kette[ki - 1].gewaehlt.p, b = einfahrt ? kette[ki + 1].gewaehlt.p : k.gewaehlt.p;
      if (G.dist(a, b) < 2000) return null;
      return [TK.peilung(a, b), 75];
    }
    function rechne(liste) { return TK.route(liste.map(function (k) { return k.gewaehlt.p; }), d, liste.map(richtung)); }
    melde('Strecke berechnen …');
    var route = await rechne(wp);

    // Knoten nicht passiert? Dann als Wegpunkt erzwingen (je Richtung beste Lage)
    for (var runde = 0; runde < 3; runde++) {
      var fehl = kette.filter(function (k) { return k.art === 'knoten' && wp.indexOf(k) < 0 && G.distLine(k.gewaehlt.k.mitte, route.coords) > 1000; });
      if (!fehl.length) break;
      for (var f = 0; f < fehl.length; f++) {
        var kn = fehl[f], pos = 0;
        for (var j = 0; j < wp.length; j++) if (kette.indexOf(wp[j]) < kette.indexOf(kn)) pos = j + 1;
        var bestR = null, bestP = null;
        var pts = kn.gewaehlt.k.punkte.slice(0, 4);
        for (var pi = 0; pi < pts.length; pi++) {
          var test = wp.slice(); test.splice(pos, 0, { art: 'knoten', item: kn.item, gewaehlt: { p: pts[pi] } });
          try { var rr = await rechne(test); if (!bestR || rr.dist < bestR.dist) { bestR = rr; bestP = pts[pi]; } } catch (e) { /* nächster Punkt */ }
        }
        if (bestR) { var nk = Object.assign({}, kn, { gewaehlt: Object.assign({}, kn.gewaehlt, { p: bestP }) }); kette[kette.indexOf(kn)] = nk; nk.item.gewaehlt = kn.gewaehlt.k; wp.splice(pos, 0, nk); route = bestR; }
      }
    }

    // Wendemanöver an Verbindungspunkten: Punkt weglassen, wenn die Straßen trotzdem befahren werden
    // Nie einen Punkt verwerfen, nur weil die Route ohne ihn kürzer wäre (Bescheid geht vor).
    var sch = schleifen(route, wp), versuche = 0;
    for (var x = 0; x < sch.length && versuche < 8; x++) {
      if (!sch[x].wp) continue;
      var idx = sch[x].wp, kk = wp[idx];
      if (!kk || kk.art === 'start' || kk.art === 'ziel') continue;
      versuche++;
      var optionen = [];
      // a) andere Lage desselben Punkts (andere Kreuzung / andere Fahrtrichtung)
      var alt = kk.art === 'knoten' ? kk.gewaehlt.k.punkte.map(function (p) { return { p: p }; }) : kk.kand;
      alt.filter(function (c) { return c.p !== kk.gewaehlt.p && G.dist(c.p, kk.gewaehlt.p) < 5000; })
        .sort(function (a, b) { return G.dist(a.p, kk.gewaehlt.p) - G.dist(b.p, kk.gewaehlt.p); }).slice(0, 4)
        .forEach(function (c) { var n = Object.assign({}, kk, { gewaehlt: Object.assign({}, kk.gewaehlt, { p: c.p }) }); var w2 = wp.slice(); w2[idx] = n; optionen.push({ wp: w2, weg: false }); });
      // b) Punkt weglassen – nur gültig, wenn die Strecke trotzdem dort vorbeiführt
      optionen.push({ wp: wp.slice(0, idx).concat(wp.slice(idx + 1)), weg: true });
      var besser = null, jetzt = sch.length;
      for (var oi = 0; oi < optionen.length; oi++) {
        try {
          var r2 = await rechne(optionen[oi].wp);
          if (optionen[oi].weg && G.distLine(kk.gewaehlt.p, r2.coords) > 150) continue;
          var s2 = schleifen(r2, optionen[oi].wp).length;
          if (s2 < jetzt && (!besser || s2 < besser.s || (s2 === besser.s && r2.dist < besser.r.dist))) besser = { r: r2, s: s2, wp: optionen[oi].wp };
        } catch (e) { /* nächste Möglichkeit */ }
      }
      if (besser) { wp = besser.wp; route = besser.r; sch = schleifen(route, wp); x = -1; }
    }
    schneide(route, wp.filter(function (k) { return k.art === 'verbindung' || k.art === 'knoten'; }).map(function (k) {
      return { p: k.gewaehlt.p, tol: k.art === 'knoten' ? 600 : 150, text: k.art === 'knoten' ? k.item.name : ((k.von.name || k.von.refs.join('/')) + ' / ' + (k.item.name || k.item.refs.join('/'))) };
    }));
    route.schleifen = schleifen(route, wp);

    var pr = TK.pruefe(bescheid, teilIdx, items, route, { ungenau: ungenau, anker: kette.map(function (k) { return k.gewaehlt.p; }) });
    return {
      teil: teil.zuordnung, start: st, ziel: zi,
      wegpunkte: wp.map(function (k) { return { p: k.gewaehlt.p, art: k.art, text: k.art === 'knoten' ? k.item.name : k.art === 'verbindung' ? ((k.von.name || k.von.refs.join('/')) + ' / ' + (k.item.name || k.item.refs.join('/'))) : k.art === 'start' ? 'Start' : 'Ziel' }; }),
      items: items.map(function (it) { return { art: it.art, name: it.name, refs: it.refs, typ: it.typ, benutzt: it.benutzt, passiert: it.passiert, nichtGefunden: !!it.nichtGefunden, gewaehlt: it.gewaehlt ? it.gewaehlt.name : null }; }),
      coords: route.coords, distKm: Math.round(route.dist / 100) / 10, dauerMin: Math.round(route.dauer / 60),
      schritte: route.schritte.map(function (s) { return { ref: s.ref, name: s.name, dist: Math.round(s.dist) }; }),
      pruefung: pr
    };
  };

  // Nach Handkorrektur: Route nur aus Wegpunkten neu berechnen und prüfen
  TK.neuAusWegpunkten = async function (bescheid, teilIdx, ergebnis, dienste) {
    var d = Object.assign({}, TK.standardDienste, dienste || {});
    // Abschnitte mit "gerade" (von Hand, z. B. Gegenverkehr/fehlende Auffahrt) als gerade Linie, Rest berechnen
    var wps = ergebnis.wegpunkte, route = { coords: [], schritte: [], dist: 0, dauer: 0, wegpunkte: wps.map(function (w) { return w.p; }) };
    var stueck = [wps[0]];
    async function abschliessen() {
      if (stueck.length < 2) return;
      var r = await TK.route(stueck.map(function (w) { return w.p; }), d);
      route.coords = route.coords.concat(r.coords); route.schritte = route.schritte.concat(r.schritte);
      route.dist += r.dist; route.dauer += r.dauer;
    }
    for (var i = 1; i < wps.length; i++) {
      if (wps[i - 1].gerade) {
        await abschliessen();
        var dd = G.dist(wps[i - 1].p, wps[i].p);
        route.coords.push(wps[i - 1].p, wps[i].p); route.dist += dd; route.dauer += dd / 8;
        route.schritte.push({ ref: '', name: 'gerade Linie (von Hand)', dist: dd, art: 'hand', mod: '', ort: wps[i - 1].p });
        stueck = [wps[i]];
      } else stueck.push(wps[i]);
    }
    await abschliessen();
    // von Hand gesetzte Punkte sind immer geschützt
    schneide(route, wps.slice(1, -1).map(function (w) { return { p: w.p, tol: 150, text: w.text || 'Punkt' }; }));
    route.schleifen = schleifen(route, wps);
    var items = TK.zerlegeStrecke(bescheid.teile[teilIdx].segmente);
    // gewählte Knoten wiederherstellen
    var liste = root.TK_ANSCHLUSSSTELLEN || [];
    items.forEach(function (it, i) {
      if (it.art !== 'knoten') return;
      var alt = (ergebnis.items || []).filter(function (x) { return x.art === 'knoten' && x.name === it.name; })[0];
      var k = TK.sucheKnoten(liste, it.name, it.typ, 8).filter(function (c) { return alt && c.name === alt.gewaehlt; });
      // nächster Kandidat zur Strecke
      var all = TK.sucheKnoten(liste, it.name, it.typ, 8);
      all.sort(function (a, b) { return G.distLine(a.mitte, route.coords) - G.distLine(b.mitte, route.coords); });
      it.gewaehlt = k[0] && G.distLine(k[0].mitte, route.coords) < 1500 ? k[0] : all[0];
    });
    var ungenau = [];
    var pr = TK.pruefe(bescheid, teilIdx, items, route, { ungenau: ungenau, anker: ergebnis.wegpunkte.map(function (w) { return w.p; }) });
    return Object.assign({}, ergebnis, {
      coords: route.coords, distKm: Math.round(route.dist / 100) / 10, dauerMin: Math.round(route.dauer / 60),
      schritte: route.schritte.map(function (s) { return { ref: s.ref, name: s.name, dist: Math.round(s.dist) }; }),
      items: items.map(function (it) { return { art: it.art, name: it.name, refs: it.refs, typ: it.typ, benutzt: it.benutzt, passiert: it.passiert, gewaehlt: it.gewaehlt ? it.gewaehlt.name : null }; }),
      pruefung: pr, vonHand: true
    });
  };

  // Ganzer Bescheid: alle Lastfahrt-Teile nacheinander
  TK.rekonstruiere = async function (bescheid, dienste, melde) {
    var teile = [];
    for (var i = 0; i < bescheid.teile.length; i++) {
      if (!bescheid.teile[i].lastfahrt) continue;
      teile.push(await TK.rekonstruiereTeil(bescheid, i, dienste, melde));
    }
    if (!teile.length) throw new Error('Der Bescheid enthält keine Lastfahrt.');
    var stufen = teile.map(function (t) { return t.pruefung.stufe; });
    return { teile: teile, stufe: stufen.indexOf('rot') >= 0 ? 'rot' : stufen.indexOf('gelb') >= 0 ? 'gelb' : 'gruen', berechnet: new Date().toISOString() };
  };
})(typeof window !== 'undefined' ? window : globalThis);
