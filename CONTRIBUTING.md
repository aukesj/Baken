# Contributing to Baken

Thanks for considering a contribution! Baken exists to give people **sovereign,
self-hosted location sharing** — a privacy-first alternative to Apple Find My and
Google. Contributions that keep it simple, private, and easy to self-host are
very welcome.

## Where development happens

- **Primary home: [Codeberg](https://codeberg.org/jasperaukes/Baken).** Open
  issues and pull requests here.
- **GitHub is a read-only mirror** for discoverability. Please don't open PRs
  there — they live on Codeberg.

## Reporting bugs & requesting features

Open an issue on Codeberg. For bugs, include:

- what you did, what you expected, what happened;
- your setup (OS, Docker version, reverse proxy used);
- relevant logs (`docker compose logs caddy` / `traccar`, and
  `traccar/logs/tracker-server.log`).

**Never paste real location data, device identifiers, or credentials** into an
issue. Redact them.

## Project layout

```
viewer/    static PWA (vanilla JS, no build step) — the map UI
bridge/    overland.php — translates Overland JSON to Traccar's OsmAnd endpoint
traccar/   Traccar config template (upstream server, not vendored)
proxy/     Caddy (default) and Apache (reference) reverse-proxy templates
docs/      INSTALL / SETUP / ADMIN / USE
```

## Local development

The viewer is plain HTML/CSS/JS with **no build step** and vendored libraries —
just serve the folder and point it at a Traccar instance.

```bash
# Serve the viewer locally
cd viewer && python3 -m http.server 8000
```

For a full stack, run `docker compose up -d` against a test domain (or use the
localhost Traccar UI via the SSH-tunnel described in docs/INSTALL.md). Please
**don't develop against a production instance with real people on it.**

## Coding conventions

- **Vanilla, dependency-light.** The viewer deliberately avoids frameworks and
  build tooling. Keep new dependencies vendored and minimal.
- **Privacy by default.** Never send the viewer's own position to the server; keep
  user preferences (places, notifications) in the browser. Don't add telemetry.
- **Comments explain *why*,** not what. Match the existing bilingual (EN/NL)
  style where you find it; English is fine for new code.
- **Conventional commits**: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, …

## License & sign-off

Baken is licensed under **AGPL-3.0**. By contributing, you agree your
contributions are licensed under the same terms. Please sign off your commits
(Developer Certificate of Origin):

```bash
git commit -s -m "feat: ..."
```

## Good first issues

The **Planned features** in the [README](README.md#planned-features) are a great
place to start — e.g. desktop device support, bundled road-following routing, or
geofence notifications. Smaller wins (docs, translations, accessibility) are just
as valued.

## Be kind

Assume good faith, be respectful, and help newcomers. We're building a friendly
tool for families and friends — let's keep the project that way too.
