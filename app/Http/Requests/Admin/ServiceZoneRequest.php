<?php

namespace App\Http\Requests\Admin;

use App\Models\ServiceZone;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * A zone as the admin drew it: a circle (centre + radius in metres) or a
 * polygon (three or more corners). The other shape's fields are cleared, so a
 * zone is never half a circle and half a polygon.
 */
class ServiceZoneRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // the route's permission middleware decides
    }

    public function rules(): array
    {
        $updating = $this->isMethod('put') || $this->isMethod('patch');
        $kind = $this->input('kind');

        return [
            'name' => [$updating ? 'sometimes' : 'required', 'string', 'max:120'],
            'city_id' => ['sometimes', 'nullable', 'uuid', Rule::exists('cities', 'id')],
            'kind' => [$updating ? 'sometimes' : 'required', Rule::in([ServiceZone::CIRCLE, ServiceZone::POLYGON])],
            'center_lat' => [Rule::requiredIf($kind === ServiceZone::CIRCLE), 'nullable', 'numeric', 'between:-90,90'],
            'center_lng' => [Rule::requiredIf($kind === ServiceZone::CIRCLE), 'nullable', 'numeric', 'between:-180,180'],
            // 50 m is a street corner; 100 km is a whole district.
            'radius_m' => [Rule::requiredIf($kind === ServiceZone::CIRCLE), 'nullable', 'integer', 'between:50,100000'],
            'points' => [Rule::requiredIf($kind === ServiceZone::POLYGON), 'nullable', 'array', 'min:3', 'max:300'],
            'points.*' => ['array', 'size:2'],
            'points.*.0' => ['required', 'numeric', 'between:-90,90'],
            'points.*.1' => ['required', 'numeric', 'between:-180,180'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    public function messages(): array
    {
        return [
            'points.min' => 'A shape needs at least 3 corners.',
            'radius_m.between' => 'A circle runs from 50 metres to 100 km.',
        ];
    }

    /** What is stored: the drawn shape's own fields, the other shape's cleared. */
    public function zone(): array
    {
        $data = $this->validated();
        if (($data['kind'] ?? null) === ServiceZone::CIRCLE) {
            $data['points'] = null;
        }
        if (($data['kind'] ?? null) === ServiceZone::POLYGON) {
            $data['center_lat'] = $data['center_lng'] = $data['radius_m'] = null;
            $data['points'] = array_map(fn (array $p) => [round((float) $p[0], 7), round((float) $p[1], 7)], $data['points']);
        }

        return $data;
    }
}
