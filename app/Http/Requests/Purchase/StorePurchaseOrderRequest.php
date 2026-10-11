<?php

namespace App\Http\Requests\Purchase;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StorePurchaseOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::PURCHASES_MANAGE);
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;

        return [
            'supplier_id' => [
                'required', 'uuid',
                Rule::exists('suppliers', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
            // Where the supplier is to bring it. Left out, the order is
            // addressed by the business's own rule — see Branch::newOrdersGoTo.
            'deliver_to_branch_id' => [
                'nullable', 'uuid',
                Rule::exists('branches', 'id')->where('tenant_id', $tenantId)->where('is_active', true)->whereNull('deleted_at'),
            ],
            'order_date' => ['required', 'date'],
            'expected_date' => ['nullable', 'date', 'after_or_equal:order_date'],
            'discount' => ['nullable', 'numeric', 'min:0', 'max:99999999'],
            'tax' => ['nullable', 'numeric', 'min:0', 'max:99999999'],
            'notes' => ['nullable', 'string', 'max:1000'],
            'status' => ['sometimes', Rule::in(['draft', 'ordered'])],

            'items' => ['required', 'array', 'min:1', 'max:200'],
            'items.*.product_id' => [
                'required', 'uuid',
                Rule::exists('products', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
            'items.*.variant_id' => [
                'nullable', 'uuid',
                Rule::exists('product_variants', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
            'items.*.product_unit_id' => ['nullable', 'uuid'],
            'items.*.quantity' => ['required', 'numeric', 'min:0.001'],
            'items.*.unit_cost' => ['required', 'numeric', 'min:0', 'max:99999999'],
        ];
    }
}
