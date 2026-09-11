# PC Remote

Turns your phone into a remote for this computer: trackpad, keyboard, media
keys, power — and a bedtime timer that shuts the machine down after you fall
asleep.

No app to install on the phone. It opens in the phone's browser.

## Run it

```bash
cd pcremote
npm install
npm start
```

The console prints the address and a **pairing PIN**:

```
  PC Remote is running

  On your phone   http://192.168.1.34:11480

  Pairing PIN     418302

  Controlling     Windows (DESKTOP-7F2A)
```

Open that address on your phone, tap in the PIN once, and the phone is paired
until you unpair it. Add it to your home screen and it behaves like an app.

## What it does

| | |
|---|---|
| **Touchpad** | drag to move, tap to click, two fingers to scroll, two-finger tap for right click, hold to drag |
| **Keys** | type into whatever has focus, plus Enter/Esc/Tab/arrows and copy, paste, undo, alt-tab |
| **Media** | play, pause, next, previous, volume, mute |
| **Bedtime** | shut down / sleep / lock / pause playback after a set time |
| **Power** | shut down, restart, sleep, lock, sign out — each asks first |

### The bedtime timer

Pick what should happen and when — 15, 30, 45, 60, 90, 120 minutes or your own
number — and the countdown starts. **It runs on the computer, not the phone**,
so it still fires with your phone asleep, locked, on charge in another room, or
off the network entirely. While it runs, every screen shows a banner with the
time left, `+10 min`, and Cancel.

*Pause playback* is the gentle option: the film stops, the computer stays on.

## Security

This can shut your machine down and type into whatever window has focus, so it
is not left open on the network:

- A six-digit **PIN** is generated on first run and printed to the console.
- Pairing exchanges it for a token; every other request needs that token.
- Five wrong PINs locks that phone out for a minute.
- PIN and tokens are compared in constant time, and stored `0600` in
  `~/.pcremote/config.json`.
- Power actions must be confirmed explicitly by the phone.

Anyone on your network who knows the PIN can control this computer. On a shared
or public network, don't run it. `⚙ → Unpair` drops every paired device;
deleting `~/.pcremote/config.json` regenerates the PIN.

## Per-platform notes

| | Pointer | Keys, media, power | Needs |
|---|---|---|---|
| **Windows** | ✅ | ✅ | nothing — PowerShell is built in |
| **Linux (X11)** | ✅ | ✅ | `sudo apt install xdotool` |
| **Linux (Wayland)** | ⚠️ | ⚠️ | `ydotool` and its daemon; Wayland blocks X11-style input |
| **macOS** | needs `cliclick` | ✅ | `brew install cliclick` for the pointer; Accessibility permission for everything |

On macOS, tick your terminal in **System Settings → Privacy & Security →
Accessibility**, or synthetic input is silently ignored. Play/next/previous
there drive Spotify or Music.

On Windows, *Sleep* hibernates instead if hibernation is enabled.

## Keeping it running

**Windows** — put a shortcut to `start-remote.cmd` in your Startup folder
(`Win+R` → `shell:startup`):

```bat
@echo off
cd /d "%~dp0"
start "" /min cmd /c "npm start"
```

**macOS / Linux** — a `launchd` plist or systemd user unit:

```ini
[Unit]
Description=PC Remote
[Service]
ExecStart=/usr/bin/node %h/website_House_of_Wellness/pcremote/server/index.js
Restart=always
[Install]
WantedBy=default.target
```

`systemctl --user enable --now pcremote`

## Settings

`~/.pcremote/config.json`: `pointerSpeed` (default 1.6), `naturalScroll`,
`port`, `host`, `defaultTimerMinutes`, `defaultTimerAction`.

## Tests

```bash
npm start          # in one terminal
TEST_PIN=<pin> npm test
```

Input is verified for real on Linux against a virtual X display — the pointer is
moved and its coordinates read back. Windows and macOS backends run in dry-run
mode, asserting the exact commands they would issue.
