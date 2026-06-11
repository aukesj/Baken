# Administering Baken

Day-to-day administration. Most of this happens in **Traccar's admin UI**; the
rest is Docker and files on the server.

## Users & devices

- **Add / remove a person**: Settings → Users.
- **Add / remove a device**: Settings → Devices.
- **Change who sees whom**: link/unlink devices to users (see
  [SETUP.md](SETUP.md)). Links are one-directional.
- **Live-only (no history) for a viewer**: set user attribute
  `disableReports = true`.

## Disable open registration

After creating your admin and accounts, prevent strangers from self-registering.
In Traccar, turn off new-user registration (server settings / `web.registration`
in the Traccar config — see the
[Traccar documentation](https://www.traccar.org/documentation/)). Then you add
accounts yourself.

## Backups

All state lives in **`traccar/data/`** (the embedded H2 database) on the host.

```bash
# Stop for a consistent copy, back up, restart.
docker compose stop traccar
tar czf baken-backup-$(date +%F).tgz traccar/data
docker compose start traccar
```

Store the backup off-server. Restoring is the reverse: stop, replace
`traccar/data`, start.

## Updating

```bash
git pull
docker compose pull
docker compose up -d
```

Pin the Traccar image tag in `docker-compose.yml` if you want reproducible
upgrades. Test after upgrading; your data volume is preserved.

## Logs

```bash
docker compose logs -f caddy        # TLS, proxying, the bridge endpoint
docker compose logs -f traccar      # ingestion, decoding, permissions
tail -f traccar/logs/tracker-server.log   # raw Traccar device log
```

When debugging a phone that "won't update", the Traccar log shows each incoming
fix (and `Unknown device` if the identifier is wrong).

## The Overland bridge

`/overland` is served by the `bridge` container (php-fpm) and forwards to
Traccar's OsmAnd endpoint. It:

- forwards at most `BAKEN_MAX_POINTS` (default 50) of the newest points per
  request and always returns `200`, so a phone's offline backlog can't cause a
  timeout loop;
- uses the Overland app's **Device ID**, or `BAKEN_DEFAULT_DEVICE_ID` as
  fallback. If neither is set, the point is skipped.

## Security notes

- Device **Identifiers** are bearer secrets — anyone who knows one can post that
  device's location. Use long random values and share them privately.
- TLS is handled by Caddy automatically. Keep ports 80/443 open for renewals.
- Location responses are sent with `Cache-Control: no-store` so they never land
  in a browser or service-worker cache.
