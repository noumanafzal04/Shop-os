<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A sale a till rang offline that the shop then refused — the money is in a
 * drawer with no sale against it until a person settles it (B49).
 */
class OfflineRefusal extends Model
{
    use BelongsToTenant, HasUuids;

    /** Rung again at the till as a real sale. */
    public const RUNG_AGAIN = 'rung_again';

    /** Settled some other way — the money handed back, a sale written by hand — with a note. */
    public const DEALT_WITH = 'dealt_with';

    /** Sent again later and accepted after all (the cause was put right). */
    public const RECORDED = 'recorded';

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'till_total' => 'decimal:2',
            'sold_at' => 'datetime',
            'refused_at' => 'datetime',
            'settled_at' => 'datetime',
        ];
    }

    /** @param  Builder<self>  $query */
    public function scopeOwed(Builder $query): Builder
    {
        return $query->whereNull('settled_as');
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(PosDevice::class, 'pos_device_id');
    }

    public function ringer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rung_by');
    }

    public function settler(): BelongsTo
    {
        return $this->belongsTo(User::class, 'settled_by');
    }

    public function sale(): BelongsTo
    {
        return $this->belongsTo(Sale::class);
    }
}
