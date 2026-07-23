<?php

namespace App\Http\Requests\Sale;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreSaleReturnRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::SALES_MANAGE);
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;

        return [
            'items' => ['required', 'array', 'min:1'],
            'items.*.sale_item_id' => ['required', 'uuid'],
            'items.*.quantity' => ['required', 'numeric', 'min:0.001'],
            'reason' => ['nullable', 'string', 'max:255'],
            'refund_method' => ['sometimes', Rule::in(['cash', 'card', 'bank_transfer', 'other'])],
            'notes' => ['nullable', 'string', 'max:500'],
            'cash_session_id' => [
                'nullable', 'uuid',
                Rule::exists('cash_sessions', 'id')->where('tenant_id', $tenantId)->where('status', 'open'),
            ],
        ];
    }
}
