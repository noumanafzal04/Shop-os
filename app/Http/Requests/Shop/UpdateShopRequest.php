<?php

namespace App\Http\Requests\Shop;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Ongoing shop-profile edits (Settings page) — distinct from onboarding:
 * it never re-applies business-type templates and every field is optional.
 */
class UpdateShopRequest extends FormRequest
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
            // business_type is deliberately NOT editable here — only the
            // platform admin sets a tenant's type (it drives features and
            // defaults). Owners edit basic profile info only.
            'business_category' => ['sometimes', 'nullable', 'string', 'max:100'],
            'city_id' => ['sometimes', 'nullable', 'uuid', Rule::exists('cities', 'id')->where('is_active', true)],
            'phone' => ['sometimes', 'nullable', 'string', 'max:32'],
            'address' => ['sometimes', 'nullable', 'string', 'max:500'],
            'latitude' => ['sometimes', 'nullable', 'required_with:longitude', 'numeric', 'between:-90,90'],
            'longitude' => ['sometimes', 'nullable', 'required_with:latitude', 'numeric', 'between:-180,180'],
            'delivery_fee' => ['sometimes', 'numeric', 'min:0', 'max:99999'],
            'business_hours' => ['sometimes', 'nullable', 'array'],
            'business_hours.*.day' => ['required_with:business_hours', 'integer', 'between:0,6'],
            'business_hours.*.open' => ['nullable', 'date_format:H:i'],
            'business_hours.*.close' => ['nullable', 'date_format:H:i', 'after:business_hours.*.open'],
            // The zone business_hours + food serving windows are read in.
            'timezone' => ['sometimes', 'string', 'timezone:all'],
        ];
    }
}
