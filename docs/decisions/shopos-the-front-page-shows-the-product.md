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

`ProductShots` — one window, two tabs, real photographs:

| Tab | Picture |
|---|---|
| Dashboard | a working restaurant's dashboard: the status line, the four action tiles, today's sales / expenses / profit, the floor |
| Point of sale | the till with a sale half rung — five dishes in the cart, tax worked out, the total ready to take |

Below `sm` the same two screens are shown as a PHONE draws them. A
1600-wide screenshot in a 390-wide column is a smudge; a phone's own picture
is legible, and is the truth about how it is used there. The "owner's day"
section's phone carries the real phone dashboard too.

Files: `panel/public/landing/{dashboard,pos}.webp` (2560w),
`…-1280.webp`, `…-phone.webp` (804w). 42–118 KB each. WebP is not in the
service worker's precache pattern, so they add nothing to the installed app.

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
