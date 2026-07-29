<?php

namespace App\Http\Requests\Hardware;

use App\Models\HardwareDevice;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreHardwareDeviceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::SETTINGS_MANAGE);
    }

    public function rules(): array
    {
        return [
            'type' => ['required', Rule::in(HardwareDevice::TYPES)],
            'name' => ['required', 'string', 'max:120'],
            'brand' => ['nullable', 'string', 'max:80'],
            'model' => ['nullable', 'string', 'max:80'],
            'connection_type' => ['required', Rule::in(HardwareDevice::CONNECTIONS)],
            'connection_value' => ['nullable', 'string', 'max:191'],
            'is_default' => ['sometimes', 'boolean'],
            'is_active' => ['sometimes', 'boolean'],
            'settings' => ['nullable', 'array'],
            'settings.paper_size' => ['nullable', 'in:58mm,80mm,a4'],
            'settings.copies' => ['nullable', 'integer', 'min:1', 'max:5'],
            'settings.cut_paper' => ['nullable', 'boolean'],
            'settings.open_drawer' => ['nullable', 'boolean'],
        ];
    }
}
