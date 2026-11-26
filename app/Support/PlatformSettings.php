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

            // ── What a delivery costs, and the rules around an order ──
            //
            // The market's rules, set once by the admin for every shop that
            // has not set its own. Each is OFF (null / zero) until somebody
            // chooses a number, for the same reason commission is: a platform
            // that starts charging customers on install surprises everybody.
            //
            // The least a delivery basket may be, for a shop that set none of
            // its own. "agr koi 20 rs ka order kry ga to hum delivery thori
            // dene jayen gy." Null = no platform minimum.
            'default_min_order' => null,
            // Below the minimum: `fee` lets the customer order anyway and pay
            // the difference as a small-order fee (foodpanda's way); `refuse`
            // turns the basket away. A shop may choose for itself.
            'below_minimum' => 'fee',
            // Rupees for each kilometre past `delivery_fee_base_km`, on top of
            // the shop's flat delivery fee — for shops that set none of their
            // own. Null = the flat fee only, however far.
            'delivery_fee_per_km' => null,
            'delivery_fee_base_km' => 3,
            // The platform's own charge on every online order. Zero = none.
            'service_fee' => 0,
            // RAIN OR A RUSH: switched on by the admin, added to every
            // delivery fee while on, and the rider's when the rider keeps
            // the fee — it is the rider who is out in it.
            'rush_fee' => 0,
            'rush_fee_on' => false,
            // An online order nobody at the shop has accepted after this many
            // minutes is cancelled, and the customer told. 0 = never.
            'accept_within_minutes' => 10,
            // A pool rider holding this much cash is offered no more
            // cash-on-delivery jobs until they hand it in. Null = no limit.
            'rider_cash_limit' => null,
        ];
    }

    /**
     * What the "Delivery & fees" screen may save — its own list, as the
     * console's look has its own: whoever prices a delivery is not thereby
     * whoever sets the commission.
     *
     * @return array<string, array<int, string>>
     */
    public static function deliveryRules(): array
    {
        return [
            'default_min_order' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:100000'],
            'below_minimum' => ['sometimes', 'in:fee,refuse'],
            'delivery_fee_per_km' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:10000'],
            'delivery_fee_base_km' => ['sometimes', 'numeric', 'min:0', 'max:100'],
            'service_fee' => ['sometimes', 'numeric', 'min:0', 'max:10000'],
            'rush_fee' => ['sometimes', 'numeric', 'min:0', 'max:10000'],
            'rush_fee_on' => ['sometimes', 'boolean'],
            // 0 = never cancel; otherwise at least two minutes to answer.
            'accept_within_minutes' => ['sometimes', 'integer', 'min:0', 'max:120', 'not_in:1'],
            'rider_cash_limit' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:10000000'],
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
            // Cleared = back to the default. The column holds no null, and
            // a row means somebody chose something (see `forget`).
            if ($value === null) {
                PlatformSetting::query()->where('key', $key)->delete();

                continue;
            }
            PlatformSetting::query()->updateOrCreate(
                ['key' => $key],
                ['value' => $value, 'updated_by' => $userId],
            );
        }

        Cache::forget(self::CACHE_KEY);
    }

    /** Have the next read come from the table, not from what was remembered. */
    public static function reread(): void
    {
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
        // One at a time, through the model: a delete written as a query files
        // nothing in the trail, and "the console went back to the house
        // colour" is a decision somebody made.
        PlatformSetting::query()
            ->whereIn('key', array_intersect($keys, array_keys(self::defaults())))
            ->get()
            ->each(fn (PlatformSetting $setting) => $setting->delete());

        Cache::forget(self::CACHE_KEY);
    }
}
