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
}
