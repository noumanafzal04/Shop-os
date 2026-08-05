<?php

namespace App\Models;

use App\Models\Concerns\Auditable;
use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** A dispenser on the forecourt. Carries one or more nozzles. */
class FuelPump extends BaseModel
{
    use Auditable, BelongsToTenant;

    protected function casts(): array
    {
        return ['is_active' => 'boolean'];
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function nozzles(): HasMany
    {
        return $this->hasMany(FuelNozzle::class);
    }
}
