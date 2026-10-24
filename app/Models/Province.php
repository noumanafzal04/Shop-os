<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A province or state, keyed by the dataset's own id (Punjab is 3176).
 * Platform-wide reference data — no tenant.
 */
class Province extends Model
{
    public $incrementing = false;

    protected $keyType = 'int';

    protected $fillable = ['id', 'country_id', 'name', 'type', 'latitude', 'longitude', 'is_active'];

    protected function casts(): array
    {
        return [
            'latitude' => 'float',
            'longitude' => 'float',
            'is_active' => 'boolean',
        ];
    }
}
