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
            'station' => ['nullable', 'string', 'max:60'],
            'notes' => ['nullable', 'string', 'max:500'],
        ];
    }
}
