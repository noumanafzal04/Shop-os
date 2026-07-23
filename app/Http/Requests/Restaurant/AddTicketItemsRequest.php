<?php

namespace App\Http\Requests\Restaurant;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class AddTicketItemsRequest extends FormRequest
{
    public function authorize(): bool
    {
        if (! $this->user()->hasPermission(Permissions::SALES_MANAGE)) {
            return false;
        }

        // A per-line discount is a controlled action (same rule as the counter).
        $hasLineDiscount = collect($this->input('items', []))->contains(
            fn ($i) => (float) ($i['line_discount'] ?? 0) > 0 || (float) ($i['line_discount_pct'] ?? 0) > 0,
        );

        return ! $hasLineDiscount || $this->user()->hasPermission(Permissions::DISCOUNTS_APPLY);
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;

        return [
            'items' => ['required', 'array', 'min:1', 'max:200'],
            'items.*.product_id' => [
                'required', 'uuid',
                Rule::exists('products', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
            'items.*.variant_id' => ['nullable', 'uuid'],
            'items.*.product_unit_id' => ['nullable', 'uuid'],
            'items.*.price_level' => ['nullable', 'in:retail,wholesale'],
            'items.*.quantity' => ['required', 'numeric', 'min:0.001', 'max:100000'],
            'items.*.line_discount' => ['nullable', 'numeric', 'min:0'],
            'items.*.line_discount_pct' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'items.*.modifier_option_ids' => ['sometimes', 'array', 'max:50'],
            'items.*.modifier_option_ids.*' => ['uuid'],
            // Kitchen note per line ("no onions", "extra spicy").
            'items.*.note' => ['nullable', 'string', 'max:255'],
        ];
    }
}
