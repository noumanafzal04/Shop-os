<?php

namespace App\Http\Requests\Sale;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use App\Rules\OwnOpenShift;

class StoreSaleReturnRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::SALES_MANAGE);
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;

        return [
            // Replay guard: a retried/double-clicked PARTIAL return would
            // otherwise refund cash twice AND restock twice (the over-return
            // check reads prior returns, so 3-of-10 passes again). Same key
            // returns the ORIGINAL return instead of creating a second one.
            'idempotency_key' => ['sometimes', 'string', 'max:64'],
            'items' => ['required', 'array', 'min:1'],
            // 'distinct': two rows for the same line would both pass the
            // over-return check (it reads prior returns, not this request) and
            // both refund, but the restock collapses to one idempotency key —
            // the shop refunds twice yet restocks once. One row per line.
            'items.*.sale_item_id' => ['required', 'uuid', 'distinct'],
            'items.*.quantity' => ['required', 'numeric', 'min:0.001'],
            // Serialized returns: which IMEIs/serials of this line come back
            // (frees them for resale). Optional; when given, one per returned
            // unit and each must belong to the line.
            'items.*.serials' => ['nullable', 'array'],
            'items.*.serials.*' => ['string', 'max:120', 'distinct'],
            'reason' => ['nullable', 'string', 'max:255'],
            'refund_method' => ['sometimes', Rule::in(['cash', 'card', 'bank_transfer', 'other'])],
            'notes' => ['nullable', 'string', 'max:500'],
            'cash_session_id' => [
                'nullable', 'uuid',
                new OwnOpenShift($this->user()),
            ],
        ];
    }
}
