<?php

namespace App\Http\Requests\Shop;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;

class UploadLogoRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::SETTINGS_MANAGE);
    }

    public function rules(): array
    {
        return [
            // Edge cases: invalid file type and huge uploads rejected here.
            'logo' => ['required', 'image', 'mimes:jpg,jpeg,png,webp', 'max:2048'], // 2 MB
        ];
    }
}
