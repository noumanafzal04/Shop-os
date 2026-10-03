<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\City;
use App\Models\Customer;
use App\Models\Expense;
use App\Models\ExpenseCategory;
use App\Models\Plan;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * WHAT THE RETENTION WINDOW MUST NEVER TOUCH.
 *
 * `HowFarBackAShopCanLookTest` proves the fence works. This proves it is
 * pointed at the right thing, which is the harder half and the one that
 * would have shipped broken.
 *
 * A retention window is a limit on BROWSING HISTORY. It is not a limit on
 * what is true. The distinction has a precise test:
 *
 *   A LIST is a window onto rows. Dropping the oldest page shortens the
 *   answer and the shopkeeper can see that it is shorter.
 *
 *   A BALANCE is the SUM of every row there has ever been. Dropping the
 *   oldest rows does not shorten it, it CHANGES it — and nothing on the
 *   screen looks any different. Stock on hand, a customer's khata, a
 *   supplier's account: a two-year plan that quietly forgot the opening
 *   balance would hand a shopkeeper a confident, wrong number and give them
 *   no reason to doubt it.
 *
 * That is the bug this file exists to catch. It is not hypothetical — every
 * natural way to implement the fence (a global scope on the model, a trait
 * on the base query, a middleware that rewrites `from`) gets it wrong,
 * because all three fence the ROWS rather than the READ.
 */
class ArchivedIsNotDeletedTest extends TestCase
{
    use RefreshDatabase;

