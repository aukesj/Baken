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
With retention on, a backup holds positions the live server has since
deleted: keep backups no longer than you need them.

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

## The bridge

The `bridge` container (php-fpm) serves two small scripts.

### Device list (`/api/devices`)

`devices.php` passes the viewer's cookie on to Traccar (`BAKEN_TRACCAR_URL`,
default `http://traccar:8082/` in the compose file) and removes each device's
`uniqueId` from the answer. If Traccar says 401, so does the script, and the
viewer logs in again silently. If the bridge is down, the viewer keeps the
device list it already had and still moves the pins.

### Overland (`/overland`)

`/overland` is served by the `bridge` container (php-fpm) and forwards to
Traccar's OsmAnd endpoint. It:

- forwards at most `BAKEN_MAX_POINTS` (default 50) of the newest points per
  request and always returns `200`, so a phone's offline backlog can't cause a
  timeout loop;
- uses the Overland app's **Device ID**, or `BAKEN_DEFAULT_DEVICE_ID` as
  fallback. If neither is set, the point is skipped.

## Retention

Traccar keeps every position forever. The `pruner` container deletes positions
older than `BAKEN_RETENTION_HOURS` (24 in `.env.example`) every quarter of an
hour. **Each device's newest position always stays**, so a phone that is
switched off still shows with "last seen" — just without a trail. Leave
`BAKEN_RETENTION_HOURS` empty or `0` to keep everything.

Deleting is irreversible. The first round after you turn this on removes all
older history. To keep what you have, set `BAKEN_PRUNE_FLOOR` to the current
time (e.g. `2026-09-25T12:00:00Z`); nothing at or before it is ever touched.

### The pruner account

The pruner logs in to Traccar with its own account, as narrow as the job
allows. It can delete history but not read it. In Traccar's admin UI:

1. **Settings → Groups → +**: a group, e.g. `Everyone`. Put every device in it
   (Settings → Devices → the device → Group). New devices go in this group too.
2. **Settings → Users → +**: `pruner@baken.local` (or the value of
   `BAKEN_PRUNER_EMAIL`) with a long random password (`BAKEN_PRUNER_PASSWORD`).
   Leave **Administrator** and **Readonly** off; turn **Disable reports** on.
3. Link the group to the pruner: Settings → Users → pruner → Connections →
   Groups → `Everyone`.
4. `docker compose up -d pruner` and check the first round (after one minute):

   ```bash
   docker compose logs pruner
   # … prune: 3 device(s) pruned up to …, 0 skipped, 0 failed (retention 24 h, 3 devices visible to the pruner)
   ```

**A device outside the group is never pruned.** Compare the number of
devices in that log line with Settings → Devices. Test a change first with
`docker compose run --rm pruner php /srv/pruner/prune.php --dry-run`.

The log line cannot say *how many* positions were deleted: counting would
require letting the pruner read everyone's history.

## Security notes

- Device **Identifiers** are bearer secrets — anyone who knows one can post that
  device's location. Use long random values and share them privately.
- The public proxy therefore never hands them out: `/api/devices` goes through
  `bridge/devices.php`, which returns Traccar's own answer (same session, same
  permissions) minus the `uniqueId` field. `/api/devices/<id>` and the
  WebSocket (`/api/socket`) are closed on the public host; the Traccar admin UI
  keeps both over the SSH tunnel.
- The session cookie gets `Secure`, `HttpOnly` and `SameSite=Strict` from the
  proxy.
- TLS is handled by Caddy automatically. Keep ports 80/443 open for renewals.
- Location responses are sent with `Cache-Control: no-store` so they never land
  in a browser or service-worker cache.
