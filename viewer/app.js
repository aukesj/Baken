"use strict";
(function () {
  const cfg = window.BAKEN_CONFIG || window.TRACE_CONFIG || {};
  const BRAND = cfg.brandName || "Baken";
  const REFRESH = cfg.refreshMs || 30000;
  const SPEED_MIN_KMH = 3;     // onder deze snelheid: geen snelheid/"onderweg", geen schatting
  const EST_CAP_S = 25;        // max seconden vooruit schatten tussen fixes
  let lastMaxKmh = 0;          // snelste zichtbare persoon → bepaalt refresh-tempo
  const ZOOM = cfg.zoom || 15;
  const SHOW_ADDR = cfg.showAddress !== false;
  const DEF_RADIUS = cfg.defaultRadius || 150;
  const t = (k, v) => window.I18N.t(k, v);

  const $ = (id) => document.getElementById(id);
  const api = (p, o) => fetch("api/" + p, Object.assign({ credentials: "same-origin" }, o));
  const PALETTE = ["#3f51b5", "#e91e63", "#2e7d32", "#f57c00", "#6a1b9a", "#0097a7", "#c62828", "#00867d"];

  // ---- voorkeuren ------------------------------------------------------
  const store = {
    get(k, d) { try { const v = localStorage.getItem("trace." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("trace." + k, JSON.stringify(v)); } catch (e) {} },
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
  let map, tiles, viewer = null, viewerMarker = null, devices = [], positions = [], me = null;
  const people = {};        // deviceId → {name, color, marker, prevFix, pos}
  const placeMarkers = {};  // placeId → marker
  let lastPlaceByPerson = {}; // name → placeId|null (voor aankomst/vertrek)
  let follow = true, timer = null, geoCache = {}, centeredOnce = false;

  // ---- helpers ---------------------------------------------------------
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
  const fmtDist = (m) => m == null ? "" : (m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(m < 10000 ? 1 : 0) + " km");
  function agoTxt(ms) {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return t("just_now"); const m = Math.round(s / 60);
    if (m < 60) return t("min_ago", { n: m }); const h = Math.round(m / 60);
    if (h < 24) return t("hr_ago", { n: h }); return t("day_ago", { n: Math.round(h / 24) });
  }
  const colorFor = (name) => { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
  const el = (html) => { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstChild; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

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
  function initMap() {
    if (map) return;
    map = L.map("map", { zoomControl: false, attributionControl: true }).setView([52.1, 5.1], 7);
    L.control.zoom({ position: "bottomleft" }).addTo(map);
    applyMapStyle();
    map.on("dragstart", () => setFollow(false));
    map.on("contextmenu", (e) => openNewPlace(e.latlng.lat, e.latlng.lng));
    // Kaart full-screen houden: Leaflet meet bij laden soms te vroeg, waardoor
    // er randstroken overblijven. Forceer herberekening bij laden + viewport-
    // wijzigingen (rotatie, toetsenbord, adresbalk in/uit).
    const fix = () => map.invalidateSize();
    const fixSoon = () => { fix(); [150, 350, 700].forEach((ms) => setTimeout(fix, ms)); };
    [120, 400, 1000].forEach((ms) => setTimeout(fix, ms));
    window.addEventListener("resize", fix);
    window.addEventListener("orientationchange", fixSoon);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) fixSoon(); });
    if (window.visualViewport) window.visualViewport.addEventListener("resize", fix);
    // Sterkste vangnet: zodra de kaart-container van grootte verandert, laat
    // Leaflet meteen opnieuw meten (lost de portrait-balk event-gedreven op).
    if (window.ResizeObserver) new ResizeObserver(fix).observe(document.getElementById("map"));
  }
  // iMap = OpenFreeMap vector-kaart (Apple-achtig, scherp), via maplibre-gl-leaflet.
  // Volgt het thema: licht → liberty, donker → dark.
  const IMAP_LIGHT = "https://tiles.openfreemap.org/styles/liberty";
  const IMAP_DARK = "https://tiles.openfreemap.org/styles/dark";
  function applyMapStyle() {
    if (tiles) { map.removeLayer(tiles); tiles = null; }
    document.body.classList.remove("mapstyle-dark");
    if (mapStyle === "imap" && L.maplibreGL) {
      tiles = L.maplibreGL({ style: isDark() ? IMAP_DARK : IMAP_LIGHT, attribution: "&copy; OpenFreeMap &copy; OpenMapTiles &copy; OSM" }).addTo(map);
      return;
    }
    const s = MAP_STYLES[mapStyle] || MAP_STYLES.standard;
    tiles = L.tileLayer(s.url, { maxZoom: s.maxZoom, subdomains: s.subdomains || "abc", attribution: s.attribution }).addTo(map);
    tiles.setZIndex(0);
  }
  // Centreer op een punt met een gekozen breedte (km) van rand tot rand.
  function fitWidthKm(lat, lon, km) {
    const dLon = (km / 2) / (111.32 * Math.cos(lat * Math.PI / 180));
    map.fitBounds([[lat, lon - dLon], [lat, lon + dLon]]);
  }
  // Find-My-achtig vaantje: ronde foto met pulserende gloed + pin-tail. Geen
  // foto (of laadt niet)? Dan valt de gekleurde initiaal eronder terug.
  function personIcon(name, color) {
    const file = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const letter = esc(name.charAt(0).toUpperCase());
    return L.divIcon({ className: "", iconSize: [54, 64], iconAnchor: [27, 56],
      html: `<div style="position:relative;width:54px;height:64px;">` +
        `<div class="ppulse" style="background:${color};"></div>` +
        `<div class="ppulse d" style="background:${color};"></div>` +
        // tail
        `<div style="position:absolute;left:50%;top:42px;transform:translateX(-50%);width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-top:13px solid #fff;filter:drop-shadow(0 2px 2px rgba(0,0,0,.3));"></div>` +
        // donkergrijs stipje op de punt = exacte locatie
        `<div style="position:absolute;left:50%;top:55px;transform:translate(-50%,-50%);width:9px;height:9px;border-radius:50%;background:#333;border:2px solid #fff;box-shadow:0 1px 2px rgba(0,0,0,.4);"></div>` +
        // bubble (foto bovenop, letter eronder als fallback)
        `<div style="position:absolute;left:50%;top:23px;transform:translate(-50%,-50%);width:46px;height:46px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);overflow:hidden;display:grid;place-items:center;color:#fff;font-weight:700;font-size:18px;">` +
        `<span>${letter}</span>` +
        `<img src="images/${file}.png" alt="" onerror="this.remove()" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;">` +
        `</div></div>` });
  }
  function placeEmoji(name) {
    const n = name.toLowerCase();
    if (/thuis|huis|home/.test(n)) return "🏠";
    if (/werk|kantoor|work|office/.test(n)) return "💼";
    return "📍";
  }
  function placeIcon(name) {
    return L.divIcon({ className: "", iconSize: [30, 30], iconAnchor: [15, 15],
      html: `<div style="width:30px;height:30px;border-radius:50%;background:#fff;display:grid;place-items:center;font-size:16px;border:2px solid rgba(0,0,0,.15);box-shadow:0 1px 4px rgba(0,0,0,.3);">${placeEmoji(name)}</div>` });
  }

  // ---- adres (server-side, per persoon gecachet) ----------------------
  async function addressOf(lat, lon) {
    if (!SHOW_ADDR) return "";
    const key = lat.toFixed(4) + "," + lon.toFixed(4);
    if (geoCache[key] !== undefined) return geoCache[key];
    try {
      const r = await fetch(`geocode?format=jsonv2&zoom=18&lat=${lat}&lon=${lon}`, { credentials: "same-origin" });
      const d = await r.json(); const a = d.address || {};
      const road = a.road || a.pedestrian || a.neighbourhood || "";
      const place = a.city || a.town || a.village || a.municipality || "";
      geoCache[key] = [road, place].filter(Boolean).join(", ") || d.display_name || "";
    } catch (e) { geoCache[key] = ""; }
    return geoCache[key];
  }

  // ---- plaatsen --------------------------------------------------------
  function placeContaining(lat, lon) {
    for (const p of places) if (haversine({ lat, lon }, { lat: p.lat, lon: p.lon }) <= p.radius) return p;
    return null;
  }
  function savePlaces() { store.set("places", places); renderPlaceMarkers(); }
  function renderPlaceMarkers() {
    for (const id in placeMarkers) { map.removeLayer(placeMarkers[id]); delete placeMarkers[id]; }
    places.forEach((p) => {
      const m = L.marker([p.lat, p.lon], { icon: placeIcon(p.name) }).addTo(map);
      m.on("click", () => openPlacePopup(p));
      placeMarkers[p.id] = m;
    });
  }

  // ---- meldingen -------------------------------------------------------
  function saveNotifs() { store.set("notifs", notifs); }
  function notice(text) {
    const el2 = $("toast"); el2.textContent = text; el2.classList.remove("hidden");
    clearTimeout(notice._t); notice._t = setTimeout(() => el2.classList.add("hidden"), 6000);
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
      <div class="pop-row"><input class="pop-name" placeholder="${t("name_ph")}" value="${within ? esc(within.name) : ""}">
        <button class="pop-btn save">${t("save")}</button></div>
      ${within ? `<button class="pop-btn link mk-notif">🔔 ${t("notify")}…</button><div class="notif-form hidden"></div>` : ""}
    </div>`);
    node.querySelector(".save").onclick = () => {
      const nm = node.querySelector(".pop-name").value.trim(); if (!nm) return;
      if (within) { within.name = nm; } else { places.push({ id: Date.now(), name: nm, lat: p.lat, lon: p.lon, radius: DEF_RADIUS }); }
      savePlaces(); map.closePopup();
    };
    const mk = node.querySelector(".mk-notif");
    if (mk) mk.onclick = () => buildNotifForm(node.querySelector(".notif-form"), person.name, within);
    L.popup({ offset: [0, -16] }).setLatLng([p.lat, p.lon]).setContent(node).openOn(map);
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
    node.querySelector(".save").onclick = () => { const nm = node.querySelector(".pop-name").value.trim(); if (!nm) return; place.name = nm; savePlaces(); map.closePopup(); };
    node.querySelector(".del").onclick = () => { places = places.filter((x) => x.id !== place.id); savePlaces(); map.closePopup(); };
    node.querySelector(".mk-notif").onclick = () => buildNotifForm(node.querySelector(".notif-form"), null, place);
    L.popup({ offset: [0, -14] }).setLatLng([place.lat, place.lon]).setContent(node).openOn(map);
  }

  async function openNewPlace(lat, lon) {
    setFollow(false);
    const addr = await addressOf(lat, lon);
    const node = el(`<div class="pop">
      <div class="pop-h"><span class="pop-emoji">📍</span><b>${t("new_place")}</b></div>
      <div class="pop-sub">${esc(addr || "")}</div>
      <div class="pop-row"><input class="pop-name" placeholder="${t("name_ph")}"><button class="pop-btn save">${t("save")}</button></div>
    </div>`);
    node.querySelector(".save").onclick = () => { const nm = node.querySelector(".pop-name").value.trim(); if (!nm) return; places.push({ id: Date.now(), name: nm, lat, lon, radius: DEF_RADIUS }); savePlaces(); map.closePopup(); };
    L.popup({ offset: [0, -10] }).setLatLng([lat, lon]).setContent(node).openOn(map);
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
      const ev = host.querySelector('input[name="nf-ev"]:checked').value;
      const once = host.querySelector(".nf-once-cb").checked;
      if ("Notification" in window && Notification.permission === "default") { try { await Notification.requestPermission(); } catch (e) {} }
      notifs.push({ id: Date.now(), person: who, placeId: place.id, event: ev, once });
      saveNotifs(); renderNotifList(); map.closePopup();
    };
  }

  // ---- personen renderen ----------------------------------------------
  function visibleNames() { return devices.filter((d) => shown == null || shown.includes(d.name)).map((d) => d.name); }
  function isShown(name) { return shown == null || shown.includes(name); }

  function renderPeople() {
    const vis = devices.filter((d) => isShown(d.name));
    // verwijder niet meer getoonde
    for (const id in people) if (!vis.find((d) => d.id == id)) { map.removeLayer(people[id].marker); if (people[id].circle) map.removeLayer(people[id].circle); delete people[id]; }

    let single = vis.length === 1 ? null : false;
    vis.forEach((d) => {
      const pos = positions.find((x) => x.deviceId === d.id);
      let person = people[d.id];
      if (!person) person = people[d.id] = { name: d.name, color: colorFor(d.name), marker: null, prevFix: null, pos: null };
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

      const ll = [cur.lat, cur.lon];
      if (!person.marker) { person.marker = L.marker(ll, { icon: personIcon(d.name, person.color), zIndexOffset: 1000 }).addTo(map); person.marker.on("click", () => openPersonPopup(person)); }
      else { person.marker.setLatLng(ll); }   // alleen positie; icoon niet herbouwen (puls/foto blijven stabiel)
      // Nauwkeurigheidscirkel (alleen als Traccar een echte accuracy meelevert).
      const accM = pos.accuracy;
      if (accM != null && accM > 0 && accM < 3000) {
        if (!person.circle) person.circle = L.circle(ll, { radius: accM, color: person.color, weight: 1, opacity: 0.35, fillColor: person.color, fillOpacity: 0.10, interactive: false }).addTo(map);
        else { person.circle.setLatLng(ll); person.circle.setRadius(accM); }
      } else if (person.circle) { map.removeLayer(person.circle); person.circle = null; }
      person._moving = moving; person._kmh = kmh; person._status = d.status;
      person._batt = (typeof at.batteryLevel === "number") ? at.batteryLevel : null;
      // Velden voor de tussenpositie-schatting. Bewaar de échte fix apart van
      // wat we straks (geschat) op de kaart tekenen, en stempel op WANNEER we
      // 'm ontvingen (i.p.v. device-tijd → geen klok-skew).
      person._course = course;
      person._accM = (accM != null && accM > 0 && accM < 3000) ? accM : null;
      if (person._lastFixT !== cur.t) { person._lastFixT = cur.t; person._recvT = Date.now(); person._fixLL = ll; }

      checkTransitions(d.name, cur.lat, cur.lon);
      if (vis.length === 1) single = { d, person, moving, kmh };
    });

    lastMaxKmh = Object.keys(people).reduce((m, k) => Math.max(m, people[k]._kmh || 0), 0);

    // volgen / centreren
    const pts = vis.map((d) => people[d.id] && people[d.id].pos).filter(Boolean).map((p) => [p.lat, p.lon]);
    if (pts.length) {
      if (!centeredOnce) {
        if (pts.length === 1) fitWidthKm(pts[0][0], pts[0][1], 1);   // ~1 km breed bij openen
        else map.fitBounds(pts, { padding: [60, 60], maxZoom: 16 });
        centeredOnce = true;
      } else if (follow) {
        if (pts.length === 1) map.panTo(pts[0]);                     // volgen, zoom behouden
        else map.fitBounds(pts, { padding: [60, 60], maxZoom: 16 });
      }
    }

    renderTopcard(single);
  }

  async function renderTopcard(single) {
    if (!single) { $("topcard").classList.add("hidden"); return; }
    const { d, person, moving, kmh } = single;
    $("topcard").classList.remove("hidden");
    $("status-dot").className = "dot" + (d.status === "online" ? " online" : "");
    $("t-name").textContent = d.name;
    $("t-move").textContent = moving ? ("🚗 " + t("moving") + (kmh ? ` · ${kmh} km/u` : "")) : "";
    const bt = person._batt, be = $("t-batt");
    if (be) { if (bt != null) { be.textContent = `${bt <= 20 ? "🪫" : "🔋"} ${Math.round(bt)}%`; be.style.color = bt <= 20 ? "#ff453a" : ""; } else be.textContent = ""; }
    if (person.pos && viewer) {
      const dist = fmtDist(haversine(viewer, person.pos));
      const ang = bearing(viewer, person.pos);
      $("t-dist").innerHTML = `<span class="arrow" style="transform:rotate(${ang}deg)">↑</span> ${dist}`;
    } else if (person.pos) $("t-dist").textContent = "";
    $("t-seen").textContent = person.pos ? `🕓 ${t("last_seen")} · ${agoTxt(person.pos.t)}` : t("no_pos");
    $("t-addr").textContent = person.pos ? (await addressOf(person.pos.lat, person.pos.lon)) : "";
  }

  // ---- data ------------------------------------------------------------
  async function refresh() {
    try {
      let dr = await api("devices");
      if (dr.status === 401 || dr.status === 404) {
        // sessie weg → stil opnieuw inloggen met token, daarna opnieuw proberen
        if (await reloginToken()) dr = await api("devices");
        if (dr.status === 401 || dr.status === 404) { showLogin(); return; }
      }
      const all = await dr.json();
      // Sluit het eigen toestel uit — je volgt jezelf niet.
      devices = all.filter((d) => !me || String(d.name).toLowerCase() !== String(me).toLowerCase());
      const pr = await api("positions");
      positions = pr.ok ? await pr.json() : [];
      renderPeople();
    } catch (e) {}
  }

  // ---- kijker-geolocatie ----------------------------------------------
  // Eigen positie: blauwe stip + (bij kompas) een zachte richtings-flare.
  // Puur lokaal getekend; deze positie wordt NOOIT naar de server gestuurd.
  function beamSvg(h) {
    return `<svg class="vbeam" width="90" height="90" viewBox="0 0 90 90" ` +
      `style="position:absolute;left:50%;top:50%;transform-origin:50% 50%;transform:translate(-50%,-50%) rotate(${h}deg);pointer-events:none;overflow:visible;">` +
      `<defs><radialGradient id="vbg" cx="0.5" cy="0.5" r="0.5">` +
      `<stop offset="0" stop-color="#0a84ff" stop-opacity="0.45"/>` +
      `<stop offset="1" stop-color="#0a84ff" stop-opacity="0"/></radialGradient></defs>` +
      `<path d="M45 45 L21 11 A41 41 0 0 1 69 11 Z" fill="url(#vbg)"/></svg>`;
  }
  function viewerIcon(heading) {
    const beam = (heading != null) ? beamSvg(heading) : "";
    return L.divIcon({ className: "", iconSize: [90, 90], iconAnchor: [45, 45],
      html: `<div style="position:relative;width:90px;height:90px;">${beam}` +
        `<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:16px;height:16px;border-radius:50%;background:#0a84ff;border:2.5px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.2),0 1px 3px rgba(0,0,0,.4);"></div></div>` });
  }
  // Blauwe stip + richtings-flare (kompas) + nauwkeurigheidscirkel (Apple-stijl).
  let heading = null, viewerHasBeam = false, viewerCircle = null, lastDrawn = null;
  function rotateBeam(h) {
    if (h == null || !viewerMarker) return;
    const el = viewerMarker.getElement();
    const b = el && el.querySelector(".vbeam");
    if (b) b.style.transform = `translate(-50%,-50%) rotate(${h}deg)`;
  }
  function renderViewer(acc) {
    if (!map || !viewer) return;
    const ll = [viewer.lat, viewer.lon];
    const wantBeam = heading != null;
    if (!viewerMarker) {
      viewerMarker = L.marker(ll, { icon: viewerIcon(heading), zIndexOffset: 400, interactive: false, keyboard: false }).addTo(map);
      viewerHasBeam = wantBeam;
    } else {
      viewerMarker.setLatLng(ll);
      if (wantBeam !== viewerHasBeam) { viewerMarker.setIcon(viewerIcon(heading)); viewerHasBeam = wantBeam; }
      else if (wantBeam) rotateBeam(heading);
    }
    if (acc != null && acc > 0) {
      if (!viewerCircle) viewerCircle = L.circle(ll, { radius: acc, color: "#0a84ff", weight: 1, opacity: 0.4, fillColor: "#0a84ff", fillOpacity: 0.12, interactive: false }).addTo(map);
      else { viewerCircle.setLatLng(ll); viewerCircle.setRadius(acc); }
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
        if (lastDrawn && viewerMarker && haversine(lastDrawn, np) < 5) { if (viewerCircle && acc != null) viewerCircle.setRadius(acc); return; }
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

  // Kompas: stuurt de flare, ook bij stilstand. iOS vraagt toestemming bij een
  // gebruikersgebaar (en opnieuw na een harde herstart — dat is iOS-gedrag).
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
    heading = h; lastCompassTs = Date.now();
    const now = Date.now();
    if (now - lastBeam > 80) { lastBeam = now; if (viewerMarker && viewerHasBeam) rotateBeam(h); else renderViewer(); }
  }
  function startCompass() {
    window.addEventListener("deviceorientationabsolute", onOrient, true);
    window.addEventListener("deviceorientation", onOrient, true);
  }
  function enableCompass() {
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function") {
      DeviceOrientationEvent.requestPermission().then((s) => { if (s === "granted") startCompass(); }).catch(() => {});
    } else startCompass();
  }
  function armCompass() {
    document.addEventListener("visibilitychange", () => { if (!document.hidden) startCompass(); });
    const once = () => { enableCompass(); document.removeEventListener("click", once); document.removeEventListener("touchend", once); };
    document.addEventListener("click", once, { once: true });
    document.addEventListener("touchend", once, { once: true });
  }

  // ---- follow ----------------------------------------------------------
  function setFollow(on) { follow = on; $("fab-locate").classList.toggle("active", on); }

  // ---- instellingen ----------------------------------------------------
  async function openSheet() {
    renderWho(); renderNotifList(); markSeg("seg-theme", theme); markSeg("seg-lang", langPref); markSeg("seg-map", mapStyle);
    if (appVersion == null) await checkVersion();
    $("ver").textContent = appVersion ? "v" + appVersion : "";
    $("sheet").classList.remove("hidden"); $("sheet-backdrop").classList.remove("hidden");
  }
  function closeSheet() { $("sheet").classList.add("hidden"); $("sheet-backdrop").classList.add("hidden"); }
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
  async function checkSession() { try { const r = await api("session"); if (!r.ok) return false; const u = await r.json().catch(() => null); me = u && u.name ? u.name : null; return true; } catch (e) { return false; } }

  // Langlevend token aanmaken zodat we altijd stil opnieuw kunnen inloggen.
  async function makeToken() {
    try {
      const b = new URLSearchParams(); b.set("expiration", "2099-12-31T23:59:59Z");
      const r = await api("session/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: b.toString() });
      if (r.ok) { let tok = (await r.text()).trim(); if (tok.startsWith('"') && tok.endsWith('"')) tok = tok.slice(1, -1); if (tok) store.set("token", tok); }
    } catch (e) {}
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

  async function doLogin(ev) {
    ev.preventDefault(); $("login-err").textContent = "";
    const b = new URLSearchParams(); b.set("email", $("u").value.trim()); b.set("password", $("p").value);
    try {
      const r = await api("session", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: b.toString() });
      if (r.ok) { const u = await r.json().catch(() => null); me = u && u.name ? u.name : null; await makeToken(); hideLogin(); $("p").value = ""; start(); }
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
  function scheduleRefresh() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => { await refresh(); scheduleRefresh(); }, refreshDelay());
  }

  // Tussenpositie-schatting ('live' gevoel): tussen twee echte fixes schuift
  // de marker langs de laatste koers met de laatste snelheid vooruit. De
  // onzekerheidscirkel groeit mee zodat de schatting eerlijk blijft; bij een
  // nieuwe echte fix springt 'ie terug op de waarheid. Gecapt op EST_CAP_S.
  function tickEstimate() {
    const now = Date.now();
    for (const k in people) {
      const p = people[k];
      if (!p.marker || !p._fixLL || p._kmh == null || p._kmh < SPEED_MIN_KMH || p._course == null) continue;
      const el = Math.min((now - (p._recvT || now)) / 1000, EST_CAP_S);
      if (el <= 0.5) continue;
      const ms = p._kmh / 3.6;                                  // km/u → m/s
      const est = projectLL(p._fixLL[0], p._fixLL[1], p._course, ms * el);
      p.marker.setLatLng(est);
      if (p.circle) { p.circle.setLatLng(est); p.circle.setRadius((p._accM || 15) + ms * el * 0.7); }
    }
  }

  // ---- boot ------------------------------------------------------------
  function start() {
    // Merknaam toepassen (titel + login-kop) zodat hosts hun eigen naam kunnen zetten.
    try { document.title = BRAND; const be = $("brand"); if (be) be.textContent = BRAND; } catch (e) {}
    if (!store.get("token", null)) makeToken();   // bestaande sessie → meteen token, geen extra login later
    initMap(); startGeo(); armCompass(); setFollow(true); renderPlaceMarkers(); refresh();
    scheduleRefresh();
    setInterval(tickEstimate, 1000);
    checkVersion(); setInterval(checkVersion, 300000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) checkVersion(); });
    if ("Notification" in window && Notification.permission === "default" && notifs.length) { /* vraag pas bij eerste melding-aanmaak */ }
  }

  // events
  applyI18n(); applyTheme();
  $("login-form").addEventListener("submit", doLogin);
  $("fab-locate").addEventListener("click", () => {
    setFollow(true); centeredOnce = false;
    const anyPeople = devices.some((d) => isShown(d.name) && people[d.id] && people[d.id].pos);
    if (anyPeople) renderPeople();                                  // centreer op gevolgde personen
    else if (viewer) fitWidthKm(viewer.lat, viewer.lon, 1);         // niemand gevolgd → centreer op jezelf (~1 km)
  });
  $("fab-settings").addEventListener("click", openSheet);
  $("sheet-backdrop").addEventListener("click", closeSheet);
  // Klik ergens in het paneel sluit het ook — behalve op een bedieningselement.
  $("sheet").addEventListener("click", (e) => { if (!e.target.closest("button, input, select, label, .seg, .checks, .notiflist")) closeSheet(); });
  $("seg-theme").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; theme = b.getAttribute("data-v"); store.set("theme", theme); applyTheme(); markSeg("seg-theme", theme); });
  $("seg-lang").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; langPref = b.getAttribute("data-v"); store.set("lang", langPref); applyI18n(); markSeg("seg-lang", langPref); renderNotifList(); });
  $("seg-map").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; mapStyle = b.getAttribute("data-v"); store.set("mapStyle", mapStyle); applyMapStyle(); markSeg("seg-map", mapStyle); });
  if (window.matchMedia) matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (theme === "system") applyTheme(); });

  (async function () {
    if (await checkSession()) start();
    else if (await reloginToken()) start();   // stil herinloggen, nooit onnodig login-scherm
    else showLogin();
  })();
})();
