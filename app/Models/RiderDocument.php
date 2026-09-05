<?php

namespace App\Models;

use App\Enums\RiderDocumentType;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One identity document. The file itself lives on the PRIVATE disk — see the
 * migration — and is read back only through `RiderDocumentController::show`,
 * which checks the reader before it streams anything.
 */
class RiderDocument extends Model
{
    use HasUuids;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'type' => RiderDocumentType::class,
            'size_bytes' => 'integer',
        ];
    }

    public function riderProfile(): BelongsTo
    {
        return $this->belongsTo(RiderProfile::class);
    }
}
