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
            // Required only when this entry has nothing else to say. Naming the
            // man on a hose must NOT oblige the caller to restate the meter:
            // an echoed reading is written back to the nozzle, so a screen that
            // sent yesterday's cached figure alongside today's attendant would
            // silently move a totaliser while assigning a person. An entry that
            // carries neither is refused, which is what catches a mistyped key.
            'readings.*.opening_reading' => [
                'nullable',
                'required_without:readings.*.attendant_id',
                'numeric', 'min:0', 'max:99999999999',
            ],
            // Whose nozzle this is for the shift. Optional — a one-man pump has
            // nobody to assign — and scoped to this shop's own staff, because
            // the unbilled figure it produces is a person's shortfall and it
            // must name somebody the owner can actually go and ask.
            'readings.*.attendant_id' => [
                'nullable', 'uuid',
                Rule::exists('users', 'id')->where('tenant_id', $this->user()->tenant_id)->whereNull('deleted_at'),
            ],
            'dips' => ['sometimes', 'array'],
            'dips.*.fuel_tank_id' => ['required', 'uuid', Rule::exists('fuel_tanks', 'id')->whereNull('deleted_at')],
            'dips.*.opening_dip' => ['required', 'numeric', 'min:0', 'max:9999999'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ];
    }
}
