<?php

namespace Tests\Feature;

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
}
