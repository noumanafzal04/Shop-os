<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ExpenseCategory extends BaseModel
{
    use BelongsToTenant;

    protected function casts(): array
    {
        return [
            'is_default' => 'boolean',
            'is_active' => 'boolean',
        ];
    }

    /** What is filed here — the reason a used category is retired, not deleted. */
    public function expenses(): HasMany
    {
        return $this->hasMany(Expense::class);
    }
}
