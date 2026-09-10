# StreamHouse TV (Android TV app)

A sideloadable Android TV app for StreamHouse — installed from an APK the same
way SmartTube is.

## Getting the APK

Every push that touches this folder builds one in GitHub Actions and attaches it
to the rolling **`tv-latest`** pre-release. You do not need Android Studio.

- **Releases page** → `tv-latest` → download `streamhouse-tv.apk`
- or the **Actions** tab → latest "Build Android TV APK" run → artifact

To build locally instead, with the Android SDK installed:

```bash
cd streamhouse/android
./gradlew assembleRelease
# app/build/outputs/apk/release/app-release.apk
```

## Installing on the TV

**With Downloader** (the usual way, no computer needed) — install *Downloader by
AFTVnews* from the Play Store, enter the direct URL of `streamhouse-tv.apk` from
the release, and let it install. Android TV will ask you to allow installs from
Downloader once.

**With adb**, if the TV has developer options and network debugging on:

```bash
adb connect <tv-ip>:5555
adb install -r streamhouse-tv.apk
```

The app then appears on the Android TV home row with the other apps.

## First run

1. Start StreamHouse on your computer and turn on **Settings → TV → Allow other
   devices**.
2. Open the app. It broadcasts on the local network and lists whatever computers
   answer — press OK on yours.
3. If nothing is found (some routers block broadcast between Wi-Fi and Ethernet),
   type the address StreamHouse Settings shows, e.g. `192.168.1.34:11471`.

The choice is remembered. Press **Menu** on the remote at any time to switch to a
different computer.

## How it is put together

The app is a shell around the StreamHouse web interface, which already has a
ten-foot layout and D-pad navigation — so the TV and a browser stay in step
automatically, with no second UI to maintain.

The one thing it does natively is **play video**. When the web page starts
playback it calls `window.StreamHouseTV.play(...)`, and the app opens ExoPlayer
instead of a `<video>` element. That matters: a WebView refuses most MKV, H.265
and AC3 files, and those are exactly what torrents contain. ExoPlayer plays them,
streaming over HTTP byte ranges so it works while the file is still downloading.
When you leave the player it posts your position back, so *Continue watching*
keeps working across the TV and every other device.

| File | |
|---|---|
| `MainActivity.kt` | WebView shell, remote keys, error screen |
| `PlayerActivity.kt` | ExoPlayer playback, writes the resume position back |
| `SetupActivity.kt` | finds the server, or takes a typed address |
| `Discovery.kt` | UDP broadcast probe, answered by `server/discovery.js` |
| `WebBridge.kt` | what the web page may call on the TV |

## Requirements

Android 5.0 (API 21) or newer, which covers every Android TV device still in use.
