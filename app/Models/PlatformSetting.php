<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * One changed platform setting. Read through `PlatformSettings`, never
 * directly — the defaults live there and a bare row is only half the answer.
 */
class PlatformSetting extends Model
{
    protected $primaryKey = 'key';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['value' => 'json'];
    }
}
