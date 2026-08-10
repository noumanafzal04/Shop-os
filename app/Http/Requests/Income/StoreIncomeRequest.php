<?php

namespace App\Http\Requests\Income;

use App\Models\Income;
use App\Models\IncomeCategory;
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
            // Who it came from. "Who paid this?" is the first question asked
            // of any receipt, and the books had nowhere to write the answer.
            'payer' => ['nullable', 'string', 'max:120'],
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

    /**
     * Nothing new is filed under a category the shop has switched off — the
     * mirror of StoreExpenseRequest, and for the same reason: a retired
     * category that still accepts entries isn't retired.
     *
     * An entry already filed under one keeps it, so correcting an old row does
     * not force a reclassification.
     */
    public function withValidator($validator): void
    {
        $validator->after(function ($v): void {
            $categoryId = $this->input('income_category_id');
            if (! is_string($categoryId) || $v->errors()->has('income_category_id')) {
                return;
            }

            if ($categoryId === $this->existingCategoryId()) {
                return;
            }

            $active = IncomeCategory::withoutTenancy()
                ->whereKey($categoryId)
                ->where('tenant_id', $this->user()->tenant_id)
                ->value('is_active');

            if ($active !== null && ! $active) {
                $v->errors()->add(
                    'income_category_id',
                    'That category is switched off. Turn it back on under Categories, or pick another.',
                );
            }
        });
    }

    /** The category this income is already filed under, when editing one. */
    private function existingCategoryId(): ?string
    {
        $id = $this->route('income');
        if (! is_string($id)) {
            return null;
        }

        return Income::withoutTenancy()
            ->whereKey($id)
            ->where('tenant_id', $this->user()->tenant_id)
            ->value('income_category_id');
    }

    public function messages(): array
    {
        return [
            'income_date.before_or_equal' => 'Income cannot be dated in the future.',
            'amount.min' => 'Amount must be greater than zero.',
        ];
    }
}
