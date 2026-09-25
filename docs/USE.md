# Using Baken (for family & friends)

Your host (the person running the server) gives you a **web address**, a
**username**, and a **password**. That's all you need.

## Install it like an app

1. Open the web address in your phone browser (Safari on iOS, Chrome on Android).
2. Log in with your username and password.
3. **Add to Home Screen** — now it opens like a normal app, full screen.

You stay logged in; you shouldn't have to type your password again.

## What you see

- **People** you're allowed to see, each as a photo pin on the map.
- A **circle** around someone shows how precise their location is.
- Tap a person for details: distance and direction from you, "last seen", and
  their street/area.
- When someone is moving (above ~3 km/h) you'll see a 🚗 and their speed.
  Between GPS updates the pin glides along smoothly for a live feel.
- Your **own** position is the blue dot, with a soft direction beam if you grant
  compass access. On iPhone the app asks on your first tap; if that didn't
  work, open ⚙️ Settings → **Turn on the compass**.
- **Rotate** the map with two fingers. The compass button at the bottom left
  turns it back to north.
- **Places**: tap a person or **press and hold** on the map to name a spot
  ("home", "school"). Tap a place to rename it, delete it, or set a
  notification for when someone arrives or leaves.
- ⚙️ **Settings** opens above the buttons at the bottom right; tap the gear
  again to close it. Logging out is under **Advanced**.

## Sharing your own location (members)

If you're meant to be visible, install one app and enter the **Device ID** your
host gives you:

- **iPhone**: *Overland* — Receiver URL `https://YOUR_HOST/overland`, Device ID
  as given. Best battery life and accuracy.
- **Android/iPhone**: *Traccar Client* — Server URL `https://YOUR_HOST/track`,
  device identifier as given.

Leave the app running in the background. **Don't force-quit it** (swipe it away) —
iOS won't keep sending if you do.

## Just want to watch? (followers)

Then install nothing. Log in and watch the map. **Your location is never sent to
the server** — the app works out where you are only inside your own phone, to draw
your blue dot. The host cannot see a follower's location, because it never leaves
your device.

## Your privacy

- Your places ("home", "school") and notifications are stored **only on your
  phone**, not on the server.
- The server keeps your positions for a limited time only (24 hours by
  default, set by your host); older ones are deleted. Your last position stays,
  so people can still see where you were last.
- Street names are looked up by the server at OpenStreetMap, not by your phone.
- Only the people your host explicitly linked can see you — and only if you run a
  publishing app.
- Nobody but the host controls the visibility graph; other members can't see each
  other unless the host linked them.
