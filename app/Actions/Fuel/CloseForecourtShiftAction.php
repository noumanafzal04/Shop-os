<?php

namespace App\Actions\Fuel;

use App\Exceptions\DomainException;
use App\Models\ForecourtDip;
use App\Models\ForecourtReading;
use App\Models\ForecourtShift;
use App\Models\FuelDelivery;
use App\Models\FuelNozzle;
use App\Models\FuelPriceChange;
use App\Models\FuelTank;
use App\Models\Product;
use App\Models\SaleItem;
use App\Models\User;
use App\Services\InventoryService;
use Illuminate\Support\Facades\DB;

/**
 * Close a forecourt shift and reconcile it.
 *
 * Everything a petrol pump can't see is decided here. Three numbers come out,
 * and they answer three different questions — which is the whole reason none of
 * them may be merged into a single "variance":
 *
 *   LITRES SOLD (meters)     what physically went into customers' vehicles.
 *   UNBILLED (meters − till) fuel that left a nozzle and was never rung up.
 *                            An attendant problem, or an untrained cashier.
 *   TANK VARIANCE (book−dip) fuel that left the TANK without crossing a meter.
 *                            A leak, evaporation, or someone drawing directly.
 *
 * Report one combined figure and the owner can no longer tell a theft at the
 * nozzle from a hole in the ground. They are chased by different people, on
 * different days, with different consequences.
 *
 * ── Test litres ───────────────────────────────────────────────────────
 * A calibration check pumps litres into a measure and tips them back. They
 * cross the meter but were never sold, so they come off the sold litres AND
 * they never left the tank. Miss the second half and every accuracy check the
 * inspector performs shows up as a theft.
 *
 * ── Why the dip wins ──────────────────────────────────────────────────
 * The close posts ONE stock adjustment per fuel product: a `set` to the summed
 * closing dip. The till's decrements were the shop's best guess; the dip is a
 * measurement of what is actually underground. That only holds if every tank at
 * the branch was dipped, so a missing dip refuses the close rather than setting
 * a product's stock to a partial total and quietly erasing a tank.
 *
 * ── Written once ──────────────────────────────────────────────────────
 * Every figure below is stored on the shift, never recomputed. A variance
 * somebody signed off in March must read the same in September, whatever has
 * happened to prices or nozzle assignments since.
 */
class CloseForecourtShiftAction
{
    public function __construct(private readonly InventoryService $inventory) {}

