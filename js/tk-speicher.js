/* Transportkarte – Speicher: Google Drive (über Apps Script) oder nur dieser Browser (Testbetrieb). */
(function (root) {
  'use strict';
  var TK = root.TK = root.TK || {};

  var jsonpNr = 0;
  TK.jsonp = function (url, ms) {
    return new Promise(function (ok, fail) {
      var name = '__tkCb' + (++jsonpNr) + '_' + Date.now();
      var s = document.createElement('script'), fertig = false;
      var t = setTimeout(function () { ende(); fail(new Error('Google Drive antwortet nicht (Zeitüberschreitung).')); }, ms || 30000);
      function ende() { fertig = true; clearTimeout(t); try { delete root[name]; } catch (e) { root[name] = undefined; } if (s.parentNode) s.parentNode.removeChild(s); }
      root[name] = function (data) { ende(); ok(data); };
      s.onerror = function () { if (!fertig) { ende(); fail(new Error('Google Drive nicht erreichbar.')); } };
      s.src = url + (url.indexOf('?') < 0 ? '?' : '&') + 'callback=' + name;
      document.body.appendChild(s);
    });
  };

  function round5(c) { return [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5]; }

  // Kurzbeschreibung für Liste und Index (ohne volle Strecke)
  TK.metaAus = function (eintrag) {
    var b = eintrag.bescheid, e = eintrag.ergebnis, t0 = e.teile[0], tn = e.teile[e.teile.length - 1];
    var alle = []; e.teile.forEach(function (t) { alle = alle.concat(t.coords); });
    var s = 90, n = -90, w = 180, o = -180;
    alle.forEach(function (c) { if (c[0] < s) s = c[0]; if (c[0] > n) n = c[0]; if (c[1] < w) w = c[1]; if (c[1] > o) o = c[1]; });
    var grob = TK.vereinfache(alle, 300).map(round5);
    if (grob.length > 400) grob = TK.vereinfache(alle, 1000).map(round5);
    return {
      id: b.id, antragsId: b.antragsId, version: b.version, ladung: b.ladung.text, breite: b.breite,
      laenge: b.lastfahrt.laenge, hoehe: b.lastfahrt.hoehe, gewicht: b.lastfahrt.gewicht,
      gueltigVon: b.gueltigVon, gueltigBis: b.gueltigBis, behoerde: b.behoerde, antragsteller: b.antragsteller,
      von: (b.teile.filter(function (t) { return t.lastfahrt; })[0] || {}).start ? ortText(b.teile.filter(function (t) { return t.lastfahrt; })[0].start) : '',
      nach: ortText(b.teile.filter(function (t) { return t.lastfahrt; }).slice(-1)[0].ziel),
      km: Math.round(e.teile.reduce(function (a, t) { return a + t.distKm; }, 0)),
      stufe: e.stufe, vonHand: !!e.vonHand, bbox: [s, w, n, o], grob: grob,
      name: eintrag.name || '', eigen: !!b.eigen
    };
  };
  function ortText(g) { return g ? [g.plz, g.ort].filter(Boolean).join(' ') + (g.beschreibung ? ' (' + g.beschreibung.replace(/\s*\(.*?\)\s*/g, ' ').trim().slice(0, 60) + ')' : '') : ''; }
  TK.ortText = ortText;

  // Strecke für die Ablage etwas verdichten (Genauigkeit 2 m)
  TK.packeEintrag = function (eintrag) {
    var e = JSON.parse(JSON.stringify(eintrag));
    e.ergebnis.teile.forEach(function (t) { t.coords = TK.vereinfache(t.coords, 2).map(round5); });
    e.meta = TK.metaAus(e);
    return e;
  };

  function bytesZuBase64(bytes) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }

  /* ----- Google Drive über Apps Script ----- */
  function DriveSpeicher(url, schluessel) { this.url = url; this.k = schluessel || ''; this.art = 'drive'; }
  DriveSpeicher.prototype.q = function (p) { return this.url + '?' + p + (this.k ? '&k=' + encodeURIComponent(this.k) : ''); };
  DriveSpeicher.prototype.liste = async function () {
    var r = await TK.jsonp(this.q('type=bescheide'), 60000);
    if (!r || r.error || !r.ok) throw new Error((r && r.error) || 'Liste nicht lesbar');
    return r.bescheide;
  };
  DriveSpeicher.prototype.hole = async function (id) {
    var r = await TK.jsonp(this.q('type=bescheid&id=' + encodeURIComponent(id)), 60000);
    if (!r || r.error || !r.ok) throw new Error((r && r.error) || 'Bescheid nicht lesbar');
    return r.eintrag;
  };
  DriveSpeicher.prototype.post = async function (body) {
    body.k = this.k;
    var txt = JSON.stringify(body);
    try {
      var r = await fetch(this.url, { method: 'POST', body: txt, redirect: 'follow' });
      var j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Speichern fehlgeschlagen');
      return j;
    } catch (e) {
      if (e instanceof TypeError) { // Browser verbietet das Lesen der Antwort: blind senden, dann nachsehen
        await fetch(this.url, { method: 'POST', body: txt, mode: 'no-cors' });
        return { ok: true, blind: true };
      }
      throw e;
    }
  };
  // xmlText: das aus der PDF gezogene XML (wird als eigene Datei neben PDF und JSON abgelegt, nicht in die JSON)
  DriveSpeicher.prototype.speichere = async function (eintrag, pdfBytes, pdfName, xmlText) {
    var e = TK.packeEintrag(eintrag);
    var r = await this.post({ aktion: 'speichern', meta: e.meta, eintrag: e, pdf: pdfBytes ? bytesZuBase64(pdfBytes) : '', pdfName: pdfName || '', xml: xmlText || '' });
    if (r.blind) { var l = await this.liste(); var m = l.filter(function (x) { return x.id === e.meta.id; })[0]; if (!m) throw new Error('Speichern in Google Drive nicht bestätigt.'); return m; }
    return r.meta;
  };
  // Gespeichertes XML bzw. PDF-Bytes eines Bescheids (null, wenn nicht vorhanden)
  DriveSpeicher.prototype.holeXml = async function (id) {
    var r = await TK.jsonp(this.q('type=xml&id=' + encodeURIComponent(id)), 60000);
    return r && r.ok && r.xml ? r.xml : null;
  };
  DriveSpeicher.prototype.holePdf = async function (id) {
    var r = await TK.jsonp(this.q('type=pdf&id=' + encodeURIComponent(id)), 120000);
    if (!r || !r.ok || !r.pdf) return null;
    var s = atob(r.pdf), u = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u.buffer;
  };
  DriveSpeicher.prototype.loesche = async function (id) {
    var r = await this.post({ aktion: 'loeschen', id: id });
    return r;
  };
  DriveSpeicher.prototype.baustellen = function () { return TK.jsonp(this.url + '?type=json', 60000); };
  // Änderungszeit der Baustellen-Datei (ISO-Text) für den Nachweis; null, wenn nicht abrufbar (z. B. altes Apps Script)
  DriveSpeicher.prototype.baustellenstand = async function () {
    try { var r = await TK.jsonp(this.q('type=baustellenstand'), 30000); return r && r.ok && r.stand ? String(r.stand) : null; } catch (e) { return null; }
  };
  DriveSpeicher.prototype.kmlListe = function () { return TK.jsonp(this.url + '?type=routes', 60000); };
  DriveSpeicher.prototype.kml = function (id) { return TK.jsonp(this.url + '?type=kml&id=' + encodeURIComponent(id), 60000); };

  /* ----- Nur dieser Browser (IndexedDB) ----- */
  function LokalSpeicher() { this.art = 'lokal'; }
  function db() {
    return new Promise(function (ok, fail) {
      var r = indexedDB.open('transportkarte', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('bescheide', { keyPath: 'meta.id' }); };
      r.onsuccess = function () { ok(r.result); }; r.onerror = function () { fail(r.error); };
    });
  }
  function tx(store, mode, fn) {
    return db().then(function (d) { return new Promise(function (ok, fail) { var t = d.transaction(store, mode), s = t.objectStore(store), res = fn(s); t.oncomplete = function () { ok(res && res.result !== undefined ? res.result : res); }; t.onerror = function () { fail(t.error); }; }); });
  }
  LokalSpeicher.prototype.liste = async function () { var all = await tx('bescheide', 'readonly', function (s) { return s.getAll(); }); return all.map(function (e) { return e.meta; }); };
  LokalSpeicher.prototype.hole = async function (id) { return tx('bescheide', 'readonly', function (s) { return s.get(id); }); };
  LokalSpeicher.prototype.speichere = async function (eintrag, pdfBytes, pdfName, xmlText) {
    var e = TK.packeEintrag(eintrag);
    e.meta.gespeichert = new Date().toISOString();
    if (pdfBytes) e.pdf = new Blob([pdfBytes], { type: 'application/pdf' });
    var alt = await this.hole(e.meta.id);
    if (!pdfBytes && alt && alt.pdf) e.pdf = alt.pdf;
    if (xmlText) e.xml = xmlText; else if (alt && alt.xml) e.xml = alt.xml; // XML im Eintrag (Browser-Weg)
    e.meta.pdfLokal = !!e.pdf;
    e.meta.xmlLokal = !!e.xml;
    await tx('bescheide', 'readwrite', function (s) { return s.put(e); });
    return e.meta;
  };
  LokalSpeicher.prototype.holeXml = async function (id) { var e = await this.hole(id); return e && e.xml ? e.xml : null; };
  LokalSpeicher.prototype.holePdf = async function (id) { var e = await this.hole(id); return e && e.pdf ? e.pdf.arrayBuffer() : null; };
  LokalSpeicher.prototype.loesche = async function (id) { await tx('bescheide', 'readwrite', function (s) { return s.delete(id); }); return { ok: true }; };
  // Testbetrieb: erfundene Baustellen erst bei Bedarf laden (nicht Teil des Drive-Betriebs)
  LokalSpeicher.prototype.baustellen = function () {
    if (root.TK_BAUSTELLEN_DEMO || typeof document === 'undefined') return Promise.resolve(root.TK_BAUSTELLEN_DEMO || []);
    return new Promise(function (ok) {
      var sc = document.createElement('script'); sc.src = 'daten/baustellen-demo.js';
      sc.onload = function () { ok(root.TK_BAUSTELLEN_DEMO || []); }; sc.onerror = function () { ok([]); };
      document.head.appendChild(sc);
    });
  };
  LokalSpeicher.prototype.baustellenstand = async function () { return null; }; // Testbetrieb: erfundene Daten, kein Stand
  LokalSpeicher.prototype.kmlListe = async function () { return []; };

  TK.erzeugeSpeicher = function (cfg) {
    return cfg.scriptUrl ? new DriveSpeicher(cfg.scriptUrl, cfg.zugang) : new LokalSpeicher();
  };
})(typeof window !== 'undefined' ? window : globalThis);
