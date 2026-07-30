<?php

namespace App\Http\Requests\Promotion;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StorePromotionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::COUPONS_MANAGE);
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;
        $isPercent = $this->input('type') === 'percent';

        return [
            'name' => ['required', 'string', 'max:120'],
            'type' => ['required', 'in:percent,fixed'],
            // A percent can't exceed 100; a fixed amount is a rupee figure.
            'value' => ['required', 'numeric', 'min:0.01', $isPercent ? 'max:100' : 'max:99999999'],
            'scope' => ['required', 'in:order,category,product'],
            'category_id' => [
                'required_if:scope,category', 'nullable', 'uuid',
                Rule::exists('categories', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
            'product_ids' => ['required_if:scope,product', 'nullable', 'array', 'min:1', 'max:200'],
            'product_ids.*' => [
                'uuid',
                Rule::exists('products', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
            'min_spend' => ['nullable', 'numeric', 'min:0'],
            'min_qty' => ['nullable', 'numeric', 'min:0'],
            'max_discount' => ['nullable', 'numeric', 'min:0'],
            'starts_on' => ['nullable', 'date'],
            'ends_on' => ['nullable', 'date', 'after_or_equal:starts_on'],
            'days_of_week' => ['nullable', 'array'],
            'days_of_week.*' => ['integer', 'between:0,6'],
            // Both ends of the happy-hour window or neither.
            'start_time' => ['nullable', 'required_with:end_time', 'date_format:H:i,H:i:s'],
            'end_time' => ['nullable', 'required_with:start_time', 'date_format:H:i,H:i:s'],
            'priority' => ['sometimes', 'integer', 'min:0', 'max:1000'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
