<?php

namespace App\Http\Requests\Branch;

use App\Models\Branch;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateBranchRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::SETTINGS_MANAGE);
    }

    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'code' => ['nullable', 'string', 'max:32'],
            'address' => ['nullable', 'string', 'max:500'],
            'phone' => ['nullable', 'string', 'max:32'],
            'city_id' => ['nullable', 'uuid', Rule::exists('cities', 'id')->where('is_active', true)],
            'latitude' => ['nullable', 'required_with:longitude', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'required_with:latitude', 'numeric', 'between:-180,180'],
            'is_active' => ['sometimes', 'boolean'],
            // What kind of place this is: a shop sells at a counter, a
            // warehouse only holds stock. Unnamed, it is a shop — which is
            // what every caller that pre-dates the choice meant.
            'kind' => ['sometimes', Rule::in(Branch::KINDS)],
            // May online orders be filled from here. A warehouse's own choice;
            // a shop always may.
            'fills_orders' => ['sometimes', 'boolean'],
            // The one place this business's deliveries come to — its
            // warehouse, usually. Marking it un-marks any other.
            'takes_deliveries' => ['sometimes', 'boolean'],
        ];
    }
}
