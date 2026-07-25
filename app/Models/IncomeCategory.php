<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;

class IncomeCategory extends BaseModel
{
    use BelongsToTenant;

    protected function casts(): array
    {
        return [
            'is_default' => 'boolean',
            'is_active' => 'boolean',
        ];
    }
}
