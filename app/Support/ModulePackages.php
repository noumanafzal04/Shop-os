<?php

namespace App\Support;

use App\Models\Plan;
use App\Models\PlatformSetting;
use App\Models\Tenant;
use Illuminate\Support\Facades\DB;
use Tests\Unit\ModulePackagesTest;

/**
 * WHICH MODULES A SHOP IS OFFERED — by its trade, and by its plan.
 *
 * ── The question this answers ───────────────────────────────────────────
 *
 * The create-a-shop screen listed all twenty-one modules, for every trade, as
 * twenty-one switches. Somebody setting up a corner shop was asked about Fuel
 * Management and Dine-in Tables, and had to know for themselves that a small
 * shop wants three of the twenty-one: add products, print labels, ring a sale.
 *
 * Two things were missing, and they are different things:
 *
 *   WHAT THE TRADE CAN USE.   A chemist is never offered a kitchen pass.
 *   WHAT THE PLAN INCLUDES.   Basic is the small-shop set; anything past it
 *                             is an add-on, chosen shop by shop.
 *
 * ── What a plan's list is, and is not ───────────────────────────────────
 *
 * A plan carries a list of modules. It is a STARTING POINT and a LABEL:
 * it decides what is switched on when a shop is first given the plan, and it
 * decides which of a shop's modules the screens call "in the plan" and which
 * they call "an add-on".
 *
 * It is NOT the gate. What a shop may use is still `tenants.features`, written
 * only by `Tenant::applyModules()` — and that is deliberate. When plans carried
 * the module map themselves, a renewal merged the plan's over the shop's and
 * silently revoked what an admin had granted one shop; every combination
 * needed its own plan; and a trade's own modules could not sit on a plan
 * without being stripped from the trades that need them. None of that comes
 * back: nothing here is read at request time, and nothing here ever switches a
 * module off.
 *
 * ── Trade first, plan second ────────────────────────────────────────────
 *
 * A restaurant on Basic still has a kitchen pass, and a filling station still
 * has its tanks — `ESSENTIAL` is what a trade cannot open without, whatever
 * it pays. The plan's list is then cut down to what the trade can use.
 *
 * @see ModulePackagesTest
 */
final class ModulePackages
{
    /**
     * What each trade can use at all. Everything else is not offered to it.
     *
     * Generous on purpose: "can use", not "usually wants". A salon that also
     * sells shampoo is a salon with Products, and that has to stay one tick
     * away — it is the plan, not this list, that keeps a small shop small.
     *
     * @var array<string, string[]>
     */
    private const FOR_TRADE = [
        'food' => ['products', 'pos', 'documents', 'inventory', 'purchasing', 'stocktake', 'disposals', 'customers', 'promotions', 'bank_offers', 'expenses', 'images', 'marketplace', 'delivery', 'reservations', 'kitchen', 'dine_in', 'hrm'],
        'mart' => ['products', 'pos', 'documents', 'inventory', 'purchasing', 'stocktake', 'disposals', 'labels', 'customers', 'promotions', 'bank_offers', 'expenses', 'images', 'marketplace', 'delivery', 'hrm'],
        'pharmacy' => ['products', 'services', 'pos', 'documents', 'inventory', 'purchasing', 'stocktake', 'disposals', 'labels', 'customers', 'promotions', 'bank_offers', 'expenses', 'images', 'marketplace', 'delivery', 'hrm'],
        'retail' => ['products', 'services', 'pos', 'documents', 'inventory', 'purchasing', 'stocktake', 'disposals', 'labels', 'customers', 'promotions', 'bank_offers', 'expenses', 'images', 'marketplace', 'delivery', 'reservations', 'hrm'],
        'services' => ['services', 'products', 'pos', 'documents', 'inventory', 'purchasing', 'stocktake', 'customers', 'promotions', 'expenses', 'images', 'marketplace', 'reservations', 'hrm'],
        'automotive' => ['products', 'services', 'pos', 'documents', 'inventory', 'purchasing', 'stocktake', 'disposals', 'labels', 'customers', 'promotions', 'expenses', 'images', 'marketplace', 'delivery', 'hrm'],
        'petroleum' => ['products', 'services', 'pos', 'documents', 'inventory', 'purchasing', 'stocktake', 'disposals', 'customers', 'promotions', 'expenses', 'fuel', 'hrm'],
        'online' => ['products', 'pos', 'inventory', 'purchasing', 'stocktake', 'disposals', 'labels', 'customers', 'promotions', 'expenses', 'images', 'marketplace', 'delivery', 'hrm'],
        'finance' => ['expenses', 'hrm'],
    ];

