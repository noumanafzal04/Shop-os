<?php

namespace App\Http\Requests\SaleDocument;

use App\Models\SaleDocument;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreSaleDocumentRequest extends FormRequest
{
    public function authorize(): bool
    {
        if (! $this->user()->hasPermission(Permissions::SALES_MANAGE)) {
            return false;
        }

        // A quote is exactly where an over-generous discount hides: nobody is
        // watching a piece of paper, and it becomes binding the moment it's
        // printed. Same authority as discounting a live sale.
        $hasLineDiscount = collect($this->input('items', []))->contains(
            fn ($i) => (float) ($i['line_discount'] ?? 0) > 0 || (float) ($i['line_discount_pct'] ?? 0) > 0,
        );
        $hasCartDiscount = (float) $this->input('discount', 0) > 0;

        return ! ($hasLineDiscount || $hasCartDiscount)
            || $this->user()->hasPermission(Permissions::DISCOUNTS_APPLY);
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;

        return [
            'kind' => ['required', Rule::in(SaleDocument::KINDS)],
            'customer_id' => ['nullable', 'uuid', Rule::exists('customers', 'id')->where('tenant_id', $tenantId)],
            'customer_name' => ['nullable', 'string', 'max:255'],
            'customer_phone' => ['nullable', 'string', 'max:32'],
            'items' => ['required', 'array', 'min:1', 'max:200'],
            'items.*.product_id' => [
                'required', 'uuid',
                Rule::exists('products', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
            'items.*.variant_id' => ['nullable', 'uuid'],
            'items.*.product_unit_id' => ['nullable', 'uuid'],
            'items.*.price_level' => ['nullable', 'in:retail,wholesale'],
            'items.*.quantity' => ['required', 'numeric', 'min:0.001', 'max:100000'],
            // NOTE: no items.*.unit_price and no items.*.line_total — a
            // document freezes the SERVER's price, and a client-supplied one
            // would be a price-override fraud vector that survives for weeks.
            'items.*.line_discount' => ['nullable', 'numeric', 'min:0'],
            'items.*.line_discount_pct' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'discount' => ['nullable', 'numeric', 'min:0'],
            // Null is meaningful: "no expiry", distinct from "use the shop's
            // default window", which is what omitting the key means.
            'expires_at' => ['sometimes', 'nullable', 'date', 'after_or_equal:today'],
            'terms' => ['nullable', 'string', 'max:1000'],
            'notes' => ['nullable', 'string', 'max:1000'],
            // Layaway only — the opening advance.
            'deposit' => ['nullable', 'array'],
            'deposit.amount' => ['required_with:deposit', 'numeric', 'min:0.01'],
            'deposit.method' => ['nullable', Rule::in(SaleDocument::DEPOSIT_METHODS)],
            'deposit.reference' => ['nullable', 'string', 'max:120'],
            'deposit.note' => ['nullable', 'string', 'max:255'],
            'idempotency_key' => ['nullable', 'string', 'max:100'],
        ];
    }
}
