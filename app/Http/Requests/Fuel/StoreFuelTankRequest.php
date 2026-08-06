<?php

namespace App\Http\Requests\Fuel;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreFuelTankRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::SETTINGS_MANAGE);
    }

    public function rules(): array
    {
        $required = $this->isMethod('POST') ? 'required' : 'sometimes';

        return [
            'name' => [$required, 'string', 'max:255'],
            // What's in it. Fuel is an ordinary Product — the tank points at
            // the catalog rather than keeping a price nobody would update.
            'product_id' => [$required, 'uuid', Rule::exists('products', 'id')->whereNull('deleted_at')],
            'branch_id' => ['nullable', 'uuid', Rule::exists('branches', 'id')->whereNull('deleted_at')],
            'capacity_litres' => ['sometimes', 'numeric', 'min:0', 'max:9999999'],
            // The dip the tank starts life on. After that the shift close owns
            // it — a hand-edited dip would silently absorb a variance.
            'current_dip_litres' => ['sometimes', 'numeric', 'min:0', 'max:9999999'],
            'dead_stock_litres' => ['sometimes', 'numeric', 'min:0', 'max:9999999'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    public function withValidator($validator): void
    {
        $validator->after(function ($validator): void {
            $capacity = (float) $this->input('capacity_litres', 0);
            $dead = (float) $this->input('dead_stock_litres', 0);

            if ($capacity > 0 && $dead > $capacity) {
                $validator->errors()->add('dead_stock_litres', 'Dead stock cannot exceed the tank capacity.');
            }
        });
    }
}
