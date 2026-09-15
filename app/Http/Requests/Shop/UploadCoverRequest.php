<?php

namespace App\Http\Requests\Shop;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;

class UploadCoverRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::SETTINGS_MANAGE);
    }

    public function rules(): array
    {
        return [
            /**
             * FOUR MEGABYTES, twice the logo's.
             *
             * A logo is a small square and 2 MB is generous for one. A cover is
             * the widest image in the app — it fills the top of the shop page
             * on a large phone — and a photograph of a counter at that size
             * routinely leaves a modern camera above 2 MB. A limit that refuses
             * the ordinary case teaches a shopkeeper the feature is broken.
             */
            'cover' => ['required', 'image', 'mimes:jpg,jpeg,png,webp', 'max:4096'],
        ];
    }
}
