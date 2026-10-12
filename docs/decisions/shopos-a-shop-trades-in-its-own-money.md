# A shop trades in its own money

**2026-10-11, night.** The owner's words: *"currency type add kro — agr Pakistan
main use kry to usy PKR chahye, USA main Dollar, India main INR — to wo select
kr sky currency type."* Built and tested; **not pushed** until they say.

## What was there

A shop had a currency **symbol** it could not choose (`settings.currency_symbol`,
any five characters, default "Rs") and a currency **code** nothing read. There
was no control for either. So the product spoke rupees to everybody: eleven
places on the server glued "Rs" to `number_format()`, sixty-two lines of the
panel wrote `` `Rs ${n}` `` for themselves, the browser's own language decided
where the commas went, and every drawer was counted in five-thousand-rupee
notes. Help said "set your currency" on two pages.

## The decision: one currency per shop, chosen from a list, fixed once it has traded

- **`App\Support\Currencies`** is the one list: PKR, INR, USD, AED, SAR, GBP,
  EUR, BDT. For each — its name, its mark, where its commas go (`western`
  1,234,567 · `indian` 12,34,567), whether a whole amount carries ".00", whether
  the mark stands apart from the number ("Rs 500", "$500.00"), and the notes
  and coins a drawer is counted in.
- **The code is what is stored.** `currency_symbol` and `currency_format` are
  *given* by `Tenant::allSettings()` from the code and never saved; a mark sent
  on its own is not a setting any more. "Rs" stored beside "USD" cannot happen.
- **Nothing is converted, so it is fixed once there is money on the books**
  (`Tenant::hasMoneyOnItsBooks()` — a sale, an order, a purchase order, an
  expense, an income, a quote/advance). `Tenant::mayTradeIn()` is the one rule;
  the settings screen, the setup form and the admin's create form all come
  through it. Refusal: `409 CURRENCY_LOCKED`, in words. The same currency sent
  again is not a change. This is what Shopify does after a store's first sale,
  and for the same reason: Rs 500 would simply start reading $500.
- **The platform's own money is separate.** What a plan or an add-on costs is
  the platform's figure in the platform's currency (`platformMoney`), whatever
  the shop that pays it trades in.

## Where it is chosen

| Where | How |
|---|---|
| Settings → Tax & Delivery → **Currency** | a drop-down, with how amounts will read shown before saving; once fixed, the card names the currency and says why — no control that would be refused |
| The owner's first setup screen | asked there, because "you should have chosen before you began" is no use afterwards |
| Admin → Create a business | a Currency field beside City; the shop's admin page says what it trades in |

`GET /shop/currencies` answers the settings screen (current, locked, why,
options) — its own request, because "has it traded?" looks at the books and
`/shop/settings` is read on every page. `GET /currencies` is the plain list.

## What follows it

- **Server:** `Tenant::money()` for every message that names a figure; the four
  printed papers (receipt/invoice, quote/job card, table bill, Z-read) write
  through `Currencies::paper()`; the Z-read prints the count largest first.
- **The drawer:** `DenominationCount::for($currency)`; a denomination is not
  always a whole number (a quarter is 0.25), and "0.25", "0.250" and ".25" are
  one coin.
- **The till** takes its currency from the server, or — with no connection —
  from the settings that came down with the catalogue (`useTillCurrency`).
- **Panel:** `common/format/currency.ts` writes an amount from the format the
  server sends, not from the browser's locale and not from a list of its own.
  `useMoney()` is the shop's; `platformMoney` is the platform's; the
  marketplace's `money(n, shop.currency)` is whichever shop's the price is.
- **Customers:** every public shop and product row carries its shop's
  currency. A basket across shops shows each shop's slice in its own money,
  and prints no grand total when the shops trade in different money.

## Held together by

- `tests/fixtures/currency-format.json` — 184 strings made by the server's
  list; `currency.test.ts` holds the panel's formatter to every one. The same
  arrangement as the till's bill.
- `CurrencyFormatFixturesTest::test_no_php_file_writes_a_currency_mark_of_its_own`
  and `noLiteralCurrency.test.ts` — a file that writes "Rs" for itself fails.
- `AShopTradesInItsOwnMoneyTest` (17), `cartStore.test.ts`, journey **stage V**
  (`33-a-shop-that-trades-in-dollars.spec.ts`, 6 cases).
- Mutations: 24 / 24 on the server, 10 / 10 in the panel.

## Not done — and said to the owner

- **A currency is not a country.** Cities are still Pakistan's, the tax year is
  still July–June, phone numbers are still checked as Pakistani. A shop in
  Dallas can ring dollars; it cannot yet pick Dallas.
- **The platform bills in one currency.** Plan prices per currency is a
  separate job.
- **One currency per shop.** A till that takes dollars and rupees, with a rate
  on each sale, is a much larger one.
- The admin's cross-shop screens (commission, customers' spend) add figures up
  in the platform's currency; with shops in different money those totals mean
  nothing until they are split by currency.
- Mobile apps are untouched.

## Also on this walk

- **Each branch keeps its own stock.** The owner asked whether every branch
  must stock through a warehouse. It need not and never did:
  `EachBranchKeepsItsOwnStockTest` writes it out — two shops, no warehouse,
  each takes its own deliveries, sells its own shelf, and stock goes shop to
  shop directly. It passed on its first run; nothing was changed.
