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

    /**
     * The shape a banner is drawn at, stated once.
     *
     * `PromoCarousel` in the mobile app: card width is the screen less 32
     * points, card height is half of that. So 2:1 on every phone — the ratio
     * does not vary with the screen, which is what the form's own hint used to
     * claim.
     */
    private const RATIO = 2.0;

    /** Accepts anything a designer would call 2:1; at 4% the worst accepted
     *  crop loses 2% of one edge, which nobody can see. */
    private const RATIO_TOLERANCE = 0.04;

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

            $this->checkShape($v);
        });
    }

    /**
     * THE RATIO, CHECKED WHERE IT CAN STILL BE FIXED.
     *
     * ── The bug ──────────────────────────────────────────────────────
     *
     * The app draws a banner at exactly 2:1 — `PromoCarousel` sets the card to
     * the screen width less 32 points and the height to half of that — and
     * fills it with `resizeMode="cover"`. Cover matches the dimension that
     * needs the most magnification and lets the other overflow, so artwork
     * that is not 2:1 loses its edges: a 1200x480 file (2.5:1) is scaled to
     * the card's HEIGHT and loses about a fifth of its WIDTH, a tenth off each
     * side. Which is where a logo and a price usually sit.
     *
     * Nothing checked. `image` was validated for type and size and never for
     * shape, so an off-ratio banner uploaded, saved, published and appeared
     * cropped on every phone — and the only way to find out was to open the
     * app and look.
     *
     * Reported as exactly that: "banner cutting on mobile, not full banner
     * showing", against artwork made at 1200x480 because this form used to ask
     * for 1200x480.
     *
     * ── Why a band rather than an exact ratio ────────────────────────
     *
     * `dimensions:ratio=2/1` refuses 1200x601, which is a file nobody can see
     * the problem with and which crops by half a pixel. The band is wide
     * enough to accept anything a designer would call 2:1 and narrow enough
     * that what it accepts is invisible: at 4% the worst case loses 2% of one
     * edge.
     *
     * The message carries the ACTUAL size, because "wrong ratio" sends
     * somebody back to a file they already believe is right.
     */
    private function checkShape($v): void
    {
        $file = $this->file('image');
        if ($file === null || ! $file->isValid()) {
            return;
        }

        $size = @getimagesize($file->getPathname());
        // Not an image, or one PHP cannot read: `image` and `mimes` own that
        // refusal and have already said so in words about the file type.
        if ($size === false || (int) $size[0] <= 0 || (int) $size[1] <= 0) {
            return;
        }

        [$width, $height] = [(int) $size[0], (int) $size[1]];
        $ratio = $width / $height;

        if (abs($ratio - self::RATIO) > self::RATIO * self::RATIO_TOLERANCE) {
            $lost = $ratio > self::RATIO
                ? 'about '.self::percentLost($ratio, self::RATIO).'% off the left and right'
                : 'about '.self::percentLost(self::RATIO, $ratio).'% off the top and bottom';

            $v->errors()->add('image', sprintf(
                'That image is %dx%d (%s:1). The app draws banners at 2:1 and fills the card, so this one would lose %s. Save it at 1200x600.',
                $width, $height, self::trim($ratio), $lost,
            ));
        }
    }

    /** How much of the longer axis `cover` throws away, as a whole percent. */
    private static function percentLost(float $bigger, float $smaller): int
    {
        return (int) round((1 - $smaller / $bigger) * 100);
    }

    /** "2.5", not "2.5000000001" — the number goes in front of a person. */
    private static function trim(float $ratio): string
    {
        return rtrim(rtrim(number_format($ratio, 2, '.', ''), '0'), '.');
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
