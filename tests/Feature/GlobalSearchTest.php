<?php

namespace Tests\Feature;

use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\City;
use App\Models\Customer;
use App\Models\Order;
use App\Models\Product;
use App\Models\Sale;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Global search (⌘K palette). One query fans across products/customers/sales/
 * orders/suppliers; each group is gated by the SAME permission + feature rules
 * as its own page, so staff never see what they can't open.
 */
class GlobalSearchTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->firstOrCreate(['name' => 'Karachi'], ['is_active' => true]);
        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
            'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function product(string $name, array $attrs = []): Product
    {
        return Product::withoutTenancy()->create(array_merge([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => $name, 'price' => 100,
        ], $attrs));
    }

    private function customer(string $name, string $phone): Customer
    {
        return Customer::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => $name, 'phone' => $phone,
        ]);
    }

    private function search(User $user, string $q): array
    {
        return $this->actingAsUser($user)->getJson('/api/v1/search?q='.urlencode($q))
            ->assertOk()->json('data');
    }

    /** @return array<int, string> the group `type`s present in a search response */
    private function groupTypes(array $data): array
    {
        return array_map(fn ($g) => $g['type'], $data['groups']);
    }

    /**
     * A customer comes back holding the only paper they were given.
     *
     * An offline till prints `OFF-…` because it must not mint an invoice number
     * it could collide on; the server keeps both numbers on sync precisely so
     * that slip can be looked up. Global search matched `invoice_number` and
     * nothing else, so the palette a shop actually uses to find a sale could not
     * find this one — and there is no return without first finding it.
     */
    public function test_search_finds_a_sale_by_the_slip_number_printed_offline(): void
    {
        Sale::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id,
            'invoice_number' => 'INV-1043',
            'offline_number' => 'OFF-LANE1-A3F2-000042',
            'status' => 'completed',
            'channel' => 'pos', 'payment_method' => 'cash',
            'subtotal' => 500, 'total' => 500, 'amount_paid' => 500,
            'sold_at' => now(),
        ]);

        $byInvoice = $this->search($this->owner, 'INV-1043');
        $this->assertContains('sale', $this->groupTypes($byInvoice));

        $bySlip = $this->search($this->owner, 'OFF-LANE1-A3F2-000042');
        $this->assertContains('sale', $this->groupTypes($bySlip));

        // And the row carries the slip back, so whoever is holding the paper can
        // see their own number on the result before opening it.
        $row = collect($bySlip['groups'])->firstWhere('type', 'sale')['items'][0];
        $this->assertSame('OFF-LANE1-A3F2-000042', $row['offline_number']);
        $this->assertSame('INV-1043', $row['invoice_number']);
    }

    public function test_search_finds_a_product_by_name(): void
    {
        $this->product('Nestle Milk Pak 1L');

        $data = $this->search($this->owner, 'milk pak');

        $this->assertContains('product', $this->groupTypes($data));
        $products = collect($data['groups'])->firstWhere('type', 'product')['items'];
        $this->assertSame('Nestle Milk Pak 1L', $products[0]['name']);
    }

    public function test_search_matches_sku_and_barcode(): void
    {
        $this->product('Widget', ['sku' => 'WD-2200', 'barcode' => '8964000112233']);

        $bySku = $this->search($this->owner, 'WD-2200');
        $this->assertContains('product', $this->groupTypes($bySku));

        $byBarcode = $this->search($this->owner, '8964000112233');
        $this->assertContains('product', $this->groupTypes($byBarcode));
    }

    public function test_exact_prefix_matches_rank_above_mid_string_hits(): void
    {
        $this->product('Zebra Sauce'); // contains "sauce" mid-string
        $this->product('Sauce Bottle'); // starts with "sauce"

        $data = $this->search($this->owner, 'sauce');
        $items = collect($data['groups'])->firstWhere('type', 'product')['items'];

        $this->assertSame('Sauce Bottle', $items[0]['name']);
    }

    public function test_a_single_character_query_returns_no_groups(): void
    {
        $this->product('Apple');

        $data = $this->search($this->owner, 'a');

        $this->assertSame(0, $data['total']);
        $this->assertSame([], $data['groups']);
    }

    public function test_staff_only_see_the_groups_they_may_open(): void
    {
        // A name that matches BOTH a product and a customer.
        $this->product('Khan Traders');
        $this->customer('Khan Traders', '03001234567');

        // Staff with ONLY customers.manage must not see the products group.
        $staff = User::factory()->tenantStaff($this->tenant, [Permissions::CUSTOMERS_MANAGE])->create();

        $data = $this->search($staff, 'khan');
        $types = $this->groupTypes($data);

        $this->assertContains('customer', $types);
        $this->assertNotContains('product', $types);
    }

    public function test_orders_group_is_hidden_when_the_shop_has_no_marketplace(): void
    {
        $order = $this->makeOrder('ORD-000042', 'Ayesha');

        // The seeded 'mart' tenant may or may not sell online — force it off.
        $this->tenant->update(['features' => ['marketplace' => false] + $this->tenant->features]);
        $offline = $this->search($this->owner, 'ORD-000042');
        $this->assertNotContains('order', $this->groupTypes($offline));

        // Turn marketplace on and the same order surfaces.
        $this->tenant->update(['features' => ['marketplace' => true] + $this->tenant->features]);
        $online = $this->search($this->owner, 'ORD-000042');
        $this->assertContains('order', $this->groupTypes($online));
        $this->assertSame($order->id, collect($online['groups'])->firstWhere('type', 'order')['items'][0]['id']);
    }

    private function makeOrder(string $number, string $customerName): Order
    {
        $buyer = User::factory()->create([
            'tenant_id' => null, 'role' => UserRole::Customer, 'status' => UserStatus::Active,
        ]);

        return Order::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id,
            'customer_id' => $buyer->id,
            'order_number' => $number,
            'status' => 'pending',
            'fulfillment_type' => 'pickup',
            'payment_method' => 'cod',
            'customer_name' => $customerName,
            'subtotal' => 100, 'total' => 100,
            'placed_at' => now(),
        ]);
    }
}
