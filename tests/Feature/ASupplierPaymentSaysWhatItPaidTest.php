<?php

namespace Tests\Feature;

use App\Models\PurchaseOrder;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * A PART PAYMENT HAS A HISTORY: WHEN, HOW MUCH, HOW — ON THE ORDER AND ON THE SUPPLIER.
 *
 * The user (2026-10-15): "supplier ko jb pay kia … agr partially pay kia jata
 * hai to uski detail show ni hoti, uski history kb kitne pay kiye thy or kaise
 * — koi record ni on supplier and purchase main". A payment on account that
 * spread over two orders named neither; each order only knew a total paid.
 */
class ASupplierPaymentSaysWhatItPaidTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private string $supplier;

    private string $first;

    private string $second;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->shop = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $item = $this->as($this->owner)->postJson('/api/v1/products', ['name' => 'Chiffon Dupatta', 'item_type' => 'physical_product', 'price' => 990, 'cost' => 450, 'track_inventory' => true, 'stock_quantity' => 0])->assertCreated()->json('data.id');
        $this->supplier = $this->as($this->owner)->postJson('/api/v1/suppliers', ['name' => 'Faisalabad Mills'])->assertCreated()->json('data.id');
        $this->first = $this->arrived($item, 5, '2026-10-10');   // a bill of 3,000
        $this->second = $this->arrived($item, 4, '2026-10-12');  // a bill of 2,400
    }

    private function as(User $who): static
    {
        $token = $who->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function arrived(string $item, int $quantity, string $on): string
    {
        $po = $this->as($this->owner)->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $this->supplier, 'order_date' => $on, 'status' => 'ordered',
            'items' => [['product_id' => $item, 'quantity' => $quantity, 'unit_cost' => 600]],
        ])->assertCreated()->json('data');
        $this->as($this->owner)->postJson("/api/v1/purchase-orders/{$po['id']}/receive", ['items' => [['id' => $po['items'][0]['id'], 'quantity' => $quantity]]])->assertOk();

        return $po['id'];
    }

    private function pay(array $data): void
    {
        $this->as($this->owner)->postJson("/api/v1/suppliers/{$this->supplier}/payments", $data)->assertCreated();
    }

    /** @return list<array{amount: float, method: string, reference: ?string, paid_at: string}> */
    private function historyOf(string $po): array
    {
        return collect($this->as($this->owner)->getJson("/api/v1/purchase-orders/{$po}")->assertOk()->json('data.allocations'))
            ->map(fn (array $a): array => ['amount' => (float) $a['amount'], 'method' => $a['payment']['method'], 'reference' => $a['payment']['reference'], 'paid_at' => substr($a['payment']['paid_at'], 0, 10)])
            ->all();
    }

    public function test_every_part_payment_is_on_the_order_it_paid(): void
    {
        // 1,000 in cash against the first order; then 3,500 by bank "on account",
        // which settles the first (2,000) and pays 1,500 of the second.
        $this->pay(['amount' => 1000, 'method' => 'cash', 'purchase_order_id' => $this->first, 'paid_at' => '2026-10-11']);
        $this->pay(['amount' => 3500, 'method' => 'bank_transfer', 'reference' => 'IBFT 7781', 'paid_at' => '2026-10-14']);

        $this->assertSame([
            ['amount' => 1000.0, 'method' => 'cash', 'reference' => null, 'paid_at' => '2026-10-11'],
            ['amount' => 2000.0, 'method' => 'bank_transfer', 'reference' => 'IBFT 7781', 'paid_at' => '2026-10-14'],
        ], $this->historyOf($this->first), "the first order's history does not say what paid it");
        $this->assertSame([
            ['amount' => 1500.0, 'method' => 'bank_transfer', 'reference' => 'IBFT 7781', 'paid_at' => '2026-10-14'],
        ], $this->historyOf($this->second), 'a payment on account is missing from the order it part-paid');

        // Each order's history adds up to what it shows as paid.
        foreach ([$this->first, $this->second] as $po) {
            $this->assertSame(
                (float) PurchaseOrder::withoutTenancy()->find($po)->amount_paid,
                array_sum(array_column($this->historyOf($po), 'amount')),
            );
        }

        // The supplier's own list: each payment, and which orders it went to.
        $payments = collect($this->as($this->owner)->getJson("/api/v1/suppliers/{$this->supplier}")->assertOk()->json('data.payments'));
        $onAccount = $payments->firstWhere('reference', 'IBFT 7781');
        $this->assertSame(PurchaseOrder::withoutTenancy()->find($this->first)->po_number, $payments->firstWhere('method', 'cash')['purchase_order']['po_number'], 'the payment that named its order does not say which');
        $this->assertSame(
            [[PurchaseOrder::withoutTenancy()->find($this->first)->po_number, 2000.0], [PurchaseOrder::withoutTenancy()->find($this->second)->po_number, 1500.0]],
            collect($onAccount['allocations'])->map(fn (array $a): array => [$a['purchase_order']['po_number'], (float) $a['amount']])->sortBy(0)->values()->all(),
        );
    }

    public function test_the_stockroom_is_not_sent_the_history(): void
    {
        $this->pay(['amount' => 1000, 'method' => 'cash', 'purchase_order_id' => $this->first]);
        $keeper = User::factory()->tenantStaff($this->shop, ['inventory.manage'])->create();

        $order = $this->as($keeper)->getJson("/api/v1/purchase-orders/{$this->first}")->assertOk()->json('data');
        $this->assertArrayNotHasKey('allocations', $order, 'what was paid to the supplier went to the stockroom');
    }
}
