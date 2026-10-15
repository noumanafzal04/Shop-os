<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Customer;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * THE PEOPLE ON KHATA, APART FROM EVERYONE ELSE (L16).
 *
 * The owner, 2026-10-15: "customers main jo khaty main customers chal rahy hon
 * … jinhon ny paise dene ho wo row main kahin highlight — aise customers mix
 * ho rhy hain". The list had no balance on it and no way to ask for one.
 */
class TheCustomerListSaysWhoOwesTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'grocery', 'features' => BusinessTypes::defaultFeatures('grocery'),
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
    }

    private function asOwner(): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($this->owner->createToken('t', ['access'])->plainTextToken);
    }

    private function customer(string $name, string $phone, float $balance, ?float $limit = null): Customer
    {
        return Customer::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => $name, 'phone' => $phone,
            'credit_balance' => $balance, 'credit_limit' => $limit,
        ]);
    }

    /** @return array<string, Customer> */
    private function book(): array
    {
        return [
            'half' => $this->customer('Half Way', '03001110001', 5000, 10000),
            'near' => $this->customer('Near Limit', '03001110002', 9000, 10000),
            'over' => $this->customer('Over Limit', '03001110003', 12000, 10000),
            'ahead' => $this->customer('Paid Ahead', '03001110004', -300),
            'clear' => $this->customer('Owes Nothing', '03001110005', 0),
        ];
    }

    private function names(string $query): array
    {
        return array_column($this->asOwner()->getJson("/api/v1/customers?{$query}")->assertOk()->json('data'), 'name');
    }

    public function test_each_filter_is_its_own_people_most_owed_first(): void
    {
        $this->book();

        $this->assertSame(['Over Limit', 'Near Limit', 'Half Way'], $this->names('standing=owes'));
        // Over the limit before near it: 120% then 90%. Half way is not near.
        $this->assertSame(['Over Limit', 'Near Limit'], $this->names('standing=limit'));
        $this->assertSame(['Paid Ahead'], $this->names('standing=advance'));
        $this->assertCount(5, $this->names(''));

        $this->asOwner()->getJson('/api/v1/customers?standing=everything')->assertStatus(422);
    }

    public function test_the_counts_on_the_filters_add_up_and_match_owed_to_you(): void
    {
        $this->book();

        $this->asOwner()->getJson('/api/v1/customers/summary')->assertOk()
            ->assertJsonPath('data.everyone', 5)
            ->assertJsonPath('data.owed.total', 26000)
            ->assertJsonPath('data.owed.accounts', 3)
            ->assertJsonPath('data.advance.total', 300)
            ->assertJsonPath('data.advance.accounts', 1)
            ->assertJsonPath('data.near_limit', 2);

        // The dashboard's "Owed to you" is the same figure, asked the same way.
        $owed = $this->asOwner()->getJson('/api/v1/dashboard')->json('data.money_owed.receivable');
        $this->assertEquals(['total' => 26000, 'accounts' => 3], ['total' => (float) $owed['total'], 'accounts' => $owed['accounts']]);
    }

    public function test_last_paid_is_money_handed_over_not_a_return(): void
    {
        $book = $this->book();
        $this->asOwner()->postJson("/api/v1/customers/{$book['half']->id}/payments", ['amount' => 1000, 'method' => 'bank_transfer'])
            ->assertCreated();
        // A return takes the debt down as a "payment" too — it is not money in.
        $book['near']->recordCreditPayment(500, 'return', 'RET-000001');

        $rows = collect($this->asOwner()->getJson('/api/v1/customers?standing=owes')->json('data'))->keyBy('name');
        $this->assertNotNull($rows['Half Way']['last_paid_at'], 'a transfer against the khata is not its last payment');
        $this->assertNull($rows['Near Limit']['last_paid_at'], 'a return was counted as the customer paying');
    }

    public function test_the_export_is_the_filtered_list(): void
    {
        $this->book();

        $csv = $this->asOwner()->get('/api/v1/customers/export?standing=owes')->assertOk()->streamedContent();
        $this->assertStringContainsString('Over Limit', $csv);
        $this->assertStringContainsString('Half Way', $csv);
        $this->assertStringNotContainsString('Paid Ahead', $csv);
        $this->assertStringNotContainsString('Owes Nothing', $csv);
    }
}
