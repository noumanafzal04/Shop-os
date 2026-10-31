<?php

namespace Tests\Feature;

use App\Models\CashSession;
use App\Models\City;
use App\Models\ExpenseCategory;
use App\Models\Supplier;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\DrawerMath;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * #AZ14 — A TILL PAID OUT BEYOND WHAT IT HELD, AND NOBODY WAS TOLD.
 *
 * A-Z Phones opened a shift on a 200 float, took 152.25, then paid a supplier
 * 1,000 in cash and filed a 120.50 expense "from the till". Both went through
 * without a word; the close sheet later read "Expected −668.00 · Over 668.00"
 * beside "The drawer is empty".
 *
 * Not refused — the money was spent, and refusing the record does not unspend
 * it. Said at the press, when a Paid in can still put the drawer right.
 */
class ADrawerPaidOutBeyondItHeldTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private ExpenseCategory $rent;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
            'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create(['name' => 'Owner']);
        $this->rent = ExpenseCategory::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Rent', 'is_active' => true,
        ]);
    }

    public function test_a_supplier_paid_from_the_till_beyond_the_drawer_is_recorded_and_said(): void
    {
        $session = $this->openShift(200);
        $supplier = Supplier::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'name' => 'Dubai Parts', 'is_active' => true]);

        $response = $this->asOwner()->postJson("/api/v1/suppliers/{$supplier->id}/payments", ['amount' => 1000, 'method' => 'cash'])
            ->assertCreated();

        // Recorded all the same: the money was spent.
        $this->assertEqualsWithDelta(-800, DrawerMath::for($session->fresh())['expected_cash'], 0.001);
        $warnings = $response->json('meta.warnings');
        $this->assertCount(1, $warnings);
        $this->assertStringContainsString('more cash than your drawer held', $warnings[0]);
        $this->assertStringContainsString('-800.00', $warnings[0]);
        $this->assertStringContainsString('Paid in', $warnings[0]);
    }

    public function test_a_supplier_paid_within_what_the_drawer_holds_says_nothing(): void
    {
        $this->openShift(2000);
        $supplier = Supplier::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'name' => 'Dubai Parts', 'is_active' => true]);

        $response = $this->asOwner()->postJson("/api/v1/suppliers/{$supplier->id}/payments", ['amount' => 1000, 'method' => 'cash'])
            ->assertCreated();

        $this->assertNull($response->json('meta.warnings'));
    }

    public function test_a_cash_expense_beyond_the_drawer_is_recorded_and_said(): void
    {
        $session = $this->openShift(100);

        $response = $this->asOwner()->postJson('/api/v1/expenses', [
            'expense_category_id' => $this->rent->id,
            'description' => 'Parts courier',
            'amount' => 120.50,
            'payment_method' => 'cash',
            'expense_date' => now()->toDateString(),
        ])->assertCreated();

        $this->assertEqualsWithDelta(-20.50, DrawerMath::for($session->fresh())['expected_cash'], 0.001);
        $this->assertNotNull($response->json('data.cash_movement_id'));
        $this->assertSame(
            ['That is more cash than your drawer held, so it now expects -20.50. If the rest came from somewhere else, record it as a Paid in so the shift balances.'],
            $response->json('meta.warnings'),
        );
    }

    public function test_raising_an_expense_past_the_drawer_is_said_on_the_edit(): void
    {
        $this->openShift(500);
        $id = $this->asOwner()->postJson('/api/v1/expenses', [
            'expense_category_id' => $this->rent->id, 'description' => 'Courier',
            'amount' => 100, 'payment_method' => 'cash', 'expense_date' => now()->toDateString(),
        ])->assertCreated()->assertJsonMissingPath('meta.warnings')->json('data.id');

        $response = $this->asOwner()->putJson("/api/v1/expenses/{$id}", [
            'expense_category_id' => $this->rent->id, 'description' => 'Courier',
            'amount' => 700, 'payment_method' => 'cash', 'expense_date' => now()->toDateString(),
        ])->assertOk();

        $this->assertStringContainsString('now expects -200.00', $response->json('meta.warnings.0'));
    }

    private function openShift(float $float): CashSession
    {
        $id = $this->asOwner()->postJson('/api/v1/pos/session/open', ['opening_float' => $float])->assertCreated()->json('data.id');

        return CashSession::withoutTenancy()->findOrFail($id);
    }

    private function asOwner(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
