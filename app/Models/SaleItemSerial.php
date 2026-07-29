<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One serialized unit sold — an IMEI/serial captured at the counter, with its
 * warranty window snapshotted from the sale. Looked up later for a warranty
 * claim; while it sits on a live (completed / partially-refunded) sale the
 * same serial can't be sold again (see CreateSaleAction's SERIAL_ALREADY_SOLD).
 */
class SaleItemSerial extends Model
{
    use BelongsToTenant, HasUuids;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'warranty_months' => 'integer',
            'warranty_expires_at' => 'date',
            'sold_at' => 'datetime',
        ];
    }

    public function sale(): BelongsTo
    {
        return $this->belongsTo(Sale::class);
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class)->withTrashed();
    }

    /** Still inside its warranty window (no window set = never under warranty). */
    public function isUnderWarranty(): bool
    {
        return $this->warranty_expires_at !== null
            && ! $this->warranty_expires_at->endOfDay()->isPast();
    }
}