    /** @return array{0: Tenant, 1: User} */
    private function shopOn(?int $retentionMonths): array
    {
        $city = City::query()->firstOrCreate(['name' => 'Lahore'], ['is_active' => true]);

        $plan = Plan::query()->create([
            'name' => 'Standard', 'code' => 'std-'.uniqid(), 'price' => 4999,
            'billing_period_months' => 1, 'is_active' => true,
            'retention_months' => $retentionMonths,
        ]);

        $shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id, 'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'), 'timezone' => 'UTC',
            'plan_id' => $plan->id,
        ]);

        return [$shop, User::factory()->shopOwner($shop)->create()];
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();

        return $this->withToken($token);
    }

    // ── What the fence MUST NOT touch ───────────────────────────────────

    /**
     * STOCK ON HAND IS NOT HISTORY.
     *
     * Goods received three years ago are on the shelf today. A fence that
     * reached the stock figure would show a shop 0 of a product it is
     * holding 40 of, and every reorder decision after that is wrong.
     */
    public function test_stock_on_hand_ignores_the_window(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        [$shop, $owner] = $this->shopOn(12);

        $product = Product::withoutTenancy()->create([
            'tenant_id' => $shop->id,
            'name' => 'Basmati 5kg',
            'sku' => 'RICE-5',
            'price' => 2400,
            'cost' => 1900,
            'stock_quantity' => 40,
            'is_active' => true,
            'created_at' => now()->subYears(3),
            'updated_at' => now()->subYears(3),
        ]);

        $row = collect(
            $this->as($owner)->getJson('/api/v1/products?per_page=100')->assertOk()->json('data'),
        )->firstWhere('id', $product->id);

        $this->assertNotNull($row, 'A product bought before the window vanished from the catalogue.');
        $this->assertEquals(40, $row['stock_quantity'], 'The shelf lost its stock to a retention window.');
    }

    /**
     * A CUSTOMER'S KHATA IS NOT HISTORY EITHER.
     *
     * Rs 12,000 owed since 2022 is still owed. The balance is the sum of
     * every entry there has ever been, and a fence over the entries would
     * silently forgive debt.
     */
    public function test_an_old_debt_is_still_owed(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        [$shop, $owner] = $this->shopOn(12);

        $customer = Customer::withoutTenancy()->create([
            'tenant_id' => $shop->id,
            'name' => 'Rafiq Sahib',
            'phone' => '03001234567',
            'credit_balance' => 12000,
            'created_at' => now()->subYears(3),
            'updated_at' => now()->subYears(3),
        ]);

        $row = collect(
            $this->as($owner)->getJson('/api/v1/customers?per_page=100')->assertOk()->json('data'),
        )->firstWhere('id', $customer->id);

        $this->assertNotNull($row, 'A customer who has owed money since 2022 disappeared.');
        $this->assertEquals(12000, $row['credit_balance'], 'A retention window wrote off a real debt.');
    }

    // ── What the fence MUST touch ───────────────────────────────────────

    /** Spending is history, and it is fenced like the rest of it. */
    public function test_an_expense_past_the_window_is_archived(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        [$shop, $owner] = $this->shopOn(12);

        $category = ExpenseCategory::withoutTenancy()->create([
            'tenant_id' => $shop->id, 'name' => 'Rent', 'is_active' => true,
        ]);

        $old = Expense::withoutTenancy()->create([
            'tenant_id' => $shop->id,
            'expense_category_id' => $category->id,
            'description' => 'Rent, long ago',
            'amount' => 50000,
            'payment_method' => 'cash',
            'expense_date' => now()->subYears(3)->toDateString(),
            'created_at' => now()->subYears(3),
            'updated_at' => now()->subYears(3),
        ]);

        $recent = Expense::withoutTenancy()->create([
            'tenant_id' => $shop->id,
            'expense_category_id' => $category->id,
            'description' => 'Rent, this month',
            'amount' => 60000,
            'payment_method' => 'cash',
            'expense_date' => now()->toDateString(),
        ]);

        $response = $this->as($owner)->getJson('/api/v1/expenses?per_page=100')->assertOk();
        $ids = collect($response->json('data'))->pluck('id');

        $this->assertFalse($ids->contains($old->id), 'An expense past the window was still listed.');
        $this->assertTrue($ids->contains($recent->id), 'The window ate this month as well.');
        $response->assertJsonPath('meta.retention.months', 12);
    }

    /**
     * AND THE TOTAL UNDERNEATH AGREES WITH THE ROWS.
     *
     * `MoneyEntryFilters::totals` clones the very query the rows came from,
     * so the fence reaches both — but that is a property of how it is
     * written, not a guarantee, and a sum that disagrees with the list above
     * it is the single most reported defect in this module's history.
     */
    public function test_the_total_counts_exactly_what_is_listed(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        [$shop, $owner] = $this->shopOn(12);

        $category = ExpenseCategory::withoutTenancy()->create([
            'tenant_id' => $shop->id, 'name' => 'Rent', 'is_active' => true,
        ]);

        foreach ([3, 0] as $yearsAgo) {
            Expense::withoutTenancy()->create([
                'tenant_id' => $shop->id,
                'expense_category_id' => $category->id,
                'description' => "Rent {$yearsAgo}",
                'amount' => 50000,
                'payment_method' => 'cash',
                'expense_date' => now()->subYears($yearsAgo)->toDateString(),
                'created_at' => now()->subYears($yearsAgo),
                'updated_at' => now()->subYears($yearsAgo),
            ]);
        }

        $response = $this->as($owner)->getJson('/api/v1/expenses?per_page=100')->assertOk();

        $this->assertSame(1, $response->json('meta.totals.count'));
        $this->assertEquals(50000, $response->json('meta.totals.total'));
    }

    /**
     * THE AUDIT TRAIL IS HISTORY TOO.
     *
     * It is the most tempting one to exempt — "it is a security record" —
     * and exempting it would mean the cheapest plan carries the platform's
     * largest table forever.
     */
    public function test_the_audit_trail_stops_at_the_window(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        [$shop, $owner] = $this->shopOn(12);

        $old = AuditLog::query()->create([
            'tenant_id' => $shop->id,
            'user_id' => $owner->id,
            'event' => 'updated',
            'auditable_type' => Product::class,
            'auditable_id' => (string) Str::uuid(),
            'created_at' => now()->subYears(3),
            'updated_at' => now()->subYears(3),
        ]);

        $ids = collect(
            $this->as($owner)->getJson('/api/v1/audit-logs?per_page=100')->assertOk()->json('data'),
        )->pluck('id');

        $this->assertFalse($ids->contains($old->id), 'The trail reached past the plan window.');
    }
}
