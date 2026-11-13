<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Where the platform serves: a circle or a polygon the admin drew on a map.
 * A platform object — no shop owns it, like a banner.
 *
 * @property string $kind circle|polygon
 * @property list<array{0: float, 1: float}>|null $points
 */
class ServiceZone extends BaseModel
{
    use Auditable;

    public const CIRCLE = 'circle';

    public const POLYGON = 'polygon';

    protected function auditTenantId(): ?string
    {
        return null;
    }

    protected function casts(): array
    {
        return [
            'center_lat' => 'float',
            'center_lng' => 'float',
            'radius_m' => 'integer',
            'points' => 'array',
            'is_active' => 'boolean',
        ];
    }

    public function city(): BelongsTo
    {
        return $this->belongsTo(City::class);
    }

    public function scopeActive(Builder $query): Builder
    {
        return $query->where('is_active', true);
    }
}
