<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\ProductVariant;
use App\Models\StockTransfer;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * A TRANSFER IS SENT, AND THEN IT IS RECEIVED.
 *
 * It used to be one instant: out of here, into there. Thirty cartons went on
 * a van, twenty-eight came off it, and the record said thirty arrived — two
 * cartons gone, with nobody's name on them.
 *
 * What is held here:
 *
 *   sent stock is on NOBODY's shelf until it is counted in
 *   less than was sent cannot arrive silently: it needs a reason, and then a decision
 *   the decision is "put back" or "written off", and the books follow it
 *   a lot arrives as the lot it left as — same batch, same expiry
 *   a size is transferred as that size
 *   each end is worked by somebody allowed at that end
 *   and moving it in one step still works, for the godown behind the shop
 */
class StockIsSentThenReceivedTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Branch $main;

    private Branch $godown;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->provisioned()->create(['setup_completed' => true, 'timezone' => 'UTC']);
        $this->owner = User::factory()->shopOwner($this->tenant)->create(['name' => 'Asif Owner']);
        $this->main = Branch::withoutTenancy()->where('tenant_id', $this->tenant->id)->where('is_default', true)->firstOrFail();
        $this->godown = Branch::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Godown', 'kind' => Branch::KIND_WAREHOUSE,
            'is_default' => false, 'is_active' => true, 'fills_orders' => false,
        ]);
    }

    private function as(User $user, ?Branch $at = null): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token)->withHeaders(['X-Branch-Id' => $at?->id ?? '']);
    }

    private function product(float $atGodown, string $name = 'Basmati 5kg'): Product
    {
        $p = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => $name, 'price' => 1500, 'cost' => 1200, 'track_inventory' => true, 'stock_quantity' => $atGodown,
        ]);
        BranchStock::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'branch_id' => $this->main->id, 'product_id' => $p->id, 'variant_id' => null, 'quantity' => 0]);
        BranchStock::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'branch_id' => $this->godown->id, 'product_id' => $p->id, 'variant_id' => null, 'quantity' => $atGodown]);

        return $p;
    }

    private function onHand(Product $p, Branch $at, ?string $variantId = null): float
    {
        return (float) BranchStock::withoutTenancy()
            ->where('branch_id', $at->id)->where('product_id', $p->id)
            ->when($variantId !== null, fn ($q) => $q->where('variant_id', $variantId))
            ->sum('quantity');
    }

    private function onTheBooks(Product $p): float
    {
        return (float) Product::withoutTenancy()->findOrFail($p->id)->stock_quantity;
    }

    /** @return array<string, mixed> */
    private function send(Product $p, float $qty, ?User $by = null, array $line = []): array
    {
        return $this->as($by ?? $this->owner)->postJson('/api/v1/inventory/transfers', [
            'mode' => 'send',
            'from_branch_id' => $this->godown->id, 'to_branch_id' => $this->main->id,
            'items' => [['product_id' => $p->id, 'quantity' => $qty] + $line],
        ])->assertCreated()->json('data');
    }

    // ── on nobody's shelf until it is counted in ────────────────────────

    public function test_sent_stock_is_on_nobodys_shelf_until_it_is_received(): void
    {
        $rice = $this->product(100);

        $sent = $this->send($rice, 30);

        $this->assertSame('in_transit', $sent['status']);
        $this->assertEqualsWithDelta(70, $this->onHand($rice, $this->godown), 0.001, 'It is on a van; the godown no longer has it.');
        $this->assertEqualsWithDelta(0, $this->onHand($rice, $this->main), 0.001, 'The shop was given stock nobody has counted in.');
        $this->assertEqualsWithDelta(70, $this->onTheBooks($rice), 0.001);

        // …and the stock screen says where the other thirty are, rather than
        // leaving the total thirty short with no line to explain it.
        $row = collect($this->as($this->owner)->getJson('/api/v1/inventory/by-place')->assertOk()->json('data'))->firstWhere('id', $rice->id);
        $this->assertEqualsWithDelta(30, $row['on_the_road'], 0.001);

        // The receiving end is told one is on its way.
        $list = $this->as($this->owner, $this->main)->getJson('/api/v1/inventory/transfers')->assertOk();
        $this->assertSame(1, $list->json('meta.waiting.to_receive'));
        $this->assertTrue($list->json('data.0.can.receive'));

        $done = $this->as($this->owner)->postJson("/api/v1/inventory/transfers/{$sent['id']}/receive")->assertOk()->json('data');

        $this->assertSame('completed', $done['status']);
        $this->assertSame('Asif Owner', $done['receiver']['name']);
        $this->assertEqualsWithDelta(30, $this->onHand($rice, $this->main), 0.001);
        $this->assertEqualsWithDelta(100, $this->onTheBooks($rice), 0.001, 'A transfer changed how much the business owns.');
        $this->assertSame(0, $this->as($this->owner, $this->main)->getJson('/api/v1/inventory/transfers')->json('meta.waiting.to_receive'));
    }

    public function test_stock_on_the_road_is_still_in_the_shops_stock_value(): void
    {
        // Retail #14: while 4 chairs travelled, Rs 5,800 of the shop's own
        // stock was in no total, and Stock by place said 7 + 0 + 4 = 7.
        $rice = $this->product(100);
        $before = $this->as($this->owner)->getJson('/api/v1/reports/valuation')->assertOk()->json('data.totals');
        $this->assertEqualsWithDelta(120000, $before['cost_value'], 0.001);

        $sent = $this->send($rice, 30);

        $moving = $this->as($this->owner)->getJson('/api/v1/reports/valuation')->assertOk()->json('data');
        $this->assertEqualsWithDelta(120000, $moving['totals']['cost_value'], 0.001, 'A transfer changed what the shop owns.');
        $this->assertEqualsWithDelta(100, $moving['totals']['units'], 0.001);
        $this->assertEqualsWithDelta(36000, $moving['totals']['on_the_road_cost'], 0.001);
        $this->assertEqualsWithDelta(30, $moving['totals']['on_the_road_units'], 0.001);
        $this->assertEqualsWithDelta(100, collect($moving['items'])->firstWhere('product_id', $rice->id)['quantity'], 0.001);

        // A place's own figure is its shelves: the van is neither place's.
        $atGodown = $this->as($this->owner, $this->godown)->getJson('/api/v1/reports/valuation')->assertOk()->json('data.totals');
        $this->assertEqualsWithDelta(84000, $atGodown['cost_value'], 0.001);
        $this->assertEqualsWithDelta(0, $atGodown['on_the_road_cost'], 0.001);

        $row = collect($this->as($this->owner)->getJson('/api/v1/inventory/by-place')->assertOk()->json('data'))->firstWhere('id', $rice->id);
        $this->assertEqualsWithDelta(100, $row['total'], 0.001, 'The total left out its own On the road column.');

        $this->as($this->owner)->postJson("/api/v1/inventory/transfers/{$sent['id']}/receive")->assertOk();
        $after = $this->as($this->owner)->getJson('/api/v1/reports/valuation')->assertOk()->json('data.totals');
        $this->assertEqualsWithDelta(120000, $after['cost_value'], 0.001);
        $this->assertEqualsWithDelta(0, $after['on_the_road_cost'], 0.001);
    }

    public function test_a_transfer_is_received_once(): void
    {
        $rice = $this->product(100);
        $sent = $this->send($rice, 30);

        $this->as($this->owner)->postJson("/api/v1/inventory/transfers/{$sent['id']}/receive")->assertOk();
        $this->as($this->owner)->postJson("/api/v1/inventory/transfers/{$sent['id']}/receive")
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'TRANSFER_NOT_IN_TRANSIT');

        $this->assertEqualsWithDelta(30, $this->onHand($rice, $this->main), 0.001, 'Receiving twice put the stock on the shelf twice.');
    }

    // ── less than was sent cannot arrive silently ───────────────────────

    public function test_a_short_delivery_needs_a_reason_and_then_a_decision_and_putting_it_back_restores_the_sender(): void
    {
        $rice = $this->product(100);
        $sent = $this->send($rice, 30);
        $line = $sent['items'][0]['id'];

        // 28 arrived, and nobody said why.
        $this->as($this->owner)->postJson("/api/v1/inventory/transfers/{$sent['id']}/receive", [
            'items' => [['id' => $line, 'quantity_received' => 28]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'TRANSFER_SHORT_NEEDS_A_REASON');
        $this->assertEqualsWithDelta(0, $this->onHand($rice, $this->main), 0.001, 'A refused receipt still landed stock.');

        // More than was sent cannot arrive at all.
        $this->as($this->owner)->postJson("/api/v1/inventory/transfers/{$sent['id']}/receive", [
            'items' => [['id' => $line, 'quantity_received' => 31]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'TRANSFER_RECEIVED_OUT_OF_RANGE');

        $short = $this->as($this->owner)->postJson("/api/v1/inventory/transfers/{$sent['id']}/receive", [
            'items' => [['id' => $line, 'quantity_received' => 28, 'short_reason' => 'damaged']],
        ])->assertOk()->json('data');

        $this->assertSame('short', $short['status']);
        $this->assertEqualsWithDelta(28, $this->onHand($rice, $this->main), 0.001);
        // The two that did not arrive are on no shelf — not made up, not written off.
        $this->assertEqualsWithDelta(98, $this->onTheBooks($rice), 0.001);
        // It is the SENDER who is asked to settle it.
        $this->assertSame(1, $this->as($this->owner, $this->godown)->getJson('/api/v1/inventory/transfers')->json('meta.waiting.to_settle'));
        $this->assertSame(0, $this->as($this->owner, $this->main)->getJson('/api/v1/inventory/transfers')->json('meta.waiting.to_settle'));

        $settled = $this->as($this->owner)->postJson("/api/v1/inventory/transfers/{$sent['id']}/settle", ['outcome' => 'returned'])
            ->assertOk()->json('data');

        $this->assertSame('completed', $settled['status']);
        $this->assertSame('returned', $settled['items'][0]['short_outcome']);
        $this->assertEqualsWithDelta(72, $this->onHand($rice, $this->godown), 0.001, 'What was put back is not back.');
        $this->assertEqualsWithDelta(100, $this->onTheBooks($rice), 0.001);

        // Settled is settled.
        $this->as($this->owner)->postJson("/api/v1/inventory/transfers/{$sent['id']}/settle", ['outcome' => 'written_off'])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'TRANSFER_NOTHING_TO_SETTLE');
    }

    public function test_writing_a_shortage_off_leaves_it_gone_and_says_so(): void
    {
        $rice = $this->product(100);
        $sent = $this->send($rice, 30);

        $this->as($this->owner)->postJson("/api/v1/inventory/transfers/{$sent['id']}/receive", [
            'items' => [['id' => $sent['items'][0]['id'], 'quantity_received' => 25, 'short_reason' => 'missing']],
        ])->assertOk();

        $settled = $this->as($this->owner)->postJson("/api/v1/inventory/transfers/{$sent['id']}/settle", ['outcome' => 'written_off'])
            ->assertOk()->json('data');

        $this->assertSame('completed', $settled['status']);
        $this->assertSame('missing', $settled['items'][0]['short_reason']);
        $this->assertSame('written_off', $settled['items'][0]['short_outcome']);
        $this->assertEqualsWithDelta(70, $this->onHand($rice, $this->godown), 0.001);
        $this->assertEqualsWithDelta(25, $this->onHand($rice, $this->main), 0.001);
        $this->assertEqualsWithDelta(95, $this->onTheBooks($rice), 0.001, 'Five were written off and the books still carry them.');
    }

    public function test_a_transfer_can_be_called_back_before_it_arrives_and_not_after(): void
    {
        $rice = $this->product(100);
        $sent = $this->send($rice, 30);

        $back = $this->as($this->owner)->postJson("/api/v1/inventory/transfers/{$sent['id']}/cancel")->assertOk()->json('data');
        $this->assertSame('cancelled', $back['status']);
        $this->assertEqualsWithDelta(100, $this->onHand($rice, $this->godown), 0.001);

        $this->as($this->owner)->postJson("/api/v1/inventory/transfers/{$sent['id']}/receive")
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'TRANSFER_NOT_IN_TRANSIT');
        $this->assertEqualsWithDelta(0, $this->onHand($rice, $this->main), 0.001);

        // Once counted in, it is the receiver's stock: there is nothing to call back.
        $second = $this->send($rice, 10);
        $this->as($this->owner)->postJson("/api/v1/inventory/transfers/{$second['id']}/receive")->assertOk();
        $this->as($this->owner)->postJson("/api/v1/inventory/transfers/{$second['id']}/cancel")
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'TRANSFER_NOT_IN_TRANSIT');
        $this->assertEqualsWithDelta(10, $this->onHand($rice, $this->main), 0.001);
    }

    public function test_a_place_with_a_transfer_still_on_the_road_cannot_be_deleted(): void
    {
        $rice = $this->product(30);
        $this->send($rice, 30);

        // The godown holds nothing now — all thirty are on the van.
        $this->as($this->owner)->deleteJson("/api/v1/branches/{$this->godown->id}")
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'BRANCH_HAS_OPEN_TRANSFERS');
    }

    // ── a lot arrives as the lot it left as ─────────────────────────────

    private function lot(Product $p, string $number, string $expiry, float $qty, ?string $variantId = null): ProductBatch
    {
        return ProductBatch::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'branch_id' => $this->godown->id, 'product_id' => $p->id,
            'variant_id' => $variantId, 'batch_number' => $number, 'expiry_date' => $expiry, 'quantity' => $qty, 'cost' => 42,
        ]);
    }

    /** @return array<string, float> batch number → quantity, at a place */
    private function lotsAt(Product $p, Branch $at): array
    {
        return ProductBatch::withoutTenancy()
            ->where('product_id', $p->id)->where('branch_id', $at->id)->where('quantity', '>', 0)
            ->orderBy('batch_number')->get()
            ->mapWithKeys(fn (ProductBatch $b) => [$b->batch_number.' '.$b->expiry_date->toDateString() => (float) $b->quantity])
            ->all();
    }

    public function test_medicine_arrives_under_the_batch_and_expiry_it_left_under(): void
    {
        $tablets = $this->product(30, 'Panadol 500mg');
        $soon = now()->addMonths(3)->toDateString();
        $later = now()->addMonths(14)->toDateString();
        $this->lot($tablets, 'B-204', $soon, 10);
        $this->lot($tablets, 'B-388', $later, 20);
        // The shop already has a lot of its own, expiring in between. The old
        // transfer poured everything arriving into whichever lot here expired
        // first — so both batches below would have taken THIS one's date.
        ProductBatch::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'branch_id' => $this->main->id, 'product_id' => $tablets->id,
            'batch_number' => 'OLD-1', 'expiry_date' => now()->addMonths(6)->toDateString(), 'quantity' => 0, 'cost' => 40,
        ]);

        // 25 leave: the ten that expire soonest, and fifteen of the others.
        $sent = $this->send($tablets, 25);
        $this->assertSame(["B-388 {$later}" => 5.0], $this->lotsAt($tablets, $this->godown));
        $this->assertSame(
            [['B-204', $soon, 10.0], ['B-388', $later, 15.0]],
            array_map(fn ($l) => [$l['batch_number'], $l['expiry_date'], (float) $l['quantity']], $sent['items'][0]['lots']),
        );

        // 20 arrive. It is the latest-dated stock that is counted missing.
        $this->as($this->owner)->postJson("/api/v1/inventory/transfers/{$sent['id']}/receive", [
            'items' => [['id' => $sent['items'][0]['id'], 'quantity_received' => 20, 'short_reason' => 'missing']],
        ])->assertOk();

        $this->assertSame(
            ["B-204 {$soon}" => 10.0, "B-388 {$later}" => 10.0],
            $this->lotsAt($tablets, $this->main),
            'The batches did not arrive as themselves.',
        );
        // Lots and shelf agree at the receiving end.
        $this->assertEqualsWithDelta(20, $this->onHand($tablets, $this->main), 0.001);

        // The five that never came go back into the lot they left.
        $this->as($this->owner)->postJson("/api/v1/inventory/transfers/{$sent['id']}/settle", ['outcome' => 'returned'])->assertOk();
        $this->assertSame(["B-388 {$later}" => 10.0], $this->lotsAt($tablets, $this->godown));
        $this->assertEqualsWithDelta(10, $this->onHand($tablets, $this->godown), 0.001);
    }

    // ── a size is transferred as that size ──────────────────────────────

    public function test_a_shirt_is_transferred_by_size(): void
    {
        $shirt = Product::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Polo shirt', 'price' => 2500, 'track_inventory' => true, 'stock_quantity' => 0,
        ]);
        $medium = ProductVariant::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'product_id' => $shirt->id, 'name' => 'Medium', 'price' => 2500, 'stock_quantity' => 12]);
        $large = ProductVariant::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'product_id' => $shirt->id, 'name' => 'Large', 'price' => 2500, 'stock_quantity' => 7]);
        foreach ([[$medium, 12], [$large, 7]] as [$size, $qty]) {
            BranchStock::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'branch_id' => $this->godown->id, 'product_id' => $shirt->id, 'variant_id' => $size->id, 'quantity' => $qty]);
            // Main holds none, and says so: a size with no row at Main is read
            // as stock that pre-dates per-place rows and is assumed to be there.
            BranchStock::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'branch_id' => $this->main->id, 'product_id' => $shirt->id, 'variant_id' => $size->id, 'quantity' => 0]);
        }

        // With no size named there is nothing to move: the stock is on the sizes.
        $this->as($this->owner)->postJson('/api/v1/inventory/transfers', [
            'mode' => 'send', 'from_branch_id' => $this->godown->id, 'to_branch_id' => $this->main->id,
            'items' => [['product_id' => $shirt->id, 'quantity' => 4]],
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'VARIANT_REQUIRED');

        $sent = $this->send($shirt, 4, line: ['variant_id' => $medium->id]);
        $this->assertSame('Medium', $sent['items'][0]['variant_name']);

        $this->as($this->owner)->postJson("/api/v1/inventory/transfers/{$sent['id']}/receive")->assertOk();

        $this->assertEqualsWithDelta(4, $this->onHand($shirt, $this->main, $medium->id), 0.001);
        $this->assertEqualsWithDelta(8, $this->onHand($shirt, $this->godown, $medium->id), 0.001);
        $this->assertEqualsWithDelta(7, $this->onHand($shirt, $this->godown, $large->id), 0.001, 'Moving the Mediums moved the Larges.');
    }

    // ── each end is worked by somebody allowed at that end ──────────────

    public function test_each_end_of_a_transfer_is_worked_by_somebody_who_works_there(): void
    {
        $rice = $this->product(100);
        $manage = [Permissions::INVENTORY_MANAGE];
        $atShop = User::factory()->tenantStaff($this->tenant, $manage)->create(['branch_id' => $this->main->id]);
        $atGodown = User::factory()->tenantStaff($this->tenant, $manage)->create(['branch_id' => $this->godown->id]);

        $body = ['mode' => 'send', 'from_branch_id' => $this->godown->id, 'to_branch_id' => $this->main->id, 'items' => [['product_id' => $rice->id, 'quantity' => 10]]];

        // The shop's keeper cannot help themselves to the godown's stock…
        $this->as($atShop)->postJson('/api/v1/inventory/transfers', $body)
            ->assertStatus(403)->assertJsonPath('meta.error_code', 'NOT_YOUR_PLACE');
        // …nor move it in one step, which acts at both ends.
        $this->as($atShop)->postJson('/api/v1/inventory/transfers', ['mode' => 'move'] + $body)
            ->assertStatus(403)->assertJsonPath('meta.error_code', 'NOT_YOUR_PLACE');
        $this->assertEqualsWithDelta(100, $this->onHand($rice, $this->godown), 0.001);

        // The godown's keeper sends it.
        $sent = $this->as($atGodown)->postJson('/api/v1/inventory/transfers', $body)->assertCreated()->json('data');
        $this->assertSame(['send' => false, 'receive' => false, 'settle' => false, 'cancel' => true], $sent['can'], 'The sender was offered Receive at a place they do not work at.');

        // They cannot count it in at the shop; the shop's keeper can.
        $this->as($atGodown)->postJson("/api/v1/inventory/transfers/{$sent['id']}/receive")
            ->assertStatus(403)->assertJsonPath('meta.error_code', 'NOT_YOUR_PLACE');
        $seen = $this->as($atShop)->getJson('/api/v1/inventory/transfers')->assertOk()->json('data.0');
        $this->assertSame(['send' => false, 'receive' => true, 'settle' => false, 'cancel' => false], $seen['can']);

        $this->as($atShop)->postJson("/api/v1/inventory/transfers/{$sent['id']}/receive", [
            'items' => [['id' => $sent['items'][0]['id'], 'quantity_received' => 9, 'short_reason' => 'damaged']],
        ])->assertOk();

        // The shortage is the sender's to settle, not the receiver's.
        $this->as($atShop)->postJson("/api/v1/inventory/transfers/{$sent['id']}/settle", ['outcome' => 'written_off'])
            ->assertStatus(403)->assertJsonPath('meta.error_code', 'NOT_YOUR_PLACE');
        $this->as($atGodown)->postJson("/api/v1/inventory/transfers/{$sent['id']}/settle", ['outcome' => 'written_off'])->assertOk();
    }

    // ── the place that needs it can ask ─────────────────────────────────

    /**
     * A shop's keeper may not help themselves to the godown's shelf — so they
     * ask. Nothing moves until the godown answers, and it may answer with
     * less than was asked for.
     */
    public function test_a_shop_asks_the_godown_for_stock_and_the_godown_sends_what_it_can_spare(): void
    {
        $rice = $this->product(100);
        $manage = [Permissions::INVENTORY_MANAGE];
        $atShop = User::factory()->tenantStaff($this->tenant, $manage)->create(['branch_id' => $this->main->id, 'name' => 'Shop Keeper']);
        $atGodown = User::factory()->tenantStaff($this->tenant, $manage)->create(['branch_id' => $this->godown->id, 'name' => 'Godown Keeper']);
        $body = ['mode' => 'request', 'from_branch_id' => $this->godown->id, 'to_branch_id' => $this->main->id, 'items' => [['product_id' => $rice->id, 'quantity' => 40]]];

        // Asking is done by the place it is FOR.
        $this->as($atGodown)->postJson('/api/v1/inventory/transfers', $body)
            ->assertStatus(403)->assertJsonPath('meta.error_code', 'NOT_YOUR_PLACE');

        $asked = $this->as($atShop)->postJson('/api/v1/inventory/transfers', $body)->assertCreated()->json('data');

        $this->assertSame('requested', $asked['status']);
        $this->assertSame('Shop Keeper', $asked['requester']['name']);
        $this->assertNull($asked['sender'], 'Nobody has sent anything yet.');
        $this->assertEqualsWithDelta(40, (float) $asked['items'][0]['quantity_requested'], 0.001);
        // Nothing has moved, and nothing is on the road.
        $this->assertEqualsWithDelta(100, $this->onHand($rice, $this->godown), 0.001, 'Asking for stock took it off the shelf.');
        $row = collect($this->as($this->owner)->getJson('/api/v1/inventory/by-place')->json('data'))->firstWhere('id', $rice->id);
        $this->assertEqualsWithDelta(0, $row['on_the_road'], 0.001, 'A request is shown as stock on the road.');
        // The asker may withdraw it; they may not send it.
        $this->assertSame(['send' => false, 'receive' => false, 'settle' => false, 'cancel' => true], $asked['can']);

        // The godown is told, and offered the answer.
        $list = $this->as($atGodown)->getJson('/api/v1/inventory/transfers')->assertOk();
        $this->assertSame(1, $list->json('meta.waiting.to_send'));
        $this->assertTrue($list->json('data.0.can.send'));
        // A request cannot be counted in: there is nothing to count.
        $this->as($atShop)->postJson("/api/v1/inventory/transfers/{$asked['id']}/receive")
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'TRANSFER_NOT_IN_TRANSIT');

        // Sending none of it is not an answer.
        $this->as($atGodown)->postJson("/api/v1/inventory/transfers/{$asked['id']}/send", ['items' => [['id' => $asked['items'][0]['id'], 'quantity' => 0]]])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'TRANSFER_SENDS_NOTHING');

        // Twenty-five can be spared.
        $sent = $this->as($atGodown)->postJson("/api/v1/inventory/transfers/{$asked['id']}/send", ['items' => [['id' => $asked['items'][0]['id'], 'quantity' => 25]]])
            ->assertOk()->json('data');

        $this->assertSame('in_transit', $sent['status']);
        $this->assertSame('Godown Keeper', $sent['sender']['name']);
        $this->assertEqualsWithDelta(25, (float) $sent['items'][0]['quantity'], 0.001);
        $this->assertEqualsWithDelta(40, (float) $sent['items'][0]['quantity_requested'], 0.001, 'What was asked for was overwritten by what was sent.');
        $this->assertEqualsWithDelta(75, $this->onHand($rice, $this->godown), 0.001);

        // It is sent once.
        $this->as($atGodown)->postJson("/api/v1/inventory/transfers/{$asked['id']}/send")
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'TRANSFER_NOT_REQUESTED');

        $this->as($atShop)->postJson("/api/v1/inventory/transfers/{$asked['id']}/receive")->assertOk();
        $this->assertEqualsWithDelta(25, $this->onHand($rice, $this->main), 0.001);
        $this->assertEqualsWithDelta(100, $this->onTheBooks($rice), 0.001);
    }

    public function test_a_request_can_be_declined_by_the_place_asked_or_withdrawn_by_the_place_asking_and_moves_nothing(): void
    {
        $rice = $this->product(100);
        $manage = [Permissions::INVENTORY_MANAGE];
        $atShop = User::factory()->tenantStaff($this->tenant, $manage)->create(['branch_id' => $this->main->id]);
        $atGodown = User::factory()->tenantStaff($this->tenant, $manage)->create(['branch_id' => $this->godown->id]);
        $ask = fn () => $this->as($atShop)->postJson('/api/v1/inventory/transfers', [
            'mode' => 'request', 'from_branch_id' => $this->godown->id, 'to_branch_id' => $this->main->id,
            'items' => [['product_id' => $rice->id, 'quantity' => 10]],
        ])->assertCreated()->json('data.id');

        $first = $ask();
        $reference = StockTransfer::withoutTenancy()->findOrFail($first)->reference;
        $this->as($atGodown)->postJson("/api/v1/inventory/transfers/{$first}/cancel")
            ->assertOk()->assertJsonPath('data.status', 'cancelled')
            ->assertJsonPath('message', "Request {$reference} declined — nothing was sent");

        $second = $ask();
        $this->as($atShop)->postJson("/api/v1/inventory/transfers/{$second}/cancel")->assertOk()->assertJsonPath('data.status', 'cancelled');

        $this->assertEqualsWithDelta(100, $this->onHand($rice, $this->godown), 0.001, 'Declining a request moved stock.');
        $this->assertEqualsWithDelta(0, $this->onHand($rice, $this->main), 0.001);
        // Declined is answered: the godown is no longer waited on.
        $this->assertSame(0, $this->as($atGodown)->getJson('/api/v1/inventory/transfers')->json('meta.waiting.to_send'));
        // …and it can no longer be sent.
        $this->as($atGodown)->postJson("/api/v1/inventory/transfers/{$first}/send")
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'TRANSFER_NOT_REQUESTED');
    }

    public function test_a_place_sees_the_transfers_that_touch_it_and_no_others(): void
    {
        $rice = $this->product(100);
        $elsewhere = Branch::withoutTenancy()->create(['tenant_id' => $this->tenant->id, 'name' => 'Saddar', 'is_active' => true]);
        $stranger = User::factory()->tenantStaff($this->tenant, [Permissions::INVENTORY_MANAGE])->create(['branch_id' => $elsewhere->id]);
        $this->send($rice, 10);

        $this->assertCount(0, $this->as($stranger)->getJson('/api/v1/inventory/transfers')->assertOk()->json('data'));
        $this->assertCount(1, $this->as($this->owner)->getJson('/api/v1/inventory/transfers')->assertOk()->json('data'));
        $this->assertCount(1, $this->as($this->owner)->getJson('/api/v1/inventory/transfers?status=in_transit')->json('data'));
        $this->assertCount(0, $this->as($this->owner)->getJson('/api/v1/inventory/transfers?status=completed')->json('data'));
    }

    // ── and one step still works ────────────────────────────────────────

    public function test_a_caller_that_names_no_mode_moves_the_stock_at_once_as_it_always_did(): void
    {
        $rice = $this->product(100);

        $moved = $this->as($this->owner)->postJson('/api/v1/inventory/transfers', [
            'from_branch_id' => $this->godown->id, 'to_branch_id' => $this->main->id,
            'items' => [['product_id' => $rice->id, 'quantity' => 30]],
        ])->assertCreated()->assertJsonPath('message', 'Stock transferred')->json('data');

        $this->assertSame('completed', $moved['status']);
        $this->assertEqualsWithDelta(30, (float) $moved['items'][0]['quantity_received'], 0.001);
        $this->assertEqualsWithDelta(30, $this->onHand($rice, $this->main), 0.001);
        $this->assertEqualsWithDelta(70, $this->onHand($rice, $this->godown), 0.001);
        $this->assertSame(0, StockTransfer::withoutTenancy()->whereIn('status', StockTransfer::OPEN)->count());
    }

    // ── the slip that travels with it ───────────────────────────────────

    public function test_the_slip_has_a_box_to_write_what_arrived_and_prints_the_count_once_it_has(): void
    {
        $rice = $this->product(100);
        $sent = $this->send($rice, 30);

        $before = $this->as($this->owner)->get("/api/v1/inventory/transfers/{$sent['id']}/slip")->assertOk()->getContent();
        $this->assertStringContainsString($sent['reference'], $before);
        $this->assertStringContainsString('ON ITS WAY', $before);
        $this->assertStringContainsString('<strong>Godown</strong> <span class="soft">(Warehouse)</span>', $before);
        $this->assertStringContainsString('RECEIVED (write in)', $before);
        $this->assertStringContainsString('class="box"', $before, 'There is nowhere on the slip to write what arrived.');
        $this->assertStringContainsString('Asif Owner', $before);
        // A count of goods, read by a driver: no prices on it.
        $this->assertStringNotContainsString('1500', $before);
        $this->assertStringNotContainsString('1200', $before);

        $this->as($this->owner)->postJson("/api/v1/inventory/transfers/{$sent['id']}/receive", [
            'items' => [['id' => $sent['items'][0]['id'], 'quantity_received' => 28, 'short_reason' => 'damaged']],
        ])->assertOk();

        $after = $this->as($this->owner)->get("/api/v1/inventory/transfers/{$sent['id']}/slip")->assertOk()->getContent();
        $this->assertStringContainsString('RECEIVED SHORT', $after);
        $this->assertStringNotContainsString('class="box"', $after);
        $this->assertStringContainsString('<strong>2 did not arrive</strong> — damaged, not yet settled', $after);
    }
}
