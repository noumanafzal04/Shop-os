<?php

namespace App\Http\Requests\Catalog;

use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;

class UploadProductImagesRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::PRODUCTS_MANAGE);
    }

    public function messages(): array
    {
        return [
            'images.max' => 'A product has one picture. Upload a single file — it replaces the current one.',
        ];
    }

    public function rules(): array
    {
        return [
            /**
             * ONE FILE. It was `max:8`.
             *
             * Still an ARRAY rather than a single `image` field, because that
             * is the shape every client already sends — `images[]` in a
             * multipart body — and changing the field name would break an
             * upload that works rather than fix one that does not.
             *
             * The controller replaces whatever the product already had, so a
             * second file in the same request would silently be the one that
             * lost. Refusing it says so instead.
             */
            'images' => ['required', 'array', 'min:1', 'max:1'],
            'images.*' => ['image', 'mimes:jpg,jpeg,png,webp', 'max:4096'], // 4 MB
        ];
    }
}
