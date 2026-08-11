<?php

namespace App\Actions\Tenant;

use App\Actions\Shop\ApplyBusinessTypeDefaultsAction;
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
 *
 * A shop is defined in three layers, each one overriding the last:
 *
 *   1. BUSINESS TYPE proposes the modules a trade of that kind needs, and
 *      seeds its product / expense / income categories.
 *   2. The PLAN sets what it pays and how much it may hold.
 *   3. The ADMIN's own choices — the modules actually given and the branches,
 *      staff and lanes assigned to this shop — win over both.
 *
 * The order is the point. Before this, a shop could be created with no plan and
 * no explicit modules, which left it in a state nobody had decided: unlimited
 * on every metered resource and running whatever its type happened to default
 * to. Now every tenant leaves this action fully specified.
 */
class CreateTenantAction
{
    public function __construct(
        private readonly AssignPlanAction $assignPlan,
        private readonly ApplyBusinessTypeDefaultsAction $applyDefaults,
    ) {}

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

            // ① The type: features proposed, categories and terminology seeded.
            // The owner never picks this — the admin does, once.
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

            // ② The plan: price, period, and the usage ceilings it baselines.
            // The window and the opening payment ride along, because the
            // moment a shop is created is the only chance to state its real
            // renewal date — every later period stacks onto this one.
            if (! empty($data['plan_id'])) {
                $this->assignPlan->execute(
                    $tenant,
                    Plan::query()->findOrFail($data['plan_id']),
                    $data['payment'] ?? null,
                    $data['period'] ?? null,
                );
            }

            // ③ The admin's own decisions, last, so they win over both.
            if (isset($data['modules'])) {
                $tenant->applyModules($data['modules']);
            }

            if (! empty($data['limits'])) {
                $tenant->assignLimits($data['limits']);
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
