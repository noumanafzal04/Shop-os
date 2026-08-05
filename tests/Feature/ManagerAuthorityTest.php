<?php

namespace Tests\Feature;

use App\Models\Coupon;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Manager authority at the counter.
 *
 * Everything here was governed by a single `sales.manage` grant, which meant a
 * cashier hired last week could:
 *   - void a completed sale (restoring stock and reversing the money),
 *   - hand out a refund,
 *   - and key an unlimited whole-bill discount — the permission model inspected
 *     only per-LINE discounts, so Rs 5,000 off a Rs 5,200 bill passed straight
 *     through the one check that looked like it governed discounts.
 *
 * The controls added here are the difference between a POS you can hand to a
 * stranger and one you can't.
 */
class ManagerAuthorityTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    /** Rings sales. Nothing else. */
    private User $cashier;

    /** May discount, but not past the shop's ceiling. */
    private User $senior;

    /** May go past the ceiling, void and refund. */
    private User $manager;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->provisioned()->create([
            'setup_completed' => true,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->cashier = User::factory()->tenantStaff($this->tenant, ['sales.manage'])->create(['name' => 'Ayesha']);
        $this->senior = User::factory()->tenantStaff($this->tenant, ['sales.manage', 'discounts.apply'])->create(['name' => 'Bilal']);
        $this->manager = User::factory()->tenantStaff($this->tenant, [
            'sales.manage', 'discounts.apply', 'discounts.override', 'sales.void', 'sales.refund',
        ])->create(['name' => 'Faisal']);

        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Rice 5kg', 'sku' => 'RICE-5', 'price' => 1000, 'cost' => 800,
            'stock_quantity' => 500, 'track_inventory' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function setLimits(?float $pct = null, ?float $amt = null): void
    {
        $this->actingAsUser($this->owner)->putJson('/api/v1/shop/settings', [
            'max_discount_percent' => $pct,
            'max_discount_amount' => $amt,
        ])->assertOk();
    }

    /** @param  array<string, mixed>  $extra */
    private function ring(User $user, array $extra = [], int $qty = 1): \Illuminate\Testing\TestResponse
    {
        return $this->actingAsUser($user)->postJson('/api/v1/sales', array_merge([
            'channel' => 'pos',
            'payment_method' => 'cash',
            'items' => [['product_id' => $this->product->id, 'quantity' => $qty]],
            'amount_paid' => 1000 * $qty,
        ], $extra));
    }

    // ── Voiding ─────────────────────────────────────────────────────

    /** A void restores stock and reverses money. That is not a cashier's call. */
    public function test_a_cashier_cannot_void_a_completed_sale(): void
    {
        $sale = $this->ring($this->cashier)->assertCreated()->json('data');

        $this->actingAsUser($this->cashier)
            ->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason_code' => 'wrong_item'])
            ->assertStatus(403)->assertJsonPath('meta.error_code', 'PERMISSION_DENIED');

        $this->assertSame('completed', Sale::withoutTenancy()->find($sale['id'])->status->value);
    }

    public function test_a_manager_can_void_and_the_reason_is_recorded(): void
    {
        $sale = $this->ring($this->cashier)->assertCreated()->json('data');

        $this->actingAsUser($this->manager)
            ->postJson("/api/v1/sales/{$sale['id']}/cancel", [
                'reason_code' => 'price_error', 'reason' => 'Shelf label was stale',
            ])->assertOk();

        $row = Sale::withoutTenancy()->find($sale['id']);
        $this->assertSame('cancelled', $row->status->value);
        // The code is what makes voids countable per cashier; the note carries detail.
        $this->assertSame('price_error', $row->cancel_reason_code);
        $this->assertStringContainsString('Price error', $row->cancel_reason);
        $this->assertStringContainsString('Shelf label was stale', $row->cancel_reason);
        $this->assertSame($this->manager->id, $row->cancelled_by);
    }

    /** Free text alone was unreviewable — a manager can't tally prose. */
    public function test_a_void_needs_a_reason_code(): void
    {
        $sale = $this->ring($this->cashier)->assertCreated()->json('data');

        $this->actingAsUser($this->manager)->postJson("/api/v1/sales/{$sale['id']}/cancel", [
            'reason' => 'just because',
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['reason_code']]);
    }

    public function test_an_unknown_reason_code_is_refused(): void
    {
        $sale = $this->ring($this->cashier)->assertCreated()->json('data');

        $this->actingAsUser($this->manager)->postJson("/api/v1/sales/{$sale['id']}/cancel", [
            'reason_code' => 'boss_said_so',
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['reason_code']]);
    }

    public function test_the_owner_can_always_void(): void
    {
        $sale = $this->ring($this->cashier)->assertCreated()->json('data');

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason_code' => 'duplicate'])
            ->assertOk();
    }

    // ── Refunding ───────────────────────────────────────────────────

    public function test_a_cashier_cannot_hand_back_a_refund(): void
    {
        $sale = $this->ring($this->cashier, [], 2)->assertCreated()->json('data');

        $this->actingAsUser($this->cashier)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'refund_method' => 'cash',
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
        ])->assertStatus(403)->assertJsonPath('meta.error_code', 'PERMISSION_DENIED');
    }

    public function test_a_manager_can_hand_back_a_refund(): void
    {
        $sale = $this->ring($this->cashier, [], 2)->assertCreated()->json('data');

        $this->actingAsUser($this->manager)->postJson("/api/v1/sales/{$sale['id']}/returns", [
            'refund_method' => 'cash',
            'items' => [['sale_item_id' => $sale['items'][0]['id'], 'quantity' => 1]],
        ])->assertCreated();
    }

    // ── Discounts: the gap that let a whole bill through ────────────

    /**
     * THE bug. authorize() inspected only items.*.line_discount, so the
     * top-level `discount` — the whole-bill field the POS actually uses — was
     * ungated. A cashier could zero out a bill.
     */
    public function test_a_cashier_cannot_key_a_whole_bill_discount(): void
    {
        $this->ring($this->cashier, ['discount' => 900, 'amount_paid' => 100])
            ->assertStatus(403);
    }

    public function test_a_cashier_cannot_key_a_line_discount(): void
    {
        $this->actingAsUser($this->cashier)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1, 'line_discount' => 200]],
            'amount_paid' => 800,
        ])->assertStatus(403);
    }

    public function test_discounts_apply_lets_a_senior_cashier_discount(): void
    {
        $this->ring($this->senior, ['discount' => 100, 'amount_paid' => 900])
            ->assertCreated()->assertJsonPath('data.discount', '100.00');
    }

    // ── The ceiling ─────────────────────────────────────────────────

    /** No ceiling configured is the shipped default — nobody is capped by surprise. */
    public function test_with_no_ceiling_any_discount_is_allowed(): void
    {
        $this->ring($this->senior, ['discount' => 950, 'amount_paid' => 50])->assertCreated();
    }

    public function test_a_discount_over_the_percent_ceiling_needs_a_manager(): void
    {
        $this->setLimits(pct: 10);

        // 20% off a 1000 bill, with discounts.apply but no override.
        $this->ring($this->senior, ['discount' => 200, 'amount_paid' => 800])
            ->assertStatus(403)
            ->assertJsonPath('meta.error_code', 'DISCOUNT_LIMIT_EXCEEDED');

        // Inside the ceiling is fine.
        $this->ring($this->senior, ['discount' => 100, 'amount_paid' => 900])->assertCreated();

        // The manager may go past it.
        $this->ring($this->manager, ['discount' => 200, 'amount_paid' => 800])->assertCreated();
    }

    public function test_a_discount_over_the_amount_ceiling_needs_a_manager(): void
    {
        $this->setLimits(amt: 150);

        $this->ring($this->senior, ['discount' => 200, 'amount_paid' => 800])
            ->assertStatus(403)->assertJsonPath('meta.error_code', 'DISCOUNT_LIMIT_EXCEEDED');

        $this->ring($this->manager, ['discount' => 200, 'amount_paid' => 800])->assertCreated();
    }

    /** Hand-keyed LINE discounts count toward the same ceiling. */
    public function test_line_discounts_count_toward_the_ceiling(): void
    {
        $this->setLimits(pct: 10);

        $this->actingAsUser($this->senior)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1, 'line_discount' => 300]],
            'amount_paid' => 700,
        ])->assertStatus(403)->assertJsonPath('meta.error_code', 'DISCOUNT_LIMIT_EXCEEDED');
    }

    /** A line discount plus a cart discount is judged TOGETHER, not each alone. */
    public function test_the_ceiling_sees_the_combined_discretionary_discount(): void
    {
        $this->setLimits(pct: 20);

        // 15% on the line + 10% on the cart = 25% of a 1000 bill.
        $this->actingAsUser($this->senior)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1, 'line_discount' => 150]],
            'discount' => 100,
            'amount_paid' => 750,
        ])->assertStatus(403)->assertJsonPath('meta.error_code', 'DISCOUNT_LIMIT_EXCEEDED');
    }

    /**
     * A coupon is a rule the OWNER configured, not a judgement call at the
     * counter — capping it would mean the shop's own promotion stops working at
     * the till, which is not what a discount ceiling is for.
     */
    public function test_a_coupon_bigger_than_the_ceiling_still_applies(): void
    {
        $this->setLimits(pct: 5);

        Coupon::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'code' => 'HALFOFF', 'type' => 'percent',
            'value' => 50, 'is_active' => true,
        ]);

        $this->ring($this->cashier, ['coupon_code' => 'HALFOFF', 'amount_paid' => 500])
            ->assertCreated()
            ->assertJsonPath('data.discount', '500.00');
    }

    public function test_the_owner_is_never_capped(): void
    {
        $this->setLimits(pct: 5, amt: 50);

        $this->ring($this->owner, ['discount' => 900, 'amount_paid' => 100])->assertCreated();
    }

    /** The ceiling is opt-in, and clearing it puts the shop back to no limit. */
    public function test_clearing_the_ceiling_removes_the_cap(): void
    {
        $this->setLimits(pct: 10);
        $this->ring($this->senior, ['discount' => 500, 'amount_paid' => 500])->assertStatus(403);

        $this->setLimits(null, null);
        $this->ring($this->senior, ['discount' => 500, 'amount_paid' => 500])->assertCreated();
    }

    public function test_the_ceiling_settings_are_validated(): void
    {
        $this->actingAsUser($this->owner)->putJson('/api/v1/shop/settings', [
            'max_discount_percent' => 150,
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['max_discount_percent']]);

        $this->actingAsUser($this->owner)->putJson('/api/v1/shop/settings', [
            'max_discount_amount' => -5,
        ])->assertStatus(422)->assertJsonStructure(['errors' => ['max_discount_amount']]);
    }

    /** The new permissions are grantable — they must appear in the registry. */
    public function test_the_new_permissions_are_in_the_tenant_registry(): void
    {
        $registry = \App\Support\Permissions::tenant();

        foreach (['sales.void', 'sales.refund', 'discounts.override'] as $p) {
            $this->assertContains($p, $registry, "{$p} must be grantable to staff.");
        }
    }
}
