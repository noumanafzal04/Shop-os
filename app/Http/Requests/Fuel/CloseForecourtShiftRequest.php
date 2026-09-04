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
            // Litres, OR the depth the stick actually read. Which of the two
            // a dip named is settled in the action, not here — a rule that
            // points at a sibling path stops working the moment somebody
            // re-keys this request under a prefix, which is exactly how the
            // sale line's version broke forty-nine offline sales.
            'dips.*.closing_dip' => ['nullable', 'numeric', 'min:0', 'max:9999999'],
            'dips.*.closing_dip_mm' => ['nullable', 'integer', 'min:0', 'max:100000'],

            'notes' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
