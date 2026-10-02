<?php

namespace App\Actions\Fuel;

use App\Exceptions\DomainException;
use App\Models\ForecourtDip;
use App\Models\ForecourtReading;
use App\Models\ForecourtShift;
use App\Models\FuelNozzle;
use App\Models\FuelTank;
use App\Models\SaleItem;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * ABANDON A SHIFT THAT SHOULD NEVER HAVE BEEN OPENED.
 *
 * One forecourt, one open shift. That rule is right — two would each hold a
 * claim on the same meters and neither could be reconciled — but it has a
 * consequence nobody designed: a shift opened in error BLOCKS THE WHOLE
 * STATION until it is closed, and closing demands a closing reading for
 * every nozzle and a dip for every tank.
 *
 * The manager who pressed the button at the wrong station therefore had two
 * bad choices. Invent a set of closing figures, which puts a reconciliation
 * that never happened into the month's fuel report for ever. Or leave it
 * open, which stops the real shift being opened at all — on a station
 * running three shifts a day, that is the night's trading.
 *
 * ── What cancelling is, and what it is NOT ──────────────────────────────
 *
 * It is a way back to EXACTLY the state the forecourt was in a minute ago,
 * and nothing more. It is not a way to discard a shift that went badly, and
 * every fence below exists to keep those two apart:
 *
 *   NOTHING SOLD      a shift with fuel rung inside its window has a real
 *                     reconciliation owed. Abandoning it would throw away
 *                     the only record of litres that left the ground.
 *   NOTHING DELIVERED a tanker discharged into a tank during the shift
 *                     moved the dip; putting the dip back would un-receive
 *                     fuel the station is holding.
 *   PLANT RESTORABLE  opening may wind a totaliser forward or overwrite a
 *                     dip. Both are put back from the snapshot taken at the
 *                     time — and a shift opened before that snapshot
 *                     existed CANNOT be cancelled, because a cancel that
 *                     restores a number it invented is worse than no cancel.
 *
 * The row stays, as `cancelled`, with who and why on it.
 */
class CancelForecourtShiftAction
{
    public function execute(User $user, ForecourtShift $shift, ?string $reason = null): ForecourtShift
    {
        return DB::transaction(function () use ($user, $shift, $reason): ForecourtShift {
            /** @var ForecourtShift $locked */
            $locked = ForecourtShift::query()->whereKey($shift->id)->lockForUpdate()->firstOrFail();

            if (! $locked->isOpen()) {
                throw DomainException::conflict(
                    $locked->status === ForecourtShift::STATUS_CANCELLED
                        ? "Forecourt shift {$locked->number} was already cancelled."
                        : "Forecourt shift {$locked->number} is closed — it has been reconciled and cannot be undone.",
                    'FORECOURT_SHIFT_NOT_OPEN',
                );
            }

            $readings = ForecourtReading::query()->where('forecourt_shift_id', $locked->id)->get();
            $dips = ForecourtDip::query()->where('forecourt_shift_id', $locked->id)->get();

            // ── Was anything sold on it? ────────────────────────────
            $productIds = $dips->pluck('product_id')->filter()->unique()->values();

            if ($productIds->isNotEmpty()) {
                $litres = (float) SaleItem::query()
                    ->join('sales', 'sales.id', '=', 'sale_items.sale_id')
                    ->whereIn('sale_items.product_id', $productIds)
                    ->where('sales.status', '!=', 'cancelled')
                    ->when($locked->branch_id !== null, fn ($q) => $q->where('sales.branch_id', $locked->branch_id))
                    ->whereBetween('sales.sold_at', [$locked->opened_at, now()])
                    ->sum(DB::raw('sale_items.quantity * COALESCE(sale_items.unit_factor, 1)'));

                if ($litres > 0.0001) {
                    throw DomainException::conflict(
                        'Fuel has been sold on this shift ('.rtrim(rtrim(number_format($litres, 3), '0'), '.')
                        .' litres), so it has to be closed and reconciled — cancelling would throw away the only '
                        .'record of what left the ground.',
                        'FORECOURT_SHIFT_HAS_SALES',
                    );
                }
            }

            // ── Did a tanker arrive during it? ──────────────────────
            $delivered = (int) DB::table('fuel_deliveries')
                ->where('tenant_id', $locked->tenant_id)
                ->whereIn('fuel_tank_id', $dips->pluck('fuel_tank_id'))
                ->where('created_at', '>=', $locked->opened_at)
                ->count();

            if ($delivered > 0) {
                throw DomainException::conflict(
                    'A delivery was booked into one of these tanks during this shift, so the dips have moved. '
                    .'Close the shift instead — cancelling would un-receive fuel the station is holding.',
                    'FORECOURT_SHIFT_HAS_DELIVERY',
                );
            }

            // ── Can the plant be put back exactly? ──────────────────
            $blind = $readings->contains(fn (ForecourtReading $r) => $r->previous_reading === null)
                || $dips->contains(fn (ForecourtDip $d) => $d->previous_dip === null);

            if ($blind) {
                throw DomainException::unprocessable(
                    'This shift was opened before the forecourt started recording what the meters read '
                    .'beforehand, so there is nothing to put them back to. Close it with the readings you have.',
                    'FORECOURT_NO_RESTORE_POINT',
                );
            }

            foreach ($readings as $reading) {
                FuelNozzle::query()
                    ->whereKey($reading->fuel_nozzle_id)
                    ->update(['current_reading' => $reading->previous_reading]);
            }

            foreach ($dips as $dip) {
                FuelTank::query()
                    ->whereKey($dip->fuel_tank_id)
                    ->update(['current_dip_litres' => $dip->previous_dip]);
            }

            $locked->forceFill([
                'status' => ForecourtShift::STATUS_CANCELLED,
                'cancelled_by' => $user->id,
                'cancelled_at' => now(),
                'cancel_reason' => $reason,
            ])->save();

            return $locked->fresh(['readings', 'dips']);
        });
    }
}
