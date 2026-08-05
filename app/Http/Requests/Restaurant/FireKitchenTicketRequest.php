<?php

namespace App\Http\Requests\Restaurant;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;

class FireKitchenTicketRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::SALES_MANAGE);
    }

    public function rules(): array
    {
        return [
            // Fire a chosen subset; omit to fire everything still pending.
            'item_ids' => ['nullable', 'array', 'max:200'],
            'item_ids.*' => ['uuid'],
            // Force the whole fire at one station (a re-print at a named
            // printer); omit to route each item by its product's station.
            // Bounded like ShopSettings' station names so the two agree.
            'station' => ['nullable', 'string', 'max:40'],
            'notes' => ['nullable', 'string', 'max:500'],
        ];
    }
}
