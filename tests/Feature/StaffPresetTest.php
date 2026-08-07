<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\Permissions;
use App\Support\StaffPresets;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * "What job does this person do?"
 *
 * Seventeen permissions is the right model and a terrible form. An owner
 * hiring their first cashier has to already know that a cashier needs
 * sales.manage and discounts.apply but must NOT have sales.void — which is
 * knowledge the software has and the owner does not. Miss discounts.apply and
 * the cashier cannot discount; tick settings.manage by accident and they can
 * change your tax rates.
 *
 * What a preset is, and the reason it is safe:
 *
 *   IT IS A STARTING POINT. It ticks boxes and is forgotten. What gets stored
 *   is the same plain permissions[] array as always — no role column, no preset
 *   id on the user, nothing downstream that can tell one was used. That is
 *   precisely why it cannot rot into a shadow role.
 *
 *   IT IS FILTERED TO THE SHOP. Offering "Waiter" to a pharmacy is noise, and
 *   noise on a permission screen is how the wrong box gets ticked.
 */
class StaffPresetTest extends TestCase
{
    use RefreshDatabase;

    private function tenantWith(array $features, string $type = 'mart'): Tenant
    {
        return Tenant::factory()->create([
            'setup_completed' => true,
            'business_type' => $type,
            'features' => $features,
        ]);
    }

    private function codes(Tenant $tenant): array
    {
        return array_column(StaffPresets::for($tenant), 'code');
    }

    // ── What a shop is offered ──────────────────────────────────────

    public function test_a_pharmacy_is_never_offered_a_waiter(): void
    {
        $codes = $this->codes($this->tenantWith(
            BusinessTypes::defaultFeatures('pharmacy'),
            'pharmacy',
        ));

        $this->assertNotContains('waiter', $codes);
        $this->assertNotContains('kitchen', $codes);
        $this->assertContains('cashier', $codes);
    }

    public function test_a_restaurant_is_offered_its_floor_jobs(): void
    {
        $codes = $this->codes($this->tenantWith(
            BusinessTypes::defaultFeatures('food'),
            'food',
        ));

        $this->assertContains('waiter', $codes);
        $this->assertContains('kitchen', $codes);
    }

    /** The trade-specific one only exists where the trade does. */
    public function test_pharmacist_is_offered_to_a_pharmacy_and_nobody_else(): void
    {
        $pharmacy = $this->tenantWith(BusinessTypes::defaultFeatures('pharmacy'), 'pharmacy');
        $mart = $this->tenantWith(BusinessTypes::defaultFeatures('mart'), 'mart');

        $this->assertContains('pharmacist', $this->codes($pharmacy));
        $this->assertNotContains('pharmacist', $this->codes($mart));
    }

    /**
     * The books-only case: a Finance Manager tenant sells nothing, so every
     * selling job is noise. It should be offered accounts and a manager, and
     * nothing that implies a counter.
     */
    public function test_a_books_only_tenant_is_offered_no_selling_jobs(): void
    {
        $codes = $this->codes($this->tenantWith(['expenses' => true]));

        $this->assertContains('accountant', $codes);
        $this->assertNotContains('cashier', $codes);
        $this->assertNotContains('waiter', $codes);
        $this->assertNotContains('online_orders', $codes);
    }

    public function test_online_jobs_appear_only_where_the_shop_sells_online(): void
    {
        $offline = $this->tenantWith(['pos' => true, 'products' => true]);
        $online = $this->tenantWith(['pos' => true, 'products' => true, 'marketplace' => true]);

        $this->assertNotContains('online_orders', $this->codes($offline));
        $this->assertContains('online_orders', $this->codes($online));
    }

    /** Every shop has someone running it, whatever it sells. */
    public function test_manager_is_offered_to_everyone(): void
    {
        $this->assertContains('manager', $this->codes($this->tenantWith(['expenses' => true])));
        $this->assertContains('manager', $this->codes($this->tenantWith(BusinessTypes::defaultFeatures('food'), 'food')));
    }

    // ── What a preset actually grants ───────────────────────────────

    /**
     * The whole reason a cashier preset exists: it draws the line an owner
     * would not know to draw. Ringing sales all day is not the same authority
     * as erasing one.
     */
    public function test_a_cashier_can_sell_but_not_void_or_refund(): void
    {
        $granted = StaffPresets::permissionsFor('cashier');

        $this->assertContains(Permissions::SALES_MANAGE, $granted);
        $this->assertContains(Permissions::DISCOUNTS_APPLY, $granted);
        $this->assertNotContains(Permissions::SALES_VOID, $granted);
        $this->assertNotContains(Permissions::SALES_REFUND, $granted);
        $this->assertNotContains(Permissions::DISCOUNTS_OVERRIDE, $granted);
    }

