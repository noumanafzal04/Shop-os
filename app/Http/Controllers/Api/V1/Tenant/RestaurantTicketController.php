<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Restaurant\AddTicketItemsAction;
use App\Actions\Restaurant\FireKitchenTicketAction;
use App\Actions\Restaurant\MergeTicketsAction;
use App\Actions\Restaurant\MoveTicketAction;
use App\Actions\Restaurant\OpenTicketAction;
use App\Actions\Restaurant\SettleTicketAction;
use App\Enums\RestaurantTicketStatus;
use App\Enums\SaleStatus;
use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Restaurant\AddTicketItemsRequest;
use App\Http\Requests\Restaurant\FireKitchenTicketRequest;
use App\Http\Requests\Restaurant\MergeTicketsRequest;
use App\Http\Requests\Restaurant\MoveTicketRequest;
use App\Http\Requests\Restaurant\OpenTicketRequest;
use App\Http\Requests\Restaurant\SettleTicketRequest;
use App\Models\KitchenTicket;
use App\Models\RestaurantTicket;
use App\Models\RestaurantTicketItem;
use App\Models\Sale;
use App\Models\User;
use App\Support\ApiResponse;
use App\Support\Permissions;
use App\Support\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;

/**
 * Dine-in / takeaway running tabs: open a tab, add items, fire kitchen tickets,
 * and settle (whole or split-by-item) into Sales.
 */
class RestaurantTicketController extends Controller
{
    public function __construct(private readonly TenantContext $context) {}

    public function index(Request $request)
    {
        $status = $request->input('status', RestaurantTicketStatus::Open->value);

        $tickets = RestaurantTicket::query()
            ->when($status !== 'all', fn ($q) => $q->where('status', $status))
            ->with(['table', 'items', 'waiter:id,name'])
            ->orderByDesc('opened_at')
            ->paginate((int) $request->input('per_page', 30));

        return ApiResponse::paginated($tickets);
    }

    public function store(OpenTicketRequest $request, OpenTicketAction $action)
    {
        $ticket = $action->execute($request->validated());

        return ApiResponse::created($ticket, "Tab {$ticket->ticket_number} opened.");
    }

    /**
     * Read-only, and open to the whole floor on purpose — see assertMayWork().
     * The response carries the waiter, so a client can show whose table it is
     * and grey out what this user may not do to it.
     */
    public function show(RestaurantTicket $ticket)
    {
        return ApiResponse::ok($ticket->load(['table', 'items', 'kitchenTickets', 'waiter:id,name']));
    }

    public function addItems(AddTicketItemsRequest $request, RestaurantTicket $ticket, AddTicketItemsAction $action)
    {
        $this->assertMayWork($ticket);

        $ticket = $action->execute($ticket, $request->validated());

        return ApiResponse::ok($ticket, 'Items added to the tab.');
    }

    /**
     * Void a single line (a mistake / a walk-out item). Never a paid line.
     */
    public function voidItem(Request $request, RestaurantTicket $ticket, RestaurantTicketItem $item)
    {
        $this->assertMayWork($ticket);
        $this->assertBelongs($item->ticket_id, $ticket->id);

        if ($item->isSettled()) {
            throw DomainException::conflict('That item is already paid — refund it on the sale instead.', 'ITEM_SETTLED');
        }
        if ($item->isVoid()) {
            return ApiResponse::ok($ticket->fresh(['table', 'items']));
        }

        $item->update([
            'voided_at' => now(),
            'kot_status' => 'void',
            'void_reason' => $request->input('reason'),
        ]);

        return ApiResponse::ok($ticket->fresh(['table', 'items']), 'Item voided.');
    }

    /**
     * Send to kitchen. One fire can produce SEVERAL kitchen tickets — items are
     * routed by station, so the bar gets the drinks and the grill gets the
     * kebabs, each on its own paper. The response is always a list; the client
     * prints every ticket it gets back.
     */
    public function fire(FireKitchenTicketRequest $request, RestaurantTicket $ticket, FireKitchenTicketAction $action)
    {
        $this->assertMayWork($ticket);

        $kots = $action->execute($ticket, $request->validated());

        $numbers = $kots->pluck('kot_number')->map(fn ($n) => "#{$n}")->implode(', ');

        return ApiResponse::created($kots->values(), $kots->count() === 1
            ? "Kitchen ticket {$numbers} fired."
            : "{$kots->count()} kitchen tickets fired ({$numbers}).");
    }

    /**
     * Kitchen-facing print of one KOT (item names, modifiers, qty — NO prices).
     * Behind auth like the invoice; the client fetches it with its token and
     * prints the returned HTML.
     */
    public function kotPrint(RestaurantTicket $ticket, KitchenTicket $kot)
    {
        $this->assertBelongs($kot->ticket_id, $ticket->id);

        return response()->view('kitchen.ticket', [
            'shopName' => $this->context->get()?->name,
            'ticket' => $ticket->load('table'),
            'kot' => $kot->load('items'),
        ]);
    }

