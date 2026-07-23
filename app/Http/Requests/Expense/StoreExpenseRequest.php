<?php

namespace App\Http\Requests\Expense;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreExpenseRequest extends FormRequest
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
            'expense_category_id' => [
                'required', 'uuid',
                Rule::exists('expense_categories', 'id')
                    ->where('tenant_id', $tenantId)
                    ->whereNull('deleted_at'),
            ],
            'description' => ['required', 'string', 'max:255'],
            // Edge case: negative or zero amounts blocked.
            'amount' => ['required', 'numeric', 'min:0.01', 'max:99999999'],
            // Edge case: future-dated expenses blocked.
            'expense_date' => ['required', 'date', 'before_or_equal:today'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ];
    }

    public function messages(): array
    {
        return [
            'expense_date.before_or_equal' => 'Expenses cannot be dated in the future.',
            'amount.min' => 'Amount must be greater than zero.',
        ];
    }
}
