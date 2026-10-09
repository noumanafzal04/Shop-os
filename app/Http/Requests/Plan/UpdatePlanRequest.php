<?php

namespace App\Http\Requests\Plan;

use App\Support\Modules;
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
            'grace_period_days' => ['sometimes', 'integer', 'min:0', 'max:90'],
            // Billed usage ceilings — NULL = unlimited. Modules, branches and
            // staff belong to the tenant, not to a plan.
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
