<?php

namespace Tests\Feature;

use App\Models\AnsweredRequest;
use App\Models\Customer;
use App\Models\Expense;
use App\Models\ExpenseCategory;
use App\Models\Supplier;
use App\Models\SupplierPayment;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * A MONEY FORM PRESSED TWICE IS RECORDED ONCE.
 *
 * Tester pass 1 (B07): a double-click on Record took Zainab's khata from
 * 1,200 to 200 for one 500 paid; Gul Textile Mills was "paid" twice; an
 * expense of 300 went in twice. Each form now sends the key it was opened
 * with, and the second press is given the first answer.
 */
class AMoneyFormPressedTwiceRecordsOnceTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'business_type' => 'mart', 'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    private function as(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    public function test_a_khata_payment_sent_twice_is_one_payment(): void
    {
        $zainab = Customer::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'name' => 'Zainab', 'phone' => '03001112223', 'credit_balance' => 1200]);
        $form = ['amount' => 500, 'method' => 'card', 'idempotency_key' => 'pay-zainab-1'];

        $first = $this->as()->postJson("/api/v1/customers/{$zainab->id}/payments", $form)->assertCreated();
        $again = $this->as()->postJson("/api/v1/customers/{$zainab->id}/payments", $form)->assertCreated();

        $this->assertEquals(700, $zainab->fresh()->credit_balance, 'one 500 was paid and the khata went down twice');
        $this->assertSame($first->json('data'), $again->json('data'), 'the second press was not given the first answer');
        $again->assertHeader('Idempotent-Replay', 'true');

        // A new form is a new payment.
        $this->as()->postJson("/api/v1/customers/{$zainab->id}/payments", ['idempotency_key' => 'pay-zainab-2'] + $form)->assertCreated();
        $this->assertEquals(200, $zainab->fresh()->credit_balance);
    }

    public function test_a_supplier_payment_and_an_expense_sent_twice_are_one_each(): void
    {
        $mill = Supplier::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'name' => 'Gul Textile Mills', 'is_active' => true]);
        $pay = ['amount' => 100, 'method' => 'bank_transfer', 'idempotency_key' => 'pay-mill-1'];
        $this->as()->postJson("/api/v1/suppliers/{$mill->id}/payments", $pay)->assertSuccessful();
        $this->as()->postJson("/api/v1/suppliers/{$mill->id}/payments", $pay)->assertSuccessful();
        $this->assertSame(1, SupplierPayment::withoutTenancy()->count(), 'the supplier was paid twice');

        $bags = ExpenseCategory::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'name' => 'Shop supplies'])->id;
        $bill = [
            'expense_category_id' => $bags, 'description' => 'Shopping bags', 'amount' => 300,
            'expense_date' => now()->toDateString(), 'payment_method' => 'bank_transfer', 'idempotency_key' => 'bags-1',
        ];
        $this->as()->postJson('/api/v1/expenses', $bill)->assertCreated();
        $this->as()->postJson('/api/v1/expenses', $bill)->assertCreated();
        $this->assertSame(1, Expense::withoutTenancy()->count(), 'one bill went in twice');
    }

    public function test_a_second_press_while_the_first_is_still_being_written_is_told_so(): void
    {
        $zainab = Customer::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'name' => 'Zainab', 'phone' => '03001112223', 'credit_balance' => 1200]);
        // The first press: taken, not yet answered.
        AnsweredRequest::query()->create([
            'user_id' => $this->owner->id, 'tenant_id' => $this->shop->id, 'key' => 'pay-zainab-1',
            'route' => "POST api/v1/customers/{$zainab->id}/payments",
        ]);

        $this->as()->postJson("/api/v1/customers/{$zainab->id}/payments", ['amount' => 500, 'method' => 'card', 'idempotency_key' => 'pay-zainab-1'])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'REQUEST_IN_FLIGHT');
        $this->assertEquals(1200, $zainab->fresh()->credit_balance);
    }

    public function test_a_refused_form_can_be_corrected_and_sent_with_the_same_key(): void
    {
        $zainab = Customer::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'name' => 'Zainab', 'phone' => '03001112223', 'credit_balance' => 1200]);

        $this->as()->postJson("/api/v1/customers/{$zainab->id}/payments", ['amount' => -5, 'method' => 'card', 'idempotency_key' => 'k'])->assertStatus(422);
        $this->as()->postJson("/api/v1/customers/{$zainab->id}/payments", ['amount' => 500, 'method' => 'card', 'idempotency_key' => 'k'])->assertCreated();

        $this->assertEquals(700, $zainab->fresh()->credit_balance);
    }
}
