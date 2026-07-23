<?php

namespace App\Http\Requests\Inventory;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class AdjustStockRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::INVENTORY_MANAGE);
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;

        return [
            'product_id' => [
                'required', 'uuid',
                Rule::exists('products', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
            'variant_id' => [
                'nullable', 'uuid',
                Rule::exists('product_variants', 'id')
                    ->where('tenant_id', $tenantId)
                    ->where('product_id', $this->input('product_id'))
                    ->whereNull('deleted_at'),
            ],
            'type' => ['required', Rule::in(['in', 'out', 'set'])],
            'quantity' => ['required_if:type,in,out', 'prohibited_if:type,set', 'numeric', 'min:0.001', 'max:1000000'],
            'new_quantity' => ['required_if:type,set', 'prohibited_if:type,in,out', 'numeric', 'min:0', 'max:1000000'],
            'reason' => ['nullable', 'string', 'max:255'],
            'idempotency_key' => ['nullable', 'string', 'max:64'],
        ];
    }
}
