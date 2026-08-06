<?php

namespace App\Http\Requests\Expense;

use App\Models\Expense;
use App\Models\ExpenseCategory;
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
            // Who was paid. Optional — the electricity board is not a supplier
            // in the catalog sense, but a wholesaler paid in cash often is.
            'supplier_id' => [
                'nullable', 'uuid',
                Rule::exists('suppliers', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
            'description' => ['required', 'string', 'max:255'],
            'reference' => ['nullable', 'string', 'max:64'],
            // Edge case: negative or zero amounts blocked.
            'amount' => ['required', 'numeric', 'min:0.01', 'max:99999999'],
            // How it was paid. Only `cash` moves a drawer — see
            // RecordExpenseAction for why the others deliberately don't.
            'payment_method' => ['sometimes', Rule::in(Expense::PAYMENT_METHODS)],
            // Edge case: future-dated expenses blocked.
            'expense_date' => ['required', 'date', 'before_or_equal:today'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ];
    }

    /**
     * Nothing new is filed under a category the shop has switched off.
     *
     * That is the whole point of deactivating rather than deleting: a category
     * with history cannot be removed without stranding a year of entries under
     * a blank, so it is retired instead — and "retired" has to stop new entries
     * or it means nothing at all. Neither layer checked it, so switching a
     * category off changed exactly one thing: whether it showed in a filter.
     *
     * An entry ALREADY filed under a retired category keeps it. Correcting the
     * amount on last year's rent must not force a reclassification nobody asked
     * for — only a deliberate move to a retired category is refused.
     */
    public function withValidator($validator): void
    {
        $validator->after(function ($v): void {
            $categoryId = $this->input('expense_category_id');
            if (! is_string($categoryId) || $v->errors()->has('expense_category_id')) {
                return;
            }

            if ($categoryId === $this->existingCategoryId()) {
                return;
            }

            $active = ExpenseCategory::withoutTenancy()
                ->whereKey($categoryId)
                ->where('tenant_id', $this->user()->tenant_id)
                ->value('is_active');

            if ($active !== null && ! $active) {
                $v->errors()->add(
                    'expense_category_id',
                    'That category is switched off. Turn it back on under Categories, or pick another.',
                );
            }
        });
    }

    /** The category this expense is already filed under, when editing one. */
    private function existingCategoryId(): ?string
    {
        $id = $this->route('expense');
        if (! is_string($id)) {
            return null;
        }

        return Expense::withoutTenancy()
            ->whereKey($id)
            ->where('tenant_id', $this->user()->tenant_id)
            ->value('expense_category_id');
    }

    public function messages(): array
    {
        return [
            'expense_date.before_or_equal' => 'Expenses cannot be dated in the future.',
            'amount.min' => 'Amount must be greater than zero.',
        ];
    }
}
