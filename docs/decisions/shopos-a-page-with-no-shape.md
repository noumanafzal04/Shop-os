# A page with no shape

*2026-09-18 — the partner app's first real design pass, and the four bugs it found*

The report was three words: **"UI bht bura hai."** No screen named, no
component. The useful thing about that kind of report is that it is about the
whole, and the whole is where the defects turned out to be.

---

## 1. The neutrals were built for a colour the app no longer wears

`tokens.ts` says out loud why the greys are warm:

> a cool blue-grey is the standard choice and the wrong one beside a
> red-orange… These carry a trace of the brand's own hue, so grey and brand
> belong to each other.

That was reasoned, and it was right — for `#E94E00`. Then the shopping side
became emerald and the greys did not move. Measured on the hue circle, which is
the instrument for "do these belong together" (a contrast ratio rates pink
against red at 1.04:1 and cannot answer it):

| neutral ↔ brand | degrees |
|---|---|
| warm grey ↔ `#E94E00` — the brand they were written for | **3.9** |
| warm grey ↔ `#EF4444` carmine | 24.0 |
| warm grey ↔ `#10B981` emerald | **136.1** |

136° is not "a slightly different grey", it is the accent's near-opposite: a
beige page under a cool green wordmark, which the eye reads as dirty. Same
defect as the button that drew `c.white` — a value correct for the palette it
was written against, left behind when the palette changed.

`themes.ts` now carries `emeraldGray` / `emeraldDarkGray`. **The lightness
ladder is copied step for step from the warm scale**, so nothing re-lays out and
every contrast relationship the screens were built on survives; only the hue
moves, and the saturation comes down because a cool grey shows its hue far
sooner than a warm one.

The comment that said *"Nothing else moves. The greys, the surfaces, the
borders… are shared"* was true while both badges were reds. It quietly became
false and stayed on the page describing a rule the code no longer kept.

### The guard could not have caught it, and now can

`riderTheme.test.tsx` asserted a LIST: exactly seven keys may differ between the
palettes. The greys were shared, so the list was satisfied. A list cannot
express the rule; hue distance can, and the new case fails at 136° and passes at
4°.

## 2. Nothing on the page had an edge — "pheeka"

The system is flat by choice: *"cards separate with borders and background
contrast, never shadows."* Measured, it was paying for neither.

| | before | after |
|---|---|---|
| white card off the page | **1.09:1** | 1.16:1 |
| border against the surface it outlines | **1.24:1** at `hairlineWidth` (≈⅓ px at 3×) | 1.35:1 at 1px |
| `textMuted` on the page | **2.35:1** — under every floor there is | 3.4:1 |

A third of a pixel at 1.24:1 is not a faint edge, it is no edge. With the ground
only 1.09 from the card fill, nothing on the screen had a shape.

`textMuted` failed in **both** palettes and was found by reading a screenshot,
not by a test — the sign-in screen's "Forgotten your password?" line is drawn in
it. The token was raised and the call site moved to `textSecondary`: text a
person must read does not belong in the faintest tier at all.

## 3. Five places drew the brand as TEXT, at 2.54:1

The palette states the rule itself — *"on the green side a brand-coloured MARK
takes `primaryPressed`, and `primary` is for FILLS"* — and nothing enforced it.
The two worst possible sites had it:

- the **selected tab label and icon**, the most-looked-at text in the app
- the dashboard's **urgent waiting count**, the one number that must be read

`primaryPressed` is 5.48:1 and is the same green to a reader. `houseRules` now
bans `color: c.primary` outright; a logotype is exempt under WCAG 1.4.3 and must
say `logotype` on the spot to claim it. Mutation-proven both ways.

The guard's first version used the suite's shared `codeOnly()`, which deletes
block comments outright — shifting every line number and silently eating the
opt-out marker. It reads raw source and skips prose line by line instead.

## 4. A chip bar 500 points tall

A horizontal `ScrollView` placed directly in a flex column takes the leftover
height, and its content container stretches every child to fill it. Three copies
of one bar existed:

| bar | what shipped |
|---|---|
| Orders stages | five pills the height of half the phone |
| Menu categories | pills taller than their strip, each **clipped in half** |
| Money periods | fine — purely because it sits inside another ScrollView |

One bug, three copies, broken on two screens and invisible on the third. Fixing
it three times is how it returns a fourth, so `ChipBar` now lives in core and
`flexGrow: 0` + `alignItems: "center"` are written once.

