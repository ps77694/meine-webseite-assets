/* Transportkarte – Eigene Strecke ohne Bescheid:
   Adressvorschläge (Adresssuche, höchstens 1 Anfrage pro Sekunde) und Strecke aus eingegebenen Punkten.
   Die Routenlogik und die Prüfungen für Bescheide (tk-route.js, tk-kern.js) bleiben unverändert; hier wird nur TK.route benutzt. */
(function (root) {
  'use strict';
  var TK = root.TK = root.TK || {};

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var letzte = 0;

  // Kurzer Ortstext aus einem Treffer der Adresssuche: "Straße Nr, PLZ Ort"
  function kurzText(r) {
    var a = r.address || {};
    var strasse = a.road || a.pedestrian || a.footway || a.path || a.cycleway || '';
    var ort = a.city || a.town || a.village || a.municipality || a.hamlet || a.suburb || '';
    var erster = strasse ? strasse + (a.house_number ? ' ' + a.house_number : '') : (r.name || '');
    var zweiter = [a.postcode, ort].filter(Boolean).join(' ');
    var teile = [erster, zweiter].filter(Boolean);
    if (teile.length === 2 && erster === ort) teile = [zweiter];
    var t = teile.join(', ');
    if (!t) t = String(r.display_name || '').split(', ').filter(function (x) { return x !== 'Deutschland'; }).slice(0, 3).join(', ');
    return t;
  }

  // Liefert [{text, p:[lat,lon]}] (leer, wenn nichts gefunden oder weniger als 3 Zeichen)
  TK.adressVorschlaege = async function (text, dienste, anzahl) {
    var d = Object.assign({}, TK.standardDienste, dienste || {});
    text = String(text || '').trim();
    if (text.length < 3) return [];
    var u = d.nominatim + '?format=jsonv2&countrycodes=de&addressdetails=1&limit=' + (anzahl || 5) + '&q=' + encodeURIComponent(text);
    var zs = d.zwischenspeicher === false ? null : TK.zs, roh = null;
    if (zs) { var gz = await zs.hole('adresse', u, ''); if (gz != null) { try { roh = JSON.parse(gz); } catch (e) { roh = null; } } }
    if (!roh) {
      var fehler = '';
      for (var v = 0; v < 3 && !roh; v++) {
        var wait = (v ? 2500 * v : 1100) - (Date.now() - letzte); if (wait > 0) await sleep(wait);
        letzte = Date.now();
        try {
          var r = await (d.fetch || root.fetch.bind(root))(u);
          if (r.ok) { var t = await r.text(); roh = JSON.parse(t); if (zs && Array.isArray(roh) && roh.length) await zs.lege('adresse', u, '', t); }
          else fehler = 'HTTP ' + r.status;
        } catch (e) { fehler = e.message; }
      }
      if (!roh) throw new Error('Adresssuche nicht erreichbar (' + fehler + ').');
    }
    var gesehen = {};
    return roh.map(function (x) { return { text: kurzText(x), p: [+x.lat, +x.lon] }; })
      .filter(function (x) { if (!x.text || isNaN(x.p[0]) || isNaN(x.p[1]) || gesehen[x.text]) return false; gesehen[x.text] = true; return true; });
  };

  // Ein Teil (Strecke) aus Wegpunkten [{p, art, text, gerade}] berechnen. "gerade" = bis zum nächsten Punkt gerade Linie (wie beim Korrigieren).
  TK.eigeneTeil = async function (wps, dienste, basis) {
    var d = Object.assign({}, TK.standardDienste, dienste || {}), G = TK.geo;
    var route = { coords: [], schritte: [], dist: 0, dauer: 0 };
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
        route.schritte.push({ ref: '', name: 'gerade Linie (von Hand)', dist: dd });
        stueck = [wps[i]];
      } else stueck.push(wps[i]);
    }
    await abschliessen();
    return Object.assign({}, basis || {}, {
      wegpunkte: wps, coords: route.coords, distKm: Math.round(route.dist / 100) / 10, dauerMin: Math.round(route.dauer / 60),
      schritte: route.schritte.map(function (s) { return { ref: s.ref, name: s.name, dist: Math.round(s.dist) }; }), items: [],
      start: { text: wps[0].text || '' }, ziel: { text: wps[wps.length - 1].text || '' },
      pruefung: { stufe: 'gruen', befunde: [] } // eigene Strecken werden nicht gegen einen Bescheid geprüft
    });
  };

  // Wegpunkte aus den eingegebenen Punkten [{text, p}] (erster = Start, letzter = Ziel)
  TK.eigeneWegpunkte = function (punkte) {
    return punkte.map(function (x, i) {
      var art = i === 0 ? 'start' : i === punkte.length - 1 ? 'ziel' : 'hand';
      return { p: [x.p[0], x.p[1]], art: art, text: x.text || (art === 'hand' ? 'Zwischenpunkt' : art === 'start' ? 'Start' : 'Ziel') };
    });
  };

  // Eintrag {bescheid, ergebnis, quelle} im Format der Bescheide; form: {id, name, breite, laenge, hoehe, gewicht, von, bis, punkte}
  // ergebnisAlt: vorhandenes Ergebnis wiederverwenden (nur Name/Breite/Zeitraum geändert, Punkte gleich)
  TK.eigeneEintrag = async function (form, dienste, ergebnisAlt) {
    var wps = TK.eigeneWegpunkte(form.punkte);
    var teil;
    if (ergebnisAlt) teil = null;
    else teil = await TK.eigeneTeil(wps, dienste);
    var ergebnis = ergebnisAlt || { teile: [teil], stufe: 'eigen', berechnet: new Date().toISOString(), eigen: true };
    var bescheid = {
      id: form.id, antragsId: '', version: '', eigen: true, art: 'Eigene Strecke', behoerde: '', antragsteller: '',
      gueltigVon: form.von, gueltigBis: form.bis,
      ladung: { text: form.name, breite: form.breite, laenge: form.laenge, hoehe: form.hoehe, masse: form.gewicht },
      lastfahrt: { breite: form.breite, laenge: form.laenge, hoehe: form.hoehe, gewicht: form.gewicht },
      breite: form.breite, kennzeichen: [], fahrten: null,
      eingabe: { punkte: form.punkte.map(function (x) { return { text: x.text, p: [x.p[0], x.p[1]] }; }) }, // die eingegebenen Punkte: daraus wird neu berechnet
      teile: [{ fahrtweg: 0, pos: 0, zuordnung: '1.1', lastfahrt: true, start: { ort: form.punkte[0].text }, ziel: { ort: form.punkte[form.punkte.length - 1].text }, segmente: [] }],
      auflagen: []
    };
    return { bescheid: bescheid, ergebnis: ergebnis, quelle: 'Eigene Strecke' };
  };
})(typeof window !== 'undefined' ? window : globalThis);
