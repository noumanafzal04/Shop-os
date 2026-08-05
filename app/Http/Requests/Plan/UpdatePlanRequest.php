<?php

namespace App\Http\Requests\Plan;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdatePlanRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->isSuperAdmin();
    }

    public function rules(): array
    {
        $planId = $this->route('plan');

        return [
            'name' => ['sometimes', 'required', 'string', 'max:100'],
            // Code is immutable once tenants/payments reference it — but we
            // still allow editing it if unique; assignment uses the id anyway.
            'code' => ['sometimes', 'required', 'string', 'max:60', 'alpha_dash', Rule::unique('plans', 'code')->ignore($planId)],
            'description' => ['nullable', 'string', 'max:500'],
            'price' => ['sometimes', 'required', 'numeric', 'min:0', 'max:99999999'],
            'billing_period_months' => ['sometimes', 'required', 'integer', 'min:1', 'max:36'],
            'online_shop_enabled' => ['sometimes', 'boolean'],
            'grace_period_days' => ['sometimes', 'integer', 'min:0', 'max:90'],
            // Modules the plan grants (POS bundles Expense & Income; a catalog
            // exists when POS or Online is on) — see PlanController for derivation.
            'features' => ['sometimes', 'array'],
            'features.pos' => ['sometimes', 'boolean'],
            'features.expenses' => ['sometimes', 'boolean'],
            'features.marketplace' => ['sometimes', 'boolean'],
            'features.products' => ['sometimes', 'boolean'],
            // Plan limits — NULL = unlimited for that resource.
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
