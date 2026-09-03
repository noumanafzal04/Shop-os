<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Enums\RestaurantTicketStatus;
use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Restaurant\BumpKitchenTicketRequest;
use App\Models\KitchenTicket;
use App\Models\RestaurantTicketItem;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * The kitchen display (KDS): the screen over the pass, and the bump that moves
 * a KOT along it. Read-heavy — the board is polled every few seconds by every
 * station at once, so it is one flat payload built from a handful of queries.
 *
 * Nothing here ever carries money. A cook decides nothing from a price, and a
 * kitchen printout that shows one is a bill left on the wrong side of the shop.
 */
class KitchenController extends Controller
{
    /** Everything still owed to a table — the default board. */
    private const ACTIVE_STATUSES = ['fired', 'preparing', 'ready'];

    /** The bump lifecycle, in order. Position is the only thing that matters. */
    private const LIFECYCLE = ['fired' => 0, 'preparing' => 1, 'ready' => 2, 'served' => 3];

    /** The timestamp each bump stamps. `fired` is stamped when the KOT is created. */
    private const STAMPS = ['preparing' => 'preparing_at', 'ready' => 'ready_at', 'served' => 'served_at'];

    /**
     * The live board. Oldest first: a kitchen works the queue from the top, and
     * a screen that puts the newest ticket first cooks the wrong order.
     */
    public function board(Request $request): JsonResponse
    {
        $includeServed = $request->boolean('include_served');

        $kots = $this->boardQuery($includeServed)
            ->when($request->filled('station'), fn ($q) => $q->where('station', $request->input('station')))
            ->with([
                // A voided line was struck off the tab — it must never reach a pan.
                'items' => fn ($q) => $q->whereNull('voided_at')->orderBy('created_at'),
                'ticket:id,ticket_number,dining_table_id,order_type,guest_count,customer_name',
                'ticket.table:id,name',
            ])
            ->orderBy('fired_at')
            ->get();

        return ApiResponse::ok([
            'kots' => $kots->map(fn (KitchenTicket $kot) => $this->row($kot))->all(),
            // Drawn from the WHOLE board rather than the filtered slice, or the
            // station tabs would vanish the moment a cook picked one of them.
            'stations' => $this->boardQuery($includeServed)
                ->whereNotNull('station')
                ->distinct()
                ->orderBy('station')
                ->pluck('station')
                ->all(),
            // The ages are computed here; a screen that ticks between polls
            // needs to know what "now" was when they were.
            'server_time' => now()->toJSON(),
        ]);
    }

    /**
     * Advance one KOT. Forward-only: a KDS is tapped by wet hands in a hurry,
     * and silently un-readying food already sitting on the pass is worse than
     * refusing the tap.
     */
    public function bump(BumpKitchenTicketRequest $request, string $kotId): JsonResponse
    {
        /** @var KitchenTicket $kot */
        $kot = KitchenTicket::query()->findOrFail($kotId);

        $target = (string) $request->validated()['status'];
        $current = (string) $kot->status;

        $targetRank = self::LIFECYCLE[$target];
        $currentRank = self::LIFECYCLE[$current] ?? 0;

        // A double-tap on a busy screen is the same fact arriving twice, not a
        // new one. Succeed and change nothing — including the timestamps, so a
        // fat-fingered second tap can't rewrite when the food was actually ready.
        if ($targetRank === $currentRank) {
            return ApiResponse::ok($kot, "Ticket is already {$target}.");
        }

        if ($targetRank < $currentRank) {
            throw DomainException::conflict(
                "This ticket is already {$current} — it cannot go back to {$target}.",
                'KOT_ALREADY_ADVANCED',
            );
        }

        $now = now();
        $changes = ['status' => $target, 'bumped_by' => auth()->id()];

        // Skipping ahead is legitimate: plenty of kitchens bump exactly once,
        // fired → served. Stamp the stages jumped over at the moment of the
        // jump so the interval report reads "zero time in that stage" instead
        // of a null gap it has to guess at.
        foreach (self::STAMPS as $status => $column) {
            if (self::LIFECYCLE[$status] <= $targetRank && $kot->{$column} === null) {
                $changes[$column] = $now;
            }
        }

        $kot->forceFill($changes)->save();

        if ($target === 'served') {
            // The floor screen reads kitchen state per LINE on the tab, not per
            // KOT. Voided lines keep their void marker — they were never cooked.
            $kot->items()->whereNull('voided_at')->update(['kot_status' => 'served']);

            $this->closeACounterOrderThatIsDone($kot);
        }

        return ApiResponse::ok($kot->fresh(), "Ticket marked {$target}.");
    }

