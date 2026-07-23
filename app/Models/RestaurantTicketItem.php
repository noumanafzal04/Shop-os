<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One line on a running tab. Carries BOTH the raw selection (replayed at
 * settlement for server-authoritative pricing) and a display snapshot. Plain
 * Model (no soft deletes / audit) — a void is a soft state, not a delete.
 */
class RestaurantTicketItem extends Model
{
    use BelongsToTenant, HasUuids;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'modifier_option_ids' => 'array',
            'modifiers' => 'array',
            'quantity' => 'decimal:3',
            'unit_factor' => 'decimal:3',
            'unit_price' => 'decimal:2',
            'unit_cost' => 'decimal:2',
            'line_discount' => 'decimal:2',
            'line_discount_pct' => 'decimal:2',
            'line_total' => 'decimal:2',
            'voided_at' => 'datetime',
        ];
    }

    public function ticket(): BelongsTo
    {
        return $this->belongsTo(RestaurantTicket::class, 'ticket_id');
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class)->withTrashed();
    }

    public function kitchenTicket(): BelongsTo
    {
        return $this->belongsTo(KitchenTicket::class, 'kitchen_ticket_id');
    }

    public function isVoid(): bool
    {
        return $this->voided_at !== null;
    }

    public function isSettled(): bool
    {
        return $this->sale_id !== null;
    }
}
