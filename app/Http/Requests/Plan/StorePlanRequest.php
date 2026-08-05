<?php

namespace App\Http\Requests\Plan;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StorePlanRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->isSuperAdmin();
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:100'],
            'code' => ['required', 'string', 'max:60', 'alpha_dash', Rule::unique('plans', 'code')],
            'description' => ['nullable', 'string', 'max:500'],
            'price' => ['required', 'numeric', 'min:0', 'max:99999999'],
            'billing_period_months' => ['required', 'integer', 'min:1', 'max:36'],
            'online_shop_enabled' => ['required', 'boolean'],
            'grace_period_days' => ['required', 'integer', 'min:0', 'max:90'],
            // Modules the plan grants (checkbox base): POS bundles Expense &
            // Income; a catalog (products) exists when POS or Online is on —
            // the controller derives `products`/`expenses` so they stay consistent.
            'features' => ['sometimes', 'array'],
            'features.pos' => ['sometimes', 'boolean'],
            'features.expenses' => ['sometimes', 'boolean'],
            'features.marketplace' => ['sometimes', 'boolean'],
            'features.products' => ['sometimes', 'boolean'],
            // Plan limits — NULL/omitted = unlimited for that resource.
            'max_products' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'max_branches' => ['sometimes', 'nullable', 'integer', 'min:1'],
            // 0 is meaningful here: a books-only plan has no till and no lanes.
            'max_registers' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'max_staff' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'max_storage_mb' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'max_orders_month' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
