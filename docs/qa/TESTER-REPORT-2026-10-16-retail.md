# True Serve — Part A retail QA — 2026-10-16

Status: PART A COMPLETE, with the specific limits below. Local Chromium testing only; Part B excluded.

Commits: root `979ef38`, backend `0a4bf4b`, panel `02da955`.
Stack: panel http://localhost:5177; API http://localhost:8000/api/v1.
Evidence and scripts: `/Users/noumanafzal/shopos-qa/retail/`; screenshots and HARs: `/Users/noumanafzal/shopos-qa/out/`.

## Plan written before testing

Each step: record action and reload screenshots, browser API statuses/error codes/times, console errors, repeated requests, GET readbacks and manually computed money/stock deltas. Flag calls above 1,200 ms, unexpected 4xx, every 5xx. Cross-reference existing open bugs without new IDs. New issues use BUG-63 onward and the brief's complete field table. Do not change settings unless restored, do not modify existing files, and do not use API writes.

| Step | Browser work and expected proof |
|---|---|
| A0 | Owner: baseline Dashboard Simple/Full, all available non-HR menu pages, Settings tabs read-only, Help topics; save opening figures. |
| A1 | Super admin: Zari trade/plan/modules/offline/staff, Plans and Payments read-only; compare Subscription. |
| A2 | Owner: QA-2026-10-16 Lawn Suit, S/M/L opening 5 each, prices 2,500/2,500/2,700, cost 1,600; plain pack item; isolated edit, opening movements and barcode labels. |
| A3 | Cashier: inspect existing shift, resolve earlier-day shift through UI if necessary, open today's with counted float 2,000. |
| A4 | Cashier: cash/change, card, split, permitted/excess discounts, customer phone lookup, hold/resume, double Pay; reconcile item quantities and money. |
| A5 | Cashier with manager approval: return and dearer/cheaper size exchanges; preview refund, right-size stock and drawer deltas. |
| A6 | Cashier/owner: QA customer credit 990, cash collection 500, transfer 1,040; expected **550 advance** (brief's stated 50 is arithmetically incorrect); statements and khata collection outside revenue. |
| A7 | Owner: quote two items, print preview, hold on advance, final payment and billing; stock leaves only when billed, one sale. |
| A8 | Owner: two items on installments, 10% charge, 3 months, card advance, double first cash collection; filters, customer payment routing, financing and Other income. |
| A9 | Manager/stock keeper/owner: QA supplier, two-size PO, partial receipt including zero arrival, part cash/full bank payment; weighted costs, balances and permissions. |
| A10 | Stock keeper/manager: transfer, sale from destination, stocktake difference, damage disposal; per-place movements. |
| A11 | Owner/cashier: QA promotion, coupon and bank card offer; totals/receipt/report reconciliation. |
| A12 | Accounts: cash expense with receipt, bank expense, income; reconcile books, reports and dashboard. |
| A13 | Owner: QA phone order accept/dispatch/complete and cancel; stock/money/points only once on completion. |
| A14 | Cashier/owner: empty close blocked, counted close with 100 variance, close day, test closed-day refusal (B14 known). |
| A15 | Owner: reconcile sales, drawer, profit and size-M quantity across Sales, Day, Cashbook, Ledger, Reports, Dashboard, place stock and item. |
| A16 | Cashier/stock keeper/accounts/manager: menu, five typed URLs, forbidden action, GET dashboard/products and protected resources; no unauthorised money fields. |
| A17 | Cashier: repeat cash sale and khata at phone 390×844 and tablet 1024×768. |
| A18 | Read Sweep Mart product/sale IDs as its owner, GET as Zari expecting 404/403; read Sweep Mart again unchanged. |

For forms exercised, test empty/zero/negative/huge/three decimals, long/Urdu/quoted/markup/emoji names, duplicate barcodes and normalized phones, double money clicks, mid-form reload/back, responsive access and forbidden-user behavior. Record unsupported or blocked variants explicitly. A19/A20 are outside this run.

## Run and coverage

Signed in as Sana Malik (owner), Bilal Ahmed (cashier), Usman Tariq (stock keeper), Farah Naz (accounts), Hina Shah (manager), platform super admin, and Sweep Mart owner. All writes to shop data used visible panel controls in Chromium. API use was GET readback only. The browser and API stayed on localhost. The runner is `~/shopos-qa/retail/a00-walk.mjs`; `commands.log`, `evidence.jsonl`, `readbacks.jsonl`, `responses.jsonl`, stage network JSON/TXT, screenshots and HARs preserve the step-by-step evidence. A screenshot after the action and after reload was captured for each completed step and meaningful state change.

| Step/area | Checks run | PASS | FAIL | BLOCKED |
|---|---|---|---|---|
| A0 navigation and baseline | Dashboard, non-HR menu pages, Settings tabs, Help | Baselines captured | — | — |
| A1 platform and entitlement | Admin plan, payments, Zari modules, staff, subscription | Pro plan Rs 7,999; entitlement and tenant screens agree | — | — |
| A2 catalogue | Suit S/M/L, plain pack, edit, labels, Urdu/markup, numeric bounds, barcode | Stock/price/weighted cost persisted | Duplicate variant barcode accepted (BUG-71) | — |
| A3 shift | Old shift, open today, counted float | Opened Bilal Rs 2,000 | — | — |
| A4 till | Cash/change, card, split, discounts, hold, double Pay, reload | One invoice per Pay; totals match | Duplicate Hold (BUG-64) | — |
| A5 return/exchange | Manager return and both exchange directions | Stock and Rs 200 cash differences match | — | Cashier approval requires Hina's existing PIN, unavailable in the login brief |
| A6 customer/khata | Credit, cash and transfer collection, normalized phone | Rs 550 advance; collection outside sales | — | — |
| A7 quote/advance | Quote, print, held goods, payment, bill | One invoice, held stock reserved once | No quote-to-advance action (BUG-65) | — |
| A8 installments | Charge, card advance, cash/transfer installments, filters | Rs 2,178 total; Rs 1,060 collected; Rs 618 left | — | — |
| A9 purchasing | Supplier, partial PO receive, pay, weighted cost, staff | 2 M received, 0 L; M cost Rs 1,680 | Duplicate supplier and PO (BUG-66/67) | — |
| A10 inventory | Transfer, outlet sale, blind count, disposal | Final size/place quantities match | Duplicate transfer removed 2 extra M (BUG-68) | — |
| A11 offers | Promo, coupon, bank offer, receipt | Yesterday-start offers and coupon work | Today-start offers fail (BUG-69) | — |
| A12 money books | Cash/bank expense, receipt, cash income, numeric invalids | Rs 305.75 expenses, Rs 300.75 income | — | — |
| A13 orders | COD complete and pending-order cancel | One goods invoice; cancel restored stock | Double Confirm shows 409 (BUG-63) | — |
| A14 close | Count shifts, close Main day, try closed-day sale | Main day Rs 35,877 expected / Rs 35,977 counted | Double Close shows 409 (BUG-63); reopening hidden (BUG-70) | — |
| A15 reconciliation | Sales, Day, Cashbook, Ledger, Reports, Dashboard, sizes | Figures below agree by scope and definition | — | — |
| A16 permissions | Four staff menus, typed URLs, protected GETs | 403 for protected resources; no money leakage found | — | Forbidden URL silently redirects (known B44) |
| A17 responsive | Phone 390×844 cash; tablet 1024×768 khata; reload | Both real sales and stock/customer readbacks pass at QA Outlet | Narrow phone amount field (BUG-72) | Main's closed day cannot be reopened through current UI (BUG-70) |
| A18 tenant isolation | Sweep Mart IDs read as Mart/Zari/Mart | Zari gets 404; Mart records unchanged | — | — |

## Issues list

| Issue | Priority | Page | Finding |
|---|---|---|---|
| BUG-63 | P2 | Shift / Day / transfer / stocktake / orders | A second click after a successful state change posts again and shows 409 |
| BUG-64 | P2 | POS Hold | Double Hold creates two held tickets |
| BUG-65 | P2 | Quotes & Advances | A saved quotation has no conversion action to hold its goods on advance |
| BUG-66 | P2 | Suppliers | Double Save creates two identical suppliers |
| BUG-67 | P1 | Purchase orders | Double Place order creates two Rs 7,200 POs |
| BUG-68 | P0 | Stock transfers | Double Send removes stock twice and creates two transfers |
| BUG-69 | P1 | Promotions / bank offers | An offer starting today does not apply until its start date is moved to yesterday |
| BUG-70 | P1 | Day & banking | Older open days hide today's closed day and its reopen action |
| BUG-71 | P2 | Products | A product can reuse an existing variant barcode |
| BUG-72 | P3 | Phone payment form | Amount field clips `1040.50` to visible `104` |

### BUG-63 — A second click after a successful state change posts again and shows 409
| Field | Value |
|---|---|
| Priority | P2 |
| Area | Till shifts · Day & banking · Inventory · Orders · Documents |
| Page | `/tenant/pos`, `/tenant/day`, `/tenant/transfers`, `/tenant/stocktake`, `/tenant/orders`, `/tenant/documents` |
| Who | Bilal cashier (shift); Sana owner (day, count, documents); Hina manager (transfer); Sana owner (order) |
| Shop | Zari Clothing · retail |
| Device | Desktop 1440×900 |
| Steps | Open the named action and double-click its final button: `Close shift` with Bilal's counted Rs 25,726; `Close off day` with Main's counted shifts; `Receive` TRF-000001; `Apply count` SC-000001; `Confirm` ORD-000002; or `Bill it` LAY-000003. Reload and inspect the record. |
| Expected | One request or a harmless repeat response; one completed record and an unambiguous success screen. |
| Actual | First request succeeded and changed state once. The second request returned 409; after closing a shift, the modal remained as though closing had failed. Reload showed the first successful state. No second sale, payment or stock movement was found for these actions. |
| API | `POST /pos/session/close` → 200 then 409 `SHIFT_NOT_OPEN`, 58/108 ms; `POST /pos/days/{id}/close` → 200 then 409 `BUSINESS_DAY_CLOSED`, 52/70 ms; `POST /inventory/transfers/{id}/receive` → 200 then 409 `TRANSFER_NOT_IN_TRANSIT`, 64/85 ms; `POST /inventory/counts/{id}/apply` → 200 then 409 `STOCK_COUNT_CLOSED`, 56/75 ms; `POST /orders/{id}/advance` → 200 then 409 `ORDER_INVALID_TRANSITION`, 38/56 ms; `POST /sale-documents/{id}/convert` → 201 then 409 `DOCUMENT_NOT_OPEN`, 64/82 ms. Successful responses have no `error_code`. |
| Console | Browser logged 409 failed-resource messages; no JavaScript exception. |
| Evidence | `~/shopos-qa/out/shots/a14-close-04-A14-shift-closed.png`, `a14-close-05-A14-shift-closed-reload.png`, `a14-day-03-A14-day-closed.png`; HARs `a14-close`, `a14-day`, `a10-stock`, `a10-apply`, `a13-orders`, `a07-documents`. |
| Repeats | 6 of 6 tested double state changes in these flows. |
| Known? | New misleading 409 behavior; money actions still produced one record, consistent with the B07 fix. |

### BUG-64 — Double Hold creates two held tickets
| Field | Value |
|---|---|
| Priority | P2 |
| Area | Till · held tickets |
| Page | POS `/tenant/pos` |
| Who | `bilal@zariclothing.test` · cashier |
| Shop | Zari Clothing · retail |
| Device | Desktop 1440×900 |
| Steps | Put one QA Lawn Suit M (Rs 2,500) and the QA customer in the cart, click Hold, then double-click the final hold button. Reload Drafts. |
| Expected | One parked ticket for the one cart. |
| Actual | Two identical held tickets appeared. The extra ticket was deleted through Drafts; the intended one was resumed and paid. |
| API | Two `POST /pos/held` → 201, `error_code` null, 60/60 ms, distinct IDs; extra `DELETE /pos/held/{id}` → 200, 57 ms. |
| Console | No JavaScript error. |
| Evidence | `~/shopos-qa/out/shots/a04-sales-19-A4-held.png`, `a04-sales-21-A4-duplicate-held-after-reload.png`; HAR `a04-sales`. |
| Repeats | 1 of 1 double-click attempt. |
| Known? | New. |

### BUG-65 — A quotation has no path to hold its goods on advance
| Field | Value |
|---|---|
| Priority | P2 |
| Area | Quotes & Advances |
| Page | `/tenant/documents`, quotation detail `/tenant/documents/01a143d5-e5df-71b0-beee-01e6458ef734` |
| Who | `sana@zariclothing.test` · owner |
| Shop | Zari Clothing · retail |
| Device | Desktop 1440×900 |
| Steps | Create QUO-000003 for two QA Plain کپڑا at Rs 990 each, open it, inspect actions and print preview, reload. Then use the separate `Hold the goods` flow to make LAY-000003. |
| Expected | The quoted customer and two lines can become an on-advance hold without re-entering the sale. |
| Actual | The quote offers Print, Bill and Cancel, but no hold-on-advance action. LAY-000003 had to be recreated independently. |
| API | Two idempotent `POST /sale-documents` for QUO-000003 → 201, `error_code` null, 64/83 ms, same document ID; quotation GET → 200 (readback log). No conversion request could be made from the screen. |
| Console | No JavaScript error. |
| Evidence | `~/shopos-qa/out/shots/a07-documents-09-A7-quote-detail-action.png`, `a07-documents-11-A7-quote-detail-reload.png`, `a07-documents-14-A7-layaway-saved.png`; HAR `a07-documents`. |
| Repeats | Always in the tested quotation. |
| Known? | New workflow gap against brief §1.4. |

### BUG-66 — Double Save creates two identical suppliers
| Field | Value |
|---|---|
| Priority | P2 |
| Area | Purchasing · suppliers |
| Page | `/tenant/suppliers` |
| Who | `sana@zariclothing.test` · owner |
| Shop | Zari Clothing · retail |
| Device | Desktop 1440×900 |
| Steps | New supplier: name `QA-2026-10-16 Textiles`, phone `03001610006`, contact `QA-2026-10-16 فیصل 🧵`, Urdu address. Double-click Save and reload list. |
| Expected | One supplier. |
| Actual | Two distinct supplier IDs with identical names, phone and contact. The duplicate with no orders/payments was deleted through the UI after its empty History was checked. |
| API | Two `POST /suppliers` → 201, `error_code` null, 52/74 ms; IDs `...c2d7...` and `...c2f1...`; duplicate `DELETE /suppliers/{id}` → 200, 29 ms. |
| Console | No JavaScript error. |
| Evidence | `~/shopos-qa/out/shots/a09-purchases-02-A9-supplier-saved.png`, `a09-purchases-03-A9-supplier-saved-reload.png`, `a02-boundaries-58-A9-duplicate-supplier-before-delete.png`; HAR `a09-purchases`. |
| Repeats | 1 of 1 double-click attempt. |
| Known? | New. |

### BUG-67 — Double Place order creates two Rs 7,200 purchase orders
| Field | Value |
|---|---|
| Priority | P1 |
| Area | Purchasing |
| Page | `/tenant/purchases` |
| Who | `sana@zariclothing.test` · owner |
| Shop | Zari Clothing · retail |
| Device | Desktop 1440×900 |
| Steps | Select QA Textiles, add 2 QA Lawn Suit M and 2 L at Rs 1,800 cost each, double-click Place order; reload. |
| Expected | One PO, total Rs 7,200. |
| Actual | PO-000003 and PO-000004 were each Rs 7,200. The extra PO-000004 was cancelled in the UI before receiving or payment. |
| API | Two `POST /purchase-orders` → 201, `error_code` null, 60/98 ms, distinct PO IDs; cancel via UI → 200 (stage `a09-pay`). |
| Console | No JavaScript error. |
| Evidence | `~/shopos-qa/out/shots/a09-purchases-05-A9-PO-before.png`, `a09-purchases-07-A9-PO-saved-reload.png`, `a09-pay-10-A9-duplicate-PO-cancelled-reload.png`; HAR `a09-purchases`. |
| Repeats | 1 of 1 double-click attempt. |
| Known? | New. |

### BUG-68 — Double Send removes transfer stock twice
| Field | Value |
|---|---|
| Priority | P0 |
| Area | Inventory · stock transfers |
| Page | `/tenant/transfers` |
| Who | `hina@zariclothing.test` · manager |
| Shop | Zari Clothing · retail |
| Device | Desktop 1440×900 |
| Steps | New transfer Main → `QA-2026-10-16 Outlet`, select 2 QA Lawn Suit M, double-click Send, reload and inspect Main size M and transfer list. |
| Expected | One transfer TRF, Main M reduced by 2. |
| Actual | TRF-000001 and TRF-000002 were sent. Main M fell from 5 to 1 instead of 3 (4 units moved). TRF-000002 was called back through the UI, restoring 2; TRF-000001 was received. Later legitimate QA tests changed final Main M to 2. |
| API | Two `POST /inventory/transfers` → 201, `error_code` null, 87/135 ms, distinct IDs; extra transfer `POST /inventory/transfers/{id}/cancel` → 200, 50 ms. GET stock readbacks record before/after. |
| Console | No JavaScript error. |
| Evidence | `~/shopos-qa/out/shots/a10-stock-02-A10-transfer-before.png`, `a10-stock-03-A10-transfer-sent.png`, `a10-stock-04-A10-transfer-sent-reload.png`; HAR `a10-stock`. |
| Repeats | 1 of 1 double-click attempt. |
| Known? | New. |

### BUG-69 — Promotion and bank offer starting today fail their first day
| Field | Value |
|---|---|
| Priority | P1 |
| Area | Promotions · bank card offers |
| Page | `/tenant/promotions`, `/tenant/bank-offers`, POS `/tenant/pos` |
| Who | Sana owner configured; Bilal cashier sold |
| Shop | Zari Clothing · retail |
| Device | Desktop 1440×900 |
| Steps | Create QA 10% whole-order promotion, minimum Rs 5,000, start/end 2026-10-16. Make a Rs 5,940 basket. Create QA card bank 10%, cap Rs 200, start/end today and inspect till bank options for Rs 990. Change only both starts to 2026-10-15; repeat. |
| Expected | Today is inside the inclusive date range: promo basket Rs 5,346; bank option available and Rs 990 card bill charged Rs 891. |
| Actual | Today-start promo preview returned no discount and INV-000035 charged Rs 5,940; today-start bank absent. With only start moved to yesterday, promo applied and card offer charged Rs 891. QA promo was then deactivated and QA bank disabled through the UI. |
| API | `POST /promotions/preview` → 200, `error_code` null, 104 ms on missed preview and 51 ms after changed date; `GET /banks/live` → 200, empty when start=today, available after change (stage logs); successful sale `POST /sales` → 201, 70 ms for bank test. |
| Console | No JavaScript error. |
| Evidence | `~/shopos-qa/out/shots/a11-sales-02-A11-promo-cart.png`, `a11-sales-09-A11-bank-not-offered.png`, `a11-retest-02-A11-promo-yesterday-cart.png`, `a11-retest-06-A11-bank-paid.png`, `~/shopos-qa/out/shots/a11-actual-receipt-0.png`; HARs `a11-sales`, `a11-retest`. |
| Repeats | 2 offer types, both missed on today's start and worked on yesterday's start. |
| Known? | New. |
| Cause (optional) | `backend/app/Support/OfferWindow.php:55-61` compares the shop-local start of today with the stored date Carbon object's start of day. This looks like a timezone mismatch; compare local calendar dates in one timezone. Inference from source plus browser result. |

### BUG-70 — Older open days hide today's reopen action
| Field | Value |
|---|---|
| Priority | P1 |
| Area | Day & banking |
| Page | `/tenant/day` with Main selected |
| Who | `sana@zariclothing.test` · owner |
| Shop | Zari Clothing · retail |
| Device | Desktop 1440×900 |
| Steps | Close today's Main day after all three shifts were counted (Rs 35,877 expected, Rs 35,977 counted); reload and select Main. Inspect Today and Past days, try to reopen today's closed row. |
| Expected | `Open today again` available on the closed 16 Oct day to allow a justified correction. |
| Actual | Today shows open 15 Oct, because both 13 and 15 Oct historic days are still open. Past days shows closed 16 Oct but has no reopen action. The 13 Oct day contains a pre-existing signed shift with Rs 22,580 short variance; it was deliberately not signed off just to unblock this UI. A17 sales were instead completed at the QA Outlet. |
| API | `GET /pos/day` → 200, `error_code` null, 49–111 ms, historic open day returned without `closed_today`; `GET /pos/days/{16-Oct-id}` → 200, 364 ms readback, status closed. No reopen POST was possible in UI. |
| Console | No JavaScript error. |
| Evidence | `~/shopos-qa/out/shots/a17-prep-05-A17-reopen-main-action.png`, `a17-prep-08-A17-closed-today-no-reopen.png`, `a17-prep-09-A17-closed-today-no-reopen-reload.png`; HAR `a17-prep`. |
| Repeats | Always with these two older open days. |
| Known? | New; distinct from B14's missing shift sales. |
| Cause (optional) | `backend/app/Http/Controllers/Api/V1/Tenant/BusinessDayController.php:57-75` emits `closed_today` only when no open day is found; `panel/src/modules/day/pages/DayPage.tsx:304` renders the reopen card from that metadata. |

### BUG-71 — Product creation accepts a barcode used by a variant
| Field | Value |
|---|---|
| Priority | P2 |
| Area | Products · barcodes |
| Page | `/tenant/products/new`, `/tenant/pos` |
| Who | `sana@zariclothing.test` · owner |
| Shop | Zari Clothing · retail |
| Device | Desktop 1440×900 |
| Steps | QA Lawn Suit S already has barcode `8962026101601`. Create a new zero-stock QA product with a long Urdu/markup name, price Rs 990 and the same barcode in Codes & packs, click Create; reload and GET both. Scan barcode at Main POS. |
| Expected | Duplicate barcode refused with a clear field error, since one scan must identify one sellable item. |
| Actual | New product saved with the same barcode. Scanning currently picked the S variant, but the catalogue contained two barcode owners. The zero-stock probe product was deleted through the UI after evidence capture. Negative and three-decimal prices were blocked by native validation; huge price returned 422 as expected. |
| API | `POST /products` with huge price → 422 `VALIDATION_ERROR`, 44 ms; `POST /products` with duplicate barcode → 201, `error_code` null, 51 ms; both product GETs → 200 with barcode `8962026101601`; probe `DELETE /products/{id}` → 200, 75 ms. |
| Console | Expected failed-resource log for 422; no JavaScript exception on duplicate acceptance. |
| Evidence | `~/shopos-qa/out/shots/a02-boundaries-38-A2-duplicate-barcode-scan.png`, `a02-boundaries-42-A2-collision-product-before-delete.png`, `a02-boundaries-44-A2-collision-product-deleted-reload.png`; HAR `a02-boundaries`. |
| Repeats | 1 of 1 cross-product/variant collision attempt. |
| Known? | New. |

### BUG-72 — Phone payment amount field clips the entered number
| Field | Value |
|---|---|
| Priority | P3 |
| Area | Customer khata · responsive form |
| Page | `/tenant/customers` on 390×844 phone |
| Who | `sana@zariclothing.test` · owner |
| Shop | Zari Clothing · retail |
| Device | Chromium 390×844 |
| Steps | Open QA Ahmed's khata, enter transfer payment `1040.50` while the balance is lower, inspect the input and overpayment confirmation; cancel rather than posting this extra test payment. |
| Expected | Entire typed `1040.50` visible so a shopkeeper can check the paisa before confirming. |
| Actual | Input shows only `104` at once due to its narrow width; the confirmation text shows the full amount. No payment was submitted in this phone probe. |
| API | Existing customer/khata GETs → 200 (stage `a17-phone`); no payment POST, so no new money was recorded. |
| Console | No JavaScript error. |
| Evidence | `~/shopos-qa/out/shots/a17-phone-06-A17-phone-overpay-preview.png`, `a17-phone-07-A17-phone-overpay-preview-reload.png`; HAR `a17-phone`. |
| Repeats | 1 of 1 phone amount probe. |
| Known? | New. |

## Financial and stock readback

All figures here are for 16 Oct 2026 unless stated. Reports and Dashboard both show 23 sales, revenue Rs 60,446.00, refunds Rs 7,700.00, other income Rs 1,658.75, expenses Rs 305.75, tax Rs 7,743.97, COGS Rs 31,651.67 and net profit Rs 14,703.36. Profit calculates as `60,446 − 7,700 − 7,743.97 − 31,651.67 + 1,658.75 − 305.75 = 14,703.36`. Cashbook's opening Rs 22,550.00 plus money in Rs 62,104.75 less money out Rs 11,605.75 gives closing Rs 73,049.00. Daily custom-range Ledger entries reconcile to that balance. Money out includes Rs 3,600 supplier settlement, Rs 7,700 refunds and Rs 305.75 expenses. The Rs 1,040 transfer khata collection and other collections sit outside sales revenue.

Main's signed day remains Rs 50,066.00 sales, Rs 35,877.00 expected drawer, Rs 35,977.00 counted, variance +Rs 100.00. The QA Outlet's signed day is Rs 7,500.00 sales, Rs 5,000.00 expected and counted, balanced. Together the two days are Rs 57,566.00, which is Rs 2,880.00 below all-channel sales. The known B14/Q5 definition gap explains this: Rs 900 pre-existing sale plus the QA Rs 1,980 phone order had no shift and therefore no Day row. This is recorded as known, not a new issue.

QA Lawn Suit stock at finish is Main S 2, M 2, L 3, QA Outlet 0, total 7; QA Plain کپڑا is Main 9, Outlet 0. M weighted cost is Rs 1,680.00 after receipt. A17 phone INV-000040 took one Outlet M at Rs 2,500.00 with Rs 3,000.00 tender and Rs 500.00 change, so its drawer rose Rs 2,500.00. Tablet INV-000041 took one transferred Outlet S on Rs 2,500.00 khata, leaving the drawer unchanged and customer `QA-2026-10-16 Tablet Credit فاطمہ` owing Rs 2,500.00, 25 points. QA Ahmed's Rs 990.00 credit less Rs 500.00 cash and Rs 1,040.00 transfer yields Rs 550.00 advance; the plan still has Rs 618.00 to collect. These figures agree on the sale, customer, stock, day, cashbook, reports and dashboard after reload, subject to the known reporting definitions above.

## Known bugs that changed or were seen again

- B07's Pay/document idempotency produced one invoice/document even when two requests were observed; some state transitions now show a second 409 (BUG-63).
- B14's closed-day counter sale is now refused with `BUSINESS_DAY_CLOSED`; the no-shift phone-order Day gap remains. B17's completed phone-order sale still has zero tax and online channel. B16's POS/design stock display still shows all-place quantity for plain goods/size rows, although branch-stock GETs were correct. B21 exchange credits still inflate gross sales and refunds by definition. B28 bank-offer button amount still differs from due amount. B29 repeated GETs and B44 silent forbidden-URL redirect persist. Q1 credit sale earns loyalty points before payment. None of these is duplicated as a new bug.

## API timing and unexpected status

The kit captured 2,566 browser API calls across stages; none exceeded 1,200 ms and none returned 5xx. Slowest calls were:

| Stage | Method/path | Status | Time ms |
|---|---|---:|---:|
| a02-boundaries | POST `/pos/devices` | 200 | 795 |
| a02-boundaries | GET `/auth/me` | 200 | 584 |
| a02-boundaries | GET `/products?page=1` | 200 | 471 |
| a02-boundaries | GET `/categories` | 200 | 413 |
| a10-outlet | GET `/products?page=1` | 200 | 391 |
| a17-phone | GET `/auth/me` | 200 | 370 |
| a17-phone | POST `/promotions/preview` | 200 | 355 |
| a10-outlet | GET POS active products | 200 | 353 |
| a02-boundaries | GET `/products?page=1` | 200 | 343 |
| a10-outlet | GET `/auth/me` | 200 | 337 |

Unexpected non-2xx responses were the second 409 on successful actions described in BUG-63. Expected refusals were: excess discount 403 `DISCOUNT_LIMIT_EXCEEDED`; closed-day shift open 409 `BUSINESS_DAY_CLOSED`; huge price 422 `VALIDATION_ERROR`; duplicate customer/phone and coupon 422; negative/huge expense 422; foreign shop IDs 404; staff-only protected GETs 403. Each occurrence, full response `error_code`, and duration is preserved in `retail/responses.jsonl` and the stage network logs. Console failed-resource messages corresponded to those 4xx responses or the deliberately blocked external map resources; no unexplained JavaScript exception was found. Repeated GETs are tracked in stage network logs and are known B29.

## Suggestions / improvement titles

These are product feedback, separate from confirmed defects. **Suggestion: Add a `Convert to held goods` action on a quotation** — this would close BUG-65 without retyping its customer and items. **Suggestion: Show today's closed day above older open days and offer a direct reopen link** — this would make BUG-70 discoverable and avoid accidental historic sign-off. **Suggestion: Keep an on-screen full amount preview beside narrow money fields** — this would reduce phone verification mistakes while BUG-72 is fixed. **Suggestion: Explain the reporting scope beside Day totals** — Day currently omits no-shift sales by the known B14/Q5 design, while Reports includes them; an explicit scope label would reduce confusion. Proposed titles for the fixer are the bold sentences above.

## Limits and data left

No Part B restaurant work was started. The cashier-with-supervisor-PIN refund path could not be finished because Hina's existing PIN is not provided; manager's own return and both exchange directions passed. Main's reopening path could not be exercised because older open days mask it; I left the 13 Oct historic day open after finding its already-signed Rs 22,580 short shift. Cash/khata at phone/tablet were run at the QA Outlet instead. Deep invalid-value probes covered the catalogue, till discount, expense, phone overpay, duplicate phone and coupon. They do **not** establish empty/negative/huge/three-decimal coverage of every field on every form, nor an API write-403 probe (direct API writes were prohibited). Browser-visible forbidden pages and protected GETs were tested for all four staff sets. A18 checked two foreign IDs and read Sweep Mart before and after; no Mart writes were made. The `/pos/shifts/current` GET returned 404 because that guessed readback path is not an application route; the shift was verified from UI and Day readbacks instead.

QA data left: Lawn Suit S/M/L with barcode `8962026101601/02/03`, Plain کپڑا and Box of 5; customer Ahmed (Rs 550 advance), Quote احمد, Advance, Qist and Tablet Credit فاطمہ; QA Textiles supplier with settled PO-000003; cancelled duplicate PO-000004; TRF-000001 received and duplicate TRF-000002 called back; SC-000001 applied; DSP-000001; QUO-000003 open, LAY-000003 billed, INS-000005 open; two QA orders (one completed, one cancelled); QA coupon active; QA promo inactive; QA bank disabled; QA Outlet with its day closed balanced; QA cash/bank expenses and QA other income. The duplicate supplier and zero-stock barcode probe product were deleted through the UI. Settings inspected were left as found. The original Main 13 and 15 Oct days remain open; both 16 Oct QA-tested days are closed. All created record names carry `QA-2026-10-16` where the UI offered a name/notes field.
