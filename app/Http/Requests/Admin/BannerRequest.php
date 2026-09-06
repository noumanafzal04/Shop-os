<?php

namespace App\Http\Requests\Admin;

use App\Http\Requests\Concerns\ValidatesAgainstTheStoredRecord;
use App\Models\Banner;
use App\Support\Permissions;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class BannerRequest extends FormRequest
{
    use ValidatesAgainstTheStoredRecord;

    public function authorize(): bool
    {
        return $this->user()->hasPermission(Permissions::BANNERS_MANAGE);
    }

    public function rules(): array
    {
        $creating = $this->route('banner') === null;

        return [
            /**
             * 2 MB, because that is what PHP actually accepts.
             *
             * This said `max:4096`. PHP's own `upload_max_filesize` defaults
             * to 2M, and a file over THAT never reaches validation — the
             * upload arrives invalid and Laravel says "The image failed to
             * upload", which is the least helpful sentence it owns. Reported
             * exactly that way: a 1200x600 PNG out of an image generator,
             * refused with no reason anybody could act on.
             *
             * A rule that promises more than the server accepts is a rule that
             * lies, and the lie surfaces as a mystery. Matching PHP's default
             * costs nothing: a 1200x600 banner as JPG is under 300 KB, and
             * only PNG at that size gets near two megabytes.
             */
            'image' => [$creating ? 'required' : 'nullable', 'image', 'mimes:jpg,jpeg,png,webp', 'max:2048'],
            'title' => ['nullable', 'string', 'max:120'],
            'tenant_id' => ['nullable', 'uuid', Rule::exists('tenants', 'id')->whereNull('deleted_at')],
            'target_type' => ['sometimes', Rule::in(['shop', 'product', 'url', 'none'])],
            'target_product_id' => ['nullable', 'uuid', Rule::exists('products', 'id')->whereNull('deleted_at')],
            'target_url' => ['nullable', 'url', 'max:500'],
            'placement' => ['sometimes', Rule::in(['home', 'marketplace_top'])],
            'sort_order' => ['sometimes', 'integer', 'min:0'],
            'is_active' => ['sometimes', 'boolean'],
            'starts_at' => ['nullable', 'date'],
            'ends_at' => ['nullable', 'date', 'after_or_equal:starts_at'],
            'amount' => ['nullable', 'numeric', 'min:0'],
            'paid_at' => ['nullable', 'date'],
            'notes' => ['nullable', 'string', 'max:500'],
        ];
    }

    public function withValidator($validator): void
    {
        $validator->after(function ($v): void {
            // THE BANNER AS IT WILL BE, not as this request describes it.
            //
            // Every line here read the INPUT with a default, so an edit that
            // changed only the title was validated as a brand-new SHOP banner
            // and refused with "Pick the advertiser shop" — naming a field the
            // admin was not touching and had already filled in weeks ago. The
            // third time this exact mistake has been found in one codebase; see
            // ValidatesAgainstTheStoredRecord.
            $type = $this->effective('target_type', Banner::class, 'banner', 'shop');
            $has = fn (string $field): bool => $this->filled($field)
                || $this->effective($field, Banner::class, 'banner') !== null;

            if ($type === 'shop' && ! $has('tenant_id')) {
                $v->errors()->add('tenant_id', 'Pick the advertiser shop for a shop banner.');
            }
            if ($type === 'product' && ! $has('target_product_id')) {
                $v->errors()->add('target_product_id', 'Pick the product for a product banner.');
            }
            if ($type === 'url' && ! $has('target_url')) {
                $v->errors()->add('target_url', 'Enter the link for a URL banner.');
            }
        });
    }

    /**
     * The one message worth overriding here.
     *
     * Laravel says "The image failed to upload" for BOTH a too-large file and
     * a genuinely broken one, and neither tells somebody what to do. The size
     * is the cause almost every time, so the message names it.
     */
    public function messages(): array
    {
        return [
            'image.max' => 'That image is too large. Banners must be under 2 MB — saving it as JPG rather than PNG usually does it.',
            'image.uploaded' => 'That image is too large for the server to accept. Banners must be under 2 MB — save it as JPG rather than PNG.',
            'image.image' => 'That file is not an image. Use a JPG, PNG or WebP.',
        ];
    }
}
