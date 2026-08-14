<?php

namespace App\Support;

use App\Models\BranchStock;
use App\Models\Product;
use Illuminate\Support\Collection;

/**
 * What a till is given about the things it sells.
 *
 * This is the ONE place the shape is decided, and it is a PROJECTION rather
 * than a copy. Everything a counter needs to ring an item up is here;
 * everything else is deliberately absent, because a device is a thing that gets
 * stolen, lent out and handed to a stranger, and its browser storage is
 * readable by anyone holding it.
 *
 * ── What is never sent, and why ─────────────────────────────────────────
 *
 *  `cost`          The buying price. `HidesCostPrice` exists precisely so a
 *                  cashier cannot read it; caching it would hand the whole
 *                  margin sheet to anyone who opens DevTools, and the shop's
 *                  entire pricing book to whoever picks the tablet up.
 *  `description`   Up to 5,000 characters each. Search runs on name, SKU,
 *                  barcode and category, so it buys nothing and costs the
 *                  largest field in the table.
 *  supplier links  Who a shop buys from, and for how much, is not counter
 *                  information.
 *  other branches  A till sells from where it stands.
 *
 * ── Readable keys rather than short ones ────────────────────────────────
 *
 * Short keys would trim roughly 30% off the bytes at rest. At 20,000 items that
 * is 9 MB against 6 MB — both irrelevant against a browser quota measured in
 * gigabytes, and both compress to well under a megabyte on the wire. Legibility
 * of a payload two engines have to agree about is worth far more than either
 * number.
 */
class PosProjection
{
    /**
     * Item types and capabilities that cannot be sold without the server.
     *
     * Read by the till in Phase 3; carried from Phase 1 so the projection's
     * shape never has to change under devices that already hold it — a changed
     * shape means every tablet in every shop bootstraps again.
     *
     * The axis is the ITEM, not the trade. A pharmacy sells shampoo, nappies
     * and baby food, and there is no reason those cannot be rung up offline; a
     * trade-shaped rule would forbid the whole shop. And where a trade rule
     * would be right it is already redundant, because BusinessTypes::itemTypesFor
     * stops a mart ever holding a medicine in the first place.
     */
    public static function sellableOffline(Product $product): bool
    {
        // A medicine needs live batch quantities, FEFO order and the expiry
        // fence. Selling expired stock offline is a regulatory event.
        if ($product->item_type === ItemTypes::MEDICINE) {
            return false;
        }

        // One specific handset. Two tills would sell the same IMEI.
        if ($product->tracks_serial) {
            return false;
        }

        return true;
    }

