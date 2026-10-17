<?php

namespace App\Http\Requests\Installment;

use App\Models\SaleDocument;
use App\Rules\OwnOpenShift;
use App\Support\Permissions;
use App\Support\ShopDay;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StartInstallmentPlanRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::SALES_MANAGE);
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;

        return [
            'customer_name' => ['nullable', 'string', 'max:255'],
            // The khata — and every installment after today — is found by it.
            'customer_phone' => ['required', 'string', 'max:32'],
            'items' => ['required', 'array', 'min:1', 'max:100'],
            'items.*.product_id' => ['required', 'uuid', Rule::exists('products', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at')],
            'items.*.variant_id' => ['nullable', 'uuid'],
            'items.*.product_unit_id' => ['nullable', 'uuid'],
            'items.*.quantity' => ['required', 'numeric', 'min:0.001', 'max:100000'],
            'markup_percent' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'advance' => ['nullable', 'array'],
            'advance.amount' => ['nullable', 'numeric', 'min:0'],
            // Money handed over now — never "credit".
            'advance.method' => ['nullable', Rule::in(SaleDocument::DEPOSIT_METHODS)],
            'advance.reference' => ['nullable', 'string', 'max:120'],
            'months' => ['required', 'integer', 'min:1', 'max:60'],
            'first_due_on' => ['required', 'date', 'after_or_equal:'.ShopDay::calendarToday()],
            'cash_session_id' => ['nullable', 'uuid', new OwnOpenShift($this->user())],
            'notes' => ['nullable', 'string', 'max:1000'],
            // The bill the sheet read out — refused if the plan would be
            // written at another (PLAN_PRICE_CHANGED, money pass $8).
            'expected_total' => ['nullable', 'numeric', 'min:0'],
            'idempotency_key' => ['nullable', 'string', 'max:64'],
        ];
    }
}
