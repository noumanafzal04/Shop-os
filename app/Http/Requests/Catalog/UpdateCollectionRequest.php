<?php

namespace App\Http\Requests\Catalog;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateCollectionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::PRODUCTS_MANAGE);
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;
        $collectionId = $this->route('collection');

        return [
            'name' => [
                'sometimes', 'required', 'string', 'max:100',
                Rule::unique('collections', 'name')->where('tenant_id', $tenantId)->ignore($collectionId)->whereNull('deleted_at'),
            ],
            'description' => ['nullable', 'string', 'max:1000'],
            'sort_order' => ['sometimes', 'integer', 'min:0'],
            'is_active' => ['sometimes', 'boolean'],
            'visible_in_marketplace' => ['sometimes', 'boolean'],
            'item_ids' => ['nullable', 'array'],
            'item_ids.*' => [
                'uuid',
                Rule::exists('products', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
        ];
    }
}
