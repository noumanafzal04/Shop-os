<?php

namespace App\Http\Requests\Admin;

use App\Support\Permissions;
use App\Support\PlanLimits;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Per-tenant limit "extend": raise (or clear) a single tenant's ceilings past
 * its plan's baseline, for that tenant only. A limit set to null clears the
 * override (falls back to the plan). Keys must be known limit keys.
 */
class ExtendTenantLimitsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::TENANTS_UPDATE);
    }

    public function rules(): array
    {
        return [
            'limits' => ['required', 'array', 'min:1'],
            'limits.*' => ['nullable', 'integer', 'min:1'],
        ];
    }

    public function withValidator($validator): void
    {
        $validator->after(function ($v): void {
            foreach (array_keys($this->input('limits', [])) as $key) {
                if (! array_key_exists($key, PlanLimits::REGISTRY)) {
                    $v->errors()->add('limits', "Unknown limit: {$key}.");
                }
            }
        });
    }
}
