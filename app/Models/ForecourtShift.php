<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * The forecourt between two sets of readings.
 *
 * Not the cashier's cash_session — that is one person at one drawer, and three
 * of them come and go inside a single forecourt shift on a busy pump. This is
 * the physical period the meters and the dips both bracket.
 */
class ForecourtShift extends BaseModel
{
    use Auditable, BelongsToTenant;

    public const STATUS_OPEN = 'open';

    public const STATUS_CLOSED = 'closed';

    protected function casts(): array
    {
        return [
            'opened_at' => 'datetime',
            'closed_at' => 'datetime',
            'litres_sold' => 'decimal:3',
            'test_litres' => 'decimal:3',
            'fuel_value' => 'decimal:2',
            'pos_fuel_value' => 'decimal:2',
            'pos_fuel_litres' => 'decimal:3',
            'unbilled_litres' => 'decimal:3',
            'unbilled_value' => 'decimal:2',
            'tank_variance_litres' => 'decimal:3',
            'tank_variance_value' => 'decimal:2',
            'price_changed_during' => 'boolean',
        ];
    }

    public function readings(): HasMany
    {
        return $this->hasMany(ForecourtReading::class);
    }

    public function dips(): HasMany
    {
        return $this->hasMany(ForecourtDip::class);
    }

    public function deliveries(): HasMany
    {
        return $this->hasMany(FuelDelivery::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function openedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'opened_by');
    }

    public function closedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'closed_by');
    }

    public function isOpen(): bool
    {
        return $this->status === self::STATUS_OPEN;
    }

    /**
     * What each attendant's nozzles pushed, and what that is worth.
     *
     * ── The number an attendant hands over ──────────────────────────────
     *
     * At a pump the control is the man on the nozzle: he works his assigned
     * hoses and hands over cash for their litres at the end of the shift. This
     * is that figure, straight off the meters — the thing an owner counts the
     * handover against.
     *
     * ── What it deliberately does NOT do ────────────────────────────────
     *
     * It does not split `unbilled_litres`. It CANNOT: a till sale of twenty
     * litres of petrol does not record which nozzle it came from, so the gap
     * between meters and till is a station figure and stays one. Dividing it by
     * attendant would be inventing an accusation.
     *
     * What it gives an owner is the other half of the same question — how much
     * each man is responsible for — and the shortfall stays where it honestly
     * belongs, on the shift.
     *
     * ── Computed, not stored ────────────────────────────────────────────
     *
     * Everything on a closed shift is written once so a signed-off figure reads
     * the same in September. This obeys that without a column: the readings it
     * sums are themselves written once, so the answer cannot drift either.
     *
     * Unassigned readings roll up under a null id rather than being dropped. A
     * shortfall nobody is named for is still a shortfall, and hiding it would
     * be worse than not asking who was on the nozzle.
     *
     * @return array<int, array{attendant_id: string|null, attendant: string|null, litres: float, value: float, nozzles: int}>
     */
    public function attendantTotals(): array
    {
        return $this->readings
            ->groupBy(fn (ForecourtReading $r): string => $r->attendant_id ?? '')
            ->map(fn ($rows): array => [
                'attendant_id' => $rows->first()->attendant_id,
                'attendant' => $rows->first()->attendant?->name,
                'litres' => round((float) $rows->sum('litres_sold'), 3),
                'value' => round((float) $rows->sum(
                    fn (ForecourtReading $r): float => (float) $r->litres_sold * (float) $r->unit_price,
                ), 2),
                'nozzles' => $rows->count(),
            ])
            // Most litres first: the biggest handover is the one to count
            // carefully, and on a busy night it is the only one anybody has
            // time to.
            ->sortByDesc('litres')
            ->values()
            ->all();
    }
}
