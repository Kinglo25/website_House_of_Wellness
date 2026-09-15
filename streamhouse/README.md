# StreamHouse

A Stremio-style media centre with a qBittorrent-style download manager built in.

Browse catalogues, open a title, and either **stream it** (playback starts while the
file is still downloading) or **download it** to disk and keep it — with pause,
resume, per-file selection, speed limits, seeding and progress, like a normal
torrent client.

```
┌──────────┬──────────────────────────────────────────────┐
│  rail    │  Home · Discover · Library · Downloads       │
│  (icons) │  Add-ons · Settings                          │
├──────────┼──────────────────────────────────────────────┤
│          │  poster shelves → title page → stream list   │
│          │  ▶ Play  ⭳ Download                          │
└──────────┴──────────────────────────────────────────────┘
```

## Requirements

- Node.js 18.17 or newer (tested on Node 22)
- A few hundred MB of free disk for whatever you download

## Install and run

```bash
cd streamhouse
npm install
npm start
```

Then open **http://127.0.0.1:11471**.

Handy overrides:

```bash
PORT=8080 npm start                       # different web port
HOST=0.0.0.0 npm start                    # reachable from your TV / phone
STREAMHOUSE_DOWNLOADS=/media/films npm start
STREAMHOUSE_DIR=/tmp/sh-test npm start    # separate settings/state directory
```

Settings live in `~/.streamhouse/` (config, add-on list, library, watch history and
a backup copy of every `.torrent` in your list). Media goes to
`~/Downloads/StreamHouse` by default — change it under **Settings → Download folder**.

## Add-ons: where the content comes from

