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

## The night the owner read the page down (2026-10-13)

*"hero section pe blue background type aa raha — apne primary color se change
kar dein"*, *"Nine trades … ispe jo mobile khud bana rahe wo acha ni lga"*,
*"salon ni, services hain"*, *"ek symmetry chahiye landing page ki"*, *"real
plans … aur jo jo offer kar rahe wo bhi list"*, *"dashboard ka updated
screenshot, full menu ke saath"*.

- **The dark bands are the brand's own night.** The hero, the till's section
  and the closing band stood on gray-950 under an indigo light
  (`rgba(70,95,255)`) — the colour of a brand this product no longer has.
  `.landing-night` / `.landing-night-light` in `index.css` read the ground and
  the light from the brand ramp; the footer stands on the same ground. The
  hero's two lights were in opposite corners under a centred headline; both
  are on the centre line now.
- **One form of heading.** A heading over a full-width row is centred; a
  heading beside a picture keeps the left. "Why it is different" and "What is
  inside" hung off the left edge above three equal columns — that was the
  empty space under the hero. The three steps are centred under their
  centred heading, with the rule running from number to number.
- **Nine trades is nine tiles** — one row on a laptop, three by three on a
  phone — over one card of two halves. The pills wrapped seven and two.
- **The drawn till is gone** (`TillMock.tsx`). Each trade shows the phone
  screen of a real shop of that trade, with a sale half rung:
  `public/landing/trade-<code>.webp`, taken from the nine load-test shops by
  `TRADE=<code> node scripts/landing-shots.mjs`. A finance office has no
  till; its picture is its books. `tradeCarts.ts` keeps what each picture
  shows, in words, for whoever cannot see it.
- **Services, not "Salon & services"** — on the tile, the footer, the enquiry
  form and the demo chooser.
- **The plans are the product's.** Three hand-written cards (2,500 / 6,000 /
  15,000, "Up to 2 tills" on a plan that allows one) became `PlanSeeder`'s
  four, with every line on a card written from the figures
  (`modules/landing/plans.ts`). What a plan lacks is said and marked, not left
  out: Basic does not sell offline. Modules are listed once under all four —
  a plan sells room, never a feature. `plans.test.ts` reads the seeder as
  text where the backend sits beside the panel; four faults put in, four
  caught. A price changed in the admin console on a live box does not reach
  this page by itself.
- **The dashboard was retaken with the full menu**, on an evening the shop
  had actually traded: fourteen sales rung through its own till and three
  expenses recorded, through the app. The hero's phone was left as it was, at
  the owner's word — so the two pictures in the hero show different days.
- **The hour on the wall.** The sales were rung at two in the morning, which
  belongs to the evening before (the day turns at five): the dashboard said
  "Good morning, Tuesday" over a "Today" that was Monday's. `CLOCK=` gives
  the page an evening hour of the shop's own day. Nothing sent to the server
  changes.

**A mistake made and undone while doing it.** Moving that night's three
expenses onto the shop's day, a fourth of the same name — "Takeaway boxes and
bags", Rs 2,450, written on the 6th — went with them. Expenses leave no audit
row, so its day was worked out from the old picture: Rs 4,250 on the 6th is
1,800 + 2,450. It is back on the 6th. A fixture is found by its id, not by
what it is called.

**Entries made in the two shops, and left:** in Zaiqa Grill House, fourteen
sales and three expenses on 12 Oct (and a category, "Kitchen gas"); in Rehman
Books & Accounts, five fees between 3 and 11 Oct under a new category,
"Client fees".

## To keep them true

They are files. When the dashboard or the till changes shape, retake them.
Nothing fails if nobody does — which is the cost of a photograph over a
drawing, and still the better trade: a stale photograph is a real screen
that has since improved; a stale drawing was never a screen at all.
