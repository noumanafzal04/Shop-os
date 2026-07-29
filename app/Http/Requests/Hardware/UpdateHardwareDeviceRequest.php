<?php

namespace App\Http\Requests\Hardware;

use App\Models\HardwareDevice;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateHardwareDeviceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::SETTINGS_MANAGE);
    }

    public function rules(): array
    {
        // Type is fixed after creation (a printer never becomes a scanner).
        return [
            'type' => ['prohibited'],
            'name' => ['sometimes', 'required', 'string', 'max:120'],
            'brand' => ['nullable', 'string', 'max:80'],
            'model' => ['nullable', 'string', 'max:80'],
            'connection_type' => ['sometimes', 'required', Rule::in(HardwareDevice::CONNECTIONS)],
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

    public function messages(): array
    {
        return ['type.prohibited' => 'A device type cannot be changed after creation.'];
    }
}
