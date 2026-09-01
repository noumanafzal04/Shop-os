<?php

namespace App\Http\Requests\Promotion;

use App\Http\Requests\Concerns\ValidatesAgainstTheStoredRecord;
use App\Models\Promotion;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdatePromotionRequest extends FormRequest
{
    use ValidatesAgainstTheStoredRecord;

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
        // The type this promotion will HAVE, not a default. Read off the input
        // when the edit changes it, off the row when it does not — because a
        // shop raising a Rs 50 fixed discount to Rs 5,000 without resending
        // `type` was told "value must not be greater than 100", which is a
        // percentage rule applied to a rupee amount and names a field the shop
        // was not touching.
        $type = $this->effective('type', Promotion::class, 'promotion', 'percent');
        $isPercent = $type === 'percent';
        $isBogo = $type === 'bogo';

        return [
            'name' => ['sometimes', 'required', 'string', 'max:120'],
            'type' => ['sometimes', 'in:percent,fixed,bogo'],
            'value' => $isBogo
                ? ['nullable', 'numeric']
                : ['sometimes', 'numeric', 'min:0.01', $isPercent ? 'max:100' : 'max:99999999'],
            'scope' => ['sometimes', $isBogo ? 'in:category,product' : 'in:order,category,product'],
            'buy_qty' => [$isBogo ? 'required' : 'nullable', 'numeric', 'min:1', 'max:999'],
            'get_qty' => [$isBogo ? 'required' : 'nullable', 'numeric', 'min:1', 'max:999'],
            'get_discount_pct' => ['nullable', 'numeric', 'min:0.01', 'max:100'],
            'category_id' => [
                'nullable', 'uuid',
                Rule::exists('categories', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
            'product_ids' => ['nullable', 'array', 'max:200'],
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
            'start_time' => ['nullable', 'required_with:end_time', 'date_format:H:i,H:i:s'],
            'end_time' => ['nullable', 'required_with:start_time', 'date_format:H:i,H:i:s'],
            'priority' => ['sometimes', 'integer', 'min:0', 'max:1000'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
