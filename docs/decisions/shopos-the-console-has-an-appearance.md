# The console has an Appearance

**2026-10-10 · asked for by the owner**

> "Admin side ko primary rkho — sidebar or color theme — or khud b change kr sky."

Three days earlier the same person had said: *"Admin side par sidebar color
primary — admin ko humne appearance ka option nahi dia."* Both hold now: the
default is what it was, and it can be changed.

## What there was

A shop has had Appearance since the first week — its own colour, how far that
colour reaches into the page, and whether its menu is the brand colour, white,
tinted or dark. The platform console had none. It never called
`applyTenantTheme` at all: it was drawn from the sidebar's fallback and the
stylesheet's colours. Whoever ran the platform could dress every shop on it
and not their own screen.

## What there is

The same canvas, on the console: the tab on the right edge of every console
screen (desktop width). A choice is previewed on the real console behind it;
nothing is saved until Save; closing without saving puts back what was there.

## Decisions

**Whose look.** The PLATFORM's — one, saved once, worn by everybody on the
console, exactly as a shop's is worn by everybody who works there. Not a
person's. Light or dark is the personal one, and stays on the device (the
header toggle).

**Who holds the brush.** A super admin, and nobody else. Every platform role
may READ it (`GET /admin/appearance` — the screen has to be painted for the
person who schedules banner ads too); only `role:super_admin` may change it. No
permission grants that: there is no "may repaint the console" worth handing to
one member of staff and not another. For anybody else the launcher is not drawn
at all — a control whose Save can only be refused is worse than no control.

**Where it is kept.** `PlatformSettings`: `console_theme_primary` (null),
`console_theme_tint` (`subtle`), `console_theme_sidebar` (`primary`). The
defaults ARE the house look, so a console nobody has dressed looks exactly as
it always has.

**"No colour of its own" is the absence of one.** Reset removes the row
(`PlatformSettings::forget`) rather than storing today's house colour as though
somebody had chosen it — so a console that never chose follows the product when
the product's colour changes. (It also could not be stored: the column is
`json NOT NULL`.)

**Whoever sets a commission rate has not been handed the paintbrush.** The
commission screen saves platform settings through `PlatformSettings::rules()`.
The three theme keys are deliberately absent from those rules and have their
own (`appearanceRules()`); a test holds it.

**One canvas, two places a look is kept.** `ThemeCustomizer` read and wrote
`/shop/settings` directly. It is now `AppearanceCanvas`, which takes its look
from whoever mounts it (`AppearanceSource`): `ThemeCustomizer` (a shop — as it
was) and `ConsoleAppearance` (the platform). Not a second canvas.

**No flash on reload.** `rememberedTheme` already put a shop's colours on the
page before the first paint. The console's are remembered under the platform's
own name (`PLATFORM_LOOK = "platform"`, never mistakable for a tenant's UUID),
and platform roles are recognised at boot. One laptop used for the console in
the morning and a shop in the afternoon finds each its own look and never the
other's — though it remembers only the last one, so the first screen after
switching waits for its request.

**It is taken off on the way out.** The sign-in page and the front page are not
the console's to dress.

## Guards that spoke

`savesSayWhenTheyFail` and `mutationFeedback` both flagged the first version:
the canvas handled the failure, but the wrapper passed it along inside an
object (`mutate(look, on)`) where neither a reader nor the guard could see it.
Both halves of the outcome are spelled out where each request is made, and a
test holds that a refused save is said under the button.

## Not done

- The launcher is desktop-width only, as the shop's is (a thumb resting on the
  right edge of a tablet kept opening it).
- A per-person look. Nobody asked, and it would be a different thing.

## Tests

`TheConsoleHasAnAppearanceTest` (7; mutations 15/15),
`ConsoleAppearance.test.tsx` (10), `rememberedTheme.test.ts` (+2) — unit
mutations 13/13 — and `e2e/admin-appearance.spec.ts` (browser mutations 6/6),
which puts the console back in whatever look it had.