    /**
     * One catalog row, flattened.
     *
     * `$stockByTarget` maps "productId" and "productId:variantId" to the
     * on-hand quantity AT THIS BRANCH — passed in rather than queried per row,
     * because a catalog of 20,000 items would otherwise be 20,000 queries.
     */
    public static function item(Product $product, array $stockByTarget = []): array
    {
        $stock = static fn (string $key): float => (float) ($stockByTarget[$key] ?? 0);

        return [
            'id' => $product->id,
            'name' => $product->name,
            'sku' => $product->sku,
            'barcode' => $product->barcode,
            'plu_code' => $product->plu_code,
            'category_id' => $product->category_id,
            'item_type' => $product->item_type,
            'unit' => $product->unit,
            'sold_by' => $product->sold_by,

            // Selling prices only. Every one of these is a number a customer
            // could be charged; none is a number a competitor could use.
            'price' => (float) $product->price,
            'discount_price' => $product->discount_price === null ? null : (float) $product->discount_price,
            'wholesale_price' => $product->wholesale_price === null ? null : (float) $product->wholesale_price,
            'price_tiers' => $product->price_tiers,
            'min_order_qty' => $product->min_order_qty === null ? null : (float) $product->min_order_qty,
            'tax_rate' => $product->tax_rate === null ? null : (float) $product->tax_rate,
            'tax_group_id' => $product->tax_group_id,

            // A local ESTIMATE, for showing the cashier what is on the shelf.
            // Never authoritative: the till only ever DECREMENTS it, and the
            // server derives the real movements from the sales it receives.
            'track_inventory' => (bool) $product->track_inventory,
            'stock' => $stock($product->id),
            'low_stock_threshold' => $product->low_stock_threshold === null ? null : (float) $product->low_stock_threshold,

            // Menu hours, so a breakfast item cannot be rung at dinner.
            'available_from' => $product->available_from,
            'available_until' => $product->available_until,

            // Flags the counter behaves on. `drug_schedule` and
            // `requires_prescription` are here so the till can REFUSE, not so
            // it can proceed.
            'requires_prescription' => (bool) $product->requires_prescription,
            'drug_schedule' => $product->drug_schedule,
            'tracks_serial' => (bool) $product->tracks_serial,
            'kitchen_station' => $product->kitchen_station,

            'offline_ok' => static::sellableOffline($product),

            'variants' => $product->relationLoaded('variants')
                ? $product->variants->map(fn ($v): array => [
                    'id' => $v->id,
                    'name' => $v->name,
                    'sku' => $v->sku,
                    'price' => (float) $v->price,
                    'stock' => $stock("{$product->id}:{$v->id}"),
                ])->values()->all()
                : [],

            // Pack sizes — a strip, a box, a carton.
            'units' => $product->relationLoaded('units')
                ? $product->units->map(fn ($u): array => [
                    'id' => $u->id,
                    'name' => $u->name,
                    'factor' => (float) $u->factor,
                    'price' => $u->price === null ? null : (float) $u->price,
                    'barcode' => $u->barcode,
                ])->values()->all()
                : [],

            // Alternate codes. The primary `barcode` above is separate.
            'barcodes' => $product->relationLoaded('barcodes')
                ? $product->barcodes->pluck('barcode')->values()->all()
                : [],

            'modifier_groups' => $product->relationLoaded('modifierGroups')
                ? $product->modifierGroups->map(fn ($g): array => [
                    'id' => $g->id,
                    'name' => $g->name,
                    'type' => $g->type,
                    'min_select' => $g->min_select,
                    'max_select' => $g->max_select,
                    'options' => $g->options->map(fn ($o): array => [
                        'id' => $o->id,
                        'name' => $o->name,
                        'price_delta' => (float) $o->price_delta,
                    ])->values()->all(),
                ])->values()->all()
                : [],
        ];
    }

    /**
     * A row saying an item is GONE.
     *
     * Products are soft-deleted, so a plain "changed since" query never carries
     * a deletion and a removed item would stay sellable on every device that
     * already holds it — forever. The tombstone is the only thing that takes it
     * off a till.
     */
    public static function tombstone(Product $product): array
    {
        return ['id' => $product->id, 'deleted' => true];
    }

    /**
     * On-hand quantities at ONE branch, keyed for `item()`.
     *
     * Keys are "productId" for an unvaried item and "productId:variantId" for a
     * variant, which is the same shape the till uses when it decrements.
     *
     * @param  Collection<int, string>|array<int, string>  $productIds
     */
    public static function stockAt(?string $branchId, iterable $productIds): array
    {
        $ids = collect($productIds)->all();
        if ($ids === []) {
            return [];
        }

        return BranchStock::query()
            ->where('branch_id', $branchId)
            ->whereIn('product_id', $ids)
            ->get(['product_id', 'variant_id', 'quantity'])
            ->mapWithKeys(fn ($row): array => [
                $row->variant_id === null
                    ? $row->product_id
                    : "{$row->product_id}:{$row->variant_id}" => (float) $row->quantity,
            ])
            ->all();
    }

    /** Relations `item()` reads. Eager-load these or every row is a query. */
    public const RELATIONS = ['variants', 'units', 'barcodes', 'modifierGroups.options'];
}
