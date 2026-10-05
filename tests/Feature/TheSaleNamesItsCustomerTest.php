<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * A SALE SAYS WHO BOUGHT IT.
 *
 * Found by the first test that lived through a trading day in a browser: a
 * trade customer bought ten bags of rice on khata, Rs 18,900, and the sales
 * ledger said "Walk-in".
 *
 * A cashier attaches a customer by PHONE and types no name — the shop already
 * knows it. The sale was linked to the right record and stored a blank name,
 * and every screen and printout that shows a sale reads the name off the sale.
 */
class TheSaleNamesItsCustomerTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Product $rice;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->rice = Product::query()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Rice 5kg', 'price' => 1000, 'tax_rate' => 0, 'track_inventory' => false, 'is_active' => true,
        ]);
    }

    /** @param  array<string, mixed>  $over */
    private function ring(array $over = []): array
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token)->postJson('/api/v1/sales', array_merge([
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 1000,
            'items' => [['product_id' => $this->rice->id, 'quantity' => 1]],
        ], $over))->assertCreated()->json('data');
    }

    public function test_a_known_customer_found_by_phone_is_named_on_the_sale(): void
    {
        Customer::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Bilal Traders', 'phone' => '03001110003',
        ]);

        // Exactly what the till sends: the phone, and no name.
        $sale = $this->ring(['customer_phone' => '03001110003']);

        $this->assertSame('Bilal Traders', $sale['customer_name']);
        $this->assertNotNull($sale['customer_id']);
    }

    public function test_a_name_the_cashier_typed_is_the_one_kept(): void
    {
        Customer::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Bilal Traders', 'phone' => '03001110003',
        ]);

        // Somebody collecting on the account's behalf.
        $sale = $this->ring(['customer_phone' => '03001110003', 'customer_name' => 'Bilal (his driver)']);

        $this->assertSame('Bilal (his driver)', $sale['customer_name']);
    }

    public function test_a_first_time_phone_number_is_not_named_after_the_placeholder(): void
    {
        // A new number is filed under "Customer" until somebody learns the
        // name. That word on an invoice is not a name.
        $sale = $this->ring(['customer_phone' => '03009998887']);

        $this->assertNull($sale['customer_name']);
        $this->assertNotNull($sale['customer_id']);
    }

    public function test_a_sale_with_nobody_attached_names_nobody(): void
    {
        $sale = $this->ring();

        $this->assertNull($sale['customer_name']);
        $this->assertNull($sale['customer_id'] ?? null);
    }
}