    /**
     * What a trade cannot open without — on any plan.
     *
     * @var array<string, string[]>
     */
    private const ESSENTIAL = [
        'food' => ['products', 'pos', 'kitchen'],
        'mart' => ['products', 'pos'],
        'pharmacy' => ['products', 'pos', 'inventory'],
        'retail' => ['products', 'pos'],
        'services' => ['services', 'pos'],
        'automotive' => ['products', 'services', 'pos'],
        'petroleum' => ['products', 'pos', 'inventory', 'fuel'],
        'online' => ['products', 'images', 'marketplace', 'delivery'],
        'finance' => ['expenses'],
    ];

    /**
     * What each plan on the ladder includes, until an admin says otherwise.
     *
     * BASIC      the small shop: add products, print labels, ring a sale.
     * STANDARD   (`premium`) a shop that keeps its books — its customers'
     *            credit, its suppliers, its stock, its own expenses.
     * PRO        a shop that also sells past its counter: online, delivered,
     *            with offers and reservations.
     * ENTERPRISE everything its trade can use.
     *
     * Each rung holds all of the one below it; a test holds that.
     *
     * @var array<string, string[]|null> null = everything
     */
    private const LADDER = [
        'basic' => ['products', 'services', 'pos', 'labels'],
        'premium' => [
            'products', 'services', 'pos', 'labels',
            'inventory', 'purchasing', 'stocktake', 'documents',
            'customers', 'expenses', 'images', 'dine_in',
        ],
        'pro' => [
            'products', 'services', 'pos', 'labels',
            'inventory', 'purchasing', 'stocktake', 'documents',
            'customers', 'expenses', 'images', 'dine_in',
            'disposals', 'promotions', 'bank_offers', 'reservations', 'marketplace', 'delivery',
        ],
        'enterprise' => null,
    ];

    /** A plan nobody has described — a bespoke one — starts from this rung. */
    private const UNDESCRIBED = 'premium';

    /** @return string[] module keys, in catalogue order */
    public static function eligibleFor(?string $businessType): array
    {
        $trade = self::trade($businessType);

        // A trade this file has not heard of is offered everything rather than
        // nothing: the list above is a convenience, and a new trade must not
        // arrive unable to be given a single module.
        return self::inOrder(self::FOR_TRADE[$trade] ?? Modules::keys());
    }

    /** @return string[] */
    public static function essentialFor(?string $businessType): array
    {
        return self::inOrder(self::ESSENTIAL[self::trade($businessType)] ?? []);
    }

    /**
     * The modules a plan includes, whatever the trade.
     *
     * @return string[]
     */
    public static function ofPlan(?Plan $plan): array
    {
        if ($plan !== null && is_array($plan->modules)) {
            return self::inOrder($plan->modules);
        }

        $rung = $plan !== null && array_key_exists((string) $plan->code, self::LADDER)
            ? (string) $plan->code
            : self::UNDESCRIBED;

        return self::inOrder(self::LADDER[$rung] ?? Modules::keys());
    }

    /**
     * What a shop of this trade is offered on this plan.
     *
     *   included  switched on when the plan is given: the trade's essentials,
     *             and whatever of the plan's list the trade can use — with
     *             anything those depend on
     *   addons    the rest of what the trade can use
     *   other     what is not for this trade; shown to nobody by default
     *
     * @return array{included: string[], addons: string[], other: string[], modules: array<string, bool>}
     */
    public static function propose(?string $businessType, ?Plan $plan): array
    {
        $eligible = self::eligibleFor($businessType);

        $wanted = array_intersect(
            array_unique([...self::essentialFor($businessType), ...self::ofPlan($plan)]),
            $eligible,
        );

        // Through the rules a person ticking boxes goes through — `settle`, not
        // `normalize`. The plan WANTS Labels, so Labels arrives with the
        // Inventory it reads from; pruning instead would quietly drop the one
        // thing Basic exists to give a small shop. What is proposed is then
        // exactly what a save would store.
        $settled = Modules::settle([], array_fill_keys($wanted, true));
        $included = self::inOrder(array_keys(array_filter($settled)));

        return [
            'included' => $included,
            'addons' => array_values(array_diff($eligible, $included)),
            'other' => array_values(array_diff(Modules::keys(), $eligible, $included)),
            'modules' => $settled,
        ];
    }

