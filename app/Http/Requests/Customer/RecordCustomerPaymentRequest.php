<?php

namespace App\Http\Requests\Customer;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;

/**
 * A repayment against a customer's khata (credit balance).
 */
class RecordCustomerPaymentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::CUSTOMERS_MANAGE);
    }

    public function rules(): array
    {
        return [
            'amount' => ['required', 'numeric', 'min:0.01', 'max:99999999'],
            'method' => ['required', 'in:cash,card,bank_transfer,other'],
            'reference' => ['nullable', 'string', 'max:100'],
            'note' => ['nullable', 'string', 'max:255'],
        ];
    }
}
