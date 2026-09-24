// Minimale statische server (zonder dependencies) die viewer/ serveert met
// dezelfde CSP als proxy/Caddyfile.example en proxy/apache-baken.conf.example.
// Zo toetst de e2e-test de échte policy en niet een benadering ervan.
//
// Los te starten: node tests/e2e/csp-static-server.js [poort]
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const WEB_ROOT = path.join(__dirname, "..", "..", "viewer");
const PORT = Number(process.argv[2] || process.env.PORT || 4173);

// Houd deze string gelijk aan die in proxy/. Sinds de kaart MapLibre is gaan
// ook de rastertegels via fetch (connect-src), niet alleen via <img>.
const TILE_HOSTS = "https://tile.openstreetmap.org https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.fr https://tiles.openfreemap.org";
const CSP =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "worker-src 'self' blob:; " +
  "style-src 'self' 'unsafe-inline'; " +
  `img-src 'self' data: blob: ${TILE_HOSTS}; ` +
  `connect-src 'self' ${TILE_HOSTS}; ` +
  "font-src 'self'; " +
  "frame-ancestors 'none'; " +
  "base-uri 'self'; " +
  "object-src 'none'";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const resolved = path.normalize(path.join(root, decoded));
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

const server = http.createServer((req, res) => {
  res.setHeader("Content-Security-Policy", CSP);
  const filePath = safeJoin(WEB_ROOT, req.url === "/" ? "/index.html" : req.url);
  if (!filePath) { res.writeHead(400); res.end("bad path"); return; }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); res.end("not found"); return; }
    res.setHeader("Content-Type", MIME[path.extname(filePath)] || "application/octet-stream");
    fs.createReadStream(filePath).pipe(res);
  });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`csp-static-server listening on :${PORT}`));
}

module.exports = { server, CSP, PORT };
