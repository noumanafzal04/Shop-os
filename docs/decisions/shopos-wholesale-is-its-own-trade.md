# Wholesale is its own trade

**2026-10-11 · at the user's word · NOT PUSHED until they say**

*"wholesale ki business type add hogi agr kisi ka only business sirf whole
sale ka — wo sirf maal banate hon, aagay different shops ko sell karte hon."*

Wholesale was two things, and neither was a business type. It was a
**category of Retail** ("Wholesale / Distributor"), and a **hidden older
code** that resolved to retail. A maker, an importer or a distributor — a
business whose whole trade is selling ON to shops — was told to call itself a
shop, and was then listed on the public marketplace and offered reservations.

## Why it earns a type

The rule in `BusinessTypes` is that a type is added only when the DEFAULTS
differ, never because a trade has a different name. Here they do:

| | Retail Store | Wholesale & Distribution |
|---|---|---|
| Public marketplace, delivery | on | **off** (one tick away — a distributor may also sell online) |
| Reservations | on | **off**, and not offered |
| Cannot open without | products, till | products, till, **stock, customers** |
| Counts in | piece, pair, box | **carton, bale, dozen, gross, sack** |
| Its customers are called | customers | **dealers** (dashboard) |

`ModulePackages::ESSENTIAL['wholesale']` is the line that matters most: on the
smallest plan a retailer has no customer book, and a wholesaler does — selling
on account to people it will see again is the trade.

## What it sells with

Nothing new. Everything a distributor needs was already built for a shop that
sells trade on the side, and a test walks a distributor's day in figures
(`WholesaleIsItsOwnTradeTest`):

- the **Price** on the product is the dealer's rate;
- a **Carton** is a pack unit with its own price and barcode (12 off the shelf);
- **quantity breaks** bring the unit price down at 60 and over;
- a **dealer** is a customer with a credit limit — a sale that would pass it is
  refused, with the account and the shelf left exactly as they were;
- an order is agreed on a **quotation** and turned into an invoice on account
  (`payment_method: credit`, `amount_paid` = what goes on the book);
- a **warehouse** takes the deliveries
  (`docs/decisions/shopos-a-warehouse-is-a-place.md`).

A retailer that also sells trade is still a Retail Store: that is what a
customer group on the wholesale price level is for. The Help article *Selling
wholesale* says both.

## Where it had to be added

Backend: `BusinessTypes` (the entry, `TOOL_DEFAULTS`, `UNITS`,
`VARIANT_ATTRIBUTES`; removed from `LEGACY_PRIMARY` and from Retail's
categories), `ModulePackages` (`FOR_TRADE`, `ESSENTIAL`), `ProductCsv` (serial
and warranty columns), `CreateDemoShopAction` (the Try-demo shelf),
`SeedDemoShops` + `TradeLists::wholesaler()` (shop10: Akbari Traders, with a
godown that takes its deliveries).

Panel: `SERIAL_TRADES`, the dashboard's trade words, `tradePhrase`,
`productExamples`, `test/tradeFeatures`, the marketplace label, and the
landing page — icon, till mock, switcher, footer, enquiry form, demo chooser,
"Nine trades".

An existing tenant whose `business_type` is the old `wholesale` code is now a
wholesale business rather than a retail one. There were none outside tests.

## Not done

These were listed to the user as later, and are not part of the type:

- **Order booking → delivery challan → invoice.** Today: quotation → invoice.
- **A rate per dealer**, or more than two price lists.
- **Areas, routes and a salesman's recovery sheet.**

No migration.
