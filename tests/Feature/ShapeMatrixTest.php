<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * EVERY PATH THAT MOVES STOCK, AGAINST EVERY SHAPE A PRODUCT CAN HAVE.
 *
 * Written after a shape that nobody had pointed a stock path at. Adjusting a
 * product SOLD IN SIZES answered `201 Stock updated` and moved the shelf by
 * nothing — the twenty went into the parent's orphaned column, and the till,
 * the catalogue and the reorder list all still said what they said before.
 * Every inventory test in the suite used a plain product, so the whole suite
 * was green and the commonest retail shape had never been tried.
 *
 * The point of a matrix is that nobody has to think of the combination. Add a
 * shape or a path and every pairing is exercised the next morning.
 *
 * ── THE INVARIANT ────────────────────────────────────────────────────
 *
 * For any path, on any shape, exactly one of these is true:
 *
 *   · it SUCCEEDS and the stock moves by EXACTLY what was asked, or
 *   · it is REFUSED with a reason, and nothing moves.
 *
 * "Succeeded and moved nothing" is the sentence the sized-product bug lived
 * inside for months. So is its mirror, "refused and moved anyway", which is how
 * a rolled-back write leaves a lot on the books. And "moved, but not by what I
 * asked for" is the third, which a `> 0` check waves straight through.
 *
 * The expected move is a property of the SHAPE, not of the path: five units for
 * anything the shop counts, nought for anything it does not. A product with
 * `track_inventory` off has no stock to move, and saying so is what the flag
 * MEANS — not an exception carved out to make a test go green.
 *
 * ── THE THIRD AXIS ──────────────────────────────────────────────────
 *
 * Shape and path are not enough, and the first version of this file proved it:
 * it always addressed a sized product BY ITS SIZE, so removing the very guard
 * this file was written for changed nothing and the matrix passed. The bug is
 * not in the shape, it is in HOW THE CALLER ADDRESSES IT — a screen that names
 * the parent of a product sold in sizes.
 *
 * So every sized shape is run twice: aimed at a size, and aimed at the parent.
 * The second is the one that used to answer "Stock updated" and move nothing.
 *
 * The matrix does NOT hardcode which pairings should refuse. A shape that
 * cannot take a lot is entitled to say so; the test only insists that it says
 * so out loud rather than pretending.
 */
class ShapeMatrixTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private string $supplierId;

    /** @var array<int, string> every cell that ran, for the denominator */
    private array $covered = [];

    /** Aim this cell at the PARENT of a sized product rather than at a size. */
    private bool $atParent = false;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true,
            'business_type' => 'pharmacy',
            // Pharmacy carries the widest feature set of any single trade:
            // medicine + batches on top of ordinary retail, so one shop can
            // hold every shape the matrix needs.
            'features' => BusinessTypes::defaultFeatures('pharmacy'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->supplierId = $this->as()->postJson('/api/v1/suppliers', ['name' => 'Matrix Traders'])
            ->assertCreated()->json('data.id');
    }

    private function as(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    // ── SHAPES ──────────────────────────────────────────────────────
    //
    // Each returns the product, and each is a shape a real shop actually
    // stocks. `sized` and `sized_medicine` are the two that no inventory test
    // had ever used.

    /** @return array<string, callable(): Product> */
    private function shapes(): array
    {
        return [
            'plain' => fn () => $this->product(['name' => 'Plain Box']),

            'sized' => fn () => $this->withSizes($this->product(['name' => 'Sized Shirt']), ['S', 'M']),

            'medicine' => fn () => $this->product([
                'name' => 'Panadol', 'item_type' => 'medicine',
            ]),

            'sized_medicine' => fn () => $this->withSizes($this->product([
                'name' => 'Augmentin', 'item_type' => 'medicine',
            ]), ['250mg', '500mg']),

            'weighed' => fn () => $this->product(['name' => 'Loose Rice', 'sold_by' => 'weight']),

            'serialised' => fn () => $this->product(['name' => 'Handset', 'tracks_serial' => true]),

            'untracked' => fn () => $this->product(['name' => 'Carry Bag', 'track_inventory' => false]),
        ];
    }

    /** @param array<string, mixed> $attrs */
    private function product(array $attrs): Product
    {
        return Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id,
            'type' => 'product',
            'item_type' => 'physical_product',
            'price' => 100,
            'cost' => 60,
            'stock_quantity' => 0,
            'track_inventory' => true,
            ...$attrs,
        ]);
    }

    /** @param array<int, string> $names */
    private function withSizes(Product $p, array $names): Product
    {
        foreach ($names as $name) {
            ProductVariant::withoutTenancy()->create([
                'tenant_id' => $this->shop->id, 'product_id' => $p->id,
                'name' => $name, 'price' => 100, 'stock_quantity' => 0,
            ]);
        }

        return $p->fresh();
    }

    /** The size a path should aim at, or null for a product with none. */
    private function sizeOf(Product $p): ?string
    {
        return $this->atParent ? null : $p->variants()->value('id');
    }

    /** How far the shelf should move when a path books in five. */
    private function expectedMove(Product $p): float
    {
        return $p->track_inventory ? 5.0 : 0.0;
    }

    // ── PATHS ───────────────────────────────────────────────────────
    //
    // Each puts FIVE units in, and says what it did. Every one of them is a
    // route a shopkeeper can reach from a screen.

    /** @return array<string, callable(Product): TestResponse> */
    private function paths(): array
    {
        return [
            'adjust_in' => fn (Product $p) => $this->as()->postJson('/api/v1/inventory/adjust', array_filter([
                'product_id' => $p->id, 'variant_id' => $this->sizeOf($p),
                'type' => 'in', 'quantity' => 5, 'reason' => 'matrix',
            ])),

            'adjust_set' => fn (Product $p) => $this->as()->postJson('/api/v1/inventory/adjust', array_filter([
                'product_id' => $p->id, 'variant_id' => $this->sizeOf($p),
                'type' => 'set', 'new_quantity' => 5, 'reason' => 'matrix',
            ], fn ($v) => $v !== null)),

            'batch_add' => fn (Product $p) => $this->as()
                ->postJson("/api/v1/inventory/products/{$p->id}/batches", array_filter([
                    'batch_number' => 'MATRIX-1',
                    'variant_id' => $this->sizeOf($p),
                    'expiry_date' => now()->addYear()->toDateString(),
                    'quantity' => 5,
                ])),

            'po_receive' => fn (Product $p) => $this->receive($p),
        ];
    }

    private function receive(Product $p): TestResponse
    {
        $po = $this->as()->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $this->supplierId,
            'order_date' => now()->toDateString(),
            'status' => 'ordered',
            'items' => [array_filter([
                'product_id' => $p->id,
                'variant_id' => $this->sizeOf($p),
                'quantity' => 5,
                'unit_cost' => 60,
            ])],
        ]);

        // A shape that cannot be ORDERED never gets to the receiving bay, and
        // that refusal is the path's answer.
        if ($po->status() >= 400) {
            return $po;
        }

        $line = $po->json('data.items.0.id');

        return $this->as()->postJson("/api/v1/purchase-orders/{$po->json('data.id')}/receive", [
            'items' => [array_filter([
                'id' => $line,
                'quantity' => 5,
                'expiry_date' => now()->addYear()->toDateString(),
                'serials' => $p->tracks_serial ? ['MATRIX-SN-1', 'MATRIX-SN-2', 'MATRIX-SN-3', 'MATRIX-SN-4', 'MATRIX-SN-5'] : null,
            ], fn ($v) => $v !== null)],
        ]);
    }

    // ── THE MATRIX ──────────────────────────────────────────────────

    public function test_no_path_ever_succeeds_without_moving_the_stock(): void
    {
        $wrong = [];
        $succeeded = 0;

        foreach ($this->shapes() as $shapeName => $makeShape) {
            foreach ([false, true] as $atParent) {
                foreach ($this->paths() as $pathName => $runPath) {
                    /** @var Product $p */
                    $p = $makeShape();

                    // For a product with no sizes the two addresses are the same
                    // cell, and running it twice would inflate the denominator.
                    if ($atParent && $p->variants()->doesntExist()) {
                        continue;
                    }
                    $this->atParent = $atParent;
                    $aim = $atParent ? ' (aimed at the parent)' : '';
                    $before = $p->fresh()->effectiveStock();

                    $res = $runPath($p);

                    $after = $p->fresh()->effectiveStock();
                    $moved = round($after - $before, 3);
                    $cell = "{$shapeName} / {$pathName}{$aim}";
                    $this->covered[] = $cell;

                    if ($res->status() < 400) {
                        $succeeded++;
                        $want = $this->expectedMove($p);
                        if ($moved != $want) {
                            // THE BUG THIS FILE EXISTS FOR. A success that changed
                            // nothing is worse than a refusal: the shopkeeper is
                            // told the stock is in, and it is not.
                            $wrong[] = "{$cell}: answered {$res->status()}, moved {$moved}, expected {$want}";
                        }

                        continue;
                    }

                    if ($moved != 0.0) {
                        // The mirror. A refusal that still moved stock leaves the
                        // books saying something nobody agreed to.
                        $wrong[] = "{$cell}: refused ({$res->status()}) but stock moved by {$moved}";
                    }
                }
            }
        }
        $this->atParent = false;

        // THE DENOMINATOR, twice over. A matrix whose cells all refused would
        // satisfy every assertion above while proving nothing at all.
        $this->assertGreaterThanOrEqual(36, count($this->covered), 'the matrix shrank');
        $this->assertGreaterThan(
            count($this->covered) / 2,
            $succeeded,
            'more than half the matrix refused — this is measuring refusals, not stock',
        );

        $this->assertSame([], $wrong, "\n".implode("\n", $wrong)."\n");
    }

    /**
     * A path that refuses must SAY WHY, in a code a screen can act on.
     *
     * "Something went wrong" is the same as silence to the person holding the
     * goods. Every refusal in the matrix carries an error code.
     */
    public function test_every_refusal_names_itself(): void
    {
        $mute = [];

        foreach ($this->shapes() as $shapeName => $makeShape) {
            foreach ([false, true] as $atParent) {
                foreach ($this->paths() as $pathName => $runPath) {
                    $p = $makeShape();
                    if ($atParent && $p->variants()->doesntExist()) {
                        continue;
                    }
                    $this->atParent = $atParent;
                    $res = $runPath($p);
                    if ($res->status() < 400) {
                        continue;
                    }

                    $body = $res->json();
                    $hasCode = ! empty($body['meta']['error_code']);
                    $hasFieldError = ! empty($body['errors']);

                    if (! $hasCode && ! $hasFieldError) {
                        $mute[] = "{$shapeName} / {$pathName}: refused {$res->status()} with no error code and no field error";
                    }
                }
            }
        }
        $this->atParent = false;

        $this->assertSame([], $mute, "\n".implode("\n", $mute)."\n");
    }
}
