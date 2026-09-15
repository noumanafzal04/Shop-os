<?php

namespace App\Http\Requests\SaleDocument;

use App\Enums\PaymentMethod;
use App\Rules\OwnOpenShift;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ConvertSaleDocumentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::SALES_MANAGE);
    }

    public function rules(): array
    {
        return [
            // The balance, tendered at the till. Omitted entirely when a
            // layaway was already paid off in instalments — then the deposit
            // is the only tender and nothing changes hands today.
            'payments' => ['nullable', 'array', 'max:5'],
            // 'deposit' is deliberately absent: the money already received is
            // read from the document, never asserted by the client.
            'payments.*.method' => ['required_with:payments', Rule::in(PaymentMethod::counterOrCredit())],
            'payments.*.amount' => ['required_with:payments', 'numeric', 'min:0'],
            'payments.*.reference' => ['nullable', 'string', 'max:120'],
            'payment_method' => ['nullable', Rule::in(PaymentMethod::counterOrCredit())],
            'amount_paid' => ['nullable', 'numeric', 'min:0'],
            'cash_session_id' => ['nullable', 'uuid', new OwnOpenShift($this->user())],
            'notes' => ['nullable', 'string', 'max:1000'],
            // Serialized retail: the IMEI of the handset actually handed over,
            // keyed by document line. Captured now, not when it was promised.
            'serials' => ['sometimes', 'array'],
            'serials.*' => ['array', 'max:1000'],
            'serials.*.*' => ['string', 'max:120'],
            'idempotency_key' => ['nullable', 'string', 'max:100'],
        ];
    }
}
