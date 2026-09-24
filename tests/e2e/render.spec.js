// Render/CSP-poort: de viewer rendert volledig onder de strikte CSP van de
// proxy-voorbeelden (geen script, worker, tegel of stijl geblokkeerd), voor
// alle vier kaartstijlen. Sinds MapLibre start elke stijl de blob:-worker en
// haalt tegels via connect-src.
"use strict";
const { test, expect } = require("@playwright/test");
const { server, PORT } = require("./csp-static-server.js");
const { mockApi, login, waitForPin } = require("./mock-api.js");

const BASE_URL = `http://127.0.0.1:${PORT}`;
test.beforeAll(() => new Promise((resolve) => server.listen(PORT, resolve)));
test.afterAll(() => new Promise((resolve) => server.close(resolve)));

function collectDiagnostics(page) {
  const csp = [], failed = [], errors = [];
  page.on("console", (msg) => { if (/refused to|content security policy/i.test(msg.text())) csp.push(msg.text()); });
  page.on("pageerror", (err) => { errors.push(String(err)); if (/refused to|content security policy/i.test(String(err))) csp.push(String(err)); });
  page.on("requestfailed", (req) => failed.push(`${req.url()} — ${req.failure() && req.failure().errorText}`));
  return { csp, failed, errors };
}

for (const style of ["standard", "voyager", "roads", "imap"]) {
  test(`renders cleanly under strict CSP — map style "${style}"`, async ({ page }) => {
    await mockApi(page);
    const diag = collectDiagnostics(page);
    await login(page, BASE_URL);
    await waitForPin(page);

    if (style !== "standard") {
      await page.click("#fab-settings");
      await expect(page.locator("#sheet")).toBeVisible();
      await page.click(`#seg-map button[data-v="${style}"]`);
      await page.waitForTimeout(1500);
      // Het tandwiel blijft bereikbaar en is ook de weg terug.
      await page.click("#fab-settings");
      await expect(page.locator("#sheet")).toBeHidden();
    }
    await page.waitForTimeout(1000);

    expect(diag.csp, diag.csp.join("\n")).toEqual([]);
    expect(diag.failed.filter((r) => /ERR_BLOCKED_BY_CSP/i.test(r))).toEqual([]);
    expect(diag.errors, diag.errors.join("\n")).toEqual([]);
    await expect(page.locator("#map .maplibregl-marker").first()).toBeAttached();
    // Een persoon zonder foto valt terug op de initiaal; nergens een onerror=.
    expect(await page.locator("[onerror]").count()).toBe(0);
  });
}

test("the battery shows as a filled bar", async ({ page }) => {
  await mockApi(page);
  await login(page, BASE_URL);
  await waitForPin(page);
  await expect(page.locator("#t-batt .batt-fill")).toHaveAttribute("style", /width:80%/);
  await expect(page.locator("#t-batt .batt-pct")).toHaveText("80%");
});

test("logging out asks first, and Cancel keeps you in", async ({ page }) => {
  await mockApi(page);
  await login(page, BASE_URL);
  await waitForPin(page);
  await page.click("#fab-settings");
  await page.click("#open-adv");
  await page.click("#logout");
  await expect(page.locator("#logout-dlg")).toBeVisible();
  await expect(page.locator("#logout-cancel")).toBeFocused();
  await page.click("#logout-cancel");
  await expect(page.locator("#logout-dlg")).toBeHidden();
  await expect(page.locator("#login")).toBeHidden();
});