    public function settle(SettleTicketRequest $request, RestaurantTicket $ticket, SettleTicketAction $action)
    {
        $this->assertMayWork($ticket);

        $result = $action->execute($ticket, $request->validated());

        $closed = $result['ticket']->status === RestaurantTicketStatus::Closed;

        return ApiResponse::created($result, $closed
            ? "Tab {$ticket->ticket_number} settled and closed."
            : 'Part of the tab was settled.');
    }

    /**
     * Cancel (void) a whole tab — only while nothing on it has been paid.
     */
    public function cancel(Request $request, RestaurantTicket $ticket)
    {
        $this->assertMayWork($ticket);

        if (! $ticket->isOpen()) {
            throw DomainException::conflict('This tab is already closed.', 'TICKET_NOT_OPEN');
        }

        if ($ticket->items()->whereNotNull('sale_id')->exists()) {
            throw DomainException::conflict(
                'Part of this tab is already paid — settle the rest instead of cancelling.',
                'TICKET_PARTLY_SETTLED',
            );
        }

        $ticket->items()->whereNull('voided_at')->update([
            'voided_at' => now(),
            'kot_status' => 'void',
            'void_reason' => $request->input('reason', 'Tab cancelled'),
        ]);

        $ticket->forceFill([
            'status' => RestaurantTicketStatus::Void,
            'closed_at' => now(),
        ])->save();

        return ApiResponse::ok($ticket->fresh(['table', 'items']), 'Tab cancelled.');
    }

    // ── The floor moves ─────────────────────────────────────────────

    /** A party changes table — or gives one up and becomes a counter order. */
    public function move(MoveTicketRequest $request, RestaurantTicket $ticket, MoveTicketAction $action)
    {
        $this->assertMayWork($ticket);

        $ticket = $action->execute($ticket, $request->validated());

        return ApiResponse::ok($ticket, $ticket->table !== null
            ? "Moved to {$ticket->table->name}."
            : 'Moved off the floor.');
    }

    /**
     * Two tabs become one bill. The source is named in the body and folded into
     * the tab in the URL, so the survivor is always the one the waiter is
     * looking at.
     *
     * BOTH tabs must be yours. Folding someone else's table into your own moves
     * their evening's takings onto your name, which is the one thing table
     * ownership exists to prevent.
     */
    public function merge(MergeTicketsRequest $request, RestaurantTicket $ticket, MergeTicketsAction $action)
    {
        $source = RestaurantTicket::query()->findOrFail($request->validated('source_ticket_id'));

        $this->assertMayWork($ticket);
        $this->assertMayWork($source);

        $ticket = $action->execute($ticket, $source);

        return ApiResponse::ok($ticket, "Tab {$source->ticket_number} merged into {$ticket->ticket_number}.");
    }

    /**
     * Hand a table to another waiter — a section changing hands at shift change
     * is the normal case, not an exception.
     *
     * You may GIVE your own table to anyone; TAKING someone else's needs
     * `tables.serve_any`. Both fall out of the same check: without it, this
     * endpoint would be the way around every other one.
     */
    /**
     * Who a table can be handed TO.
     *
     * The hand-over could not be built without this. Naming the new waiter
     * means choosing from a list, and the staff directory is gated on
     * `staff.manage` — which a waiter does not have and should not get, since
     * it is the screen for hiring and firing. So the endpoint that told a
     * waiter "ask a supervisor to hand the table over" described something
     * nobody had a way to do.
     *
     * Deliberately the smallest possible read: the id and name of colleagues
     * who can work a floor, and nothing else. No contact details, no
     * permissions, no employment status — none of which is any of a waiter's
     * business. A waiter already sees these names, on every tab that is not
     * theirs and in the refusal message itself.
     */
    public function servers()
    {
        $servers = User::query()
            ->where('tenant_id', $this->context->id())
            ->where('status', UserStatus::Active)
            ->whereIn('role', [UserRole::ShopOwner, UserRole::Staff])
            ->orderBy('name')
            ->get(['id', 'name', 'role', 'permissions'])
            // The owner holds everything by role; staff carry an explicit list.
            // Filtered in PHP because `permissions` is a JSON column and a LIKE
            // against it would match a permission that merely CONTAINS this one.
            ->filter(fn (User $u): bool => $u->hasPermission(Permissions::SALES_MANAGE))
            ->map(fn (User $u): array => ['id' => $u->id, 'name' => $u->name])
            ->values();

        return ApiResponse::ok($servers);
    }

