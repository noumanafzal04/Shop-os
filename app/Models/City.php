<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class City extends Model
{
    use HasUuids;

    protected $fillable = ['geo_id', 'province_id', 'country_id', 'name', 'latitude', 'longitude', 'is_active'];

    /**
     * The cities the platform launched with. Demo shops are spread across
     * these, not across every town the dataset knows — a demo shop in a
     * village nobody has heard of shows the marketplace nothing.
     */
    public const MAJOR = ['Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar', 'Quetta'];

    protected function casts(): array
    {
        return [
            'geo_id' => 'integer',
            'province_id' => 'integer',
            'country_id' => 'integer',
            'latitude' => 'float',
            'longitude' => 'float',
            'is_active' => 'boolean',
        ];
    }

    public function tenants(): HasMany
    {
        return $this->hasMany(Tenant::class);
    }
}
