<?php

namespace App\Http\Requests\Restaurant;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class MoveTicketRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::SALES_MANAGE);
    }

    public function rules(): array
    {
        return [
            // Nullable and meaningful: an explicit null takes the tab off the
            // floor, while omitting the key entirely leaves the seating alone.
            // MoveTicketAction depends on being able to tell those apart.
            'dining_table_id' => [
                'nullable', 'uuid',
                Rule::exists('dining_tables', 'id')
                    ->where('tenant_id', $this->user()->tenant_id)
                    ->whereNull('deleted_at'),
            ],
            'guest_count' => ['nullable', 'integer', 'min:1', 'max:100'],
        ];
    }
}