---

## The one that was not about colour at all

**The shop's owner got a two-tab app.**

`App\Models\User::hasPermission()` is explicit:

> Scope owners (super_admin, shop_owner) implicitly hold every permission in
> their scope; staff roles hold only what they were assigned.

So an owner's `permissions` column is legitimately `[]` and every server check
passes. Two places in the app asked `permissions.includes(p)` — `tabsFor` and
`authStore.can` — read the empty array, and hid **Orders, Menu and Money** from
the person who owns the shop. No error anywhere; an absent tab looks like a
product decision, which is the exact failure `tabsFor`'s own docblock was
written to prevent.

It survived 62 tests because every fixture handed over a permissions array.
`tabsFor.test.ts`'s bare fixture was *named* "Owner" and carried
`role: "shop_owner"` — **the test described the bug and called it the design.**

`common/permissions.ts` now mirrors the server in one function, and
`permissionsMirrorServer.test.ts` reads the role names out of the PHP rather
than remembering them. `role` is named in exactly one place in this app, as it
is on the server; every call site still asks about a permission, so the no-roles
architecture is intact.

---

## What was built once it could be seen

Running the app is what turned "the UI is bad" into six specific defects. It
also made the missing half obvious: there was no way to add anything. Seven
screen files were comment-only stubs — honest placeholders, not dead code, but
the empty state told a shopkeeper to go and find a computer.

- **A sidebar**, written rather than installed. `@react-navigation/drawer` needs
  gesture-handler *and* reanimated — two native modules and a real chance of a
  red box on a phone that works today, to avoid writing a Modal, an Animated
  value and a translate.
- **Add a product** — name, kind, category, description; price, **sale price**
  (the panel's word for `discount_price`), cost with the margin said out loud;
  sizes; stock with a low-stock alert; SKU and barcode; collections; one photo.
  Tax groups, pack sizes, scale codes and recipes stay on the panel, and the
  footer says so.
- **Categories** and **Collections**, with the difference stated: a category is
  what a thing IS, a collection is a shelf the shop arranges.
- **Opening hours**, "same every day" by default. Typing 09:00 and 22:00
  fourteen times is data entry, not configuration.

### Three rules the server owns and the app now reads

1. `tenant.item_types` decides which kinds may be catalogued — computed by the
   same function that validates the save. The panel once drew a Catalog for a
   salon and rejected every save; working the list out client-side is how that
   happens again.
2. `variants` is `prohibited` on a service and a deal; `track_inventory` on a
   service. The form hides what the save would refuse.
3. A blank `sku` is **omitted**, never sent as `""` — an empty string still has
   to pass a uniqueness rule, and the second product saved without one collides
   with the first.

The app adds one rule of its own, because the server has none: a **sale price at
or above the price blocks the save**. A crossed-out number that was never higher
is a lie, and this product has had to fix that shape once already.

---

## Two guards that were blind to their own subject

Both found only by mutation, both now fixed — the third and fourth time this has
happened here.

- **`screensAreReachable`** asked whether a navigator *mentions* a screen. An
  unused import satisfies it, so deleting a `<Stack.Screen>` kept it green. It
  checks the mount now, and knows all three shapes this app uses
  (`component={X}`, `screen: X`, `<X />`) — a guard that knows one reports the
  other two as orphans.
- **`drawerLinksGoSomewhere`** cut `MenuStackParamList` off at the first `};`,
  which is inside `ProductDetail: { id: string };`, and called a declared route
  undeclared.

The bug that guard exists for: the sidebar called `navigate("Menu", …)` from a
component that wraps the tab navigator, so `useNavigation` was the **root**
stack's. react-navigation's answer to an unknown route is to do nothing. Four
links, all dead, no error — found by pressing one on a phone.

---

## Counts

| | |
|---|---|
| partner tests | 76 (was 62) — 4 new guards, all mutation-proven |
| mobile tests | 846 (was 841) |
| typecheck / lint | clean, 0 errors |
| verified on device | Pixel 9 emulator, signed in against dev, product saved and read back through the API |

## Still owed

- `HANDOVER.md` entry for Phases 1–7 and for this block
- memory sync
- Editing an existing product still opens the read-only detail screen; the form
  creates only
- Collections cannot pick their products from the phone (`item_ids` is a desk
  job)
