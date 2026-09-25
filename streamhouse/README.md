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
STREAMHOUSE_ACCOUNT_SERVER=http://127.0.0.1:8787 npm start   # a different account server
```

Settings live in `~/.streamhouse/` (config, add-on list, library, watch history and
a backup copy of every `.torrent` in your list). Media goes to
`~/Downloads/StreamHouse` by default — change it under **Settings → Download folder**.

## On Windows

Run it from the desktop rather than from a terminal. Double-click this once:

```
streamhouse\windows\Create Desktop Shortcut.cmd
```

It puts a **StreamHouse** icon on the desktop and in the Start Menu. From then on
that icon starts the server and opens the app in a window of its own — Edge's app
mode, with its own taskbar icon and no tabs or address bar. The console window
that appears *is* StreamHouse — closing it stops the server.

Install VLC too, once:

```
winget install VideoLAN.VLC
```

On this computer **Play opens films in VLC**, which has the sound a browser drops
on most of them — see [Sound, and VLC](#sound-and-vlc).

The launcher behind the icon ([`windows/StreamHouse.cmd`](windows/StreamHouse.cmd))
finds Node wherever it was installed, runs `npm install` on the first run, and
waits for the server to actually answer before opening the window. Double-click
it while it is already running and it just opens the window instead of starting a
second copy and failing on the port. If Node is missing it says so and opens
nodejs.org, rather than flashing up a console window and vanishing.

Everything lives in the same places, under their Windows names:

| | |
|---|---|
| Settings, add-ons, library, watch history | `C:\Users\<you>\.streamhouse\` |
| Downloads | `C:\Users\<you>\Downloads\StreamHouse` |

The Node installer already adds the inbound firewall rule, so **Settings → TV →
Allow other devices** is normally all that is needed before a phone or TV can
reach it.

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

### Profiles: who is watching

Each person in the house can have a profile, as on Netflix: their own *Continue
watching*, watched episodes, *Up next*, calendar and library. Add-ons, downloads and
settings stay shared. Add them under **Settings → Profiles** (up to six), with a name
and a colour.

With more than one profile, StreamHouse asks **Who's watching?** when it opens — once
per browser tab, or per launch of the TV app — starting on whoever watched last, so on
a TV one press of OK carries on. The avatar at the top right switches profile at any
time. With only one profile nothing changes and nothing is asked.

Profiles travel with an account: add one on the laptop and it is on the TV; remove one
and its history goes on every device. The first profile keeps everything watched
before profiles existed. A device still running an older StreamHouse sees only that
first profile's history — and should be updated before a second profile saves the same
title to its library, since an old device cannot tell the two saves apart.

### Already downloaded

A film or episode you downloaded shows up on its title page as **On this computer**,
above the add-ons' streams, and the big Play button plays that copy — no internet
needed, as Netflix plays a downloaded episode. One still downloading says how far it
has got and can be watched while it finishes. Downloaded episodes carry **⭳ On disk**
in the episode list.

## On your phone

On an **Android phone**, install the same app as the TV
([Android TV: install the app](#0-android-tv-install-the-app)). It runs StreamHouse on
the phone itself, so it works anywhere with no computer, and your account keeps it in
step with your other devices.

On an **iPhone**, or to use a computer's StreamHouse without installing anything, the
phone opens it in its browser. Turn on **Settings → TV → Allow other devices** (or
start with `HOST=0.0.0.0 npm start`), then open the network address the banner prints —
`http://192.168.1.34:11471` — on the phone, over the same Wi-Fi.

On a narrow screen the layout rearranges itself: the icon rail moves to the bottom of
the screen as a tab bar, posters shrink to three across, and rows that put a name beside
a pile of buttons — streams, downloads, add-ons, every settings row — stack instead.

Add it to the home screen and it behaves like an app: its own name and icon rather
than a screenshot of the page.

- **iPhone / iPad** — Safari → Share → *Add to Home Screen*. Opens full screen.
- **Android** — Chrome → ⋮ → *Add to Home screen* (or *Install app*). Chrome only
  offers the full standalone install over HTTPS, so on a plain LAN address you get a
  home-screen icon that opens in Chrome. Same icon, same name, one tap.

From there the phone is a perfectly good remote for the TV: browse on the phone, press
**📺 TV** on a stream, pick the TV, and it plays there while the phone keeps the
transport controls. See below.

