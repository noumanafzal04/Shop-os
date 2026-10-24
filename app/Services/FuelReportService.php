<?php

namespace App\Services;

use App\Models\ForecourtReading;
use App\Models\ForecourtShift;
use App\Models\FuelTank;
use App\Models\SaleItem;
use App\Support\ShopDay;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * A MONTH OF THE FORECOURT, NOT A NIGHT OF IT.
 *
 * Every figure a station reconciles by was already being written — at close,
 * once, never recomputed — and could only be read one shift at a time. So a
 * manager could see that Tuesday was forty litres short and could not see that
 * it had been forty litres short every Tuesday for a month, which is the only
 * form in which that fact is worth anything.
 *
 * ── It reports what was RECORDED, not what it can recompute ─────────────
 *
 * Nothing here re-derives a variance from today's prices or today's nozzle
 * assignments. The shift columns are a signed-off snapshot: a reconciliation
 * from last March must read the same next March even though a rate has changed
 * fifty times since. Re-deriving would silently rewrite a figure somebody put
 * their name to.
 *
 * ── The two variances stay apart ────────────────────────────────────────
 *
 * A forecourt is measured twice on purpose.
 *
 *   unbilled   meter litres − till litres. Fuel that left the PUMP without
 *              being rung. An attendant question.
 *   tank       book stock − closing dip. Fuel that left the GROUND without
 *              crossing a meter. A leak, or a delivery that never arrived in
 *              full.
 *
 * They are never added together here, for the same reason the shift does not
 * add them: one number covering both destroys the distinction the owner is
 * actually trying to make, and it is the distinction that says whether to talk
 * to a person or to call an engineer.
 */
class FuelReportService
{
    /**
     * @return array{
     *     totals: array<string, float|int>,
     *     by_product: array<int, array<string, string|float>>,
     *     by_attendant: array<int, array<string, string|float|null>>,
     *     shifts: array<int, array<string, mixed>>
     * }
     */
    public function summary(string $from, string $to, ?string $branchId = null): array
    {
        $shifts = ForecourtShift::query()
            ->where('status', ForecourtShift::STATUS_CLOSED)
            ->when($branchId !== null, fn ($q) => $q->where('branch_id', $branchId))
            ->tap(fn ($q) => ShopDay::between($q, 'opened_at', $from, $to))
            ->with(['branch:id,name', 'closedBy:id,name'])
            ->orderByDesc('opened_at')
            ->get();

        // OPEN shifts are deliberately absent, and the count says so rather
        // than the report quietly being short. A shift that has not been closed
        // has no closing meter and no dip — every column below would be zero
        // for it, and a zero reads as "nothing happened" rather than "not
        // counted yet".
        $stillOpen = ForecourtShift::query()
            ->where('status', ForecourtShift::STATUS_OPEN)
            ->when($branchId !== null, fn ($q) => $q->where('branch_id', $branchId))
            ->tap(fn ($q) => ShopDay::between($q, 'opened_at', $from, $to))
            ->count();

        $readings = ForecourtReading::query()
            ->whereIn('forecourt_shift_id', $shifts->pluck('id'))
            ->with('attendant:id,name')
            ->get();

        return [
            'totals' => [
                'shifts' => $shifts->count(),
                'shifts_open' => $stillOpen,
                // How many of these valuations are approximations. A rate that
                // moved mid-shift means the litres are exact and the money is
                // not, and a reader comparing months needs to know which ones.
                'shifts_repriced' => $shifts->where('price_changed_during', true)->count(),
                'litres_sold' => $this->sum($shifts, 'litres_sold', 3),
                'test_litres' => $this->sum($shifts, 'test_litres', 3),
                'fuel_value' => $this->sum($shifts, 'fuel_value', 2),
                'pos_fuel_litres' => $this->sum($shifts, 'pos_fuel_litres', 3),
                'pos_fuel_value' => $this->sum($shifts, 'pos_fuel_value', 2),
                // Rung while no shift was open, counted by the next close.
                // Paid sales, and part of what the till rang — a figure of its
                // own so "rung at the till" is the whole of it.
                'between_litres' => $this->sum($shifts, 'between_litres', 3),
                'between_value' => $this->sum($shifts, 'between_value', 2),
                'unbilled_litres' => $this->sum($shifts, 'unbilled_litres', 3),
                'unbilled_value' => $this->sum($shifts, 'unbilled_value', 2),
                'tank_variance_litres' => $this->sum($shifts, 'tank_variance_litres', 3),
                'tank_variance_value' => $this->sum($shifts, 'tank_variance_value', 2),
                // Of the fuel missing from the ground, what the till RANG and no
                // meter counted: sold, not lost — a meter not read, or reading
                // short. See soldUnmetered().
                'sold_unmetered_litres' => round((float) $shifts->sum(fn (ForecourtShift $s): float => $s->soldUnmetered()[0]), 3),
                'sold_unmetered_value' => round((float) $shifts->sum(fn (ForecourtShift $s): float => $s->soldUnmetered()[1]), 2),
            ] + $this->waiting($from, $to, $branchId),

            // Which fuel. Read off the READINGS' own snapshot of the product
            // name, so a product renamed or retired since still appears under
            // what it was called on the night.
            'by_product' => $readings
                ->groupBy('product_name')
                ->map(fn ($rows, $name): array => [
                    'product' => (string) $name,
                    'litres' => round((float) $rows->sum('litres_sold'), 3),
                    'value' => round($rows->sum(
                        fn (ForecourtReading $r): float => (float) $r->litres_sold * (float) $r->unit_price,
                    ), 2),
                ])
                ->sortByDesc('litres')
                ->values()
                ->all(),

            // Who was on the nozzle. LITRES ONLY — the unbilled figure is a
            // station figure and cannot be split between them, because a till
            // sale does not record which nozzle it came out of. Splitting it
            // would invent an accusation nobody could defend. Same rule as
            // ForecourtShift::attendantTotals().
            'by_attendant' => $readings
                ->groupBy(fn (ForecourtReading $r): string => $r->attendant_id ?? '')
                ->map(fn ($rows): array => [
                    'attendant_id' => $rows->first()->attendant_id,
                    'attendant' => $rows->first()->attendant?->name,
                    'litres' => round((float) $rows->sum('litres_sold'), 3),
                ])
                ->sortByDesc('litres')
                ->values()
                ->all(),

            // The nights themselves, so a reader who sees a bad month can find
            // which shift it was without leaving the report.
            'shifts' => $shifts->map(fn (ForecourtShift $s): array => [
                'id' => $s->id,
                'number' => $s->number,
                'branch' => $s->branch?->name,
                'closed_by' => $s->closedBy?->name,
                'opened_at' => $s->opened_at?->toIso8601String(),
                'closed_at' => $s->closed_at?->toIso8601String(),
                'litres_sold' => (float) $s->litres_sold,
                'fuel_value' => (float) $s->fuel_value,
                'unbilled_litres' => (float) $s->unbilled_litres,
                'unbilled_value' => (float) $s->unbilled_value,
                'tank_variance_litres' => (float) $s->tank_variance_litres,
                'tank_variance_value' => (float) $s->tank_variance_value,
                'between_litres' => (float) $s->between_litres,
                'sold_unmetered_litres' => $s->soldUnmetered()[0],
                'price_changed_during' => (bool) $s->price_changed_during,
            ])->all(),

            'range' => [
                'from' => Carbon::parse($from)->toDateString(),
                'to' => Carbon::parse($to)->toDateString(),
            ],
        ];
    }

