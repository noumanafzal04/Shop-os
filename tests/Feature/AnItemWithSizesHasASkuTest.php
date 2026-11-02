<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\ParentSku;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * AN ITEM WITH SIZES HAS A SKU (garments round, #GS5, 2026-11-01).
 *
 * "Sitara Men's Kurta" had 8 sizes and no SKU. The export wrote it as ONE row:
 * a size row is tied to its item by the item's SKU, and with none there was
 * nothing to name the sizes by, so they were left out and nothing said so. An
 * export is also the shop's backup.
 *
 * Now an item is given a SKU when its first size or pack arrives, by whatever
 * door, and keeps it. Items made before are given theirs by a migration.
 */
class AnItemWithSizesHasASkuTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true,
            'business_type' => 'retail',
            'features' => BusinessTypes::defaultFeatures('retail'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->actingAs($this->owner);
    }

    /** @param array<string, mixed> $extra */
    private function kurta(array $extra = []): array
    {
        return $this->postJson('/api/v1/products', [
            'name' => "Sitara Men's Kurta", 'item_type' => 'physical_product', 'price' => 2950, 'track_inventory' => true,
            'variants' => [
                ['name' => 'S', 'price' => 2950, 'stock_quantity' => 2],
                ['name' => 'M', 'price' => 2950, 'stock_quantity' => 5],
                ['name' => 'L', 'price' => 2950, 'stock_quantity' => 3],
            ],
            ...$extra,
        ])->assertCreated()->json('data');
    }

    /** @return list<array<string, string>> the export, one row per line, keyed by its headings */
    private function exported(): array
    {
        $csv = $this->get('/api/v1/products/export')->assertOk()->streamedContent();
        $lines = array_values(array_filter(explode("\n", ltrim($csv, "\xEF\xBB\xBF")), fn (string $l): bool => trim($l) !== ''));
        $head = str_getcsv(array_shift($lines));

        return array_map(fn (string $l): array => array_combine($head, str_getcsv($l)), $lines);
    }

    private function stored(string $id): ?string
    {
        return DB::table('products')->where('id', $id)->value('sku');
    }

    public function test_an_item_made_with_sizes_and_no_sku_is_given_one_and_says_so(): void
    {
        $made = $this->kurta();

        $this->assertMatchesRegularExpression('/^ITEM-[0-9A-F]{6}$/', (string) $made['sku'], 'the answer shows the code it was given');
        $this->assertSame($made['sku'], $this->stored($made['id']));
    }

    /** THE POINT: the sizes are in the export, under their item. */
    public function test_its_sizes_are_in_the_export(): void
    {
        $made = $this->kurta();

        $rows = $this->exported();
        $this->assertCount(4, $rows, 'the item and its three sizes');
        $this->assertSame($made['sku'], $rows[0]['SKU']);
        $this->assertSame(['S', 'M', 'L'], array_column(array_slice($rows, 1), 'Name'));
        $this->assertSame([$made['sku'], $made['sku'], $made['sku']], array_column(array_slice($rows, 1), 'Parent SKU'));
    }

    public function test_an_item_with_its_own_sku_keeps_it(): void
    {
        $made = $this->kurta(['sku' => 'KUR-001']);

        $this->assertSame('KUR-001', $made['sku']);
        $this->assertSame('KUR-001', $this->stored($made['id']));
    }

    public function test_a_plain_item_is_not_given_a_code_it_did_not_ask_for(): void
    {
        $made = $this->postJson('/api/v1/products', ['name' => 'Gift wrap', 'item_type' => 'physical_product', 'price' => 50])->assertCreated()->json('data');

        $this->assertNull($made['sku']);
        $this->assertNull($this->stored($made['id']));
    }

    public function test_sizes_added_on_the_edit_form_give_the_item_a_code(): void
    {
        $made = $this->postJson('/api/v1/products', ['name' => 'Lawn Kurta', 'item_type' => 'physical_product', 'price' => 2950, 'track_inventory' => true])->assertCreated()->json('data');
        $this->assertNull($made['sku']);

        $edited = $this->putJson("/api/v1/products/{$made['id']}", [
            'variants' => [['name' => 'M', 'price' => 2950, 'stock_quantity' => 4], ['name' => 'L', 'price' => 2950, 'stock_quantity' => 1]],
        ])->assertOk()->json('data');

        $this->assertMatchesRegularExpression('/^ITEM-[0-9A-F]{6}$/', (string) $edited['sku']);
        $this->assertSame($edited['sku'], $this->stored($made['id']));
    }

    public function test_a_pack_gives_the_item_a_code_too(): void
    {
        $made = $this->postJson('/api/v1/products', [
            'name' => 'Biscuit 100g', 'item_type' => 'physical_product', 'price' => 50,
            'units' => [['name' => 'Carton', 'factor' => 24, 'price' => 1080]],
        ])->assertCreated()->json('data');

        $this->assertMatchesRegularExpression('/^ITEM-[0-9A-F]{6}$/', (string) $made['sku']);
        $this->assertSame(['Biscuit 100g', 'Carton'], array_column($this->exported(), 'Name'));
    }

    public function test_a_cleared_code_on_an_item_with_sizes_is_kept_and_on_a_plain_item_is_cleared(): void
    {
        $kurta = $this->kurta(['sku' => 'KUR-001']);
        $this->putJson("/api/v1/products/{$kurta['id']}", ['sku' => null])->assertOk()->assertJsonPath('data.sku', 'KUR-001');
        $this->assertSame('KUR-001', $this->stored($kurta['id']));

        $wrap = $this->postJson('/api/v1/products', ['name' => 'Gift wrap', 'item_type' => 'physical_product', 'price' => 50, 'sku' => 'WRAP'])->assertCreated()->json('data');
        $this->putJson("/api/v1/products/{$wrap['id']}", ['sku' => null])->assertOk()->assertJsonPath('data.sku', null);
    }

    /** SKUs are one list across items AND sizes in a shop; a code already taken is never handed out twice. */
    public function test_a_code_already_taken_by_an_item_or_a_size_is_not_given_again(): void
    {
        app(TenantContext::class)->set($this->shop);
        $item = Product::query()->create(['name' => 'Shawl', 'type' => 'product', 'item_type' => 'physical_product', 'price' => 900]);
        $base = 'ITEM-'.strtoupper(substr(str_replace('-', '', $item->id), -6));

        Product::query()->create(['name' => 'Other', 'type' => 'product', 'item_type' => 'physical_product', 'price' => 1, 'sku' => $base]);
        $holder = Product::query()->create(['name' => 'Holder', 'type' => 'product', 'item_type' => 'physical_product', 'price' => 1, 'sku' => 'HOLD']);
        $holder->variants()->create(['tenant_id' => $this->shop->id, 'name' => 'One', 'price' => 1, 'sku' => $base.'-2']);

        $this->assertTrue(ParentSku::give($item));
        $this->assertSame($base.'-3', $item->sku);
    }

    /** The items made before: a migration gives each its code, and leaves plain items alone. */
    public function test_items_made_before_are_given_their_code_by_the_migration(): void
    {
        $sized = (string) Str::uuid7();
        $plain = (string) Str::uuid7();
        $packed = (string) Str::uuid7();
        $row = fn (string $id, string $name): array => [
            'id' => $id, 'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => $name, 'sku' => null, 'price' => 100, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()->subDay(),
        ];
        // Straight into the tables, as the old code left them — no model, so no rule.
        DB::table('products')->insert([$row($sized, 'Old kurta'), $row($plain, 'Old wrap'), $row($packed, 'Old biscuit')]);
        DB::table('product_variants')->insert([
            'id' => (string) Str::uuid7(), 'tenant_id' => $this->shop->id, 'product_id' => $sized, 'name' => 'M', 'price' => 100,
            'stock_quantity' => 1, 'is_active' => true, 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('product_units')->insert([
            'id' => (string) Str::uuid7(), 'tenant_id' => $this->shop->id, 'product_id' => $packed, 'name' => 'Carton', 'factor' => 24,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $before = DB::table('products')->where('id', $sized)->value('updated_at');

        (require database_path('migrations/2026_11_02_000001_an_item_with_sizes_has_a_sku.php'))->up();

        $this->assertMatchesRegularExpression('/^ITEM-[0-9A-F]{6}$/', (string) $this->stored($sized));
        $this->assertMatchesRegularExpression('/^ITEM-[0-9A-F]{6}$/', (string) $this->stored($packed));
        $this->assertNull($this->stored($plain));
        $this->assertNotEquals($before, DB::table('products')->where('id', $sized)->value('updated_at'), 'the till hears of the new code');
    }
}
