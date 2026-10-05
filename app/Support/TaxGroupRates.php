<?php

namespace App\Support;

use App\Models\Product;

/**
 * WHAT RATE A TAX GROUP CHARGES, asked once per request.
 *
 * ── Why this exists ──────────────────────────────────────────────────
 *
 * A product on a tax group is taxed at the GROUP's rate — the group wins even
 * when the product carries a raw `tax_rate` of its own. `CreateSaleAction`
 * has always known that. The till did not: every product payload carried
 * `tax_group_id` and none carried the rate behind it, and the one endpoint
 * that could translate the id sits behind `products.manage`, which a cashier
 * does not hold.
 *
 * So the counter screen fell back to the shop's default rate, showed
 * "Amount due Rs 12,610", and the sale was refused: *"Amount paid (12,610.00)
 * is less than the total (14,023.94)."* On a database where 17,140 products
 * are on a tax group and 124 carry a rate of their own, that is not an edge
 * case — it is nearly every sale.
 *
 * The fix is that a product SAYS what it will be charged at. This class is
 * what makes that cheap: a page of a hundred products usually shares two or
 * three groups, so the rate is read once per group per request rather than
 * once per row, and no controller has to remember to eager-load anything.
 *
 * ── Scoped, and it forgets when a group is written ───────────────────
 *
 * Bound `scoped`, so it lives for one request (and one test). A group that is
 * re-rated mid-request would otherwise be answered from memory at the old
 * rate — on the money path, which reads through here too. `TaxGroup` calls
 * `forget()` on save and delete, so the next read is the database's.
 */
class TaxGroupRates
{
    /** @var array<string, float|null> */
    private array $rates = [];

    /**
     * The group rate this product will be taxed at, or null when it is not on
     * a group (or the group is gone).
     *
     * Read through the product's OWN relation rather than by a bare id. That
     * keeps the lookup inside whatever tenant fence the relation already has
     * — this class must never become a way to read another shop's rates.
     */
    public function for(Product $product): ?float
    {
        $id = $product->tax_group_id;

        if ($id === null) {
            return null;
        }

        // Already in hand — an eager-loaded relation is the freshest answer
        // and costs nothing.
        if ($product->relationLoaded('taxGroup')) {
            $rate = $product->taxGroup?->rate;

            return $this->rates[$id] = $rate === null ? null : (float) $rate;
        }

        if (! array_key_exists($id, $this->rates)) {
            $rate = $product->taxGroup()->value('rate');
            $this->rates[$id] = $rate === null ? null : (float) $rate;
        }

        return $this->rates[$id];
    }

    public function forget(): void
    {
        $this->rates = [];
    }
}
