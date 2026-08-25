<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A demo shop asking to become a business.
 *
 * Deliberately NOT tenant-scoped: it is read by the platform admin, who is not
 * inside any tenant, and written by exactly one person — the owner of the demo
 * it names.
 */
class ShopRequest extends Model
{
    use HasUuids;

    public const PENDING = 'pending';

    public const APPROVED = 'approved';

    public const DECLINED = 'declined';

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'requested_at' => 'datetime',
            'reviewed_at' => 'datetime',
        ];
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by');
    }

    /** Shops with somebody waiting on an answer — the prune must leave these alone. */
    public function scopePending($query)
    {
        return $query->where('status', self::PENDING);
    }
}
