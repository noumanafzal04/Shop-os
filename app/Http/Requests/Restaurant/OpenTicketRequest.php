<?php

namespace App\Http\Requests\Restaurant;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class OpenTicketRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::SALES_MANAGE);
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;

        return [
            'order_type' => ['nullable', 'in:dine_in,takeaway'],
            'dining_table_id' => [
                'nullable', 'uuid',
                Rule::exists('dining_tables', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
            'guest_count' => ['nullable', 'integer', 'min:1', 'max:100'],
            'customer_name' => ['nullable', 'string', 'max:255'],
            'customer_phone' => ['nullable', 'string', 'max:32'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
