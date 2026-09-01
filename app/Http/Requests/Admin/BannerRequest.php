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
            'image' => [$creating ? 'required' : 'nullable', 'image', 'mimes:jpg,jpeg,png,webp', 'max:4096'],
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
}
