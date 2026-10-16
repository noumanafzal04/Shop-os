<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\HeldSale;
use App\Models\Product;
use App\Models\PurchaseOrder;
use App\Models\StockTransfer;
use App\Models\Supplier;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * A TRANSFER, A PURCHASE ORDER AND A HELD TICKET PRESSED TWICE ARE ONE EACH.
 *
 * Codex QA, 2026-10-16: a double "Send" made two transfers and took 4 units
 * off Main for 2 sent; a double "Place order" made two Rs 7,200 orders; a
 * double "Hold" parked the same cart twice. Money forms already answered once
 * per key (AnswerOnce); these three did not. The form sends the key it was
 * opened with, and the second press is given the first answer.
 */
class StockAndOrdersPressedTwiceAreOneTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Branch $main;

    private Branch $godown;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->shop = Tenant::factory()->provisioned()->create(['setup_completed' => true, 'timezone' => 'UTC']);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->main = Branch::withoutTenancy()->where('tenant_id', $this->shop->id)->where('is_default', true)->firstOrFail();
        $this->godown = Branch::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Godown', 'kind' => Branch::KIND_WAREHOUSE,
            'is_default' => false, 'is_active' => true, 'fills_orders' => false,
        ]);
    }

    private function as(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function rice(float $atGodown): Product
    {
        $p = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Basmati 5kg', 'price' => 1500, 'cost' => 1200, 'track_inventory' => true, 'stock_quantity' => $atGodown,
        ]);
        BranchStock::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'branch_id' => $this->main->id, 'product_id' => $p->id, 'variant_id' => null, 'quantity' => 0]);
        BranchStock::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'branch_id' => $this->godown->id, 'product_id' => $p->id, 'variant_id' => null, 'quantity' => $atGodown]);

        return $p;
    }

    public function test_a_transfer_sent_twice_is_one_transfer_and_the_stock_leaves_once(): void
    {
        $rice = $this->rice(100);
        $form = [
            'mode' => 'send', 'from_branch_id' => $this->godown->id, 'to_branch_id' => $this->main->id,
            'items' => [['product_id' => $rice->id, 'quantity' => 2]], 'idempotency_key' => 'send-rice-1',
        ];

        $first = $this->as()->postJson('/api/v1/inventory/transfers', $form)->assertCreated();
        $again = $this->as()->postJson('/api/v1/inventory/transfers', $form)->assertCreated();

        $this->assertSame(1, StockTransfer::withoutTenancy()->count(), 'two transfers for one press');
        $godown = (float) BranchStock::withoutTenancy()->where('branch_id', $this->godown->id)->where('product_id', $rice->id)->value('quantity');
        $this->assertEqualsWithDelta(98, $godown, 0.001, '2 were sent and the shelf lost 4');
        $this->assertSame($first->json('data.id'), $again->json('data.id'), 'the second press was not given the first answer');
        $again->assertHeader('Idempotent-Replay', 'true');

        // A new form is a new transfer.
        $this->as()->postJson('/api/v1/inventory/transfers', ['idempotency_key' => 'send-rice-2'] + $form)->assertCreated();
        $this->assertSame(2, StockTransfer::withoutTenancy()->count());
    }

    public function test_a_purchase_order_placed_twice_is_one_order(): void
    {
        $rice = $this->rice(0);
        $mills = Supplier::withoutTenancy()->create(['tenant_id' => $this->shop->id, 'name' => 'Faisalabad Mills', 'is_active' => true]);
        $form = [
            'supplier_id' => $mills->id, 'order_date' => now()->toDateString(), 'status' => 'ordered',
            'items' => [['product_id' => $rice->id, 'quantity' => 6, 'unit_cost' => 1200]], 'idempotency_key' => 'po-1',
        ];

        $first = $this->as()->postJson('/api/v1/purchase-orders', $form)->assertCreated();
        $again = $this->as()->postJson('/api/v1/purchase-orders', $form)->assertCreated();

        $this->assertSame(1, PurchaseOrder::withoutTenancy()->count(), 'two Rs 7,200 orders for one press');
        $this->assertSame($first->json('data.id'), $again->json('data.id'));
    }

    public function test_a_cart_held_twice_is_one_ticket(): void
    {
        $rice = $this->rice(10);
        $form = ['label' => 'Blue shirt', 'cart' => [['product_id' => $rice->id, 'quantity' => 2]], 'total_estimate' => 3000, 'idempotency_key' => 'hold-1'];

        $this->as()->postJson('/api/v1/pos/held', $form)->assertCreated();
        $this->as()->postJson('/api/v1/pos/held', $form)->assertCreated();

        $this->assertSame(1, HeldSale::withoutTenancy()->count(), 'the same cart was parked twice');
    }
}
