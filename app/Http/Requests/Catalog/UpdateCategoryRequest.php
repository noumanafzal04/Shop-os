<?php

namespace App\Http\Requests\Catalog;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateCategoryRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::PRODUCTS_MANAGE);
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;
        $categoryId = $this->route('category');

        return [
            'name' => [
                'sometimes', 'required', 'string', 'max:100',
                Rule::unique('categories', 'name')
                    ->where('tenant_id', $tenantId)
                    ->where('parent_id', $this->input('parent_id'))
                    ->ignore($categoryId)
                    ->whereNull('deleted_at'),
            ],
            'parent_id' => [
                'nullable', 'uuid',
                Rule::exists('categories', 'id')
                    ->where('tenant_id', $tenantId)
                    ->whereNull('deleted_at'),
            ],
            'sort_order' => ['sometimes', 'integer', 'min:0'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
