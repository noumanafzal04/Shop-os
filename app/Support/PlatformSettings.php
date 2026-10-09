<?php

namespace App\Support;

use App\Models\PlatformSetting;
use Illuminate\Support\Facades\Cache;

/**
 * The platform's own settings — the twin of `ShopSettings`, and deliberately
 * the same shape so neither has to be learned twice.
 *
 * Defaults live HERE, in code, and a row exists only where somebody changed
 * something. That means a fresh install works before anybody has opened the
 * settings screen, and improving a default improves it for every platform that
 * never touched it.
 */
class PlatformSettings
{
    private const CACHE_KEY = 'platform.settings';

    /** @return array<string, mixed> */
    public static function defaults(): array
    {
        return [
            // ── Marketplace commission ──────────────────────────────
            //
            // The share of an ONLINE order's goods that the platform keeps.
            // Zero by default and that is the honest starting point: a
            // platform that starts charging the day it is installed, without
            // anybody having chosen a number, is a platform that surprises its
            // first shop.
            //
            // A shop with `tenants.commission_rate` set overrides this; null
            // there — the normal case — follows whatever this says.
            'commission_rate' => 0.0,

            // What the percentage is taken OF.
            //
            //   goods     subtotal minus discount. The delivery fee is left
            //             out because it is not the shop's revenue — it is the
            //             rider's — and taxing it would make a shop that
            //             delivers pay more for the same basket.
            //   total     everything, delivery included.
            'commission_base' => 'goods',

            // Whether commission is charged at all. Kept apart from a rate of
            // zero so a platform can pause billing without losing the number
            // it had agreed with everybody.
            'commission_enabled' => false,

            // What an add-on costs a month — module key => rupees. A module
            // with no price here is free to add. See ModulePackages::bill().
            'module_addon_prices' => [],

            // ── How the console itself looks ────────────────────────
            //
            // The platform's own Appearance — the twin of a shop's
            // `theme_primary` / `theme_tint` / `theme_sidebar`, and the same
            // three choices. Saved once and worn by everybody who works on the
            // console, the way a shop's is worn by everybody who works there.
            //
            // The defaults ARE the house look: no colour chosen (the
            // stylesheet's own), a designed hint of it in the surfaces, and
            // the menu in the brand colour. A console nobody has dressed looks
            // exactly as it always has.
            //
            // Deliberately absent from `rules()`: those are what the
            // commission screen may save, and whoever sets a commission rate
            // is not thereby whoever repaints the console. See
            // `appearanceRules()`.
            'console_theme_primary' => null,
            'console_theme_tint' => 'subtle',
            'console_theme_sidebar' => 'primary',
        ];
    }

    /**
     * What the console's Appearance may be set to.
     *
     * A colour is six hex digits or nothing — nothing is "the house colour",
     * and it is stored as null rather than as today's house colour, so a
     * rebrand of the product reaches every console that never chose.
     *
     * @return array<string, array<int, string>>
     */
    public static function appearanceRules(): array
    {
        return [
            'console_theme_primary' => ['present', 'nullable', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'console_theme_tint' => ['required', 'in:none,subtle,strong'],
            'console_theme_sidebar' => ['required', 'in:primary,light,tinted,dark'],
        ];
    }

    /** @return array<string, array<int, string>> */
    public static function rules(): array
    {
        return [
            // 0–50%. An upper bound because a typo in this field bills every
            // shop on the platform, and 500% is not a business decision.
            'commission_rate' => ['sometimes', 'numeric', 'min:0', 'max:50'],
            'commission_base' => ['sometimes', 'in:goods,total'],
            'commission_enabled' => ['sometimes', 'boolean'],
            'module_addon_prices' => ['sometimes', 'array'],
            'module_addon_prices.*' => ['nullable', 'numeric', 'min:0', 'max:1000000'],
        ];
    }

    /** @return array<string, mixed> */
    public static function all(): array
    {
        $stored = Cache::remember(
            self::CACHE_KEY,
            300,
            fn () => PlatformSetting::query()->pluck('value', 'key')->all(),
        );

        return array_merge(self::defaults(), $stored);
    }

    public static function get(string $key, mixed $fallback = null): mixed
    {
        return self::all()[$key] ?? $fallback ?? self::defaults()[$key] ?? null;
    }

    /**
     * Write the ones that were sent, leave the rest alone.
     *
     * A PATCH, not a PUT: a settings screen that saves every key it rendered
     * overwrites whatever a second admin changed while the first had the form
     * open.
     *
     * @param  array<string, mixed>  $values
     */
    public static function put(array $values, ?string $userId = null): void
    {
        foreach ($values as $key => $value) {
            if (! array_key_exists($key, self::defaults())) {
                continue;
            }
            PlatformSetting::query()->updateOrCreate(
                ['key' => $key],
                ['value' => $value, 'updated_by' => $userId],
            );
        }

        Cache::forget(self::CACHE_KEY);
    }

    /**
     * Hand a setting back to its default.
     *
     * By removing its row, not by writing the default into it. A row means
     * somebody CHANGED something; a row holding yesterday's default is a
     * setting that will not follow tomorrow's — and for the one setting whose
     * default is "nothing chosen", there is no value to write at all.
     *
     * @param  array<int, string>  $keys
     */
    public static function forget(array $keys): void
    {
        PlatformSetting::query()->whereIn('key', array_intersect($keys, array_keys(self::defaults())))->delete();

        Cache::forget(self::CACHE_KEY);
    }
}
