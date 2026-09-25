// Gedrag over tijd: opnieuw inloggen, de tussenschatting en het adres.
"use strict";
const { test, expect } = require("@playwright/test");
const { server, PORT } = require("./csp-static-server.js");
const { mockApi, login, waitForPin } = require("./mock-api.js");

const BASE_URL = `http://127.0.0.1:${PORT}`;
test.beforeAll(() => new Promise((resolve) => server.listen(PORT, resolve)));
test.afterAll(() => new Promise((resolve) => server.close(resolve)));

// Snel verversen, zodat de test niet 30 s hoeft te wachten.
async function fastConfig(page, extra) {
  const cfg = Object.assign({ refreshMs: 1000 }, extra || {});
  await page.route("**/config.js", (route) => route.fulfill({
    contentType: "application/javascript", body: `window.BAKEN_CONFIG = ${JSON.stringify(cfg)};`,
  }));
}

// Waar staat de punt van de pin, en waar hoort de fix op het scherm?
async function pinVsFix(page, lat, lon) {
  return page.evaluate(([lat, lon]) => {
    const m = document.querySelector("#map .maplibregl-marker[style*='cursor: pointer']") || document.querySelector("#map .maplibregl-marker");
    const r = m.getBoundingClientRect();
    const c = document.getElementById("map").getBoundingClientRect();
    const p = window.BAKEN_MAP.project([lon, lat]);
    const tip = { x: r.left + 27, y: r.top + 55 };
    return Math.hypot(tip.x - (c.left + p.x), tip.y - (c.top + p.y));
  }, [lat, lon]);
}

test("logging in again does not double the timers or the GPS watch", async ({ page }) => {
  await page.addInitScript(() => {
    window.__iv = {};
    const si = window.setInterval;
    window.setInterval = function (fn, ms) { window.__iv[ms] = (window.__iv[ms] || 0) + 1; return si.apply(this, arguments); };
    window.__watch = 0;
    if (navigator.geolocation) {
      const wp = navigator.geolocation.watchPosition.bind(navigator.geolocation);
      navigator.geolocation.watchPosition = function () { window.__watch++; return wp.apply(null, arguments); };
    }
  });
  await fastConfig(page);
  const state = await mockApi(page, { tokenWorks: false });
  await login(page, BASE_URL);
  await waitForPin(page);

  // De sessie verloopt en het token werkt niet meer: het login-scherm komt.
  state.loggedIn = false;
  await expect(page.locator("#login")).toBeVisible({ timeout: 5000 });
  // Zolang het login-scherm open staat, wordt er niet meer gepold.
  const before = state.calls.devices;
  await page.waitForTimeout(3000);
  expect(state.calls.devices - before).toBeLessThanOrEqual(1);

  // Opnieuw inloggen in dezelfde pagina (geen reload), zoals een gebruiker doet.
  await page.fill("#u", "bram");
  await page.fill("#p", "e2e-password");
  await page.click('#login-form button[type="submit"]');
  await expect(page.locator("#login")).toBeHidden();
  await page.waitForTimeout(2500);
  const counts = await page.evaluate(() => ({ iv: window.__iv, watch: window.__watch }));
  expect(counts.iv["1000"]).toBe(1);      // tickEstimate
  expect(counts.iv["300000"]).toBe(1);    // versie-check + token
  expect(counts.watch).toBeLessThanOrEqual(1);
  // En het verversen loopt weer, precies één lus: ~1 per seconde.
  const a = state.calls.devices;
  await page.waitForTimeout(3000);
  const polled = state.calls.devices - a;
  expect(polled).toBeGreaterThanOrEqual(2);
  expect(polled).toBeLessThanOrEqual(4);
});

const LAT = 52.1601, LON = 4.4970;
const moving = (ageS) => () => [{
  id: 1, deviceId: 42, latitude: LAT, longitude: LON, speed: 27, course: 90, accuracy: 8,
  fixTime: new Date(Date.now() - ageS * 1000).toISOString(), attributes: {},
}];

