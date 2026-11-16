/* Transportkarte – eingebettetes VEMAGS-XML aus dem Bescheid-PDF holen (ohne Bibliothek). */
(function (root) {
  'use strict';
  var TK = root.TK = root.TK || {};

  function latin1(bytes) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return s;
  }
  async function inflate(bytes) {
    if (typeof DecompressionStream !== 'undefined') {
      var ds = new DecompressionStream('deflate');
      var out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
      return new Uint8Array(await out.arrayBuffer());
    }
    if (typeof require === 'function') return new Uint8Array(require('zlib').inflateSync(Buffer.from(bytes)));
    throw new Error('Entpacken wird von diesem Browser nicht unterstützt');
  }
  function utf8(bytes) { return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, ''); }

  // Liefert den XML-Text des Bescheids oder wirft einen verständlichen Fehler
  TK.xmlAusPdf = async function (arrayBuffer) {
    var bytes = new Uint8Array(arrayBuffer);
    var s = latin1(bytes);
    if (s.slice(0, 5) !== '%PDF-') {
      if (/BescheidAsXML/.test(s.slice(0, 2000))) return utf8(bytes); // direkt ein XML
      throw new Error('Das ist keine PDF-Datei.');
    }
    var re = /\/Type\s*\/EmbeddedFile\b/g, m, gefunden = [];
    while ((m = re.exec(s))) {
      var objStart = s.lastIndexOf(' obj', m.index);
      var streamM = /stream\r?\n/g; streamM.lastIndex = m.index;
      var sm = streamM.exec(s); if (!sm) continue;
      var dict = s.slice(objStart, sm.index);
      var start = sm.index + sm[0].length, len = null;
      var lm = dict.match(/\/Length\s+(\d+)(\s+(\d+)\s+R)?/);
      if (lm && !lm[2]) len = +lm[1];
      else if (lm) { var om = new RegExp('(^|\\s)' + lm[1] + '\\s+' + lm[3] + '\\s+obj\\s*(\\d+)').exec(s); if (om) len = +om[2]; }
      if (len === null) { var e = s.indexOf('endstream', start); len = e - start; while (len > 0 && (s[start + len - 1] === '\n' || s[start + len - 1] === '\r')) len--; }
      var data = bytes.subarray(start, start + len);
      var filt = (dict.match(/\/Filter\s*(\[[^\]]*\]|\/\w+)/) || [])[1] || '';
      if (/FlateDecode/.test(filt)) data = await inflate(data);
      else if (filt && !/^\s*$/.test(filt)) continue; // unbekannte Packart
      var txt = utf8(data);
      if (/BescheidAsXML/.test(txt.slice(0, 3000))) return txt;
      gefunden.push(txt.slice(0, 60));
    }
    throw new Error(gefunden.length ? 'Im PDF steckt eine Datei, aber kein VEMAGS-Bescheid.' : 'In diesem PDF sind keine VEMAGS-Daten eingebettet. Bitte den Original-Bescheid aus VEMAGS verwenden (nicht eingescannt oder neu gedruckt).');
  };
})(typeof window !== 'undefined' ? window : globalThis);
