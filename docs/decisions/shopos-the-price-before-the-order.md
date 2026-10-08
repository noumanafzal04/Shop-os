# The whole price, before the order

**2026-10-08 · found by the online shop's journey, stage P**

## The faults

Stage P is the first time an order was walked from a stranger's browser to the
shop's screen and back in a real browser. The order machinery — stages, rider,
the sale on completion, the rider's settlement, a customer cancelling — was
right. What the customer was TOLD was not.

| What a customer met | Why |
|---|---|
| **The checkout never said what delivery costs.** "Each shop adds its own delivery charge… you pay on delivery"; the total on screen was the items. The price was learnt from the order afterwards | the checkout never asked the shop anything |
| **The shop's minimum for delivery and its free-delivery threshold were on the wire and on no screen.** A basket below the minimum was sent and refused: "Minimum order for delivery is 1,000 — add a bit more" — no currency, no figure for the bit | `free_delivery_threshold`, `min_order_amount` declared on `PublicShop`, read by nobody |
| The checkout offered "Deliver to me" and "I'll collect it" whatever the shop does | the shop's `fulfillment` was never read |
| The shop's kind of business printed as its key: `online_boutique` | `business_category` is a key; no label was sent |
| My orders: the lines did not add up to the total (delivery and a coupon on no line), and the status was the code — "pending", "out for delivery" | a raw `status.replace("_", " ")` |

## Now

- `marketplace/orderTerms.ts` — `orderFigures(subtotal, how, terms)`: the
  server's own arithmetic (`OrderService`) said in advance — delivery added
  unless collected or earned free, the minimum for delivery only, and how much
  more makes delivery free.
- **Checkout** fetches each shop's terms (the same query its page makes):
  only the ways the shop hands over; Items, Delivery (or Free), "Add Rs N more
  and delivery is free"; "Minimum order for delivery is Rs 1,000 — add Rs 100
  more, or collect it" and Place waits; **Total** includes delivery
  (`data-testid="checkout-total"`).
- **The shop's page** says Minimum order and Free delivery above.
- **Server**: `BusinessTypes::categoryLabel()`; the shop payload carries
  `business_category_label`; the minimum refusal names the rupees and the
  shortfall: "Minimum order for delivery is Rs 1,000 — add Rs 100 more, or
  collect it."
- **My orders**: Delivery and Coupon lines; `orderFlow.customerSays()` —
  Waiting for the shop, Accepted, Being prepared, Ready / Ready to collect, On
  the way, Delivered / Collected, Cancelled.

## Not changed, on purpose

- **A completed order's sale is the goods.** The delivery charge stays on the
  order and is the rider's: the rider brings back the whole amount, and the
  settlement says how much of it the rider earned (`OrderService::complete`,
  `RiderService::settle`). Stage P asserts exactly that.
- A coupon is still applied by the server at placement; the checkout total says
  "a coupon comes off this".

## Tests

Backend `FulfillmentConfigTest` +3. Panel `orderTerms.test.ts` (6),
`orderFlow.test.ts` (+3), `webParity.test.ts` follows the checkout's `how`.
Journey stage P 7/7; P2, P3 and P3b are lived every run (nothing is placed
twice) and carry the browser mutations.
