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
        // The shop's words, not the field's (#NE1): "The images.0 field must
        // be an image." named a form field nobody can see.
        $notAPicture = 'That file is not a picture. Use a JPG, PNG or WebP under 4 MB.';

        return [
            'images.max' => 'A product has one picture. Upload a single file — it replaces the current one.',
            'images.*.uploaded' => 'That picture did not arrive. Use a JPG, PNG or WebP under 4 MB.',
            'images.*.image' => $notAPicture,
            'images.*.mimes' => $notAPicture,
            'images.*.max' => 'That picture is over 4 MB. Use a JPG, PNG or WebP under 4 MB.',
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
            // `bail`: one sentence, the first that is true — a big text file was
            // told it is not a picture AND that it is over 4 MB.
            'images.*' => ['bail', 'image', 'mimes:jpg,jpeg,png,webp', 'max:4096'], // 4 MB
        ];
    }
}
