// Nep-Traccar voor de e2e-specs. Alles wat met Traccar praat loopt hierlangs;
// een spec kan de toestand (sessie, posities) tijdens de test veranderen.
"use strict";

function mockApi(page, opts) {
  const state = Object.assign({
    loggedIn: false,           // bestaat er een sessie (cookie)?
    tokenWorks: true,          // werkt stil herinloggen met het token?
    devices: [{ id: 42, name: "Anna", status: "online", uniqueId: "secret-123" }],
    positions: () => [{
      id: 1, deviceId: 42, latitude: 52.1601, longitude: 4.4970, speed: 0, course: 0,
      fixTime: new Date().toISOString(), attributes: { batteryLevel: 80 },
    }],
    geocode: 200,
    calls: { devices: 0, positions: 0, geocode: 0, login: 0 },
  }, opts || {});

  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  return Promise.all([
    page.route("**/api/session*", async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (req.method() === "DELETE") { state.loggedIn = false; return json(route, 204, {}); }
      if (req.method() === "POST") { state.calls.login++; state.loggedIn = true; return json(route, 200, { id: 1, name: "Bram" }); }
      if (url.searchParams.has("token")) {
        if (!state.tokenWorks) return json(route, 401, {});
        state.loggedIn = true; return json(route, 200, { id: 1, name: "Bram" });
      }
      return state.loggedIn ? json(route, 200, { id: 1, name: "Bram" }) : json(route, 401, {});
    }),
    page.route("**/api/session/token", (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "e2e-dummy-token" })),
    page.route("**/api/devices", (route) => {
      state.calls.devices++;
      return state.loggedIn ? json(route, 200, state.devices) : json(route, 401, {});
    }),
    page.route("**/api/positions", (route) => {
      state.calls.positions++;
      return state.loggedIn ? json(route, 200, state.positions()) : json(route, 401, {});
    }),
    page.route("**/geocode**", (route) => {
      state.calls.geocode++;
      if (state.geocode !== 200) return route.fulfill({ status: state.geocode, body: "not found" });
      return json(route, 200, { address: { road: "Teststraat", city: "Leiden" }, display_name: "Teststraat, Leiden" });
    }),
  ]).then(() => state);
}

async function login(page, baseUrl) {
  await page.goto(baseUrl);
  await page.fill("#u", "bram");
  await page.fill("#p", "e2e-password");
  await page.click('#login-form button[type="submit"]');
}

async function waitForPin(page) {
  await page.locator("#map.maplibregl-map").waitFor({ state: "attached", timeout: 15000 });
  await page.locator("#map .maplibregl-marker").first().waitFor({ state: "attached", timeout: 15000 });
}

module.exports = { mockApi, login, waitForPin };
