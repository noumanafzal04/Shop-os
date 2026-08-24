<?php

namespace App\Actions\Catalog;

use App\Exceptions\DomainException;
use App\Models\Product;
use App\Support\ItemTypes;

/**
 * Replaces a deal's component list. Each component must be a real product in
 * the same shop, can't be the deal itself, and can't be another deal (no
 * nested bundles). Quantities must be positive.
 */
class SyncComboItemsAction
{
    /** @param array<array{component_product_id?: string, variant_id?: ?string, quantity?: mixed}> $items */
    public function execute(Product $combo, array $items): void
    {
        $tenantId = $combo->tenant_id;

        $clean = collect($items)
            ->map(fn ($i) => [
                'component_product_id' => (string) ($i['component_product_id'] ?? ''),
                'variant_id' => ($i['variant_id'] ?? null) ?: null,
                'quantity' => (float) ($i['quantity'] ?? 1),
            ])
            ->filter(fn ($i) => $i['component_product_id'] !== '' && $i['quantity'] > 0)
            ->values();

        foreach ($clean as $i) {
            if ($i['component_product_id'] === $combo->id) {
                throw DomainException::unprocessable('A deal cannot contain itself.', 'COMBO_SELF_REFERENCE');
            }

            /** @var Product|null $component */
            $component = Product::query()->whereKey($i['component_product_id'])->first();
            if ($component === null) {
                throw DomainException::unprocessable('A deal component no longer exists.', 'COMBO_COMPONENT_MISSING');
            }
            if ($component->item_type === ItemTypes::DEAL) {
                throw DomainException::unprocessable('A deal cannot contain another deal.', 'COMBO_NESTED');
            }

            $this->sizeMustBeNamed($component, $i['variant_id']);
        }

        // The pair, not the product. "Two Small and one Large" is an ordinary
        // deal; "one Small and one Small" is somebody having typed the same line
        // twice, and the second would silently overwrite the first's quantity in
        // anybody's head.
        $pairs = $clean->map(fn ($i) => $i['component_product_id'].'|'.($i['variant_id'] ?? ''));
        if ($pairs->count() !== $pairs->unique()->count()) {
            throw DomainException::unprocessable(
                'The same item and size is listed twice in this deal.',
                'COMBO_DUPLICATE',
            );
        }

        $combo->comboItems()->delete();
        foreach ($clean as $sort => $i) {
            $combo->comboItems()->create([
                'tenant_id' => $tenantId,
                'component_product_id' => $i['component_product_id'],
                'variant_id' => $i['variant_id'],
                'quantity' => $i['quantity'],
                'sort_order' => $sort,
            ]);
        }
    }

    /**
     * A DEAL NOBODY CAN SELL SHOULD NOT BE SAVEABLE.
     *
     * A component with sizes has no single shelf to come off. The sale used to
     * find that out at the counter, in the worst possible way: it deducted
     * against the parent's `stock_quantity` — an orphaned leftover that is
     * always zero once a product has variants — and refused the sale with
     * "Insufficient stock: only 0 in stock" on a shop holding twenty.
     *
     * "Which pizza is in this deal" is a question only the shop can answer, and
     * answering it at sale time by guessing would mis-count a real shelf. So it
     * is asked here, once, where somebody is looking at the deal.
     */
    private function sizeMustBeNamed(Product $component, ?string $variantId): void
    {
        $sizes = $component->variants()->where('is_active', true)->pluck('id');

        if ($sizes->isEmpty()) {
            if ($variantId !== null) {
                throw DomainException::unprocessable(
                    "{$component->name} has no sizes, so a deal cannot name one.",
                    'COMBO_VARIANT_UNKNOWN',
                );
            }

            return;
        }

        if ($variantId === null) {
            throw DomainException::unprocessable(
                "Choose which {$component->name} this deal contains — it comes in sizes.",
                'COMBO_VARIANT_REQUIRED',
            );
        }

        if (! $sizes->contains($variantId)) {
            throw DomainException::unprocessable(
                "That size is not one of {$component->name}'s.",
                'COMBO_VARIANT_UNKNOWN',
            );
        }
    }
}
