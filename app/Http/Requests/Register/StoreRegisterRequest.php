<?php

namespace App\Http\Requests\Register;

use App\Support\BranchContext;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreRegisterRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::SETTINGS_MANAGE);
    }

    /**
     * Default the site to the branch being operated BEFORE validating, so the
     * duplicate-name check is judged against the branch the lane will actually
     * land on. Resolving it afterwards would let "Lane 1" be created twice at
     * one site — the uniqueness rule would have compared against no branch.
     */
    protected function prepareForValidation(): void
    {
        if ($this->input('branch_id') === null) {
            $this->merge(['branch_id' => app(BranchContext::class)->id()]);
        }
    }

    public function rules(): array
    {
        $tenantId = $this->user()->tenant_id;

        return [
            'name' => [
                'required', 'string', 'max:60',
                // Unique among LIVE lanes at the same site — a retired lane's
                // name is free to reuse.
                Rule::unique('registers', 'name')
                    ->where('tenant_id', $tenantId)
                    ->where('branch_id', $this->input('branch_id'))
                    ->whereNull('deleted_at'),
            ],
            'code' => ['nullable', 'string', 'max:20'],
            'branch_id' => [
                'nullable', 'uuid',
                Rule::exists('branches', 'id')->where('tenant_id', $tenantId)->whereNull('deleted_at'),
            ],
            'is_active' => ['sometimes', 'boolean'],
            'settings' => ['nullable', 'array'],
        ];
    }

    public function messages(): array
    {
        return ['name.unique' => 'This branch already has a register with that name.'];
    }
}
