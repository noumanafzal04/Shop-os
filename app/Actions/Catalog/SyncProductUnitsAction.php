<?php

namespace App\Actions\Catalog;

use App\Exceptions\DomainException;
use App\Models\Product;
use App\Models\ProductBarcode;
use App\Models\ProductUnit;
use App\Support\BarcodeNamespace;
use Illuminate\Support\Collection;

/**
 * Sets a product's pack units (pack-breaking). Each pack maps to a number of
 * base units (factor > 1) and may carry its own barcode — which, like a
 * product barcode, must resolve to exactly one item, so it's checked against
 * every other product's primary/alternate barcodes and packs.
 *
 * ── A PACK KEEPS ITS IDENTITY ───────────────────────────────────────────
 *
 * This used to delete every pack and write the list again, on every save of
 * the item — whatever had changed. Correcting a spelling in the description
 * gave the Carton a new id.
 *
 * Nothing in the catalogue minded, because a pack is found by its parent. But
 * a pack's id is what a sale carries (`product_unit_id`), and three things
 * hold one for longer than a moment:
 *
 *   a till's cart, and a tablet's offline catalogue   refused at the counter,
 *                                                     or when the queue synced:
 *                                                     "A pack unit in this sale
 *                                                     is no longer available"
 *   a quotation waiting to be turned into a bill      the same, days later
 *   a purchase order line                             left pointing at a pack
 *                                                     that no longer exists
 *
 * — for a carton that was on the shelf the whole time. So a pack in the list
 * is matched to the one already there, by its id when the caller sends one
 * and by its NAME when it does not (the import, an older panel), and is
 * updated where it stands. Only a pack that has left the list is removed.
 *
 * ── AND MAY CARRY MORE THAN ONE CODE ────────────────────────────────────
 *
 * `barcodes` on a pack is every other code printed on it. Absent means the
 * caller did not say — the pack keeps what it has. Present, even empty, is
 * the whole list. The distinction is what lets a spreadsheet import, which
 * knows nothing of them, pass through without wiping every carton's second
 * code.
 */
