<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A stocktake: the shelves, counted, against what the system believed.
 *
 * The figure that matters is not the count — it is the VARIANCE, and what it is
 * worth. A grocery losing 2% of its stock a month has no way to discover that
 * except by counting.
 */
class StockCount extends BaseModel
{
    use Auditable, BelongsToTenant;

    public const STATUS_COUNTING = 'counting';

    public const STATUS_APPLIED = 'applied';

    public const STATUS_CANCELLED = 'cancelled';

    protected function casts(): array
    {
        return [
            'blind' => 'boolean',
            'lines_total' => 'integer',
            'lines_counted' => 'integer',
            'variance_units' => 'decimal:3',
            'variance_value' => 'decimal:2',
            'started_at' => 'datetime',
            'applied_at' => 'datetime',
        ];
    }

    public function items(): HasMany
    {
        return $this->hasMany(StockCountItem::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    public function startedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'started_by');
    }

    public function appliedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'applied_by');
    }

    /** Still being counted — the only state in which figures may be entered. */
    public function isOpen(): bool
    {
        return $this->status === self::STATUS_COUNTING;
    }
}
