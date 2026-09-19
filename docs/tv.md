# Getting KidPC onto a TV

There is no app-store listing yet, so today there are three routes, in
increasing order of effort. Start at the top — you can be looking at KidPC on
your own TV in about five minutes.

---

## 0. First, decide which half you are testing

Two different things live behind one URL, and only one of them can be tested
against production.

**The activities and the marketing site** are public. `https://kidspc.online/try`
plays all eleven with no account at all, which makes it the two-minute test:
open it on the TV and you are looking at the real thing on the real hardware.

**The household** — profiles, the PIN pad, daily limits, curfews, the launcher
— needs a child profile, and a child profile needs verified parental consent.
Production has no consent verifier configured and `config.ts` refuses to run
the mock one there, so **no child can be created on kidspc.online**. Testing
that half means running the dev stack on your own machine, which is route 1.

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

Seed a household first, in a second terminal — `pnpm dev:tv` already runs both
the API and the client — so there is something to sign in to. It prints the
email, the password and each child's PIN:

```bash
pnpm demo
```

Development runs `CONSENT_VERIFIER=mock`, which is what lets you create a child
and reach the launcher. The code it asks for is shown on screen.

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

## Text size

Detected, not chosen. The stylesheet asks for `pointer: none` -- a set driven
by a D-pad reports no pointing device at all, which no laptop or phone does --
and those sets get the across-the-room scale: base font from 16px up to 40px,
sized in `vw` rather than pixels, because the same 43-inch panel may report
itself as 1920, 1280 or 960 CSS pixels wide and a fixed size would be a
different physical size on each.

A set whose remote *emulates* a mouse reports a pointer and is, to a media
query, a laptop. It gets the laptop scale, which lands at about 22px on a
1080p panel. There was briefly a manual "Bigger" switch for those; it has been
removed. What it produced was legible and ugly -- 40px type and 140px buttons
on a screen that was never designed around them -- and the better answer for
a set that far away is the next section.

If a particular set still reads small, every TV browser supports zoom from a
connected keyboard (Ctrl and `+`), which scales the whole page proportionally
rather than inflating one axis of the design.

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
| **Memory Match** | ✅ | — |
| **Spell It** | ✅ | — |
| **Times Tables** | ✅ | — |
| **Know India** | ✅ | — |
| **Piano** | ✅ | — |
| **Typing Garden** | ❌ | keyboard (it is a typing game) |
| **Story Writer** | ❌ | keyboard |
| **Code Playground** | ❌ | keyboard |
| **Paint** | ❌ | a pointer — Bluetooth mouse, or LG's Magic Remote |

Seven of eleven, and the four that are not are the three that are *about* a
keyboard plus the one that is about drawing. That ratio is why the five
activities added for the youngest band were all built as grids of buttons.

Piano was on the wrong side of that line until recently and nobody had noticed:
its keys responded to `pointerdown` and nothing else, so a child could navigate
to a key with the remote, press OK, and hear silence -- on the one activity
whose entire point is that pressing a key makes a noise.

## A Bluetooth keyboard and mouse

This is the setup the product is now built around, and it is worth doing: it
turns the television into a computer, which is what the child is here to learn
to use.

Pairing is the TV's job, not ours, and every platform has it in the same place:

| Platform | Where |
|---|---|
| **Android TV / Google TV** | Settings → Remotes & Accessories → Pair accessory |
| **Samsung Tizen** | Settings → General → External Device Manager → Input Device Manager → Bluetooth Device List |
| **LG webOS** | Settings → General → External Devices → Bluetooth Controller |
| **Fire TV** | Settings → Controllers & Bluetooth Devices → Other Bluetooth Devices |

Put the keyboard or mouse in pairing mode first (usually a long press on a
dedicated button until its light flashes). Most sets remember it afterwards and
reconnect on their own.

What the app then does with it:

- **It notices.** `apps/web/src/input.ts` watches the events that arrive rather
  than asking a media query, because `pointer: none` is a claim the browser
  makes at page load and a mouse paired half an hour later never changes it.
  Two facts land on the document element: `data-input` (`key` or `pointer`,
  flipping both ways) and `data-keyboard` (`yes`, once, permanently).
- **The focus ring gets out of the way.** With a cursor on screen the loud
  ten-foot ring is a rectangle stuck to whatever was last clicked, so it drops
  to an ordinary one. Press an arrow key and the loud one comes back.
- **Shortcuts appear.** Number keys `1`–`4` answer Number Ninja, Times Tables
  and Know India. Letters type words directly in Spell It. `G`, `L`, `R` add
  blocks in Block Puzzles, `Enter` runs the programme, `U` undoes, `C` clears.
  `A`–`K` and `W`–`U` play the piano's white and black keys. Each control
  prints the key on itself -- but only after a keyboard has been used, because
  a number on a button is clutter to a household holding only a remote.
- **The sign-in and reset forms stop fighting the device**: no autocapitalise
  on an address, a Show button on every password field, and `Enter` submits.

A mouse also makes **Paint** work, which a bare D-pad cannot do at all.

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