## Accounts: one library on every device

Sign in under **Settings → Account** and your library, *Continue watching*, add-ons and
stream settings follow you to every device signed in to the same account — the laptop,
the TV app, the phone. Stop a film on the TV, open the laptop, and it is on the home page
at the same second.

Films themselves do not sync: each device fetches its own copy when you press Play. Nor
do the settings that belong to one machine — its ports, download folder, speed limits and
which player opens.

- **Create account** on the first device, **Sign in** on the others. A device's first
  sign-in merges: what it had and what the account has both survive, and where both have
  the same title, the more recent position wins. Add-ons and stream settings come from the
  account.
- An edit goes up a few seconds after you make it. Each device looks for the others' edits
  every minute, and again whenever you open the home page or the library.
- Offline is fine: edits wait, and go up once the account server is reachable again.
- **Sign out** keeps everything already on that device; it just stops syncing.

The account server is a small Cloudflare Worker in [`account/`](account). It runs on
Cloudflare's free plan and stores those lists and nothing else. Your password never leaves
the device: it is stretched into a key there, and the server keeps only a hash of that
key. [`account/README.md`](account/README.md) covers deploying your own.

### Without an account: one StreamHouse, many screens

Watch history belongs to the StreamHouse **server**, not to the browser you watch in, so
every device that opens the same StreamHouse shares one *Continue watching* list even
without signing in. At home that comes for free once **Settings → TV → Allow other
devices** is on — other machines open `http://192.168.1.x:11471` and are looking at the
same library and the same progress.

