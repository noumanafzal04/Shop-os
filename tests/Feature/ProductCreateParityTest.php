<?php

namespace Tests\Feature;

use App\Http\Requests\Catalog\StoreProductRequest;
use App\Models\Category;
use App\Models\City;
use App\Models\Product;
use App\Models\TaxGroup;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * The fence around CreateProductAction's hand-written insert.
 *
 * `CreateProductAction` names every column one by one, while
 * `UpdateProductAction` fills the model wholesale. So a field the request
 * validates but that insert forgets is accepted by the API, dropped on create,
 * and then saved correctly the SECOND time somebody presses save — which is the
 * worst shape a bug can take, because the field looks like it works and a test
 * that creates-then-updates never sees it.
 *
 * Three fields have already been lost this way: `drug_schedule` blanked the
 * controlled-drug marking on every new medicine, `tax_group_id` silently
 * dropped a chosen rate so the item was PRICED wrong, and `kitchen_station`
 * had no writer at all while FireKitchenTicketAction had been reading it, so
 * the bar got the biryani.
 *
 * This file closes the class rather than those three instances. It works in two
 * halves that need each other:
 *
 *  1. `test_no_accepted_field_is_left_unaccounted_for` compares the request's
 *     own rule keys against what this file claims to know about. Add a rule and
 *     it fails until you either put the field in the round-trip payload or
 *     declare where else it lands.
 *  2. The round-trip tests then POST those payloads and read every field back
 *     OUT OF THE DATABASE. Being named in the payload is what makes a field
 *     asserted, so (1) cannot be satisfied by a promise alone.
 *
 * Values are deliberately chosen to differ from every column default —
 * `is_active` and `visible_in_marketplace` default TRUE and are sent false,
 * `sold_by` defaults to 'unit' and is sent 'weight' — so a dropped field fails
 * the assertion instead of coincidentally matching it.
 */
class ProductCreateParityTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Category $category;

    private TaxGroup $taxGroup;

    /**
     * Fields the request accepts that are NOT columns on `products`. Each one
     * names where it actually lands so the claim can be checked rather than
     * trusted — this list is the only way a field escapes the round-trip.
     */
    private const HANDLED_ELSEWHERE = [
        'type' => 'legacy coarse alias; mapped onto item_type in prepareForValidation()',
        'opening_batch_number' => 'product_batches.batch_number — the day-one opening lot',
        'expiry_date' => 'product_batches.expiry_date — the day-one opening lot',
        'barcodes' => 'product_barcodes, via SyncProductBarcodesAction',
        'units' => 'product_units, via SyncProductUnitsAction',
        'combo_items' => 'combo_items, via SyncComboItemsAction',
        'recipe_items' => 'recipe_items, via SyncRecipeItemsAction',
        'collection_ids' => 'collection_product pivot, via ->collections()->sync()',
        'variants' => 'product_variants (plus a branch_stock row each)',
        // Not a column of its own: the axes a shop typed to GENERATE those
        // variants — Colour: Red, Blue / Size: S, M — land inside the product's
        // existing `attributes` json, so the matrix can be reopened on edit
        // instead of showing twelve unexplained rows. Round-tripped by
        // ProductVariantEditTest rather than here, because `attributes` already
        // rides the maximal payload as a whole and asserting on one key inside
        // it would be asserting on a different thing than this file measures.
        'variant_axes' => "products.attributes['variant_axes']",
    ];

    /**
     * Columns a physical product may not carry, so they cannot ride the
     * maximal payload and get a round-trip test of their own instead.
     */
    private const SERVICE_ONLY = ['duration_minutes'];

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->tenant = Tenant::factory()->create([
            'setup_completed' => true,
            'city_id' => $city->id,
            // Type-less on purpose: this is a field-plumbing test, not a
            // business-type-constraint test, and StoreProductRequest's
            // withValidator() skips the item-type check when the type is null.
            // That lets one tenant create a service AND a physical good.
            'business_type' => null,
            'features' => BusinessTypes::defaultFeatures('retail'),
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();

        $this->category = Category::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Parity', 'is_active' => true,
        ]);
        $this->taxGroup = TaxGroup::query()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Standard', 'rate' => 17, 'is_active' => true,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    // ── The fence ───────────────────────────────────────────────────

    public function test_no_accepted_field_is_left_unaccounted_for(): void
    {
        $accepted = $this->acceptedTopLevelKeys();

        $accountedFor = array_merge(
            array_keys($this->maximalPhysicalPayload()),
            self::SERVICE_ONLY,
            array_keys(self::HANDLED_ELSEWHERE),
        );

        $unaccounted = array_values(array_diff($accepted, $accountedFor));

        $this->assertSame([], $unaccounted, implode("\n", [
            'StoreProductRequest accepts a field this test knows nothing about: '
                .implode(', ', $unaccounted).'.',
            '',
            'CreateProductAction writes its columns by hand, so a new field is',
            'dropped on create unless somebody adds it there. Do ONE of:',
            '',
            '  · add it to maximalPhysicalPayload() with a value that differs',
            '    from the column default — that round-trips it through the API',
            '    and the database, which is the actual check;',
            '  · or add it to HANDLED_ELSEWHERE, naming the table it lands in.',
        ]));
    }

    public function test_the_payload_only_claims_fields_the_request_really_accepts(): void
    {
        // The mirror of the test above: it would pass just as happily if this
        // file invented a field, and then the fence would be guarding nothing.
        $stray = array_values(array_diff(
            array_merge(
                array_keys($this->maximalPhysicalPayload()),
                self::SERVICE_ONLY,
                array_keys(self::HANDLED_ELSEWHERE),
            ),
            $this->acceptedTopLevelKeys(),
        ));

        $this->assertSame([], $stray,
            'This test names fields StoreProductRequest does not accept: '.implode(', ', $stray)
            .'. Either the rule was removed and this file is stale, or the name is a typo.');
    }

    // ── The round trip ──────────────────────────────────────────────

    public function test_every_field_the_request_accepts_is_actually_written(): void
    {
        $payload = $this->maximalPhysicalPayload();

        $id = $this->actingAsUser($this->owner)
            ->postJson('/api/v1/products', $payload)
            ->assertCreated()
            ->json('data.id');

        // Read it back out of the database rather than off the response: the
        // response is built from the in-memory model, which carries values the
        // insert may never have persisted.
        $product = Product::query()->findOrFail($id);

        foreach ($payload as $field => $sent) {
            $this->assertEquals(
                $this->comparable($sent),
                $this->comparable($product->getAttribute($field)),
                "`{$field}` did not survive create. It is validated by "
                .'StoreProductRequest and sent by the client, so CreateProductAction '
                .'is probably missing it from its insert — the same way drug_schedule, '
                .'tax_group_id and kitchen_station were.',
            );
        }
    }

    public function test_a_service_keeps_its_duration(): void
    {
        // duration_minutes is prohibited on anything but a service, so it
        // cannot ride the maximal payload above.
        $id = $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'service', 'name' => 'Fitting', 'price' => 500,
            'duration_minutes' => 45,
        ])->assertCreated()->json('data.id');

        $this->assertSame(45, Product::query()->findOrFail($id)->duration_minutes);
    }

    public function test_stock_tracking_can_be_switched_off_at_create(): void
    {
        // The maximal payload sends track_inventory TRUE, which is also a
        // physical product's default — so on its own it proves nothing. Sending
        // false is what shows the flag is read rather than assumed, and the
        // opening quantity is refused along with it.
        $id = $this->actingAsUser($this->owner)->postJson('/api/v1/products', [
            'item_type' => 'physical_product', 'name' => 'Untracked', 'price' => 100,
            'track_inventory' => false, 'stock_quantity' => 25,
        ])->assertCreated()->json('data.id');

        $product = Product::query()->findOrFail($id);
        $this->assertFalse($product->track_inventory);
        $this->assertEquals(0, $product->stock_quantity, 'An untracked item must not open with stock.');
    }

    // ── Helpers ─────────────────────────────────────────────────────

    /**
     * The top-level field names StoreProductRequest accepts, with the nested
     * ones (`variants.*.sku`) collapsed onto their parent.
     *
     * rules() is type-sensitive, so it is asked for a physical product — the
     * shape the maximal payload uses. The keys themselves do not vary by type;
     * only whether a rule reads 'prohibited' does.
     */
    private function acceptedTopLevelKeys(): array
    {
        $request = StoreProductRequest::create('/api/v1/products', 'POST', [
            'item_type' => 'physical_product',
        ]);
        $request->setUserResolver(fn () => $this->owner);

        $keys = array_map(
            static fn (string $rule): string => explode('.', $rule)[0],
            array_keys($request->rules()),
        );

        $keys = array_values(array_unique($keys));
        sort($keys);

        return $keys;
    }

    /**
     * Every products column a physical item can carry, each set to something a
     * dropped field could not produce by accident.
     *
     * `is_active` and `visible_in_marketplace` default TRUE and are sent false;
     * `sold_by` defaults to 'unit'; `requires_prescription` and `tracks_serial`
     * default false and are sent true. If one of these is ever dropped from the
     * insert, the stored value falls back to the default and the assertion
     * fails — which is the whole point.
     */
    private function maximalPhysicalPayload(): array
    {
        return [
            'item_type' => 'physical_product',
            'name' => 'Parity Widget',
            'description' => 'Exists so that every accepted field is read back.',
            'category_id' => $this->category->id,
            'sku' => 'PARITY-1',
            'barcode' => '5901234123457',
            'plu_code' => '4011',
            'brand' => 'Acme',
            'generic_name' => 'Widget',
            'strength' => '500mg',
            'dosage_form' => 'Tablet',
            'requires_prescription' => true,
            'drug_schedule' => 'G',
            'kitchen_station' => 'Grill',
            'tracks_serial' => true,
            'warranty_months' => 12,
            'unit' => 'Piece',
            'attributes' => ['Colour' => 'Red'],
            'price' => 1500,
            'cost' => 900,
            'discount_price' => 1200,
            'wholesale_price' => 1100,
            'price_tiers' => [
                ['min_qty' => 1, 'price' => 1500],
                ['min_qty' => 10, 'price' => 1400],
            ],
            'min_order_qty' => 2,
            'sold_by' => 'weight',
            // Both are sent on purpose. A group wins at pricing time, but the
            // insert must still persist the rate it was handed — dropping one
            // silently is exactly how tax_group_id was lost before.
            'tax_rate' => 5,
            'tax_group_id' => $this->taxGroup->id,
            'track_inventory' => true,
            'stock_quantity' => 42,
            'low_stock_threshold' => 7,
            'available_from' => '09:00',
            'available_until' => '22:00',
            'is_active' => false,
            'visible_in_marketplace' => false,
        ];
    }

    /**
     * Line up a sent value with a stored one.
     *
     * Decimal columns come back as strings and assertEquals compares those
     * loosely, so they need nothing. `time` columns are the exception: SQLite
     * returns exactly what was written while MySQL pads to HH:MM:SS, so both
     * sides are trimmed to HH:MM.
     */
    private function comparable(mixed $value): mixed
    {
        if (is_string($value) && preg_match('/^\d{2}:\d{2}(:\d{2})?$/', $value) === 1) {
            return substr($value, 0, 5);
        }

        return $value;
    }
}
