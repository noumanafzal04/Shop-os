<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\BranchStock;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * A SIZE, AFTER THE ITEM EXISTS.
 *
 * Until now a variant was write-once. Not hard to change — impossible: no route,
 * no rules on `UpdateProductRequest`, and the panel hid the section on edit. A
 * shop that mis-typed 1350 as 135 for its Large lived with it for ever, and the
 * one thing that made it worse than a plain gap is what `PUT /products/{id}` did
 * when handed a `variants` array:
 *
 *     200 {"message":"Item updated"}   ← and every variant discarded
 *
 * because `validated()` returns only rule-covered keys. A success response for
 * work that was thrown away, which nobody goes looking for.
 *
 * The tests below are in the order the damage would be discovered by a shop.
 */
class ProductVariantEditTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Branch $main;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->provisioned()->create();
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->main = Branch::withoutTenancy()
            ->where('tenant_id', $this->tenant->id)->where('is_default', true)->firstOrFail();
    }

    private function asOwner(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** A shirt in two sizes, made the way the form makes one. */
    private function shirt(array $over = []): array
    {
        return $this->asOwner()->postJson('/api/v1/products', array_merge([
            'item_type' => 'physical_product',
            'name' => 'Cotton Shirt',
            'price' => 1000,
            'track_inventory' => true,
            'variant_axes' => [
                ['name' => 'Colour', 'values' => ['Red', 'Blue']],
                ['name' => 'Size', 'values' => ['S', 'M']],
            ],
            'variants' => [
                ['name' => 'Red / S', 'price' => 1200, 'stock_quantity' => 4],
                ['name' => 'Red / M', 'price' => 1300, 'stock_quantity' => 3],
            ],
        ], $over))->assertCreated()->json('data');
    }

    // ── the thing that could not be done ────────────────────────────────

    public function test_a_mistyped_price_can_be_corrected(): void
    {
        $product = $this->shirt();
        $small = collect($product['variants'])->firstWhere('name', 'Red / S');

        $this->asOwner()->putJson("/api/v1/products/{$product['id']}", [
            'variants' => [
                ['id' => $small['id'], 'name' => 'Red / S', 'price' => 1250],
            ],
        ])->assertOk();

        $this->assertEquals(1250, ProductVariant::withoutTenancy()->find($small['id'])->price);
    }

    /**
     * THE one that used to answer 200 and do nothing.
     *
     * Asserted as a whole-request property rather than one field, because the
     * failure was not "price did not save" — it was that the entire key was
     * dropped before the action ever saw it, so nothing about variants worked at
     * all while the response said otherwise.
     */
    public function test_a_variant_edit_is_not_silently_discarded(): void
    {
        $product = $this->shirt();
        $before = ProductVariant::withoutTenancy()->where('product_id', $product['id'])->count();

        $this->asOwner()->putJson("/api/v1/products/{$product['id']}", [
            'variants' => [
                ['id' => collect($product['variants'])->firstWhere('name', 'Red / S')['id'], 'name' => 'Red / S', 'price' => 1200],
                ['id' => collect($product['variants'])->firstWhere('name', 'Red / M')['id'], 'name' => 'Red / M', 'price' => 1300],
                ['name' => 'Blue / S', 'price' => 1200, 'stock_quantity' => 2],
            ],
        ])->assertOk();

        $this->assertSame($before + 1, ProductVariant::withoutTenancy()->where('product_id', $product['id'])->count());
        $this->assertNotNull(
            ProductVariant::withoutTenancy()->where('product_id', $product['id'])->where('name', 'Blue / S')->first(),
            'the new size was accepted with a 200 and then thrown away',
        );
    }

    // ── what a new size must arrive with ────────────────────────────────

    /**
     * A size added later gets a shelf, or the till reads zero for a full rail.
     *
     * `branch_stocks` is the per-branch source of truth. `CreateProductAction`
     * writes a row for every variant it makes; a variant added afterwards has to
     * arrive in the same state or it is invisible to the counter that has to
     * sell it.
     */
    public function test_a_size_added_later_arrives_on_the_shelf(): void
    {
        $product = $this->shirt();

        $this->asOwner()->putJson("/api/v1/products/{$product['id']}", [
            'variants' => [
                ...collect($product['variants'])->map(fn ($v) => [
                    'id' => $v['id'], 'name' => $v['name'], 'price' => $v['price'],
                ])->all(),
                ['name' => 'Blue / M', 'price' => 1300, 'stock_quantity' => 7],
            ],
        ])->assertOk();

        $added = ProductVariant::withoutTenancy()
            ->where('product_id', $product['id'])->where('name', 'Blue / M')->firstOrFail();

        $this->assertEquals(7, BranchStock::withoutTenancy()
            ->where('branch_id', $this->main->id)
            ->where('variant_id', $added->id)
            ->value('quantity'), 'a new size has no shelf at this branch');
    }

    // ── the offline till ────────────────────────────────────────────────

    /**
     * THE LINE AN OFFLINE TILL DEPENDS ON.
     *
     * The catalog reaches a device as a delta keyed on
     * `products.updated_at|products.id`. Variants ride inside the product's
     * projection; nothing anywhere compares `product_variants.updated_at`. And
     * `save()` on an unchanged model is a no-op, so a variant-only edit moves no
     * product column.
     *
     * Without the parent touch the sequence is: the size is retired, the server
     * refuses it, the till never hears, it keeps selling it — and every one of
     * those queued sales dies on sync with VARIANT_UNAVAILABLE, non-retryably,
     * after the cash crossed the counter. This is the cheapest possible test of
     * the most expensive possible outcome.
     */
    public function test_editing_a_size_moves_the_parents_timestamp(): void
    {
        $product = $this->shirt();
        $row = Product::withoutTenancy()->findOrFail($product['id']);
        $was = $row->updated_at;

        $this->travel(2)->seconds();

        $this->asOwner()->putJson("/api/v1/products/{$product['id']}", [
            'variants' => [
                ['id' => collect($product['variants'])->firstWhere('name', 'Red / S')['id'], 'name' => 'Red / S', 'price' => 1275],
            ],
        ])->assertOk();

        $this->assertTrue(
            $row->fresh()->updated_at->greaterThan($was),
            'a variant changed and the product did not — every offline till is now selling a stale size',
        );
    }

    // ── removing one ────────────────────────────────────────────────────

    /**
     * A retired size is soft-deleted, never destroyed.
     *
     * Five tables cascade off a variant — `stock_movements` among them, which is
     * the whole stock audit trail — and three more carry a `variant_id` with no
     * foreign key at all. A soft delete fires none of that, so a sold line keeps
     * both its snapshot and its link.
     */
    public function test_a_removed_size_is_retired_and_not_destroyed(): void
    {
        $product = $this->shirt();
        $gone = collect($product['variants'])->firstWhere('name', 'Red / M');

        $this->asOwner()->putJson("/api/v1/products/{$product['id']}", [
            'variants' => [
                ['id' => collect($product['variants'])->firstWhere('name', 'Red / S')['id'], 'name' => 'Red / S', 'price' => 1200],
            ],
        ])->assertOk();

        $this->assertNull(ProductVariant::withoutTenancy()->find($gone['id']));
        $this->assertNotNull(
            ProductVariant::withoutTenancy()->withTrashed()->find($gone['id']),
            'the size was destroyed rather than retired — its stock movements went with it',
        );
    }

    /**
     * And a product with sizes cannot be left with none it can sell.
     *
     * A varianted product holds no stock of its own, so one with every size
     * switched off renders as a live, in-stock, unbuyable tile. The refusal says
     * what to do instead.
     */
    public function test_a_product_cannot_be_left_with_no_sellable_size(): void
    {
        $product = $this->shirt();

        $this->asOwner()->putJson("/api/v1/products/{$product['id']}", [
            'variants' => collect($product['variants'])->map(fn ($v) => [
                'id' => $v['id'], 'name' => $v['name'], 'price' => $v['price'], 'is_active' => false,
            ])->all(),
        ])->assertStatus(422)->assertJsonPath('meta.error_code', 'NO_SELLABLE_VARIANT');

        $this->assertSame(
            2,
            ProductVariant::withoutTenancy()->where('product_id', $product['id'])->where('is_active', true)->count(),
            'the refusal did not roll back — the shop is left in the state it was refused for',
        );
    }

    // ── the axes ────────────────────────────────────────────────────────

    /**
     * The matrix can be reopened, because what was typed was kept.
     *
     * Twelve rows called "Red / S" through "Blue / XL" are unreadable as a list;
     * the axes are what make them a grid again. Stored in the product's existing
     * `attributes` json, so no migration and nothing else to keep in step.
     */
    public function test_the_axes_a_shop_typed_are_kept_with_the_product(): void
    {
        $product = $this->shirt();

        $this->assertSame(
            [
                ['name' => 'Colour', 'values' => ['Red', 'Blue']],
                ['name' => 'Size', 'values' => ['S', 'M']],
            ],
            Product::withoutTenancy()->find($product['id'])->attributes['variant_axes'] ?? null,
        );
    }

    public function test_the_axes_can_be_changed_without_losing_other_specs(): void
    {
        $product = $this->shirt(['attributes' => ['Fabric' => 'Cotton']]);

        $this->asOwner()->putJson("/api/v1/products/{$product['id']}", [
            'variant_axes' => [['name' => 'Size', 'values' => ['S', 'M', 'L']]],
        ])->assertOk();

        $attrs = Product::withoutTenancy()->find($product['id'])->attributes;
        $this->assertSame('Cotton', $attrs['Fabric'] ?? null, 'a free-form spec was wiped by an axis edit');
        $this->assertCount(1, $attrs['variant_axes']);
    }
}
