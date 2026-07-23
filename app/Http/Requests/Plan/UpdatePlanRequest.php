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
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
