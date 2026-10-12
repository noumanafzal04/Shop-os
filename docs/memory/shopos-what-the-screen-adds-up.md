---
name: shopos-what-the-screen-adds-up
description: STANDING (user, 2026-10-12) — every place a screen adds money up itself must be checked against the server by PRESSING the screen's own button with the screen's own figure; paying 999,999 in a test proves nothing. Settle sheet was wrong; audit of all money screens is owed.
metadata:
  type: feedback
---

**The user (2026-10-12), after I found the settle sheet's figure was wrong:** "to ye calculation hr jgah again check honi chahye — is tarhan to hmare system main or b bug ho skty … ye logics main hain jo tum ignore kr rhy."

**The bug that prompted it:** the dine-in Settle sheet estimated tax from the shop's default rate ("an over-estimate is safe"). A tab with tea at its own 18% was UNDER-estimated: "Take Rs 4,485", server wanted 4,611.90 → `PAYMENT_INSUFFICIENT`; the tab could not be settled from the screen. Every test that settled a tab paid `amount_paid: 999999`, and the e2e paid by API with the server's figure — the screen's own button with the screen's own figure was never pressed.

**Fix pattern (use it again):** the sale path can be ASKED. `CreateSaleAction` throws `App\Exceptions\SaleQuoted($figures)` when `quote_only` is set (our own switch, in no request's rules), at the first line the bill is known and before anything is written; `SettleTicketAction::worth()` runs the real settlement and the transaction rolls back. `POST /restaurant/tickets/{ticket}/settle/worth` → `{subtotal, discount, tax, total, tip, rounding, due}`. Panel: `dinein/settleSheet.ts` (asks/tenders, tested), `useSettleWorth` keyed `["tab-settle-worth", …]` APART from `["dine-in"]`, no figure shown while asking. Tests: `WhatATabWillAskForTest` (pays EXACTLY `due`).

**How to apply:**
- A test of a money screen pays the figure THE SCREEN shows, to the paisa, by pressing the screen's button — never a generous amount, never the server's figure fetched by API.
- OWED: an audit of every screen that adds money itself (till tender, take order "Approximately", exchange/refund, purchase order, quotation/invoice, job card, fuel, online checkout, khata/supplier payments, tab footer "+ tax at the bill"). List them from the code, check each against the server, fix by asking the server (the `worth` pattern) where they differ.
- Same family: [[shopos-a-size-is-said-everywhere]] (refund worth), [[shopos-ceiling-follows-the-bill]], [[shopos-the-print-window-holds-the-page]].
