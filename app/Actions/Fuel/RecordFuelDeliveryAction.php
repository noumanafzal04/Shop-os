<?php

namespace App\Actions\Fuel;

use App\Exceptions\DomainException;
use App\Models\ForecourtShift;
use App\Models\FuelDelivery;
use App\Models\FuelTank;
use App\Models\User;
use App\Services\InventoryService;
use Illuminate\Support\Facades\DB;

/**
 * A tanker discharges into a tank.
 *
 * Two measurements, deliberately kept apart:
 *
 *   INVOICED   what the supplier says they delivered, and what the station will
 *              be billed for.
 *   RECEIVED   the dip either side of the discharge — the station's own count.
 *
 * They routinely differ by a few hundred litres. A station that records only
 * the invoice pays for every one of those litres and has nothing to argue with;
 * a station that records only the dip cannot tell a short load from a leak. The
 * shortage is stored, not derived on a report, so it survives a later price
 * edit and can be taken to the supplier months on.
 *
 * The received litres — never the invoiced ones — are what enters stock and
 * what the shift's book stock is built from. Only fuel that is actually in the
 * ground can be sold out of it.
 */
class RecordFuelDeliveryAction
{
    public function __construct(private readonly InventoryService $inventory) {}

    /**
     * @param  array{
     *     fuel_tank_id: string, invoiced_litres: float|int|string,
     *     dip_before?: float|int|string|null, dip_after?: float|int|string|null,
     *     received_litres?: float|int|string|null,
     *     supplier_id?: ?string, invoice_number?: ?string, tanker_number?: ?string,
     *     unit_cost?: float|int|string|null, received_at?: ?string, notes?: ?string
     * }  $data
     */
    public function execute(User $user, array $data): FuelDelivery
    {
        return DB::transaction(function () use ($user, $data): FuelDelivery {
            /** @var FuelTank $tank */
            $tank = FuelTank::query()->whereKey($data['fuel_tank_id'])->lockForUpdate()->firstOrFail();

            $invoiced = round((float) $data['invoiced_litres'], 3);

            if ($invoiced <= 0) {
                throw DomainException::unprocessable('A delivery has to be more than zero litres.', 'INVALID_DELIVERY');
            }

            $dipBefore = isset($data['dip_before']) ? round((float) $data['dip_before'], 3) : null;
            $dipAfter = isset($data['dip_after']) ? round((float) $data['dip_after'], 3) : null;

            // Preference order: the dips, then an explicit count, then the
            // invoice. The invoice is the weakest evidence and the last resort.
            if ($dipBefore !== null && $dipAfter !== null) {
                $received = round($dipAfter - $dipBefore, 3);

                if ($received < 0) {
                    throw DomainException::unprocessable(
                        'The dip after the discharge is lower than the dip before it.',
                        'INVALID_DELIVERY_DIPS',
                    );
                }
            } elseif (isset($data['received_litres'])) {
                $received = round((float) $data['received_litres'], 3);
            } else {
                $received = $invoiced;
            }

            $newDip = $dipAfter ?? round((float) $tank->current_dip_litres + $received, 3);

            // A tanker that won't fit has to be turned away at the gate, not
            // discovered by fuel across the forecourt.
            if ((float) $tank->capacity_litres > 0 && $newDip > (float) $tank->capacity_litres) {
                throw DomainException::unprocessable(
                    "{$tank->name} holds {$tank->capacity_litres} litres; this delivery would put {$newDip} in it.",
                    'TANK_OVERFILL',
                );
            }

            $unitCost = round((float) ($data['unit_cost'] ?? 0), 3);

            // The shift the fuel landed in, so its litres join that shift's book
            // stock. A delivery outside any open shift simply carries no shift.
            $shift = ForecourtShift::query()
                ->where('status', ForecourtShift::STATUS_OPEN)
                ->where('branch_id', $tank->branch_id)
                ->first();

            $delivery = FuelDelivery::query()->create([
                'branch_id' => $tank->branch_id,
                'fuel_tank_id' => $tank->id,
                'forecourt_shift_id' => $shift?->id,
                'supplier_id' => $data['supplier_id'] ?? null,
                'invoice_number' => $data['invoice_number'] ?? null,
                'tanker_number' => $data['tanker_number'] ?? null,
                'invoiced_litres' => $invoiced,
                'dip_before' => $dipBefore,
                'dip_after' => $dipAfter,
                'received_litres' => $received,
                'shortage_litres' => round($invoiced - $received, 3),
                'unit_cost' => $unitCost,
                'total_cost' => round($received * $unitCost, 2),
                'received_at' => $data['received_at'] ?? now(),
                'received_by' => $user->id,
                'notes' => $data['notes'] ?? null,
            ]);

            $tank->update(['current_dip_litres' => $newDip]);

            $product = $tank->product;

            if ($product !== null && $product->track_inventory) {
                $this->inventory->adjust([
                    'product_id' => $product->id,
                    'type' => 'in',
                    'quantity' => $received,
                    'reason' => "Tanker into {$tank->name}",
                    'reference_type' => 'fuel_delivery',
                    'reference_id' => $delivery->id,
                    'idempotency_key' => "fuel-delivery-{$delivery->id}",
                    'branch_id' => $tank->branch_id,
                ]);
            }

            return $delivery->fresh(['tank', 'supplier']);
        });
    }
}
