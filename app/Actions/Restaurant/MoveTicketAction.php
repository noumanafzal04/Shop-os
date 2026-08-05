<?php

namespace App\Actions\Restaurant;

use App\Enums\RestaurantTicketStatus;
use App\Exceptions\DomainException;
use App\Models\DiningTable;
use App\Models\RestaurantTicket;
use Illuminate\Support\Facades\DB;

/**
 * Move an open tab to a different table — or off the floor entirely.
 *
 * Real case this exists for: a party seated at T4 asks for the patio, or the
 * host seats them at the wrong table, or a takeaway order turns into people
 * sitting down. Until now a tab was welded to whatever table it was opened on,
 * so the only way out was to void it and re-ring every item — which loses the
 * KOTs already fired, the timings, and the waiter's place in the meal.
 *
 * Only the SEAT changes. Items, KOTs, running total and the tab number all stay
 * exactly where they are, so nothing the kitchen or the customer has already
 * been shown moves under them.
 *
 * The one rule worth being strict about is that a table may hold at most one
 * open tab. Two parties sharing a table's bill is how a bill gets handed to the
 * wrong people — and the mistake surfaces at payment, in front of both of them.
 * "Occupied" is DERIVED (some open tab points at the table), never stored, so
 * there is no status column to drift out of sync with reality.
 */
class MoveTicketAction
{
    /**
     * @param  array{dining_table_id?: string|null, guest_count?: int|null}  $data
     */
    public function execute(RestaurantTicket $ticket, array $data): RestaurantTicket
    {
        if (! $ticket->isOpen()) {
            throw DomainException::conflict('This tab is closed — it can no longer be moved.', 'TICKET_NOT_OPEN');
        }

        return DB::transaction(function () use ($ticket, $data): RestaurantTicket {
            $changes = [];

            // An ABSENT key means "leave the seating alone" (a guest-count-only
            // edit); an explicit null means "take this tab off the floor". They
            // are different intents and `?? null` would collapse them into one,
            // silently un-seating a party whenever a waiter fixes the cover
            // count.
            if (array_key_exists('dining_table_id', $data)) {
                $tableId = $data['dining_table_id'];

                if ($tableId !== null) {
                    $this->claimTable($tableId, $ticket);
                }

                $changes['dining_table_id'] = $tableId;
                // Keep the tab's shape honest about where it is. A tab with no
                // table is a counter/takeaway order, and a tab that has just
                // been seated is dining in — the same invariant OpenTicketAction
                // enforces when a tab is created. Settlement reads order_type
                // onto the Sale, so leaving it stale would file the money under
                // the wrong service type.
                $changes['order_type'] = $tableId === null ? 'takeaway' : 'dine_in';
            }

            if (array_key_exists('guest_count', $data)) {
                $changes['guest_count'] = $data['guest_count'];
            }

            if ($changes !== []) {
                $ticket->forceFill($changes)->save();
            }

            return $ticket->fresh(['table', 'items']);
        });
    }

    /**
     * Take the destination table, or explain why it can't be taken.
     *
     * The row lock is the entire point of this method. Two waiters moving two
     * different parties onto the same free table at the same moment would each
     * read "free" and each write their tab onto it — the check and the write
     * are not atomic on their own. Locking the dining_tables row first makes the
     * second waiter wait for the first to commit, so it reads the table as taken
     * instead of guessing. Same class of race, same handling, as
     * MoveCashSessionAction locking the target register before claiming it.
     */
    private function claimTable(string $tableId, RestaurantTicket $ticket): DiningTable
    {
        /** @var DiningTable|null $table */
        $table = DiningTable::query()->whereKey($tableId)->lockForUpdate()->first();

        // Another shop's table is simply not found here — the BelongsToTenant
        // global scope filters it out, so a cross-tenant id and a deleted id
        // fail identically and neither leaks that the table exists at all.
        if ($table === null || ! $table->is_active) {
            throw DomainException::unprocessable(
                'That table is not available to move to.',
                'TABLE_INVALID',
            );
        }

        // Excluding this tab from the occupancy test lets a move onto the table
        // it already sits on succeed as a no-op, which is what a waiter who only
        // meant to correct the guest count expects.
        //
        // The extra lock on the open-tab rows is not redundant with the table
        // lock above: OpenTicketAction guards the same invariant by locking
        // TICKETS, and a move racing an open would otherwise be serialised on
        // two different rows and so not serialised at all.
        $held = RestaurantTicket::query()
            ->where('dining_table_id', $table->id)
            ->where('status', RestaurantTicketStatus::Open->value)
            ->whereKeyNot($ticket->id)
            ->lockForUpdate()
            ->exists();

        if ($held) {
            throw DomainException::conflict(
                "Table {$table->name} already has an open tab — settle or merge it first.",
                'TABLE_OCCUPIED',
            );
        }

        return $table;
    }
}
