<?php

namespace App\Actions\Shop;

use App\Models\Tenant;
use Illuminate\Support\Facades\DB;

/**
 * Shop onboarding. Required: business TYPE (drives the whole experience),
 * category, city. Optional: address, coordinates, business hours.
 * Completing setup applies the business-type template (default categories,
 * expense categories, feature flags). Frontends gate on setup_completed —
 * a skipped setup always redirects back here.
 */
class CompleteShopSetupAction
{
    public function __construct(private readonly ApplyBusinessTypeDefaultsAction $applyDefaults)
    {
    }

    public function execute(Tenant $tenant, array $data): Tenant
    {
        return DB::transaction(function () use ($tenant, $data): Tenant {
            $tenant->fill([
                'business_name' => $data['business_name'] ?? $tenant->business_name,
                'business_category' => $data['business_category'] ?? $tenant->business_category,
                'city_id' => $data['city_id'],
                'address' => $data['address'] ?? $tenant->address,
                'latitude' => $data['latitude'] ?? $tenant->latitude,
                'longitude' => $data['longitude'] ?? $tenant->longitude,
                'business_hours' => $data['business_hours'] ?? $tenant->business_hours,
            ]);

            $tenant->setup_completed = true;
            $tenant->save();

            // The type is set by the admin at creation (already seeded there).
            // Re-apply here for legacy tenants that predate that — idempotent,
            // so it never duplicates categories or overwrites the owner's edits.
            if (! empty($tenant->business_type)) {
                $this->applyDefaults->execute($tenant, $tenant->business_type);
            }

            return $tenant->refresh()->load('city', 'plan');
        });
    }
}