    /**
     * How a shop's OWN modules sit against its plan: which of what it has are
     * the plan's, and which were added for this shop.
     *
     * @param  array<string, bool>  $features  the shop's module map
     * @return array{included: string[], addons: string[], missing: string[]}
     */
    public static function standing(?string $businessType, ?Plan $plan, array $features): array
    {
        $on = array_keys(array_filter(array_intersect_key($features, array_flip(Modules::keys()))));
        $plans = self::propose($businessType, $plan)['included'];

        return [
            'included' => self::inOrder(array_intersect($on, $plans)),
            'addons' => self::inOrder(array_diff($on, $plans)),
            // In the plan, and switched off for this shop.
            'missing' => self::inOrder(array_diff($plans, $on)),
        ];
    }

    /**
     * What an add-on costs a month, where the platform has put a price on it.
     *
     * @return array<string, float> module key => rupees a month; unpriced modules are absent
     */
    public static function prices(): array
    {
        $prices = PlatformSettings::get('module_addon_prices', []);

        return collect(is_array($prices) ? $prices : [])
            ->only(Modules::keys())
            ->map(fn ($price) => round((float) $price, 2))
            ->filter(fn (float $price) => $price > 0)
            ->all();
    }

    /**
     * Change what add-ons cost.
     *
     * Each price named is set; null or nought takes a module off the list
     * ("free to add" is kept as an absence, not as a zero that reads like a
     * decision); a module that is not named keeps the price it has. With
     * `$replace` the named ones ARE the list — how the first screen saved,
     * and how one screen's stale boxes came to undo another's prices.
     *
     * Read and written under a lock on the one row, and read from the row —
     * not from the settings cache, which is allowed to be five minutes old
     * and would hand a second save the first one's "before".
     *
     * @param  array<string, int|float|string|null>  $changes
     * @return array<string, float>
     */
    public static function reprice(array $changes, bool $replace = false, ?string $by = null): array
    {
        DB::transaction(function () use ($changes, $replace, $by): void {
            $row = PlatformSetting::query()->whereKey('module_addon_prices')->lockForUpdate()->first();
            $prices = ! $replace && is_array($row?->value) ? $row->value : [];

            foreach ($changes as $key => $price) {
                if ($price === null || (float) $price <= 0) {
                    unset($prices[$key]);
                } else {
                    $prices[$key] = round((float) $price, 2);
                }
            }

            PlatformSettings::put(['module_addon_prices' => $prices], $by);
        });

        // Once more now that it is committed: a reader between the write and
        // the commit would have cached the list as it was.
        PlatformSettings::reread();

        return self::prices();
    }

    /**
     * WHAT A SHOP OWES FOR ONE PERIOD — its plan, and its add-ons.
     *
     * The question this exists to answer was asked in so many words: "if a
     * shop on Basic takes an add-on, how will anybody know next time to charge
     * for it?" Nobody has to know. An add-on is not a note somebody made — it
     * is any module the shop has that its plan does not include, read off the
     * shop as it stands. Switch one on and it is on the bill; switch it off
     * and it is not. There is nothing to remember and nothing to forget.
     *
     * Its price is the platform's price for that module, unless this shop was
     * given its own (`tenants.addon_prices`) — a module thrown in free is a
     * price of nought, and is said as such rather than left off.
     *
     * An add-on is priced by the month and a plan may be paid by the year, so
     * add-ons are multiplied up to the plan's own period.
     *
     * @return array{
     *     plan: array{name: ?string, price: float, months: int},
     *     addons: array<int, array{key: string, label: string, monthly: float, listed: ?float, own_price: bool}>,
     *     addons_monthly: float, addons_total: float, total: float
     * }
     */
    public static function bill(Tenant $tenant): array
    {
        $plan = $tenant->plan;
        $months = max(1, (int) ($plan?->billing_period_months ?? 1));
        $listed = self::prices();
        $own = is_array($tenant->addon_prices) ? $tenant->addon_prices : [];
        $labels = Modules::all();

        $addons = [];
        foreach (self::standing($tenant->business_type, $plan, $tenant->features ?? [])['addons'] as $key) {
            $hasOwn = array_key_exists($key, $own) && $own[$key] !== null && $own[$key] !== '';
            $addons[] = [
                'key' => $key,
                'label' => $labels[$key]['label'] ?? $key,
                'monthly' => round($hasOwn ? max(0, (float) $own[$key]) : ($listed[$key] ?? 0.0), 2),
                'listed' => $listed[$key] ?? null,
                'own_price' => $hasOwn,
            ];
        }

        $monthly = round(array_sum(array_column($addons, 'monthly')), 2);
        $planPrice = round((float) ($plan?->price ?? 0), 2);

        return [
            'plan' => ['name' => $plan?->name, 'price' => $planPrice, 'months' => $months],
            'addons' => $addons,
            'addons_monthly' => $monthly,
            'addons_total' => round($monthly * $months, 2),
            'total' => round($planPrice + $monthly * $months, 2),
        ];
    }

