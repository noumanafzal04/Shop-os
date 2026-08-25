# A dark shop, one lit counter

**2026-08-25 · panel**

## "Bohot basic"

The first landing page was a white page with a headline, three cards, eight
trade icons and a price table. Everything on it was true and none of it was
evidence. It stated that the till keeps selling; it stated that the product
knows eight trades. **Every competitor's page states both.**

## The top of the page is dark because the argument is

The pitch is a shop whose power and internet have gone and whose counter has
not. So the fold is a dark room with one lit thing in it — the till, still
ringing, glowing on near-black.

That is the only reason for the colour. A dark hero for the look of it is a
fashion; this one is the claim, drawn.

The header goes with it: over the dark band it borrows light text in **both**
themes, because grey-600 links on near-black is a header nobody can read, and
the band is dark whichever theme the visitor is in. Once it has scrolled off
the band it is an ordinary themed bar again.

## Claim, then evidence

The eight-icon grid is gone. In its place the visitor **picks a trade and
watches the till change** — the items, the units and the one line only that
trade needs: a batch number and an expiry for the pharmacy, a meter roll for
the pump, a KOT for the restaurant, an hour for the salon.

Whoever has never stood behind a counter cannot fake the units, so the units
are the argument. It costs one tap to check.

`tradeCarts.ts` holds all of it — the label, the cart, the note and what the
product does there — because a trade split across two files is how a pharmacy's
cart ends up under a tyre shop's heading. The footer's trade column is
generated from the same record, so a ninth trade appears there without anybody
remembering.

## The hero shows the whole system, not one card of it

The first version of this redesign put a **till** in the fold. It made the
offline argument well and it made the product look like a cash register — and
the person reading this page is buying a business system, so the fold now shows
the business system: the rail down the side with everything on it, the shop's
name at the top, the day counted, and one warning.

**The type inside it runs about a third larger than the real app's.** That is
the whole trick and it is deliberate. Put a 1440px console into an 1150px frame
and 13px labels become 10px smudges; the picture then says "some software" and
nothing else. The *layout* is the app's exactly — same rail, same header, same
tiles — and nothing is invented to make it fit.

The till is still there, small, over the console's **left** edge. Two pictures,
one claim each: this is the whole system, and the counter inside it goes on
selling with the line down. Left, because it is the only corner with nothing
under it — the rail runs out after six rows. Sat on the right it covered the
takings list and the warning, which reads as a card dropped on the screen
rather than as a second window.

On a phone the rail is **hidden, not shrunk**: a 224px sidebar on a 390px
screen leaves the content 160px wide, which is not a smaller picture of the app
but an unreadable one.

## The dashboard is drawn, not screenshotted

A real capture is a wall of six-point text at hero size, needs a second copy for
dark mode, and becomes a lie the first time a button moves. **A landing page
showing a screen the product no longer has is worse than one showing no
screen.** What is drawn is true of the product and will stay true: takings by
hour, what is owed, what is running out, what sold.

And the strongest screenshot is not a screenshot — the demo is one tap away and
can be checked.

## Two bugs the browser found that no test could

- **The chart had no bars.** `items-end` on the row stopped the columns
  stretching to the 9rem, so each shrank to the height of its own hour label,
  and every bar — sized as a percentage of a parent that was now zero tall —
  computed to nothing. Twelve numbers under an empty box. jsdom has no layout
  engine and would never have seen it.
- **The page scrolled sideways by 20px on a phone.** The soft light behind the
  till reaches 40px past the card; on a narrow screen that light widened the
  document. A decorative glow must never widen the page, so the band clips it.

- **The phone frame laid itself out as a desktop.** The owner's-day section
  puts `DashboardMock` inside a 340px phone on a 1440px page, and the comment
  written above it claimed the component "is responsive, so a 340px column is
  simply its small layout". **That was false.** A Tailwind breakpoint asks the
  viewport, never the box the component is standing in, so it took the
  four-across layout inside the phone and clipped its own headline figure to
  "Rs 146…". It lays out by `@container` now, with the narrow layout as the
  base so the fallback is the one that fits anywhere.

Both were found by measuring, not by looking: a Playwright pass that records
`scrollWidth - clientWidth` at four viewports and reads the computed height of
the first bar.

## And one measurement that lied

The admin screen came back 404 in the browser. The route was correct; **the
preview server was serving a build made before the route existed.** The fix was
a rebuild, and the lesson is the one already written down — a plausible-looking
result from a tool that never saw the change.

## Length and content

Nine bands now: hero, the offline story as a numbered sequence (it *is* a
sequence — the line drops, the queue moves, the line comes back), the trade
switcher, the owner's day, twelve things that are in the box, how it starts,
pricing, eight questions including the awkward ones, and the enquiry form.

**No customer numbers, no logos nobody agreed to, no invented testimonials.**
Everything asserted is either true of the software today or is a price. The FAQ
says plainly that no card payments are processed — the honest answer to the
question a shopkeeper will ask anyway.

One caveat is stated on the page rather than buried: for the till to keep
working with no line at all it must be installed on the device first, and a
browser will only install it over a secure address.

---

## The top of the page, three times wrong

**A white line across the fold.** The hero slides up under a transparent header
so the band's gradient and grid run behind the links. That was done with
`-mt-[62px]` — the header's height, measured once by hand. The nav grew a pill,
the header became **79px**, and a strip of the white page showed above the dark
hero and cut a line straight across the design.

**Wrapping them in one dark box fixed the line and broke the header.**
`position: sticky` holds an element inside its own parent, so past the hero the
header scrolled away with the box. Measured, not assumed: at 2400px down its top
was **-1010px**. A fix nobody had checked below the fold.

**What it is now:** the header measures itself with a `ResizeObserver` and
publishes `--landing-header`; the hero pulls up by exactly that. No literal, and
the header stays a direct child of the page, so it is sticky for the whole page.
It is 79px on a desktop and 69px on a phone — which is precisely why no single
number could ever have been right.

## The section marker that would not let go

The nav marks the section you are looking at. An `IntersectionObserver` reports
**changes, not state**, and reading only the entries it hands you means the last
section to enter the band keeps the mark for ever — scroll back to the very top,
where none of them is in front of you, and "Trades" stayed lit. The whole
picture is kept now and the answer worked out from all of it; "nowhere in
particular" is a real answer.

## The brand vanished in its own footer

`<Wordmark>` follows the theme: `text-gray-900 dark:text-white`. The footer is
gray-950 in **both** themes — so on a page in light mode it drew near-black
letters on near-black ground and the mark was simply not there. Its own docblock
warns about exactly this surface and offers `tone="onDark"` for it. Wrapping it
in a `text-white` div was not enough; the letters carry their own colour class.

## Nothing that fences the product to one country

"Built for shops in Pakistan", "PKR only — no dollar surprises", "in this
country the line drops", "priced in rupees" — all removed. Prices still show
`Rs`, because that is the currency the product charges in today and a price with
no currency is worse than a specific one. What is gone is every sentence that
said this software is *for* one place.
