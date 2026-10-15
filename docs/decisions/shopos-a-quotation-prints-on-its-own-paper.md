# A quotation prints on its own paper; one number is one customer

Date: 2026-10-15. The user's answers on paper; bugs L7 and L8 from the user's question "existing customer ko
again quote or advance ka process?".
Code: backend `offline/v1/backend`, panel `offline/v1/admin-panel` (see the commits that name these).

## Paper (the user's decision)

Before: one shop setting, `receipt_width` (standard / thermal_80 / thermal_58), was used by receipts AND by
quotations, advance slips and job cards. A shop on an 80mm till printed its estimates on a curl of thermal
paper. The document print endpoint already accepted `?paper=`, and the panel never sent it.

The user chose (2026-10-15): a separate setting with a default the shop sets; at the till no question — it
prints on the setting; when printing from the document, a box to choose, with the setting already picked.

- `document_paper` (standard = A4 sheet, thermal_80, thermal_58), default `standard`. Settings → Receipt →
  "Quotations & advances print on", under "Receipt size".
- `documents/show.blade.php` reads `?paper` first, then `document_paper` — no longer `receipt_width`.
- The till and the Quotations screen print a saved quotation / advance on the setting, without asking.
- The document page's Print opens `PrintPaperModal`: A4 sheet / 80mm roll / 58mm roll, the shop's paper
  picked each time it opens; another choice is for that copy only, and the box says so.
- Receipts are unchanged: `receipt_width`, or a till lane's own printer.

Note for existing shops: one whose receipts are on a roll now prints its quotations on A4 until it changes the
new setting (Zari: receipts 80mm, quotations now A4) — the user's chosen default.

## One number is one customer (L7)

Every path that names a customer keys off the phone — the khata, the group price, the loyalty balance, a quote,
an advance — and it was matched exactly as typed, while the till's own box suggests "03xx-xxxxxxx". So
"0300-1234567" and "03001234567" were two customers, and their history split between them.

`Customer::phoneKey` (digits only; +92 / 0092 / a 12-digit 92… is the 0 form) and `Customer::byPhone`: the
customer stored exactly so first, then one whose number is the same with other separators (narrowed in SQL by
the last seven digits with `- ( ) + space` removed, decided in PHP on the whole number; the oldest wins where a
shop already holds two). Nothing stored is rewritten. Used by `capture` (sales, quotes, advances, orders, a
vehicle's owner), the till's `customers-lookup`, the group price and the loyalty balance in `CreateSaleAction`.
The customer form (store and update) refuses a number already on file written another way, naming whose it is.

Kept as it was: a name typed against an existing number renames the customer (the existing design,
`CustomerCrmTest`). Asked as Q11.

## Finding somebody already on file (L8)

The till's Customer box and the quotation/advance form were two empty boxes. `customers-lookup?q=` (the
counter's own look-up — `sales.manage`, Customers module) now returns up to six matches by name or number from
three characters: id, name and number only, because it answers a cashier who may not hold the customers
permission and so must carry nothing the phone look-up does not already show. `CustomerSuggestions` lists them
under the two boxes ("Already on file"); a tap fills both. Not shown without the module, offline, or once the
boxes hold the person found.

## Proof

- `SaleDocumentTest::test_a_quotation_prints_on_its_own_paper_not_the_till_roll` (mutation back to
  `receipt_width` caught); `PrintPaperModal.test.tsx` (3; 2 of 3 mutations caught, the third is equivalent).
- `ACustomerIsFoundHoweverTheNumberIsWrittenTest` (5 tests): quote, advance (+92), sale (92…), the till's
  look-up, the form's refusal, a different number, a blank name filled, the counter's search (by name, by a
  number typed without its dash, by the 0 form of a +92 number; nothing from two letters; only id/name/phone).
  Mutations: 6 + 4 caught. `CustomerSuggestions.test.tsx` (4; 4 mutations caught).
- Walked on the copy: `qa-kit/p6-paper.mjs` (setting saved 80mm; the page's box opened on 80mm; 58mm sent
  `?paper=thermal_58`; put back to A4), `qa-kit/p6-customer-find.mjs` (till and quotation form: "Walk" and
  "0300-123" each listed QA Walk Layaway; a tap filled both boxes).
