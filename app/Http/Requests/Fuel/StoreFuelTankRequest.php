<?php

namespace App\Http\Requests\Fuel;

use App\Http\Requests\Concerns\ValidatesAgainstTheStoredRecord;
use App\Models\FuelTank;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreFuelTankRequest extends FormRequest
{
    use ValidatesAgainstTheStoredRecord;

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
            // REQUIRED WHEN THE TANK IS INSTALLED, and only then.
            //
            // The column defaults to 0 and the gate that turns a tanker away
            // reads `capacity_litres > 0 && …`, so a tank carded without one is
            // not a tank of unknown size — it is a tank with NO GATE, and the
            // refusal this module exists for is silently absent. Every physical
            // tank has a capacity and the whole forecourt reconciles against
            // it; a station that has not said what it is cannot be told a
            // delivery will not fit.
            //
            // `sometimes` on an edit, so renaming a tank does not demand it
            // back.
            'capacity_litres' => [$required, 'numeric', 'min:1', 'max:9999999'],
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
            // The tank as it WILL be, so an edit that touches only the dead
            // stock is still checked against the capacity already on file
            // rather than against a zero nobody sent.
            $capacity = (float) $this->effective('capacity_litres', FuelTank::class, 'tank', 0);
            $dead = (float) $this->effective('dead_stock_litres', FuelTank::class, 'tank', 0);

            if ($capacity > 0 && $dead > $capacity) {
                $validator->errors()->add('dead_stock_litres', 'Dead stock cannot exceed the tank capacity.');
            }
        });
    }
}
