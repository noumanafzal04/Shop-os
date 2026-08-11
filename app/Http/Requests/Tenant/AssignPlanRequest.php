<?php

namespace App\Http\Requests\Tenant;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class AssignPlanRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::TENANTS_ASSIGN_PLAN);
    }

    public function rules(): array
    {
        return [
            'plan_id' => ['required', 'uuid', Rule::exists('plans', 'id')],
            // Optional payment capture (billing ledger).
            'payment' => ['sometimes', 'array'],
            'payment.amount' => ['sometimes', 'numeric', 'min:0', 'max:99999999'],
            'payment.method' => ['sometimes', Rule::in(['cash', 'card', 'bank_transfer', 'manual', 'other'])],
            'payment.reference' => ['sometimes', 'nullable', 'string', 'max:100'],
            'payment.notes' => ['sometimes', 'nullable', 'string', 'max:500'],
            // When the money actually arrived. Backdatable — a shop that paid
            // on Thursday and was entered on Monday paid on Thursday — but not
            // forward-dated, because a future payment has not happened.
            'payment.paid_at' => ['sometimes', 'nullable', 'date', 'before_or_equal:now'],

            // The explicit billing window ("between"). Omit both and the period
            // is derived from the plan the way it always was.
            'period' => ['sometimes', 'array'],
            'period.starts_at' => ['sometimes', 'nullable', 'date'],
            'period.ends_at' => ['sometimes', 'nullable', 'date'],
        ];
    }

    /**
     * The ordering check lives here rather than in an `after:` rule because
     * either end may be omitted, and `after:period.starts_at` against a field
     * that is not in the payload compares to whatever strtotime() makes of the
     * literal string — which is not a validation, it just looks like one.
     */
    public function withValidator($validator): void
    {
        $validator->after(function ($v): void {
            $starts = $this->input('period.starts_at');
            $ends = $this->input('period.ends_at');

            if ($starts && $ends && strtotime((string) $ends) <= strtotime((string) $starts)) {
                $v->errors()->add('period.ends_at', 'The billing period has to end after it starts.');
            }
        });
    }

    public function messages(): array
    {
        return [
            'payment.paid_at.before_or_equal' => 'A payment cannot be dated in the future.',
        ];
    }
}