For the same thing from outside the house, put the machines on a
[Tailscale](https://tailscale.com/download) network. It is free for personal use,
and unlike port-forwarding it exposes nothing to the public internet:

1. Install Tailscale on the computer running StreamHouse and on each machine you
   watch from, signing in to all of them with the same account.
2. On the StreamHouse computer, run `tailscale status` to get its name and
   address — a stable `100.x.y.z`, and with MagicDNS on, a name like
   `desktop-abc123` as well.
3. From any of those machines, anywhere, open `http://desktop-abc123:11471` —
   or `http://100.x.y.z:11471` if MagicDNS is off.

Neither the name nor the address changes, so bookmark whichever you prefer.
StreamHouse has **no password** (see [Notes](#notes)), which is precisely why a
private tailnet is the right way to reach it from outside — do not port-forward
it instead.

The one thing this needs is that the computer running StreamHouse is switched on — which
is what an account does away with.

## Watching on your TV

Four ways, depending on what your TV can do. The Android TV app runs StreamHouse
itself. The other three use StreamHouse on a computer, which has to be reachable from
your network first: **Settings → TV → Allow other devices** flips the server from
this-computer-only to your whole home network and shows the address to use. The
startup banner prints it too:

```
  StreamHouse is running
  On this computer   http://127.0.0.1:11471
  On your network    http://192.168.1.34:11471   ← open this on your TV
```

### 0. Android TV: install the app

Android TV, Google TV and Fire TV have no usable web browser, so they get a real
app instead — sideloaded from an APK exactly like SmartTube. StreamHouse runs inside
it, so the TV needs no computer at all:

1. Download `streamhouse-tv.apk` from the repository's **`tv-latest`** release
   (GitHub Actions rebuilds it whenever StreamHouse changes).
2. Install it on the TV with the *Downloader* app, or `adb install`.
3. Open it, and sign in under **Settings → Account** to bring your library along.

It plays video through ExoPlayer rather than a WebView, so the MKV / H.265 / AC3
files torrents actually contain play properly. It can use StreamHouse on a computer
instead — press **Menu** on the remote. See [`android/README.md`](android/README.md)
for the details.

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
volume, `<`/`>` speed (0.5× to 2×), `g`/`h` subtitles a quarter-second earlier or later,
`f` fullscreen, `m` mute, `esc` back, and `?` lists them all. The subtitle language you pick — or *off* — is
remembered and chosen by itself next time, and **Aa** beside it sets their size
(remembered) and timing (for this file), for the torrent whose subtitles run late.

On a phone it behaves like the Netflix app: a tap shows or hides the controls, a double
tap on the left or right of the picture jumps ten seconds, and the bar under the picture
can be dragged with a finger, showing the time it will land on. On a TV, any button on the
remote brings the controls back, and they stay while paused. Holding OK on a *Continue
watching* tile brings up its ✕, as holding it on a Netflix tile brings up its options.

Playback position is remembered every ten seconds and whenever you leave the player, and
shows up under *Continue watching* on the home page and in the library. A tile there goes
straight back into the file it was playing, at the second it stopped — not to the title
page. If the stream it came from has since gone (a cached stream cleaned up, a source that
dried up), the player offers **Pick another stream**: choose a new one and it carries on
from the same position. Titles watched to the end drop off the list by themselves, and
the × on a tile takes it off by hand.

### Where you are in a series

StreamHouse remembers what you have finished, the way Netflix and Stremio do, not only
where you stopped:

- A series page opens on the season and episode you are up to, with that episode's
  streams already listed. The big button says what it will do: **Resume S1:E3 · 12 min
  left**, **Play S1:E4**, **S2:E1 airs 3 Oct** when you are caught up, or **Watch again**.
  Beside a resume, **Start over** plays it from the beginning instead.
- Episodes carry a ✓ once watched and a bar while part-way through; ones not out yet
  show their air date. **Mark watched** sets or clears the tick by hand, and **Mark
  season watched** does a whole season — a finished season's tab gets a ✓ too.
- *Continue watching* has one tile per show, and after you finish an episode an
  **Up next** tile offers the one after it.

The **Library** keeps a calendar of the shows you have saved or watched, as Stremio's
does: *New episodes* out in the last fortnight that you have not seen, and what is
*Coming up* in the next month. Saved titles can be narrowed to films or series and
sorted by when they were added, when they were last watched, A–Z or release year; the
choice is remembered. Search results come in the same two groups.

Watched episodes travel with your account like everything else: they are kept in the
same progress list, so the account server needs no change. A device still running an
older StreamHouse shows finished titles on its *Continue watching* until it is updated.

### Sound, and VLC

Browsers decode only part of what releases carry: MP4 and WebM reliably, MKV and HEVC
often not, and AC3, E-AC3 and DTS audio — the soundtrack on most films — not at all, so
the picture plays in silence. On the computer running StreamHouse, **Play therefore opens
VLC**, which plays all of it, and the app goes back to browsing. StreamHouse reads VLC's
position every five seconds, so *Continue watching* works exactly as it does in the page:
close VLC, and the tile resumes it at the same second. Starting another film closes the
VLC playing the last one.

VLC is found in its usual install folder, on `PATH`, or wherever `VLC_PATH` points —
installed while StreamHouse is running, it is picked up on the next Play. Without it,
films play in the page and a note says why some are silent.

Phones, TVs and other computers always play in the page: VLC would only open on a screen
nobody is watching. To play in the page on this computer too, set **Settings → Playback**
to *The browser*.

**Open elsewhere** in the player opens VLC on demand, whatever that setting says. On any
other device it copies a local URL you can paste straight into VLC, MPV or IINA while the
download continues:

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
│   ├── vlc.js          hands playback to VLC and reads the position back
│   ├── history.js      the library and Continue watching stores
│   ├── sync.js         account sign-in, and pushing/pulling what follows you
│   ├── merge.js        the rules sync merges by: what changed, who wins
│   └── routes/api.js   the REST API + byte-range stream server
├── account/            the account server: a Cloudflare Worker (see account/README.md)
├── windows/            double-click launcher, icon and shortcut maker
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
names, plus the VLC hand-off and the rules account sync merges by (no server and no
network needed).

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
| GET | `/api/vlc` | whether VLC is installed, and whether the asking browser is on this computer |
| POST | `/api/vlc/play` | `{url, title, start, progressKey, meta, explicit}` — open it in VLC here |
| GET | `/api/catalogs`, `/api/catalog`, `/api/meta/:type/:id` | add-on data |
| GET | `/api/streams/:type/:id` | add-on streams, parsed and ranked best-first |
| GET/POST | `/api/config` | settings |
| GET | `/api/account` | signed in or not, when it last synced, and the last error |
| POST | `/api/account/signup`｜`/login` | `{email, password}` — the password is stretched here and never sent on |
| POST | `/api/account/sync`｜`/logout` | sync now; stop syncing |
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
