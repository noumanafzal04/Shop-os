<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * A country, keyed by the countries-states-cities dataset's own id (Pakistan
 * is 167) so a country added later is the same import with its code.
 * Platform-wide reference data — no tenant.
 */
class Country extends Model
{
    public $incrementing = false;

    protected $keyType = 'int';

    protected $fillable = ['id', 'name', 'iso2', 'iso3', 'phone_code', 'currency', 'latitude', 'longitude', 'is_active'];

    protected function casts(): array
    {
        return [
            'latitude' => 'float',
            'longitude' => 'float',
            'is_active' => 'boolean',
        ];
    }
}
