<?php

namespace App\Models;

use App\Enums\SaleStatus;
use App\Models\Concerns\BelongsToTenant;
use App\Support\DrawerMath;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A stretch of time when someone other than the shift's cashier was ringing on
 * it — a break, a prayer, a run to the back.
 *
 * The reliever sells; the drawer stays the cashier's to count. An OPEN cover is
 * one with no `ended_at`, which is the state itself rather than a status beside
 * it.
 */
class CashSessionCover extends BaseModel
{
    use BelongsToTenant;

    protected function casts(): array
    {
        return [
            'started_at' => 'datetime',
            'ended_at' => 'datetime',
            'sales_count' => 'integer',
            'sales_total' => 'decimal:2',
            'cash_taken' => 'decimal:2',
        ];
    }

    public function session(): BelongsTo
    {
        return $this->belongsTo(CashSession::class, 'cash_session_id');
    }

    /** The reliever. */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function endedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'ended_by');
    }

    public function scopeOpen(Builder $query): Builder
    {
        return $query->whereNull('ended_at');
    }

    public function isOpen(): bool
    {
        return $this->ended_at === null;
    }

    /**
     * What this reliever rang while standing here.
     *
     * Scoped three ways at once — this drawer, this person, this window — so a
     * cashier who covers the same lane twice in a day gets two separate answers
     * rather than one merged one.
     *
     * Cash is counted the way DrawerMath counts it: what was tendered in cash,
     * less the change handed back out of the same box. Anything else would make
     * the covers add up to more than the drawer holds.
     *
     * @return array{sales_count: int, sales_total: float, cash_taken: float}
     */
    public function live(): array
    {
        $sold = Sale::withoutTenancy()
            ->where('cash_session_id', $this->cash_session_id)
            ->where('created_by', $this->user_id)
            ->where('sold_at', '>=', $this->started_at)
            ->when($this->ended_at !== null, fn ($q) => $q->where('sold_at', '<=', $this->ended_at));

        $counted = (clone $sold)->whereIn('status', [
            SaleStatus::Completed, SaleStatus::PartiallyRefunded, SaleStatus::Refunded,
        ]);

        // Cancelled sales count on the cash line and nowhere else: the tender
        // physically passed through the drawer, and its change came back out.
        $rung = (clone $sold)->whereIn('status', DrawerMath::RUNG_STATUSES);

        $cashTendered = (float) SalePayment::withoutTenancy()
            ->whereIn('sale_id', (clone $rung)->pluck('id'))
            ->where('method', 'cash')
            ->sum('amount');

        $change = (float) (clone $rung)->sum('change_due');

        return [
            'sales_count' => (int) (clone $counted)->count(),
            'sales_total' => round((float) (clone $counted)->sum('total'), 2),
            'cash_taken' => round($cashTendered - $change, 2),
        ];
    }

    /**
     * The figures as they should be reported: frozen once the cover has ended,
     * computed live while it is still running.
     *
     * @return array{sales_count: int, sales_total: float, cash_taken: float}
     */
    public function figures(): array
    {
        if ($this->isOpen()) {
            return $this->live();
        }

        return [
            'sales_count' => (int) $this->sales_count,
            'sales_total' => round((float) $this->sales_total, 2),
            'cash_taken' => round((float) $this->cash_taken, 2),
        ];
    }
}
