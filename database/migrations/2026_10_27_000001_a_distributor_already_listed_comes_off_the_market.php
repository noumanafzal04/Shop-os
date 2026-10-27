<?php

use App\Models\Tenant;
use App\Support\BusinessTypes;
use Illuminate\Database\Migrations\Migration;

/**
 * Wholesale #W1, the shops already made.
 *
 * The plan used to switch the marketplace and delivery on for a distributor,
 * and its dealer price breaks were then readable with no login. New shops are
 * no longer given them (ModulePackages::OPT_IN); the re-test found the shops
 * made BEFORE that still listed. Nothing records whether a person or the plan
 * switched them on, and the trade's own template has always said off — so
 * every wholesale shop comes off the market here. An admin can tick it back
 * on for one that really sells online; the price breaks stay private either
 * way (MarketplaceController::isDistributor).
 */
return new class extends Migration
{
    public function up(): void
    {
        Tenant::withoutGlobalScopes()
            ->whereNotNull('business_type')
            ->orderBy('id')
            ->each(function (Tenant $tenant): void {
                if (BusinessTypes::primary((string) $tenant->business_type) !== 'wholesale') {
                    return;
                }

                $features = $tenant->features ?? [];
                if (! ($features['marketplace'] ?? false) && ! ($features['delivery'] ?? false) && ! $tenant->online_shop_enabled) {
                    return;
                }

                $tenant->applyModules(['marketplace' => false, 'delivery' => false]);
            });
    }

    public function down(): void
    {
        // Not put back: listing a distributor's dealer rates is the fault.
    }
};
