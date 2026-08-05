<?php

namespace App\Http\Requests\Register;

use App\Models\Register;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateRegisterRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::SETTINGS_MANAGE);
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;
        $id = $this->route('register');
        // Uniqueness is judged against the lane's OWN site, not a client-sent
        // one (branch_id is prohibited below, so the input is never present).
        $branchId = Register::query()->whereKey($id)->value('branch_id');

        return [
            'name' => [
                'sometimes', 'required', 'string', 'max:60',
                Rule::unique('registers', 'name')
                    ->where('tenant_id', $tenantId)
                    ->where('branch_id', $branchId)
                    ->whereNull('deleted_at')
                    ->ignore($id),
            ],
            'code' => ['nullable', 'string', 'max:20'],
            // A lane cannot move site: its shifts, sales and bound hardware all
            // belong to where it physically stands. Retire it and add one there.
            'branch_id' => ['prohibited'],
            'is_active' => ['sometimes', 'boolean'],
            'settings' => ['nullable', 'array'],
        ];
    }

    public function messages(): array
    {
        return [
            'name.unique' => 'This branch already has a register with that name.',
            'branch_id.prohibited' => 'A register cannot be moved to another branch. Retire it and add one at the new branch.',
        ];
    }
}
