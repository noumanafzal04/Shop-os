<?php

namespace App\Actions\Tenant;

use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\Plan;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Creates a tenant together with its owner account — atomically. A tenant
 * without an owner (or an owner without a tenant) can never exist.
 */
class CreateTenantAction
{
    public function __construct(
        private readonly AssignPlanAction $assignPlan,
        private readonly \App\Actions\Shop\ApplyBusinessTypeDefaultsAction $applyDefaults,
    ) {
    }

    public function execute(array $data): Tenant
    {
        return DB::transaction(function () use ($data): Tenant {
            $tenant = Tenant::query()->create([
                'business_name' => $data['business_name'],
                'slug' => $this->uniqueSlug($data['business_name']),
                'email' => $data['email'] ?? null,
                'phone' => $data['phone'] ?? null,
                'business_category' => $data['business_category'] ?? null,
                'city_id' => $data['city_id'] ?? null,
            ]);

            // The admin picks the type at creation — seed its features and
            // default categories now so the owner's first login is ready to go
            // (they only add basic info at setup, never the type).
            if (! empty($data['business_type'])) {
                $this->applyDefaults->execute($tenant, $data['business_type']);
            }

            User::query()->create([
                'tenant_id' => $tenant->id,
                'name' => $data['owner']['name'],
                'email' => $data['owner']['email'] ?? null,
                'phone' => $data['owner']['phone'] ?? null,
                'password' => $data['owner']['password'],
                'role' => UserRole::ShopOwner,
                'status' => UserStatus::Active,
            ]);

            if (isset($data['plan_id'])) {
                $this->assignPlan->execute($tenant, Plan::query()->findOrFail($data['plan_id']));
            }

            return $tenant->refresh()->load('city', 'plan', 'users');
        });
    }

    private function uniqueSlug(string $businessName): string
    {
        $base = Str::slug($businessName);
        $slug = $base;

        // Soft-deleted tenants keep their slug — check against ALL rows.
        while (Tenant::withTrashed()->where('slug', $slug)->exists()) {
            $slug = $base.'-'.Str::lower(Str::random(4));
        }

        return $slug;
    }
}
