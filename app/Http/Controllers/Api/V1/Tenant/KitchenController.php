<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Enums\RestaurantTicketStatus;
use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Restaurant\BumpKitchenTicketRequest;
use App\Http\Requests\Restaurant\ClearKitchenBoardRequest;
use App\Models\AuditLog;
use App\Models\KitchenTicket;
use App\Models\RestaurantTicket;
use App\Models\RestaurantTicketItem;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use App\Support\ServiceDay;
use App\Support\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

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
    /** The bump lifecycle, in order. Position is the only thing that matters. */
    private const LIFECYCLE = ['fired' => 0, 'preparing' => 1, 'ready' => 2, 'served' => 3];

    /** The timestamp each bump stamps. `fired` is stamped when the KOT is created. */
    private const STAMPS = ['preparing' => 'preparing_at', 'ready' => 'ready_at', 'served' => 'served_at'];

    /**
     * The live board. Oldest first: a kitchen works the queue from the top, and
     * a screen that puts the newest ticket first cooks the wrong order.
     *
     * THIS SERVICE ONLY. What was fired before it (see ServiceDay) is not on
     * the board — it is counted in `older`, so the screen can say "seven
     * tickets are left from before today" and offer to show or clear them,
     * rather than leading every morning's queue with last week's orders.
     * `older=1` returns those instead, so they can be read before they go.
     */
    public function board(Request $request): JsonResponse
    {
        $includeServed = $request->boolean('include_served');
        $older = $request->boolean('older');
        $began = ServiceDay::began();

        $kots = $this->boardQuery($includeServed, $older, $began)
            ->when($request->filled('station'), fn ($q) => $q->where('station', $request->input('station')))
            ->with([
                // A voided line was struck off the tab — it must never reach a pan.
                'items' => fn ($q) => $q->whereNull('voided_at')->orderBy('created_at'),
                'ticket:id,ticket_number,dining_table_id,order_type,guest_count,customer_name',
                'ticket.table:id,name',
            ])
            ->orderBy('fired_at')
            ->get();

        $leftOver = $this->pass()->stillOwed()->fromBefore($began);

        return ApiResponse::ok([
            'kots' => $kots->map(fn (KitchenTicket $kot) => $this->row($kot))->all(),
            // Drawn from the WHOLE board rather than the filtered slice, or the
            // station tabs would vanish the moment a cook picked one of them.
            'stations' => $this->boardQuery($includeServed, $older, $began)
                ->whereNotNull('station')
                ->distinct()
                ->orderBy('station')
                ->pluck('station')
                ->all(),
            // What this service's board is NOT showing. Never filtered by
            // station: a leftover is everybody's to notice.
            'older' => [
                'count' => (clone $leftOver)->count(),
                'oldest_fired_at' => $this->stamp((clone $leftOver)->min('fired_at')),
            ],
            'service_began' => $began->toJSON(),
            // The ages are computed here; a screen that ticks between polls
            // needs to know what "now" was when they were.
            'server_time' => now()->toJSON(),
        ]);
    }

    /**
     * TAKE TICKETS OFF THE BOARD, ALL AT ONCE.
     *
     * Two things a kitchen needs and had no way to do but one card at a time:
     *
     *   `older`  what was left from a service that is over. Nobody is going to
     *            cook it; bumping forty stale cards through Start → Ready →
     *            Served to make them go away is forty lies in the timing
     *            record and ten minutes nobody has.
     *
     *   `board`  everything on tonight's board, at close. Optionally one
     *            station's — the grill clearing down does not clear the bar.
     *
     * Marked `cleared`, never `served`: see KitchenTicket::CLEARED. No stage
     * timestamp is stamped either — the intervals between them are the cook
     * times, and a ticket cleared at close has none to report.
     *
     * No new authority is handed out. Anyone who may bump a ticket to served
     * may already do this one tap at a time; this is the same act, counted.
     * It is written to the trail as ONE row, because it is one decision.
     */
    public function clear(ClearKitchenBoardRequest $request): JsonResponse
    {
        $scope = (string) $request->validated()['scope'];
        $station = $request->validated()['station'] ?? null;
        $began = ServiceDay::began();

        $cleared = DB::transaction(function () use ($scope, $station, $began): int {
            $kots = $this->pass()
                ->stillOwed()
                ->when($scope === 'older', fn (Builder $q) => $q->fromBefore($began))
                ->when($scope === 'board', fn (Builder $q) => $q->inService($began))
                ->when($scope === 'board' && $station !== null, fn (Builder $q) => $q->where('station', $station))
                ->lockForUpdate()
                ->get(['id', 'ticket_id']);

            if ($kots->isEmpty()) {
                return 0;
            }

            $ids = $kots->pluck('id')->all();

            KitchenTicket::query()->whereKey($ids)->update([
                'status' => KitchenTicket::CLEARED,
                'bumped_by' => auth()->id(),
                'updated_at' => now(),
            ]);

            // The tab reads kitchen state per LINE. Left as `fired`, every one
            // of these would say "In kitchen" on the waiter's screen for as
            // long as the tab stayed open.
            RestaurantTicketItem::query()
                ->whereIn('kitchen_ticket_id', $ids)
                ->whereNull('voided_at')
                ->where('kot_status', 'fired')
                ->update(['kot_status' => KitchenTicket::CLEARED]);

            RestaurantTicket::query()
                ->whereKey($kots->pluck('ticket_id')->unique()->all())
                ->get()
                ->each(fn (RestaurantTicket $ticket) => $this->closeACounterOrderThatIsDone($ticket));

            AuditLog::query()->create([
                'user_id' => auth()->id(),
                'tenant_id' => app(TenantContext::class)->id(),
                'event' => 'cleared',
                'auditable_type' => KitchenTicket::class,
                'auditable_id' => null,
                'old_values' => null,
                'new_values' => array_filter([
                    'tickets' => count($ids),
                    'which' => $scope === 'older' ? 'left from an earlier service' : 'this service',
                    'station' => $scope === 'board' ? $station : null,
                ], fn ($v) => $v !== null),
                'ip_address' => request()?->ip(),
            ]);

            return count($ids);
        });

        return ApiResponse::ok(
            ['cleared' => $cleared],
            $cleared === 0 ? 'Nothing to clear.' : ($cleared === 1 ? '1 ticket cleared.' : "{$cleared} tickets cleared."),
        );
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

        // A docket that was voided with its tab, or cleared off the board, is
        // not on the lifecycle at all. It used to fall through as rank zero —
        // "not started" — so a stale screen could tap a dead ticket back to
        // life and put it on the pass again.
        if (! isset(self::LIFECYCLE[$current])) {
            throw DomainException::conflict(
                'This ticket is no longer on the board.',
                'KOT_OFF_THE_BOARD',
            );
        }

        $targetRank = self::LIFECYCLE[$target];
        $currentRank = self::LIFECYCLE[$current];

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

            $ticket = $kot->ticket()->first();
            if ($ticket !== null) {
                $this->closeACounterOrderThatIsDone($ticket);
            }
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
    private function closeACounterOrderThatIsDone(RestaurantTicket $ticket): void
    {
        if (! $ticket->from_counter || ! $ticket->isOpen()) {
            return;
        }

        // "Still cooking" is an ACTIVE docket — not "anything that is not
        // served". It used to be the second, which was the same thing while a
        // docket could only be active or served. A cleared one is neither, and
        // an order with one docket cleared and one served would have waited
        // for ever on a docket that is already off the board.
        $stillCooking = $ticket->kitchenTickets()
            ->whereIn('status', KitchenTicket::ACTIVE)
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
     * The pass of the site being worked.
     *
     * Without this a two-site restaurant ran one shared queue: the Gulberg
     * pass showed DHA's fired tickets and cooks worked another kitchen's
     * orders. Read scope, so an owner's all-branches view still sees every
     * pass at once.
     */
    private function pass(): Builder
    {
        $branchId = app(BranchContext::class)->scopeId();

        return KitchenTicket::query()
            ->when($branchId, fn (Builder $q) => $q->where('branch_id', $branchId));
    }

    /**
     * The board's window: everything owed in THIS service, plus — on request —
     * what was served in it, because a cook challenged on a missing dish needs
     * to be able to show they sent it.
     *
     * `$older` turns it round: what is still owed from BEFORE this service,
     * and nothing else. The two are never mixed on one screen.
     */
    private function boardQuery(bool $includeServed, bool $older, Carbon $began): Builder
    {
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
        if ($older) {
            return $this->pass()->stillOwed()->fromBefore($began);
        }

        return $this->pass()
            ->forAnOpenTab()
            ->where(function (Builder $q) use ($includeServed, $began): void {
                $q->where(fn (Builder $live) => $live->whereIn('status', KitchenTicket::ACTIVE)->inService($began));

                if ($includeServed) {
                    // The same service, not the calendar day: at one in the
                    // morning "served today" was the last hour only.
                    $q->orWhere(fn (Builder $s) => $s->where('status', 'served')->where('served_at', '>=', $began));
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
            // THE NAME ITSELF, or null — said apart from `table_name`, whose
            // fallback is the WORD "Takeaway". A card has to be able to tell
            // "this order is called Takeaway" from "nobody gave a name", or a
            // walk-up's card is headed by a word that every other walk-up's
            // card is headed by too, with the one thing that tells them apart
            // — the receipt number in the customer's hand — nowhere on it.
            'customer_name' => ($ticket?->customer_name !== null && trim((string) $ticket->customer_name) !== '')
                ? trim((string) $ticket->customer_name)
                : null,
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
