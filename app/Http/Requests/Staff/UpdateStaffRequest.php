<?php

namespace App\Http\Requests\Staff;

use App\Enums\UserStatus;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

/**
 * Shared update rules; the permission list is validated against the scope
 * implied by the route (platform vs tenant staff endpoint).
 */
class UpdateStaffRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(
            $this->isPlatformRoute() ? Permissions::PLATFORM_STAFF_MANAGE : Permissions::STAFF_MANAGE,
        );
    }

    public function rules(): array
    {
        $scope = $this->isPlatformRoute() ? Permissions::platform() : Permissions::tenant();
        $staffId = $this->route('staff');

        return [
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'email' => [
                'sometimes', 'nullable', 'email', 'max:255',
                Rule::unique('users', 'email')->ignore($staffId)->whereNull('deleted_at'),
            ],
            'phone' => [
                'sometimes', 'nullable', 'string', 'max:32',
                Rule::unique('users', 'phone')->ignore($staffId)->whereNull('deleted_at'),
            ],
            'password' => ['sometimes', Password::min(8)],
            'status' => ['sometimes', Rule::enum(UserStatus::class)],
            'permissions' => ['sometimes', 'array', 'min:1'],
            'permissions.*' => ['string', Rule::in($scope)],
        ];
    }

    private function isPlatformRoute(): bool
    {
        return $this->is('api/v1/admin/*');
    }
}
