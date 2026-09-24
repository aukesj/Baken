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
git clone https://github.com/aukesj/Baken.git baken
cd baken

# 1. Environment
cp .env.example .env
$EDITOR .env                       # set BAKEN_HOST=baken.example.com and BAKEN_CONTACT

# 2. Traccar config
cp traccar/traccar.xml.example traccar/traccar.xml

# 3. Reverse proxy
cp proxy/Caddyfile.example proxy/Caddyfile

# 4. Launch
docker compose up -d
```

Caddy will fetch a TLS certificate automatically (give it a minute on first
run). Then open `https://baken.example.com/`.

### Street names

The viewer shows a street name next to each person. Caddy looks it up
server-side at OpenStreetMap's public
[Nominatim](https://nominatim.org/), so the viewers' browsers never send
coordinates to a third party themselves. Nominatim's
[usage policy](https://operations.osmfoundation.org/policies/nominatim/) asks
for a contact address; that is `BAKEN_CONTACT` in `.env`.

This does mean the *server* sends the coordinates of whoever is being looked at
to OpenStreetMap. Don't want that? Point the `/geocode` block in
`proxy/Caddyfile` at your own Nominatim, or remove it and set
`showAddress: false` in `viewer/config.js`.

### Photos on the pins (optional)

Put a square photo per person in `viewer/images/`, named after the device name
in lower case without spaces or punctuation (`Anne-Marie` → `annemarie.png`),
about 256×256. Without one the pin shows a coloured initial. The folder is
git-ignored. Note that these files are served like the rest of the viewer,
without a login; leave the folder empty (or set `photoPath: ""` in
`viewer/config.js`) if that is not acceptable to you.

## First login (create the admin)

The Baken viewer at `https://baken.example.com/` is for *watching*. Creating
users, devices and permissions is done in **Traccar's own admin UI**, which the
compose binds to `localhost:8082` on the server (never exposed publicly).

1. Open an SSH tunnel to it and visit it locally:

   ```bash
   ssh -L 8082:localhost:8082 you@your-server
   # then open http://localhost:8082 in your browser
   ```

2. Register a new account. **In Traccar, the first account you register
   automatically becomes the administrator.** (See the
   [Traccar documentation](https://www.traccar.org/documentation/).)
3. As that admin, add your people, devices and visibility — see
   [SETUP.md](SETUP.md).
4. Your family then logs in to the viewer at `https://baken.example.com/` with the
   accounts you created.

> Tip: after creating your admin, disable open registration in Traccar so
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
