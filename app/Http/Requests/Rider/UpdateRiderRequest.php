<?php

namespace App\Http\Requests\Rider;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;

class UpdateRiderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::ORDERS_MANAGE);
    }

    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'required', 'string', 'max:120'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:32'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
