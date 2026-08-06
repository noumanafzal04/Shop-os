<?php

namespace App\Http\Requests\Fuel;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreFuelNozzleRequest extends FormRequest
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
            // Which tank the hose draws from — the link that lets meter litres
            // be taken off the right tank's book stock.
            'fuel_tank_id' => [$required, 'uuid', Rule::exists('fuel_tanks', 'id')->whereNull('deleted_at')],
            // Where the totaliser stands today. Settable when the nozzle is
            // first registered or its head is replaced; after that the shift
            // close owns it.
            'current_reading' => ['sometimes', 'numeric', 'min:0', 'max:99999999999'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
