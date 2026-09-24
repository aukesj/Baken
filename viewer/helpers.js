// Baken — pure berekeningen, los van de DOM en van app-state, zodat ze zowel
// in de browser (window.BAKEN_HELPERS) als in Node (require) te testen zijn.
// Geen build-stap: dit is een UMD-achtige wrapper.
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BAKEN_HELPERS = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const PALETTE = ["#3f51b5", "#e91e63", "#2e7d32", "#f57c00", "#6a1b9a", "#0097a7", "#c62828", "#00867d"];

  function haversine(a, b) {
    const R = 6371000, r = (d) => d * Math.PI / 180;
    const dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  function bearing(a, b) {
    const r = (d) => d * Math.PI / 180, deg = (x) => (x * 180 / Math.PI + 360) % 360;
    const y = Math.sin(r(b.lon - a.lon)) * Math.cos(r(b.lat));
    const x = Math.cos(r(a.lat)) * Math.sin(r(b.lat)) - Math.sin(r(a.lat)) * Math.cos(r(b.lat)) * Math.cos(r(b.lon - a.lon));
    return deg(Math.atan2(y, x));
  }
  // Projecteer een punt distM meter vooruit langs koers brg (graden). Voor de
  // geschatte ('dead reckoning') tussenpositie tussen twee echte fixes.
  function projectLL(lat, lon, brg, distM) {
    const R = 6371000, r = (d) => d * Math.PI / 180, deg = (x) => x * 180 / Math.PI;
    const dr = distM / R, b = r(brg), la = r(lat), lo = r(lon);
    const la2 = Math.asin(Math.sin(la) * Math.cos(dr) + Math.cos(la) * Math.sin(dr) * Math.cos(b));
    const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(dr) * Math.cos(la), Math.cos(dr) - Math.sin(la) * Math.sin(la2));
    return [deg(la2), ((deg(lo2) + 540) % 360) - 180];
  }
  // Een cirkel op de grond als GeoJSON-ring ([lon, lat], gesloten). MapLibre
  // kent geen cirkel in meters zoals Leaflet; alles wat op de grond ligt is
  // een polygoon. Bij 64 hoeken is de afwijking 0,12% van de straal.
  function circleRing(lat, lon, radiusM, steps) {
    const n = steps || 64, ring = [];
    for (let i = 0; i <= n; i++) {
      const [la, lo] = projectLL(lat, lon, (360 * i) / n, radiusM);
      ring.push([lo, la]);
    }
    return ring;
  }
  // Een cirkel is een uitspraak over onzekerheid; die doen we pas als de
  // meting echt onzeker is. Drempel in meters, niet in pixels: een fix van 9 m
  // blijft een goede fix, ook als je inzoomt.
  function circleShows(radiusM, minM) {
    if (!(radiusM > 0)) return false;
    if (!(minM > 0)) return true;
    return radiusM >= minM;
  }
  // Is dit een verandering die het tonen waard is, of ruis van een toestel dat
  // elke paar seconden een paar meter anders meet? Relatief: een meter op 5 m
  // is nieuws, op 200 m niet.
  function accChanged(shownM, targetM, step) {
    if (!(shownM > 0)) return targetM > 0;
    if (!(targetM > 0)) return true;
    return Math.abs(targetM - shownM) / shownM >= step;
  }
  // Hoeveel seconden mag de pin vooruit geschat worden? 0 = niet schatten, de
  // pin hoort op de echte fix.
  //
  // Twee grenzen. De ene (capS) begrenst hoe ver we doorschuiven sinds we de
  // fix ontvingen. De andere (staleS) kijkt naar de leeftijd van de fix zelf:
  // een fix die al minuten oud is zegt niets meer over waar iemand nu rijdt.
  // Zonder die tweede grens schoof een pin bij het openen van de app 25 s
  // vooruit op een uren oude snelheid, en bleef hij daar staan zodra het
  // toestel stopte met zenden.
  function estimateSeconds(now, recvT, fixT, capS, staleS) {
    if (!(recvT > 0) || !(fixT > 0)) return 0;
    if (staleS > 0 && now - fixT > staleS * 1000) return 0;
    const el = Math.min((now - recvT) / 1000, capS);
    return el > 0.5 ? el : 0;
  }
  const fmtDist = (m) => m == null ? "" : (m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(m < 10000 ? 1 : 0) + " km");
  // Relatieve tijd. Vertaler t en 'nu' worden meegegeven, zodat de functie
  // puur (en dus testbaar) blijft.
  function agoTxt(ms, t, now) {
    const s = Math.round(((now == null ? Date.now() : now) - ms) / 1000);
    if (s < 60) return t("just_now"); const m = Math.round(s / 60);
    if (m < 60) return t("min_ago", { n: m }); const h = Math.round(m / 60);
    if (h < 24) return t("hr_ago", { n: h }); return t("day_ago", { n: Math.round(h / 24) });
  }
  const colorFor = (name) => { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Bestandsnaam van de foto bij een persoon: kleine letters, zonder spaties
  // en leestekens ("Anne-Marie" → "annemarie").
  const photoFile = (name) => String(name).toLowerCase().replace(/[^a-z0-9]/g, "");

  return {
    PALETTE, haversine, bearing, projectLL, circleRing, circleShows, accChanged,
    estimateSeconds, fmtDist, agoTxt, esc, colorFor, photoFile,
  };
});
