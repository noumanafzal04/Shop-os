<?php

namespace App\Http\Requests\Installment;

use App\Enums\PaymentMethod;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class TakeInstallmentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::SALES_MANAGE);
    }

    public function rules(): array
    {
        return [
            'amount' => ['required', 'numeric', 'min:0.01', 'max:99999999'],
            'method' => ['required', Rule::in(PaymentMethod::counter())],
            'reference' => ['nullable', 'string', 'max:100'],
            'note' => ['nullable', 'string', 'max:255'],
            'idempotency_key' => ['nullable', 'string', 'max:100'],
        ];
    }
}
