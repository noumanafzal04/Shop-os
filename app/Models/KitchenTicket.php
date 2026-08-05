<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A Kitchen Order Ticket (KOT): the items one "send" put in front of ONE
 * station — a send that spans the grill and the bar writes a KOT each.
 * Kitchen-facing (no prices). Append-only header — its items are the
 * RestaurantTicketItems stamped with this KOT's id.
 */
class KitchenTicket extends Model
{
    use BelongsToTenant, HasUuids;

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return [
            'kot_number' => 'integer',
            'fired_at' => 'datetime',
            'preparing_at' => 'datetime',
            'ready_at' => 'datetime',
            'served_at' => 'datetime',
        ];
    }

    public function ticket(): BelongsTo
    {
        return $this->belongsTo(RestaurantTicket::class, 'ticket_id');
    }

    public function items(): HasMany
    {
        return $this->hasMany(RestaurantTicketItem::class, 'kitchen_ticket_id');
    }
}
