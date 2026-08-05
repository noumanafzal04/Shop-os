<?php

namespace App\Actions\Restaurant;

use App\Enums\RestaurantTicketStatus;
use App\Exceptions\DomainException;
use App\Models\DiningTable;
use App\Models\RestaurantTicket;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Open a running tab — on a table (dine-in) or free-standing (takeaway).
 * One open tab per table: a second open on an occupied table is rejected so a
 * waiter re-uses the existing tab instead of splitting a party across two.
 */
class OpenTicketAction
{
    public function __construct(private readonly TenantContext $context)
    {
    }

    public function execute(array $data): RestaurantTicket
    {
        $tenantId = $this->context->id();
        $orderType = $data['order_type'] ?? 'dine_in';

        return DB::transaction(function () use ($data, $tenantId, $orderType): RestaurantTicket {
            $tableId = $data['dining_table_id'] ?? null;

            if ($tableId !== null) {
                /** @var DiningTable|null $table */
                $table = DiningTable::query()->whereKey($tableId)->first();
                if ($table === null) {
                    throw DomainException::unprocessable('That table no longer exists.', 'TABLE_UNAVAILABLE');
                }

                // Lock any open tab on this table — two waiters seating the same
                // table serialize here; the second sees it occupied.
                $occupied = RestaurantTicket::query()
                    ->where('dining_table_id', $tableId)
                    ->where('status', RestaurantTicketStatus::Open->value)
                    ->lockForUpdate()
                    ->exists();

                if ($occupied) {
                    throw DomainException::conflict(
                        "Table {$table->name} already has an open tab — add to it instead.",
                        'TABLE_OCCUPIED',
                    );
                }
            }

            $seq = RestaurantTicket::withoutTenancy()
                ->where('tenant_id', $tenantId)
                ->withTrashed()
                ->count() + 1;

            /** @var RestaurantTicket $ticket */
            $ticket = RestaurantTicket::query()->create([
                'ticket_number' => 'TAB-'.str_pad((string) $seq, 5, '0', STR_PAD_LEFT),
                'dining_table_id' => $orderType === 'dine_in' ? $tableId : null,
                'order_type' => $orderType,
                'status' => RestaurantTicketStatus::Open,
                'guest_count' => $data['guest_count'] ?? null,
                // Whoever opens the tab is serving it until someone says
                // otherwise — the common case, and a sane default for the
                // service report. Reassigned on handover (see assignWaiter).
                'waiter_id' => $data['waiter_id'] ?? auth()->id(),
                'customer_name' => $data['customer_name'] ?? null,
                'customer_phone' => $data['customer_phone'] ?? null,
                'notes' => $data['notes'] ?? null,
                'opened_at' => now(),
            ]);

            return $ticket->load('table', 'items');
        });
    }
}
