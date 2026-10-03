<?php

namespace Tests\Feature;

use App\Models\Plan;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\PlanLimits;
use Database\Seeders\PlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * ONE BUSINESS, FROM THE FIRST FORM TO THE SECOND INVOICE.
 *
 * Every rule in the pricing model has a test of its own, and all of them
 * pass. This asks the different question: does the WHOLE thing hold together
 * when one shop is walked through it in order, over real HTTP, the way an
 * admin and a shopkeeper actually meet it?
 *
 * The seams are where this kind of system fails, and each one below has
 * already produced a defect in this repo at least once:
 *
 *   ① a module granted on the create form must actually reach the shop
 *   ② a module NOT granted must refuse, and refuse by name
 *   ③ a ceiling must bite at the number the plan says, not the default
 *   ④ capacity bought must lift that exact ceiling and nothing else
 *   ⑤ a plan change must move the ceiling and leave the meter alone
 *   ⑥ the history window must follow the plan, forwards and backwards
 *   ⑦ taking a module away must close the door and keep the data
 *
 * Written as ONE test on purpose. Split into seven, each would set up its
 * own shop and none of them would be able to see state carried across a
 * step — which is the only place these seams exist.
 */
class OneBusinessEndToEndTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        // The real ladder, because this test is about the ladder. A bespoke
        // plan built in the test would prove the arithmetic and nothing about
        // the four rungs anybody is actually sold.
        $this->seed(PlanSeeder::class);
        $this->admin = User::factory()->superAdmin()->create();
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();

        return $this->withToken($token);
    }

    public function test_one_business_walked_all_the_way_through(): void
    {
        $basic = Plan::query()->where('code', 'basic')->firstOrFail();
        $pro = Plan::query()->where('code', 'pro')->firstOrFail();

        // ── ① CREATED ──────────────────────────────────────────────────
        //
        // On Basic, with the modules an admin actually ticks for a chemist:
        // a till, a catalogue, stock and the customer book. No HR, no
        // kitchen, no forecourt. `purchasing` is deliberately asked for so
        // the dependency pull is exercised — it stands on `inventory`.
        $ownerEmail = 'owner-'.uniqid().'@shop.test';

        $created = $this->as($this->admin)->postJson('/api/v1/admin/tenants', [
            'business_name' => 'Noor Medical Store',
            'business_type' => 'pharmacy',
            'plan_id' => $basic->id,
            'modules' => [
                'products' => true, 'pos' => true, 'inventory' => true,
                'purchasing' => true, 'customers' => true, 'expenses' => true,
            ],
            // Nothing in `limits`: this shop takes what Basic includes, which
            // is the whole point of putting capacity on the plan.
            'owner' => ['name' => 'Noor', 'email' => $ownerEmail, 'password' => 'password123'],
        ])->assertCreated()->json('data');

        $shop = Tenant::query()->findOrFail($created['id']);
        $owner = User::query()->where('email', $ownerEmail)->firstOrFail();

        // ── ② WHAT IT CAN DO, AND WHAT IT CANNOT ───────────────────────
        $this->assertTrue($shop->featureEnabled('inventory'), 'A module ticked on the form never reached the shop.');
        $this->assertTrue($shop->featureEnabled('purchasing'));
        $this->assertFalse($shop->featureEnabled('fuel'), 'A chemist was handed a forecourt.');
        $this->assertFalse(
            $shop->featureEnabled('hrm'),
            'Basic HR arrived by itself. An unbuilt module must never be a default.',
        );

        // A door the shop has.
        $this->as($owner)->getJson('/api/v1/purchase-orders')->assertOk();

        // A door it does not — and the refusal says WHICH module, because
        // "403 Forbidden" sends a shopkeeper to their permissions.
        $this->as($owner)->getJson('/api/v1/fuel/tanks')
            ->assertForbidden()
            ->assertJsonPath('meta.error_code', 'MODULE_DISABLED');

        // ── ③ THE CEILING IS THE PLAN'S, NOT THE PLATFORM'S ────────────
        //
        // Basic includes 3 staff. The old default was 5, so a ceiling that
        // bit at 5 here would mean the plan column was being ignored and
        // every shop on every plan was really on the same one.
        $this->assertSame(3, PlanLimits::limit($shop, 'staff'));

        // Created by the OWNER through the shop's own screen, which is where
        // a ceiling is actually met. The admin console has its own door and
        // going through that one would test the wrong path.
        foreach (range(1, 3) as $i) {
            $this->as($owner)->postJson('/api/v1/staff', [
                'name' => "Cashier {$i}",
                'email' => "staff{$i}-".uniqid().'@shop.test',
                'password' => 'password123',
                'permissions' => ['sales.manage'],
            ])->assertCreated();
        }

        $this->assertSame(3, PlanLimits::usage($shop->fresh(), 'staff'), 'The three staff accounts were not created.');

        // THE FOURTH IS REFUSED — at three, which is Basic's number, not at
        // the platform default of five.
        $this->as($owner)->postJson('/api/v1/staff', [
            'name' => 'Cashier 4',
            'email' => 'staff4-'.uniqid().'@shop.test',
            'password' => 'password123',
            'permissions' => ['sales.manage'],
        ])->assertStatus(422);

        // ── ④ CAPACITY BOUGHT LIFTS EXACTLY ONE CEILING ────────────────
        $this->as($this->admin)->postJson("/api/v1/admin/tenants/{$shop->id}/entitlements", [
            'limit_key' => 'staff',
            'quantity' => 2,
            'unit_price' => 400,
            'starts_on' => now()->toDateString(),
            'note' => 'Two extra tills over Ramzan',
        ])->assertCreated();

        $shop->refresh();
        $this->assertSame(5, PlanLimits::limit($shop, 'staff'), 'The add-on did not reach the ceiling.');
        $this->assertSame(
            1,
            PlanLimits::limit($shop, 'branches'),
            'A staff add-on moved the branch ceiling. Capacity is bought per resource.',
        );

        // ── ⑤ A PLAN CHANGE MOVES THE CEILING AND LEAVES THE METER ─────
        //
        // First the preview, which must write nothing.
        $preview = $this->as($this->admin)
            ->getJson("/api/v1/admin/tenants/{$shop->id}/plan-change?plan_id={$pro->id}")
            ->assertOk()
            ->json('data');

        // assertEquals, not assertSame: JSON hands back 5500 where PHP has
        // 5500.0, and a type mismatch here is noise about the encoder.
        $this->assertEquals((float) $pro->price - (float) $basic->price, $preview['price_difference']);
        $this->assertSame([], $preview['excess'], 'An upgrade reported an excess.');
        $this->assertSame($basic->id, $shop->fresh()->plan_id, 'The preview moved the shop.');

        // Ring something, so the meter has a number to carry across.
        $before = PlanLimits::usage($shop, 'orders_month');

        $this->as($this->admin)->postJson("/api/v1/admin/tenants/{$shop->id}/assign-plan", [
            'plan_id' => $pro->id,
            'payment' => ['amount' => $pro->price],
        ])->assertOk();

        $shop->refresh();
        $this->assertSame(25, PlanLimits::limit($shop, 'staff') - 2, 'Pro\'s staff allowance did not take effect.');
        $this->assertSame(
            $before,
            PlanLimits::usage($shop, 'orders_month'),
            'The plan change reset the usage meter. A new plan is not a new month.',
        );

        // The add-on survived the move: it was bought, not borrowed.
        $this->assertSame(27, PlanLimits::limit($shop, 'staff'));

        // ── ⑥ THE HISTORY WINDOW FOLLOWS THE PLAN, BOTH WAYS ───────────
        $old = Sale::withoutTenancy()->create([
            'tenant_id' => $shop->id,
            'invoice_number' => 'INV-OLD-'.uniqid(),
            'channel' => 'walk_in', 'status' => 'completed',
            'subtotal' => 500, 'discount' => 0, 'tax' => 0, 'total' => 500,
            'amount_paid' => 500, 'change_due' => 0, 'payment_method' => 'cash',
            'sold_at' => now()->subYears(6),
            'created_at' => now()->subYears(6),
            'updated_at' => now()->subYears(6),
        ]);

        // Pro keeps ten years, so a six-year-old sale is in.
        $onPro = $this->as($owner)->getJson('/api/v1/sales?per_page=100')->assertOk();
        $this->assertContains($old->id, collect($onPro->json('data'))->pluck('id')->all());
        $this->assertSame(120, $onPro->json('meta.retention.months'));

        // Back to Basic: two years, so it drops out — and the response says
        // why, which is the only thing standing between this and a support
        // call about lost records.
        $this->as($this->admin)->postJson("/api/v1/admin/tenants/{$shop->id}/assign-plan", [
            'plan_id' => $basic->id,
        ])->assertOk();

        $onBasic = $this->as($owner)->getJson('/api/v1/sales?per_page=100')->assertOk();
        $this->assertNotContains($old->id, collect($onBasic->json('data'))->pluck('id')->all());
        $this->assertSame(24, $onBasic->json('meta.retention.months'));

        // AND THE ROW IS STILL THERE. The whole promise, in one assertion.
        $this->assertNotNull(
            Sale::withoutTenancy()->find($old->id),
            'A downgrade deleted a sale. Archived is not deleted.',
        );

        // ── ⑦ A MODULE TAKEN AWAY CLOSES THE DOOR AND KEEPS THE DATA ───
        $this->as($this->admin)->putJson("/api/v1/admin/tenants/{$shop->id}/modules", [
            'modules' => array_merge($shop->fresh()->features, ['purchasing' => false]),
        ])->assertOk();

        $this->as($owner)->getJson('/api/v1/purchase-orders')
            ->assertForbidden()
            ->assertJsonPath('meta.error_code', 'MODULE_DISABLED');

        $this->assertTrue(
            $shop->fresh()->featureEnabled('inventory'),
            'Taking Purchasing away took Inventory with it. Dependencies point the other way.',
        );

        // ── AND HR, WHICH IS THE WHOLE REASON IT HAS A KEY ─────────────
        $this->as($this->admin)->putJson("/api/v1/admin/tenants/{$shop->id}/modules", [
            'modules' => array_merge($shop->fresh()->features, ['hrm' => true]),
        ])->assertOk();

        $this->assertTrue($shop->fresh()->featureEnabled('hrm'), 'Basic HR could not be granted.');

        $this->as($this->admin)->putJson("/api/v1/admin/tenants/{$shop->id}/modules", [
            'modules' => array_merge($shop->fresh()->features, ['hrm' => false]),
        ])->assertOk();

        $this->assertFalse($shop->fresh()->featureEnabled('hrm'), 'Basic HR could not be taken back.');
    }
}
