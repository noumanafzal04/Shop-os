<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Splits two things that were tangled together: what a shop PAYS for, and what
 * a shop IS.
 *
 * Before this, a plan carried both — a module map AND every ceiling. Three
 * consequences, all of them bad:
 *
 *  1. Every combination of modules needed its own plan. Four seeded plans were
 *     already just the 2³ combinations of POS × Expenses × Online. A fifth
 *     sellable module would have meant eight.
 *  2. Assigning a plan merged its modules over the tenant's, so a RENEWAL — a
 *     billing event — silently revoked any module an admin had granted that one
 *     shop. Nothing said so; the shop just found a screen missing one morning.
 *  3. Trade modules could not live on a plan at all. A plan whose map said
 *     `fuel: false` would strip the forecourt from a petrol pump the moment it
 *     was assigned, and a plan that said nothing left `fuel` unmanageable.
 *
 * After this:
 *
 *   plans   → price, billing period, grace, and the USAGE ceilings that scale
 *             with what a shop consumes (products, storage, orders/month).
 *   tenants → its business type, the modules it was actually given, and the
 *             size of its organisation (branches, staff, registers).
 *
 * So `tenants.limit_overrides` is renamed to `tenants.limits`: for branches,
 * staff and registers it is not an override of anything — it IS the limit,
 * assigned to that shop when it was created.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('plans', function (Blueprint $table): void {
            // Modules are assigned to a tenant, never sold in a bundle.
            $table->dropColumn(['features', 'online_shop_enabled', 'max_branches', 'max_staff', 'max_registers']);

            // A bespoke plan negotiated with one business — a chain that wanted
            // its own price and its own ceiling. It is an ordinary plan in every
            // respect; the flag exists so the standard ladder stays a ladder on
            // screen instead of filling up with one-off deals, which is how a
            // three-tier price list quietly becomes forty.
            $table->boolean('is_custom')->default(false)->after('is_active');
        });

        Schema::table('tenants', function (Blueprint $table): void {
            $table->renameColumn('limit_overrides', 'limits');
        });
    }

    public function down(): void
    {
        Schema::table('tenants', function (Blueprint $table): void {
            $table->renameColumn('limits', 'limit_overrides');
        });

        Schema::table('plans', function (Blueprint $table): void {
            $table->json('features')->nullable()->after('grace_period_days');
            $table->boolean('online_shop_enabled')->default(false)->after('billing_period_months');
            $table->unsignedSmallInteger('max_branches')->nullable();
            $table->unsignedSmallInteger('max_staff')->nullable();
            $table->unsignedSmallInteger('max_registers')->nullable();
        });
    }
};
