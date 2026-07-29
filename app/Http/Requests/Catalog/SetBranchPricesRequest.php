<?php

namespace App\Http\Requests\Catalog;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class SetBranchPricesRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::PRODUCTS_MANAGE);
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;

        return [
            'prices' => ['required', 'array', 'min:1', 'max:200'],
            'prices.*.branch_id' => [
                'required', 'uuid',
                Rule::exists('branches', 'id')->where('tenant_id', $tenantId),
            ],
            // Null clears the override; a value sets it. Zero is not a valid price.
            'prices.*.price' => ['present', 'nullable', 'numeric', 'gt:0', 'max:100000000'],
        ];
    }
}
