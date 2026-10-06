<?php

namespace App\Models;

use App\Enums\RestaurantTicketStatus;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A Kitchen Order Ticket (KOT): the items one "send" put in front of ONE
 * station — a send that spans the grill and the bar writes a KOT each.
 * Kitchen-facing (no prices). Append-only header — its items are the
 * RestaurantTicketItems stamped with this KOT's id.
 */
class KitchenTicket extends Model
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
    /**
     * WORK THE KITCHEN STILL OWES.
     *
     * The pass asked one question and the owner's dashboard asked another, and
     * neither asked whether the TAB was still open — so a docket outlived its
     * tab. Found on a real board: nine dockets with EIGHT belonging to voided
     * tabs, two of them fired six days earlier. The dashboard was worse: it
     * counted every un-served docket ever fired, so `kot_waiting` — the number
     * an owner reads to know what the kitchen owes — grew by one for every tab
     * anybody had ever cancelled.
     *
     * One rule, because two readers is two chances for one of them to forget
     * the tab.
     */
    public function scopeForAnOpenTab(Builder $query): Builder
    {
        return $query->whereHas(
            'ticket',
            fn (Builder $t) => $t->where('status', RestaurantTicketStatus::Open->value),
        );
    }

    /** Still somebody's work: sent, and not yet out. */
    public const ACTIVE = ['fired', 'preparing', 'ready'];

    /**
     * Taken off the board by a person, in one go — see KitchenController::clear.
     *
     * Its own word, and deliberately not `served`. Clearing a board at close
     * says "this is no longer kitchen work"; it does not say the food went
     * out, and a docket the cook never bumped must not be recorded as one the
     * cook sent. `void` is taken too: that is a tab that was cancelled.
     */
    public const CLEARED = 'cleared';

    /**
     * What the kitchen still owes: an active docket, for a tab still open.
     *
     * The status half is said here because `cleared` exists now. The dashboard
     * used to ask "not yet served" (`served_at` is null), and a cleared docket
     * has no `served_at` either — it would have gone on being counted as food
     * the kitchen owed for as long as its tab stayed open.
     */
    public function scopeStillOwed(Builder $query): Builder
    {
        return $query->forAnOpenTab()->whereIn('status', self::ACTIVE);
    }

    /** Fired in the service being worked. See ServiceDay. */
    public function scopeInService(Builder $query, \DateTimeInterface $began): Builder
    {
        return $query->where('fired_at', '>=', $began);
    }

    /**
     * Left over from a service that is finished.
     *
     * A docket with no `fired_at` at all counts as left over, not as current:
     * nothing can say when it was sent, so nothing can say it is tonight's.
     */
    public function scopeFromBefore(Builder $query, \DateTimeInterface $began): Builder
    {
        return $query->where(fn (Builder $q) => $q->where('fired_at', '<', $began)->orWhereNull('fired_at'));
    }

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

    use BelongsToTenant, HasUuids;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'kot_number' => 'integer',
            'fired_at' => 'datetime',
            'preparing_at' => 'datetime',
            'ready_at' => 'datetime',
            'served_at' => 'datetime',
        ];
    }

    public function ticket(): BelongsTo
    {
        return $this->belongsTo(RestaurantTicket::class, 'ticket_id');
    }

    public function items(): HasMany
    {
        return $this->hasMany(RestaurantTicketItem::class, 'kitchen_ticket_id');
    }
}
