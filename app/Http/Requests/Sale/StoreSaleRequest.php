<?php

namespace App\Http\Requests\Sale;

use App\Enums\PaymentMethod;
use App\Enums\SaleChannel;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreSaleRequest extends FormRequest
{
    public function authorize(): bool
    {
        if (! $this->user()->hasPermission(Permissions::SALES_MANAGE)) {
            return false;
        }

        // A per-line discount is a controlled action — a cashier needs the
        // discounts.apply permission to hand one out (owners pass this too).
        $hasLineDiscount = collect($this->input('items', []))->contains(
            fn ($i) => (float) ($i['line_discount'] ?? 0) > 0 || (float) ($i['line_discount_pct'] ?? 0) > 0,
        );

        return ! $hasLineDiscount || $this->user()->hasPermission(Permissions::DISCOUNTS_APPLY);
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;

        return [
            'channel' => ['required', Rule::enum(SaleChannel::class)],
            'customer_name' => ['nullable', 'string', 'max:255'],
            'customer_phone' => ['nullable', 'string', 'max:32'],
            'order_type' => ['nullable', 'in:dine_in,takeaway'],
            'table_no' => ['nullable', 'string', 'max:16'],
            'items' => ['required', 'array', 'min:1', 'max:200'],
            'items.*.product_id' => [
                'required', 'uuid',
                Rule::exists('products', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
            'items.*.variant_id' => ['nullable', 'uuid'],
            // Pack-breaking: sell this line in a defined pack (strip/box). The
            // pack must belong to the line's product (checked in the action).
            'items.*.product_unit_id' => ['nullable', 'uuid'],
            // Price level (price list): the cashier picks retail/wholesale; the
            // server prices from the product's own stored figure for that level.
            'items.*.price_level' => ['nullable', 'in:retail,wholesale'],
            'items.*.quantity' => ['required', 'numeric', 'min:0.001', 'max:100000'],
            // NOTE: no items.*.unit_price — pricing is server-authoritative.
            // Anything a client sends is dropped by validated().
            // Per-line discount: a fixed amount OR a percentage. The server
            // computes/validates it against its own line price (a client can
            // never dictate the final line price, only the discount off it).
            'items.*.line_discount' => ['nullable', 'numeric', 'min:0'],
            'items.*.line_discount_pct' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'items.*.modifier_option_ids' => ['sometimes', 'array', 'max:50'],
            'items.*.modifier_option_ids.*' => ['uuid'],
            'discount' => ['nullable', 'numeric', 'min:0'],
            'coupon_code' => ['nullable', 'string', 'max:40'],
            // NOTE: no `tax` — tax is server-authoritative, computed from each
            // product's tax rate (see CreateSaleAction). Anything a client sends
            // is dropped by validated().
            // Single tender: payment_method + amount_paid (required unless the
            // sale is split — 'split' is server-only, never a client tender).
            // 'credit' = sell-on-credit (khata) — the amount goes onto the
            // customer's balance (needs a linked customer; enforced in the action).
            'payment_method' => ['required_without:payments', 'in:cash,card,bank_transfer,other,credit'],
            'amount_paid' => ['required_without:payments', 'numeric', 'min:0'],
            // Multi-tender / split payment: part cash + part card (+ part credit)
            // etc. When present it overrides the single tender above; amount_paid
            // becomes the sum of tenders.
            'payments' => ['nullable', 'array', 'max:10'],
            'payments.*.method' => ['required_with:payments', 'in:cash,card,bank_transfer,other,credit'],
            'payments.*.amount' => ['required_with:payments', 'numeric', 'min:0.01'],
            'payments.*.reference' => ['nullable', 'string', 'max:100'],
            'notes' => ['nullable', 'string', 'max:1000'],
            // Pharmacy: prescription record for a sale of Rx-required medicine.
            // Optional at the API (never hard-blocks a sale); the POS prompts
            // for it whenever the basket holds an Rx item.
            'prescription_number' => ['nullable', 'string', 'max:100'],
            'prescriber_name' => ['nullable', 'string', 'max:255'],
            'patient_name' => ['nullable', 'string', 'max:255'],
            'prescription_notes' => ['nullable', 'string', 'max:1000'],
            'idempotency_key' => ['nullable', 'string', 'max:64'],
            'cash_session_id' => [
                'nullable', 'uuid',
                Rule::exists('cash_sessions', 'id')->where('tenant_id', $tenantId)->where('status', 'open'),
            ],
        ];
    }
}
