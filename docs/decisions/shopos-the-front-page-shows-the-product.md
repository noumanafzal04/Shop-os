# The front page shows the product

**2026-10-06 · "acha screenshot leke achy data k sth landing page py add kro
k achi look and feel aye … 90% zoom py … jispe perfect aye uspe"**

## What it showed before

A DRAWING of the console — a rail, four tiles and a chart built out of divs
(`AppWindowMock`, `DashboardMock`), with a small drawn till over one corner.
Tidy, and not the product: when the real dashboard changed, the front page
went on advertising a screen nobody would find after signing up. It still
said "CartZe" in its rail.

## Now

`ProductShot` (`components/ProductShots.tsx`) is one picture: a window with
the real screen in it, leaning back a few degrees like a laptop's lid, and a
phone standing upright in front of it showing **the same screen**.

| Where | Picture |
|---|---|
| Hero | the dashboard, and only the dashboard — in the window and on the phone |
| "At the counter" (new section, after the offline argument) | the till with a sale half rung — on the screen and on a phone |
| "The owner's day" | the phone dashboard, large |

Below `sm` the window holds the screen as a PHONE draws it, and no second
phone is drawn. A 1600-wide screenshot in a 390-wide column is a smudge.

Files: `panel/public/landing/{dashboard,pos}.webp` (2560w),
`…-1280.webp`, `…-phone.webp` (804w). 42–120 KB each. WebP is not in the
service worker's precache pattern, so they add nothing to the installed app.

### What the owner sent back, the same evening

It took four rounds, and each one is in the shape of the thing now:

1. **"Hero section now not looks good, you not handle properly."** Two
   faults. The picture sat in a scroll-reveal that hides a block until a
   share of its own height is on screen; the block was 800px tall and began
   near the bottom of a laptop screen, so at **1366 × 768 it never showed** —
   the page opened on a headline, two buttons and an empty dark band. And the
   window had a 70px black bar of tabs across its top and a hard bottom edge
   through the middle of a panel. → What is above the fold is not
   scroll-revealed. The window's bar is thin, and it fades out over its last
   seventh (no more: the till's total sits low on the screen).
2. **"POS ke sath POS mobile ki lagao."** The phone first carried the OTHER
   screen, on the theory that two screens say more than one. The same screen
   at two sizes is the better picture: it is the claim itself.
3. **"Top banner ko thora tilt … jaise laptop hota."** `perspective` on the
   parent, `rotateX(11deg)` on the window, hinged at its bottom edge. The
   phone stays upright, which is what puts it in front. A pointer resting on
   the window brings it nearly upright (not when reduced motion is asked for).
4. **"Hero main dashboard ki hi lagayen gy image."** The two tabs are gone.
   The first thing after the headline was a choice, and whichever screen was
   not chosen was never seen. The till has a section of its own.

## How they were taken

`panel/scripts/landing-shots.mjs`, signed in as the shop to photograph.
1600 × 1000 at 2× — what a 1440-wide screen shows at 90% zoom, which is the
size the owner asked for and the one where the whole first screen fits.

The shop is the load-test restaurant (`restaurant@loadtest.test`). At the
owner's word, through the app's own API and screens, three things were
changed IN THE SHOP, and they stay changed:

- its name: "Karahi House" → **"Zaiqa Grill House"**;
- the owner account's display name: "Karahi House Owner" → "Ahmed Raza";
- nine ordinary expenses across the week (packaging, petrol, wages, a
  repair, the electricity bill, the internet line).

Two things are done to the PAGE at the moment of the picture, and nothing to
the shop: the appearance handle on the right edge is hidden, and the
load-test serial on a dish's name ("Chicken Karahi Half #1") is taken off
the words on screen.

## A thing the picture found

Today's sales read **"+4240.3%"** against yesterday (Rs 668 → Rs 28,992).
True, and unreadable. `formatDelta` now says a rise past tenfold as a
multiple — "43×" — and drops the tenth of a percent once a change is in the
hundreds.

## To keep them true

They are files. When the dashboard or the till changes shape, retake them.
Nothing fails if nobody does — which is the cost of a photograph over a
drawing, and still the better trade: a stale photograph is a real screen
that has since improved; a stale drawing was never a screen at all.
