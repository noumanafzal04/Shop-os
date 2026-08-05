<?php

namespace App\Models;

use App\Enums\RestaurantTicketStatus;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A running tab. Items accumulate on it over a meal; each "send to kitchen"
 * fires a KitchenTicket; settlement rings the items through a Sale.
 */
class RestaurantTicket extends BaseModel
{
    use BelongsToTenant;

    /** Expose the live running total on every serialization. */
    protected $appends = ['running_total'];

    protected function casts(): array
    {
        return [
            'status' => RestaurantTicketStatus::class,
            'guest_count' => 'integer',
            'opened_at' => 'datetime',
            'closed_at' => 'datetime',
            'merged_at' => 'datetime',
        ];
    }

    public function table(): BelongsTo
    {
        return $this->belongsTo(DiningTable::class, 'dining_table_id');
    }

    /**
     * Who is serving this table. Distinct from created_by on purpose: the host
     * at the door often opens the tab, and attributing the evening's covers and
     * takings to the host instead of the waiter would make the service report
     * useless.
     */
    public function waiter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'waiter_id');
    }

    /** The tab this one was folded into, when two parties became one bill. */
    public function mergedInto(): BelongsTo
    {
        return $this->belongsTo(self::class, 'merged_into_id');
    }

    public function items(): HasMany
    {
        return $this->hasMany(RestaurantTicketItem::class, 'ticket_id');
    }

    public function kitchenTickets(): HasMany
    {
        return $this->hasMany(KitchenTicket::class, 'ticket_id')->orderBy('kot_number');
    }

    public function sale(): BelongsTo
    {
        return $this->belongsTo(Sale::class);
    }

    public function isOpen(): bool
    {
        return $this->status === RestaurantTicketStatus::Open;
    }

    /** Non-void items only (void items don't count toward the bill or KOT). */
    public function liveItems(): Collection
    {
        return $this->items->whereNull('voided_at')->values();
    }

    /** The running subtotal (non-void snapshot line totals). */
    public function runningTotal(): float
    {
        return round((float) $this->liveItems()->sum(fn ($i) => (float) $i->line_total), 2);
    }

    public function getRunningTotalAttribute(): float
    {
        return $this->runningTotal();
    }
}
