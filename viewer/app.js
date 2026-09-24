"use strict";
(function () {
  const cfg = window.BAKEN_CONFIG || window.TRACE_CONFIG || {};
  const BRAND = cfg.brandName || "Baken";
  const REFRESH = cfg.refreshMs || 30000;
  const SPEED_MIN_KMH = 3;     // onder deze snelheid: geen snelheid/"onderweg", geen schatting
  const EST_CAP_S = 25;        // max seconden vooruit schatten sinds de fix binnenkwam
  const FIX_STALE_S = 120;     // een fix ouder dan dit wordt niet meer vooruit geschat
  // De nauwkeurigheidscirkel verschijnt pas als de meting echt onzeker is;
  // daaronder staat alleen de pin. Een telefoon-fix is meestal 5-15 m; boven
  // 20 m zit een klein deel van de fixes, en juist daar is het goed om te zien
  // hoe hard die stip is. In meters, niet in pixels: inzoomen maakt een goede
  // fix niet slechter.
  const CIRCLE_SHOW_M = 20;
  // Een fix wiebelt een paar meter heen en weer; dat is ruis, geen nieuws. Pas
  // vanaf deze relatieve verandering groeit/krimpt de cirkel mee.
  const ACC_STEP = 0.2;
  const ACC_ANIM_MS = 600;     // duur van dat groeien of krimpen
  const TOKEN_DAYS = 90;       // levensduur van het opgeslagen login-token
  const TOKEN_REFRESH_DAYS = 30; // hermunt het token als er minder dan dit rest
  let lastMaxKmh = 0;          // snelste zichtbare persoon → bepaalt refresh-tempo
  const SHOW_ADDR = cfg.showAddress !== false;
  const DEF_RADIUS = cfg.defaultRadius || 150;
  // Map met gezichtsfoto's (<naam>.png), relatief aan de viewer. "" = geen
  // foto's, alleen gekleurde initialen.
  const PHOTO_PATH = cfg.photoPath == null ? "images/" : String(cfg.photoPath);
  const t = (k, v) => window.I18N.t(k, v);

  const $ = (id) => document.getElementById(id);
  const api = (p, o) => fetch("api/" + p, Object.assign({ credentials: "same-origin" }, o));
  const H = window.BAKEN_HELPERS;
  const { haversine, bearing, projectLL, circleRing, circleShows, accChanged,
    estimateSeconds, fmtDist, esc, colorFor, photoFile } = H;
  // MapLibre werkt in [lengte, breedte], de rest van de app in lat/lon. Eén
  // functie ertussen, zodat de omwisseling nooit uit het hoofd gebeurt.
  const ll = (lat, lon) => [lon, lat];

  // ---- voorkeuren ------------------------------------------------------
  const store = {
    get(k, d) { try { const v = localStorage.getItem("trace." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("trace." + k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem("trace." + k); } catch (e) {} },
  };
  let places = store.get("places", []);
  let notifs = store.get("notifs", []);
  let shown = store.get("shown", null);      // array van namen, of null = alles
  let theme = store.get("theme", "system");
  let langPref = store.get("lang", "system");
  let mapStyle = store.get("mapStyle", "standard");

  const MAP_STYLES = {
    standard: { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", maxZoom: 19, subdomains: "abc", attribution: "&copy; OpenStreetMap" },
    voyager: { url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png", maxZoom: 20, subdomains: "abcd", attribution: "&copy; OpenStreetMap &copy; CARTO" },
    roads: { url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", maxZoom: 20, subdomains: "abc", attribution: "&copy; OpenStreetMap, HOT" },
  };

  // ---- state -----------------------------------------------------------
  let map, viewer = null, viewerMarker = null, devices = [], positions = [], me = null;
  const people = {};        // deviceId → {name, color, marker, prevFix, pos}
  const placeMarkers = {};  // placeId → marker
  let lastPlaceByPerson = {}; // name → placeId|null (voor aankomst/vertrek)
  let follow = true, timer = null, geoCache = {}, centeredOnce = false;
  let popup = null;         // hooguit één tegelijk open
  // Hoeveel vingers er op de kaart staan, en of er een herberekening wacht tot
  // ze eraf zijn. Zie de uitleg bij fix() in initMap(): elke camera-aanroep
  // zet de gebaar-handlers van MapLibre midden in een gebaar terug.
  let fingers = 0, fixPending = false;
  // start() mag vaker lopen (na opnieuw inloggen), maar timers, listeners en
  // de GPS-watch horen er maar één keer te zijn.
  let booted = false;

  // ---- helpers ---------------------------------------------------------
  const agoTxt = (ms) => H.agoTxt(ms, t);
  const el = (html) => { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; };

  // ---- i18n + thema toepassen -----------------------------------------
  function applyI18n() {
    window.I18N.setLang(langPref);
    document.querySelectorAll("[data-i18n]").forEach((e) => { e.textContent = t(e.getAttribute("data-i18n")); });
    $("u").placeholder = t("user"); $("p").placeholder = t("pass");
  }
  function isDark() {
    return theme === "dark" || (theme === "system" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  }
  function applyTheme() {
    document.body.classList.toggle("dark", isDark());
    if (map && mapStyle === "imap") applyMapStyle();   // iMap volgt licht/donker
  }

  // ---- kaart -----------------------------------------------------------
  // MapLibre GL i.p.v. Leaflet: draaien is hier een eigenschap van de camera,
  // en alles wat op de grond ligt draait vanzelf mee. Leaflet kon een kaart
  // niet op een koers renderen.
  //
  // Kantelen doen we niet (maxPitch 0): op een rasterkaart geeft dat een
  // uitgesmeerde horizon, en een twee-vinger-veeg omhoog zou de kaart per
  // ongeluk kantelen terwijl je alleen wilde draaien.
  function initMap() {
    if (map) return;
    document.body.classList.toggle("mapstyle-dark", mapStyle === "imap");
    map = new maplibregl.Map({
      container: "map",
      style: styleSpec(),
      center: ll(52.1, 5.1),
      zoom: 6,
      maxPitch: 0,
      pitchWithRotate: false,
      attributionControl: { compact: true },
    });
    // Voor de e2e-test: meten wat er echt getekend is. Alles erachter zit al
    // in de bundel die de browser krijgt; dit geeft niets prijs.
    window.BAKEN_MAP = map;
    // Zoom + kompasknop linksonder; de kompasknop draait terug naar het noorden.
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), "bottom-left");
    map.on("dragstart", () => setFollow(false));
    // Draaien is net zo goed "laat me rondkijken" als slepen, dus volgen gaat
    // uit. De kompasknop valt erbuiten (die stuurt een click): terug naar het
    // noorden is geen rondkijken.
    map.on("rotatestart", (e) => {
      const oe = e && e.originalEvent;
      if (oe && oe.type !== "click") setFollow(false);
    });
    // De pijl in de bovenkaart wijst naar een persoon en de flare naar het
    // kompas: beide draaien mee met de kaart, niet met het noorden van het scherm.
    map.on("rotate", () => { orientArrow(); rotateBeam(heading); });
    map.on("contextmenu", (e) => openNewPlace(e.lngLat.lat, e.lngLat.lng));
    // Bij setStyle() haalt MapLibre alles weg wat niet in de nieuwe stijl zit
    // (dus onze eigen cirkel-bron) en vuurt daarbij alléén `styledata`, niet
    // `style.load`. Daarom hangt de laag aan alle drie; `idle` is het vangnet
    // voor een styledata die komt terwijl de stijl nog laadt.
    map.on("style.load", ensureCircleLayer);
    map.on("styledata", ensureCircleLayer);
    map.on("idle", ensureCircleLayer);
    armLongPress();
    // We tellen zelf de vingers op de kaart. MapLibre weet pas dat er een
    // gebaar is als het er een herkent, en een camera-aanroep in de
    // milliseconden daarvoor breekt het gebaar af.
    const cc = map.getCanvasContainer();
    const lift = (e) => {
      fingers = (e.touches && e.touches.length) || 0;
      if (!fingers && fixPending) { fixPending = false; fix(); }
    };
    cc.addEventListener("touchstart", (e) => { fingers = e.touches.length; }, { passive: true });
    cc.addEventListener("touchend", lift, { passive: true });
    cc.addEventListener("touchcancel", lift, { passive: true });
    // Kaart full-screen houden: bij laden wordt soms te vroeg gemeten, waardoor
    // er randstroken overblijven. Forceer herberekening bij laden + viewport-
    // wijzigingen (rotatie, toetsenbord, adresbalk in/uit).
    //
    // Maar niet terwijl er een vinger op de kaart staat: map.resize() roept
    // intern map.stop() aan, en dat zet alle gebaar-handlers terug. Op een
    // telefoon valt dat samen: de adresbalk die in- of uitschuift stuurt een
    // visualViewport-resize precies tijdens het draaien. Het uitgestelde meten
    // wordt ingehaald zodra de laatste vinger los is.
    const fix = () => {
      fillViewportGap();
      if (fingers) { fixPending = true; return; }
      map.resize();
    };
    const fixSoon = () => { fix(); [150, 350, 700].forEach((ms) => setTimeout(fix, ms)); };
    [120, 400, 1000].forEach((ms) => setTimeout(fix, ms));
    window.addEventListener("orientationchange", fixSoon);
    window.addEventListener("resize", fix);
    // Terug uit de achtergrond is ook het vangnet voor een touchend die nooit
    // kwam: anders blijft de teller staan en meet de kaart zich nooit meer.
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { fingers = 0; fixSoon(); } });
    if (window.visualViewport) window.visualViewport.addEventListener("resize", fix);
    // Sterkste vangnet: zodra de kaart-container van grootte verandert, opnieuw meten.
    if (window.ResizeObserver) new ResizeObserver(fix).observe($("map"));
  }
  // iMap = OpenFreeMap vector-kaart (Apple-achtig, scherp), direct als
  // MapLibre-stijl. Volgt het thema: licht → liberty, donker → dark.
  const IMAP_LIGHT = "https://tiles.openfreemap.org/styles/liberty";
  const IMAP_DARK = "https://tiles.openfreemap.org/styles/dark";
  // De rasterstijlen als MapLibre-stijl: dezelfde tegel-URL in een wrapper,
  // met de subdomeinen uitgeschreven (MapLibre kent geen {s}, wel een lijst).
  function styleSpec() {
    if (mapStyle === "imap") return isDark() ? IMAP_DARK : IMAP_LIGHT;
    const s = MAP_STYLES[mapStyle] || MAP_STYLES.standard;
    const subs = (s.subdomains || "abc").split("");
    const tiles = s.url.includes("{s}") ? subs.map((x) => s.url.replace("{s}", x)) : [s.url];
    return {
      version: 8,
      sources: { base: { type: "raster", tiles: tiles, tileSize: 256, maxzoom: s.maxZoom, attribution: s.attribution } },
      layers: [{ id: "base", type: "raster", source: "base" }],
    };
  }
  function applyMapStyle() {
    // Alleen iMap heeft een eigen donkere variant; de rasterstijlen worden in
    // het donkere thema door CSS geïnverteerd, maar niet een kaart die al donker is.
    document.body.classList.toggle("mapstyle-dark", mapStyle === "imap");
    map.setStyle(styleSpec());   // styledata hangt de cirkel-laag terug
  }

  // ---- cirkels op de grond ---------------------------------------------
  // Eén GeoJSON-bron voor alle nauwkeurigheidscirkels samen: ze veranderen op
  // hetzelfde moment (elke seconde tijdens het schatten), dus één setData.
  const CIRCLES = "baken-circles";
  // Hang op wat er niet is, en verder niets: geen drawCircles() als de bron al
  // bestaat. Deze functie hangt ook aan `idle`, en een setData op elke idle
  // wekt de volgende idle — een tekenlus die de accu leegtrekt.
  function ensureCircleLayer() {
    if (!map || map.getSource(CIRCLES)) return;
    // Een stijl die nog laadt weigert een laag; te vroeg is geen fout, het
    // volgende event komt vanzelf.
    try { addCircleLayers(); } catch (e) { return; }
    drawCircles();
  }
  function addCircleLayers() {
    map.addSource(CIRCLES, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "baken-circles-fill", type: "fill", source: CIRCLES,
      paint: { "fill-color": ["get", "color"], "fill-opacity": ["get", "fill"] } });
    // Wit eronder, kleur erop: zonder die witte scheiding verdwijnt een dunne
    // gekleurde ring tegen een drukke kaart.
    map.addLayer({ id: "baken-circles-halo", type: "line", source: CIRCLES,
      paint: { "line-color": "#fff", "line-opacity": 0.7, "line-width": 4 } });
    map.addLayer({ id: "baken-circles-line", type: "line", source: CIRCLES,
      paint: { "line-color": ["get", "color"], "line-opacity": ["get", "stroke"], "line-width": 2 } });
  }
  // De getoonde nauwkeurigheid loopt achter de gemeten aan: pas bij een
  // verandering van ACC_STEP beweegt hij mee, en dan geanimeerd, zodat je
  // ziet dát de meting slechter of beter werd i.p.v. een springende cirkel.
  // De toestand hangt aan het object dat de cirkel bezit (persoon of kijker).
  let accAnims = [];   // lopende overgangen; leeg = geen rAF-lus
  let accRaf = null;
  function smoothAcc(o, target) {
    if (target == null || !(target > 0)) { o._accShown = null; o._accAnim = null; return null; }
    if (o._accShown == null) { o._accShown = target; return target; }   // eerste fix: meteen
    const ref = o._accAnim ? o._accAnim.to : o._accShown;
    if (!accChanged(ref, target, ACC_STEP)) return o._accShown;         // ruis: laten staan
    o._accAnim = { from: o._accShown, to: target, t0: performance.now() };
    if (accAnims.indexOf(o) < 0) accAnims.push(o);
    startAccAnim();
    return o._accShown;
  }
  function startAccAnim() {
    if (accRaf != null) return;
    const step = () => {
      const now = performance.now();
      accAnims = accAnims.filter((o) => {
        const a = o._accAnim;
        if (!a) return false;
        const k = Math.min((now - a.t0) / ACC_ANIM_MS, 1);
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;   // ease-in-out
        o._accShown = a.from + (a.to - a.from) * e;
        if (k >= 1) { o._accAnim = null; return false; }
        return true;
      });
      applyRadii();
      drawCircles();
      accRaf = accAnims.length ? requestAnimationFrame(step) : null;
    };
    accRaf = requestAnimationFrame(step);
  }
  // Getekende straal = getoonde nauwkeurigheid + wat de tussenschatting
  // erbij doet. Die twee bewegen in een ander ritme en blijven dus gescheiden.
  function applyRadii() {
    for (const k in people) {
      const p = people[k];
      if (p._circle && p._accShown != null) p._circle.r = p._accShown + (p._estBoost || 0);
    }
    if (viewerCircle && viewerAcc._accShown != null) viewerCircle.r = viewerAcc._accShown;
  }
  function circleFeature(c) {
    if (!circleShows(c.r, CIRCLE_SHOW_M)) return null;
    return { type: "Feature",
      properties: { color: c.color, fill: c.fill, stroke: c.stroke },
      geometry: { type: "Polygon", coordinates: [circleRing(c.lat, c.lon, c.r)] } };
  }
  function drawCircles() {
    if (!map) return;
    const src = map.getSource(CIRCLES);
    if (!src) return;
    const feats = [];
    const add = (c) => { const f = circleFeature(c); if (f) feats.push(f); };
    for (const k in people) if (people[k]._circle) add(people[k]._circle);
    if (viewerCircle) add(viewerCircle);
    src.setData({ type: "FeatureCollection", features: feats });
  }

  // Lang drukken maakt een nieuwe plek. Leaflet maakte daar op een touchscreen
  // zelf een contextmenu van; MapLibre laat dat aan de browser, en iOS stuurt
  // geen contextmenu. Zonder dit kan je op een telefoon geen plek maken.
  function armLongPress() {
    const c = map.getCanvasContainer();
    let hold = null, start = null;
    const cancel = () => { if (hold) { clearTimeout(hold); hold = null; } };
    c.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) { cancel(); return; }
      const p = e.touches[0], r = c.getBoundingClientRect();
      start = { x: p.clientX - r.left, y: p.clientY - r.top, cx: p.clientX, cy: p.clientY };
      cancel();
      hold = setTimeout(() => {
        hold = null;
        const at = map.unproject([start.x, start.y]);
        openNewPlace(at.lat, at.lng);
      }, 600);
    }, { passive: true });
    c.addEventListener("touchmove", (e) => {
      if (!hold || !start || !e.touches.length) return;
      const p = e.touches[0];
      if (Math.abs(p.clientX - start.cx) > 10 || Math.abs(p.clientY - start.cy) > 10) cancel();
    }, { passive: true });
    c.addEventListener("touchend", cancel);
    c.addEventListener("touchcancel", cancel);
  }

  // Een MapLibre-marker hangt in de kaart-container, dus een klik erop bereikt
  // ook de kaart zelf, en met closeOnClick sluit die precies de pop-up die de
  // klik net opende. De klik hoort bij de marker en stopt daar.
  function onMarkerClick(fn) {
    return (e) => { e.stopPropagation(); fn(); };
  }

  // Eén pop-up tegelijk, zoals Leaflets openOn(map).
  function openPopup(lat, lon, node, offset) {
    closePopup();
    popup = new maplibregl.Popup({ offset: offset, closeButton: true, maxWidth: "none" })
      .setLngLat(ll(lat, lon)).setDOMContent(node).addTo(map);
    return popup;
  }
  function closePopup() { if (popup) { popup.remove(); popup = null; } }

  // Centreer op een punt met een gekozen breedte (km) van rand tot rand.
  function fitWidthKm(lat, lon, km) {
    const dLon = (km / 2) / (111.32 * Math.cos(lat * Math.PI / 180));
    map.fitBounds([ll(lat, lon - dLon), ll(lat, lon + dLon)], { animate: false });
  }
  // Meerdere personen: allemaal in beeld. Twee dingen die Leaflet gratis deed
  // en die terug moeten, anders wiebelt de kaart onder de mensen: Leaflet zoomde
  // in hele stappen (MapLibre in fracties, dus bij elke refresh een beetje
  // anders), en Leaflet schoof geanimeerd.
  function fitPoints(pts, animate) {
    const b = new maplibregl.LngLatBounds();
    pts.forEach((p) => b.extend(ll(p[0], p[1])));
    const cam = map.cameraForBounds(b, { padding: 60, maxZoom: 16 });
    if (!cam) return;
    const target = { center: cam.center, zoom: Math.floor(Math.min(cam.zoom, 16)) };
    if (animate) map.easeTo(Object.assign({ duration: 400 }, target));
    else map.jumpTo(target);
  }
  // Find-My-achtig vaantje: ronde foto met pulserende gloed + pin-tail. Geen
  // foto (of laadt niet)? Dan valt de gekleurde initiaal eronder terug.
  //
  // De foto als background-image i.p.v. <img onerror=...>: een inline event
  // handler is verboden onder de strikte CSP (script-src 'self'). Laadt de
  // foto niet, dan blijft de laag transparant en schijnt de initiaal erdoor:
  // geen kapot-plaatje-icoon, geen CSP-schending.
  //
  // `position:absolute` en niet `relative`: MapLibre zet een marker zelf op
  // absolute en plaatst hem met een transform; een inline `relative` wint
  // daarvan en dan belandt de pin in de gewone tekststroom.
  function personIcon(name, color) {
    const letter = esc(name.charAt(0).toUpperCase());
    const file = photoFile(name);
    const photo = PHOTO_PATH && file
      ? `<div style="position:absolute;inset:0;background:url('${PHOTO_PATH}${file}.png') center/cover no-repeat;"></div>`
      : "";
    return el(`<div style="position:absolute;width:54px;height:64px;">` +
        `<div class="ppulse" style="background:${color};"></div>` +
        `<div class="ppulse d" style="background:${color};"></div>` +
        // tail — de punt staat precies op de coördinaat (PERSON_OFFSET)
        `<div style="position:absolute;left:50%;top:42px;transform:translateX(-50%);width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-top:13px solid #fff;filter:drop-shadow(0 2px 2px rgba(0,0,0,.3));"></div>` +
        // bubble (foto bovenop, letter eronder als fallback)
        `<div style="position:absolute;left:50%;top:23px;transform:translate(-50%,-50%);width:46px;height:46px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);overflow:hidden;display:grid;place-items:center;color:#fff;font-weight:700;font-size:18px;">` +
        `<span>${letter}</span>` + photo +
        `</div></div>`);
  }
  // Waar in het element de coördinaat zit. MapLibre zet het midden van het
  // element op het punt; wat hier staat is het verschil daarmee. De driehoek
  // begint op y=42 en is 13 px hoog, dus de punt zit op y=55 (element 54x64).
  const PERSON_OFFSET = [0, 32 - 55];
  const CENTER_OFFSET = [0, 0];         // plek-emoji en je eigen stip
  function placeEmoji(name) {
    const n = name.toLowerCase();
    if (/thuis|huis|home/.test(n)) return "🏠";
    if (/werk|kantoor|work|office/.test(n)) return "💼";
    return "📍";
  }
  // Alleen de emoji, geen witte schijf eronder: die was op een telefoon met
  // pixel-ratio 3 een witte vlek waarin de emoji verdween. Twee drop-shadows
  // (wit en donker) laten hem op elke ondergrond loskomen. Het vak blijft
  // 40 px, zodat er met een vinger iets te raken is.
  function placeIcon(name) {
    return el(`<div style="width:40px;height:40px;display:grid;place-items:center;font-size:26px;line-height:1;` +
      `filter:drop-shadow(0 0 1px rgba(255,255,255,.9)) drop-shadow(0 1px 2px rgba(0,0,0,.45));">${placeEmoji(name)}</div>`);
  }

  // ---- adres (server-side, per coördinaat gecachet) -------------------
  // /geocode staat in de proxy (Nominatim, server-side), zodat de browser van
  // de kijker de coördinaten niet zelf aan een derde geeft. Geen /geocode
  // achter de proxy (404)? Dan stoppen we er deze sessie mee i.p.v. het elke
  // refresh opnieuw te proberen. Een tijdelijke storing wordt níet als "geen
  // adres" onthouden, anders blijft dat adres leeg tot je de app herlaadt.
  let geoOff = false, geoRetryAt = 0;
  async function addressOf(lat, lon) {
    if (!SHOW_ADDR || geoOff || Date.now() < geoRetryAt) return "";
    const key = lat.toFixed(4) + "," + lon.toFixed(4);
    if (geoCache[key] !== undefined) return geoCache[key];
    try {
      const q = `format=jsonv2&zoom=18&lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&accept-language=${encodeURIComponent(window.I18N.lang)}`;
      const r = await fetch("geocode?" + q, { credentials: "same-origin" });
      if (r.status === 404) { geoOff = true; return ""; }
      if (!r.ok) throw new Error("geocode " + r.status);
      const d = await r.json(); const a = d.address || {};
      const road = a.road || a.pedestrian || a.neighbourhood || "";
      const place = a.city || a.town || a.village || a.municipality || "";
      geoCache[key] = [road, place].filter(Boolean).join(", ") || d.display_name || "";
    } catch (e) { geoRetryAt = Date.now() + 60000; return ""; }
    return geoCache[key];
  }

  // ---- plaatsen --------------------------------------------------------
  function placeContaining(lat, lon) {
    for (const p of places) if (haversine({ lat, lon }, { lat: p.lat, lon: p.lon }) <= p.radius) return p;
    return null;
  }
  function savePlaces() { store.set("places", places); renderPlaceMarkers(); }
  function renderPlaceMarkers() {
    if (!map) return;
    for (const id in placeMarkers) { placeMarkers[id].remove(); delete placeMarkers[id]; }
    places.forEach((p) => {
      const node = placeIcon(p.name);
      node.style.cursor = "pointer";
      node.addEventListener("click", onMarkerClick(() => openPlacePopup(p)));
      placeMarkers[p.id] = new maplibregl.Marker({ element: node, offset: CENTER_OFFSET })
        .setLngLat(ll(p.lat, p.lon)).addTo(map);
    });
  }

  // ---- meldingen -------------------------------------------------------
  function saveNotifs() { store.set("notifs", notifs); }
  // Meldingen stapelen i.p.v. elkaar te overschrijven: komen er twee kort na
  // elkaar binnen, dan lees je ze allebei. Met één melding is dit precies wat
  // het was; zodra de toast weg is, is hij leeg.
  function notice(text) {
    const box = $("toast");
    if (box.classList.contains("hidden")) box.innerHTML = "";
    const line = document.createElement("div");
    line.className = "toast-line";
    line.textContent = text;   // textContent: dit is vreemde tekst
    box.appendChild(line);
    box.classList.remove("hidden");
    // Meer regels is meer lezen, dus meer tijd; de klok begint opnieuw bij
    // elke nieuwe regel.
    clearTimeout(notice._t);
    notice._t = setTimeout(() => { box.classList.add("hidden"); box.innerHTML = ""; }, 6000 + 2000 * (box.childElementCount - 1));
    if ("Notification" in window && Notification.permission === "granted") {
      try { new Notification(BRAND, { body: text, icon: "icon-192.png" }); } catch (e) {}
    }
  }
  function checkTransitions(name, lat, lon) {
    const cur = placeContaining(lat, lon);
    const curId = cur ? cur.id : null;
    if (!(name in lastPlaceByPerson)) { lastPlaceByPerson[name] = curId; return; }
    const prev = lastPlaceByPerson[name];
    if (curId === prev) return;
    // vertrek uit prev
    if (prev) fireFor(name, prev, "leave");
    // aankomst in cur
    if (curId) fireFor(name, curId, "arrive");
    lastPlaceByPerson[name] = curId;
  }
  function fireFor(person, placeId, event) {
    const place = places.find((p) => p.id === placeId); if (!place) return;
    let changed = false;
    notifs = notifs.filter((n) => {
      if (n.person === person && n.placeId === placeId && n.event === event) {
        notice(event === "arrive" ? t("arrived", { who: person, place: place.name }) : t("left", { who: person, place: place.name }));
        if (n.once) { changed = true; return false; }
      }
      return true;
    });
    if (changed) { saveNotifs(); renderNotifList(); }
  }

  // ---- pop-ups ---------------------------------------------------------
  async function openPersonPopup(person) {
    const p = person.pos; if (!p) return;
    const addr = await addressOf(p.lat, p.lon);
    const within = placeContaining(p.lat, p.lon);
    const node = el(`<div class="pop">
      <div class="pop-h"><span class="pop-dot" style="background:${person.color}"></span><b>${esc(person.name)}</b></div>
      <div class="pop-sub">${esc(addr || "")}</div>
      <div class="pop-sub dim">${t("last_seen")} · ${agoTxt(p.t)}${person._batt != null ? ` · ${person._batt <= 20 ? "🪫" : "🔋"} ${Math.round(person._batt)}%` : ""}</div>
      <div class="pop-row"><input class="pop-name" placeholder="${esc(t("name_ph"))}" value="${within ? esc(within.name) : ""}">
        <button class="pop-btn save">${t("save")}</button></div>
      ${within ? `<button class="pop-btn link mk-notif">🔔 ${t("notify")}…</button><div class="notif-form hidden"></div>` : ""}
    </div>`);
    node.querySelector(".save").onclick = () => {
      const nm = node.querySelector(".pop-name").value.trim(); if (!nm) return;
      if (within) { within.name = nm; } else { places.push({ id: Date.now(), name: nm, lat: p.lat, lon: p.lon, radius: DEF_RADIUS }); }
      savePlaces(); closePopup();
    };
    const mk = node.querySelector(".mk-notif");
    if (mk) mk.onclick = () => buildNotifForm(node.querySelector(".notif-form"), person.name, within);
    // 60 px vrij: de pin steekt boven zijn punt uit, de pop-up begint daarboven.
    openPopup(p.lat, p.lon, node, 60);
  }

  async function openPlacePopup(place) {
    const addr = await addressOf(place.lat, place.lon);
    const node = el(`<div class="pop">
      <div class="pop-h"><span class="pop-emoji">${placeEmoji(place.name)}</span><b class="ph-name">${esc(place.name)}</b></div>
      <div class="pop-sub">${esc(addr || "")}</div>
      <div class="pop-row"><input class="pop-name" value="${esc(place.name)}"><button class="pop-btn save">${t("save")}</button></div>
      <button class="pop-btn link mk-notif">🔔 ${t("notify")}…</button>
      <div class="notif-form hidden"></div>
      <button class="pop-btn danger del">${t("del")}</button>
    </div>`);
    node.querySelector(".save").onclick = () => { const nm = node.querySelector(".pop-name").value.trim(); if (!nm) return; place.name = nm; savePlaces(); closePopup(); };
    // Een plek met meldingen erop weggooien liet anders meldingen achter die
    // niemand meer kan plaatsen ("?" in de lijst). Dus eerst zeggen wat er
    // mee weggaat, en pas na een ja.
    node.querySelector(".del").onclick = () => {
      const here = notifs.filter((n) => n.placeId === place.id);
      if (here.length && !confirm(t("del_place_notifs", { n: here.length, place: place.name }))) return;
      if (here.length) { notifs = notifs.filter((n) => n.placeId !== place.id); saveNotifs(); renderNotifList(); }
      places = places.filter((x) => x.id !== place.id); savePlaces(); closePopup();
    };
    node.querySelector(".mk-notif").onclick = () => buildNotifForm(node.querySelector(".notif-form"), null, place);
    openPopup(place.lat, place.lon, node, 22);
  }

  async function openNewPlace(lat, lon) {
    setFollow(false);
    const addr = await addressOf(lat, lon);
    const node = el(`<div class="pop">
      <div class="pop-h"><span class="pop-emoji">📍</span><b>${t("new_place")}</b></div>
      <div class="pop-sub">${esc(addr || "")}</div>
      <div class="pop-row"><input class="pop-name" placeholder="${esc(t("name_ph"))}"><button class="pop-btn save">${t("save")}</button></div>
    </div>`);
    node.querySelector(".save").onclick = () => { const nm = node.querySelector(".pop-name").value.trim(); if (!nm) return; places.push({ id: Date.now(), name: nm, lat, lon, radius: DEF_RADIUS }); savePlaces(); closePopup(); };
    openPopup(lat, lon, node, 12);
  }

  // Meldingsformulier binnen een pop-up. person==null → kies persoon.
  function buildNotifForm(host, person, place) {
    host.classList.remove("hidden");
    const shownNames = visibleNames();
    const personSel = person ? `<input type="hidden" class="nf-person" value="${esc(person)}">`
      : `<select class="nf-person">${shownNames.map((n) => `<option>${esc(n)}</option>`).join("")}</select>`;
    host.innerHTML = `
      ${personSel}
      <div class="nf-row">
        <label><input type="radio" name="nf-ev" value="arrive" checked> ${t("arrives")}</label>
        <label><input type="radio" name="nf-ev" value="leave"> ${t("leaves")}</label>
      </div>
      <label class="nf-once"><input type="checkbox" class="nf-once-cb"> ${t("once")}</label>
      <button class="pop-btn save nf-save">${t("save_notif")}</button>`;
    host.querySelector(".nf-save").onclick = async () => {
      const who = host.querySelector(".nf-person").value;
      if (!who) return;
      const ev = host.querySelector('input[name="nf-ev"]:checked').value;
      const once = host.querySelector(".nf-once-cb").checked;
      if ("Notification" in window && Notification.permission === "default") { try { await Notification.requestPermission(); } catch (e) {} }
      notifs.push({ id: Date.now(), person: who, placeId: place.id, event: ev, once });
      saveNotifs(); renderNotifList(); closePopup();
    };
  }

  // ---- personen renderen ----------------------------------------------
  function visibleNames() { return devices.filter((d) => shown == null || shown.includes(d.name)).map((d) => d.name); }
  function isShown(name) { return shown == null || shown.includes(name); }

  // Zet de pin (en de cirkel) op de plek waar hij nu hoort: de echte fix, of
  // de tussenschatting als die mag. Eén plek die dat beslist, gebruikt door
  // zowel de refresh als de tik van elke seconde; anders sprong de pin bij
  // elke refresh terug naar de fix en een seconde later weer vooruit.
  function placePerson(p, now) {
    if (!p.marker || !p._fixLL) return false;
    const canEst = p._kmh != null && p._kmh >= SPEED_MIN_KMH && p._course != null;
    const secs = canEst ? estimateSeconds(now, p._recvT, p._lastFixT, EST_CAP_S, FIX_STALE_S) : 0;
    let at = p._fixLL, boost = 0;
    if (secs > 0) {
      const ms = p._kmh / 3.6;                                  // km/u → m/s
      at = projectLL(p._fixLL[0], p._fixLL[1], p._course, ms * secs);
      boost = ms * secs * 0.7;                                  // onzekerheid groeit mee
    } else if (!p._estimating) {
      return false;                                             // staat al op de fix
    }
    p._estimating = secs > 0;
    p.marker.setLngLat(ll(at[0], at[1]));
    if (p._circle) { p._circle.lat = at[0]; p._circle.lon = at[1]; }
    p._estBoost = boost;
    return true;
  }

  function renderPeople() {
    const vis = devices.filter((d) => isShown(d.name));
    // verwijder niet meer getoonde
    for (const id in people) if (!vis.find((d) => d.id == id)) { if (people[id].marker) people[id].marker.remove(); delete people[id]; }

    const now = Date.now();
    let single = vis.length === 1 ? null : false;
    vis.forEach((d) => {
      const pos = positions.find((x) => x.deviceId === d.id);
      let person = people[d.id];
      if (!person) person = people[d.id] = { id: d.id, name: d.name, color: colorFor(d.name), marker: null, prevFix: null, pos: null };
      person.name = d.name; person.color = colorFor(d.name);
      if (!pos) return;
      const at = pos.attributes || {};
      const cur = { lat: pos.latitude, lon: pos.longitude, t: new Date(pos.fixTime || pos.deviceTime || pos.serverTime).getTime() };
      person.pos = cur;

      // beweging afgeleid uit twee fixes
      let moving = at.motion === true || (pos.speed && pos.speed > 1);
      let kmh = (pos.speed != null && pos.speed > 0) ? Math.round(pos.speed * 1.852) : null;
      let course = pos.course || 0;
      if (person.prevFix && person.prevFix.t !== cur.t) {
        const dt = (cur.t - person.prevFix.t) / 1000, dm = haversine(person.prevFix, cur);
        if (dt > 0 && dt < 3600 && dm > 25) { const dkmh = (dm / dt) * 3.6; if (dkmh > 6) { moving = true; if (!kmh) kmh = Math.round(dkmh); if (!pos.course) course = bearing(person.prevFix, cur); } }
      }
      if (!person.prevFix || person.prevFix.t !== cur.t) person.prevFix = cur;

      // Snelheid pas tonen vanaf een drempel. GPS-ruis bij stilstand levert
      // makkelijk 1-2 km/u op; onder SPEED_MIN_KMH tonen we geen snelheid én
      // geen "onderweg"-label.
      if (kmh != null && kmh < SPEED_MIN_KMH) { kmh = null; moving = false; }

      const fixLL = [cur.lat, cur.lon];
      if (!person.marker) {
        const node = personIcon(d.name, person.color);
        node.style.cursor = "pointer";
        node.style.zIndex = "10";     // pins boven de plek-emoji's
        node.addEventListener("click", onMarkerClick(() => openPersonPopup(person)));
        person.marker = new maplibregl.Marker({ element: node, offset: PERSON_OFFSET })
          .setLngLat(ll(cur.lat, cur.lon)).addTo(map);
      }
      // Nauwkeurigheidscirkel (alleen als Traccar een echte accuracy meelevert).
      const accM = (pos.accuracy != null && pos.accuracy > 0 && pos.accuracy < 3000) ? pos.accuracy : null;
      const accShown = smoothAcc(person, accM);
      person._circle = accShown != null
        ? { lat: fixLL[0], lon: fixLL[1], r: accShown, color: person.color, fill: 0.15, stroke: 0.55 }
        : null;
      person._moving = moving; person._kmh = kmh; person._status = d.status;
      person._batt = (typeof at.batteryLevel === "number") ? at.batteryLevel : null;
      // Velden voor de tussenpositie-schatting. Bewaar de échte fix apart van
      // wat we (geschat) tekenen, en stempel WANNEER we 'm ontvingen.
      person._course = course;
      if (person._lastFixT !== cur.t) { person._lastFixT = cur.t; person._recvT = now; person._fixLL = fixLL; person._estimating = false; }
      // Positie (echt of geschat) + cirkel op de juiste plek. Een nieuwe fix
      // zet _estimating terug, dus dan landt de pin eerst op de waarheid.
      if (!placePerson(person, now)) { person.marker.setLngLat(ll(person._fixLL[0], person._fixLL[1])); person._estBoost = 0; }

      checkTransitions(d.name, cur.lat, cur.lon);
      if (vis.length === 1) single = { d, person, moving, kmh };
    });

    // Refresh-tempo: alleen wie een verse fix heeft telt mee. Een uren oude
    // fix met snelheid liet de app anders eindeloos elke 5 s pollen.
    lastMaxKmh = Object.keys(people).reduce((m, k) => {
      const p = people[k];
      return (p._kmh && p._lastFixT && now - p._lastFixT <= FIX_STALE_S * 1000) ? Math.max(m, p._kmh) : m;
    }, 0);
    applyRadii();
    drawCircles();

    // volgen / centreren
    const pts = vis.map((d) => people[d.id] && people[d.id].pos).filter(Boolean).map((p) => [p.lat, p.lon]);
    if (pts.length) {
      if (!centeredOnce) {
        if (pts.length === 1) fitWidthKm(pts[0][0], pts[0][1], 1);   // ~1 km breed bij openen
        else fitPoints(pts, false);
        centeredOnce = true;
      } else if (follow && !fingers) {
        // Geanimeerd: bijsturen moet glijden. Niet terwijl er een vinger op de
        // kaart staat: panTo/easeTo stoppen de camera en breken het gebaar af.
        if (pts.length === 1) map.panTo(ll(pts[0][0], pts[0][1]), { duration: 400 });   // volgen, zoom behouden
        else fitPoints(pts, true);
      }
    }

    renderTopcard(single);
  }

  // De pijl in de bovenkaart wijst naar de persoon zoals die op het scherm
  // staat: draai je de kaart, dan draait de pijl mee.
  let arrowDeg = null;
  function orientArrow() {
    const a = $("t-dist") && $("t-dist").querySelector(".arrow");
    if (!a || arrowDeg == null) return;
    a.style.transform = `rotate(${arrowDeg - (map ? map.getBearing() : 0)}deg)`;
  }

  async function renderTopcard(single) {
    if (!single) { $("topcard").classList.add("hidden"); return; }
    const { d, person, moving, kmh } = single;
    $("topcard").classList.remove("hidden");
    $("status-dot").className = "dot" + (d.status === "online" ? " online" : "");
    $("t-name").textContent = d.name;
    $("t-move").textContent = moving ? ("🚗 " + t("moving") + (kmh ? ` · ${kmh} km/u` : "")) : "";
    // Echte batterij-indicator: een omhulsel met een vulbalk die meeschaalt,
    // i.p.v. het statische 🔋 dat er altijd vol uitziet.
    const bt = person._batt, be = $("t-batt");
    if (bt != null) {
      const lvl = Math.max(0, Math.min(100, Math.round(bt)));
      const low = lvl <= 20;
      const fill = low ? "#ff453a" : (lvl <= 40 ? "#ff9f0a" : "var(--ok)");
      be.innerHTML =
        `<span class="batt" aria-label="${lvl}%">` +
          `<span class="batt-body"><span class="batt-fill" style="width:${lvl}%;background:${fill};"></span></span>` +
          `<span class="batt-cap"></span>` +
        `</span>` +
        `<span class="batt-pct"${low ? ' style="color:#ff453a;"' : ""}>${lvl}%</span>`;
    } else be.innerHTML = "";
    if (person.pos && viewer) {
      const dist = fmtDist(haversine(viewer, person.pos));
      arrowDeg = bearing(viewer, person.pos);
      $("t-dist").innerHTML = `<span class="arrow">↑</span> ${dist}`;
      orientArrow();
    } else { arrowDeg = null; $("t-dist").textContent = ""; }
    $("t-seen").textContent = person.pos ? `🕓 ${t("last_seen")} · ${agoTxt(person.pos.t)}` : t("no_pos");
    $("t-addr").textContent = person.pos ? (await addressOf(person.pos.lat, person.pos.lon)) : "";
  }

  // ---- data ------------------------------------------------------------
  // true = ververst (of in elk geval geprobeerd), false = sessie weg, login getoond.
  async function refresh() {
    try {
      let dr = await api("devices");
      if (dr.status === 401 || dr.status === 404) {
        // sessie weg → stil opnieuw inloggen met token, daarna opnieuw proberen
        if (await reloginToken()) dr = await api("devices");
        if (dr.status === 401 || dr.status === 404) { showLogin(); return false; }
      }
      // Een mislukte apparatenlijst (foutpagina, fout-JSON van de proxy) mag
      // de kaart niet meenemen: houd de lijst die we al hadden en ga door
      // naar de posities. Anders bewoog er niets meer.
      let all = null;
      try { all = await dr.json(); } catch (e) {}
      // Sluit het eigen toestel uit — je volgt jezelf niet.
      if (Array.isArray(all)) devices = all.filter((d) => !me || String(d.name).toLowerCase() !== String(me).toLowerCase());
      const pr = await api("positions");
      positions = pr.ok ? await pr.json() : [];
      renderPeople();
    } catch (e) {}
    return true;
  }

  // ---- kijker-geolocatie ----------------------------------------------
  // Eigen positie: blauwe stip + (bij kompas) een zachte richtings-flare.
  // Puur lokaal getekend; deze positie wordt NOOIT naar de server gestuurd.
  // De flare wijst naar het kompas, dus naar het noorden van de kaart: draai
  // je de kaart, dan draait de flare mee.
  function beamAngle(h) { return h - (map ? map.getBearing() : 0); }
  function beamSvg(h) {
    return `<svg class="vbeam" width="90" height="90" viewBox="0 0 90 90" ` +
      `style="position:absolute;left:50%;top:50%;transform-origin:50% 50%;transform:translate(-50%,-50%) rotate(${beamAngle(h)}deg);pointer-events:none;overflow:visible;">` +
      `<defs><radialGradient id="vbg" cx="0.5" cy="0.5" r="0.5">` +
      `<stop offset="0" stop-color="#0a84ff" stop-opacity="0.45"/>` +
      `<stop offset="1" stop-color="#0a84ff" stop-opacity="0"/></radialGradient></defs>` +
      `<path d="M45 45 L21 11 A41 41 0 0 1 69 11 Z" fill="url(#vbg)"/></svg>`;
  }
  function viewerIcon(h) {
    const beam = (h != null) ? beamSvg(h) : "";
    return el(`<div style="position:absolute;width:90px;height:90px;pointer-events:none;">${beam}` +
      `<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:16px;height:16px;border-radius:50%;background:#0a84ff;border:2.5px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.2),0 1px 3px rgba(0,0,0,.4);"></div></div>`);
  }
  // Blauwe stip + richtings-flare (kompas) + nauwkeurigheidscirkel (Apple-stijl).
  let heading = null, viewerHasBeam = false, viewerCircle = null, lastDrawn = null;
  const viewerAcc = {};   // draagt de getoonde nauwkeurigheid van de kijker zelf
  function rotateBeam(h) {
    if (h == null || !viewerMarker) return;
    const node = viewerMarker.getElement();
    const b = node && node.querySelector(".vbeam");
    if (b) b.style.transform = `translate(-50%,-50%) rotate(${beamAngle(h)}deg)`;
  }
  function newViewerMarker() {
    const m = new maplibregl.Marker({ element: viewerIcon(heading), offset: CENTER_OFFSET })
      .setLngLat(ll(viewer.lat, viewer.lon)).addTo(map);
    m.getElement().style.zIndex = "5";   // onder de pins, boven de plekken
    return m;
  }
  function renderViewer(acc) {
    if (!map || !viewer) return;
    const wantBeam = heading != null;
    if (!viewerMarker) {
      viewerMarker = newViewerMarker();
      viewerHasBeam = wantBeam;
    } else {
      viewerMarker.setLngLat(ll(viewer.lat, viewer.lon));
      // De flare komt of gaat: dat is een ander element, dus een nieuwe marker.
      if (wantBeam !== viewerHasBeam) { viewerMarker.remove(); viewerMarker = newViewerMarker(); viewerHasBeam = wantBeam; }
      else if (wantBeam) rotateBeam(heading);
    }
    if (acc != null && acc > 0) {
      const shownAcc = smoothAcc(viewerAcc, acc);
      viewerCircle = { lat: viewer.lat, lon: viewer.lon, r: shownAcc, color: "#0a84ff", fill: 0.15, stroke: 0.55 };
      drawCircles();
    }
  }
  function startGeo() {
    if (!navigator.geolocation) return;
    navigator.geolocation.watchPosition(
      (pos) => {
        const acc = pos.coords.accuracy;
        const np = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        viewer = np;
        // Richting komt van het kompas; alleen als er nooit een kompas was
        // (bv. desktop) gebruiken we de GPS-loopkoers tijdens beweging.
        if (lastCompassTs === 0) {
          const moving = pos.coords.speed != null && pos.coords.speed > 1.5;
          if (moving && pos.coords.heading != null && !isNaN(pos.coords.heading)) heading = pos.coords.heading;
        }
        if (lastDrawn && viewerMarker && haversine(lastDrawn, np) < 5) {
          if (viewerCircle && acc != null) { const r = smoothAcc(viewerAcc, acc); if (r != null) viewerCircle.r = r; drawCircles(); }
          return;
        }
        lastDrawn = np;
        renderViewer(acc);
        // Eerste fix en je volgt niemand met een positie? Centreer op jezelf (~1 km).
        if (!centeredOnce && follow) {
          const anyPeople = devices.some((d) => isShown(d.name) && people[d.id] && people[d.id].pos);
          if (!anyPeople) { fitWidthKm(np.lat, np.lon, 1); centeredOnce = true; }
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  }

  // Kompas: stuurt de flare, ook bij stilstand.
  let lastCompassTs = 0, lastBeam = 0;
  function onOrient(e) {
    let h = null;
    if (e.webkitCompassHeading != null) {
      if (e.webkitCompassAccuracy != null && e.webkitCompassAccuracy < 0) return;  // ongekalibreerd → negeren
      h = e.webkitCompassHeading;
    } else if (e.absolute && e.alpha != null) {
      const so = (screen.orientation && screen.orientation.angle) || 0;
      h = (360 - e.alpha + so) % 360;
    }
    if (h == null || isNaN(h)) return;
    const first = lastCompassTs === 0;
    heading = h; lastCompassTs = Date.now();
    if (first) renderCompass();
    const now = Date.now();
    if (now - lastBeam > 80) { lastBeam = now; if (viewerMarker && viewerHasBeam) rotateBeam(h); else renderViewer(); }
  }
  function startCompass() {
    // Zelfde functie + zelfde capture-vlag: de browser voegt niets dubbel toe,
    // dus vaker aanroepen is veilig.
    window.addEventListener("deviceorientationabsolute", onOrient, true);
    window.addEventListener("deviceorientation", onOrient, true);
  }
  // iOS wil de toestemmingsvraag vanuit een echt gebruikersgebaar, en het
  // antwoord kan ook een verworpen promise zijn (gebaar verlopen, verkeerde
  // context). Alleen "granted" en "denied" zijn een antwoord; al het andere
  // laat de vraag open, zodat het volgende gebaar het opnieuw mag proberen.
  // Eén enkele kans was precies wat stuk was: ging die ene tik naar iets
  // anders, dan was er geen kompas tot de volgende start.
  const COMPASS_ASKS = !!(window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function");
  let compassState = COMPASS_ASKS ? "ask" : "open";   // ask | pending | granted | denied | open
  function enableCompass() {
    if (!COMPASS_ASKS) { compassState = "open"; startCompass(); return Promise.resolve("open"); }
    if (compassState !== "ask") return Promise.resolve(compassState);
    compassState = "pending";
    // Een promise die nooit antwoordt zou de vraag voorgoed sluiten; na een
    // halve minuut staat hij weer open.
    setTimeout(() => { if (compassState === "pending") compassState = "ask"; }, 30000);
    return DeviceOrientationEvent.requestPermission().then((s) => {
      compassState = (s === "granted") ? "granted" : (s === "denied" ? "denied" : "ask");
      if (compassState === "granted") { startCompass(); disarmCompassGestures(); }
      if (compassState === "denied") { disarmCompassGestures(); notice(t("compass_denied")); }
      renderCompass();
      return compassState;
    }).catch(() => { compassState = "ask"; return "ask"; });
  }
  // Capture-fase op window: een pin of knop die het event stopt
  // (stopPropagation) mag de vraag niet opeten.
  let compassArmed = false;
  function onCompassGesture() { enableCompass(); }
  function armCompassGestures() {
    if (compassArmed) return;
    compassArmed = true;
    window.addEventListener("click", onCompassGesture, true);
    window.addEventListener("touchend", onCompassGesture, true);
  }
  function disarmCompassGestures() {
    compassArmed = false;
    window.removeEventListener("click", onCompassGesture, true);
    window.removeEventListener("touchend", onCompassGesture, true);
  }
  function armCompass() {
    if (!COMPASS_ASKS) { startCompass(); return; }   // Android, desktop: niets te vragen
    armCompassGestures();
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      // Terug uit de achtergrond kan iOS de toestemming vergeten zijn. Zolang
      // er geen weigering is, staat de vraag bij het eerste gebaar weer open.
      if (compassState === "granted") startCompass();
      else if (compassState !== "denied") armCompassGestures();
    });
  }
  // De weg terug die niet van toeval afhangt: zolang er geen richting binnen
  // is, staat er een knop in de instellingen, met uitleg wat er zonder kompas
  // niet gebeurt.
  function renderCompass() {
    const sec = $("sec-compass");
    if (!sec) return;
    const show = COMPASS_ASKS && lastCompassTs === 0;
    sec.classList.toggle("hidden", !show);
    if (!show) return;
    const denied = compassState === "denied";
    $("compass-on").classList.toggle("hidden", denied);
    $("compass-hint").textContent = t(denied ? "compass_denied" : "compass_why");
  }

  // ---- follow ----------------------------------------------------------
  function setFollow(on) { follow = on; $("fab-locate").classList.toggle("active", on); }

  // ---- instellingen ----------------------------------------------------
  // Een pop-up boven de knoppen rechtsonder i.p.v. een bottom sheet: het
  // tandwiel blijft zichtbaar en is ook de weg terug.
  async function openSheet() {
    renderWho(); renderNotifList(); renderCompass(); markSeg("seg-theme", theme); markSeg("seg-lang", langPref); markSeg("seg-map", mapStyle);
    if (appVersion == null) await checkVersion();
    $("ver").textContent = appVersion ? "v" + appVersion : "";
    $("sheet").classList.remove("hidden"); $("sheet-backdrop").classList.remove("hidden");
    $("fab-settings").classList.add("active");
  }
  // Sluiten sluit altijd beide lagen; Geavanceerd heeft zijn eigen weg terug.
  function closeSheet() {
    closeAdv();
    $("sheet").classList.add("hidden"); $("sheet-backdrop").classList.add("hidden");
    $("fab-settings").classList.remove("active");
  }
  function sheetOpen() { return !$("sheet").classList.contains("hidden"); }
  function toggleSheet() { if (sheetOpen() || advOpen()) closeSheet(); else openSheet(); }
  function advOpen() { return !$("adv").classList.contains("hidden"); }
  function openAdv() { $("adv").classList.remove("hidden"); $("sheet").classList.add("hidden"); }
  function closeAdv() { $("adv").classList.add("hidden"); }
  function backToSheet() { closeAdv(); $("sheet").classList.remove("hidden"); }
  // Uitloggen bevestigen in een eigen dialoog i.p.v. de kale confirm():
  // annuleren is de voorkeurskeuze en krijgt de focus.
  function askLogout() {
    $("logout-dlg").classList.remove("hidden"); $("confirm-backdrop").classList.remove("hidden");
    $("logout-cancel").focus();
  }
  function closeLogoutDlg() { $("logout-dlg").classList.add("hidden"); $("confirm-backdrop").classList.add("hidden"); }
  // De lege balk onderin op iOS: vanaf het beginscherm gestart geeft iOS de
  // pagina soms een layout-viewport die korter is dan het scherm (en na een
  // kwartslag draaien klopt het weer). Binnen de pagina is er dan niets mis,
  // dus map.resize() kan er niets aan doen. De correctie zet de hoogte op die
  // van het scherm zolang dat verschil er is; schade kan het niet doen.
  function screenGapPx() {
    const standalone = !!(navigator.standalone || (window.matchMedia && matchMedia("(display-mode: standalone)").matches));
    // Liggend telt niet (screen.height blijft op iOS de staande maat), en een
    // viewport zonder zinnige hoogte (tijdens opstarten) wordt niet gemeten.
    if (!standalone || window.innerHeight < 200 || window.innerWidth > window.innerHeight) return 0;
    return Math.round((screen.height || 0) - window.innerHeight);
  }
  function fillViewportGap() {
    const gap = screenGapPx();
    // Een groot verschil is geen opstartfout maar een browser met balken
    // eromheen; daar blijft 100dvh het juiste antwoord.
    const use = gap > 1 && gap < 200;
    const root = document.documentElement;
    if (use) { root.style.setProperty("--vh", screen.height + "px"); root.style.setProperty("--vhgap", gap + "px"); }
    else { root.style.removeProperty("--vh"); root.style.removeProperty("--vhgap"); }
  }
  function renderWho() {
    const sec = $("sec-who"), ul = $("who-list");
    if (devices.length <= 1) { sec.classList.add("hidden"); return; }
    sec.classList.remove("hidden"); ul.innerHTML = "";
    devices.forEach((d) => {
      const li = el(`<li><label><input type="checkbox" ${isShown(d.name) ? "checked" : ""}> <span class="cdot" style="background:${colorFor(d.name)}"></span> ${esc(d.name)}</label></li>`);
      li.querySelector("input").onchange = (e) => {
        let s = shown == null ? devices.map((x) => x.name) : shown.slice();
        if (e.target.checked) { if (!s.includes(d.name)) s.push(d.name); } else s = s.filter((n) => n !== d.name);
        shown = s; store.set("shown", shown); centeredOnce = false; renderPeople();
      };
      ul.appendChild(li);
    });
  }
  function renderNotifList() {
    const ul = $("notif-list"); ul.innerHTML = "";
    if (!notifs.length) { ul.appendChild(el(`<li class="empty">${t("no_notifs")}</li>`)); return; }
    notifs.forEach((n) => {
      const place = places.find((p) => p.id === n.placeId); const pn = place ? place.name : "?";
      const txt = n.event === "arrive" ? t("notif_arrive", { who: n.person, place: pn }) : t("notif_leave", { who: n.person, place: pn });
      const li = el(`<li><span>${esc(txt)} ${n.once ? `<i>${t("notif_once_tag")}</i>` : ""}</span></li>`);
      const b = el(`<button class="del">${t("del")}</button>`);
      b.onclick = () => { notifs = notifs.filter((x) => x.id !== n.id); saveNotifs(); renderNotifList(); };
      li.appendChild(b); ul.appendChild(li);
    });
  }
  function markSeg(id, val) { document.querySelectorAll("#" + id + " button").forEach((b) => b.classList.toggle("on", b.getAttribute("data-v") === val)); }

  // ---- auth ------------------------------------------------------------
  function showLogin() { $("login").classList.remove("hidden"); }
  function hideLogin() { $("login").classList.add("hidden"); }
  function loginShown() { return !$("login").classList.contains("hidden"); }
  async function checkSession() { try { const r = await api("session"); if (!r.ok) return false; const u = await r.json().catch(() => null); me = u && u.name ? u.name : null; return true; } catch (e) { return false; } }

  // Token aanmaken zodat we stil opnieuw kunnen inloggen. Bewust kort-levend
  // (TOKEN_DAYS) en periodiek hermunt (maybeRefreshToken): een gelekt token
  // verloopt dan vanzelf i.p.v. permanent geldig te blijven.
  async function makeToken() {
    try {
      const exp = new Date(Date.now() + TOKEN_DAYS * 864e5);
      const b = new URLSearchParams(); b.set("expiration", exp.toISOString());
      const r = await api("session/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: b.toString() });
      if (r.ok) { let tok = (await r.text()).trim(); if (tok.startsWith('"') && tok.endsWith('"')) tok = tok.slice(1, -1); if (tok) { store.set("token", tok); store.set("tokenExp", exp.getTime()); } }
    } catch (e) {}
  }
  // Hermunt het token als er geen is, de vervaldatum ontbreekt of oud is (migreert
  // de oude permanente 2099-tokens omlaag), óf als er minder dan TOKEN_REFRESH_DAYS
  // rest. Vereist een geldige sessie; faalt stil (dan blijft het oude token staan).
  async function maybeRefreshToken() {
    if (loginShown()) return;   // geen sessie → munten kan niet
    const exp = store.get("tokenExp", 0);
    if (!store.get("token", null) || !exp || exp - Date.now() < TOKEN_REFRESH_DAYS * 864e5) await makeToken();
  }
  // Stil opnieuw inloggen met het opgeslagen token. true = gelukt.
  async function reloginToken() {
    const tok = store.get("token", null); if (!tok) return false;
    try {
      const r = await api("session?token=" + encodeURIComponent(tok));
      if (r.ok) { const u = await r.json().catch(() => null); me = u && u.name ? u.name : me; return true; }
    } catch (e) {}
    return false;
  }
  // Expliciet uitloggen: de bevestiging zit in askLogout() (je wilt bijna
  // nooit uitloggen — een misklik mag je er niet uit gooien), hier alleen de
  // server-sessie beëindigen en het token wissen.
  async function doLogout() {
    closeLogoutDlg();
    try { await api("session", { method: "DELETE" }); } catch (e) {}
    store.del("token");
    store.del("tokenExp");
    location.reload();
  }

  async function doLogin(ev) {
    ev.preventDefault(); $("login-err").textContent = "";
    const b = new URLSearchParams(); b.set("email", $("u").value.trim()); b.set("password", $("p").value);
    try {
      const r = await api("session", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: b.toString() });
      if (r.ok) {
        const u = await r.json().catch(() => null);
        const prev = me;
        me = u && u.name ? u.name : null;
        // Een andere gebruiker ziet andere mensen: opnieuw centreren en de
        // aankomst/vertrek-toestand van de vorige niet meenemen.
        if (prev !== me) { centeredOnce = false; lastPlaceByPerson = {}; }
        hideLogin(); $("p").value = ""; await makeToken(); start();
      }
      else $("login-err").textContent = t("login_err");
    } catch (e) { $("login-err").textContent = t("conn_err"); }
  }

  // ---- versie-check: herlaad een open app na een nieuwe deploy ---------
  let appVersion = null;
  async function checkVersion() {
    try {
      const r = await fetch("version.json?_=" + Date.now(), { cache: "no-store" });
      if (!r.ok) return; const d = await r.json();
      if (appVersion == null) appVersion = d.version;
      else if (d.version !== appVersion) location.reload();
    } catch (e) {}
  }

  // Adaptief refresh-tempo: sneller pollen als iemand harder beweegt. (De
  // échte limiet blijft hoe vaak de telefoon zelf stuurt; dit zorgt dat we
  // een verse fix snel ophalen i.p.v. tot 30s te wachten.)
  function refreshDelay() {
    if (lastMaxKmh >= 30) return 5000;
    if (lastMaxKmh >= SPEED_MIN_KMH) return 8000;
    return REFRESH;
  }
  // Eén timer, nooit twee. Staat het login-scherm open, dan stopt het pollen;
  // start() zet het na het inloggen weer aan.
  function scheduleRefresh() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => { timer = null; if (await refresh()) scheduleRefresh(); }, refreshDelay());
  }

  // Tussenpositie-schatting ('live' gevoel): tussen twee echte fixes schuift
  // de marker langs de laatste koers met de laatste snelheid vooruit. De
  // onzekerheidscirkel groeit mee zodat de schatting eerlijk blijft; bij een
  // nieuwe echte fix springt 'ie terug op de waarheid. Gecapt op EST_CAP_S,
  // en een fix ouder dan FIX_STALE_S wordt niet meer geschat: dan staat de
  // pin weer op de laatste echte positie.
  function tickEstimate() {
    const now = Date.now();
    let moved = false;
    for (const k in people) if (placePerson(people[k], now) && people[k]._circle) moved = true;
    if (moved) { applyRadii(); drawCircles(); }
  }

  // ---- boot ------------------------------------------------------------
  // Draait bij het openen én na elk opnieuw inloggen. Wat maar één keer mag
  // bestaan (kaart, GPS-watch, kompas-listeners, intervallen) zit achter
  // `booted`; anders liepen er na een herlogin twee tik-timers, twee
  // versie-checks en een tweede GPS-watch naast elkaar.
  function start() {
    hideLogin();
    maybeRefreshToken();   // bestaande sessie → token (her)munten, geen extra login later
    if (!booted) {
      booted = true;
      initMap(); startGeo(); armCompass(); renderPlaceMarkers();
      setInterval(tickEstimate, 1000);
      checkVersion(); setInterval(() => { checkVersion(); maybeRefreshToken(); }, 300000);
      document.addEventListener("visibilitychange", () => { if (!document.hidden) checkVersion(); });
    }
    setFollow(true);
    refresh();
    scheduleRefresh();
  }

  // events
  // Merknaam toepassen (titel + login-kop) zodat hosts hun eigen naam kunnen zetten.
  document.title = BRAND; $("brand").textContent = BRAND;
  applyI18n(); applyTheme();
  $("login-form").addEventListener("submit", doLogin);
  $("fab-locate").addEventListener("click", () => {
    setFollow(true); centeredOnce = false;
    const anyPeople = devices.some((d) => isShown(d.name) && people[d.id] && people[d.id].pos);
    if (anyPeople) renderPeople();                                  // centreer op gevolgde personen
    else if (viewer) fitWidthKm(viewer.lat, viewer.lon, 1);         // niemand gevolgd → centreer op jezelf (~1 km)
  });
  $("fab-settings").addEventListener("click", toggleSheet);
  // Naast de pop-up tikken sluit hem; met Geavanceerd open ga je terug naar Instellingen.
  $("sheet-backdrop").addEventListener("click", () => { if (advOpen()) backToSheet(); else closeSheet(); });
  $("open-adv").addEventListener("click", openAdv);
  $("adv-back").addEventListener("click", backToSheet);
  $("confirm-backdrop").addEventListener("click", closeLogoutDlg);
  $("logout-cancel").addEventListener("click", closeLogoutDlg);
  $("logout-yes").addEventListener("click", doLogout);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("logout-dlg").classList.contains("hidden")) closeLogoutDlg();
    else if (advOpen()) backToSheet();
    else if (sheetOpen()) closeSheet();
  });
  $("seg-theme").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; theme = b.getAttribute("data-v"); store.set("theme", theme); applyTheme(); markSeg("seg-theme", theme); });
  $("seg-lang").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; langPref = b.getAttribute("data-v"); store.set("lang", langPref); applyI18n(); markSeg("seg-lang", langPref); renderNotifList(); renderCompass(); geoCache = {}; });
  $("compass-on").addEventListener("click", enableCompass);
  $("seg-map").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; mapStyle = b.getAttribute("data-v"); store.set("mapStyle", mapStyle); applyMapStyle(); markSeg("seg-map", mapStyle); });
  if (window.matchMedia) matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (theme === "system") applyTheme(); });
  $("logout").addEventListener("click", askLogout);

  (async function () {
    if (await checkSession()) start();
    else if (await reloginToken()) start();   // stil herinloggen, nooit onnodig login-scherm
    else showLogin();
  })();
})();
