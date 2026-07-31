<?php

namespace App\Http\Requests\TaxGroup;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;

class StoreTaxGroupRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::PRODUCTS_MANAGE);
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:80'],
            'rate' => ['required', 'numeric', 'min:0', 'max:100'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