    /** How many of the shops holding a module as an add-on `reach()` gives by name. */
    private const NAMED_IN_REACH = 3;

    /**
     * WHERE EACH MODULE'S ADD-ON PRICE CAN EVER BE CHARGED.
     *
     * Asked by the person who set one and saw nothing happen: "I put Rs 25,000
     * on Products and nothing changed." An add-on is a module a shop has that
     * its plan does NOT include, and Products is in every plan and is
     * something no selling trade can open without — so for a shop that sells
     * it is never an add-on, and its price is a figure nothing reads.
     *
     * The price list offered a box for every module alike and said nothing of
     * which boxes mattered. This is the answer it should have been giving:
     *
     *   plans   the active plans on which the module would be an add-on, for at
     *           least one trade that can use it.
     *   shops   how many shops have it as an add-on today — who a change to
     *           the price reaches at once.
     *   named   the first few of those shops, by name.
     *
     * NEITHER FIGURE STANDS FOR THE OTHER. `plans` empty does not mean the
     * price is charged to nobody: a shop can have a module past its plan
     * while every plan on offer includes it — a business that only keeps
     * books, given Products all the same (its trade is not in `plans`'
     * reckoning because Products is not usual for it), or a shop on a plan
     * that has since been switched off. The first answer this gave said
     * "charged to nobody" off `plans` alone, on a database where one such
     * business was being billed the Rs 25,000 every month. Only `plans`
     * empty AND `shops` nought is nobody — and when it is not, `named` says
     * who.
     *
     * Worked out from the plans as they stand, not from a list of "core"
     * modules: a plan made tomorrow without Products for a trade that can run
     * without it makes Products an add-on there, and this then says so.
     *
     * @return array<string, array{plans: list<string>, shops: int, named: list<string>}>
     */
    public static function reach(): array
    {
        $plans = Plan::query()->where('is_active', true)->orderBy('price')->orderBy('name')->get();
        $trades = array_keys(self::FOR_TRADE);

        $reach = [];
        foreach (Modules::keys() as $key) {
            $usedBy = array_values(array_filter($trades, fn (string $trade) => in_array($key, self::eligibleFor($trade), true)));

            $addOnOn = [];
            foreach ($plans as $plan) {
                foreach ($usedBy as $trade) {
                    if (! in_array($key, self::propose($trade, $plan)['included'], true)) {
                        $addOnOn[] = $plan->name;

                        break;
                    }
                }
            }

            $reach[$key] = ['plans' => $addOnOn, 'shops' => 0, 'named' => []];
        }

        // Read off the shops as they stand — the same reading their bills are.
        // A demo is on no plan and is billed nothing; a shop on no plan has
        // nothing for a module to be "past".
        Tenant::query()
            ->whereNotNull('plan_id')
            ->where('is_demo', false)
            ->with('plan')
            // By name, so the few that are named are the same few every time.
            ->orderBy('business_name')
            ->orderBy('id')
            ->get()
            ->each(function (Tenant $tenant) use (&$reach): void {
                foreach (self::standing($tenant->business_type, $tenant->plan, $tenant->features ?? [])['addons'] as $key) {
                    if (! isset($reach[$key])) {
                        continue;
                    }

                    $reach[$key]['shops']++;
                    if (count($reach[$key]['named']) < self::NAMED_IN_REACH) {
                        $reach[$key]['named'][] = (string) $tenant->business_name;
                    }
                }
            });

        return $reach;
    }

    /** Only real module keys, once each, in the catalogue's own order. */
    private static function inOrder(array $keys): array
    {
        return array_values(array_intersect(Modules::keys(), $keys));
    }

    /** `restaurant` answers as `food`, the way every other rule about a trade does. */
    private static function trade(?string $businessType): string
    {
        return $businessType === null ? '' : (BusinessTypes::primary($businessType) ?? $businessType);
    }
}
