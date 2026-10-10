<?php

namespace App\Support;

use App\Exceptions\DomainException;
use App\Models\Product;
use App\Models\ProductBarcode;
use App\Models\ProductUnit;
use App\Models\ProductVariant;

/**
 * ONE CODE, ONE THING ON THE SHELF.
 *
 * A shop scans a code and the till has to know, without asking, exactly what
 * came off the shelf. Four namespaces can answer a scan — a product's primary
 * barcode, its alternates, a variant's SKU, and a pack's barcode — and the
 * lookup consults them in that order, so a code that exists in two of them
 * silently rings whichever the lookup reaches first.
 *
 * This rule used to live inside `SyncProductBarcodesAction`, which was fine
 * while alternates were the only writer. Per-SIZE barcodes need the identical
 * check — a drinks shop puts a different EAN on the 500ml and the 1L, which is
 * the entire reason those codes are printed — so it moved here rather than
 * being written a second time. Two copies of "what makes a code free" is how
 * one of them ends up allowing a scan that rings the wrong line.
 */
class BarcodeNamespace
{
    /**
     * Put a code on ONE SIZE, or take it off.
     *
     * Lives here rather than in either writer because there are TWO paths that
     * create variants — `CreateProductAction` has its own loop and
     * `SyncProductVariantsAction` has another — and a barcode written in only
     * one of them is a code that exists after an edit and not after a create.
     * That is the shape this whole file is about: one rule, every path.
     *
     * A blank clears it. A shop that empties the box has said the packet no
     * longer carries that code.
     */
    public static function assign(Product $product, ProductVariant $variant, array $row): void
    {
        if (! array_key_exists('barcode', $row)) {
            return;
        }

        $barcode = trim((string) ($row['barcode'] ?? ''));

        ProductBarcode::query()
            ->where('product_id', $product->id)
            ->where('variant_id', $variant->id)
            ->delete();

        if ($barcode === '') {
            return;
        }

        self::assertFree($barcode, $product, $variant->id);

        ProductBarcode::query()->create([
            'tenant_id' => $product->tenant_id,
            'product_id' => $product->id,
            'variant_id' => $variant->id,
            'barcode' => $barcode,
        ]);
    }

    /**
     * Refuse a code that already means something else in this shop.
     *
     * `$exceptVariant` is the variant the code is being assigned TO: its own SKU
     * and its own existing barcode row must not count as clashes with itself.
     */
    public static function assertFree(
        string $barcode,
        Product $product,
        ?string $exceptVariant = null,
    ): void {
        $clashesPrimary = Product::query()
            ->where('barcode', $barcode)
            ->whereKeyNot($product->id)
            ->exists();

        $clashesAlternate = ProductBarcode::query()
            ->where('barcode', $barcode)
            ->where(function ($q) use ($product, $exceptVariant): void {
                $q->where('product_id', '!=', $product->id)
                    // A code on one of this item's own PACKS is not also a
                    // piece's or a size's: the first means twenty-four.
                    ->orWhereNotNull('product_unit_id')
                    ->orWhere(fn ($q) => $exceptVariant === null
                        ? $q->whereNotNull('variant_id')
                        : $q->whereNotNull('variant_id')->where('variant_id', '!=', $exceptVariant));
            })
            ->exists();

        $clashesVariant = ProductVariant::query()
            ->where('sku', $barcode)
            ->when($exceptVariant !== null, fn ($q) => $q->whereKeyNot($exceptVariant))
            ->exists();

        $clashesUnit = ProductUnit::query()->where('barcode', $barcode)->exists();

        if ($clashesPrimary || $clashesAlternate || $clashesVariant || $clashesUnit) {
            throw DomainException::unprocessable(
                "Barcode {$barcode} is already used as another item's code (product, variant, or pack).",
                'BARCODE_TAKEN',
            );
        }
    }

    /**
     * Refuse a second code for a PACK that already means something else.
     *
     * Stricter than the rule for a pack's first code, on purpose. That one has
     * always let a pack repeat its own item's barcode — the lookup reaches the
     * piece first, so nothing rings wrong, and refusing it now would stop a
     * shop saving an item it has had for a year. An EXTRA code has no history
     * to respect, so it gets the plain rule: one code, one thing. Not this
     * item's own barcode, not one of its other codes, not another pack's.
     *
     * `$exceptUnit` is the pack the code is being put ON: its own rows are
     * being replaced, and its own first code is no clash (a repeat of that is
     * dropped by the caller, not refused).
     */
    public static function assertFreeForPack(string $barcode, Product $product, ?string $exceptUnit): void
    {
        // Any item's own barcode — this one's included. The piece and the
        // carton cannot share a number: the till would have to guess.
        $clashesPrimary = Product::query()->where('barcode', $barcode)->exists();

        $clashesAlternate = ProductBarcode::query()
            ->where('barcode', $barcode)
            ->where(fn ($q) => $q->whereNull('product_unit_id')
                ->when($exceptUnit !== null, fn ($q) => $q->orWhere('product_unit_id', '!=', $exceptUnit)))
            ->exists();

        $clashesVariant = ProductVariant::query()->where('sku', $barcode)->exists();

        $clashesUnit = ProductUnit::query()
            ->where('barcode', $barcode)
            ->when($exceptUnit !== null, fn ($q) => $q->whereKeyNot($exceptUnit))
            ->exists();

        if ($clashesPrimary || $clashesAlternate || $clashesVariant || $clashesUnit) {
            $whose = $clashesPrimary && $product->barcode === $barcode
                ? "this item's own barcode — that one means a single piece"
                : 'already used as another code in your shop (an item, a size, or a pack)';

            throw DomainException::unprocessable("Barcode {$barcode} is {$whose}.", 'BARCODE_TAKEN');
        }
    }
}
