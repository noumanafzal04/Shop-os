<?php

namespace App\Actions\Restaurant;

use App\Exceptions\DomainException;
use App\Models\KitchenTicket;
use App\Models\RestaurantTicket;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * "Send to kitchen": fire the tab's pending (or a chosen subset of) items as a
 * new Kitchen Order Ticket (KOT). Fired items are stamped with the KOT id and
 * flip to kot_status = fired so a later fire only sends the newly-added items.
 */
class FireKitchenTicketAction
{
    public function __construct(private readonly TenantContext $context)
    {
    }

    public function execute(RestaurantTicket $ticket, array $data = []): KitchenTicket
    {
        if (! $ticket->isOpen()) {
            throw DomainException::conflict('This tab is closed.', 'TICKET_NOT_OPEN');
        }

        $tenantId = $this->context->id();

        return DB::transaction(function () use ($ticket, $data, $tenantId): KitchenTicket {
            $query = $ticket->items()
                ->whereNull('voided_at')
                ->where('kot_status', 'pending')
                ->lockForUpdate();

            if (! empty($data['item_ids'])) {
                $query->whereIn('id', $data['item_ids']);
            }

            $items = $query->get();

            if ($items->isEmpty()) {
                throw DomainException::unprocessable(
                    'Nothing new to send — all items have already been fired to the kitchen.',
                    'NOTHING_TO_FIRE',
                );
            }

            $kotNumber = (int) $ticket->kitchenTickets()->count() + 1;

            /** @var KitchenTicket $kot */
            $kot = KitchenTicket::query()->create([
                'tenant_id' => $tenantId,
                'ticket_id' => $ticket->id,
                'kot_number' => $kotNumber,
                'station' => $data['station'] ?? null,
                'status' => 'fired',
                'notes' => $data['notes'] ?? null,
                'fired_at' => now(),
                'fired_by' => auth()->id(),
            ]);

            foreach ($items as $item) {
                $item->update([
                    'kitchen_ticket_id' => $kot->id,
                    'kot_status' => 'fired',
                ]);
            }

            return $kot->load('items');
        });
    }
}
