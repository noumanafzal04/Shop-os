<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Collection;
use Tests\TestCase;

/**
 * WHAT THIS ITEM USED TO COST THE CUSTOMER, AND WHO MOVED IT.
 *
 * Every other money authority in the shop has been auditable for a while — a
 * tax rate, a coupon, a customer's credit limit, a customer group's discount —
 * and the number a shop changes most often was not on the list. Sugar goes from
 * 180 to 210 and the only record of 180 was the screen it was typed over.
 *
 * The hard half is not recording it. It is recording it WITHOUT burying the
 * trail, which is the same argument that produced `auditOnly` in the first
 * place and which a catalogue makes twice as sharply: a shop opens with five
 * thousand items and imports a supplier's list every month.
 *
 * So three rules, and every one of them is about what must NOT be filed:
 *
 *   an item arriving with a price is not a price change;
 *   a name or a category is not a money decision;
 *   an import of 340 items is ONE act, not 340.
 */
class ProductPriceHistoryTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->shop = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    private function product(array $overrides = []): Product
    {
        $product = Product::withoutTenancy()->create(array_merge([
            'tenant_id' => $this->shop->id,
            'name' => 'Sugar 1kg',
            'item_type' => 'physical_product',
            'price' => 180,
        ], $overrides));
        // The fixture's own creation is not the subject of any test here.
        AuditLog::query()->delete();

        return $product;
    }

    private function login(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function rowsFor(Product $p): Collection
    {
        return AuditLog::query()
            ->where('auditable_type', Product::class)
            ->where('auditable_id', $p->id)
            ->orderBy('created_at')
            ->get();
    }

    public function test_a_price_change_records_what_it_used_to_be(): void
    {
        $product = $this->product();

        $this->login()->putJson("/api/v1/products/{$product->id}", [
            'name' => $product->name,
            'price' => 210,
        ])->assertOk();

        $rows = $this->rowsFor($product);

        $this->assertCount(1, $rows, 'a price moved and the trail has no row for it');
        // "It is 210 now" is on the product already. What a trail adds is 180.
        $this->assertSame('180.00', (string) $rows->first()->old_values['price']);
        $this->assertSame(210.0, (float) $rows->first()->new_values['price']);
        $this->assertSame($this->owner->id, $rows->first()->user_id, 'nobody was named');
    }

    public function test_creating_an_item_is_not_a_price_change(): void
    {
        $res = $this->login()->postJson('/api/v1/products', [
            'name' => 'Sugar 1kg',
            'price' => 180,
            'item_type' => 'physical_product',
        ])->assertCreated();

        $product = Product::query()->findOrFail($res->json('data.id'));

        $this->assertCount(0, $this->rowsFor($product),
            'a catalogue is not a sequence of decisions — a shop that opens with '
            .'five thousand items would have no trail left to read');
    }

    public function test_renaming_an_item_is_not_an_event(): void
    {
        $product = $this->product();

        $this->login()->putJson("/api/v1/products/{$product->id}", [
            'name' => 'Sugar, refined, 1kg',
            'price' => $product->price,
        ])->assertOk();

        $this->assertCount(0, $this->rowsFor($product),
            'a trail that records everything is a trail nobody reads to the bottom of');
    }

    public function test_the_cost_a_delivery_blends_is_not_filed_against_the_item(): void
    {
        // `cost` re-blends itself on every goods-received (weighted average),
        // so auditing it would file a row per line per delivery — none of them
        // anybody's decision. The shop's truer record of what it paid is the
        // purchase order line, with a date and a supplier against it.
        $product = $this->product(['cost' => 100]);

        $product->forceFill(['cost' => 120])->save();

        $this->assertCount(0, $this->rowsFor($product));
    }

    public function test_an_import_is_one_row_and_not_one_per_product(): void
    {
        // Three items already in the catalogue, each about to be re-priced.
        foreach (['SKU-A', 'SKU-B', 'SKU-C'] as $i => $sku) {
            $this->product(['sku' => $sku, 'name' => "Import Item {$i}", 'price' => 100]);
        }

        $csv = "name,sku,price\n"
            ."Import Item 0,SKU-A,150\n"
            ."Import Item 1,SKU-B,160\n"
            ."Import Item 2,SKU-C,170\n";

        $this->login()->post('/api/v1/products/import', [
            'file' => UploadedFile::fake()->createWithContent('prices.csv', $csv),
        ], ['Accept' => 'application/json'])->assertOk();

        $perProduct = AuditLog::query()
            ->where('auditable_type', Product::class)
            ->whereNotNull('auditable_id')
            ->count();
        $this->assertSame(0, $perProduct,
            'an import filed a row per item — 340 of them a second apart would push '
            .'every hand-made price change off the first page of the trail');

        $imports = AuditLog::query()
            ->where('auditable_type', Product::class)
            ->where('event', 'imported')
            ->get();

        $this->assertCount(1, $imports, 'the import itself left no record — suppressing '
            .'without recording is just making a write quiet');
        $this->assertSame(3, $imports->first()->new_values['updated']);
        $this->assertSame($this->owner->id, $imports->first()->user_id);

        // And the prices really did move, so the check above is about the trail
        // rather than about an import that quietly did nothing.
        $this->assertSame('150.00', (string) Product::query()->where('sku', 'SKU-A')->value('price'));
    }

    public function test_a_row_names_which_item_it_is_about(): void
    {
        // The trail named a KIND and never a subject, so a price change read
        // "Item price · 180 → 210" about one of four thousand items. A row that
        // cannot name what it is about is a row nobody can act on.
        $product = $this->product(['name' => 'Sugar 1kg']);

        $this->login()->putJson("/api/v1/products/{$product->id}", [
            'name' => 'Sugar 1kg', 'price' => 210,
        ])->assertOk();

        $res = $this->login()->getJson("/api/v1/audit-logs?type=Product&record={$product->id}")->assertOk();

        $this->assertSame('Sugar 1kg', $res->json('data.0.subject'));
    }

    public function test_an_import_is_about_no_single_item_and_says_so(): void
    {
        $this->product(['sku' => 'SUB-1', 'name' => 'Subject Item', 'price' => 100]);

        $this->login()->post('/api/v1/products/import', [
            'file' => UploadedFile::fake()->createWithContent(
                'prices.csv', "name,sku,price\nSubject Item,SUB-1,150\n"
            ),
        ], ['Accept' => 'application/json'])->assertOk();

        $row = collect($this->login()->getJson('/api/v1/audit-logs?type=Product')->json('data'))
            ->firstWhere('event', 'imported');

        $this->assertNotNull($row, 'the import left no record');
        $this->assertNull($row['subject'], 'an import belongs to no single product');
        $this->assertNull($row['entity_id']);
    }

    public function test_a_shop_can_ask_the_trail_about_one_item(): void
    {
        $mine = $this->product();
        $other = $this->product(['sku' => 'OTHER-1']);

        $this->login()->putJson("/api/v1/products/{$mine->id}", ['name' => $mine->name, 'price' => 210])->assertOk();
        $this->login()->putJson("/api/v1/products/{$other->id}", ['name' => $other->name, 'price' => 999])->assertOk();

        $res = $this->login()->getJson("/api/v1/audit-logs?type=Product&record={$mine->id}")->assertOk();

        $ids = collect($res->json('data'))->pluck('id');
        $this->assertCount(1, $ids, 'the trail could be asked about a KIND of thing and '
            .'not about a thing — which is the question a shopkeeper arrives with');
    }
}
