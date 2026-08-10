<?php

namespace App\Actions\Restaurant;

use App\Exceptions\DomainException;
use App\Models\Product;
use App\Models\ProductUnit;
use App\Models\ProductVariant;
use App\Models\RestaurantTicket;
use App\Support\ModifierResolver;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Add lines to an open tab. Each line stores the RAW selection (so the bill is
 * re-priced server-authoritatively at settlement, exactly like a counter sale)
 * plus a DISPLAY snapshot for the running total. The snapshot is built with the
 * same shared pricing primitives the sale engine uses (Product::priceForLevel,
 * ProductUnit::priceUsing, ModifierResolver) — same orchestration OrderService
 * uses for online orders, so there is no second pricing implementation to drift.
 */
class AddTicketItemsAction
{
    public function __construct(private readonly TenantContext $context) {}

    public function execute(RestaurantTicket $ticket, array $data): RestaurantTicket
    {
        if (! $ticket->isOpen()) {
            throw DomainException::conflict('This tab is closed.', 'TICKET_NOT_OPEN');
        }

        $tenantId = $this->context->id();
        $tz = $this->context->get()?->timezone;

        DB::transaction(function () use ($ticket, $data, $tenantId, $tz): void {
            foreach ($data['items'] as $item) {
                /** @var Product|null $product */
                $product = Product::query()
                    ->whereKey($item['product_id'])
                    ->where('is_active', true)
                    ->first();

                if ($product === null) {
                    throw DomainException::unprocessable('An item is no longer available.', 'PRODUCT_UNAVAILABLE');
                }

                $variant = null;
                if (! empty($item['variant_id'])) {
                    $variant = ProductVariant::query()
                        ->whereKey($item['variant_id'])
                        ->where('product_id', $product->id)
                        ->first();
                    if ($variant === null || ! $variant->is_active) {
                        throw DomainException::unprocessable('An option is no longer available.', 'VARIANT_UNAVAILABLE');
                    }
                }

                // Ordering respects the food serving window (breakfast can't be
                // ordered at dinner). Once ordered it stays on the tab even past
                // the window — settlement skips this check.
                if (! $product->isAvailableNow($tz)) {
                    throw DomainException::unprocessable(
                        "{$product->name} isn't available right now — it's served "
                        .substr((string) $product->available_from, 0, 5).'–'.substr((string) $product->available_until, 0, 5).'.',
                        'ITEM_NOT_AVAILABLE_NOW',
                    );
                }

                $quantity = (float) $item['quantity'];

                $unit = null;
                if ($variant === null && ! empty($item['product_unit_id'])) {
                    $unit = ProductUnit::query()
                        ->whereKey($item['product_unit_id'])
                        ->where('product_id', $product->id)
                        ->first();
                    if ($unit === null) {
                        throw DomainException::unprocessable('A pack option is no longer available.', 'UNIT_UNAVAILABLE');
                    }
                }
                $factor = $unit !== null ? (float) $unit->factor : 1.0;

                if ($product->sold_by !== 'weight' && fmod($quantity, 1.0) !== 0.0) {
                    throw DomainException::unprocessable(
                        "\"{$product->name}\" is sold by unit — enter a whole quantity.",
                        'FRACTIONAL_QTY_NOT_ALLOWED',
                    );
                }

                $level = ($item['price_level'] ?? 'retail') === 'wholesale' ? 'wholesale' : 'retail';
                $levelUnit = $product->priceForLevel($level, $quantity);
                $basePrice = $unit !== null
                    ? $unit->priceUsing($levelUnit)
                    : ($variant !== null ? (float) $variant->price : $levelUnit);

                [$modifierDelta, $modifierSnapshot] = ModifierResolver::resolve(
                    $product,
                    $item['modifier_option_ids'] ?? [],
                );

                $unitPrice = round($basePrice + $modifierDelta, 2);
                $gross = round($unitPrice * $quantity, 2);

                $lineDiscount = 0.0;
                $pct = (float) ($item['line_discount_pct'] ?? 0);
                if ($pct > 0) {
                    $lineDiscount = round($gross * min($pct, 100) / 100, 2);
                } elseif (($amt = (float) ($item['line_discount'] ?? 0)) > 0) {
                    $lineDiscount = min(round($amt, 2), $gross);
                }

                $source = $variant ?? $product;

                $ticket->items()->create([
                    'tenant_id' => $tenantId,
                    // Raw selection (replayed at settlement).
                    'product_id' => $product->id,
                    'variant_id' => $variant?->id,
                    'product_unit_id' => $unit?->id,
                    'quantity' => $quantity,
                    'price_level' => $level,
                    'modifier_option_ids' => $item['modifier_option_ids'] ?? null,
                    'line_discount' => $pct > 0 ? 0 : $lineDiscount,
                    'line_discount_pct' => $pct > 0 ? $pct : null,
                    // Display snapshot.
                    'product_name' => $product->name,
                    'variant_name' => $variant?->name,
                    'unit_name' => $unit?->name,
                    'sku' => $variant?->sku ?? $product->sku,
                    'modifiers' => $modifierSnapshot ?: null,
                    'unit_price' => $unitPrice,
                    'unit_cost' => $source->cost !== null ? round((float) $source->cost * $factor, 2) : null,
                    'unit_factor' => $factor,
                    'line_total' => round($gross - $lineDiscount, 2),
                    'kot_status' => 'pending',
                    'note' => $item['note'] ?? null,
                ]);
            }
        });

        return $ticket->fresh(['table', 'items']);
    }
}