test("an old fix is not estimated ahead: the pin stays on it", async ({ page }) => {
  await fastConfig(page);
  const fixT = Date.now() - 3600 * 1000;
  await mockApi(page, { positions: () => [Object.assign(moving(0)()[0], { fixTime: new Date(fixT).toISOString() })] });
  await login(page, BASE_URL);
  await waitForPin(page);
  await page.waitForTimeout(4000);
  expect(await pinVsFix(page, LAT, LON)).toBeLessThan(3);
});

test("a fresh fix is estimated ahead, and snaps back once it goes stale", async ({ page }) => {
  test.setTimeout(60000);
  await fastConfig(page);
  // Een fix van 108 s oud die niet meer verandert: nog 12 s vers, daarna oud.
  const fixT = Date.now() - 108 * 1000;
  await mockApi(page, { positions: () => [Object.assign(moving(0)()[0], { fixTime: new Date(fixT).toISOString() })] });
  await login(page, BASE_URL);
  await waitForPin(page);
  await page.waitForTimeout(4000);
  expect(await pinVsFix(page, LAT, LON)).toBeGreaterThan(20);   // vooruit geschat
  await page.waitForTimeout(12000);
  expect(await pinVsFix(page, LAT, LON)).toBeLessThan(3);       // terug op de fix
});

test("a speed derived from two fixes survives a refresh of the same fix", async ({ page }) => {
  test.setTimeout(60000);
  await fastConfig(page);
  // Een zender zonder snelheid en koers, zoals Traccar ze opslaat: 0 en 0. Het
  // eerste antwoord ligt 110 m zuidelijker, daarna steeds dezelfde fix, 10 s
  // later. Daaruit volgt ~40 km/u noordwaarts. Vroeger liet de volgende refresh
  // van diezelfde fix dat weer vallen: de pin sprong terug op de fix.
  const t0 = Date.now();
  const fix = (lat, ageMs) => [{ id: 1, deviceId: 42, latitude: lat, longitude: LON,
    speed: 0, course: 0, fixTime: new Date(t0 - ageMs).toISOString(), attributes: {} }];
  let calls = 0;
  await mockApi(page, { positions: () => (calls++ === 0 ? fix(LAT - 0.001, 12000) : fix(LAT, 2000)) });
  await login(page, BASE_URL);
  await waitForPin(page);
  // Wacht tot de tweede fix binnen is en de pin ervan weg begint te schuiven.
  await expect.poll(() => calls, { timeout: 10000 }).toBeGreaterThan(1);
  await expect.poll(() => pinVsFix(page, LAT, LON), { timeout: 10000 }).toBeGreaterThan(3);
  const callsBefore = calls;
  let prev = await pinVsFix(page, LAT, LON), worst = 0;
  const first = prev;
  for (let i = 0; i < 28; i++) {
    await page.waitForTimeout(250);
    const cur = await pinVsFix(page, LAT, LON);
    worst = Math.max(worst, prev - cur);   // positief = terug naar de fix
    prev = cur;
  }
  expect(calls - callsBefore, "refreshes van dezelfde fix tijdens het meten").toBeGreaterThan(0);
  expect(worst, "grootste stap terug, in pixels").toBeLessThan(2);
  expect(prev - first, "pixels verder van de fix").toBeGreaterThan(5);
});

test("without a geocoder behind the proxy the viewer stops asking", async ({ page }) => {
  await fastConfig(page);
  const state = await mockApi(page, { geocode: 404 });
  await login(page, BASE_URL);
  await waitForPin(page);
  await page.waitForTimeout(4000);
  expect(state.calls.geocode).toBe(1);
  await expect(page.locator("#t-addr")).toHaveText("");
});

test("with a geocoder the street name shows", async ({ page }) => {
  await fastConfig(page);
  await mockApi(page);
  await login(page, BASE_URL);
  await waitForPin(page);
  await expect(page.locator("#t-addr")).toHaveText("Teststraat, Leiden");
});
