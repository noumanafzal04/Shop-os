<?php

namespace App\Http\Requests\Inventory;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreTransferRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::INVENTORY_MANAGE);
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;

        return [
            'from_branch_id' => ['required', 'uuid', Rule::exists('branches', 'id')->where('tenant_id', $tenantId)],
            'to_branch_id' => ['required', 'uuid', 'different:from_branch_id', Rule::exists('branches', 'id')->where('tenant_id', $tenantId)],
            'notes' => ['nullable', 'string', 'max:500'],
            'items' => ['required', 'array', 'min:1', 'max:200'],
            'items.*.product_id' => ['required', 'uuid', Rule::exists('products', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at')],
            'items.*.variant_id' => ['nullable', 'uuid'],
            'items.*.quantity' => ['required', 'numeric', 'min:0.001', 'max:100000'],
        ];
    }
}