    /**
     * A takeaway order rung at the counter, once the kitchen has finished it.
     *
     * A tab closes when it is SETTLED. A counter order was paid before the
     * kitchen ever saw it, so there is no settlement left to make — and it had
     * to be left open anyway, because `forAnOpenTab` is what keeps a docket on
     * the board. So the last docket being served is the only moment that can
     * close it, and if nothing did, every takeaway order a café ever sold would
     * sit open for ever and the kitchen's own backlog figure would climb by one
     * per order.
     *
     * A tab is left alone: it is the floor's to close, and closing it here
     * would take a table's bill away before anybody had paid it.
     */
    private function closeACounterOrderThatIsDone(KitchenTicket $kot): void
    {
        $ticket = $kot->ticket()->first();

        if ($ticket === null || ! $ticket->from_counter || ! $ticket->isOpen()) {
            return;
        }

        $stillCooking = $ticket->kitchenTickets()
            ->where('status', '!=', 'served')
            ->exists();

        if ($stillCooking) {
            return;
        }

        $ticket->forceFill([
            'status' => RestaurantTicketStatus::Closed,
            'closed_at' => now(),
        ])->save();
    }

    /**
     * The board's window: everything not yet served, plus — on request — what
     * was served today, because a cook challenged on a missing dish needs to be
     * able to show they sent it. Bounded to today so the screen can't grow
     * unbounded over a week of service.
     */
    private function boardQuery(bool $includeServed): Builder
    {
        // The pass of the site being worked. Without this a two-site restaurant
        // ran one shared queue: the Gulberg pass showed DHA's fired tickets and
        // cooks worked another kitchen's orders. Read scope, so an owner's
        // all-branches view still sees every pass at once.
        $branchId = app(BranchContext::class)->scopeId();

        return KitchenTicket::query()
            ->when($branchId, fn (Builder $q) => $q->where('branch_id', $branchId))
            // THE PASS IS ABOUT TABLES STILL BEING SERVED.
            //
            // This filtered on the docket's own status alone, so a docket
            // outlived its tab: found on a real board, nine dockets with EIGHT
            // belonging to VOIDED tabs and two fired six days earlier. A cook
            // was being told to cook meals nobody would eat.
            //
            // Cancel now voids its own dockets, because that is a known fact.
            // Settle does not, because it is not one — a tab being paid says
            // nothing about whether the kitchen sent the food out, and writing
            // `served` on a docket the cook never bumped would put a claim in
            // the kitchen's record that the kitchen never made. The BOARD is
            // where the judgement belongs: a closed tab is not work.
            ->forAnOpenTab()
            ->where(function (Builder $q) use ($includeServed): void {
                $q->whereIn('status', self::ACTIVE_STATUSES);

                if ($includeServed) {
                    $q->orWhere(fn (Builder $s) => $s->where('status', 'served')->whereDate('served_at', today()));
                }
            });
    }

    /**
     * One card on the screen. Flat on purpose: the KDS renders it as-is and
     * must never have to walk a relation to find the table it belongs to.
     */
    private function row(KitchenTicket $kot): array
    {
        $ticket = $kot->ticket;

        return [
            'id' => $kot->id,
            'kot_number' => (int) $kot->kot_number,
            'station' => $kot->station,
            'status' => (string) $kot->status,
            'notes' => $kot->notes,
            'fired_at' => $this->stamp($kot->fired_at),
            'preparing_at' => $this->stamp($kot->preparing_at),
            'ready_at' => $this->stamp($kot->ready_at),
            'served_at' => $this->stamp($kot->served_at),
            // How long this ticket has been alive — the number the whole screen
            // is really about, and the one it colours its cards by.
            'age_seconds' => $kot->fired_at === null ? 0 : (int) $kot->fired_at->diffInSeconds(now()),
            'ticket_number' => $ticket?->ticket_number,
            // WHAT A COOK CALLS OUT.
            //
            // A table's name for a table. For a takeaway it used to be the word
            // "Takeaway" — on every card — which on a café's pass is a wall of
            // twelve identical tickets and nothing to shout. The customer's
            // name is what the counter actually calls, so it wins where there
            // is one, and the word stays as the fallback for a walk-up who
            // never gave one.
            'table_name' => $ticket?->order_type === 'takeaway'
                ? (($ticket->customer_name !== null && trim($ticket->customer_name) !== '')
                    ? trim($ticket->customer_name)
                    : 'Takeaway')
                : $ticket?->table?->name,
            // So the card can say WHICH it is even when the headline is a name.
            'order_type' => $ticket?->order_type,
            'guest_count' => $ticket?->guest_count,
            'items' => $kot->items->map(fn (RestaurantTicketItem $item) => [
                'name' => $item->variant_name === null
                    ? $item->product_name
                    : "{$item->product_name} ({$item->variant_name})",
                'quantity' => (float) $item->quantity,
                // The stored modifier snapshot carries a price_delta. Strip it:
                // the cook needs the choice, never what it was charged for.
                'modifiers' => collect($item->modifiers ?? [])
                    ->map(fn ($mod) => ['group' => $mod['group'] ?? null, 'name' => $mod['name'] ?? null])
                    ->all(),
                'note' => $item->note,
            ])->all(),
        ];
    }

    /**
     * Serialize a bump timestamp exactly as Eloquent would, whether or not the
     * column is cast — the panel parses one shape, not two.
     */
    private function stamp(mixed $value): ?string
    {
        return $value === null ? null : Carbon::parse($value)->toJSON();
    }
}
