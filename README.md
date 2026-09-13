# House of Wellness

Two self-hosted apps that run on your computer and are used from elsewhere in
the house.

## [`streamhouse/`](streamhouse) — media centre with downloads

A Stremio-style front end with a qBittorrent-style download manager built in.
Browse catalogues from any Stremio add-on you install, stream while the file is
still downloading, or keep it on disk with pause, resume, per-file selection and
speed limits.

Watch it on a TV three ways: the TV's own browser (it switches to a ten-foot,
D-pad-driven layout), cast to the TV over Google Cast or DLNA, or the
**[Android TV app](streamhouse/android)** — sideload the APK from the
`tv-latest` release.

On a phone it goes on the home screen with its own icon and drives the TV from
the sofa — see [On your phone](streamhouse#on-your-phone).

```bash
cd streamhouse && npm install && npm start     # http://127.0.0.1:11471
```

## [`pcremote/`](pcremote) — your phone as a PC remote

Trackpad, keyboard, media keys and power control from the phone's browser, plus
a bedtime timer that shuts the computer down after you fall asleep. PIN-paired.

```bash
cd pcremote && npm install && npm start        # http://127.0.0.1:11480
```

Both run happily at the same time — different ports, no shared state.