    /**
     * @param  array{
     *     readings: array<int, array{fuel_nozzle_id: string, closing_reading: float|int|string, test_litres?: float|int|string}>,
     *     dips: array<int, array{fuel_tank_id: string, closing_dip?: float|int|string, closing_dip_mm?: int|string}>,
     *     notes?: ?string
     * }  $data
     */
    public function execute(User $user, ForecourtShift $shift, array $data): ForecourtShift
    {
        return DB::transaction(function () use ($user, $shift, $data): ForecourtShift {
            /** @var ForecourtShift $locked */
            $locked = ForecourtShift::query()->whereKey($shift->id)->lockForUpdate()->firstOrFail();

            if (! $locked->isOpen()) {
                throw DomainException::conflict(
                    "Forecourt shift {$locked->number} is already closed.",
                    'FORECOURT_SHIFT_CLOSED',
                );
            }

            $closedAt = now();
            $readingInput = collect($data['readings'])->keyBy('fuel_nozzle_id');
            $dipInput = collect($data['dips'])->keyBy('fuel_tank_id');

            $readings = ForecourtReading::query()->where('forecourt_shift_id', $locked->id)->get();
            $dips = ForecourtDip::query()->where('forecourt_shift_id', $locked->id)->get();

            // ── The meters ──────────────────────────────────────────
            $litresSold = 0.0;
            $testLitres = 0.0;
            $fuelValue = 0.0;
            /** @var array<string, float> $litresByTank */
            $litresByTank = [];

            foreach ($readings as $reading) {
                $row = $readingInput[$reading->fuel_nozzle_id] ?? null;

                if ($row === null) {
                    throw DomainException::unprocessable(
                        "No closing reading for {$reading->pump_name} / {$reading->nozzle_name}. Every nozzle the shift opened on has to be read.",
                        'READING_MISSING',
                    );
                }

                $opening = (float) $reading->opening_reading;
                $closing = (float) $row['closing_reading'];
                $test = round((float) ($row['test_litres'] ?? 0), 3);

                $throughput = FuelNozzle::litresBetween($opening, $closing);
                $sold = round($throughput - $test, 3);

                if ($test < 0) {
                    throw DomainException::unprocessable('Test litres cannot be negative.', 'INVALID_TEST_LITRES');
                }

                // More tested than pumped is a keying error, not a reading. Let
                // it through and the shift books negative sales.
                if ($sold < 0) {
                    throw DomainException::unprocessable(
                        "{$reading->nozzle_name}: test litres ({$test}) exceed the {$throughput} litres the meter moved.",
                        'TEST_EXCEEDS_THROUGHPUT',
                    );
                }

                $value = round($sold * (float) $reading->unit_price, 2);

                $reading->update([
                    'closing_reading' => $closing,
                    'test_litres' => $test,
                    'litres_sold' => $sold,
                    'value' => $value,
                ]);

                $litresSold += $sold;
                $testLitres += $test;
                $fuelValue += $value;

                $nozzle = FuelNozzle::query()->whereKey($reading->fuel_nozzle_id)->first();
                if ($nozzle !== null) {
                    $litresByTank[$nozzle->fuel_tank_id] = ($litresByTank[$nozzle->fuel_tank_id] ?? 0) + $sold;
                    $nozzle->update(['current_reading' => $closing]);
                }
            }

            // ── The till ────────────────────────────────────────────
            // What the counter actually rang for these fuels inside the shift's
            // window. Cancelled sales are excluded — a voided sale put the fuel
            // back on the books, and it never went back in the tank.
            $productIds = $dips->pluck('product_id')->filter()->unique()->values();

            $posRow = SaleItem::query()
                ->join('sales', 'sales.id', '=', 'sale_items.sale_id')
                ->whereIn('sale_items.product_id', $productIds)
                ->where('sales.status', '!=', 'cancelled')
                ->when($locked->branch_id !== null, fn ($q) => $q->where('sales.branch_id', $locked->branch_id))
                ->whereBetween('sales.sold_at', [$locked->opened_at, $closedAt])
                ->selectRaw('COALESCE(SUM(sale_items.quantity * COALESCE(sale_items.unit_factor, 1)), 0) as litres')
                ->selectRaw('COALESCE(SUM(sale_items.line_total), 0) as value')
                ->first();

            $posLitres = round((float) ($posRow->litres ?? 0), 3);
            $posValue = round((float) ($posRow->value ?? 0), 2);

            // ── The tanks ───────────────────────────────────────────
            /** @var array<string, float> $dipByProduct */
            $dipByProduct = [];
            $varianceLitres = 0.0;
            $varianceValue = 0.0;

            foreach ($dips as $dip) {
                $row = $dipInput[$dip->fuel_tank_id] ?? null;

                if ($row === null) {
                    throw DomainException::unprocessable(
                        "No closing dip for {$dip->tank_name}. Every tank has to be dipped, or the stock this shift posts is a partial count.",
                        'DIP_MISSING',
                    );
                }

                $tank = FuelTank::query()->whereKey($dip->fuel_tank_id)->with(['product', 'dipPoints'])->first();

                // ── A STICK READS MILLIMETRES ───────────────────────────
                //
                // A dipstick does not read in litres, and an underground
                // cylinder holds a wildly different volume per millimetre at
                // the bottom, the middle and the top. Until now the operator
                // did that lookup by hand off a paper chart, in the dark, at
                // the end of a shift — and typed the result into the one number
                // the whole leak detection rests on.
                //
                // Exactly one of the two, and the rule is HERE rather than in
                // the request for the same reason it is for a sale line: a
                // request validates shape and range, an action owns the rule,
                // and a rule that names a sibling path stops working the moment
                // somebody re-keys the request under a prefix.
                $askedMm = isset($row['closing_dip_mm']) ? (int) $row['closing_dip_mm'] : null;

                if ($askedMm !== null && isset($row['closing_dip'])) {
                    throw DomainException::unprocessable(
                        "The dip for {$dip->tank_name} was given twice — in millimetres and in litres.",
                        'DIP_GIVEN_TWICE',
                    );
                }

                if ($askedMm === null && ! isset($row['closing_dip'])) {
                    throw DomainException::unprocessable(
                        "The dip for {$dip->tank_name} names neither millimetres nor litres.",
                        'DIP_MISSING',
                    );
                }

                if ($askedMm !== null) {
                    if ($tank === null || ! $tank->hasDipChart()) {
                        throw DomainException::unprocessable(
                            "{$dip->tank_name} has no calibration chart loaded, so a dip in millimetres cannot be turned into litres. Add the chart under Tanks & pumps, or enter litres.",
                            'NO_DIP_CHART',
                        );
                    }

                    $converted = $tank->litresAtDip($askedMm);

                    // OUTSIDE the chart, not merely unhelpful. A depth the
                    // chart does not cover is a mis-read stick or the wrong
                    // chart, and extrapolating past its ends would invent a
                    // volume for a tank nobody has measured that far up.
                    if ($converted === null) {
                        throw DomainException::unprocessable(
                            "{$askedMm}mm is outside {$dip->tank_name}'s calibration chart. Check the reading, or check the chart covers this tank.",
                            'DIP_OFF_THE_CHART',
                        );
                    }

                    $closingDip = $converted;
                } else {
                    $closingDip = round((float) $row['closing_dip'], 3);
                }

                if ($closingDip < 0) {
                    throw DomainException::unprocessable('A dip cannot be negative.', 'INVALID_DIP');
                }

                // Litres discharged into this tank during the shift, by the
                // shop's own dip measurement rather than the tanker's invoice.
                $delivered = round((float) FuelDelivery::query()
                    ->where('forecourt_shift_id', $locked->id)
                    ->where('fuel_tank_id', $dip->fuel_tank_id)
                    ->sum('received_litres'), 3);

                $meterLitres = round($litresByTank[$dip->fuel_tank_id] ?? 0, 3);
                $book = round((float) $dip->opening_dip + $delivered - $meterLitres, 3);
                $variance = round($book - $closingDip, 3);

                $unitPrice = (float) ($tank?->product?->price ?? 0);

                $dip->update([
                    'closing_dip' => $closingDip,
                    // The reading the operator actually took, kept beside the
                    // litres it became. A derived figure with no record of its
                    // source cannot be re-checked: "the chart says 1,180 at
                    // 620mm" is answerable months later and "the dip was 1,180"
                    // is not. Null where litres were typed straight in.
                    'closing_dip_mm' => $askedMm,
                    'delivered_litres' => $delivered,
                    'meter_litres' => $meterLitres,
                    'book_closing' => $book,
                    'variance_litres' => $variance,
                    'variance_value' => round($variance * $unitPrice, 2),
                ]);

                $varianceLitres += $variance;
                $varianceValue += round($variance * $unitPrice, 2);

                if ($dip->product_id !== null) {
                    $dipByProduct[$dip->product_id] = ($dipByProduct[$dip->product_id] ?? 0) + $closingDip;
                }

                $tank?->update(['current_dip_litres' => $closingDip]);
            }

            // ── Stock follows the dip ───────────────────────────────
            foreach ($dipByProduct as $productId => $litres) {
                $product = Product::query()->whereKey($productId)->first();

                // A station that doesn't stock-track its fuel still wants the
                // reconciliation; it just has no stock row to correct.
                if ($product === null || ! $product->track_inventory) {
                    continue;
                }

                $this->inventory->adjust([
                    'product_id' => $productId,
                    'type' => 'set',
                    'new_quantity' => round($litres, 3),
                    'reason' => "Forecourt {$locked->number} closing dip",
                    'reference_type' => 'forecourt_shift',
                    'reference_id' => $locked->id,
                    'idempotency_key' => "forecourt-{$locked->id}-{$productId}",
                    'branch_id' => $locked->branch_id,
                ]);
            }

            // A price notification inside the window means the litres above were
            // valued at a rate that stopped being true mid-shift. Say so on the
            // record rather than presenting an approximation as exact.
            $pricedMidShift = FuelPriceChange::query()
                ->whereIn('product_id', $productIds)
                ->whereBetween('effective_at', [$locked->opened_at, $closedAt])
                ->exists();

            $locked->update([
                'status' => ForecourtShift::STATUS_CLOSED,
                'closed_by' => $user->id,
                'closed_at' => $closedAt,
                'litres_sold' => round($litresSold, 3),
                'test_litres' => round($testLitres, 3),
                'fuel_value' => round($fuelValue, 2),
                'pos_fuel_litres' => $posLitres,
                'pos_fuel_value' => $posValue,
                'unbilled_litres' => round($litresSold - $posLitres, 3),
                'unbilled_value' => round($fuelValue - $posValue, 2),
                'tank_variance_litres' => round($varianceLitres, 3),
                'tank_variance_value' => round($varianceValue, 2),
                'price_changed_during' => $pricedMidShift,
                'notes' => $data['notes'] ?? $locked->notes,
            ]);

            return $locked->fresh(['readings', 'dips']);
        });
    }
}
