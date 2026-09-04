<?php

namespace App\Http\Requests\Restaurant;

use App\Rules\OwnOpenShift;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;

class SettleTicketRequest extends FormRequest
{
    public function authorize(): bool
    {
        if (! $this->user()->hasPermission(Permissions::SALES_MANAGE)) {
            return false;
        }

        // A whole-bill discount at settlement is a controlled action.
        if ((float) $this->input('discount', 0) > 0) {
            return $this->user()->hasPermission(Permissions::DISCOUNTS_APPLY);
        }

        return true;
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;

        return [
            // Settle a subset of the tab's items → split-by-item. Omit for the
            // whole (remaining) bill.
            'item_ids' => ['nullable', 'array', 'max:200'],
            'item_ids.*' => ['uuid'],
            // Split-by-QUANTITY: settle only part of a line (e.g. 2 of 3 units
            // to this payer). Each entry pays `quantity` off the line; a
            // quantity below the line's leaves the rest open. Takes precedence
            // over item_ids when present.
            'splits' => ['nullable', 'array', 'max:200'],
            'splits.*.id' => ['required_with:splits', 'uuid'],
            'splits.*.quantity' => ['required_with:splits', 'numeric', 'gt:0'],
            // Single tender OR a split of tenders (same shape as a counter sale).
            'payment_method' => ['required_without:payments', 'in:cash,card,bank_transfer,other,credit'],
            'amount_paid' => ['required_without:payments', 'numeric', 'min:0'],
            'payments' => ['nullable', 'array', 'max:10'],
            'payments.*.method' => ['required_with:payments', 'in:cash,card,bank_transfer,other,credit'],
            'payments.*.amount' => ['required_with:payments', 'numeric', 'min:0.01'],
            'payments.*.reference' => ['nullable', 'string', 'max:100'],

            // A tip rides on top of the bill: it raises what must be paid and
            // what the drawer should hold, and never touches revenue.
            'tip_amount' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:999999'],
            'discount' => ['nullable', 'numeric', 'min:0'],
            'coupon_code' => ['nullable', 'string', 'max:40'],
            'customer_name' => ['nullable', 'string', 'max:255'],
            'customer_phone' => ['nullable', 'string', 'max:32'],
            'notes' => ['nullable', 'string', 'max:1000'],
            'cash_session_id' => [
                'nullable', 'uuid',
                new OwnOpenShift($this->user()),
            ],
        ];
    }
}