StreamHouse speaks the [Stremio add-on protocol](https://github.com/Stremio/stremio-addon-sdk).
An add-on is just an HTTP endpoint serving a manifest plus any of the
`catalog`, `meta`, `stream` and `subtitles` resources.

Only one add-on ships by default: **Cinemeta**, the public metadata catalogue, so the
home page is not empty on first run. It provides descriptions and posters — no streams.

To add sources, go to **Add-ons** and paste a manifest URL:

```
https://example.com/manifest.json
```

Add-ons higher in the list win: their streams are listed first, and their metadata is
preferred. Use the ↑ button to reorder, or Disable to keep one installed but inactive.

**You choose your own sources, and you are responsible for them.** Install add-ons you
have the right to use, and download only material you are allowed to download.

## Which stream you get

Add-ons hand back a wall of releases with the useful information buried in the
name — `Show.S01E02.1080p.WEB-DL.DDP5.1.H.264-NTb`. StreamHouse parses every one
of them (resolution, source, codec, audio, HDR, release group, size, seeders,
proper/repack) and sorts the list best-first, so the top row is the one worth
pressing Play on. **▶ Play best** on the title page plays exactly that row.

What "best" means is yours to set, under **Settings → Streams**:

| Profile | Picks for |
|---|---|
| **Plays anywhere** | a browser tab or a Chromecast: H.264 in MP4 with AAC, because that is all they decode |
| **Balanced** | good picture, nudged towards files every device in the house can handle |
| **Best picture** | the Android TV app, casting, or anything that plays MKV properly — remuxes, HDR, Atmos |

Plus three limits: **highest resolution**, **fewest seeders** and **largest
file**. Anything that fails one of them — along with cam rips and samples — drops
to the bottom of the list greyed out, with the reason next to it. Nothing is
hidden: sometimes the bad release is the only release, and that is your call to
make, not the app's.

Two further checks run when it knows what you asked for:

- **Is this the episode you clicked?** Open S02E05 and a release named S02E06
  is thrown out by name, however well seeded it is. A season pack of the right
  season is kept, nudged down a little, since the episode is one file inside it.
  A release that names no episode at all is left alone — plenty of add-ons
  return a bare hash with nothing to check.
- **Is the file the right size for something this long?** Judged in MB per
  minute against the runtime, so a 22-minute episode and a three-hour film are
  not held to the same number, and an HEVC encode is not called suspicious for
  being half the bitrate of an H.264 one. The band is wide on purpose: it
  catches samples, trailers and mislabelled packs, it does not grade encodes.

A limit you set rejects a release. A heuristic about what a file ought to weigh
only ever nudges it down the list.

Press ⋯ on any row to see exactly how it was scored and why it sits where it does.

## Downloading

Anything with an info-hash can be downloaded rather than just streamed:

- **⭳ Download** on any stream row on a title page
- **Paste a magnet link** (or an info-hash, or a `.torrent` URL) on the Downloads page
- **Drop a `.torrent` file** anywhere on the Downloads page
- **⭳ Keep this file** while watching, to save what you are streaming

The Downloads page gives you what a torrent client gives you:

| | |
|---|---|
| Progress, size, ↓/↑ speed, peers, ETA, ratio | live, once a second |
| Pause / Resume | per torrent, or all at once |
| Files (n) | per-file checkboxes — skip the extras, keep the film |
| 📁 | the exact path on disk |
| Delete | with or without deleting the downloaded data |
| Speed limits | global ↓/↑ caps in KB/s |

Downloads survive a restart: the app keeps each torrent's metadata, re-checks the data
already on disk and picks up where it left off — even with no peers around.

## Watching on your TV

Three ways, depending on what your TV can do. All of them need the app reachable
from your network first: **Settings → TV → Allow other devices**, which flips the
server from this-computer-only to your whole home network and shows the address to
use. The startup banner prints it too:

```
  StreamHouse is running
  On this computer   http://127.0.0.1:11471
  On your network    http://192.168.1.34:11471   ← open this on your TV
```

### 0. Android TV: install the app

Android TV, Google TV and Fire TV have no usable web browser, so they get a real
app instead — sideloaded from an APK exactly like SmartTube:

1. Download `streamhouse-tv.apk` from the repository's **`tv-latest`** release
   (GitHub Actions rebuilds it on every change to `streamhouse/android/`).
2. Install it on the TV with the *Downloader* app, or `adb install`.
3. Open it, and press OK on your computer in the list it finds.

It plays video through ExoPlayer rather than a WebView, so the MKV / H.265 / AC3
files torrents actually contain play properly. See
[`android/README.md`](android/README.md) for the details.

### 1. The TV's own web browser (Samsung, LG and other smart TVs)

Type that address into the TV browser. StreamHouse notices it is a TV and switches to
**ten-foot mode**: larger type, bigger posters, and a highlight you can see from the sofa.
The remote drives it:

| Remote | Does |
|---|---|
| D-pad arrows | move the highlight (it works out which tile is in that direction) |
| OK / Enter | open the highlighted thing |
| Back / Return | previous screen — including Samsung's and LG's own back keycodes |
| ◀◀ ▶ ❚❚ ▶▶ | rewind, play, pause, forward, while watching |

In the player, left/right seek; volume stays with the TV's own volume keys, where it
belongs. You can force the mode either way in **Settings → Ten-foot mode**, or with
`?tv=1` / `?tv=0` on the URL.

### 2. Cast to the TV

Hit **📺 TV** on any stream, any download, or in the player. StreamHouse scans the
network over both **Google Cast** (Android TV, Google TV, Chromecast) and **DLNA**
(Samsung, LG, Sony and most other smart TVs), you pick your TV, and it starts playing there — pulling the video from this
server directly, so it works while the file is still downloading. The page you pressed it
from becomes the remote: pause, resume, skip back, stop, with the position read back from
the TV.

An Android TV or Chromecast just needs to be awake on the same network. Other TVs need
their DLNA feature switched on first — Samsung calls it **AllShare**, LG **SmartShare**,
Sony **Home network**. If a TV never shows up in the scan, use **Add by address**: a bare
IP like `192.168.1.30` for a Cast device, or the device description URL for a DLNA one.

### 3. Anything else

Copy the stream URL (**Open elsewhere** in the player, or ⋯ on a stream row) and paste it
into whatever the TV runs — VLC on an Android TV, Kodi, an Apple TV app, a games console:

```
http://192.168.1.34:11471/api/stream/<info-hash>/<file-index>
```

### If the TV cannot play it

TVs are usually *better* at this than browsers — most handle MKV and H.265 natively — so a
file that fails in a browser tab often plays fine cast or opened on the TV itself. If a
particular file still refuses, it is the TV's decoder, not the download: the file on disk
is fine and plays anywhere else.

## Playing

The player streams over HTTP byte ranges from the local engine, so seeking works while
the file is still downloading. Keyboard: `space`/`k` play-pause, `←`/`→` 5s, `↑`/`↓`
volume, `f` fullscreen, `m` mute, `esc` back. Playback position is remembered and shows
up under *Continue watching*.

Browsers only decode some formats (MP4/WebM reliably; MKV and HEVC often not). If a file
will not play, hit **Open elsewhere** — it copies a local URL you can paste straight into
VLC, MPV or IINA while the download continues:

```
http://127.0.0.1:11471/api/stream/<info-hash>/<file-index>
```

## Layout

```
streamhouse/
├── server/
│   ├── index.js        express app, static hosting, shutdown
│   ├── config.js       settings with defaults, persisted to disk
│   ├── addons.js       Stremio add-on protocol client (catalog/meta/stream/subtitles)
│   ├── parse.js        release names → resolution, source, codec, group, seeders…
│   ├── rank.js         quality profiles: score the parsed releases, best first
│   ├── torrent.js      the BitTorrent engine: add, select, pause, stats, cleanup
│   ├── store.js        small atomic JSON store
│   ├── cast.js         DLNA/UPnP: SSDP discovery + AVTransport control
│   ├── googlecast.js   Google Cast: mDNS + castv2 (what Android TV speaks)
│   ├── discovery.js    answers the TV app's "where are you?" broadcast
│   ├── network.js      LAN addresses, and whether a TV can actually reach us
│   ├── mime.js         content types, SRT → WebVTT
│   ├── paths.js        where state and media live
│   └── routes/api.js   the REST API + byte-range stream server
├── android/            the Android TV app (see android/README.md)
└── public/
    ├── index.html      app shell
    ├── css/style.css   theme
    └── js/
        ├── app.js      routes, search box, global transfer counters
        ├── router.js   hash router
        ├── api.js      typed wrapper over the REST API
        ├── tv.js        ten-foot mode: D-pad navigation, remote keys
        ├── cast.js      device picker and the on-screen remote
        ├── components.js, util.js
        └── views/      board, discover, search, detail, library,
                        downloads, addons, settings, player
```

No build step and no frontend framework — the browser loads the ES modules directly, so
editing a file and reloading is the whole dev loop. `npm run dev` restarts the server on
change, and `npm test` checks the parser and the ranker against real-world release
names (no server and no network needed).

## API

Useful if you want to drive it from a script or another app:

| Method | Path | |
|---|---|---|
| GET | `/api/torrents` | list + global totals |
| POST | `/api/torrents` | `{magnet｜infoHash, sources, fileIdx, mode, meta}` |
| POST | `/api/torrents/file` | raw `.torrent` body |
| POST | `/api/torrents/:id/pause`｜`/resume` | |
| POST | `/api/torrents/:id/files` | `{indices:[…]}` |
| DELETE | `/api/torrents/:id?deleteFiles=1` | |
| GET | `/api/stream/:id/:fileIdx` | byte-range video |
| GET | `/api/playback/:id` | what the player needs before it starts |
| GET | `/api/catalogs`, `/api/catalog`, `/api/meta/:type/:id` | add-on data |
| GET | `/api/streams/:type/:id?runtime=` | add-on streams, parsed and ranked best-first. A `<id>:<season>:<episode>` id gets episode checking; `runtime` (`"57 min"`) gets size checking |
| GET/POST | `/api/config` | settings |
| GET | `/api/profiles` | the stream profiles Settings offers |
| GET | `/api/network` | LAN addresses and whether other devices can reach it |
| POST | `/api/network/expose` | `{enabled}` — switch between local-only and network |
| GET/POST | `/api/cast/devices` | list/scan renderers, or add one by address |
| POST | `/api/cast/play` | `{deviceId, torrentId, fileIdx, title}` |
| POST | `/api/cast/:id/control` | `{action: pause｜resume｜stop｜seek｜volume, value}` |
| GET | `/api/cast/:id/status` | transport state and position, read from the TV |

## Notes

- `webtorrent` must stay on **v3**. In v2 the pinned `parse-torrent` returns the
  info-hash as a string while `uint8-util` expects a typed array, and every torrent
  you add throws on the spot.
- Allowing other devices (`HOST=0.0.0.0`) exposes the UI and the stream server to your
  whole network with no authentication, so only do it on a network you trust. Switching it
  drops open connections, so anything playing at that moment restarts.
- Casting hands the TV a URL on your LAN address. If the app is listening on loopback only,
  casting refuses with an explanation rather than sending the TV a `127.0.0.1` link it
  could never fetch.
- Nothing is sent anywhere: add-on requests go straight from your machine to the add-on
  you installed, and downloads are ordinary BitTorrent traffic. Your IP is visible to the
  swarm, exactly as with any torrent client.
