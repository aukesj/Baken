"use strict";
// Unit tests voor de pure functies in viewer/helpers.js (overgenomen uit Trace).
// Run with: node --test tests/unit/
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../../viewer/helpers.js");

// Reference points (Leiden CS <-> Den Haag CS, ~14.5 km as the crow flies).
const LEIDEN = { lat: 52.166, lon: 4.482 };
const DENHAAG = { lat: 52.080, lon: 4.325 };

test("haversine — the same point is 0", () => {
  assert.equal(H.haversine(LEIDEN, LEIDEN), 0);
});

test("haversine — 1 degree of latitude ≈ 111.2 km", () => {
  const d = H.haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
  assert.ok(Math.abs(d - 111195) < 50, `got ${d}`);
});

test("haversine — Leiden ↔ Den Haag ≈ 14.5 km", () => {
  const d = H.haversine(LEIDEN, DENHAAG);
  assert.ok(d > 14000 && d < 15500, `got ${d}`);
});

test("haversine — symmetrical", () => {
  assert.ok(Math.abs(H.haversine(LEIDEN, DENHAAG) - H.haversine(DENHAAG, LEIDEN)) < 1e-6);
});

test("bearing — due north = 0°", () => {
  const b = H.bearing({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
  assert.ok(Math.abs(b - 0) < 0.01 || Math.abs(b - 360) < 0.01, `got ${b}`);
});

test("bearing — due east ≈ 90°", () => {
  const b = H.bearing({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
  assert.ok(Math.abs(b - 90) < 0.01, `got ${b}`);
});

test("bearing — due south ≈ 180°", () => {
  const b = H.bearing({ lat: 1, lon: 0 }, { lat: 0, lon: 0 });
  assert.ok(Math.abs(b - 180) < 0.01, `got ${b}`);
});

test("bearing — due west ≈ 270°", () => {
  const b = H.bearing({ lat: 0, lon: 0 }, { lat: 0, lon: -1 });
  assert.ok(Math.abs(b - 270) < 0.01, `got ${b}`);
});

test("projectLL — 0 metres leaves the point where it is", () => {
  const [lat, lon] = H.projectLL(52.166, 4.482, 90, 0);
  assert.ok(Math.abs(lat - 52.166) < 1e-9);
  assert.ok(Math.abs(lon - 4.482) < 1e-9);
});

test("projectLL — 1000 m north raises the latitude by ~0.009°", () => {
  const [lat, lon] = H.projectLL(52.0, 5.0, 0, 1000);
  assert.ok(lat > 52.0, `lat ${lat}`);
  assert.ok(Math.abs(lat - 52.008993) < 1e-4, `lat ${lat}`);
  assert.ok(Math.abs(lon - 5.0) < 1e-6, `lon ${lon}`);
});

test("projectLL — project 500 m and the way back measures 500 m", () => {
  const [lat, lon] = H.projectLL(52.0, 5.0, 90, 500);
  const d = H.haversine({ lat: 52.0, lon: 5.0 }, { lat, lon });
  assert.ok(Math.abs(d - 500) < 1, `distance ${d}`);
});

test("circleRing — closed ring, [lon, lat], n+1 points", () => {
  const ring = H.circleRing(52.0, 5.0, 100, 8);
  assert.equal(ring.length, 9);
  assert.deepEqual(ring[0], ring[8]);          // first = last, so closed
  assert.ok(Math.abs(ring[0][0] - 5.0) < 1e-9); // [0] is the longitude
});

test("circleRing — every point lies on the radius", () => {
  for (const r of [15, 150, 2500]) {
    for (const p of H.circleRing(52.166, 4.482, r, 32)) {
      const d = H.haversine({ lat: 52.166, lon: 4.482 }, { lat: p[1], lon: p[0] });
      assert.ok(Math.abs(d - r) < 0.01, `radius ${r} → ${d}`);
    }
  }
});

test("circleRing — the first point lies due north", () => {
  const ring = H.circleRing(52.0, 5.0, 1000, 4);
  assert.ok(ring[0][1] > 52.0, "north");
  assert.ok(Math.abs(ring[0][0] - 5.0) < 1e-6, "the same longitude");
  assert.ok(ring[2][1] < 52.0, "the opposite side lies south");
});

test("circleRing — 64 corners without passing one", () => {
  assert.equal(H.circleRing(52.0, 5.0, 50).length, 65);
});

// The threshold of the accuracy circle, in metres. On a good fix
// there is only the pin; the circle comes when the measurement itself is
// uncertain, and that judgement does not hang on the zoom.
test("circleShows — a good fix gives no circle", () => {
  // Typical phone fixes: median around 9 m, p90 around 17 m.
  assert.equal(H.circleShows(5, 20), false);
  assert.equal(H.circleShows(9, 20), false);
  assert.equal(H.circleShows(17, 20), false);
});

test("circleShows — an uncertain fix does give a circle", () => {
  assert.equal(H.circleShows(20, 20), true);         // exactly on the bound
  assert.equal(H.circleShows(73, 20), true);
  assert.equal(H.circleShows(541, 20), true);
});

test("circleShows — the zoom does not matter, only the measurement", () => {
  // There is no scale in play any more: the same fix gives the same answer,
  // however deep you zoom in. That is the whole point of a bound in metres.
  assert.equal(H.circleShows(9, 20), false);
  assert.equal(H.circleShows(21, 20), true);
});

test("circleShows — without a usable bound or measurement", () => {
  assert.equal(H.circleShows(9, 0), true);           // no bound: simply show
  assert.equal(H.circleShows(0, 20), false);         // no measurement, no circle
  assert.equal(H.circleShows(null, 20), false);
});

// The noise damping: a fix wobbles a few metres and that is not news.
test("accChanged — a small wobble does not count, a real jump does", () => {
  assert.equal(H.accChanged(10, 11, 0.2), false);    // 10%
  assert.equal(H.accChanged(10, 12, 0.2), true);     // 20%, exactly the bound
  assert.equal(H.accChanged(10, 30, 0.2), true);
  assert.equal(H.accChanged(10, 8.5, 0.2), false);   // downwards is noise too
  assert.equal(H.accChanged(10, 7, 0.2), true);
});

test("accChanged — relative, so a metre does not weigh the same everywhere", () => {
  assert.equal(H.accChanged(5, 6, 0.2), true);       // 1 m on 5 m is news
  assert.equal(H.accChanged(200, 201, 0.2), false);  // 1 m on 200 m is not
});

test("accChanged — from nothing to something, and from something to nothing", () => {
  assert.equal(H.accChanged(null, 12, 0.2), true);
  assert.equal(H.accChanged(0, 12, 0.2), true);
  assert.equal(H.accChanged(12, null, 0.2), true);
});

test("fmtDist — null → empty string", () => {
  assert.equal(H.fmtDist(null), "");
});

test("fmtDist — metres below 1000 rounded", () => {
  assert.equal(H.fmtDist(0), "0 m");
  assert.equal(H.fmtDist(150.4), "150 m");
  assert.equal(H.fmtDist(999), "999 m");
});

test("fmtDist — km with 1 decimal below 10 km", () => {
  assert.equal(H.fmtDist(1500), "1.5 km");
  assert.equal(H.fmtDist(9990), "10.0 km");
});

test("fmtDist — km without decimals from 10 km (rounded)", () => {
  assert.equal(H.fmtDist(14500), "15 km"); // 14.5 → toFixed(0) → 15
  assert.equal(H.fmtDist(14400), "14 km");
});

// Minimal translator that echoes the i18n keys deterministically.
const t = (k, v) => (v && v.n != null) ? `${k}:${v.n}` : k;

test("agoTxt — just now", () => {
  assert.equal(H.agoTxt(1000, t, 1000), "just_now");
  assert.equal(H.agoTxt(1000, t, 1000 + 59 * 1000), "just_now");
});

test("agoTxt — minutes", () => {
  assert.equal(H.agoTxt(0, t, 5 * 60 * 1000), "min_ago:5");
});

test("agoTxt — hours", () => {
  assert.equal(H.agoTxt(0, t, 3 * 60 * 60 * 1000), "hr_ago:3");
});

test("agoTxt — days", () => {
  assert.equal(H.agoTxt(0, t, 2 * 24 * 60 * 60 * 1000), "day_ago:2");
});

test("agoTxt — now defaults to Date.now()", () => {
  assert.equal(H.agoTxt(Date.now(), t), "just_now");
});

test("esc — escapes HTML metacharacters", () => {
  assert.equal(H.esc('<script>alert("x")</' + "script>"), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  assert.equal(H.esc("a & b"), "a &amp; b");
});

test("esc — plain text stays unchanged", () => {
  assert.equal(H.esc("Anna"), "Anna");
});

test("esc — coerces non-strings", () => {
  assert.equal(H.esc(42), "42");
});

test("colorFor — deterministic (same name → same colour)", () => {
  assert.equal(H.colorFor("Anna"), H.colorFor("Anna"));
});

test("colorFor — always returns a palette colour", () => {
  for (const name of ["Anna", "Bram", "Chris", "x", "a really long name"]) {
    assert.ok(H.PALETTE.includes(H.colorFor(name)), `${name} → ${H.colorFor(name)}`);
  }
});

test("fmtDist — exactly 1000 m goes down the km path (1.0 km)", () => {
  assert.equal(H.fmtDist(1000), "1.0 km");
});

test("fmtDist — exactly 10000 m: no decimals (10 km)", () => {
  // < 10000 → 1 decimal; >= 10000 → 0 decimals
  assert.equal(H.fmtDist(9999), "10.0 km");   // toFixed(1) on 9.999 → "10.0"
  assert.equal(H.fmtDist(10000), "10 km");     // toFixed(0) on 10 → "10"
});

test("agoTxt — the 60 s bound: s<60 is 'just_now', s=60 goes to minutes", () => {
  // Math.round(59000/1000) = 59 → just_now
  assert.equal(H.agoTxt(0, t, 59000), "just_now");
  // Math.round(60000/1000) = 60, not < 60 → min_ago:1
  assert.equal(H.agoTxt(0, t, 60000), "min_ago:1");
});

test("esc — a single quote is escaped too (safe in both attribute styles)", () => {
  assert.equal(H.esc("it's"), "it&#39;s");
});

test("photoFile — lower case, no spaces or punctuation", () => {
  assert.equal(H.photoFile("Anne-Marie"), "annemarie");
  assert.equal(H.photoFile("Bram de Vries"), "bramdevries");
  assert.equal(H.photoFile("../etc"), "etc");
});

// ---- the estimate between two fixes --------------------------------------
// Baken bug: the pin kept being estimated ahead when the last fix was old.
const CAP = 25, STALE = 120;

test("estimateSeconds — right after a fresh fix: nothing to estimate yet", () => {
  const now = 1_000_000;
  assert.equal(H.estimateSeconds(now, now, now - 2000, CAP, STALE), 0);
});

test("estimateSeconds — a fresh fix is estimated ahead, capped", () => {
  const recv = 1_000_000, fix = recv - 3000;
  assert.equal(H.estimateSeconds(recv + 10_000, recv, fix, CAP, STALE), 10);
  assert.equal(H.estimateSeconds(recv + 60_000, recv, fix, CAP, STALE), CAP);
});

test("estimateSeconds — an old fix is never estimated, even when just received", () => {
  // The app opens and the last fix is from an hour ago, with a speed in it.
  const now = 10_000_000;
  assert.equal(H.estimateSeconds(now + 5000, now, now - 3600_000, CAP, STALE), 0);
});

test("estimateSeconds — once the fix grows stale the pin goes back to the fix", () => {
  const recv = 5_000_000, fix = recv - 1000;
  assert.ok(H.estimateSeconds(recv + 60_000, recv, fix, CAP, STALE) > 0);
  assert.equal(H.estimateSeconds(fix + (STALE + 1) * 1000, recv, fix, CAP, STALE), 0);
});

test("estimateSeconds — missing timestamps mean no estimate", () => {
  assert.equal(H.estimateSeconds(1000, 0, 500, CAP, STALE), 0);
  assert.equal(H.estimateSeconds(1000, 500, undefined, CAP, STALE), 0);
});
