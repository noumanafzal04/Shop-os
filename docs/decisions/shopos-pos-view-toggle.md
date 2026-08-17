# Tiles or rows — the till's view is a choice, not a verdict

**2026-08-17.**

## What it was

```ts
const posLayout: "grid" | "list" = isRestaurant ? "grid" : "list";
```

One line, and no way round it. Food shops browsed picture tiles; every other
trade got dense rows. The reasoning was sound — a kitchen recognises a drink by
its picture, a pharmacy with 4,000 SKUs needs rows it can scan down — but the
**default was the only answer**, and a shop is not always the shape its business
type says it is.

A mart with 60 lines and a photo for all of them wanted tiles. A food court
running 300 items off a menu board wanted rows. Neither could have them.

## What it is

Two buttons beside the search box, at **every** width including desktop. It is
not a small screen's consolation prize: the two views answer different
questions — *"which one is it?"* from a picture, versus *"is it in stock, and at
what price?"* from a row — and which one a counter needs depends on the counter.

## Where the choice lives

`terminalStore`, per **device** — the same place the lane and the number pad
live, for the same reason. Which view works better is a fact about the screen
and the person standing at it, not about the tenant or whoever logged in. A shop
is allowed to want tiles on the counter touchscreen and rows on the back-office
desktop, and neither should overwrite the other.

`posView: "grid" | "list" | null`. **Null means "whatever this trade defaults
to"**, and null is what every existing till holds — so nothing changes for
anybody until somebody presses the button.

## The bug the toggle would have shipped

The row view has always refused an out-of-stock item (`disabled={out}`). The
tile view never has.

That went unnoticed for as long as tiles were food's alone, because a kitchen
mostly sells items that count nothing. The moment the view became a choice any
trade can make, **a pharmacy in tile view could have sold what a pharmacy in row
view refuses.**

> A view is a way of LOOKING at the shop. It does not get its own idea of what
> may be sold.

Tiles now carry the same stock rule, an "Out of stock" state, and the stock
figure the rows have always shown — a mart that switches to tiles is still a
mart, and *how many are left* is half of why it looks a product up.

Everything else is untouched: search, scanning, quick keys, keyboard selection
and every price come from the same `tiles` array in both views. Pricing stays
server-authoritative, as always.

Related: [shopos-pos-ux](shopos-pos-ux.md), [shopos-hardware](shopos-hardware.md).
