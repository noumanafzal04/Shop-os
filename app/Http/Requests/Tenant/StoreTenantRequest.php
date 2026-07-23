<?php

namespace App\Http\Requests\Tenant;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

class StoreTenantRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(\App\Support\Permissions::TENANTS_CREATE);
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
            'business_type' => ['required', 'string', Rule::in(\App\Support\BusinessTypes::codes())],
            'business_category' => ['nullable', 'string', 'max:100'],
            'city_id' => ['nullable', 'uuid', Rule::exists('cities', 'id')->where('is_active', true)],
            'plan_id' => ['nullable', 'uuid', Rule::exists('plans', 'id')->where('is_active', true)],

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

    public function messages(): array
    {
        return [
            'business_name.unique' => 'A business with this name already exists.',
            'email.unique' => 'A business with this email already exists.',
            'phone.unique' => 'A business with this phone number already exists.',
            'owner.email.unique' => 'A user with this email already exists.',
            'owner.phone.unique' => 'A user with this phone number already exists.',
        ];
    }
}
