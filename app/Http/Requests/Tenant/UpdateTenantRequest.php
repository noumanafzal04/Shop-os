<?php

namespace App\Http\Requests\Tenant;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateTenantRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(\App\Support\Permissions::TENANTS_UPDATE);
    }

    public function rules(): array
    {
        $tenantId = $this->route('tenant');

        return [
            'business_name' => [
                'sometimes', 'required', 'string', 'max:255',
                Rule::unique('tenants', 'business_name')->ignore($tenantId)->whereNull('deleted_at'),
            ],
            'email' => [
                'nullable', 'email', 'max:255',
                Rule::unique('tenants', 'email')->ignore($tenantId)->whereNull('deleted_at'),
            ],
            'phone' => [
                'nullable', 'string', 'max:32',
                Rule::unique('tenants', 'phone')->ignore($tenantId)->whereNull('deleted_at'),
            ],
            // The admin can change a tenant's business type after creation.
            'business_type' => ['sometimes', 'required', 'string', Rule::in(\App\Support\BusinessTypes::codes())],
            'business_category' => ['nullable', 'string', 'max:100'],
            'city_id' => ['nullable', 'uuid', Rule::exists('cities', 'id')->where('is_active', true)],
        ];
    }
}
