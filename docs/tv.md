# Getting KidPC onto a TV

There is no app-store listing yet, so today there are three routes, in
increasing order of effort. Start at the top — you can be looking at KidPC on
your own TV in about five minutes.

---

## 1. Tonight, on your own TV, over your Wi-Fi

The dev server binds to localhost by default. One script opens it to the
local network:

```bash
pnpm dev:tv        # same as pnpm dev, but the client binds every interface
```

Vite prints the address to type into the TV:

```
➜  Local:   http://localhost:5173/
➜  Network: http://192.168.68.111:5173/     ← this one
```

Open that on the TV (see the browser table below). Nothing else changes: the
API stays on localhost and the client proxies to it, so the refresh cookie
behaves exactly as it will in production behind one edge.

Two things to know:

- **It is opt-in for a reason.** A dev server bound to `0.0.0.0` is also a dev
  server on café Wi-Fi, serving an app that mints session tokens. `pnpm dev`
  stays on localhost.
- **Plain HTTP is fine here and only here.** The refresh cookie is marked
  `Secure` only in production (`services/api/src/routes/parent.ts`), so LAN
  testing works without certificates. In production the config *refuses* to
  start against a plaintext origin.

## 2. The TV's own browser

This is the whole install, on any TV that has a browser: open the URL, then
add it to the home screen. The web manifest gives it a name, an icon and a
full-screen window, so it opens like an app rather than a web page.

| Platform | Browser | Notes |
|---|---|---|
| **Amazon Fire TV** (Stick, Stick Lite, Cube) | **Silk Browser** — free in the Appstore | The easy one. Cheapest device that works well in India. |
| **Samsung, Tizen** | **Internet** — preinstalled on most models | Some 2023+ models shipped without it; check the app list first. |
| **LG, webOS** | **Web Browser** — preinstalled | The Magic Remote is a real pointer, so Paint works with no extra hardware. |
| **Android TV / Google TV** — Mi Box, Chromecast with Google TV, most Xiaomi / OnePlus / Realme / TCL sets | **None.** No browser ships, and Chrome cannot be installed from the TV Play Store. | Sideload a browser (TV Bro is open source) or ship the APK — route 3. |

That last row matters more than it looks: **Android TV is the most common
smart-TV platform in India and the only one of the four with no way to open a
URL out of the box.** Any real launch needs route 3.

## 3. An Android TV APK

The real distribution path. The manifest is already the source of truth for the
app's name and icon, so Bubblewrap can generate the wrapper:

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://kidspc.online/manifest.webmanifest
bubblewrap build          # produces app-release-signed.apk
```

Then three edits Bubblewrap will not make for you.

**Use the WebView fallback.** A Trusted Web Activity renders through Chrome's
Custom Tabs — and Android TV devices generally have no Chrome. Without this the
app has nothing to render in. In `twa-manifest.json`:

```json
"fallbackType": "webview"
```

**Declare it as a TV app.** In `app/src/main/AndroidManifest.xml`, otherwise it
installs but never appears on the TV home row:

```xml
<uses-feature android:name="android.software.leanback" android:required="false" />
<uses-feature android:name="android.hardware.touchscreen" android:required="false" />

<application android:banner="@drawable/banner">   <!-- 320×180 -->
  <activity …>
    <intent-filter>
      <action android:name="android.intent.action.MAIN" />
      <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
    </intent-filter>
```

`touchscreen required="false"` is not cosmetic — the Play Store hides apps that
require a touchscreen from every TV device.

**Prove we own the domain**, or the app opens with a browser URL bar across the
top. `bubblewrap fingerprint` prints the signing key's SHA-256; put the file it
generates at:

```
apps/web/public/.well-known/assetlinks.json
```

Vite copies `public/` verbatim into the build, and Caddy serves that build from
`/srv`, so it deploys with the client and needs no edge configuration. It is
deliberately not committed as a placeholder: an `assetlinks.json` with the wrong
fingerprint fails exactly like a missing one, but looks configured.

To sideload during development:

```bash
# TV: Settings → Device Preferences → About → tap "Build" 7× → Developer options → ADB debugging
adb connect 192.168.x.x:5555
adb install app-release-signed.apk
```

---

## What the remote can actually do

The child's daily path — pick a profile, enter the PIN, choose an activity — is
**entirely remote-driven**. The PIN pad is a grid of buttons, not a text field,
and arrow keys navigate by geometry rather than DOM order
(`apps/web/src/tv.ts`), so a grid behaves like a grid.

The activities differ, and it is worth knowing which before you hand a child a
bare remote:

| Activity | Remote alone | Needs |
|---|---|---|
| **Number Ninja** | ✅ | — |
| **Block Puzzles** | ✅ | — |
| **Typing Garden** | ❌ | keyboard (it is a typing game) |
| **Story Writer** | ❌ | keyboard |
| **Code Playground** | ❌ | keyboard |
| **Paint** | ❌ | a pointer — Bluetooth mouse, or LG's Magic Remote |

A Bluetooth keyboard and mouse pair to all four platforms through the TV's own
settings, which is the setup the product assumes.

**The one genuinely painful step is the parent's first sign-in**: an email
address and a ten-character password, typed on an on-screen keyboard. It happens
once per device — after that the refresh cookie carries the session and the child
only ever types four digits. Sign-in is also why the password hint on that screen
says *"length beats punctuation"*: a long lowercase passphrase is dramatically
faster on a D-pad than a short one with symbols in it.

The obvious fix is a pairing code — the TV shows six characters, the parent
enters them on their phone — which is how every streaming app solves this. It is
not built.

## Not built yet

- **Pairing-code sign-in.** See above.
- **A published APK.** Route 3 is verified as a procedure, not as a shipped
  artifact; no APK has been built or signed.
- **The Android TV banner image.** 320×180, needed before the Play Store will
  accept a TV app.
- **Play Families policy review.** An app aimed at children under 13 goes
  through additional review, and it will ask how parental consent is obtained —
  which is the same blocker as everywhere else in this repo. See
  [deploy.md](deploy.md).
