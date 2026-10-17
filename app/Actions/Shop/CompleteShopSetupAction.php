<?php

namespace App\Actions\Shop;

use App\Models\Branch;
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
    public function __construct(private readonly ApplyBusinessTypeDefaultsAction $applyDefaults) {}

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

            // MAIN IS WHERE THE SHOP IS (B23). It was made the moment the
            // shop row was, before anyone said where that is, and stayed with
            // no city. Only what it lacks is filled: a Main the owner has
            // already described keeps their words.
            $main = Branch::withoutTenancy()->where('tenant_id', $tenant->id)->where('is_default', true)->first();
            if ($main !== null) {
                foreach (['city_id', 'address', 'latitude', 'longitude'] as $field) {
                    if ($main->{$field} === null && $tenant->{$field} !== null) {
                        $main->{$field} = $tenant->{$field};
                    }
                }
                $main->save();
            }

            // The currency, where the setup form asked. A business that has
            // already traded keeps the one it has — and is told why.
            $tenant->tradeIn($data['currency'] ?? null);

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
