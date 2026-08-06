<?php

namespace App\Http\Requests\Income;

use App\Models\Income;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Income is part of the Expense & Income module, so it shares the
 * expenses.manage permission (the plan grants them together).
 */
class StoreIncomeRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::EXPENSES_MANAGE);
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;

        return [
            // Edge case: missing category → 422; other tenant's category → 422.
            'income_category_id' => [
                'required', 'uuid',
                Rule::exists('income_categories', 'id')
                    ->where('tenant_id', $tenantId)
                    ->whereNull('deleted_at'),
            ],
            'description' => ['required', 'string', 'max:255'],
            'reference' => ['nullable', 'string', 'max:64'],
            // Edge case: negative or zero amounts blocked.
            'amount' => ['required', 'numeric', 'min:0.01', 'max:99999999'],
            // Cash lands in the till; a bank transfer doesn't.
            'payment_method' => ['sometimes', Rule::in(Income::PAYMENT_METHODS)],
            // Edge case: future-dated income blocked.
            'income_date' => ['required', 'date', 'before_or_equal:today'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ];
    }

    public function messages(): array
    {
        return [
            'income_date.before_or_equal' => 'Income cannot be dated in the future.',
            'amount.min' => 'Amount must be greater than zero.',
        ];
    }
}
