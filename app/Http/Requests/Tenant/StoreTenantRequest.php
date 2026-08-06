<?php

namespace App\Http\Requests\Tenant;

use App\Support\BusinessTypes;
use App\Support\Modules;
use App\Support\Permissions;
use App\Support\PlanLimits;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

class StoreTenantRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::TENANTS_CREATE);
    }

    public function rules(): array
    {
        return [
            // Duplicates checked against live tenants only; a soft-deleted
            // business's name may be reused.
            'business_name' => [
                'required', 'string', 'max:255',
                Rule::unique('tenants', 'business_name')->whereNull('deleted_at'),
            ],
            'email' => [
                'nullable', 'email', 'max:255',
                Rule::unique('tenants', 'email')->whereNull('deleted_at'),
            ],
            'phone' => [
                'nullable', 'string', 'max:32',
                Rule::unique('tenants', 'phone')->whereNull('deleted_at'),
            ],
            // The admin picks the tenant's business type — it drives features,
            // default categories and terminology. The owner can never change it.
            'business_type' => ['required', 'string', Rule::in(BusinessTypes::codes())],
            'business_category' => ['nullable', 'string', 'max:100'],
            'city_id' => ['nullable', 'uuid', Rule::exists('cities', 'id')->where('is_active', true)],
            // Required. A tenant with no plan has no product ceiling and no
            // billing period — a state nobody chose, and the reason a shop
            // created "for now" could never be corrected afterwards.
            'plan_id' => ['required', 'uuid', Rule::exists('plans', 'id')->where('is_active', true)],

            // The modules this shop is given. The business type proposes a set
            // on the create screen; what arrives here is what the admin left
            // ticked. Omitted entirely = keep the type's proposal.
            'modules' => ['sometimes', 'array'],
            'modules.*' => ['boolean'],

            // The size of the organisation: branches, staff, checkout lanes.
            // Omitted = the platform default for that resource.
            'limits' => ['sometimes', 'array'],
            'limits.*' => ['nullable', 'integer', 'min:1'],

            'owner' => ['required', 'array'],
            'owner.name' => ['required', 'string', 'max:255'],
            'owner.email' => [
                'nullable', 'required_without:owner.phone', 'email', 'max:255',
                Rule::unique('users', 'email')->whereNull('deleted_at'),
            ],
            'owner.phone' => [
                'nullable', 'required_without:owner.email', 'string', 'max:32',
                Rule::unique('users', 'phone')->whereNull('deleted_at'),
            ],
            'owner.password' => ['required', Password::min(8)],
        ];
    }

    public function withValidator($validator): void
    {
        $validator->after(function ($v): void {
            foreach (array_keys($this->input('modules', [])) as $key) {
                if (! in_array($key, Modules::keys(), true)) {
                    $v->errors()->add('modules', "Unknown module: {$key}.");
                }
            }

            foreach (array_keys($this->input('limits', [])) as $key) {
                if (! array_key_exists($key, PlanLimits::REGISTRY)) {
                    $v->errors()->add('limits', "Unknown limit: {$key}.");
                }
            }
        });
    }

    public function messages(): array
    {
        return [
            'plan_id.required' => 'Choose a plan — it sets what this business pays and how much it can hold.',
            'business_name.unique' => 'A business with this name already exists.',
            'email.unique' => 'A business with this email already exists.',
            'phone.unique' => 'A business with this phone number already exists.',
            'owner.email.unique' => 'A user with this email already exists.',
            'owner.phone.unique' => 'A user with this phone number already exists.',
        ];
    }
}
