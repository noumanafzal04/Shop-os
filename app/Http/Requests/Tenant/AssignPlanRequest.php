<?php

namespace App\Http\Requests\Tenant;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class AssignPlanRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(\App\Support\Permissions::TENANTS_ASSIGN_PLAN);
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
        ];
    }
}
