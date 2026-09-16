# Open decisions

Four. Three of them block a phase, and each one is written with what it
costs rather than as a preference.

---

## 1 · Firebase — blocks push (Phase 5)

**The server half is already built.** `DeviceToken`, `POST /devices`,
`FcmSender`, `SendChannelNotification`, and `order.placed` already fires
into it from `OrderService`.

**The app half does not exist, in either app:**

| | state |
|---|---|
| `@react-native-firebase/app` + `/messaging` | not a dependency |
| `android/app/google-services.json` | **missing** |

Without a Firebase project and that file, push cannot be turned on — and
"a sound when an order arrives" is the reason a shop keeps this app open.
A partner app that has to be pulled-to-refresh is a partner app nobody
opens.

**Needed:** a Firebase project, and `google-services.json`. The same file
fixes push in the customer app, where it is also dead today.

---

## 2 · Printing a slip — blocks Phase 5

The panel prints through the browser's own dialog, and kicks the cash
drawer over Web Serial (`panel/src/common/escpos.ts`). Neither exists on
a phone.

| | how | cost | kitchen slip |
|---|---|---|---|
| **A · Bluetooth thermal** | a native ESC/POS module talks to the shop's 58/80mm printer | highest — every printer model is its own test | yes, direct |
| **B · Android print / PDF** | the server returns the slip, the app hands it to the system print service | lowest | yes, via a WiFi/USB printer |
| **C · Share only** | render a PDF, share it to WhatsApp or anywhere | lowest | weak — no printer |

**Recommendation: B for v1, A in v2.** B is a day's work and needs no
hardware to test; A is what makes it feel like a real partner app and
cannot be finished without a drawer full of printers.

---

## 3 · Package id and keystore — blocks any release

A second app is a second Play Store listing: its own `applicationId`,
its own signing key, its own listing.

- Proposed id: **deferred** — the user intends to change the name once a
  domain is bought, and an `applicationId` can NEVER change after the
  first upload. Nothing should be published under a placeholder.
- The customer app is still on `signingConfigs.debug` and has no upload
  keystore either. Both apps need one before either can ship.

The display name is **CartZe Partner** and that is only a label — it can
change at any time.

---

## 4 · Does Partner get its own colour?

The app already has two palettes, and `ThemeProvider` decides which side
wears which in one line: shopping is **leaf green**, working is **ember
orange**.

Three readings, and this is a decision rather than a default:

- **Ember** — it is the "working" palette and a shopkeeper is working.
  Costs nothing; but then the rider app and the partner app look alike.
- **Leaf** — one brand, one colour, and Partner is CartZe to a shopkeeper
  too. Costs the distinction between shopping and working.
- **A third scale** — clearest, and a third palette to keep in step. The
  file that defines them warns about exactly that: a second full design
  is a second thing that drifts.

Not blocking: Phase 1 can render in leaf and change later, because every
screen reads `useColors()` and nothing hard-codes a hex.
