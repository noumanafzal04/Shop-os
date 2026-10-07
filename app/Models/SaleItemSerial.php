<?php

namespace App\Models;

use App\Enums\SaleStatus;
use App\Models\Concerns\BelongsToTenant;
use App\Support\ShopDay;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One serialized unit sold — an IMEI/serial captured at the counter, with its
 * warranty window snapshotted from the sale. Looked up later for a warranty
 * claim; while it sits on a live (completed / partially-refunded) sale the
 * same serial can't be sold again (see CreateSaleAction's SERIAL_ALREADY_SOLD).
 */
class SaleItemSerial extends Model
{
    use BelongsToTenant, HasUuids;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'warranty_months' => 'integer',
            'warranty_expires_at' => 'date',
            'sold_at' => 'datetime',
            'returned_at' => 'datetime',
        ];
    }

    public function sale(): BelongsTo
    {
        return $this->belongsTo(Sale::class);
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class)->withTrashed();
    }

    /**
     * Still inside its warranty window (no window set = never under warranty).
     *
     * A date on a card, so it is read against the shop's own calendar: the
     * last day of cover is the whole of that day where the shop stands.
     */
    public function isUnderWarranty(): bool
    {
        return $this->warranty_expires_at !== null
            && $this->warranty_expires_at->toDateString() >= ShopDay::calendarToday();
    }

    /** Whole days of cover left, counting from the shop's today. Zero on the last day. */
    public function daysLeft(): int
    {
        if (! $this->isUnderWarranty()) {
            return 0;
        }

        return (int) CarbonImmutable::parse(ShopDay::calendarToday())
            ->diffInDays(CarbonImmutable::parse($this->warranty_expires_at->toDateString()));
    }

    /**
     * IS THIS UNIT STILL WITH WHOEVER BOUGHT IT ON THIS SALE?
     *
     * The warranty desk used to answer from the warranty dates alone. A phone
     * that had been brought back and refunded the same afternoon read "Under
     * warranty — 365 days left", with the name of a customer who no longer had
     * it: the shop's own stock, covered against the shop.
     *
     * A unit is out when it has not come back (`returned_at`) and the sale it
     * left on still stands. A sale that was cancelled, or refunded in full,
     * is not a sale anybody holds a warranty under.
     */
    public function isOut(): bool
    {
        if ($this->returned_at !== null) {
            return false;
        }

        return in_array($this->sale?->status, [SaleStatus::Completed, SaleStatus::PartiallyRefunded], true);
    }

    /** Covered: out with a customer AND inside its window. The answer a counter gives. */
    public function isCovered(): bool
    {
        return $this->isOut() && $this->isUnderWarranty();
    }

    /** Why it is not out — `returned` or `cancelled` — or null while it is. */
    public function cameBackAs(): ?string
    {
        if ($this->isOut()) {
            return null;
        }

        return $this->returned_at === null && $this->sale?->status === SaleStatus::Cancelled ? 'cancelled' : 'returned';
    }
}
