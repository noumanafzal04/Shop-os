<?php

namespace App\Http\Requests\Fuel;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class CloseForecourtShiftRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::INVENTORY_MANAGE);
    }

    public function rules(): array
    {
        return [
            // Both lists are required in full. The action re-checks that every
            // nozzle and tank the shift opened on is present — a partial close
            // would report a phantom loss on whatever it missed.
            'readings' => ['required', 'array', 'min:1'],
            'readings.*.fuel_nozzle_id' => ['required', 'uuid', Rule::exists('fuel_nozzles', 'id')],
            'readings.*.closing_reading' => ['required', 'numeric', 'min:0', 'max:99999999999'],
            'readings.*.test_litres' => ['sometimes', 'numeric', 'min:0', 'max:99999'],

            'dips' => ['required', 'array', 'min:1'],
            'dips.*.fuel_tank_id' => ['required', 'uuid', Rule::exists('fuel_tanks', 'id')],
            'dips.*.closing_dip' => ['required', 'numeric', 'min:0', 'max:9999999'],

            'notes' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
