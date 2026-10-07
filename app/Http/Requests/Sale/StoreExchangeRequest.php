<?php

namespace App\Http\Requests\Sale;

use App\Enums\PaymentMethod;
use App\Enums\SaleChannel;
use App\Rules\OwnOpenShift;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Exchange: hand back items from an existing sale AND buy replacements in one
 * step. The returned items become a credit; the customer settles any positive
 * difference with `payments`. Replacement items are priced server-side, exactly
 * like a normal sale (no client unit_price / tax).
 */
class StoreExchangeRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::SALES_MANAGE);
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;

        return [
            // Items handed back from the original sale.
            'return_items' => ['required', 'array', 'min:1'],
            // One row per sale line (see StoreSaleReturnRequest) — duplicate
            // rows would refund twice but restock once.
            'return_items.*.sale_item_id' => ['required', 'uuid', 'distinct'],
            'return_items.*.quantity' => ['required', 'numeric', 'min:0.001'],
            // WHICH unit is handed back — see StoreSaleReturnRequest. An
            // exchange is the commonest reason a phone comes back at all, and
            // it was the one door that could not say which phone.
            'return_items.*.serials' => ['nullable', 'array'],
            'return_items.*.serials.*' => ['string', 'max:120', 'distinct'],

            // Replacement items being bought (server-priced like a sale).
            'items' => ['required', 'array', 'min:1', 'max:200'],
            'items.*.product_id' => [
                'required', 'uuid',
                Rule::exists('products', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
            'items.*.variant_id' => ['nullable', 'uuid'],
            'items.*.product_unit_id' => ['nullable', 'uuid'],
            'items.*.price_level' => ['nullable', 'in:retail,wholesale'],
            'items.*.quantity' => ['required', 'numeric', 'min:0.001', 'max:100000'],
            'items.*.modifier_option_ids' => ['sometimes', 'array', 'max:50'],
            'items.*.modifier_option_ids.*' => ['uuid'],
            // …and the number of the unit that goes out in its place, with the
            // cover it carries. Without these the replacement left the shop as
            // a phone with no number: nothing for the warranty desk to find.
            'items.*.serials' => ['sometimes', 'array', 'max:1000'],
            'items.*.serials.*' => ['string', 'max:120', 'distinct'],
            'items.*.warranty_months' => ['nullable', 'integer', 'min:0', 'max:600'],

            // The customer covers a positive difference with these tenders.
            'payments' => ['nullable', 'array', 'max:10'],
            'payments.*.method' => ['required_with:payments', Rule::in(PaymentMethod::counter())],
            'payments.*.amount' => ['required_with:payments', 'numeric', 'min:0.01'],
            'payments.*.reference' => ['nullable', 'string', 'max:100'],

            'channel' => ['nullable', Rule::enum(SaleChannel::class)],
            'reason' => ['nullable', 'string', 'max:255'],
            'cash_session_id' => [
                'nullable', 'uuid',
                new OwnOpenShift($this->user()),
            ],
        ];
    }
}
