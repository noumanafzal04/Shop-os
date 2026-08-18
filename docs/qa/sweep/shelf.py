"""
Which shelf the sweep is reading.

`products.stock_quantity` is a ROLLUP — the sum across every branch, kept in
step by InventoryService. That is correct, and it is not the number these
phases mean. They sell, adjust and count at ONE branch (Main, since they run as
the owner with no branch header), so they have to read Main's own figure.

The sweep read the rollup for eleven phases and was right every time, because
there was only one branch. The moment phase K opened a second one, the writes
went to Main and the reads came back as Main + second — and the sweep reported
`SET MEANS SET — asked for 42, shelf says 76`. It also stopped restocking,
because a rollup of 85 looks healthy while the shelf being sold from is at −1.

A number that was right for eleven phases and wrong for the twelfth was never
right; it was under-determined.
"""

from api import Api


def rollup(api: Api, token: str, product_id: str) -> float | None:
    """
    Every branch's stock added together — and the right number for exactly one
    thing: weighting the moving cost.

    `products.cost` is per PRODUCT, not per branch, so receiving at a new price
    blends against everything the shop holds anywhere. Reading Main's shelf
    there gives a denominator that is too small and a cost that looks wrong by
    a few rupees — which is the hardest kind of wrong to notice.

    The shelf and the cost are both "stock" and they are different questions.
    """
    status, body = api.get(f"/products/{product_id}", token=token)
    if status != 200:
        return None
    q = (body.get("data") or {}).get("stock_quantity")
    return None if q is None else float(q)


def on_hand(api: Api, token: str, product_id: str) -> float | None:
    """What is on the shelf this token actually sells from."""
    status, body = api.get(f"/products/{product_id}/branch-stock", token=token)
    if status == 200:
        rows = body.get("data") or []
        rows = rows if isinstance(rows, list) else rows.get("data", [])
        main = next((r for r in rows if r.get("is_default")), None)
        if main is not None:
            return float(main.get("quantity") or 0)

    # Single-branch shops, and any tenant without the inventory module, have no
    # branch-stock rows to read. The rollup IS the shelf there.
    status, body = api.get(f"/products/{product_id}", token=token)
    if status != 200:
        return None
    q = (body.get("data") or {}).get("stock_quantity")
    return None if q is None else float(q)
