# StreamHouse for Android (TV and phone)

A sideloadable app for Android TV, Google TV, Fire TV and Android phones —
installed from an APK the same way SmartTube is.

StreamHouse runs **inside the app**: the web interface, the add-ons and the
torrent engine, the same server a computer runs. A TV or phone with this app
needs no computer at all. Sign in under **Settings → Account** and it shares
your library, *Continue watching*, add-ons and stream settings with every other
device on the same account.

## Getting the APK

Every push to `main` that touches StreamHouse builds one in GitHub Actions and
attaches it to the rolling **`tv-latest`** pre-release. You do not need Android
Studio.

- **Releases page** → `tv-latest` → download `streamhouse-tv.apk`
- or the **Actions** tab → latest "Build Android APK" run → artifact

## Installing

- **On a TV, with Downloader** (the usual way, no computer needed) — install
  *Downloader by AFTVnews* from the Play Store, enter the direct URL of
  `streamhouse-tv.apk` from the release, and let it install. Android TV asks you to
  allow installs from Downloader once.
- **On a phone** — open that same link in the browser and open the download;
  Android asks you to allow installs from the browser once.
- **With adb**, if the device has developer options and (network) debugging on:

  ```bash
  adb connect <tv-ip>:5555     # a TV over the network; skip for a phone on USB
  adb install -r streamhouse-tv.apk
  ```

The app appears on the Android TV home row, or in the phone's app drawer.

## Updates

That install is the only one by hand. The app looks at `tv-latest` whenever it
comes to the front, at most every quarter of an hour. When a newer build is there
it offers it: **Update** downloads it and hands it to Android, which asks you to
confirm the install. The first time, it also asks you to allow installs from
StreamHouse. **Later** puts the offer off for a day. **Settings → TV → Check for
updates** (or **Menu → Check for updates**) looks right away and shows which
version is installed.

Your library, settings and downloads survive an update because every build is
signed with the same key. Android refuses an update signed with a different key
("App not installed"). A build made before the key existed has to be uninstalled
once before the first signed build will install. After that, installing
`streamhouse-tv.apk` with Downloader also updates in place, if the app itself
ever cannot.

### The signing key

The key is a PKCS#12 keystore with the alias `streamhouse`. It lives in two
repository secrets (**Settings → Secrets and variables → Actions**):

| Secret | |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the keystore, base64-encoded (`base64 -w0 streamhouse-release.p12`) |
| `ANDROID_KEYSTORE_PASSWORD` | its password, which is also the key's password |

Without them, a build on `main` fails rather than publish an APK that could not
update anyone's app. Other branches build with a throwaway key. Keep a copy of
the keystore somewhere safe: if it is lost, every device needs one uninstall
before a build signed with a new key will install.

Each build's `versionCode` is the minutes since 2020 when CI built it. Android
refuses to install a lower one, and that number only goes up, whatever happens
to the workflow. The `versionName` people see is `2.` and the run number. CI
publishes a `version.json` beside the APK with both and the APK's SHA-256. The
app compares the code with its own and checks the hash after downloading. A
build made on your own machine has no update URL, so it never offers updates.
The repository has to stay public, because the app downloads from it without
signing in.

## First run

The app starts StreamHouse on the device straight away. The very first start
unpacks it, which takes a little while on a TV; after that it is quick. Then go to
**Settings → Account** and sign in.

To use StreamHouse on a computer instead, press **Menu** on the remote (or
*Change where it runs* on the error screen) and pick the computer — found
automatically once *Allow other devices* is on in its Settings, or typed as
`192.168.1.34:11471`. **Use this device** on the same screen switches back.

Updating from the first version of the app, which always needed a computer: it
keeps using the computer it was connected to until you choose **Use this device**.

## How it is put together

| File | |
|---|---|
| `NodeEngine.kt` | unpacks StreamHouse, sets it up and starts Node.js; waits for it to answer |
| `src/main/cpp/native-lib.cpp` | starts Node inside the app and sends its console to logcat |
| `MainActivity.kt` | WebView shell, remote keys, the starting and error screens |
| `PlayerActivity.kt` | ExoPlayer playback, writes the resume position back |
| `VlcPlayerActivity.kt` | VLC, for the files ExoPlayer cannot play; its own remote controls |
| `TorrentStatus.kt` | what the torrent is doing while a player waits; the resume position |
| `SetupActivity.kt` | this device, or a computer — found on the network or typed in |
| `Discovery.kt` | UDP broadcast probe, answered by `server/discovery.js` |
| `WebBridge.kt` | what the web page may call on the device |
| `Updater.kt` | checks `tv-latest` for a newer build, downloads it, hands it to the installer |
| `src/node/webrtc-polyfill` | a stand-in that switches WebRTC off (see below) |

**Node.js** comes from [nodejs-mobile](https://github.com/nodejs-mobile/nodejs-mobile):
`libnode.so`, Node 18 built for Android. The build downloads it
(`fetchNodeMobile`), and packs `streamhouse/server`, `public` and `node_modules`
into `assets/nodejs-project.zip` (`packNodeProject`). On first run — and after every
update — the app unpacks that zip into its private storage and starts
`server/index.js` on `127.0.0.1:11471`, where only the app itself can reach it.

**The interface** is the StreamHouse web app in a WebView: ten-foot mode with D-pad
navigation on a TV, the touch layout on a phone.

**Playback** is native. When the page starts a film it calls
`window.StreamHouseTV.play(...)`, and the app opens ExoPlayer instead of a
`<video>` element. A WebView refuses most MKV, H.265 and AC3 files, which are
exactly what torrents contain; ExoPlayer plays them, streaming over HTTP byte
ranges so it works while the file is still downloading. When you leave the player
it posts your position back, and account sync carries it to your other devices.

While it waits for the torrent, the player says what the torrent is doing (peers,
speed, how much is here), and it keeps waiting for as long as three minutes
without a byte, since a thin swarm can be that slow to start. A file ExoPlayer
cannot read, or whose sound or picture the device cannot decode (an unusual MKV
or AVI, a DTS or TrueHD soundtrack), goes to **VLC** (libvlc, about 40 MB of the
APK), which carries on from the same point.

## What is different from a computer

- **No uTP or WebRTC peers.** Their native add-ons are built for desktops, so the APK
  leaves them out; WebTorrent uses ordinary TCP and UDP peers, which are most of any
  swarm. `webrtc-polyfill` is replaced by a stand-in that reports no WebRTC, so it
  switches off cleanly instead of failing to load.
- **StreamHouse runs while the app does.** Android stops apps in the background, so
  downloads pause when you leave the app and carry on when you come back.
- **Streamed films are cleared** half an hour after you stop watching, because TVs
  have little storage. Downloads you keep live in the app's own folder
  (`Android/data/com.streamhouse.tv/files/Downloads`) and are removed with the app.
- **It only listens to itself.** Other devices cannot open a phone's or TV's
  StreamHouse, and it does not answer discovery broadcasts, so it never shows up in
  another TV's list of computers.

To see what the server prints: `adb logcat -s StreamHouseNode`.

## Building it yourself

With the Android SDK installed:

```bash
cd streamhouse
npm ci --omit=dev          # the app ships these node_modules
cd android
./gradlew assembleRelease  # ARM only: app/build/outputs/apk/release/app-release.apk
./gradlew assembleDebug    # adds x86_64, for the emulator
```

## Requirements

Android 7.0 (API 24) or newer, on ARM — which covers Chromecast with Google TV,
Fire TV sticks, Nvidia Shield and current phones. nodejs-mobile's Node is built
for 4 KB memory pages, so the few recent phones that use 16 KB pages cannot run it.
