# Installing Baken

Baken runs as a small Docker Compose stack: **Traccar** (storage + protocols), a
**PHP bridge** (for the Overland iOS app), and **Caddy** (reverse proxy + static
viewer + automatic HTTPS).

## Prerequisites

- A server with **Docker** and the **Docker Compose** plugin.
- A **domain name** (e.g. `baken.example.com`) with an A/AAAA record pointing at
  the server.
- Ports **80** and **443** reachable from the internet (Caddy needs them for
  Let's Encrypt and serving).

## Steps

```bash
git clone https://codeberg.org/jasperaukes/Baken.git baken
cd baken

# 1. Environment
cp .env.example .env
$EDITOR .env                       # set BAKEN_HOST=baken.example.com

# 2. Traccar config
cp traccar/traccar.xml.example traccar/traccar.xml

# 3. Reverse proxy
cp proxy/Caddyfile.example proxy/Caddyfile

# 4. Launch
docker compose up -d
```

Caddy will fetch a TLS certificate automatically (give it a minute on first
run). Then open `https://baken.example.com/`.

## First login (create the admin)

Baken's viewer is for *watching*. To manage users and devices you use Traccar's
own admin UI. Open the Traccar web UI — the simplest way is to temporarily map
its port, or use the bundled proxy path:

1. Visit `https://baken.example.com/` — you'll get Baken's login screen, which
   talks to Traccar's API.
2. To create the **first account**, register through Traccar. In Traccar, **the
   first account you register automatically becomes the administrator.** (See the
   [Traccar documentation](https://www.traccar.org/documentation/) for the admin
   UI.)
3. Log in with that admin account.

> Tip: after creating your admin, you can disable open registration in Traccar so
> strangers can't sign themselves up. See [ADMIN.md](ADMIN.md).

## Next

- [SETUP.md](SETUP.md) — add people, devices, phone apps, and who-sees-whom.
- [ADMIN.md](ADMIN.md) — ongoing administration, backups, updates.
- [USE.md](USE.md) — hand this to your family members.

## Updating

```bash
git pull
docker compose pull
docker compose up -d
```

Your data lives in `traccar/data` (a Docker bind mount) and survives restarts and
image updates. Back it up — see [ADMIN.md](ADMIN.md).
