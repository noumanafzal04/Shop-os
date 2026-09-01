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
            // REQUIRED WHEN THE NOZZLE IS CARDED, and only then.
            //
            // The column defaults to 0, and a pump installed mid-life has a
            // totaliser already reading six figures. A nozzle carded without
            // its reading starts at nought, the first shift opens at nought and
            // closes at the real number, and the forecourt books THE METER'S
            // WHOLE LIFE as that shift's sales.
            //
            // That is the disaster `OpenForecourtShiftAction` already names —
            // "discovering at close that the shift 'sold' 400,000 litres" —
            // reached by a different road. It guards an opening typed below the
            // stored reading; it cannot guard a stored reading nobody took.
            //
            // Nought is a perfectly good answer for a new pump. The rule is
            // that somebody has to SAY so.
            'current_reading' => [$required, 'numeric', 'min:0', 'max:99999999999'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
