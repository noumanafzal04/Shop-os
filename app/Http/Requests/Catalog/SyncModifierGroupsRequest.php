<?php

namespace App\Http\Requests\Catalog;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class SyncModifierGroupsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::PRODUCTS_MANAGE);
    }

    public function rules(): array
    {
        return [
            'groups' => ['present', 'array', 'max:30'],
            'groups.*.name' => ['required', 'string', 'max:100'],
            'groups.*.type' => ['sometimes', Rule::in(['modifier', 'addon'])],
            'groups.*.min_select' => ['required', 'integer', 'min:0', 'max:50'],
            'groups.*.max_select' => ['required', 'integer', 'min:0', 'max:50'],
            'groups.*.options' => ['required', 'array', 'min:1', 'max:50'],
            'groups.*.options.*.name' => ['required', 'string', 'max:100'],
            'groups.*.options.*.price_delta' => ['sometimes', 'numeric', 'min:0', 'max:99999999'],
            'groups.*.options.*.is_default' => ['sometimes', 'boolean'],
        ];
    }

    public function withValidator($validator): void
    {
        $validator->after(function ($v): void {
            foreach ($this->input('groups', []) as $i => $g) {
                $max = (int) ($g['max_select'] ?? 0);
                $min = (int) ($g['min_select'] ?? 0);
                if ($max > 0 && $min > $max) {
                    $v->errors()->add("groups.{$i}.min_select", 'Minimum cannot exceed maximum.');
                }
            }
        });
    }
}
