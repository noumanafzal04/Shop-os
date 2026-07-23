<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Restaurant\AddTicketItemsAction;
use App\Actions\Restaurant\FireKitchenTicketAction;
use App\Actions\Restaurant\OpenTicketAction;
use App\Actions\Restaurant\SettleTicketAction;
use App\Enums\RestaurantTicketStatus;
use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Restaurant\AddTicketItemsRequest;
use App\Http\Requests\Restaurant\FireKitchenTicketRequest;
use App\Http\Requests\Restaurant\OpenTicketRequest;
use App\Http\Requests\Restaurant\SettleTicketRequest;
use App\Models\KitchenTicket;
use App\Models\RestaurantTicket;
use App\Models\RestaurantTicketItem;
use App\Support\ApiResponse;
use App\Support\TenantContext;
use Illuminate\Http\Request;

/**
 * Dine-in / takeaway running tabs: open a tab, add items, fire kitchen tickets,
 * and settle (whole or split-by-item) into Sales.
 */
class RestaurantTicketController extends Controller
{
    public function __construct(private readonly TenantContext $context)
    {
    }

    public function index(Request $request)
    {
        $status = $request->input('status', RestaurantTicketStatus::Open->value);

        $tickets = RestaurantTicket::query()
            ->when($status !== 'all', fn ($q) => $q->where('status', $status))
            ->with(['table', 'items'])
            ->orderByDesc('opened_at')
            ->paginate((int) $request->input('per_page', 30));

        return ApiResponse::paginated($tickets);
    }

    public function store(OpenTicketRequest $request, OpenTicketAction $action)
    {
        $ticket = $action->execute($request->validated());

        return ApiResponse::created($ticket, "Tab {$ticket->ticket_number} opened.");
    }

    public function show(RestaurantTicket $ticket)
    {
        return ApiResponse::ok($ticket->load(['table', 'items', 'kitchenTickets']));
    }

    public function addItems(AddTicketItemsRequest $request, RestaurantTicket $ticket, AddTicketItemsAction $action)
    {
        $ticket = $action->execute($ticket, $request->validated());

        return ApiResponse::ok($ticket, 'Items added to the tab.');
    }

    /**
     * Void a single line (a mistake / a walk-out item). Never a paid line.
     */
    public function voidItem(Request $request, RestaurantTicket $ticket, RestaurantTicketItem $item)
    {
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

    public function fire(FireKitchenTicketRequest $request, RestaurantTicket $ticket, FireKitchenTicketAction $action)
    {
        $kot = $action->execute($ticket, $request->validated());

        return ApiResponse::created($kot, "Kitchen ticket #{$kot->kot_number} fired.");
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

    private function assertBelongs(?string $childParentId, string $ticketId): void
    {
        if ($childParentId !== $ticketId) {
            throw DomainException::unprocessable('That item does not belong to this tab.', 'ITEM_MISMATCH');
        }
    }
}
