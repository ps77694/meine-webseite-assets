/* Transportkarte – Bedienoberfläche */
(function () {
  'use strict';
  var CFG = window.TK_EINSTELLUNGEN || {};
  // Nur für Tests auf dem eigenen Rechner: ?scriptUrl=…&zugang=… überschreibt die Einstellungen
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    var qs = new URLSearchParams(location.search);
    if (qs.get('scriptUrl')) { CFG.scriptUrl = qs.get('scriptUrl'); CFG.zugang = qs.get('zugang') || ''; }
  }
  // Kennwort steht nicht in der Seite: einmal eingeben, dann in diesem Browser gemerkt
  var ZUGANG_SCHLUESSEL = 'transportkarte-zugang';
  function leseGemerkt() { try { return localStorage.getItem(ZUGANG_SCHLUESSEL) || ''; } catch (e) { return ''; } }
  function merke(k) { try { if (k) localStorage.setItem(ZUGANG_SCHLUESSEL, k); else localStorage.removeItem(ZUGANG_SCHLUESSEL); } catch (e) { /* nur für diese Sitzung */ } }
  if (!CFG.zugang) CFG.zugang = leseGemerkt();
  var speicher = TK.erzeugeSpeicher(CFG);
  var $ = function (id) { return document.getElementById(id); };
  var heute = new Date(); heute.setHours(0, 0, 0, 0);

  /* ---------- Symbole: eigene Linien-Symbole, alle mit gleicher Strichstärke ---------- */
  var SYM = {
    plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
    pdf: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>',
    cloud: '<path d="M7 18a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 8.5a4.5 4.5 0 0 1 .5 9.5z"/>',
    pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
    suche: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
    pfeilR: '<path d="M9 5l7 7-7 7"/>', haken: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    warn: '<path d="M12 3.5L2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.3"/>',
    zu: '<path d="M6 6l12 12M18 6L6 18"/>', korr: '<path d="M4 20l1-4L16 5l3 3L8 19z"/>',
    neu: '<path d="M19 8a7.5 7.5 0 1 0 1.2 6"/><path d="M20 3v5h-5"/>',
    weg: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
    eigen: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.2 16.8C12 15 9 10 12 9s4-1 4-1.5"/>',
    form: '<path d="M5 6h14M5 12h14M5 18h9"/>'
  };
  function ic(n, px) { return '<svg class="sym" width="' + (px || 22) + '" height="' + (px || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + SYM[n] + '</svg>'; }
  Array.prototype.forEach.call(document.querySelectorAll('[data-ic]'), function (e) { e.outerHTML = ic(e.getAttribute('data-ic'), +e.getAttribute('data-px') || 22); });

  var zustand = { metas: [], aktiv: null, eintrag: null, baustellen: [], korr: null, kml: null, auswahl: [], farben: {}, voll: {}, laedt: {}, geladen: false, breiteHand: false };

  /* ---------- Auswahl: welche Bescheide auf der Karte stehen ---------- */
  // 8 Farben, die sich von Rot, Orange, Grün (Baustellen) und Violett (eigene Strecken) abheben; ab dem 9. Bescheid wiederholen sie sich
  var STRECKENFARBEN = ['#0b57d0', '#00a6c8', '#e0218a', '#6d4c41', '#212121', '#e6b800', '#78909c', '#1a237e'];
  var AUSWAHL_SCHLUESSEL = 'transportkarte-auswahl';
  function ladeAuswahl() {
    try {
      var d = JSON.parse(localStorage.getItem(AUSWAHL_SCHLUESSEL) || 'null');
      if (d && Array.isArray(d.auswahl)) zustand.auswahl = d.auswahl.filter(function (x) { return typeof x === 'string'; });
      if (d && d.farben && typeof d.farben === 'object') Object.keys(d.farben).forEach(function (k) { if (typeof d.farben[k] === 'number') zustand.farben[k] = d.farben[k]; });
    } catch (e) { /* ohne Merken */ }
  }
  function merkeAuswahl() { try { localStorage.setItem(AUSWAHL_SCHLUESSEL, JSON.stringify({ auswahl: zustand.auswahl, farben: zustand.farben })); } catch (e) { /* nur für diese Sitzung */ } }
  function istAngekreuzt(id) { return zustand.auswahl.indexOf(id) >= 0; }
  // Eigene Strecken (ohne Bescheid, Kennung EIGEN-…) haben eigene Farben (Violett), damit man sie von Bescheiden unterscheidet
  var EIGENFARBEN = ['#7b3fb0', '#4a2a7a', '#a77fd6'];
  function istEigenId(id) { return /^EIGEN-/.test(String(id)); }
  function farbeVon(id) { return istEigenId(id) ? EIGENFARBEN[(zustand.farben[id] || 0) % EIGENFARBEN.length] : STRECKENFARBEN[(zustand.farben[id] || 0) % STRECKENFARBEN.length]; }
  // Jeder Bescheid bekommt einmal eine feste Farbe (bleibt beim Filtern gleich); entfernte Bescheide fallen aus der Auswahl
  function gleicheAuswahlAb() {
    var ids = {}; zustand.metas.forEach(function (m) { ids[m.id] = true; });
    zustand.auswahl = zustand.auswahl.filter(function (id) { return ids[id]; });
    Object.keys(zustand.farben).forEach(function (id) { if (!ids[id]) delete zustand.farben[id]; });
    Object.keys(zustand.voll).forEach(function (id) { if (!ids[id]) ungueltig(id); });
    var zaehl = STRECKENFARBEN.map(function () { return 0; }), zaehlE = EIGENFARBEN.map(function () { return 0; });
    Object.keys(zustand.farben).forEach(function (id) { if (istEigenId(id)) zaehlE[zustand.farben[id] % EIGENFARBEN.length]++; else zaehl[zustand.farben[id] % STRECKENFARBEN.length]++; });
    zustand.metas.map(function (m) { return m.id; }).sort().forEach(function (id) {
      if (zustand.farben[id] != null) return;
      var z = istEigenId(id) ? zaehlE : zaehl, best = 0; z.forEach(function (n, i) { if (n < z[best]) best = i; });
      zustand.farben[id] = best; z[best]++;
    });
    merkeAuswahl();
  }
  function ausgewaehlteMetas() {
    var l = zustand.metas.filter(function (m) { return istAngekreuzt(m.id); });
    if (zustand.eintrag && zustand.eintrag.meta && !l.some(function (m) { return m.id === zustand.eintrag.meta.id; })) l.push(zustand.eintrag.meta);
    return l;
  }
  function breitestes() {
    var best = null;
    ausgewaehlteMetas().forEach(function (m) { if (typeof m.breite === 'number' && isFinite(m.breite) && (!best || m.breite > best.breite)) best = m; });
    return best;
  }
  // Volle Strecke (nicht die vereinfachte 'grob'-Linie) jedes angekreuzten Bescheids: wird je Bescheid einmal geladen und zwischengehalten
  function ungueltig(id) { delete zustand.voll[id]; delete zustand.laedt[id]; }
  function ladeVolle() {
    zustand.auswahl.forEach(function (id) {
      if (istOffen(id) || zustand.voll[id] !== undefined || zustand.laedt[id]) return;
      var marke = {}; zustand.laedt[id] = marke;
      speicher.hole(id).then(function (e) { return e.ergebnis.teile.map(function (t) { return t.coords; }); }, function () { return false; }).then(function (linien) {
        if (zustand.laedt[id] !== marke) return;
        delete zustand.laedt[id]; zustand.voll[id] = linien;
        zeichneAlle(); filtereBaustellen();
      });
    });
  }
  // Bescheide, deren volle Strecke noch lädt (der Filter wartet darauf)
  function streckenLaden() {
    return zustand.auswahl.some(function (id) { return !istOffen(id) && zustand.voll[id] === undefined; });
  }
  function istOffen(id) { return !!(zustand.eintrag && zustand.eintrag.meta && zustand.eintrag.meta.id === id); }
  ladeAuswahl();

  /* ---------- Karte ---------- */
  var map = L.map('karte', { zoomControl: false }).setView([51.16, 10.45], 7);
  L.DomEvent.disableClickPropagation($('legende')); L.DomEvent.disableScrollPropagation($('legende'));
  L.control.zoom({ position: 'topleft', zoomInTitle: 'Karte vergrößern', zoomOutTitle: 'Karte verkleinern' }).addTo(map);
  L.tileLayer(CFG.kacheln || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: CFG.kachelnHinweis || '© OpenStreetMap-Mitwirkende' }).addTo(map);
  map.attributionControl.addAttribution('Strecken: berechnet, ohne Gewähr');
  var ebeneAlle = L.layerGroup().addTo(map), ebeneStrecke = L.layerGroup().addTo(map), ebeneHinweise = L.layerGroup().addTo(map),
    ebeneKorr = L.layerGroup().addTo(map), ebeneEigen = L.layerGroup().addTo(map), ebeneBaustellen = L.layerGroup().addTo(map), ebeneKml = L.layerGroup().addTo(map);

  /* ---------- Hilfen ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function zahl(v, n) { return v == null ? '–' : Number(v).toFixed(n == null ? 2 : n).replace('.', ','); }
  function datum(iso) { if (!iso) return '–'; var p = iso.slice(0, 10).split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }
  function dIso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function abgelaufen(m) { return m.gueltigBis && new Date(m.gueltigBis + 'T23:59:59') < heute; }
  var STUFE_TEXT = { gruen: 'Geprüft', gelb: 'Bitte prüfen', rot: 'Bitte prüfen!' };
  function stufeMarke(m) {
    if (m.eigen) return '<span class="marke grau">' + ic('eigen', 18) + ' Eigene Strecke</span>';
    if (m.vonHand && m.stufe === 'gruen') return '<span class="marke gruen">' + ic('haken', 18) + ' Von Hand geprüft</span>';
    return '<span class="marke ' + m.stufe + '">' + ic(m.stufe === 'gruen' ? 'haken' : 'warn', 18) + ' ' + (m.vonHand ? 'Von Hand – ' : '') + STUFE_TEXT[m.stufe] + '</span>';
  }
  function kurzOrt(s) { return String(s || '').replace(/\s*\(.*$/, '').replace(/^\d{4,5}\s+/, ''); }
  var meldungZeit = null;
  function meldung(text) {
    var e = $('meldung'); e.textContent = text; e.style.display = 'block';
    clearTimeout(meldungZeit); meldungZeit = setTimeout(function () { e.style.display = 'none'; }, 4500);
  }

  /* ---------- Speicher-Hinweis ---------- */
  function zeigeSpeicherart() {
    var h = $('speicherHinweis'), t = $('speicherText');
    if (speicher.art === 'drive') {
      if (speicher.verbunden === true) { t.textContent = 'Gespeichert in Google Drive'; h.className = ''; }
      else if (speicher.verbunden === false) { t.textContent = 'Keine Verbindung zu Google Drive'; h.className = 'test'; }
      else { t.textContent = 'Verbinde mit Google Drive …'; h.className = ''; }
    }
    else { t.textContent = 'Testbetrieb: Bescheide nur in diesem Browser gespeichert'; h.className = 'test'; }
  }

  /* ---------- Liste ---------- */
  async function ladeListe() {
    try {
      zustand.metas = await speicher.liste();
      if (speicher.art === 'drive') { speicher.verbunden = true; if (speicher.k) merke(speicher.k); zeigeSpeicherart(); }
    } catch (e) {
      if (speicher.art === 'drive') { speicher.verbunden = false; zeigeSpeicherart(); }
      if (speicher.art === 'drive' && /Zugang|Kennwort/i.test(e.message)) { zeigeAnmeldung(e.message); return; }
      zeigeMeldungFlaeche('<div class="leer">Die Bescheide konnten nicht geladen werden.<br>' + esc(e.message) + '<br><br><button class="knopf" id="nochmal">Nochmal versuchen</button></div>');
      $('nochmal').onclick = function () { zeigeMeldungFlaeche('<div class="leer">Lade …</div>'); ladeListe(); ladeBaustellen(); };
      return;
    }
    zustand.geladen = true;
    document.body.classList.remove('anmeldungAktiv');
    zeigeListe(); stelleFilterAuswahl();
    if (!zustand.eingepasst) { zustand.eingepasst = true; if (zustand.auswahl.length) passeKarteEin(); } // beim ersten Laden: gezeigte Strecken im Bild
  }
  // Statt der Tabelle eine Meldung zeigen (Laden, Fehler, Anmeldung, noch keine Bescheide)
  function zeigeMeldungFlaeche(html) { $('tabelle').style.display = 'none'; $('listeMeldung').style.display = ''; $('listeMeldung').innerHTML = html; }
  function zeigeAnmeldung(meldungText) {
    document.body.classList.add('anmeldungAktiv');
    var h = $('speicherHinweis'); $('speicherText').textContent = 'Anmeldung nötig'; h.className = 'test';
    var falsch = /falsch/i.test(meldungText) && speicher.k;
    zeigeMeldungFlaeche('<div class="leer anmeldung"><b>Bitte Kennwort eingeben</b><br>Die Bescheide sind mit einem Kennwort geschützt.' +
      (falsch ? '<br><span class="fehlerText">Das Kennwort stimmt nicht.</span>' : /gesperrt/i.test(meldungText) ? '<br><span class="fehlerText">' + esc(meldungText) + '</span>' : '') +
      '<br><br><input type="password" id="kennwort" autocomplete="current-password" aria-label="Kennwort"><br><br>' +
      '<button class="knopf voll" id="anmelden">Anmelden</button></div>');
    var feld = $('kennwort'); feld.focus();
    function los() { speicher.k = feld.value.trim(); if (!speicher.k) return; merke(''); zeigeMeldungFlaeche('<div class="leer">Lade …</div>'); ladeListe(); }
    $('anmelden').onclick = los;
    feld.onkeydown = function (ev) { if (ev.key === 'Enter') los(); };
  }
  function neuesteFassung(m) {
    if (m.eigen) return true;
    return !zustand.metas.some(function (x) { return x.antragsId === m.antragsId && x.id !== m.id && (x.version || '') > (m.version || ''); });
  }
  function gefiltert() {
    var q = $('suche').value.trim().toLowerCase(), g = $('filterGueltig').value, s = $('filterStufe').value;
    return zustand.metas.filter(function (m) {
      if (g === 'gueltig' && abgelaufen(m)) return false;
      if (g === 'abgelaufen' && !abgelaufen(m)) return false;
      if (s === 'pruefen' && (m.eigen || m.stufe === 'gruen')) return false;
      if (q) {
        var t = [m.id, m.antragsId, m.ladung, m.von, m.nach, m.behoerde, m.antragsteller, String(m.breite).replace('.', ','), m.eigen ? 'eigene strecke ohne bescheid' : ''].join(' ').toLowerCase();
        return q.split(/\s+/).every(function (w) { return t.indexOf(w) >= 0; });
      }
      return true;
    }).sort(function (a, b) { return (b.gueltigBis || '').localeCompare(a.gueltigBis || '') || a.id.localeCompare(b.id); });
  }
  function zeigeListe() {
    gleicheAuswahlAb();
    var l = gefiltert(), el = $('liste'), oben = el.scrollTop;
    document.body.classList.toggle('leerStart', zustand.geladen && !zustand.metas.length);
    if (!zustand.geladen) return;
    if (!zustand.metas.length) {
      zeigeMeldungFlaeche('<div class="leer gross2"><div><b>Noch kein Bescheid vorhanden</b><span class="t">Ziehen Sie eine PDF-Datei hierher oder drücken Sie auf den gelben Knopf.</span></div><button class="knopf gelb" id="hinzuLeer" type="button">' + ic('plus', 22) + ' Bescheid hinzufügen</button></div>');
      $('hinzuLeer').onclick = function () { $('datei').click(); };
    } else {
      $('tabelle').style.display = ''; $('listeMeldung').style.display = 'none';
      $('zeilen').innerHTML = l.length ? l.map(function (m) {
        var alt = !neuesteFassung(m), an = istAngekreuzt(m.id);
        return '<tr class="karte-eintrag' + (zustand.aktiv === m.id ? ' aktiv' : '') + '" data-id="' + esc(m.id) + '">' +
          '<td class="farbe"><span class="balken" style="background:' + (an ? farbeVon(m.id) : '#d0d5dd') + '"></span></td>' +
          '<td><label class="wahl schalter" title="Auf der Karte zeigen"><input type="checkbox" class="haken-karte" data-id="' + esc(m.id) + '" aria-label="Auf der Karte zeigen: ' + esc(m.ladung || 'Bescheid') + '"' + (an ? ' checked' : '') + '><span class="wahltext">' + (an ? 'Gezeigt' : 'Aus') + '</span></label></td>' +
          '<td class="num nr">' + (esc(m.antragsId) || '–') + '</td>' +
          '<td class="num zweizeile fassung">' + (m.version ? esc(m.version) : '–') + (alt ? '<br><span class="tag" title="Es gibt eine neuere Fassung dieses Bescheids">ältere</span>' : '') + '</td>' +
          '<td class="strecke"><b class="titel">' + esc(m.ladung || 'Bescheid') + '</b><div class="z2">' + esc(kurzOrt(m.von)) + ' → ' + esc(kurzOrt(m.nach)) + (m.km ? ' · ' + m.km + ' km' : '') + '</div></td>' +
          '<td class="num breite">' + zahl(m.breite) + ' m</td>' +
          '<td class="num dat zweizeile">' + datum(m.gueltigBis) + (abgelaufen(m) ? '<br><span class="tag">abgelaufen</span>' : '') + '</td>' +
          '<td class="zweizeile">' + stufeMarke(m) + '</td>' +
          '<td class="c-einz"><button class="knopf einz" type="button">Einzelheiten ' + ic('pfeilR', 18) + '</button></td></tr>';
      }).join('') : '<tr><td colspan="9"><div class="leer">Kein Bescheid passt zur Suche.</div></td></tr>';
    }
    el.scrollTop = oben;
    zeigeAuswahlZahl();
    zeichneAlle();
  }
  // Schalter geändert: nur Zeile und Karte anpassen (Tabelle bleibt stehen)
  function aktualisiereZeilen() {
    Array.prototype.forEach.call(document.querySelectorAll('#zeilen .karte-eintrag'), function (tr) {
      var id = tr.dataset.id, an = istAngekreuzt(id), h = tr.querySelector('.haken-karte');
      h.checked = an; tr.querySelector('.wahltext').textContent = an ? 'Gezeigt' : 'Aus';
      tr.querySelector('.balken').style.background = an ? farbeVon(id) : '#d0d5dd';
    });
  }
  $('liste').addEventListener('click', function (ev) { if (ev.target.closest('.wahl')) return; var k = ev.target.closest('.karte-eintrag'); if (k) oeffne(k.dataset.id); });
  $('liste').addEventListener('change', function (ev) {
    var h = ev.target.closest('.haken-karte'); if (!h) return;
    var id = h.dataset.id, an = h.checked;
    zustand.auswahl = zustand.auswahl.filter(function (x) { return x !== id; });
    if (an) zustand.auswahl.push(id);
    uebernehmeAuswahl();
  });
  ['suche', 'filterGueltig', 'filterStufe'].forEach(function (id) { $(id).addEventListener('input', zeigeListe); });
  $('alleAnkreuzen').onclick = function () {
    gefiltert().forEach(function (m) { if (!istAngekreuzt(m.id)) zustand.auswahl.push(m.id); });
    zeigeListe(); uebernehmeAuswahl(); passeKarteEin();
  };
  $('keineAnkreuzen').onclick = function () {
    var weg = {}; gefiltert().forEach(function (m) { weg[m.id] = true; });
    zustand.auswahl = zustand.auswahl.filter(function (id) { return !weg[id]; });
    zeigeListe(); uebernehmeAuswahl();
  };
  function zeigeAuswahlZahl() {
    var n = zustand.auswahl.length, g = zustand.metas.length;
    $('auswahlZahl').textContent = g ? n + ' von ' + g + (g === 1 ? ' Strecke' : ' Strecken') + ' gezeigt' : '';
    var k = $('nachweisKnopf');
    k.disabled = n === 0;
    $('nachweisUnter').textContent = n === 0 ? (g ? 'Bitte zuerst eine Strecke zeigen' : 'erst nach dem ersten Bescheid') : n === 1 ? 'für die gezeigte Strecke' : 'für die ' + n + ' gezeigten Strecken';
    $('leiste').classList.toggle('start', !g && !zustand.kml);
  }
  // Auswahl hat sich geändert: merken, Karte, Baustellenfilter und Legende anpassen
  function uebernehmeAuswahl() {
    gleicheAuswahlAb(); aktualisiereZeilen(); zeigeAuswahlZahl(); zeichneAlle(); stelleFilterAuswahl();
  }
  /* ---------- Baustellen-Nachweis (PDF) ---------- */
  // Volle Linien einer gezeigten Strecke (wie auf der Karte: der geöffnete Bescheid bzw. die Korrektur, sonst die geladene volle Strecke)
  async function nachweisLinien(m) {
    if (istOffen(m.id)) {
      if (zustand.korr && zustand.korr.coords) return { linien: [zustand.korr.coords] };
      var c = []; zustand.eintrag.ergebnis.teile.forEach(function (t) { c = c.concat(t.coords); }); return { linien: [c] };
    }
    if (Array.isArray(zustand.voll[m.id])) return { linien: zustand.voll[m.id] };
    try { var e = await speicher.hole(m.id); return { linien: e.ergebnis.teile.map(function (t) { return t.coords; }) }; }
    catch (x) { return m.grob && m.grob.length ? { linien: [m.grob], ungefaehr: true } : { linien: [] }; }
  }
  var nachweisLaeuft = false;
  $('nachweisKnopf').onclick = async function () {
    if (nachweisLaeuft || !ausgewaehlteMetas().length) return;
    nachweisLaeuft = true; var k = $('nachweisKnopf'), unter = $('nachweisUnter'), alt = unter.textContent; k.disabled = true; unter.textContent = 'wird erstellt …';
    try {
      // frische Baustellen und deren Stand zum Zeitpunkt der Abfrage
      var jetzt = new Date(), stand = null, standHinweis = '';
      try {
        var daten = await speicher.baustellen();
        if (!Array.isArray(daten)) throw new Error(daten && daten.error || 'keine Liste');
        zustand.baustellen = normBaustellen(daten); zustand.baustellenRoh = daten.length; zustand.baustellenFehler = false;
      } catch (e) { throw new Error('Die Baustellen konnten nicht geladen werden. Bitte später noch einmal versuchen.'); }
      var testbetrieb = speicher.art !== 'drive';
      if (testbetrieb) standHinweis = 'Testbetrieb - erfundene Beispieldaten, kein Stand';
      else { stand = await speicher.baustellenstand(); if (!stand) standHinweis = 'nicht abrufbar'; }
      // Reihenfolge wie in der Tabelle (Gültig bis, neueste zuerst), damit "Strecke 1" im Nachweis der obersten gezeigten Zeile entspricht
      var metas = ausgewaehlteMetas().slice().sort(function (a, b) { return (b.gueltigBis || '').localeCompare(a.gueltigBis || '') || a.id.localeCompare(b.id); }), strecken = [];
      for (var i = 0; i < metas.length; i++) {
        var m = metas[i], l = await nachweisLinien(m);
        strecken.push({ id: m.id, farbe: farbeVon(m.id), eigen: !!m.eigen, name: m.ladung || (m.eigen ? 'Eigene Strecke' : 'Bescheid'), antragsId: m.antragsId, version: m.version, breite: typeof m.breite === 'number' ? m.breite : null,
          gueltigVon: m.gueltigVon, gueltigBis: m.gueltigBis, von: m.von, nach: m.nach, km: m.km, linien: l.linien, ungefaehr: !!l.ungefaehr });
      }
      var wo = $('wo').value, ueberall = wo === 'alle', km = ueberall ? (CFG.entlangKm || 2) : parseFloat(wo);
      var r = await TK.nachweis.erstelle({
        jetzt: jetzt, stand: stand, standHinweis: standHinweis, testbetrieb: testbetrieb, korridorKm: km, korridorHinweis: ueberall ? 'Auswahl „Überall“ gilt im Nachweis als ' + km + ' km' : '',
        von: $('zeitVon').value, bis: $('zeitBis').value, abstand: CFG.sicherheitsabstand == null ? 0.5 : CFG.sicherheitsabstand,
        baustellen: zustand.baustellen, baustellenRoh: zustand.baustellenRoh, strecken: strecken, kacheln: CFG.kacheln, kachelnHinweis: CFG.kachelnHinweis
      }, { libBasis: 'lib/' });
      zustand.letzterNachweis = r;
      meldung('Der Baustellen-Nachweis wurde erstellt: ' + r.name);
    } catch (e) {
      console.warn('Nachweis:', e); meldung('Der Nachweis konnte nicht erstellt werden. ' + (e && e.message ? e.message : ''));
    } finally { nachweisLaeuft = false; zeigeAuswahlZahl(); if (unter.textContent === 'wird erstellt …') unter.textContent = alt; }
  };

  // Beschriftung "Ladung · Breite" in der Mitte der längsten Linie (Farbkante = Farbe der Strecke)
  function etikett(teile, m, ebene) {
    var best = null; teile.forEach(function (t) { if (t && t.length > 1 && (!best || t.length > best.length)) best = t; });
    if (!best) return;
    L.marker(best[Math.floor(best.length / 2)], { interactive: false, keyboard: false, icon: L.divIcon({ className: '', iconSize: [0, 0], html: '<div class="tk-etikett" style="border-left-color:' + farbeVon(m.id) + '">' + esc(m.ladung || 'Bescheid') + ' · ' + zahl(m.breite) + ' m</div>' }) }).addTo(ebene);
  }
  // Angekreuzte Strecken (ohne den geöffneten Bescheid, der in voller Genauigkeit gezeichnet wird) in ihrer Farbe, mit weißem Rand
  function zeichneAlle() {
    ebeneAlle.clearLayers();
    ausgewaehlteMetas().forEach(function (m) {
      if (istOffen(m.id)) return;
      var teile = Array.isArray(zustand.voll[m.id]) ? zustand.voll[m.id] : (m.grob && m.grob.length ? [m.grob] : []); // grob nur, solange die volle Strecke lädt
      etikett(teile, m, ebeneAlle);
      teile.forEach(function (linie) {
        if (!linie.length) return;
        L.polyline(linie, { color: '#ffffff', weight: 10, opacity: .9, interactive: false }).addTo(ebeneAlle);
        var pl = L.polyline(linie, { color: farbeVon(m.id), weight: 5, opacity: .95 }).addTo(ebeneAlle);
        pl.bindTooltip(esc(m.ladung) + ' – ' + zahl(m.breite) + ' m', { sticky: true });
        pl.on('click', function () { oeffne(m.id); });
      });
    });
    // der geöffnete Bescheid bzw. die Korrektur liegt immer oben (nicht unter den anderen gezeigten Strecken)
    [ebeneStrecke, ebeneKorr].forEach(function (g) { g.eachLayer(function (l) { if (l.bringToFront) l.bringToFront(); }); });
    ladeVolle();
  }

  /* ---------- Einen Bescheid öffnen ---------- */
  async function oeffne(id) {
    if (zustand.korr || zustand.setzt) return;
    eigeneFormAus();
    zustand.aktiv = id;
    if (!istAngekreuzt(id)) { zustand.auswahl.push(id); merkeAuswahl(); }
    zeigeListe();
    var m = zustand.metas.filter(function (x) { return x.id === id; })[0];
    $('detail').innerHTML = panelHuelle('<div><h2>' + esc((m && m.ladung) || 'Bescheid') + '</h2></div>', '<p>Lade Strecke …</p>', '');
    zeigeDetailFlaeche(true);
    $('detailZu').onclick = schliesse;
    try {
      zustand.eintrag = await speicher.hole(id);
      ungueltig(id);
    } catch (e) {
      $('detail').innerHTML = panelHuelle('<div><h2>Einzelheiten</h2></div>', '<p class="fehlerText">Fehler: ' + esc(e.message) + '</p>', '');
      $('detailZu').onclick = schliesse; return;
    }
    zeigeDetail();
    zeichneStrecke(true);
    stelleFilterAuswahl();
  }
  function schliesse() {
    eigeneFormAus();
    zustand.aktiv = null; zustand.eintrag = null;
    ebeneStrecke.clearLayers(); ebeneHinweise.clearLayers();
    zeigeDetailFlaeche(false);
    zeigeListe(); filtereBaustellen(); zeigeLegende();
  }
  function zeigeDetailFlaeche(an) {
    $('detail').style.display = an ? 'block' : 'none';
    document.body.classList.toggle('mitDetail', an);
    map.invalidateSize();
  }
  function panelHuelle(kopf, koerper, fuss) {
    return '<div class="pw"><div class="pkopf">' + kopf + '<button class="knopf" id="detailZu" type="button">' + ic('zu', 20) + ' Schließen</button></div><div class="pkoerper">' + koerper + '</div>' + (fuss ? '<div class="pfuss">' + fuss + '</div>' : '') + '</div>';
  }

  function zeigeDetail() {
    if (zustand.eintrag.bescheid.eigen) { zeigeDetailEigen(); return; }
    var e = zustand.eintrag, b = e.bescheid, r = e.ergebnis, m = e.meta;
    var befunde = [];
    r.teile.forEach(function (t, i) { t.pruefung.befunde.forEach(function (x) { befunde.push(Object.assign({ teil: r.teile.length > 1 ? 'Abschnitt ' + (i + 1) + ': ' : '' }, x)); }); });
    var stufe = r.stufe;
    var kopf = stufe === 'gruen' ? 'Die Strecke passt zum Bescheid.' : stufe === 'gelb' ? 'Die Strecke bitte an den markierten Stellen prüfen.' : 'Die Strecke weicht vom Bescheid ab. Bitte prüfen und korrigieren.';
    var strassen = r.teile.map(function (t) {
      return t.items.map(function (it) {
        var name = it.art === 'knoten' ? ({ A: 'AS', K: 'AK', D: 'AD' }[it.typ] + ' ' + it.name) : (it.refs.join('/') + (it.name ? ' ' + it.name : '')).trim();
        var ok = it.art === 'knoten' ? it.passiert : it.benutzt;
        return '<span class="' + (ok === false ? 'nein' : '') + '" title="' + (ok === false ? 'nicht auf der berechneten Strecke' : 'auf der Strecke') + '">' + (ok === false ? '✗ ' : '✓ ') + esc(name) + '</span>';
      }).join('');
    }).join('<br>');
    var lt = b.teile.filter(function (t) { return t.lastfahrt; });
    var pdfUrl = m.pdfUrl || (zustand.metas.filter(function (x) { return x.id === m.id; })[0] || {}).pdfUrl || '';
    var kopfH = '<div><h2>' + esc(b.ladung.text || 'Bescheid') + '</h2><div class="unter">Bescheid Nr. ' + esc(b.antragsId) + (b.version ? ', Fassung ' + esc(b.version) : '') + (b.behoerde ? ' · ' + esc(b.behoerde) : '') + '</div></div>';
    var koerper =
      '<div class="kacheln"><button class="kachel voll" id="korrKnopf" type="button">' + ic('korr', 28) + 'Strecke korrigieren</button>' +
      '<button class="kachel" id="neuKnopf" type="button">' + ic('neu', 28) + '<span id="neuText">Strecke neu berechnen</span></button>' +
      (pdfUrl ? '<a class="kachel" target="_blank" rel="noopener" href="' + esc(pdfUrl) + '">' + ic('pdf', 28) + 'PDF öffnen</a>' : '') +
      (zustand.eintrag.pdf ? '<button class="kachel" id="pdfLokal" type="button">' + ic('pdf', 28) + 'PDF öffnen</button>' : '') + '</div>' +
      '<dl><dt>Fahrzeugbreite</dt><dd class="gr">' + zahl(b.breite) + ' m</dd>' +
      (b.lastfahrt.laenge ? '<dt>Länge</dt><dd>' + zahl(b.lastfahrt.laenge) + ' m</dd>' : '') +
      (b.lastfahrt.hoehe ? '<dt>Höhe</dt><dd>' + zahl(b.lastfahrt.hoehe) + ' m</dd>' : '') +
      (b.lastfahrt.gewicht ? '<dt>Gewicht</dt><dd>' + zahl(b.lastfahrt.gewicht, 1) + ' t</dd>' : '') +
      '<dt>Gültig</dt><dd>' + datum(b.gueltigVon) + ' bis ' + datum(b.gueltigBis) + (abgelaufen(m) ? ' <span class="tag">abgelaufen</span>' : '') + '</dd>' +
      '<dt>Von</dt><dd>' + esc(TK.ortText(lt[0].start)) + '</dd>' +
      '<dt>Nach</dt><dd>' + esc(TK.ortText(lt[lt.length - 1].ziel)) + '</dd>' +
      '<dt>Lastfahrt</dt><dd>' + zahl(r.teile.reduce(function (a, t) { return a + t.distKm; }, 0), 0) + ' km</dd></dl>' +
      '<h3>Prüfergebnis ' + stufeMarke(m) + '</h3><div style="font-weight:600;margin-bottom:2px">' + kopf + '</div>' +
      befunde.map(function (x) { return '<div class="befund ' + x.stufe + '">' + ic(x.stufe === 'gruen' ? 'haken' : 'warn', 22) + '<span>' + esc(x.teil + x.text) + '</span></div>'; }).join('') +
      '<h3>Straßen laut Bescheid</h3><div class="strassen">' + strassen + '</div>' +
      '<details><summary>Text im Bescheid</summary>' + lt.map(function (t) { return '<div class="unter">' + t.segmente.map(esc).join('<br>') + '</div>'; }).join('<hr>') + '</details>' +
      '<p class="unter">Die Strecke wird aus dem Text des Bescheids berechnet. Maßgeblich bleibt immer der Bescheid selbst.</p>';
    $('detail').innerHTML = panelHuelle(kopfH, koerper, '<button class="knopf gefahr" id="wegKnopf" type="button" style="width:100%">' + ic('weg', 20) + ' Bescheid entfernen</button>');
    $('detailZu').onclick = schliesse;
    $('korrKnopf').onclick = starteKorrektur;
    $('neuKnopf').onclick = neuBerechnen;
    $('wegKnopf').onclick = entfernen;
    if ($('pdfLokal')) $('pdfLokal').onclick = function () { window.open(URL.createObjectURL(zustand.eintrag.pdf), '_blank'); };
  }

  function zeichneStrecke(zoom) {
    ebeneStrecke.clearLayers(); ebeneHinweise.clearLayers();
    var e = zustand.eintrag; if (!e) return;
    var grenzen = L.latLngBounds([]);
    e.ergebnis.teile.forEach(function (t) {
      L.polyline(t.coords, { color: '#ffffff', weight: 14, opacity: .9 }).addTo(ebeneStrecke);
      var pl = L.polyline(t.coords, { color: farbeVon(e.meta.id), weight: 8, opacity: .95 }).addTo(ebeneStrecke);
      etikett([t.coords], e.meta, ebeneStrecke);
      pl.bindTooltip('Lastfahrt: ' + esc(e.bescheid.ladung.text) + ', ' + zahl(e.bescheid.breite) + ' m', { sticky: true });
      grenzen.extend(pl.getBounds());
      L.circleMarker(t.coords[0], { radius: 9, color: '#000', weight: 3, fillColor: '#fff', fillOpacity: 1 }).bindTooltip('Start: ' + esc(t.start.text)).addTo(ebeneStrecke);
      L.circleMarker(t.coords[t.coords.length - 1], { radius: 9, color: '#188038', weight: 3, fillColor: '#fff', fillOpacity: 1 }).bindTooltip('Ziel: ' + esc(t.ziel.text)).addTo(ebeneStrecke);
      t.pruefung.befunde.forEach(function (x) {
        if (!x.ort || x.stufe === 'gruen') return;
        L.marker(x.ort, { icon: L.divIcon({ className: 'hinweis-icon', html: '!', iconSize: [28, 28] }) }).bindTooltip(esc(x.text), { className: 'hinweisTip', direction: 'auto' }).addTo(ebeneHinweise);
      });
    });
    if (zoom && grenzen.isValid()) map.fitBounds(grenzen, { padding: [40, 40] });
    zeichneAlle();
    filtereBaustellen();
  }

  /* ---------- Filter nach Bescheid ---------- */
  // Breite = breitestes angekreuztes Fahrzeug (+ Sicherheitsabstand), Zeitraum = frühester Beginn bis spätestes Ende aller angekreuzten
  function stelleFilterAuswahl() {
    var l = ausgewaehlteMetas(), m = breitestes();
    if (!m) { filtereBaustellen(); zeigeLegende(); return; }
    var zu = CFG.sicherheitsabstand == null ? 0.5 : CFG.sicherheitsabstand;
    var wert = Math.ceil((m.breite + zu) * 10 - 1e-6) / 10;
    setzeBreite(wert); zustand.breiteHand = false;
    $('breiteHerkunft').innerHTML = 'breitester Transport<br>' + zahl(m.breite) + ' m + ' + zahl(zu) + ' m';
    $('breiteHerkunft').title = (Math.abs(wert - (m.breite + zu)) > 1e-6 ? 'Auf ' + zahl(wert, 1) + ' m aufgerundet. ' : '') + (l.length > 1 ? 'Nach dem breitesten gezeigten Fahrzeug: ' + (m.ladung || 'Bescheid') + ', ' : 'Nach dem Bescheid: ') + zahl(m.breite) + ' m Breite + ' + zahl(zu) + ' m Sicherheitsabstand';
    $('breiteAuto').style.display = 'none';
    var vons = l.map(function (x) { return x.gueltigVon; }).filter(Boolean).sort(), biss = l.map(function (x) { return x.gueltigBis; }).filter(Boolean).sort();
    if (vons.length && biss.length) {
      var von = new Date(vons[0]), bis = new Date(biss[biss.length - 1]);
      if (bis >= heute && von < heute) von = heute;
      $('zeitVon').value = dIso(von); $('zeitBis').value = dIso(bis);
    }
    filtereBaustellen(); zeigeLegende();
  }

  function setzeBreite(w) { $('breiteRegler').value = w; $('breiteWert').textContent = zahl(w, 1) + ' m'; }
  /* ---------- Baustellen ---------- */
  function deDatum(s) { if (!s) return null; var p = String(s).split('.'); if (p.length !== 3) return null; var y = parseInt(p[2], 10); if (y < 100) y += 2000; return new Date(y, parseInt(p[1], 10) - 1, parseInt(p[0], 10)); }
  function erstesLink(b) {
    for (var k in b) { if (Object.prototype.hasOwnProperty.call(b, k) && typeof b[k] === 'string' && /^\s*https?:\/\/\S+\s*$/i.test(b[k])) return b[k].trim(); }
    return '';
  }
  function normBaustellen(data) {
    return data.map(function (b) {
      var lat = parseFloat(String(b.latitude || '').replace(',', '.')), lng = parseFloat(String(b.longitude || '').replace(',', '.')), br = parseFloat(String(b.Max_Breite_m).replace(',', '.'));
      if (isNaN(lat) || isNaN(lng) || isNaN(br)) return null;
      return { lat: lat, lng: lng, breite: br, beginn: deDatum(b.Beginn), ende: deDatum(b.Ende), titel: b.title || 'Baustelle', info: b.Info || '', roh: b, link: erstesLink(b), beginnText: b.Beginn || '?', endeText: b.Ende || '?' };
    }).filter(Boolean);
  }
  async function ladeBaustellen() {
    try {
      var data = await speicher.baustellen();
      if (!Array.isArray(data)) throw new Error(data && data.error || 'keine Liste');
      zustand.baustellen = normBaustellen(data); zustand.baustellenRoh = data.length; zustand.baustellenFehler = false;
    } catch (e) { console.warn('Baustellen:', e); zustand.baustellen = []; zustand.baustellenRoh = 0; zustand.baustellenFehler = true; $('baustellenZahl').textContent = 'Baustellen konnten nicht geladen werden.'; }
    filtereBaustellen();
  }
  function farbe(b) {
    var w = breitestes(), br = w && w.breite;
    if (br) {
      var zu = CFG.sicherheitsabstand == null ? 0.5 : CFG.sicherheitsabstand;
      return b.breite < br ? '#c5221f' : b.breite < br + zu ? '#e37400' : '#188038';
    }
    return b.breite <= 3.5 ? '#c5221f' : b.breite <= 5 ? '#e37400' : '#188038';
  }
  // Alle Linien, entlang derer Baustellen gezeigt werden: jede angekreuzte Strecke einzeln (der geöffnete in voller Genauigkeit), sonst die KML-Strecke
  function streckeAktiv() {
    var linien = [];
    ausgewaehlteMetas().forEach(function (m) {
      if (istOffen(m.id)) {
        if (zustand.korr && zustand.korr.coords) { linien.push(zustand.korr.coords); return; }
        var c = []; zustand.eintrag.ergebnis.teile.forEach(function (t) { c = c.concat(t.coords); }); linien.push(c);
      } else if (Array.isArray(zustand.voll[m.id])) zustand.voll[m.id].forEach(function (l) { linien.push(l); });
      else if (zustand.voll[m.id] === false && m.grob && m.grob.length) linien.push(m.grob); // volle Strecke nicht ladbar: Notlösung
    });
    if (linien.length) return linien;
    if (zustand.kml) return [zustand.kml];
    return null;
  }
  // wie streckeAktiv, aber mit Namen der Strecke (für das Klick-Fenster)
  function streckeAktivBenannt() {
    var out = [];
    ausgewaehlteMetas().forEach(function (m) {
      var nm = m.ladung || m.name || 'Strecke';
      if (istOffen(m.id)) {
        if (zustand.korr && zustand.korr.coords) { out.push({ name: nm, linie: zustand.korr.coords }); return; }
        var c = []; zustand.eintrag.ergebnis.teile.forEach(function (t) { c = c.concat(t.coords); }); out.push({ name: nm, linie: c });
      } else if (Array.isArray(zustand.voll[m.id])) zustand.voll[m.id].forEach(function (l) { out.push({ name: nm, linie: l }); });
      else if (zustand.voll[m.id] === false && m.grob && m.grob.length) out.push({ name: nm, linie: m.grob });
    });
    return out;
  }
  function abstandZuLinie(b, linie) {
    var p = [b.lat, b.lng], best = Infinity;
    for (var i = 1; i < linie.length; i++) { var d = TK.geo.distSeg(p, linie[i - 1], linie[i]); if (d < best) best = d; }
    return best;
  }
  function baustellenFenster(b, ampel, str) {
    var h = '';
    h += '<div class="bsf" style="max-height:' + Math.max(200, Math.min(520, map.getSize().y - 100)) + 'px"><h3>' + esc(b.titel) + '</h3>';
    if (ampel != null && str) {
      var t = ['zu eng', 'knapp', 'passt'][ampel], c = AMPELFARBE[ampel];
      h += '<div class="bsAmpel" style="color:' + c + '">' + t + (str.breite ? ' <span>für ' + zahl(str.breite) + ' m Fahrzeugbreite</span>' : '') + '</div>';
    }
    h += '<div><b>Durchfahrtsbreite:</b> ' + zahl(b.breite) + ' m</div><div><b>Zeitraum:</b> ' + esc(b.beginnText) + ' bis ' + esc(b.endeText) + '</div>';
    var best = null;
    streckeAktivBenannt().forEach(function (x) { var d = abstandZuLinie(b, x.linie); if (best == null || d < best.d) best = { d: d, name: x.name }; });
    if (best && isFinite(best.d)) h += '<div><b>Abstand zur Strecke:</b> ' + (best.d < 1000 ? Math.round(best.d) + ' m' : zahl(best.d / 1000, 1) + ' km') + ' (' + esc(best.name) + ')</div>';
    h += '<div class="bsTitel">Angaben aus der Baustellen-Datei</div><dl class="bsFelder">';
    var roh = b.roh || {}, lagegezeigt = false;
    Object.keys(roh).forEach(function (k) {
      if (k === 'latitude' || k === 'longitude') {
        if (!lagegezeigt) { lagegezeigt = true; h += '<dt>Lage</dt><dd>' + esc(roh.latitude) + '; ' + esc(roh.longitude) + '</dd>'; }
        return;
      }
      var v = roh[k], txt = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      if (/^\s*https?:\/\/\S+\s*$/i.test(txt)) h += '<dt>' + esc(k) + '</dt><dd><a href="' + esc(txt.trim()) + '" target="_blank" rel="noopener">Originalmeldung öffnen</a></dd>';
      else h += '<dt>' + esc(k) + '</dt><dd>' + esc(txt) + '</dd>';
    });
    return h + '</dl></div>';
  }
  function nahe(b, linie, km) {
    var p = [b.lat, b.lng], grenze = km * 1000, dLat = km / 111 + 0.01, dLon = dLat / Math.cos(b.lat * Math.PI / 180);
    for (var i = 1; i < linie.length; i++) {
      var a = linie[i - 1], c = linie[i];
      if (Math.min(a[0], c[0]) - dLat > p[0] || Math.max(a[0], c[0]) + dLat < p[0] || Math.min(a[1], c[1]) - dLon > p[1] || Math.max(a[1], c[1]) + dLon < p[1]) continue;
      if (TK.geo.distSeg(p, a, c) <= grenze) return true;
    }
    return false;
  }
  // Strecken in der Form, die TK.nachweis.klassifiziere erwartet (dieselbe Rechnung wie im Nachweis-PDF). Liefert null, solange volle Strecken noch laden.
  function rechenStrecken() {
    var out = [];
    ausgewaehlteMetas().forEach(function (m) {
      var linien;
      if (istOffen(m.id)) {
        if (zustand.korr && zustand.korr.coords) linien = [zustand.korr.coords];
        else { var c = []; zustand.eintrag.ergebnis.teile.forEach(function (t) { c = c.concat(t.coords); }); linien = [c]; }
      } else if (Array.isArray(zustand.voll[m.id])) linien = zustand.voll[m.id];
      else if (zustand.voll[m.id] === false && m.grob && m.grob.length) linien = [m.grob];
      else linien = [];
      out.push({ id: m.id, name: m.ladung || (m.eigen ? 'Eigene Strecke' : 'Bescheid'), eigen: !!m.eigen, breite: typeof m.breite === 'number' ? m.breite : null, gueltigVon: m.gueltigVon, gueltigBis: m.gueltigBis, linien: linien });
    });
    if (!out.length && zustand.kml) out.push({ id: 'kml', name: 'Gespeicherte Route', eigen: true, breite: null, gueltigVon: '', gueltigBis: '', linien: [zustand.kml] });
    return out;
  }
  var klassCache = { key: '', wert: null };
  function klassifiziere(strecken, ueberall, km, von, bis) {
    var zu = CFG.sicherheitsabstand == null ? 0.5 : CFG.sicherheitsabstand;
    var key = JSON.stringify([ueberall, km, von, bis, zu, zustand.baustellen.length, zustand.baustellen[0] && zustand.baustellen[0].titel,
      strecken.map(function (s) {
        // Prüfsumme über alle Punkte: eine korrigierte Strecke (gleiche Punktzahl, andere Lage) darf kein altes Ergebnis liefern
        var n = 0, sum = 0;
        s.linien.forEach(function (l) { n += l.length; l.forEach(function (p, i) { sum += (p[0] * 1.000003 + p[1] * 0.999991) * ((i % 97) + 1); }); });
        return [s.id, s.breite, s.gueltigVon, s.gueltigBis, s.linien.length, n, sum];
      })]);
    if (klassCache.key === key && klassCache.baustellen === zustand.baustellen) return klassCache.wert;
    var k = TK.nachweis.klassifiziere({ korridorKm: km, ueberall: ueberall, von: von, bis: bis, abstand: zu, baustellen: zustand.baustellen, strecken: strecken });
    // schlechteste Zeile je Baustelle (für das Klick-Fenster: welche Strecke bestimmt die Farbe)
    k.schlechteZeile = {}; k.zeilen.forEach(function (z) { var w = k.schlechteZeile[z.bi]; if (!w || z.a < w.a || (z.a === w.a && z.d < w.d)) k.schlechteZeile[z.bi] = z; });
    klassCache = { key: key, baustellen: zustand.baustellen, wert: k };
    return k;
  }
  var AMPELFARBE = ['#c5221f', '#e37400', '#188038'];
  function filtereBaustellen() {
    ebeneBaustellen.clearLayers();
    var max = parseFloat($('breiteRegler').value), nur = $('wo').value !== 'alle', km = nur ? parseFloat($('wo').value) : 0;
    var vonIso = $('zeitVon').value, bisIso = $('zeitBis').value;
    var von = vonIso ? new Date(vonIso + 'T00:00:00') : null, bis = bisIso ? new Date(bisIso + 'T23:59:59') : null;
    if (nur && streckenLaden()) { $('baustellenZahl').textContent = 'Strecken werden geladen …'; return; }
    var wBr = breitestes(), rot = 0, ausgeblendet = 0;
    var strecken = rechenStrecken(), mitStrecke = strecken.length > 0, k = null, n = 0, ungenau = zustand.auswahl.filter(function (id) { return !istOffen(id) && zustand.voll[id] === false; }).length;
    if (mitStrecke) k = klassifiziere(strecken, !nur, km, vonIso, bisIso);
    zustand.baustellen.forEach(function (b, bi) {
      var a = null, f;
      if (mitStrecke) {
        a = k.schlecht[bi]; if (a == null) return;   // trifft keine Strecke (Korridor/Zeitraum je Strecke)
        f = AMPELFARBE[a];
      } else {
        if (b.beginn && b.ende && von && bis && (b.beginn > bis || b.ende < von)) return;
        f = farbe(b);
      }
      if (b.breite > max) { ausgeblendet++; return; }   // der Breite-Regler blendet nur aus
      L.circleMarker([b.lat, b.lng], { radius: 8, color: '#fff', weight: 2, fillColor: f, fillOpacity: .95 })
        .bindTooltip('<b>' + esc(b.titel) + '</b><br>Breite: ' + zahl(b.breite) + ' m')
        .bindPopup(function () { return baustellenFenster(b, a, k && k.schlechteZeile[bi] ? strecken[k.schlechteZeile[bi].s] : null); }, { maxWidth: 420, minWidth: 300, className: 'bsPopup' })
        .addTo(ebeneBaustellen);
      n++; if (a === 0) rot++;
    });
    if (!zustand.baustellen.length) return;
    $('baustellenZahl').innerHTML = '<b>' + n + ' von ' + zustand.baustellen.length + '</b> Baustellen gezeigt' +
      (mitStrecke && wBr && wBr.breite ? '<br><span class="rot">' + rot + ' zu eng</span> für Ihren Transport' : '') +
      (!mitStrecke ? '<br><span class="unter">alle Baustellen im Zeitraum</span>' : '') +
      (mitStrecke && !nur ? '<br><span class="unter">Nachweis rechnet nur bis ' + (CFG.entlangKm || 2) + ' km</span>' : '') +
      (ungenau && nur ? '<span class="warn" title="Baustellen nahe der Strecke können fehlen. Bescheid anklicken für die genaue Strecke.">Achtung: ' + ungenau + (ungenau === 1 ? ' Strecke' : ' Strecken') + ' nur ungefähr geladen</span>' : '');
  }
  function zeigeLegende() {
    var l = ausgewaehlteMetas(), m = breitestes(), zu = CFG.sicherheitsabstand == null ? 0.5 : CFG.sicherheitsabstand;
    var punkt = function (f, t) { return '<span><span class="lp" style="background:' + f + '"></span>' + t + '</span>'; };
    $('legende').innerHTML = '<b>Baustellen:</b>' + (m && m.breite ?
      punkt('#c5221f', 'zu eng (schmaler als ' + zahl(m.breite) + ' m)') + punkt('#e37400', 'knapp (unter ' + zahl(zu) + ' m Luft)') + punkt('#188038', 'genug Platz') +
      (l.length > 1 ? '<span class="unter">breitester Transport: ' + esc(m.ladung || 'Bescheid') + ', ' + zahl(m.breite) + ' m</span>' : '') :
      punkt('#c5221f', 'bis 3,50 m (kritisch)') + punkt('#e37400', 'bis 5,00 m (eng)') + punkt('#188038', 'über 5,00 m'));
  }
  // Breite von Hand: Eingabe-Ereignis des (versteckten) Wertfelds; die Knöpfe - und + setzen den Wert und lösen es aus
  $('breiteRegler').addEventListener('input', function () {
    $('breiteWert').textContent = zahl(this.value, 1) + ' m'; zustand.breiteHand = true;
    $('breiteHerkunft').innerHTML = 'von Hand<br>eingestellt'; $('breiteHerkunft').title = '';
    $('breiteAuto').style.display = breitestes() ? '' : 'none';
    filtereBaustellen();
  });
  function breiteSchritt(d) {
    var v = Math.round((parseFloat($('breiteRegler').value) + d) * 10) / 10; v = Math.max(2, Math.min(15, v));
    $('breiteRegler').value = v; $('breiteRegler').dispatchEvent(new Event('input'));
  }
  [['breiteMinus', -0.1], ['breitePlus', 0.1]].forEach(function (x) {
    var knopf = $(x[0]), warte = null, takt = null;
    function stopp() { clearTimeout(warte); clearInterval(takt); warte = takt = null; }
    knopf.addEventListener('pointerdown', function (ev) { if (ev.button) return; breiteSchritt(x[1]); warte = setTimeout(function () { takt = setInterval(function () { breiteSchritt(x[1]); }, 90); }, 450); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (n) { knopf.addEventListener(n, stopp); });
    knopf.addEventListener('click', function (ev) { if (ev.detail === 0) breiteSchritt(x[1]); }); // Tastatur (Eingabetaste)
  });
  $('breiteAuto').onclick = function () { stelleFilterAuswahl(); };
  ['zeitVon', 'zeitBis', 'wo'].forEach(function (id) { $(id).addEventListener('change', filtereBaustellen); });

  /* ---------- Eigene KML-Strecken (wie bisher) ---------- */
  async function ladeKml() {
    try {
      var l = await speicher.kmlListe();
      if (!l || !l.length || !l[0].id) return;
      $('kmlWahl').style.display = '';
      l.forEach(function (r) { var o = document.createElement('option'); o.value = r.id; o.textContent = r.name; $('kmlWahl').appendChild(o); });
    } catch (e) { /* ohne KML */ }
  }
  $('kmlWahl').addEventListener('change', async function () {
    ebeneKml.clearLayers(); zustand.kml = null;
    if (!this.value) { zeigeAuswahlZahl(); filtereBaustellen(); return; }
    var d = await speicher.kml(this.value);
    var xml = new DOMParser().parseFromString(d.kml, 'text/xml'), alle = [];
    Array.prototype.forEach.call(xml.getElementsByTagName('coordinates'), function (n) {
      var line = n.textContent.trim().split(/\s+/).map(function (p) { var a = p.split(','); return [parseFloat(a[1]), parseFloat(a[0])]; }).filter(function (c) { return !isNaN(c[0]) && !isNaN(c[1]); });
      if (line.length) { L.polyline(line, { color: '#7b1fa2', weight: 5, opacity: .8 }).addTo(ebeneKml); alle = alle.concat(line); }
    });
    zustand.kml = alle; zeigeAuswahlZahl();
    if (alle.length) map.fitBounds(L.latLngBounds(alle), { padding: [40, 40] });
    filtereBaustellen();
  });

  /* ---------- Bescheide einlesen ---------- */
  var warteschlange = [], laeuft = false;
  function fortschritt(zeilen) {
    var f = $('fortschritt');
    if (!zeilen.length) { f.style.display = 'none'; return; }
    f.style.display = 'block';
    f.innerHTML = '<h3>Bescheide einlesen</h3>' + zeilen.map(function (z) { return '<div class="fz"><b>' + esc(z.name) + '</b><br>' + z.html + '</div>'; }).join('') +
      (zeilen.every(function (z) { return z.fertig; }) ? '<div class="knopfreihe"><button class="knopf" id="fortZu">Schließen</button></div>' : '');
    if ($('fortZu')) $('fortZu').onclick = function () { zeilenListe = []; fortschritt([]); };
  }
  var zeilenListe = [];
  function nimmDateien(files) {
    Array.prototype.forEach.call(files, function (f) {
      var z = { name: f.name, html: 'wartet …', fertig: false };
      zeilenListe.push(z); warteschlange.push({ datei: f, zeile: z });
    });
    fortschritt(zeilenListe);
    if (!laeuft) arbeite();
  }
  async function arbeite() {
    laeuft = true;
    while (warteschlange.length) {
      var job = warteschlange.shift(), z = job.zeile;
      function melde(t) { z.html = esc(t); fortschritt(zeilenListe); }
      try {
        melde('PDF lesen …');
        var buf = await job.datei.arrayBuffer();
        var xml = await TK.xmlAusPdf(buf);
        var b = TK.leseBescheid(xml);
        z.name = (b.ladung.text || 'Bescheid') + ' – Nr. ' + b.antragsId + (b.version ? ' (Fassung ' + b.version + ')' : '');
        if (zustand.metas.some(function (m) { return m.id === b.id; })) {
          z.html = '<span class="marke grau">schon gespeichert</span> – nicht doppelt eingelesen.'; z.fertig = true; fortschritt(zeilenListe); continue;
        }
        if (!b.teile.some(function (t) { return t.lastfahrt; })) throw new Error('Im Bescheid ist keine Lastfahrt eingetragen.');
        var erg = await TK.rekonstruiere(b, CFG.dienste, melde);
        melde('Speichern …');
        var istPdf = /\.pdf$/i.test(job.datei.name) || new Uint8Array(buf.slice(0, 4))[0] === 0x25;
        var meta = await speicher.speichere({ bescheid: b, ergebnis: erg, quelle: job.datei.name }, istPdf ? new Uint8Array(buf) : null, job.datei.name, xml);
        zustand.metas = zustand.metas.filter(function (m) { return m.id !== meta.id; }).concat([meta]);
        z.html = stufeMarke(meta) + ' Breite ' + zahl(b.breite) + ' m · ' + meta.km + ' km · <a href="#" data-oeffne="' + esc(meta.id) + '">auf der Karte zeigen</a>';
        z.fertig = true; zeigeListe();
        if (warteschlange.length === 0 && zeilenListe.filter(function (x) { return x.fertig; }).length === 1) oeffne(meta.id);
      } catch (e) {
        console.error(e);
        z.html = '<span class="marke rot">Nicht eingelesen</span> ' + esc(e.message); z.fertig = true;
      }
      fortschritt(zeilenListe);
    }
    laeuft = false;
  }
  $('fortschritt').addEventListener('click', function (ev) { var a = ev.target.closest('[data-oeffne]'); if (a) { ev.preventDefault(); oeffne(a.dataset.oeffne); } });
  $('hinzuKnopf').onclick = function () { $('datei').click(); };
  $('datei').onchange = function () { if (this.files.length) nimmDateien(this.files); this.value = ''; };
  var ziehZaehler = 0;
  window.addEventListener('dragenter', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0) { ziehZaehler++; $('ablegen').style.display = 'flex'; } });
  window.addEventListener('dragleave', function () { ziehZaehler = Math.max(0, ziehZaehler - 1); if (!ziehZaehler) $('ablegen').style.display = 'none'; });
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) {
    e.preventDefault(); ziehZaehler = 0; $('ablegen').style.display = 'none';
    var f = Array.prototype.filter.call(e.dataTransfer.files, function (x) { return /\.(pdf|xml)$/i.test(x.name); });
    if (f.length) nimmDateien(f); else if (e.dataTransfer.files.length) alert('Bitte Bescheide als PDF-Datei ablegen.');
  });

  /* ---------- Neu berechnen / Entfernen ---------- */
  async function neuBerechnen() {
    var e = zustand.eintrag;
    if (e.ergebnis.vonHand && !confirm('Die Strecke wurde von Hand korrigiert. Neu berechnen und die Korrektur verwerfen?')) return;
    var btn = $('neuKnopf'), bt = $('neuText'); btn.disabled = true; bt.textContent = 'Berechne …';
    try {
      if (e.bescheid.eigen) { // eigene Strecke: neu aus den gespeicherten Punkten
        var ein = await TK.eigeneEintrag(formAusEigen(e.bescheid), CFG.dienste, null);
        var metaE = await speicher.speichere(ein, null, '', null);
        ungueltig(metaE.id);
        zustand.metas = zustand.metas.filter(function (m) { return m.id !== metaE.id; }).concat([metaE]);
        await oeffne(metaE.id); return;
      }
      // Quelle: gespeichertes XML, sonst gespeicherte PDF, sonst das gespeicherte Ergebnis der letzten Einlesung
      var b = e.bescheid, xmlNeu = null, id = e.meta.id;
      try {
        var xml = await speicher.holeXml(id), quellArt = 'XML';
        if (!xml) {
          var pdf = await speicher.holePdf(id);
          if (pdf) { xml = await TK.xmlAusPdf(pdf); xmlNeu = xml; quellArt = 'PDF'; }
        }
        if (xml) {
          var nb = TK.leseBescheid(xml);
          if (nb.id === b.id) { b = nb; console.info('Neu berechnen: eingelesen aus gespeichertem ' + quellArt); }
          else { console.warn('Neu berechnen: gespeichertes ' + quellArt + ' passt nicht zum Bescheid, nehme gespeicherte Daten'); xmlNeu = null; }
        } else console.info('Neu berechnen: weder XML noch PDF gespeichert, nehme gespeicherte Daten');
      } catch (qx) { console.warn('Neu berechnen: XML/PDF nicht lesbar, nehme gespeicherte Daten – ' + qx.message); b = e.bescheid; xmlNeu = null; }
      var erg = await TK.rekonstruiere(b, CFG.dienste, function (t) { bt.textContent = t; });
      var meta = await speicher.speichere({ bescheid: b, ergebnis: erg, quelle: e.quelle }, null, '', xmlNeu);
      ungueltig(meta.id);
      zustand.metas = zustand.metas.filter(function (m) { return m.id !== meta.id; }).concat([meta]);
      await oeffne(meta.id);
    } catch (x) { alert('Neu berechnen fehlgeschlagen: ' + x.message); btn.disabled = false; bt.textContent = 'Strecke neu berechnen'; }
  }
  async function entfernen() {
    var m = zustand.eintrag.meta;
    if (!confirm((m.eigen ? 'Strecke „' + m.ladung + '“' : 'Bescheid „' + m.ladung + '“ (Nr. ' + m.antragsId + ')') + ' aus der Liste entfernen?' + (speicher.art === 'drive' ? '\n\nDie Dateien kommen in den Papierkorb von Google Drive und lassen sich dort wiederherstellen.' : ''))) return;
    try { await speicher.loesche(m.id); } catch (x) { alert('Entfernen fehlgeschlagen: ' + x.message); return; }
    zustand.metas = zustand.metas.filter(function (x) { return x.id !== m.id; });
    zustand.auswahl = zustand.auswahl.filter(function (x) { return x !== m.id; });
    ungueltig(m.id);
    schliesse();
  }

  /* ---------- Strecke von Hand korrigieren ---------- */
  function starteKorrektur() {
    var e = zustand.eintrag;
    zustand.korr = { teil: 0, wp: e.ergebnis.teile.map(function (t) { return t.wegpunkte.map(function (w) { return Object.assign({}, w); }); }), coords: null, rechnet: false };
    zeichneKorrektur();
    var bn = $('korrBanner');
    bn.style.display = 'block';
    bn.innerHTML = '<b>Strecke korrigieren</b><br>Punkte mit der Maus ziehen. Auf die blaue Linie klicken = neuer Punkt. Auf einen Punkt klicken = entfernen oder gerade Linie.' +
      '<div class="knopfreihe"><button class="knopf voll" id="korrFertig">Fertig – speichern</button><button class="knopf" id="korrAbbruch">Abbrechen</button><span id="korrStatus" class="unter"></span></div>';
    $('korrFertig').onclick = korrekturSpeichern;
    $('korrAbbruch').onclick = function () { endeKorrektur(); zeichneStrecke(false); };
    $('korrKnopf').disabled = true;
  }
  function endeKorrektur() { zustand.korr = null; ebeneKorr.clearLayers(); $('korrBanner').style.display = 'none'; if ($('korrKnopf')) $('korrKnopf').disabled = false; }
  function icon(art) { var s = art === 'start' || art === 'ziel' ? 26 : 22; return L.divIcon({ className: 'wp-icon' + (art === 'ziel' ? ' ende' : art === 'start' ? ' anfang' : ''), iconSize: [s, s] }); }
  function zeichneKorrektur() {
    ebeneKorr.clearLayers(); ebeneHinweise.clearLayers();
    var k = zustand.korr, e = zustand.eintrag;
    ebeneStrecke.clearLayers();
    e.ergebnis.teile.forEach(function (t, ti) {
      var coords = (k.neu && k.neu[ti]) ? k.neu[ti].coords : t.coords;
      L.polyline(coords, { color: '#ffffff', weight: 13, opacity: .9 }).addTo(ebeneKorr);
      var pl = L.polyline(coords, { color: '#0b57d0', weight: 7, opacity: .9 }).addTo(ebeneKorr);
      pl.on('click', function (ev) { punktEinfuegen(ti, ev.latlng); });
      k.wp[ti].forEach(function (w, wi) {
        var mk = L.marker(w.p, { draggable: true, icon: icon(w.art), title: w.text }).addTo(ebeneKorr);
        mk.bindTooltip(esc(w.art === 'start' ? 'Start' : w.art === 'ziel' ? 'Ziel' : w.text || 'Wegpunkt'));
        mk.on('dragend', function () { var ll = mk.getLatLng(); w.p = [ll.lat, ll.lng]; w.art = w.art === 'start' || w.art === 'ziel' ? w.art : 'hand'; rechneKorrektur(ti); });
        mk.on('click', function () {
          var istEnde = wi === k.wp[ti].length - 1, box = document.createElement('div');
          box.innerHTML = '<b>' + esc(w.art === 'start' ? 'Start' : w.art === 'ziel' ? 'Ziel' : w.text || 'Wegpunkt') + '</b><div class="knopfreihe" style="flex-direction:column;align-items:stretch">' +
            (istEnde ? '' : '<button class="knopf" data-a="gerade">' + (w.gerade ? 'Wieder nach Straßen berechnen' : 'Bis zum nächsten Punkt gerade Linie') + '</button>') +
            (w.art === 'start' || w.art === 'ziel' ? '' : '<button class="knopf gefahr" data-a="weg">Punkt entfernen</button>') + '</div>' +
            (istEnde ? '' : '<div class="unter" style="margin-top:6px">Gerade Linie: für Stellen, die kein Navi fährt (z. B. Gegenverkehr laut Bescheid).</div>');
          box.addEventListener('click', function (ev) {
            var a = ev.target.getAttribute('data-a'); if (!a) return;
            map.closePopup();
            if (a === 'weg') k.wp[ti].splice(wi, 1); else w.gerade = !w.gerade;
            rechneKorrektur(ti);
          });
          L.popup({ minWidth: 240 }).setLatLng(w.p).setContent(box).openOn(map);
        });
      });
    });
  }
  function punktEinfuegen(ti, ll) {
    var k = zustand.korr, wps = k.wp[ti], coords = (k.neu && k.neu[ti]) ? k.neu[ti].coords : zustand.eintrag.ergebnis.teile[ti].coords;
    // Lage auf der Linie -> zwischen welchen Wegpunkten
    function idx(p) { var bi = 0, bd = Infinity; coords.forEach(function (c, i) { var d = TK.geo.dist(p, c); if (d < bd) { bd = d; bi = i; } }); return bi; }
    var pos = idx([ll.lat, ll.lng]), ins = wps.length - 1;
    for (var i = 1; i < wps.length; i++) { if (idx(wps[i].p) >= pos) { ins = i; break; } }
    wps.splice(ins, 0, { p: [ll.lat, ll.lng], art: 'hand', text: 'Punkt von Hand' });
    zeichneKorrektur();
  }
  async function rechneKorrektur(ti) {
    var k = zustand.korr; if (!k) return;
    $('korrStatus').textContent = 'Berechne …';
    try {
      var e = zustand.eintrag, bIdx = e.bescheid.teile.indexOf(e.bescheid.teile.filter(function (t) { return t.lastfahrt; })[ti]);
      bIdx = e.bescheid.teile.map(function (t, i) { return t.lastfahrt ? i : -1; }).filter(function (i) { return i >= 0; })[ti];
      var neu = e.bescheid.eigen ? await TK.eigeneTeil(k.wp[ti], CFG.dienste, e.ergebnis.teile[ti])
        : await TK.neuAusWegpunkten(e.bescheid, bIdx, Object.assign({}, e.ergebnis.teile[ti], { wegpunkte: k.wp[ti] }), CFG.dienste);
      k.neu = k.neu || {}; k.neu[ti] = neu;
      var alle = []; e.ergebnis.teile.forEach(function (t, i) { alle = alle.concat(k.neu[i] ? k.neu[i].coords : t.coords); }); k.coords = alle;
      $('korrStatus').textContent = (e.bescheid.eigen ? '' : 'Prüfung: ' + STUFE_TEXT[neu.pruefung.stufe] + ' · ') + zahl(neu.distKm, 0) + ' km';
    } catch (x) { $('korrStatus').textContent = 'Fehler: ' + x.message; }
    zeichneKorrektur(); filtereBaustellen();
  }
  async function korrekturSpeichern() {
    var k = zustand.korr, e = zustand.eintrag;
    if (!k.neu) { endeKorrektur(); zeichneStrecke(false); return; }
    var teile = e.ergebnis.teile.map(function (t, i) { return k.neu[i] || t; });
    var stufen = teile.map(function (t) { return t.pruefung.stufe; });
    var erg = Object.assign({}, e.ergebnis, { teile: teile, vonHand: true, stufe: e.bescheid.eigen ? 'eigen' : stufen.indexOf('rot') >= 0 ? 'rot' : stufen.indexOf('gelb') >= 0 ? 'gelb' : 'gruen', korrigiert: new Date().toISOString() });
    $('korrStatus').textContent = 'Speichern …';
    try {
      var meta = await speicher.speichere({ bescheid: e.bescheid, ergebnis: erg, quelle: e.quelle }, null);
      ungueltig(meta.id);
      zustand.metas = zustand.metas.filter(function (m) { return m.id !== meta.id; }).concat([meta]);
      endeKorrektur();
      await oeffne(meta.id);
    } catch (x) { $('korrStatus').textContent = 'Speichern fehlgeschlagen: ' + x.message; }
  }

  /* ---------- Eigene Strecke ohne Bescheid ---------- */
  // Formular rechts: Name, Breite (Pflicht), Länge/Höhe/Gewicht, Von, Zwischenpunkte, Nach (Adresse mit Vorschlägen oder auf der Karte), Zeitraum.
  // Gespeichert wird wie ein Bescheid (gleiches Format, Kennung "EIGEN-…"); die eingegebenen Punkte stehen im Eintrag, daraus wird neu berechnet.
  var ef = null, efZaehler = 0;
  function parseDe(s) { s = String(s == null ? '' : s).trim(); if (!s) return null; if (!/^\d+([.,]\d+)?$/.test(s)) return NaN; return parseFloat(s.replace(',', '.')); }
  function zahlFeld(v) { return v == null || v === '' ? '' : String(v).replace('.', ','); }
  function neueEigenId() { return 'EIGEN-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  function eigeneFormAus() { // Formular still beenden (ohne das Panel zu ändern)
    if (ef && ef.pick) beendePick();
    ef = null; ebeneEigen.clearLayers(); $('setzBanner').style.display = 'none';
  }
  function oeffneEigeneForm(eintrag) {
    if (zustand.korr) { meldung('Bitte zuerst die Korrektur beenden.'); return; }
    eigeneFormAus();
    var bearb = !!eintrag, b = eintrag && eintrag.bescheid;
    if (!bearb && (zustand.aktiv || zustand.eintrag)) {
      zustand.aktiv = null; zustand.eintrag = null; ebeneStrecke.clearLayers(); ebeneHinweise.clearLayers();
      zeigeListe(); filtereBaustellen(); zeigeLegende();
    }
    var bis = new Date(heute); bis.setDate(bis.getDate() + 30);
    var v = bearb ? { name: b.ladung.text, breite: b.breite, laenge: b.lastfahrt.laenge, hoehe: b.lastfahrt.hoehe, gewicht: b.lastfahrt.gewicht, von: b.gueltigVon, bis: b.gueltigBis, punkte: b.eingabe.punkte }
      : { name: '', breite: null, laenge: null, hoehe: null, gewicht: null, von: dIso(heute), bis: dIso(bis), punkte: [{ text: '', p: null }, { text: '', p: null }] };
    ef = { modus: bearb ? 'bearbeiten' : 'neu', id: bearb ? b.id : null, alle: [], pick: null, ruft: false };
    var koerper = '<div class="formular">' +
      '<label class="lb" for="eName">Name (z. B. Ladung oder Projekt)</label><input type="text" id="eName" maxlength="80" autocomplete="off" value="' + esc(v.name) + '">' +
      '<label class="lb" for="eBreite">Fahrzeugbreite in m <span class="pflicht">(Pflichtfeld)</span></label><input type="text" id="eBreite" inputmode="decimal" autocomplete="off" placeholder="z. B. 3,50" value="' + esc(zahlFeld(v.breite)) + '" style="max-width:160px">' +
      '<div class="drei"><div><label class="lb" for="eLaenge">Länge (m)</label><input type="text" id="eLaenge" inputmode="decimal" autocomplete="off" value="' + esc(zahlFeld(v.laenge)) + '"></div>' +
      '<div><label class="lb" for="eHoehe">Höhe (m)</label><input type="text" id="eHoehe" inputmode="decimal" autocomplete="off" value="' + esc(zahlFeld(v.hoehe)) + '"></div>' +
      '<div><label class="lb" for="eGewicht">Gewicht (t)</label><input type="text" id="eGewicht" inputmode="decimal" autocomplete="off" value="' + esc(zahlFeld(v.gewicht)) + '"></div></div>' +
      '<div class="unter">Länge, Höhe und Gewicht sind freiwillig.</div>' +
      '<div id="ePunkte"></div>' +
      '<div class="zwei"><div><label class="lb" for="eVon">Zeitraum von</label><input type="date" id="eVon" value="' + esc(v.von) + '"></div>' +
      '<div><label class="lb" for="eBis">bis</label><input type="date" id="eBis" value="' + esc(v.bis) + '"></div></div>' +
      '<div id="eFehler" class="fehlerText" role="alert"></div></div>';
    $('detail').innerHTML = panelHuelle('<div><h2>' + (bearb ? 'Strecke bearbeiten' : 'Strecke ohne Bescheid') + '</h2><div class="unter">' + (bearb ? esc(v.name) : 'Baustellen prüfen, auch ohne Bescheid') + '</div></div>', koerper,
      '<div class="knopfreihe" style="margin-top:0"><button class="knopf voll" id="eBerechnen" type="button" style="flex:1">' + ic('haken', 22) + ' ' + (bearb ? 'Speichern' : 'Strecke berechnen') + '</button><button class="knopf" id="eAbbruch" type="button">Abbrechen</button></div>');
    zeigeDetailFlaeche(true);
    $('detailZu').onclick = $('eAbbruch').onclick = schliesseEigeneForm;
    $('eBerechnen').onclick = eigeneBerechnen;
    ['eName', 'eBreite', 'eLaenge', 'eHoehe', 'eGewicht', 'eVon', 'eBis'].forEach(function (id) {
      $(id).addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); eigeneBerechnen(); } });
      $(id).addEventListener('input', function () { this.classList.remove('fehl'); $('eFehler').textContent = ''; });
    });
    // Punkte: Von, Zwischenpunkte, "+ Zwischenpunkt", Nach
    var host = $('ePunkte'), n = v.punkte.length, plus = document.createElement('div');
    plus.className = 'eplus'; plus.innerHTML = '<button type="button" class="knopf" id="eViaPlus">' + ic('plus', 20) + ' Zwischenpunkt</button>';
    v.punkte.forEach(function (pt, i) {
      if (i === n - 1) host.appendChild(plus);
      efZeile(i === 0 ? 'von' : i === n - 1 ? 'nach' : 'via', pt, null);
    });
    plus.firstChild.onclick = function () { var z = efZeile('via', null, plus); z.input.focus(); };
    zeichneEigenPunkte();
    $('eName').focus();
  }
  // Eine Zeile (Von / Zwischenpunkt / Nach); vorElement: davor einfügen, sonst ans Ende
  function efZeile(art, pt, vorElement) {
    var host = $('ePunkte'), nr = ++efZaehler, el = document.createElement('div');
    el.className = 'ez ez-' + art;
    var titel = art === 'von' ? 'Von' : art === 'nach' ? 'Nach' : 'Zwischenpunkt';
    el.innerHTML = '<label class="lb" for="ez' + nr + '">' + titel + '</label>' +
      '<input type="text" id="ez' + nr + '" class="etext" autocomplete="off" placeholder="Adresse oder Ort eingeben" aria-label="' + titel + ': Adresse oder Ort">' +
      '<div class="evor" role="listbox" style="display:none"></div>' +
      '<div class="ezfuss"><span class="estatus"></span><button type="button" class="knopf eKarte">Auf Karte setzen</button>' + (art === 'via' ? '<button type="button" class="knopf gefahr eWeg" aria-label="Zwischenpunkt entfernen">' + ic('weg', 20) + '</button>' : '') + '</div>';
    if (vorElement) host.insertBefore(el, vorElement); else host.appendChild(el);
    var z = { art: art, el: el, input: el.querySelector('.etext'), liste: el.querySelector('.evor'), status: el.querySelector('.estatus'), p: null, text: '', token: 0, warte: null };
    ef.alle.push(z);
    ef.alle.sort(function (a, b) { return (a.el.compareDocumentPosition(b.el) & 4) ? -1 : 1; }); // Reihenfolge wie auf dem Bildschirm
    if (pt && pt.p) setzePunktZeile(z, pt.p, pt.text, false); else statusZeile(z);
    z.input.addEventListener('input', function () {
      if (z.p) { z.p = null; zeichneEigenPunkte(); }
      z.text = z.input.value; statusZeile(z); this.classList.remove('fehl'); $('eFehler').textContent = '';
      clearTimeout(z.warte); z.liste.style.display = 'none';
      if (z.input.value.trim().length >= 4) z.warte = setTimeout(function () { sucheVorschlaege(z); }, 900);
    });
    z.input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); clearTimeout(z.warte); sucheVorschlaege(z); }
      else if (ev.key === 'Escape') z.liste.style.display = 'none';
    });
    el.querySelector('.eKarte').onclick = function () { starteKartenwahl(z); };
    if (el.querySelector('.eWeg')) el.querySelector('.eWeg').onclick = function () {
      ef.alle = ef.alle.filter(function (x) { return x !== z; }); el.parentNode.removeChild(el); zeichneEigenPunkte();
    };
    return z;
  }
  function statusZeile(z) {
    if (z.p) { z.status.className = 'estatus marke gruen'; z.status.innerHTML = ic('haken', 18) + ' Ort gewählt'; }
    else { z.status.className = 'estatus unter'; z.status.textContent = z.input.value.trim() ? 'Bitte einen Vorschlag anklicken' : 'Noch kein Ort gewählt'; }
  }
  function setzePunktZeile(z, p, text, springe) {
    z.p = [p[0], p[1]]; z.text = text; z.input.value = text; z.input.classList.remove('fehl'); z.liste.style.display = 'none'; statusZeile(z);
    zeichneEigenPunkte();
    if (springe) map.setView(p, Math.max(map.getZoom(), 11));
  }
  async function sucheVorschlaege(z) {
    var t = z.input.value.trim(); if (t.length < 3 || z.p) return;
    var marke = ++z.token;
    z.liste.style.display = 'block'; z.liste.innerHTML = '<div class="hint">Suche …</div>';
    try {
      var l = await TK.adressVorschlaege(t, CFG.dienste, 5);
      if (marke !== z.token || z.p) return;
      if (!l.length) { z.liste.innerHTML = '<div class="hint">Nichts gefunden. Bitte anders schreiben oder „Auf Karte setzen“ benutzen.</div>'; return; }
      z.liste.innerHTML = l.map(function (x, i) { return '<button type="button" role="option" class="evorschlag" data-i="' + i + '">' + esc(x.text) + '</button>'; }).join('');
      Array.prototype.forEach.call(z.liste.querySelectorAll('.evorschlag'), function (b) { b.onclick = function () { var x = l[+b.dataset.i]; setzePunktZeile(z, x.p, x.text, true); }; });
    } catch (e) { if (marke === z.token) z.liste.innerHTML = '<div class="hint fehlerText">' + esc(e.message) + '</div>'; }
  }
  function zeichneEigenPunkte() {
    ebeneEigen.clearLayers(); if (!ef) return;
    var zl = ef.alle;
    zl.forEach(function (z, i) {
      if (!z.p) return;
      var art = i === 0 ? 'start' : i === zl.length - 1 ? 'ziel' : 'hand', t = art === 'start' ? 'Von' : art === 'ziel' ? 'Nach' : 'Zwischenpunkt';
      L.marker(z.p, { icon: icon(art), keyboard: false }).bindTooltip(t + ': ' + esc(z.text)).addTo(ebeneEigen);
    });
  }
  // "Auf Karte setzen": der nächste Klick auf die Karte setzt den Punkt
  function starteKartenwahl(z) {
    if (ef.pick) beendePick();
    ef.pick = z; zustand.setzt = true;
    $('karte').classList.add('setzModus');
    var t = z.art === 'von' ? 'Von' : z.art === 'nach' ? 'Nach' : 'Zwischenpunkt';
    var bn = $('setzBanner'); bn.style.display = 'block';
    bn.innerHTML = '<b>Auf Karte setzen: ' + t + '</b><br>Klicken Sie auf der Karte den Ort an.<div class="knopfreihe"><button class="knopf" id="setzAbbruch" type="button">Abbrechen</button></div>';
    $('setzAbbruch').onclick = beendePick;
    map.on('click', kartenKlick);
  }
  function kartenKlick(ev) {
    var z = ef && ef.pick; if (!z) return;
    var p = [Math.round(ev.latlng.lat * 1e5) / 1e5, Math.round(ev.latlng.lng * 1e5) / 1e5];
    beendePick();
    setzePunktZeile(z, p, 'Kartenpunkt ' + zahl(p[0], 4) + ' / ' + zahl(p[1], 4), false);
  }
  function beendePick() {
    map.off('click', kartenKlick);
    if (ef) ef.pick = null;
    $('karte').classList.remove('setzModus'); $('setzBanner').style.display = 'none';
    setTimeout(function () { zustand.setzt = false; }, 0); // der Klick selbst soll keine Strecke öffnen
  }
  function schliesseEigeneForm() {
    var bearb = ef && ef.modus === 'bearbeiten';
    eigeneFormAus();
    if (bearb && zustand.eintrag) zeigeDetail(); else { zeigeDetailFlaeche(false); filtereBaustellen(); }
  }
  function formFehler(feldId, text) {
    $('eFehler').textContent = text;
    var f = $(feldId); if (f) { f.classList.add('fehl'); f.focus(); }
    return false;
  }
  async function eigeneBerechnen() {
    if (!ef || ef.ruft) return;
    var name = $('eName').value.trim(), breite = parseDe($('eBreite').value);
    ['eName', 'eBreite', 'eLaenge', 'eHoehe', 'eGewicht', 'eVon', 'eBis'].forEach(function (id) { $(id).classList.remove('fehl'); });
    ef.alle.forEach(function (z) { z.input.classList.remove('fehl'); });
    $('eFehler').textContent = '';
    if (breite == null || isNaN(breite)) return formFehler('eBreite', 'Bitte die Fahrzeugbreite in Metern eingeben, z. B. 3,50.');
    if (breite < 1 || breite > 15) return formFehler('eBreite', 'Die Fahrzeugbreite muss zwischen 1 und 15 m liegen.');
    var opt = {}, optFeld = [['eLaenge', 'laenge', 'Länge'], ['eHoehe', 'hoehe', 'Höhe'], ['eGewicht', 'gewicht', 'Gewicht']];
    for (var i = 0; i < optFeld.length; i++) {
      var w = parseDe($(optFeld[i][0]).value);
      if (w !== null && (isNaN(w) || w <= 0)) return formFehler(optFeld[i][0], optFeld[i][2] + ': bitte eine Zahl eingeben oder das Feld leer lassen.');
      opt[optFeld[i][1]] = w;
    }
    var von = $('eVon').value, bis = $('eBis').value;
    if (!von || !bis) return formFehler(von ? 'eBis' : 'eVon', 'Bitte den Zeitraum eingeben.');
    if (bis < von) return formFehler('eBis', 'Das Ende liegt vor dem Beginn.');
    var zl = ef.alle;
    for (var j = 0; j < zl.length; j++) {
      if (!zl[j].p && !zl[j].input.value.trim()) {
        var wo = zl[j].art === 'von' ? 'den Start („Von“)' : zl[j].art === 'nach' ? 'das Ziel („Nach“)' : 'den Zwischenpunkt (oder ihn entfernen)';
        return formFehler(zl[j].input.id, 'Bitte ' + wo + ' eingeben oder „Auf Karte setzen“ benutzen.');
      }
    }
    ef.ruft = true; var knopf = $('eBerechnen'), knopfText = knopf.innerHTML; knopf.disabled = true; knopf.textContent = 'Berechne …';
    var ende = function () { if (ef) ef.ruft = false; if ($('eBerechnen')) { $('eBerechnen').disabled = false; $('eBerechnen').innerHTML = knopfText; } };
    try {
      for (var k = 0; k < zl.length; k++) { // Adresse getippt, aber kein Vorschlag angeklickt: erster Treffer der Adresssuche
        if (zl[k].p) continue;
        var tr = await TK.adressVorschlaege(zl[k].input.value, CFG.dienste, 1);
        if (!tr.length) { ende(); return formFehler(zl[k].input.id, '„' + zl[k].input.value.trim() + '“ wurde nicht gefunden. Bitte anders schreiben oder „Auf Karte setzen“ benutzen.'); }
        setzePunktZeile(zl[k], tr[0].p, tr[0].text, false);
      }
      var punkte = zl.map(function (z) { return { text: z.text, p: z.p }; });
      var form = { id: ef.id || neueEigenId(), name: name || 'Eigene Strecke', breite: breite, laenge: opt.laenge, hoehe: opt.hoehe, gewicht: opt.gewicht, von: von, bis: bis, punkte: punkte };
      var alt = ef.modus === 'bearbeiten' ? zustand.eintrag : null, ergAlt = null;
      if (alt) {
        var gleich = JSON.stringify(alt.bescheid.eingabe.punkte.map(function (x) { return x.p; })) === JSON.stringify(punkte.map(function (x) { return x.p; }));
        if (gleich) ergAlt = alt.ergebnis;
        else if (alt.ergebnis.vonHand && !confirm('Die Strecke wurde von Hand korrigiert. Mit den neuen Punkten neu berechnen und die Korrektur verwerfen?')) { ende(); return; }
      }
      var eintrag = await TK.eigeneEintrag(form, CFG.dienste, ergAlt);
      var meta = await speicher.speichere(eintrag, null, '', null);
      ungueltig(meta.id);
      zustand.metas = zustand.metas.filter(function (m) { return m.id !== meta.id; }).concat([meta]);
      var neu = ef.modus === 'neu';
      eigeneFormAus();
      await oeffne(meta.id);
      if (neu) passeKarteEin();
    } catch (x) {
      ende();
      if ($('eFehler')) $('eFehler').textContent = 'Das hat nicht geklappt: ' + x.message;
    }
  }
  // Karte so einstellen, dass alle gezeigten Strecken zu sehen sind
  function passeKarteEin() {
    var g = L.latLngBounds([]);
    ausgewaehlteMetas().forEach(function (m) { if (m.bbox && m.bbox.length === 4) { g.extend([m.bbox[0], m.bbox[1]]); g.extend([m.bbox[2], m.bbox[3]]); } });
    if (g.isValid()) map.fitBounds(g, { padding: [40, 40] });
  }
  function formAusEigen(b) {
    return { id: b.id, name: b.ladung.text, breite: b.breite, laenge: b.lastfahrt.laenge, hoehe: b.lastfahrt.hoehe, gewicht: b.lastfahrt.gewicht, von: b.gueltigVon, bis: b.gueltigBis, punkte: b.eingabe.punkte };
  }
  function zeigeDetailEigen() {
    var e = zustand.eintrag, b = e.bescheid, r = e.ergebnis, m = e.meta, pk = b.eingabe.punkte;
    var kopfH = '<div><h2>' + esc(b.ladung.text || 'Eigene Strecke') + '</h2><div class="unter">Eigene Strecke, ohne Bescheid</div></div>';
    var koerper =
      '<div class="kacheln"><button class="kachel voll" id="korrKnopf" type="button">' + ic('korr', 28) + 'Strecke korrigieren</button>' +
      '<button class="kachel" id="neuKnopf" type="button">' + ic('neu', 28) + '<span id="neuText">Strecke neu berechnen</span></button>' +
      '<button class="kachel" id="bearbKnopf" type="button">' + ic('form', 28) + 'Bearbeiten</button></div>' +
      '<dl><dt>Fahrzeugbreite</dt><dd class="gr">' + zahl(b.breite) + ' m</dd>' +
      (b.lastfahrt.laenge ? '<dt>Länge</dt><dd>' + zahl(b.lastfahrt.laenge) + ' m</dd>' : '') +
      (b.lastfahrt.hoehe ? '<dt>Höhe</dt><dd>' + zahl(b.lastfahrt.hoehe) + ' m</dd>' : '') +
      (b.lastfahrt.gewicht ? '<dt>Gewicht</dt><dd>' + zahl(b.lastfahrt.gewicht, 1) + ' t</dd>' : '') +
      '<dt>Gültig</dt><dd>' + datum(b.gueltigVon) + ' bis ' + datum(b.gueltigBis) + (abgelaufen(m) ? ' <span class="tag">abgelaufen</span>' : '') + '</dd>' +
      '<dt>Von</dt><dd>' + esc(pk[0].text) + '</dd>' +
      pk.slice(1, -1).map(function (x) { return '<dt>Zwischen</dt><dd>' + esc(x.text) + '</dd>'; }).join('') +
      '<dt>Nach</dt><dd>' + esc(pk[pk.length - 1].text) + '</dd>' +
      '<dt>Strecke</dt><dd>' + zahl(r.teile.reduce(function (a, t) { return a + t.distKm; }, 0), 0) + ' km' + (r.vonHand ? ' <span class="tag">von Hand korrigiert</span>' : '') + '</dd></dl>' +
      '<p class="unter">Diese Strecke haben Sie selbst eingegeben. Sie wird nicht mit einem Bescheid verglichen.</p>';
    $('detail').innerHTML = panelHuelle(kopfH, koerper, '<button class="knopf gefahr" id="wegKnopf" type="button" style="width:100%">' + ic('weg', 20) + ' Strecke entfernen</button>');
    $('detailZu').onclick = schliesse;
    $('korrKnopf').onclick = starteKorrektur;
    $('neuKnopf').onclick = neuBerechnen;
    $('wegKnopf').onclick = entfernen;
    $('bearbKnopf').onclick = function () { oeffneEigeneForm(zustand.eintrag); };
  }
  $('eigenKnopf').onclick = function () { oeffneEigeneForm(null); };

  /* ---------- Höhe zwischen Karte und Tabelle (Griff) ---------- */
  var TABHOEHE_SCHLUESSEL = 'transportkarte-tabhoehe';
  var tabAnteil = 0.39;
  try { var ta = parseFloat(localStorage.getItem(TABHOEHE_SCHLUESSEL)); if (ta > 0.15 && ta < 0.75) tabAnteil = ta; } catch (e) { /* Standard */ }
  function platzUnterLeisten() { return window.innerHeight - $('kopf').offsetHeight - $('leiste').offsetHeight; }
  function setzeTabHoehe(h, merken) {
    var gesamt = platzUnterLeisten(), min = 150, max = Math.max(min, gesamt - 280); // Karte behält mindestens 280 px
    h = Math.round(Math.max(min, Math.min(max, h)));
    document.documentElement.style.setProperty('--tab', h + 'px');
    tabAnteil = h / gesamt; map.invalidateSize();
    if (merken) { try { localStorage.setItem(TABHOEHE_SCHLUESSEL, String(tabAnteil)); } catch (e) { /* nur diese Sitzung */ } }
  }
  (function () {
    var griff = $('griff'), zieht = false;
    griff.addEventListener('pointerdown', function (ev) { zieht = true; griff.setPointerCapture(ev.pointerId); ev.preventDefault(); });
    griff.addEventListener('pointermove', function (ev) { if (zieht) setzeTabHoehe(window.innerHeight - ev.clientY + 7, false); });
    ['pointerup', 'pointercancel'].forEach(function (n) { griff.addEventListener(n, function () { if (!zieht) return; zieht = false; setzeTabHoehe($('tab').offsetHeight, true); }); });
    griff.addEventListener('keydown', function (ev) {
      if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
      ev.preventDefault(); setzeTabHoehe($('tab').offsetHeight + (ev.key === 'ArrowUp' ? 40 : -40), true);
    });
    window.addEventListener('resize', function () { setzeTabHoehe(platzUnterLeisten() * tabAnteil, false); });
    setzeTabHoehe(platzUnterLeisten() * tabAnteil, false);
  })();

  /* ---------- Start ---------- */
  (function () { var ek = String(CFG.entlangKm || 2); $('wo').value = Array.prototype.some.call($('wo').options, function (o) { return o.value === ek; }) ? ek : '2'; })();
  $('zeitVon').value = dIso(heute); var z14 = new Date(heute); z14.setDate(z14.getDate() + 14); $('zeitBis').value = dIso(z14);
  zeigeSpeicherart(); zeigeLegende(); zeigeAuswahlZahl(); setzeBreite(5); ladeListe(); ladeBaustellen(); ladeKml();
  window.TK_APP = { zustand: zustand, map: map, oeffne: oeffne, nimmDateien: nimmDateien, speicher: speicher, rechneKorrektur: rechneKorrektur, korrekturSpeichern: korrekturSpeichern, passeKarteEin: passeKarteEin };
})();
