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

    /** bogo has no percent/fixed value — store 0 so the non-null column is satisfied. */
    protected function prepareForValidation(): void
    {
        if ($this->input('type') === 'bogo') {
            $this->merge(['value' => 0]);
        }
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;
        $type = $this->input('type');
        $isPercent = $type === 'percent';
        $isBogo = $type === 'bogo';

        return [
            'name' => ['required', 'string', 'max:120'],
            'type' => ['required', 'in:percent,fixed,bogo'],
            // A percent can't exceed 100; a fixed amount is a rupee figure. bogo
            // ignores value (its discount is the free units) — stored as 0.
            'value' => $isBogo
                ? ['nullable', 'numeric']
                : ['required', 'numeric', 'min:0.01', $isPercent ? 'max:100' : 'max:99999999'],
            // bogo needs a specific item set — an order-wide buy-get is meaningless.
            'scope' => ['required', $isBogo ? 'in:category,product' : 'in:order,category,product'],
            // Buy-X-get-Y (bogo only).
            'buy_qty' => [$isBogo ? 'required' : 'nullable', 'numeric', 'min:1', 'max:999'],
            'get_qty' => [$isBogo ? 'required' : 'nullable', 'numeric', 'min:1', 'max:999'],
            'get_discount_pct' => ['nullable', 'numeric', 'min:0.01', 'max:100'],
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
