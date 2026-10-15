<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * THE SAME NUMBER IS THE SAME CUSTOMER, HOWEVER IT WAS TYPED.
 *
 * The user (2026-10-15): "agr existing customer ko again quote or advance ka
 * process?" Every path finds a customer by phone, exactly as typed — and the
 * till's own box suggests "03xx-xxxxxxx". So "0300-1234567" and "03001234567"
 * were two customers, and their quotes, advances and khata split between
 * them (L7).
 */
class ACustomerIsFoundHoweverTheNumberIsWrittenTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private string $item;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->shop = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->actingAs($this->owner);
        $this->item = $this->postJson('/api/v1/products', [
            'name' => 'Lawn Suit', 'item_type' => 'physical_product', 'price' => 1000, 'track_inventory' => false,
        ])->assertCreated()->json('data.id');
    }

    private function customers(): int
    {
        return Customer::withoutTenancy()->where('tenant_id', $this->shop->id)->count();
    }

    public function test_a_number_written_another_way_finds_the_same_customer(): void
    {
        $ahmed = $this->postJson('/api/v1/customers', ['name' => 'Ahmed Khan', 'phone' => '0300-1234567'])->assertCreated()->json('data.id');
        $before = $this->customers();

        // A quote, typed without the dash and with a shorter name.
        $quote = $this->postJson('/api/v1/sale-documents', [
            'kind' => 'quotation', 'customer_name' => 'Ahmed', 'customer_phone' => '03001234567',
            'items' => [['product_id' => $this->item, 'quantity' => 1]],
        ])->assertCreated()->json('data');
        $this->assertSame($ahmed, $quote['customer_id'], 'the quote went to a second customer with the same number');
        $this->assertSame('Ahmed', $quote['customer_name'], 'the name typed on the quote is not the one it carries');

        // Goods on advance, written +92.
        $held = $this->postJson('/api/v1/sale-documents', [
            'kind' => 'layaway', 'customer_phone' => '+92 300 1234567', 'idempotency_key' => 'lay-1',
            'items' => [['product_id' => $this->item, 'quantity' => 1]],
            'deposit' => ['amount' => 500, 'method' => 'card'],
        ])->assertCreated()->json('data');
        $this->assertSame($ahmed, $held['customer_id']);
        $this->assertSame(Customer::withoutTenancy()->find($ahmed)->name, $held['customer_name'], "the advance does not carry the customer's own name");

        // A sale at the till, written 92…, and the till's own look-up.
        $sale = $this->postJson('/api/v1/sales', [
            'channel' => 'pos', 'customer_phone' => '923001234567',
            'items' => [['product_id' => $this->item, 'quantity' => 1]],
            'payment_method' => 'cash', 'amount_paid' => 1000,
        ])->assertCreated()->json('data');
        $this->assertSame($ahmed, $sale['customer_id']);
        $this->assertSame($ahmed, $this->getJson('/api/v1/customers-lookup?phone=03001234567')->assertOk()->json('data.id'));

        $this->assertSame($before, $this->customers(), 'one number became more than one customer');

        // The customer form will not file the same number twice either.
        $this->postJson('/api/v1/customers', ['name' => 'Ahmed again', 'phone' => '0300 1234567'])
            ->assertStatus(422)->assertJsonValidationErrors('phone');

        // A different number is a different customer.
        $this->postJson('/api/v1/sale-documents', [
            'kind' => 'quotation', 'customer_phone' => '03001234568',
            'items' => [['product_id' => $this->item, 'quantity' => 1]],
        ])->assertCreated();
        $this->assertSame($before + 1, $this->customers());
    }

    public function test_a_customer_with_no_name_yet_is_given_the_first_one_typed(): void
    {
        $this->postJson('/api/v1/sales', [
            'channel' => 'pos', 'customer_phone' => '03111111111',
            'items' => [['product_id' => $this->item, 'quantity' => 1]],
            'payment_method' => 'cash', 'amount_paid' => 1000,
        ])->assertCreated();
        $nobody = Customer::withoutTenancy()->where('phone', '03111111111')->first();
        $this->assertNull($nobody->knownName());

        $this->postJson('/api/v1/sale-documents', [
            'kind' => 'quotation', 'customer_name' => 'Bilqees', 'customer_phone' => '0311-1111111',
            'items' => [['product_id' => $this->item, 'quantity' => 1]],
        ])->assertCreated();
        $this->assertSame('Bilqees', $nobody->fresh()->name);
    }

    public function test_the_number_is_read_the_same_way_written_any_way(): void
    {
        foreach (['0300-1234567', '03001234567', '+92 300 1234567', '923001234567', '0092 300 1234567', '(0300) 123 4567'] as $written) {
            $this->assertSame('03001234567', Customer::phoneKey($written), $written);
        }
        $this->assertSame('0412345678', Customer::phoneKey('041-2345678'), 'a landline is not a mobile');
    }
}
