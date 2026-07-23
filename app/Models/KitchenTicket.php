<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A Kitchen Order Ticket (KOT): the batch of items fired to the kitchen at one
 * "send" action. Kitchen-facing (no prices). Append-only header — its items are
 * the RestaurantTicketItems stamped with this KOT's id.
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