    public function test_a_supervisor_gets_exactly_what_a_cashier_cannot_do(): void
    {
        $granted = StaffPresets::permissionsFor('shift_supervisor');

        $this->assertContains(Permissions::SALES_VOID, $granted);
        $this->assertContains(Permissions::SALES_REFUND, $granted);
        $this->assertContains(Permissions::DISCOUNTS_OVERRIDE, $granted);
    }

    /**
     * The line between running the shop and owning it. A manager does the day
     * to day; who works here and how the shop is configured stay with the owner
     * unless deliberately ticked.
     */
    public function test_a_manager_runs_the_shop_but_does_not_own_it(): void
    {
        $granted = StaffPresets::permissionsFor('manager');

        $this->assertContains(Permissions::SALES_MANAGE, $granted);
        $this->assertContains(Permissions::EXPENSES_MANAGE, $granted);
        $this->assertContains(Permissions::REPORTS_VIEW, $granted);
        $this->assertNotContains(Permissions::STAFF_MANAGE, $granted);
        $this->assertNotContains(Permissions::SETTINGS_MANAGE, $granted);
    }

    public function test_a_stock_keeper_never_touches_the_till(): void
    {
        $granted = StaffPresets::permissionsFor('stock_keeper');

        $this->assertContains(Permissions::INVENTORY_MANAGE, $granted);
        $this->assertNotContains(Permissions::SALES_MANAGE, $granted);
    }

    public function test_accounts_can_read_the_books_and_sell_nothing(): void
    {
        $granted = StaffPresets::permissionsFor('accountant');

        $this->assertContains(Permissions::EXPENSES_MANAGE, $granted);
        $this->assertContains(Permissions::REPORTS_VIEW, $granted);
        $this->assertNotContains(Permissions::SALES_MANAGE, $granted);
        $this->assertNotContains(Permissions::INVENTORY_MANAGE, $granted);
    }

    /** Nothing may grant a permission the backend does not know about. */
    public function test_every_preset_grants_only_real_tenant_permissions(): void
    {
        $known = Permissions::tenant();

        foreach (StaffPresets::all() as $preset) {
            foreach ($preset['permissions'] as $permission) {
                $this->assertContains(
                    $permission,
                    $known,
                    "Preset {$preset['code']} grants unknown permission {$permission}",
                );
            }
        }
    }

    /** An owner's own authority is never handed out by a template. */
    public function test_no_preset_hands_out_staff_or_settings_management(): void
    {
        foreach (StaffPresets::all() as $preset) {
            $this->assertNotContains(Permissions::STAFF_MANAGE, $preset['permissions'], $preset['code']);
            $this->assertNotContains(Permissions::SETTINGS_MANAGE, $preset['permissions'], $preset['code']);
        }
    }

    public function test_an_unknown_code_grants_nothing(): void
    {
        $this->assertSame([], StaffPresets::permissionsFor('chief_executive'));
    }

    // ── The endpoint ────────────────────────────────────────────────

    public function test_the_endpoint_returns_this_shops_presets(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        $tenant = $this->tenantWith(BusinessTypes::defaultFeatures('food'), 'food');
        $owner = User::factory()->shopOwner($tenant)->create();

        $token = $owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        $data = $this->withToken($token)->getJson('/api/v1/staff/presets')
            ->assertOk()->json('data');

        $codes = array_column($data, 'code');
        $this->assertContains('waiter', $codes);
        $this->assertNotContains('pharmacist', $codes);

        // Each carries what the form needs to explain itself.
        $this->assertArrayHasKey('label', $data[0]);
        $this->assertArrayHasKey('description', $data[0]);
        $this->assertArrayHasKey('permissions', $data[0]);
    }

    public function test_the_endpoint_needs_staff_manage(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        $tenant = $this->tenantWith(BusinessTypes::defaultFeatures('mart'));
        $cashier = User::factory()->tenantStaff($tenant, ['sales.manage'])->create();

        $token = $cashier->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        $this->withToken($token)->getJson('/api/v1/staff/presets')->assertForbidden();
    }
}
