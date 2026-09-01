<?php

namespace App\Http\Requests\Coupon;

use App\Http\Requests\Concerns\ValidatesAgainstTheStoredRecord;
use App\Models\Coupon;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Editing a coupon, one field at a time.
 *
 * `CouponController::update` used the STORE request, so every field it marks
 * required had to be sent back to change any one of them — a coupon's expiry
 * could not be extended without also resending its code, its type and its
 * value. Promotions, riders, branches, categories and collections all have
 * their own update request; coupons were the one resource that did not, and
 * the difference was invisible because the screen happens to send the whole
 * form every time.
 *
 * That is a screen's habit, not a contract. Anything that sends less — a
 * bulk expiry extension, an integration, the next screen somebody writes —
 * met a 422 naming three fields it had no opinion about.
 */
class UpdateCouponRequest extends FormRequest
{
    use ValidatesAgainstTheStoredRecord;

    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::COUPONS_MANAGE);
    }

    protected function prepareForValidation(): void
    {
        if ($this->filled('code')) {
            $this->merge(['code' => strtoupper(trim($this->input('code')))]);
        }
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;
        $id = $this->route('coupon');

        // The ceiling on `value` belongs to the coupon's TYPE — and on a
        // partial edit the type is whatever the row already holds. Reading it
        // off the input with a default is what refused a fixed-rupee coupon
        // for exceeding a percentage.
        $isPercent = $this->effective('type', Coupon::class, 'coupon', 'percent') === 'percent';

        return [
            'code' => [
                'sometimes', 'required', 'string', 'max:40', 'regex:/^[A-Z0-9_-]+$/',
                Rule::unique('coupons', 'code')->where('tenant_id', $tenantId)->ignore($id)->whereNull('deleted_at'),
            ],
            'type' => ['sometimes', 'required', Rule::in(['percent', 'fixed'])],
            'value' => ['sometimes', 'required', 'numeric', 'min:0', $isPercent ? 'max:100' : 'max:99999999'],
            'min_spend' => ['nullable', 'numeric', 'min:0'],
            'max_discount' => ['nullable', 'numeric', 'min:0'],
            'usage_limit' => ['nullable', 'integer', 'min:1'],
            'starts_at' => ['nullable', 'date'],
            'expires_at' => ['nullable', 'date', 'after_or_equal:starts_at'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    public function messages(): array
    {
        return [
            'code.unique' => 'A coupon with this code already exists.',
            'code.regex' => 'Use letters, numbers, dashes or underscores only.',
        ];
    }
}
