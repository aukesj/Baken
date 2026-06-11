<div align="center">

# 🔆 Baken

**Sovereign, self-hosted location sharing — a privacy-first alternative to Apple Find My and Google location sharing.**

*Only the host can see where people are. Followers who just want to watch share nothing — not even with the host.*

[Quick start](docs/INSTALL.md) · [Setup & users](docs/SETUP.md) · [Admin](docs/ADMIN.md) · [Daily use](docs/USE.md) · [License: AGPL-3.0](LICENSE)

</div>

---

## What is Baken?

Baken (Dutch/Norse for *beacon* — a landmark you steer by) lets a family, group of friends, or small team share live location with each other **on their own server**, with no third party in the loop. It is a thin, friendly layer on top of the proven [Traccar](https://www.traccar.org/) tracking server:

- a clean, **Find-My-like map viewer** (the part that makes Traccar feel like a consumer app),
- a small **bridge** so the excellent [Overland](https://overland.p3k.app/) iOS app (battery + real GPS accuracy) can publish to Traccar,
- ready-made **reverse-proxy** templates and a one-command **Docker Compose** stack.

The result is something you can hand to non-technical family members: they open a web app, see each other on a map, and that's it.

## Why Baken exists

Find My and Google location sharing work — but every location you share flows through Apple's or Google's servers. Baken's premise is different:

- **You host it.** Your locations live on *your* machine. No SaaS, no telemetry, no account with a Big Tech company.
- **Asymmetric by design.** Visibility is per-person and one-directional. A parent can see the kids without the kids seeing each other — or the parent. You decide every edge of the graph.
- **Followers share nothing.** A "follower" role can watch the map without ever transmitting their own position. This isn't a promise bolted on top — **the viewer computes your own position locally in your browser and never sends it to the server.** A pure follower is invisible, even to the host.
- **Open and auditable.** AGPL-3.0. Read the code, change it, run it. If you offer it as a service, you share your changes back.

## Key features

- 📍 **Live map** with photo pins, accuracy circles, distance & bearing to each person, and "last seen" times.
- 🧭 **Live feel** — between GPS fixes the marker glides forward along the last heading/speed (dead reckoning), with an honestly-growing uncertainty circle. Optional **road-following** via a routing backend.
- 🔀 **Asymmetric visibility** — per-user, per-device permissions; spokes can see the hub's live position without its history.
- 🙈 **Follower role** — watch-only users who never publish their location.
- 🔋 **Battery & real accuracy** on iOS via the Overland bridge; Android/other via the Traccar Client (OsmAnd protocol).
- 📱 **Installable PWA** — add to home screen, looks and feels native; persistent login (no surprise logouts).
- 🌍 **i18n-ready** viewer (ships with English + Dutch).
- 🔒 **No location data in caches** — strict no-store on the API; the app shell is cacheable, your whereabouts are not.

## How it works

```
  ┌─────────────┐   Overland (iOS) ──► /overland ──► bridge ──┐
  │  phones &   │   Traccar Client (Android/iOS) ──► /track ──┤
  │  devices    │   any OsmAnd/OwnTracks-speaking client ─────┤
  └─────────────┘                                             ▼
                                                       ┌──────────────┐
   followers' browsers ◄──── Baken viewer (PWA) ◄───── │   Traccar    │
   (position computed locally, never sent)   REST/WS   │  (storage +  │
                                                       │  protocols)  │
                                                       └──────────────┘
        reverse proxy (Apache/Caddy) terminates TLS and routes everything
```

The **viewer** is a static PWA. The **bridge** is a tiny PHP script translating Overland's JSON into Traccar's OsmAnd endpoint. **Traccar** stores positions and enforces permissions. A **reverse proxy** ties it together behind one hostname with TLS.

## Quick start

```bash
git clone https://codeberg.org/<you>/baken.git
cd baken
cp .env.example .env      # set hostname, admin credentials, etc.
docker compose up -d
```

Then add your users and devices — see **[docs/INSTALL.md](docs/INSTALL.md)** and **[docs/SETUP.md](docs/SETUP.md)**.

## Roles

| Role | Sees on the map | Publishes own location | Typical use |
|------|-----------------|------------------------|-------------|
| **Host / admin** | Everyone they grant themselves | Optional | The person running the server |
| **Member** | Whoever the host grants them | Yes | Family member sharing & watching |
| **Follower** | Whoever the host grants them | **No** | Someone who only wants to watch |

Visibility is set per edge, so "Member A sees Member B but not vice-versa" is a normal, supported configuration.

## Planned features

These are ideas on the roadmap — not yet built. Contributions welcome.

- 🖥️ **Device auto-detection** beyond phones: tracking a Mac, Windows PC, or Raspberry Pi tied to your own account (similar to how Find My shows your laptop).
- 👨‍👩‍👧 **Family / group management** UI — invite flows, group-scoped visibility presets.
- 🛣️ **Bundled road-following** routing (optional OSRM/Valhalla container) for map-matched live estimation.
- 🔔 **Geofence notifications** ("arrived home", "left school") kept fully on-device/host.
- 🗺️ **Self-hosted tiles** option, so even map rendering needs no third party.

## Built on

[Traccar](https://www.traccar.org/) (GPS server) · [Overland](https://overland.p3k.app/) & Traccar Client (mobile clients) · [Leaflet](https://leafletjs.com/) / [MapLibre](https://maplibre.org/) (map) · OpenStreetMap data. Baken is an independent project and is not affiliated with or endorsed by Apple, Google, or Traccar.

## License

[GNU AGPL-3.0](LICENSE). You may use, study, modify, and self-host Baken freely. If you run a modified version as a network service, you must make your modified source available to its users. This keeps Baken open for everyone who hosts it.
