<?php

namespace App\Http\Requests\SaleDocument;

use App\Models\SaleDocument;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreDepositRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::SALES_MANAGE);
    }

    public function rules(): array
    {
        return [
            'amount' => ['required', 'numeric', 'min:0.01', 'max:99999999'],
            // No 'credit': an advance is money received. Putting one on the
            // khata would mean the shop holding goods against money it has
            // simultaneously lent the customer.
            'method' => ['nullable', Rule::in(SaleDocument::DEPOSIT_METHODS)],
            'reference' => ['nullable', 'string', 'max:120'],
            'note' => ['nullable', 'string', 'max:255'],
        ];
    }
}
