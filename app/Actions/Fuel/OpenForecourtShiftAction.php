<?php

namespace App\Actions\Fuel;

use App\Exceptions\DomainException;
use App\Models\Branch;
use App\Models\ForecourtDip;
use App\Models\ForecourtReading;
use App\Models\ForecourtShift;
use App\Models\FuelNozzle;
use App\Models\FuelTank;
use App\Models\User;
use App\Support\DocumentCounter;
use Illuminate\Support\Facades\DB;

/**
 * Start a forecourt shift: photograph every meter and every tank, then walk
 * away.
 *
 * The snapshot has to be TOTAL. A shift that opens on three of four nozzles
 * closes with a fourth hose that dispensed all night and appears nowhere, and
 * — worse — the tank reconciliation subtracts three nozzles' litres from a
 * tank that four drew on, turning an ordinary night into a phantom loss the
 * owner will spend a week chasing. So the shift takes every active nozzle and
 * every active tank at the branch, or it does not open.
 *
 * Readings default to what the equipment already says it is on, which is the
 * previous shift's closing number. Overrides exist for exactly two cases: the
 * first shift ever recorded, and a meter replaced mid-life. Both are keyed in
 * by a human, and both are worth the audit trail of being explicit.
 */
class OpenForecourtShiftAction
{
    /**
     * @param  array{
     *     branch_id?: ?string,
     *     readings?: array<int, array{fuel_nozzle_id: string, opening_reading: float|int|string}>,
     *     dips?: array<int, array{fuel_tank_id: string, opening_dip: float|int|string}>,
     *     notes?: ?string
     * }  $data
     */
    public function execute(User $user, array $data): ForecourtShift
    {
        return DB::transaction(function () use ($user, $data): ForecourtShift {
            // A single-site station never sends a branch. Resolve it to Main
            // rather than leaving it null, or the shift looks at a forecourt
            // with no branch and finds no equipment at all.
            $branchId = $data['branch_id'] ?? Branch::query()->where('is_default', true)->value('id');

            // One forecourt, one open shift. Two would each hold a claim on the
            // same meters and neither could be reconciled.
            $existing = ForecourtShift::query()
                ->where('status', ForecourtShift::STATUS_OPEN)
                ->where('branch_id', $branchId)
                ->lockForUpdate()
                ->first();

            if ($existing !== null) {
                throw DomainException::conflict(
                    "Forecourt shift {$existing->number} is still open. Close it before starting the next one.",
                    'FORECOURT_SHIFT_OPEN',
                );
            }

            $tanks = FuelTank::query()
                ->where('is_active', true)
                ->where('branch_id', $branchId)
                ->with('product')
                ->get();

            $nozzles = FuelNozzle::query()
                ->where('is_active', true)
                ->whereIn('fuel_tank_id', $tanks->pluck('id'))
                ->with(['pump', 'tank.product'])
                ->get();

            if ($tanks->isEmpty() || $nozzles->isEmpty()) {
                throw DomainException::unprocessable(
                    'Set up at least one tank and one nozzle before running a forecourt shift.',
                    'NO_FORECOURT_CONFIGURED',
                );
            }

            $readingOverrides = collect($data['readings'] ?? [])->keyBy('fuel_nozzle_id');
            $dipOverrides = collect($data['dips'] ?? [])->keyBy('fuel_tank_id');

            $shift = ForecourtShift::query()->create([
                'branch_id' => $branchId,
                'number' => DocumentCounter::formatted($user->tenant_id, 'forecourt_shift', 'FC'),
                'status' => ForecourtShift::STATUS_OPEN,
                'opened_by' => $user->id,
                'opened_at' => now(),
                'notes' => $data['notes'] ?? null,
            ]);

            foreach ($nozzles as $nozzle) {
                $opening = isset($readingOverrides[$nozzle->id])
                    ? (float) $readingOverrides[$nozzle->id]['opening_reading']
                    : (float) $nozzle->current_reading;

                // A meter cannot be wound back. Refusing here is the difference
                // between catching a typo now and discovering at close that the
                // shift "sold" 400,000 litres.
                if ($opening < (float) $nozzle->current_reading) {
                    throw DomainException::unprocessable(
                        "Opening reading for {$nozzle->name} is below its last recorded reading ({$nozzle->current_reading}). A totaliser only counts up.",
                        'READING_WENT_BACKWARDS',
                    );
                }

                $product = $nozzle->tank?->product;

                ForecourtReading::query()->create([
                    'forecourt_shift_id' => $shift->id,
                    'fuel_nozzle_id' => $nozzle->id,
                    'nozzle_name' => $nozzle->name,
                    'pump_name' => $nozzle->pump?->name ?? '—',
                    'product_id' => $product?->id,
                    'product_name' => $product?->name ?? '—',
                    'opening_reading' => $opening,
                    // The rate in force as the shift opens. Snapshotted so a
                    // midnight price notification can't retroactively revalue
                    // litres that were sold before it landed.
                    'unit_price' => (float) ($product?->price ?? 0),
                ]);

                if ($opening !== (float) $nozzle->current_reading) {
                    $nozzle->update(['current_reading' => $opening]);
                }
            }

            foreach ($tanks as $tank) {
                $opening = isset($dipOverrides[$tank->id])
                    ? (float) $dipOverrides[$tank->id]['opening_dip']
                    : (float) $tank->current_dip_litres;

                ForecourtDip::query()->create([
                    'forecourt_shift_id' => $shift->id,
                    'fuel_tank_id' => $tank->id,
                    'tank_name' => $tank->name,
                    'product_id' => $tank->product_id,
                    'opening_dip' => $opening,
                ]);

                if ($opening !== (float) $tank->current_dip_litres) {
                    $tank->update(['current_dip_litres' => $opening]);
                }
            }

            return $shift->fresh(['readings', 'dips']);
        });
    }
}
