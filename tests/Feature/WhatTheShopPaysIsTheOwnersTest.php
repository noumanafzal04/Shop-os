<?php

namespace Tests\Feature;

use App\Models\Plan;
use App\Models\Tenant;
use App\Models\User;
use App\Support\StaffPresets;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * WHAT THE SHOP PAYS THE PLATFORM IS THE OWNER'S.
 *
 * Tester pass 2 (Q7): the Subscription screen — the plan's price, every
 * payment to the platform and its bank reference — was in every menu, the
 * kitchen's included, and GET /shop/subscription answered anyone in the shop.
 * It was deliberate ("not a secret from the people who work in it"); the
 * owner decided otherwise (2026-10-14). Whoever holds the shop's settings.
 */
class WhatTheShopPaysIsTheOwnersTest extends TestCase
{
    use RefreshDatabase;

    public function test_only_whoever_holds_the_shops_settings_reads_it(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        $shop = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $owner = User::factory()->shopOwner($shop)->create();

        $this->withToken($owner->createToken('t', ['access'])->plainTextToken)
            ->getJson('/api/v1/shop/subscription')->assertOk();

        foreach (['kitchen', 'cashier', 'manager'] as $code) {
            $staff = User::factory()->create([
                'tenant_id' => $shop->id, 'role' => 'staff',
                'permissions' => collect(StaffPresets::all())->firstWhere('code', $code)['permissions'],
            ]);
            $this->app['auth']->forgetGuards();
            $this->withToken($staff->createToken('t', ['access'])->plainTextToken)
                ->getJson('/api/v1/shop/subscription')->assertForbidden();
        }
    }

    public function test_the_plan_price_and_the_bill_are_not_sent_to_staff_about_their_own_shop(): void
    {
        // Tester pass 4 (B55): the screen was shut, and the figures still
        // reached every staff member in /auth/me and /shop.
        $this->withoutMiddleware(ThrottleRequests::class);
        $plan = Plan::query()->create(['name' => 'Standard', 'code' => 'standard-'.uniqid(), 'price' => 6500, 'billing_period' => 'monthly', 'is_active' => true]);
        $shop = Tenant::factory()->provisioned()->create(['setup_completed' => true, 'plan_id' => $plan->id]);
        $owner = User::factory()->shopOwner($shop)->create();
        $kitchen = User::factory()->create([
            'tenant_id' => $shop->id, 'role' => 'staff',
            'permissions' => collect(StaffPresets::all())->firstWhere('code', 'kitchen')['permissions'],
        ]);

        foreach (['/api/v1/auth/me' => 'data.tenant', '/api/v1/shop' => 'data'] as $url => $at) {
            $this->app['auth']->forgetGuards();
            $mine = $this->withToken($owner->createToken('t', ['access'])->plainTextToken)->getJson($url)->assertOk();
            $this->assertNotNull($mine->json("{$at}.plan.price"), "{$url}: the owner is not sent the plan price");
            $this->assertNotNull($mine->json("{$at}.package.bill"), "{$url}: the owner is not sent the bill");

            $this->app['auth']->forgetGuards();
            $theirs = $this->withToken($kitchen->createToken('t', ['access'])->plainTextToken)->getJson($url)->assertOk();
            $this->assertNotNull($theirs->json("{$at}.plan.name"), "{$url}: the plan's name went too");
            $this->assertArrayNotHasKey('price', $theirs->json("{$at}.plan"), "{$url}: the kitchen is sent the plan price");
            $this->assertArrayNotHasKey('package', $theirs->json($at), "{$url}: the kitchen is sent the bill");
            // The banner still knows where the subscription stands.
            $this->assertNotNull($theirs->json("{$at}.subscription_state"), "{$url}: the banner lost its state");
        }
    }

    public function test_the_platform_still_reads_every_figure_of_the_shop(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        $plan = Plan::query()->create(['name' => 'Standard', 'code' => 'standard-'.uniqid(), 'price' => 6500, 'billing_period' => 'monthly', 'is_active' => true]);
        $shop = Tenant::factory()->provisioned()->create(['setup_completed' => true, 'plan_id' => $plan->id]);
        $admin = User::factory()->superAdmin()->create();

        $seen = $this->withToken($admin->createToken('t', ['access'])->plainTextToken)
            ->getJson("/api/v1/admin/tenants/{$shop->id}")->assertOk();
        $this->assertEquals(6500, $seen->json('data.plan.price'));
        $this->assertNotNull($seen->json('data.package.bill'));
    }
}
