<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * One bank campaign — "HBL Ramadan 10%".
 *
 * Separate from the bank itself because a bank is a relationship kept for years
 * and an offer is a campaign replaced every few months. Folding them together
 * would mean either re-typing the bank every Ramadan or editing history.
 *
 * Carries the same four window fields as `Promotion` and is judged by the same
 * code — `App\Support\OfferWindow`. That is deliberate: two implementations of
 * "is it Friday yet" drift, and this codebase has already paid for that once.
 */
class BankCardOffer extends Model
{
    use BelongsToTenant, HasUuids, SoftDeletes;

    public const TYPE_PERCENT = 'percent';

    public const TYPE_FIXED = 'fixed';

    public const TYPES = [self::TYPE_PERCENT, self::TYPE_FIXED];

    /** What a card can be. Empty/null on an offer means "any card". */
    public const CARD_TYPES = ['credit', 'debit'];

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'value' => 'decimal:2',
            'min_spend' => 'decimal:2',
            'max_discount' => 'decimal:2',
            'card_types' => 'array',
            'days_of_week' => 'array',
            'starts_on' => 'date',
            'ends_on' => 'date',
            'priority' => 'integer',
            'is_active' => 'boolean',
        ];
    }

    public function bank(): BelongsTo
    {
        return $this->belongsTo(Bank::class);
    }

    public function scopeLive(Builder $query): Builder
    {
        return $query->where('is_active', true);
    }

    /**
     * Does this offer cover the card that was tapped?
     *
     * No `card_types` means any card, which is both the commonest deal and the
     * safe reading of a field nobody filled in. An offer restricted to credit
     * cards, asked about a card whose type nobody recorded, says NO — the shop
     * would otherwise file a claim the bank rejects, and discover it a month
     * later with the money already given away.
     */
    public function coversCardType(?string $cardType): bool
    {
        $allowed = $this->card_types ?? [];

        return $allowed === [] || ($cardType !== null && in_array($cardType, $allowed, true));
    }
}
