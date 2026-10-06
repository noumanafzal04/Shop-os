<?php

namespace App\Support;

use App\Models\KitchenTicket;
use App\Models\RestaurantTicket;
use DateTimeInterface;

/**
 * AN OPEN TAB, AS THE FLOOR NEEDS TO SEE IT.
 *
 * The floor drew a table as "occupied" and nothing more: a name, a tab number
 * and whose it was. Everything a waiter walks the room to find out — how long
 * they have been sat, what the bill has reached, whether their food is on the
 * pass — needed a tap into each tab to learn, one table at a time.
 *
 * It is one flat row, built here, for the same reason the kitchen board's is:
 * the screen is polled every few seconds and must never walk a relation.
 *
 * The lines themselves are NOT sent. A tab model serialised as-is appends its
 * running total, which loads every line to add them up, and then ships the
 * lines as well — forty tables' worth of menu, every eight seconds, to draw
 * forty tiles.
 */
final class TabSummary
{
    /** What `of()` reads. Loaded once for the whole floor, never per tab. */
    public const NEEDS = [
        'waiter:id,name',
        'items:id,ticket_id,line_total,kot_status,voided_at,sale_id',
        'kitchenTickets:id,ticket_id,status',
    ];

    public static function of(RestaurantTicket $tab, DateTimeInterface $serviceBegan): array
    {
        $live = $tab->items->whereNull('voided_at');
        $unpaid = $live->whereNull('sale_id');
        $dockets = $tab->kitchenTickets->whereIn('status', KitchenTicket::ACTIVE);

        return [
            'id' => $tab->id,
            'ticket_number' => $tab->ticket_number,
            'order_type' => $tab->order_type,
            'status' => $tab->status?->value,
            'opened_at' => $tab->opened_at?->toJSON(),
            'guest_count' => $tab->guest_count,
            'customer_name' => $tab->customer_name,
            'waiter_id' => $tab->waiter_id,
            'waiter' => $tab->waiter === null ? null : ['id' => $tab->waiter->id, 'name' => $tab->waiter->name],
            // What is still to be collected. Not the tab's whole value: after
            // one of four friends has paid their share, the table owes three
            // shares, and that is the number a floor is run on.
            'to_pay' => round((float) $unpaid->sum(fn ($i) => (float) $i->line_total), 2),
            'lines' => $live->count(),
            // Ordered and not yet sent — the commonest thing a waiter forgets.
            'unsent' => $unpaid->where('kot_status', 'pending')->count(),
            // On the pass, waiting for somebody to carry it. The reason to
            // look at the floor at all between orders.
            'ready' => $dockets->where('status', 'ready')->count(),
            'cooking' => $dockets->where('status', '!=', 'ready')->count(),
            // Something on it has been paid for, so it can be settled but not
            // cancelled — the floor says so before anyone tries.
            'part_paid' => $live->whereNotNull('sale_id')->isNotEmpty(),
            // Opened in a service that is over. See ServiceDay.
            'from_earlier' => $tab->opened_at !== null && $tab->opened_at->lessThan($serviceBegan),
        ];
    }
}
