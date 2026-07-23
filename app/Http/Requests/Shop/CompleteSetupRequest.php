<?php

namespace App\Http\Requests\Shop;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class CompleteSetupRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::SETTINGS_MANAGE);
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;

        return [
            'business_name' => [
                'sometimes', 'required', 'string', 'max:255',
                Rule::unique('tenants', 'business_name')->ignore($tenantId)->whereNull('deleted_at'),
            ],
            // The business type is set by the ADMIN at tenant creation — the
            // owner never picks it. At setup they add basic info only, so type
            // and category are not accepted here.
            'business_category' => ['sometimes', 'nullable', 'string', 'max:100'],
            // Edge case: inactive/unknown city rejected.
            'city_id' => ['required', 'uuid', Rule::exists('cities', 'id')->where('is_active', true)],
            'address' => ['nullable', 'string', 'max:500'],
            // Edge case: invalid location — coordinates must be a valid pair in range.
            'latitude' => ['nullable', 'required_with:longitude', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'required_with:latitude', 'numeric', 'between:-180,180'],
            'business_hours' => ['nullable', 'array'],
            'business_hours.*.day' => ['required_with:business_hours', 'integer', 'between:0,6'],
            'business_hours.*.open' => ['nullable', 'date_format:H:i'],
            'business_hours.*.close' => ['nullable', 'date_format:H:i', 'after:business_hours.*.open'],
        ];
    }
}