    /**
     * Fuel rung since the last close at each forecourt while no shift was
     * open — counted by nobody YET. The next close takes it; until then the
     * report says it is waiting, for the reason `shifts_open` exists: a figure
     * that is "not counted yet" must not read as "nothing happened".
     *
     * @return array{waiting_litres: float, waiting_value: float}
     */
    private function waiting(string $from, string $to, ?string $branchId): array
    {
        $litres = 0.0;
        $value = 0.0;

        $tanks = FuelTank::query()
            ->where('is_active', true)
            ->whereNotNull('product_id')
            ->when($branchId !== null, fn ($q) => $q->where('branch_id', $branchId))
            ->get(['branch_id', 'product_id', 'created_at']);

        foreach ($tanks->groupBy(fn (FuelTank $t): string => (string) $t->branch_id) as $branch => $here) {
            $branch = $branch === '' ? null : $branch;
            $atBranch = fn ($q) => $branch === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branch);

            $since = ForecourtShift::query()->where('status', ForecourtShift::STATUS_CLOSED)
                ->where($atBranch)->max('closed_at') ?? $here->min('created_at');
            $openedAt = ForecourtShift::query()->where('status', ForecourtShift::STATUS_OPEN)
                ->where($atBranch)->value('opened_at');

            $row = SaleItem::query()
                ->join('sales', 'sales.id', '=', 'sale_items.sale_id')
                ->whereIn('sale_items.product_id', $here->pluck('product_id')->unique()->values())
                ->where('sales.status', '!=', 'cancelled')
                ->when($branch !== null, fn ($q) => $q->where('sales.branch_id', $branch))
                ->where('sales.sold_at', '>', Carbon::parse($since))
                ->when($openedAt !== null, fn ($q) => $q->where('sales.sold_at', '<', $openedAt))
                ->tap(fn ($q) => ShopDay::between($q, 'sales.sold_at', $from, $to))
                ->selectRaw('COALESCE(SUM(sale_items.quantity * COALESCE(sale_items.unit_factor, 1)), 0) as litres')
                ->selectRaw('COALESCE(SUM(sale_items.line_total), 0) as value')
                ->first();

            $litres += (float) ($row->litres ?? 0);
            $value += (float) ($row->value ?? 0);
        }

        return ['waiting_litres' => round($litres, 3), 'waiting_value' => round($value, 2)];
    }

    /** @param  Collection<int, ForecourtShift>  $shifts */
    private function sum($shifts, string $column, int $places): float
    {
        return round((float) $shifts->sum(fn (ForecourtShift $s): float => (float) $s->{$column}), $places);
    }
}
