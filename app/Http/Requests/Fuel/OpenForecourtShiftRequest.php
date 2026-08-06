<?php

namespace App\Http\Requests\Fuel;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class OpenForecourtShiftRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::INVENTORY_MANAGE);
    }

    public function rules(): array
    {
        return [
            'branch_id' => ['nullable', 'uuid', Rule::exists('branches', 'id')->whereNull('deleted_at')],
            // Optional overrides. The shift otherwise opens on whatever the
            // equipment already says it is on, which is the previous shift's
            // closing number — the only value that keeps the series unbroken.
            'readings' => ['sometimes', 'array'],
            'readings.*.fuel_nozzle_id' => ['required', 'uuid', Rule::exists('fuel_nozzles', 'id')->whereNull('deleted_at')],
            'readings.*.opening_reading' => ['required', 'numeric', 'min:0', 'max:99999999999'],
            'dips' => ['sometimes', 'array'],
            'dips.*.fuel_tank_id' => ['required', 'uuid', Rule::exists('fuel_tanks', 'id')->whereNull('deleted_at')],
            'dips.*.opening_dip' => ['required', 'numeric', 'min:0', 'max:9999999'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
