<?php

namespace App\Http\Requests\Staff;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

class StorePlatformStaffRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::PLATFORM_STAFF_MANAGE);
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'email' => [
                'nullable', 'required_without:phone', 'email', 'max:255',
                Rule::unique('users', 'email')->whereNull('deleted_at'),
            ],
            'phone' => [
                'nullable', 'required_without:email', 'string', 'max:32',
                Rule::unique('users', 'phone')->whereNull('deleted_at'),
            ],
            'password' => ['required', Password::min(8)],
            'permissions' => ['required', 'array', 'min:1'],
            'permissions.*' => ['string', Rule::in(Permissions::platform())],
        ];
    }
}