    public function assignWaiter(Request $request, RestaurantTicket $ticket)
    {
        $this->assertMayWork($ticket);

        $data = $request->validate([
            'waiter_id' => [
                'required', 'uuid',
                Rule::exists('users', 'id')->where('tenant_id', $this->context->id())->whereNull('deleted_at'),
            ],
        ]);

        if (! $ticket->isOpen()) {
            throw DomainException::conflict('This tab is closed.', 'TICKET_NOT_OPEN');
        }

        $ticket->forceFill(['waiter_id' => $data['waiter_id']])->save();

        return ApiResponse::ok($ticket->fresh(['table', 'items', 'waiter']), 'Table handed over.');
    }

    /**
     * Covers and takings per waiter.
     *
     * Tables and covers come from the tabs; money comes from the sales those
     * tabs settled into, reached through the items — a split bill rings several
     * sales against one tab, and every one of them belongs to that waiter's
     * evening.
     */
    public function waiterReport(Request $request)
    {
        $data = $request->validate([
            'from' => ['sometimes', 'nullable', 'date'],
            'to' => ['sometimes', 'nullable', 'date'],
        ]);

        $from = isset($data['from']) ? Carbon::parse($data['from'])->startOfDay() : now()->startOfDay();
        $to = isset($data['to']) ? Carbon::parse($data['to'])->endOfDay() : now()->endOfDay();

        $tickets = RestaurantTicket::query()
            ->with('items:id,ticket_id,sale_id')
            ->whereNotNull('waiter_id')
            ->whereBetween('opened_at', [$from, $to])
            ->get(['id', 'waiter_id', 'guest_count', 'status']);

        if ($tickets->isEmpty()) {
            return ApiResponse::ok(['from' => $from->toDateString(), 'to' => $to->toDateString(), 'rows' => []]);
        }

        // One pass for every sale any of these tabs produced, then attribute
        // each back to its waiter — rather than a query per waiter.
        $saleIdsByWaiter = [];
        foreach ($tickets as $t) {
            $ids = $t->items->pluck('sale_id')->filter()->unique()->all();
            $saleIdsByWaiter[$t->waiter_id] = array_unique([...($saleIdsByWaiter[$t->waiter_id] ?? []), ...$ids]);
        }

        $totals = Sale::query()
            ->whereIn('id', collect($saleIdsByWaiter)->flatten()->unique()->all())
            ->where('status', '!=', SaleStatus::Cancelled)
            ->get(['id', 'total', 'tip_amount'])
            ->keyBy('id');

        $names = User::query()
            ->whereIn('id', $tickets->pluck('waiter_id')->unique())
            ->pluck('name', 'id');

        $rows = $tickets->groupBy('waiter_id')->map(function ($group, $waiterId) use ($saleIdsByWaiter, $totals, $names) {
            $sales = collect($saleIdsByWaiter[$waiterId] ?? [])->map(fn ($id) => $totals->get($id))->filter();

            return [
                'waiter_id' => $waiterId,
                'waiter_name' => $names[$waiterId] ?? 'Removed user',
                'tables' => $group->count(),
                // Guest count is optional at open, so covers under-reports
                // rather than guessing — a guessed cover average is worse than
                // an honest gap.
                'covers' => (int) $group->sum('guest_count'),
                'sales_count' => $sales->count(),
                'sales_total' => round((float) $sales->sum(fn ($s) => (float) $s->total), 2),
                'tips_total' => round((float) $sales->sum(fn ($s) => (float) $s->tip_amount), 2),
                'open_tabs' => $group->where('status', RestaurantTicketStatus::Open)->count(),
            ];
        })->values()->sortByDesc('sales_total')->values();

        return ApiResponse::ok([
            'from' => $from->toDateString(),
            'to' => $to->toDateString(),
            'rows' => $rows,
        ]);
    }

    private function assertBelongs(?string $childParentId, string $ticketId): void
    {
        if ($childParentId !== $ticketId) {
            throw DomainException::unprocessable('That item does not belong to this tab.', 'ITEM_MISMATCH');
        }
    }

    /**
     * A tab belongs to the waiter serving it, and only they may write to it.
     *
     * READING is deliberately left open — a waiter running a colleague's food
     * needs to see the tab, and a floor where half the tables are blank is
     * worse than one where half are read-only. What this protects is the
     * per-waiter service report: if anyone can settle anyone's bill, the
     * takings it reports are not the waiter's, and a restaurant paying tips off
     * it is paying the wrong people.
     *
     * `tables.serve_any` lifts it — the till, a supervisor covering a break, a
     * manager fixing a bill.
     */
    private function assertMayWork(RestaurantTicket $ticket): void
    {
        $user = request()->user();

        if ($ticket->isServedBy($user) || $user?->hasPermission(Permissions::TABLES_SERVE_ANY)) {
            return;
        }

        $whose = $ticket->waiter?->name ?? 'another waiter';

        throw DomainException::forbidden(
            "This tab is {$whose}'s. Ask them or a supervisor to hand the table over.",
            'NOT_YOUR_TABLE',
        );
    }
}
