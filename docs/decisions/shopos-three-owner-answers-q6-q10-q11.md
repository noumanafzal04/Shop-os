# Three owner answers, built: offline price, a customer's name, points online (Q10, Q11, Q6)

**Date:** 2026-10-16 · **Asked:** BUGS.md Q6, Q10, Q11
**Pushed:** Q11 + Q6 backend `a549989`, panel `95e4f48` · Q10 (B47) backend `0a4bf4b`, panel `02da955`

## Q10 — a sale rung offline keeps the price the till charged (B47)

**The owner:** "agr sale already ho chuki hai to wo to purani price py entry hogi na…? Jab online hai to updated price
jaye gi, agar offline hai to wohi price jaye gi jo save thi — isko achy sy deal krna."

**Before:** the server re-priced every synced cart at today's price. A price changed while a till was offline made the
sale "paid less than the total" — refused: money in the drawer, no sale, no stock movement.

**Now:**
- The till keeps each line's price with the queued sale (`tillPrices`, in the sale's own order, each naming its
  product and size) and sends it on sync (`till_prices`).
- The server prices the cart as before, then for each line whose till price names the same product it records the
  price the till charged. Every line whose price differs from the shop's price now is written on the sale
  (`offline_violations`: "Chiffon Dupatta at 900.00 (the price is now 990.00) × 1 — recorded as charged."), returned
  to the till in the sync answer, and listed in the offline report for the owner. A price that FELL is kept too, so the
  books never show change the till never gave.
- Not taken: a pack/carton line and a pump line sold by money (the till's engine prices neither — see L20), a price
  naming another product (a cart out of step), and anything through the online door (`offline_till_prices` is set only
  by `PosSyncController` with `trusted_offline`; a direct-action test holds the second lock).
- A row queued by an older build carries no prices and is priced as before.

**Why not trust the till entirely:** the server still prices every sale and every difference is visible to the owner;
the only thing it no longer does is refuse money that was already taken.

## Q11 — a name on file is never replaced from the counter

**Owner:** "market standard khud krdo". `Customer::capture` (the till, a quote, an online order, a car's owner) only
FILLS: a number filed under the placeholder takes its first real name, an empty email its first address. A typed name
stays on the sale or the quote as that paper's own copy; renaming is done on the customer's page.

## Q6 — points on every paid sale

**Owner:** "iska b mjhe idea ni — market standard dekho". One programme across channels: a paid sale to a known
customer earns points wherever it is made — the till, a completed online order (goods only; never the delivery fee;
a cancelled order earns nothing), a settled restaurant tab, a quotation or advance billed. Redeeming stays a till's act.
An automatic rule, so it needs the Customers module. (Before, the trusted path — orders, tabs, billed documents —
earned nothing.) Q1's "pending on khata" is still not built: a khata sale earns at once, as before.

## Proof

Backend: `AnOfflineSaleKeepsThePriceItWasRungAtTest` (8; 8 mutations caught), `PointsAreEarnedOnEveryPaidSaleTest`
(4; 2 caught), `CustomerCrmTest` (+3; 4 caught); the 320 loyalty/order/tab/quote files and 33 name files pass.
Panel: offlineCheckout + flush tests (4 caught). Copy stack, Zari / sana: an offline sale of Chiffon Dupatta at 900
(shop price 990) synced → INV-000023 total 900, change 0, stock 31 → 30, the note on the sale and in the offline report.
