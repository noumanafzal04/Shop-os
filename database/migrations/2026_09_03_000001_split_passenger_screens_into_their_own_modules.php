<?php

use App\Models\Tenant;
use App\Support\Modules;
use Illuminate\Database\Migrations\Migration;

/**
 * The screens a shop could not decline, given keys of their own.
 *
 * ── What was wrong ─────────────────────────────────────────────────────
 *
 * The module registry had eleven keys and the menu produced fifty-three
 * screens, so most screens arrived as PASSENGERS on a module somebody else
 * bought. Switch `inventory` on for a chemist and Disposals, Stocktake, Barcode
 * Labels, Suppliers and Purchases came with it, whether or not that chemist had
 * ever disposed of anything. Anything that could sell was handed Coupons,
 * Promotions, Bank card offers and a customer book on the same terms.
 *
 * A small takeaway café was therefore shown a warehouse's worth of screens that
 * link to nothing it does, and the clutter is itself the complaint.
 *
 * ── The one rule this migration exists to keep ─────────────────────────
 *
 * NO LIVE SHOP LOSES A SCREEN TODAY.
 *
 * A new key defaulting to `false` would take Purchases away from every shop
 * using it, on the morning of a deploy, with no admin having decided anything.
 * So each new key is backfilled from **whatever was letting that screen through
 * yesterday** — the parent module, exactly as the sidebar read it. The shop's
 * menu is byte-identical the day after this runs; what changes is that an admin
 * can now switch these off, and a NEW shop starts with only the ones its trade
 * actually uses (BusinessTypes::TOOL_DEFAULTS).
 *
 * Demo tenants are included deliberately: a demo shop that lost half its menu
 * would misrepresent the product to the person being shown it. Soft-deleted
 * ones too — a shop that comes back must come back with the menu it had.
 *
 * `Tenant::query()`, not `withoutTenancy()`: the tenant IS the scope, so it
 * carries no BelongsToTenant trait and has no such method. Reaching for it here
 * turned every one of 2,416 tests red at once, which is at least a loud way to
 * find out.
 *
 * ── The kitchen pass ────────────────────────────────────────────────────
 *
 * The sharpest case, and the one a shopkeeper named. The pass lived INSIDE
 * `feature:dine_in`, so a small café doing takeaway only had to switch on a
 * whole restaurant — tables, running tabs, settle, split-bill, waiter reports —
 * to get a slip to its kitchen. `kitchen` is its own module now and `dine_in`
 * depends on it, so every existing restaurant keeps exactly what it had while a
 * takeaway counter can have the pass alone.
 */
return new class extends Migration
{
    public function up(): void
    {
        Tenant::query()->withTrashed()->chunkById(200, function ($tenants): void {
            foreach ($tenants as $tenant) {
                $f = is_array($tenant->features) ? $tenant->features : [];

                $on = fn (string $key): bool => (bool) ($f[$key] ?? false);

                // Exactly what the sidebar asked before these keys existed.
                $stock = $on('inventory');
                $sellsAnything = $on('pos') || $on('products') || $on('services') || $on('marketplace');

                foreach ([
                    // Inventory's five passengers.
                    'purchasing' => $stock,
                    'stocktake' => $stock,
                    'disposals' => $stock,
                    'labels' => $stock,
                    // The Customers folder appeared for anything that could sell
                    // or held a catalog.
                    'customers' => $sellsAnything,
                    'promotions' => $sellsAnything,
                    'bank_offers' => $sellsAnything,
                    // Quotes & Advances sat with the till.
                    'documents' => $on('pos'),
                    // The pass was inside the dine-in room. Every restaurant
                    // that has one keeps it; nothing else gains one.
                    'kitchen' => $on('dine_in'),
                ] as $key => $wasVisible) {
                    // `??=` on purpose: if a key is somehow already recorded —
                    // a tenant created between the code deploy and this
                    // migration — the admin's own answer wins over the guess.
                    $f[$key] ??= $wasVisible;
                }

                $tenant->features = Modules::normalize($f);
                $tenant->saveQuietly();
            }
        });
    }

    /**
     * Take the keys back out.
     *
     * Down is not "switch everything off": the columns being removed are the
     * only record that an admin ever made a choice here, and a rollback that
     * left `false` values behind would look like eight deliberate decisions
     * nobody made.
     */
    public function down(): void
    {
        $keys = ['purchasing', 'stocktake', 'disposals', 'labels', 'customers', 'promotions', 'bank_offers', 'documents', 'kitchen'];

        Tenant::query()->withTrashed()->chunkById(200, function ($tenants) use ($keys): void {
            foreach ($tenants as $tenant) {
                $f = is_array($tenant->features) ? $tenant->features : [];

                foreach ($keys as $key) {
                    unset($f[$key]);
                }

                $tenant->features = $f;
                $tenant->saveQuietly();
            }
        });
    }
};