class SyncProductUnitsAction
{
    /** @param array<array{id?: mixed, name?: string, factor?: mixed, price?: mixed, barcode?: mixed, barcodes?: mixed}> $units */
    public function execute(Product $product, array $units): void
    {
        $tenantId = $product->tenant_id;

        $clean = collect($units)
            ->map(function ($u): array {
                $barcode = isset($u['barcode']) && trim((string) $u['barcode']) !== '' ? trim((string) $u['barcode']) : null;

                return [
                    'id' => isset($u['id']) && is_string($u['id']) && $u['id'] !== '' ? $u['id'] : null,
                    'name' => trim((string) ($u['name'] ?? '')),
                    'factor' => (float) ($u['factor'] ?? 0),
                    'price' => isset($u['price']) && $u['price'] !== '' && $u['price'] !== null ? (float) $u['price'] : null,
                    'barcode' => $barcode,
                    // null = not said; a list = exactly these.
                    'barcodes' => array_key_exists('barcodes', $u) ? self::others($u['barcodes'], $barcode) : null,
                ];
            })
            ->filter(fn ($u) => $u['name'] !== '' && $u['factor'] > 0)
            ->values();

        // A pack factor of 1 would just duplicate the base unit — reject it so
        // "1 tablet = 1 tablet" packs can't muddy pricing/stock maths.
        foreach ($clean as $u) {
            if ($u['factor'] <= 1) {
                throw DomainException::unprocessable(
                    "Pack \"{$u['name']}\" must hold more than one base unit.",
                    'UNIT_FACTOR_INVALID',
                );
            }
        }

        // Pack barcodes share the shop-wide barcode namespace (POS scans them).
        foreach ($clean->pluck('barcode')->filter() as $barcode) {
            $clash = Product::query()->where('barcode', $barcode)->whereKeyNot($product->id)->exists()
                || ProductBarcode::query()->where('barcode', $barcode)->where('product_id', '!=', $product->id)->exists()
                || ProductUnit::query()->where('barcode', $barcode)->where('product_id', '!=', $product->id)->exists();

            if ($clash) {
                throw DomainException::unprocessable(
                    "Barcode {$barcode} is already used by another product.",
                    'BARCODE_TAKEN',
                );
            }
        }

        // One code on two cartons of the same item is the till guessing which.
        // (The namespace check below would refuse the second of them anyway,
        // as "already used"; said here it names what is actually wrong.)
        $twice = $clean->flatMap(fn ($u) => $u['barcodes'] ?? [])->duplicates()->first();
        if ($twice !== null) {
            throw DomainException::unprocessable(
                "Barcode {$twice} is on two packs of this item. A code means one pack.",
                'BARCODE_TAKEN',
            );
        }

        /** @var Collection<int, ProductUnit> $existing */
        $existing = $product->units()->get();
        $kept = [];
        $packs = [];

        foreach ($clean as $i => $u) {
            $unit = $this->theSamePack($existing, $u, $kept);
            $fields = [
                'name' => $u['name'],
                'factor' => $u['factor'],
                'price' => $u['price'],
                'barcode' => $u['barcode'],
                'sort_order' => $i,
            ];

            if ($unit !== null) {
                $unit->fill($fields)->save();
            } else {
                $unit = $product->units()->create(['tenant_id' => $tenantId] + $fields);
            }

            $kept[] = $unit->id;
            $packs[] = [$unit, $u['barcodes']];
        }

        // Whatever has left the list. Its codes go with it: the pack is only
        // soft-deleted, which no foreign key notices, and a code left behind
        // would be taken for ever by a carton nobody stocks.
        $gone = $existing->reject(fn (ProductUnit $e) => in_array($e->id, $kept, true));
        if ($gone->isNotEmpty()) {
            ProductBarcode::query()->whereIn('product_unit_id', $gone->pluck('id'))->delete();
            ProductUnit::query()->whereKey($gone->pluck('id'))->delete();
        }

        // Every pack that said its codes has its old ones cleared FIRST, and
        // only then is anything checked — so a code moved from the Carton to
        // the Case in one save is not refused for still being on the Carton.
        foreach ($packs as [$unit, $codes]) {
            if ($codes !== null) {
                ProductBarcode::query()->where('product_unit_id', $unit->id)->delete();
            }
        }

        foreach ($packs as [$unit, $codes]) {
            foreach ($codes ?? [] as $code) {
                BarcodeNamespace::assertFreeForPack($code, $product, $unit->id);

                ProductBarcode::query()->create([
                    'tenant_id' => $tenantId,
                    'product_id' => $product->id,
                    'product_unit_id' => $unit->id,
                    'barcode' => $code,
                ]);
            }
        }
    }

    /**
     * The pack already on this item that a row of the list IS — or null for a
     * new one.
     *
     * By id first. Then by name, case apart, because a caller that sends no id
     * (the import merges by name; an older panel sent none) still means the
     * Carton when it says "Carton". Never the same pack twice.
     *
     * @param  Collection<int, ProductUnit>  $existing
     * @param  array{id: ?string, name: string}  $row
     * @param  list<string>  $kept
     */
    private function theSamePack(Collection $existing, array $row, array $kept): ?ProductUnit
    {
        $free = $existing->reject(fn (ProductUnit $e) => in_array($e->id, $kept, true));

        return ($row['id'] !== null ? $free->firstWhere('id', $row['id']) : null)
            ?? $free->first(fn (ProductUnit $e) => mb_strtolower(trim($e->name)) === mb_strtolower($row['name']));
    }

    /**
     * A pack's OTHER codes, tidied: trimmed, no blanks, no repeats, and never
     * its own first code said again.
     *
     * @return list<string>
     */
    private static function others(mixed $codes, ?string $first): array
    {
        return collect(is_array($codes) ? $codes : [])
            ->map(fn ($code) => is_scalar($code) ? trim((string) $code) : '')
            ->filter(fn (string $code) => $code !== '' && $code !== $first)
            ->unique()
            ->values()
            ->all();
    }
}
