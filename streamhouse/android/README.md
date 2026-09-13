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

## Keeping it up to date

Only the first install is by hand. After that the app updates itself: on every
start it asks your StreamHouse server whether a newer build has been published,
and offers it.

- **Update now** downloads the APK and hands it to Android, which asks you to
  confirm. The first time, Android TV will want the app allowed to install other
  apps — it opens that setting for you; say yes and choose Update again.
- **Not now** keeps quiet about that particular build until the next one.

The download comes through your own StreamHouse server rather than straight from
GitHub, so the TV needs nothing but the local network — which also spares older
TV boxes a TLS handshake they often cannot manage. If the server is offline or
GitHub is unreachable, the check fails quietly and the app carries on.

**Most changes need no update at all.** The app is a shell around the web
interface it loads from your computer, so anything that changes in StreamHouse
itself arrives the moment you update the server. Only changes inside this folder
— the player, the remote handling, the updater — need a new APK.

Each CI build is stamped with the run number as its version code, which is what
an installed copy compares itself against. A locally built APK stays at version
1 so it never pretends to be newer than a release.

Point the check somewhere else — your own fork's release — with
**tvReleaseApi** in the server's `config.json`.

### The signing key (do this once)

Android installs an update only over an app signed with the same key. Without a
key of its own the build falls back to Android's debug key, which is generated
per machine — so two CI builds cannot replace each other and every update ends
in *App not installed*. One key, added once as a repository secret, fixes that
for good.

Make the key on your own computer — it should never be in the repository, which
is public:

```bash
keytool -genkeypair -v \
  -keystore streamhouse.jks \
  -alias streamhouse \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -storepass '<a password you choose>' \
  -keypass  '<the same password>' \
  -dname 'CN=StreamHouse TV, O=StreamHouse'
```

Then hand it to GitHub Actions (`gh auth login` first if needed):

```bash
base64 -w0 streamhouse.jks | gh secret set ANDROID_KEYSTORE_BASE64
gh secret set ANDROID_KEYSTORE_PASSWORD --body '<the same password>'
```

On macOS, `base64 -w0` is `base64 -i streamhouse.jks | tr -d '\n'`.

**Keep `streamhouse.jks` and its password somewhere safe** — a password manager,
a backup drive. A secret cannot be read back out of GitHub, and losing the key
means every TV has to uninstall and reinstall before it can update again.

Two other secrets are read if you set them: `ANDROID_KEY_ALIAS` (default
`streamhouse`) and `ANDROID_KEY_PASSWORD` (defaults to the store password), so
the two above are enough if you follow the commands as written.

The build after that is the first one signed with your key. Because whatever is
on the TV now is signed with a throwaway one, that build is the last that has to
go on by hand: uninstall StreamHouse on the TV, install the new APK, and updates
from then on install themselves.

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
