/* Transportkarte - Zwischenspeicher fuer Adresssuche, Strassendaten und Router.
   Ablage im Browser: IndexedDB. In Node-Tests: Ordner aus Umgebungsvariable TK_ZWISCHENSPEICHER.
   Faellt die Ablage aus, laeuft alles wie bisher ohne Speicher (still). */
(function (root) {
  'use strict';
  var TK = root.TK = root.TK || {};
  var TAG = 86400000;
  var ABLAUF = { adresse: 90 * TAG, router: 90 * TAG, strassen: 30 * TAG };
  var MAX_BYTES = 200 * 1024 * 1024;
  var DBNAME = 'transportkarte-zwischenspeicher';
  var zaehler = { treffer: 0, fehlt: 0, abgelegt: 0 };
  var schreibZaehler = 0, aufgeraeumt = false;

  /* ---------- Ablage IndexedDB ---------- */
  function idbAblage() {
    var dbp = null;
    function db() {
      if (dbp) return dbp;
      dbp = new Promise(function (ok, nein) {
        try {
          var q = root.indexedDB.open(DBNAME, 1);
          q.onupgradeneeded = function () { var x = q.result; x.createObjectStore('meta', { keyPath: 'k' }); x.createObjectStore('daten', { keyPath: 'k' }); };
          q.onsuccess = function () { ok(q.result); };
          q.onerror = function () { nein(q.error || new Error('idb')); };
          q.onblocked = function () { nein(new Error('idb blockiert')); };
        } catch (e) { nein(e); }
      });
      return dbp;
    }
    function req(stores, modus, fn) {
      return db().then(function (d) {
        return new Promise(function (ok, nein) {
          var tx = d.transaction(stores, modus), r = fn(tx);
          tx.oncomplete = function () { ok(r && r.result); };
          tx.onerror = tx.onabort = function () { nein(tx.error || new Error('idb')); };
        });
      });
    }
    var A = {
      holen: function (k) {
        return req('meta', 'readonly', function (tx) { return tx.objectStore('meta').get(k); }).then(function (m) {
          if (!m) return null;
          if (m.bis < Date.now()) return A.weg(k).then(function () { return null; });
          return req('daten', 'readonly', function (tx) { return tx.objectStore('daten').get(k); }).then(function (d) { return d ? d.text : null; });
        });
      },
      ablegen: function (k, text, bis, dienst) {
        return req(['meta', 'daten'], 'readwrite', function (tx) {
          tx.objectStore('meta').put({ k: k, t: Date.now(), bis: bis, n: text.length, dienst: dienst });
          tx.objectStore('daten').put({ k: k, text: text });
        });
      },
      weg: function (k) {
        return req(['meta', 'daten'], 'readwrite', function (tx) { tx.objectStore('meta').delete(k); tx.objectStore('daten').delete(k); });
      },
      alleMeta: function () { return req('meta', 'readonly', function (tx) { return tx.objectStore('meta').getAll(); }); },
      wegMeta: function (m) { return A.weg(m.k); },
      leeren: function () {
        return req(['meta', 'daten'], 'readwrite', function (tx) { tx.objectStore('meta').clear(); tx.objectStore('daten').clear(); });
      }
    };
    return A;
  }

  /* ---------- Ablage Ordner (nur Node-Tests) ---------- */
  function ordnerAblage(dir, rq) {
    var fs = rq('fs'), path = rq('path'), cr = rq('crypto');
    fs.mkdirSync(dir, { recursive: true });
    function pf(k) { return path.join(dir, cr.createHash('md5').update(k).digest('hex') + '.json'); }
    function beiseite(p) { if (fs.existsSync(p)) fs.renameSync(p, p + '.abgelaufen'); }
    return {
      holen: function (k) {
        return Promise.resolve().then(function () {
          var p = pf(k); if (!fs.existsSync(p)) return null;
          var m = JSON.parse(fs.readFileSync(p, 'utf8'));
          if (m.k !== k) return null;
          if (m.bis < Date.now()) { beiseite(p); return null; }
          return m.text;
        });
      },
      ablegen: function (k, text, bis, dienst) {
        return Promise.resolve().then(function () { fs.writeFileSync(pf(k), JSON.stringify({ k: k, t: Date.now(), bis: bis, dienst: dienst, n: text.length, text: text })); });
      },
      alleMeta: function () {
        return Promise.resolve().then(function () {
          return fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); }).map(function (f) {
            var p = path.join(dir, f), st = fs.statSync(p), m = JSON.parse(fs.readFileSync(p, 'utf8'));
            return { k: m.k, datei: p, t: st.mtimeMs, n: st.size, bis: m.bis };
          });
        });
      },
      wegMeta: function (m) { return Promise.resolve().then(function () { beiseite(m.datei); }); },
      leeren: function () {
        return Promise.resolve().then(function () { fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); }).forEach(function (f) { beiseite(path.join(dir, f)); }); });
      }
    };
  }

  /* ---------- Auswahl der Ablage (einmal) ---------- */
  var ablage; // undefined = noch nicht gewaehlt, null = keine
  function wahl() {
    if (ablage !== undefined) return ablage;
    ablage = null;
    try {
      var rq = root.TK_REQUIRE || (typeof require !== 'undefined' ? require : null);
      var env = (typeof process !== 'undefined' && process.env) ? process.env.TK_ZWISCHENSPEICHER : '';
      if (env && rq) ablage = ordnerAblage(env, rq);
      else if (root.indexedDB) ablage = idbAblage();
    } catch (e) { ablage = null; }
    return ablage;
  }

  function schluessel(dienst, url, body) { return dienst + '\n' + url + '\n' + (body || ''); }
  function still(p) { return p.then(null, function () { return null; }); }

  /* Aufraeumen: Abgelaufenes und Ueberschuss (aelteste zuerst) entfernen. */
  function aufraeumen() {
    var a = wahl(); if (!a) return Promise.resolve();
    return still(a.alleMeta().then(function (ms) {
      var jetzt = Date.now(), summe = 0, rest = [], weg = [];
      ms.forEach(function (m) { if (m.bis < jetzt) weg.push(m); else { rest.push(m); summe += m.n || 0; } });
      rest.sort(function (x, y) { return x.t - y.t; });
      while (summe > MAX_BYTES && rest.length) { var m = rest.shift(); summe -= m.n || 0; weg.push(m); }
      return weg.reduce(function (p, m) { return p.then(function () { return a.wegMeta(m); }); }, Promise.resolve());
    }));
  }

  TK.zs = {
    ablaufTage: { adresse: 90, router: 90, strassen: 30 },
    statistik: zaehler,
    /* Liefert gespeicherten Antworttext oder null. Wirft nie. */
    hole: function (dienst, url, body) {
      var a = wahl(); if (!a) return Promise.resolve(null);
      if (!aufgeraeumt) { aufgeraeumt = true; aufraeumen(); }
      return still(a.holen(schluessel(dienst, url, body)).then(function (t) { if (t == null) zaehler.fehlt++; else zaehler.treffer++; return t; }));
    },
    /* Legt nur erfolgreiche Antworten ab. Wirft nie. */
    lege: function (dienst, url, body, text) {
      var a = wahl(); if (!a || typeof text !== 'string' || !text) return Promise.resolve();
      return still(a.ablegen(schluessel(dienst, url, body), text, Date.now() + (ABLAUF[dienst] || 30 * TAG), dienst).then(function () {
        zaehler.abgelegt++;
        if (++schreibZaehler % 25 === 0) aufraeumen();
      }));
    }
  };
  TK.leereZwischenspeicher = function () {
    var a = wahl(); if (!a) return Promise.resolve();
    return still(a.leeren());
  };
  TK._zsTest = { maxBytes: function (n) { MAX_BYTES = n; }, aufraeumen: aufraeumen, wahlNeu: function () { ablage = undefined; aufgeraeumt = false; } };
})(typeof window !== 'undefined' ? window : globalThis);
