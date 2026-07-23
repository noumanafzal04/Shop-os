<?php

namespace App\Http\Requests\Admin;

use App\Support\Modules;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateTenantModulesRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::TENANTS_UPDATE);
    }

    public function rules(): array
    {
        return [
            'modules' => ['required', 'array', 'min:1'],
            'modules.*' => ['boolean'],
            // Only known module keys may be toggled.
            ...collect(array_keys($this->input('modules', [])))
                ->mapWithKeys(fn ($k) => ["modules.{$k}" => ['boolean', Rule::in([true, false])]])
                ->all(),
        ];
    }

    public function withValidator($validator): void
    {
        $validator->after(function ($v): void {
            foreach (array_keys($this->input('modules', [])) as $key) {
                if (! in_array($key, Modules::keys(), true)) {
                    $v->errors()->add('modules', "Unknown module: {$key}.");
                }
            }
        });
    }
}
