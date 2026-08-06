<?php

namespace App\Actions\Fuel;

use App\Exceptions\DomainException;
use App\Models\FuelPriceChange;
use App\Models\FuelTank;
use App\Models\Product;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * A government price notification lands and the forecourt reprices.
 *
 * Editing the product price directly would work and would be wrong. Fuel rates
 * move by order, usually at midnight, and a shift that straddles the change has
 * to value its litres at a rate that is still defensible weeks later when the
 * inspector or the owner asks. So the change is logged before it is applied,
 * append-only, and the close reads that log to mark any shift it crossed.
 */
class ChangeFuelPriceAction
{
    /**
     * @param  array{product_id: string, new_price: float|int|string, effective_at?: ?string, reason?: ?string}  $data
     */
    public function execute(User $user, array $data): FuelPriceChange
    {
        return DB::transaction(function () use ($user, $data): FuelPriceChange {
            /** @var Product $product */
            $product = Product::query()->whereKey($data['product_id'])->lockForUpdate()->firstOrFail();

            // Only what a tank actually holds. Repricing a bottle of engine oil
            // through the fuel-notification log would put a shelf item into a
            // history that exists to explain forecourt valuations.
            $isFuel = FuelTank::query()->where('product_id', $product->id)->exists();

            if (! $isFuel) {
                throw DomainException::unprocessable(
                    "{$product->name} isn't held in a tank — change its price on the product itself.",
                    'NOT_A_FUEL_PRODUCT',
                );
            }

            $newPrice = round((float) $data['new_price'], 2);

            if ($newPrice <= 0) {
                throw DomainException::unprocessable('A fuel rate has to be more than zero.', 'INVALID_PRICE');
            }

            $oldPrice = round((float) $product->price, 2);

            if ($oldPrice === $newPrice) {
                throw DomainException::unprocessable(
                    "{$product->name} is already at {$newPrice}.",
                    'PRICE_UNCHANGED',
                );
            }

            $change = FuelPriceChange::query()->create([
                'product_id' => $product->id,
                'old_price' => $oldPrice,
                'new_price' => $newPrice,
                'effective_at' => $data['effective_at'] ?? now(),
                'changed_by' => $user->id,
                'reason' => $data['reason'] ?? null,
            ]);

            $product->update(['price' => $newPrice]);

            return $change->fresh('product');
        });
    }
}
