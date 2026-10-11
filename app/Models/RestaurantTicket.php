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
    /**
     * A floor row always belongs to a site.
     *
     * Defaulted here rather than at each call site because the floor is written
     * from several — the tables controller, OpenTicketAction, FireKitchenTicket,
     * a seeder, a test fixture — and a row that slips through with no branch is
     * invisible on every branch-scoped screen, which is a worse failure than
     * being on the wrong one. Anything that DOES know its branch (a tab takes
     * its table's, a KOT takes its tab's) sets it before this runs and is left
     * alone.
     */
    protected static function booted(): void
    {
        static::creating(function (self $row): void {
            if ($row->branch_id !== null || $row->tenant_id === null) {
                return;
            }

            $row->branch_id = Branch::withoutTenancy()
                ->where('tenant_id', $row->tenant_id)
                ->where('is_default', true)
                ->value('id');
        });
    }

    use BelongsToTenant;

    /** Expose the live running total on every serialization. */
    protected $appends = ['running_total'];

    protected function casts(): array
    {
        return [
            'status' => RestaurantTicketStatus::class,
            'guest_count' => 'integer',
            // Was never a tab: rung at the till, paid before the kitchen saw
            // it. The floor filters on this and the pass closes on it.
            'from_counter' => 'boolean',
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

    /**
     * WHERE THIS ORDER GOES — what a cook calls out and a runner carries it to.
     *
     * A table's own name, for a tab on the floor. An order rung at the counter
     * "for here" has no table row: all there is to go on is the number the
     * cashier typed onto the sale, which is all a café with two tables outside
     * has ever had. Null where there is nowhere to carry it — a takeaway.
     *
     * One answer for the board and the printed slip, so the screen and the
     * paper cannot send the same cup to two places.
     */
    public function goesTo(): ?string
    {
        // `getRelationValue`, not `$this->table`: inside a model that property
        // is the name of the database table, and reading it here read a string.
        $table = $this->getRelationValue('table');

        if ($table !== null) {
            return $table->name;
        }

        if ($this->order_type === 'takeaway') {
            return null;
        }

        $typed = trim((string) $this->sale?->table_no);

        if ($typed === '') {
            return null;
        }

        // "5" is a table; "T5" and "Garden" are already what the shop calls it.
        return ctype_digit($typed) ? "Table {$typed}" : $typed;
    }

    public function isOpen(): bool
    {
        return $this->status === RestaurantTicketStatus::Open;
    }

    /**
     * Whether this tab is this person's to work.
     *
     * A tab with no waiter belongs to NOBODY, and nobody's table is everybody's
     * — a takeaway rung at the counter, or a tab opened before the column
     * existed, must not become an orphan that only an owner can settle.
     */
    public function isServedBy(?User $user): bool
    {
        return $this->waiter_id === null
            || ($user !== null && $this->waiter_id === $user->id);
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
