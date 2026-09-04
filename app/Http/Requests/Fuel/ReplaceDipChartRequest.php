<?php

namespace App\Http\Requests\Fuel;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;

/**
 * A tank's calibration chart, replaced whole.
 *
 * `settings.manage`, the same as creating the tank: a chart is part of the
 * plant, not part of a day's trading. The person who dips a tank at 2am does
 * not get to redefine what its depths mean.
 */
class ReplaceDipChartRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::SETTINGS_MANAGE);
    }

    public function rules(): array
    {
        return [
            // Present but empty CLEARS the chart, which is how a station undoes
            // a bad paste. `present` rather than `required` so an empty array
            // survives validation instead of reading as a missing field.
            'points' => ['present', 'array', 'max:5000'],
            // Whole millimetres. A chart is never finer than that, and a float
            // would make two readings of the same printed line fail to match.
            'points.*.mm' => ['required', 'integer', 'min:0', 'max:100000'],
            'points.*.litres' => ['required', 'numeric', 'min:0', 'max:9999999'],
        ];
    }
}
