<?php

namespace App\Http\Requests\Shop;

use App\Support\Permissions;
use App\Support\ShopSettings;
use Illuminate\Foundation\Http\FormRequest;

class UpdateShopSettingsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::SETTINGS_MANAGE);
    }

    public function rules(): array
    {
        return ShopSettings::rules();
    }
}
