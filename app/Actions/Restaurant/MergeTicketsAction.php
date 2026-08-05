<?php

namespace App\Actions\Restaurant;

use App\Enums\RestaurantTicketStatus;
use App\Exceptions\DomainException;
use App\Models\RestaurantTicket;
use Illuminate\Support\Facades\DB;

/**
 * Fold one tab into another so a single bill covers both.
 *
 * Two couples arrive separately, are seated separately, and halfway through
 * turn out to be one party. Without this the only options are to hand them two
 * bills or to re-ring a whole meal — and re-ringing loses the KOTs already
 * fired, so the kitchen's record stops matching the money.
 *
 * The source is CLOSED with a pointer at the survivor, never deleted. A merge
 * that left a hole where a tab used to be would make an evening's covers
 * impossible to reconcile, and would quietly hide a waiter folding one table's
 * items onto another's bill.
 */
class MergeTicketsAction
{
    public function execute(RestaurantTicket $target, RestaurantTicket $source): RestaurantTicket
    {
        if ($target->id === $source->id) {
            throw DomainException::unprocessable('A tab cannot be merged into itself.', 'CANNOT_MERGE_SELF');
        }

        return DB::transaction(function () use ($target, $source): RestaurantTicket {
            // Lock both, lowest id first. Two waiters merging the same pair from
            // opposite directions would otherwise each hold what the other
            // needs; a consistent order turns that deadlock into a wait.
            $ids = [$target->id, $source->id];
            sort($ids);
            RestaurantTicket::query()->whereIn('id', $ids)->lockForUpdate()->get();

            $target->refresh();
            $source->refresh();

            if (! $target->isOpen() || ! $source->isOpen()) {
                throw DomainException::conflict(
                    'Both tabs must still be open to merge them.',
                    'TICKET_NOT_OPEN',
                );
            }

            // A settled line has already been paid for on its own invoice.
            // Moving it onto another bill would either charge it twice or lose
            // the money entirely, and neither is recoverable from the floor.
            if ($source->items()->whereNotNull('sale_id')->exists()) {
                throw DomainException::conflict(
                    "Tab {$source->ticket_number} is already part-paid — settle the rest of it instead of merging.",
                    'ALREADY_PARTLY_SETTLED',
                );
            }

            // kot_number is a per-TICKET sequence, so the source's #1 would
            // collide with the target's #1 and the kitchen would be looking at
            // two different tickets with the same number on the same bill.
            // Renumber the moved KOTs to continue the target's run.
            $next = (int) $target->kitchenTickets()->count();
            foreach ($source->kitchenTickets()->orderBy('kot_number')->get() as $kot) {
                $kot->forceFill(['ticket_id' => $target->id, 'kot_number' => ++$next])->save();
            }

            $source->items()->whereNull('voided_at')->update(['ticket_id' => $target->id]);

            $source->forceFill([
                'status' => RestaurantTicketStatus::Closed,
                'closed_at' => now(),
                'merged_into_id' => $target->id,
                'merged_at' => now(),
            ])->save();

            return $target->fresh(['table', 'items']);
        });
    }
}
