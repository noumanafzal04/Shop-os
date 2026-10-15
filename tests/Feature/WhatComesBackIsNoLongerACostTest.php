<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * WHAT COMES BACK IS ON THE SHELF AGAIN — NO LONGER A COST OF GOODS SOLD.
 *
 * Tester pass 1 (B11): the same day, the dashboard's profit was 5,300 below
 * the report's — the cost of the three lines that came back. The refund came
 * off the dashboard and the goods never went back into it. The two answer one
 * question and must give one figure.
 */
class WhatComesBackIsNoLongerACostTest extends TestCase
{
    use RefreshDatabase;

    public function test_after_a_return_the_dashboard_and_the_report_give_one_profit(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        $shop = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $owner = User::factory()->shopOwner($shop)->create();
        $as = function () use ($owner): static {
            $this->app['auth']->forgetGuards();

            return $this->withToken($owner->createToken('t', ['access'])->plainTextToken);
        };

        $kurta = $as()->postJson('/api/v1/products', [
            'name' => 'Lawn Kurta', 'item_type' => 'physical_product', 'price' => 2500, 'cost' => 1600, 'tax_rate' => 0, 'track_inventory' => false,
        ])->assertCreated()->json('data.id');
        $sale = $as()->postJson('/api/v1/sales', [
            'channel' => 'pos', 'items' => [['product_id' => $kurta, 'quantity' => 2]], 'payment_method' => 'cash', 'amount_paid' => 5000,
        ])->assertCreated()->json('data');
        $as()->postJson("/api/v1/sales/{$sale['id']}/returns", ['items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]]])->assertCreated();

        $today = now()->toDateString();
        $dashboard = (float) $as()->getJson('/api/v1/dashboard')->assertOk()->json('data.today.profit');
        $report = (float) $as()->getJson("/api/v1/reports/summary?period=custom&from={$today}&to={$today}")->assertOk()->json('data.totals.net_profit');

        // Sold two (5,000, cost 3,200), one back (2,500, cost 1,600): 2,500 − 1,600 = 900.
        $this->assertEquals(900, $report);
        $this->assertEquals($report, $dashboard, 'the dashboard never took the returned kurta\'s cost back');
    }
}
