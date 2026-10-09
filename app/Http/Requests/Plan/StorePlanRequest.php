<?php

namespace App\Http\Requests\Plan;

use App\Support\Modules;
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
            'grace_period_days' => ['required', 'integer', 'min:0', 'max:90'],
            // Billed usage ceilings — NULL/omitted = unlimited. Modules,
            // branches and staff are NOT here: they belong to the tenant and
            // are assigned when the admin creates it.
            'max_products' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'max_storage_mb' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'max_orders_month' => ['sometimes', 'nullable', 'integer', 'min:1'],
            // Months, so eighteen is sayable. Null = no limit, which is what
            // every plan had before the column existed and what it keeps.
            // Organisation size the plan includes. Null = the plan says
            // nothing and the platform default applies — see PlanResource.
            'max_branches' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:1000'],
            'max_staff' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:10000'],
            'max_registers' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:1000'],
            'retention_months' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:1200'],
            'is_active' => ['sometimes', 'boolean'],
            'is_custom' => ['sometimes', 'boolean'],
            // Which modules the plan includes. Null puts it back on what its
            // rung of the ladder includes; an empty list is a plan that
            // includes nothing beyond a trade's essentials.
            'modules' => ['sometimes', 'nullable', 'array'],
            'modules.*' => ['string', Rule::in(Modules::keys())],
        ];
    }
}
