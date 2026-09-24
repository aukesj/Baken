"use strict";
// De viewer draait onder script-src 'self': geen inline scripts, geen inline
// event handlers (onerror=, onclick=, …). Een handler in een HTML-string valt
// pas op als hij afgaat — en dan is het te laat. Deze test kijkt in de bron.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const VIEWER = path.join(__dirname, "..", "..", "viewer");
const files = fs.readdirSync(VIEWER).filter((f) => /\.(html|js)$/.test(f));

test("no inline event handlers in the viewer", () => {
  for (const f of files) {
    const src = fs.readFileSync(path.join(VIEWER, f), "utf8");
    const hit = src.match(/<[^>]*\son[a-z]+\s*=\s*["']/i);
    assert.equal(hit, null, `${f}: ${hit && hit[0]}`);
  }
});

test("no inline <script> bodies in index.html", () => {
  const html = fs.readFileSync(path.join(VIEWER, "index.html"), "utf8");
  for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
    assert.match(m[1], /\ssrc=/, "script without src");
    assert.equal(m[2].trim(), "", "script with an inline body");
  }
});
