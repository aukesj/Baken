# Setup: people, devices, and who sees whom

This is the heart of Baken: **asymmetric visibility**. You decide, per edge, who
can see whom — and "followers" can watch without ever sharing their own location.

All of this is configured in **Traccar's admin UI** (you log in as the admin you
created in [INSTALL.md](INSTALL.md)). Baken is the friendly viewer on top.

## Roles (a Baken convention on top of Traccar)

Traccar has accounts and per-device permissions; Baken maps three practical roles
onto them:

| Role | Has own device? | Sees | How to create |
|------|-----------------|------|---------------|
| **Host / admin** | Optional | Anyone they grant themselves | The first account (admin) |
| **Member** | Yes | Whoever the admin grants | Account + a device + a phone app |
| **Follower** | **No** | Whoever the admin grants | Account only, no device |

A **follower** simply has no device of their own. Because **the viewer computes
your own position locally and never sends it to the server**, a follower shares
nothing — not even with the host. There is no setting to forget; it's the
architecture.

## 1. Create accounts

In Traccar: **Settings → Users → +**. Give each person a username (their email or
a handle) and a password. Hand those credentials to them for the Baken login.

## 2. Create devices

For everyone who should be *visible* (members), create a device:

**Settings → Devices → +**

- **Name**: shown on the map (e.g. "Dad").
- **Identifier**: a unique string the phone app sends. Use a long random value
  (treat it like a secret — anyone who knows it can post that device's location).

## 3. Link devices to people (visibility)

This is where asymmetry happens. A device is visible to a user only if you link
them. Select a user, then link the devices they may see.

- Want **kids see Dad, but Dad sees kids, and kids don't see each other**?
  - Link Dad's device to each kid (kids see Dad).
  - Link each kid's device to Dad (Dad sees the kids).
  - Do **not** link the kids' devices to each other.

Every link is one-directional, so any visibility graph is possible.

## 4. Hide history (live-only viewers)

By default a viewer can replay a device's history. To allow only the **live**
position (no track history), set this attribute on the *viewing* user:

**Settings → Users → (user) → Attributes → add** `disableReports` = `true`

That user keeps seeing live positions but cannot open reports/replay.

## 5. Phone apps (how positions get in)

Each member installs one client that publishes to Baken using their device's
**Identifier**:

### iOS — Overland (recommended: battery + real accuracy)
- Install **Overland**.
- **Receiver Endpoint URL**: `https://YOUR_HOST/overland`
- **Device ID**: the device **Identifier** from step 2.
- Send interval: ~5–30 s is a good balance (the viewer smooths between fixes).

### Android / iOS — Traccar Client (OsmAnd protocol)
- Install **Traccar Client**.
- **Server URL**: `https://YOUR_HOST/track`
- **Device identifier**: the device **Identifier** from step 2.

Followers install **nothing** — they just log in to the viewer.

## Next

- [ADMIN.md](ADMIN.md) — backups, updates, disabling registration, logs.
- [USE.md](USE.md) — the end-user guide.
