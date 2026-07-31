<?php

namespace App\Http\Requests\CustomerGroup;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;

class StoreCustomerGroupRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::CUSTOMERS_MANAGE);
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:80'],
            'price_level' => ['sometimes', 'in:retail,wholesale'],
            'discount_percent' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
