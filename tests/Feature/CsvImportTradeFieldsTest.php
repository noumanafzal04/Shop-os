<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\TaxGroup;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * A bulk import has to load a WHOLE item, not the half every trade shares.
 *
 * The importer's column whitelist drops any header it does not know, in
 * silence. So a medical store could import `generic_name` but not `strength`,
 * and a restaurant could import its menu with no station on any dish — the file
 * uploaded, the summary said "created", and the catalog arrived incomplete with
 * nothing anywhere saying so. That is worse than a refusal: the merchant
 * believes the job is done.
 *
 * One test per trade, each loading the field that trade cannot operate without.
 */
class CsvImportTradeFieldsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    public function test_a_pharmacy_imports_the_whole_medicine(): void
    {
        $shop = $this->shop('pharmacy');

        $this->upload($shop, <<<'CSV'
        name,item_type,sku,price,generic_name,strength,dosage_form,drug_schedule,requires_prescription
        Augmentin 625mg,medicine,AUG-625,450,Amoxicillin + Clavulanic Acid,625mg,Tablet,Schedule G,1
        CSV)->assertOk();

        $med = Product::withoutTenancy()->where('sku', 'AUG-625')->firstOrFail();

        $this->assertSame('Amoxicillin + Clavulanic Acid', $med->generic_name);
        $this->assertSame('625mg', $med->strength);
        $this->assertSame('Tablet', $med->dosage_form);
        $this->assertSame('Schedule G', $med->drug_schedule);
        $this->assertTrue((bool) $med->requires_prescription);
    }

    public function test_a_restaurant_imports_the_station_each_dish_is_made_at(): void
    {
        // Without it every dish routes to one printer, so the bar gets the
        // biryani — the exact failure kitchen stations exist to prevent.
        $shop = $this->shop('restaurant');

        $this->upload($shop, <<<'CSV'
        name,item_type,sku,price,kitchen_station
        Chicken Karahi,food_item,KAR-01,1400,Kitchen
        Fresh Lime Soda,food_item,LIME-01,250,Bar
        CSV)->assertOk();

        $this->assertSame('Kitchen', Product::withoutTenancy()->where('sku', 'KAR-01')->value('kitchen_station'));
        $this->assertSame('Bar', Product::withoutTenancy()->where('sku', 'LIME-01')->value('kitchen_station'));
    }

    public function test_a_phone_shop_imports_handsets_that_can_be_looked_up_under_warranty(): void
    {
        $shop = $this->shop('retail');

        $this->upload($shop, <<<'CSV'
        name,item_type,sku,price,tracks_serial,warranty_months,wholesale_price
        Galaxy A16,physical_product,SGA16,52000,1,12,49000
        CSV)->assertOk();

        $phone = Product::withoutTenancy()->where('sku', 'SGA16')->firstOrFail();

        $this->assertTrue((bool) $phone->tracks_serial);
        $this->assertSame(12, (int) $phone->warranty_months);
        $this->assertEquals(49000, $phone->wholesale_price);
    }

    public function test_a_workshop_imports_how_long_a_job_takes(): void
    {
        $shop = $this->shop('services');

        $this->upload($shop, <<<'CSV'
        name,item_type,sku,price,duration_minutes,description
        Full Service,service,SRV-FULL,3500,90,Oil filter and a check over
        CSV)->assertOk();

        $job = Product::withoutTenancy()->where('sku', 'SRV-FULL')->firstOrFail();

        $this->assertSame(90, (int) $job->duration_minutes);
        $this->assertSame('Oil filter and a check over', $job->description);
    }

    public function test_a_tax_group_is_matched_by_name(): void
    {
        $shop = $this->shop('mart');
        $group = TaxGroup::withoutTenancy()->create([
            'tenant_id' => $shop->id, 'name' => 'GST 17%', 'rate' => 17, 'is_active' => true,
        ]);

        $this->upload($shop, <<<'CSV'
        name,item_type,sku,price,tax_group
        Cooking Oil 5L,physical_product,OIL-5L,2800,GST 17%
        CSV)->assertOk();

        $this->assertSame($group->id, Product::withoutTenancy()->where('sku', 'OIL-5L')->value('tax_group_id'));
    }

    public function test_an_unknown_tax_group_is_left_off_rather_than_invented(): void
    {
        // A category can be created from a typo and costs nothing. A tax group
        // is a RATE — inventing one would price the whole import wrong and look
        // deliberate, so the item falls back to the shop's default instead.
        $shop = $this->shop('mart');

        $this->upload($shop, <<<'CSV'
        name,item_type,sku,price,tax_group
        Cooking Oil 5L,physical_product,OIL-5L,2800,GTS 17%
        CSV)->assertOk();

        $this->assertNull(Product::withoutTenancy()->where('sku', 'OIL-5L')->value('tax_group_id'));
        $this->assertSame(0, TaxGroup::withoutTenancy()->where('tenant_id', $shop->id)->count());
    }

    public function test_a_blank_stock_tracking_column_leaves_the_item_type_to_decide(): void
    {
        // The trap this guards: defaulting the boolean to false would switch
        // stock tracking OFF across a whole catalog on a re-import, and the
        // summary would call it a successful update.
        $shop = $this->shop('mart');

        $this->upload($shop, <<<'CSV'
        name,item_type,sku,price,track_inventory
        Tracked Rice,physical_product,RICE-1,300,
        CSV)->assertOk();

        $this->assertTrue((bool) Product::withoutTenancy()->where('sku', 'RICE-1')->value('track_inventory'));
    }

    public function test_a_column_the_importer_does_not_know_is_still_ignored(): void
    {
        // The whitelist is the point — a stray column must not reach the model.
        $shop = $this->shop('mart');

        $this->upload($shop, <<<'CSV'
        name,item_type,sku,price,tenant_id
        Sugar,physical_product,SUG-1,180,not-a-tenant
        CSV)->assertOk();

        $this->assertSame($shop->id, Product::withoutTenancy()->where('sku', 'SUG-1')->value('tenant_id'));
    }

    public function test_creating_a_product_over_http_saves_the_three_columns_that_were_dropped(): void
    {
        // Not a CSV concern — the bug was in CreateProductAction, which names
        // its columns one by one and was missing these three. The request
        // validated them and the form sent them, so they arrived at the action
        // and were thrown away. UpdateProductAction fills the model wholesale,
        // which is why each one saved on the SECOND press of Save: the field
        // looked like it worked, which is the worst shape this can take.
        $shop = $this->shop('pharmacy');
        $owner = User::factory()->shopOwner($shop)->create();
        $token = $owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        $group = TaxGroup::withoutTenancy()->create([
            'tenant_id' => $shop->id, 'name' => 'GST 17%', 'rate' => 17, 'is_active' => true,
        ]);

        $this->withToken($token)->postJson('/api/v1/products', [
            'name' => 'Alprazolam 0.5mg',
            'item_type' => 'medicine',
            'price' => 250,
            'drug_schedule' => 'Schedule X',
            'tax_group_id' => $group->id,
            'kitchen_station' => 'Kitchen',
        ])->assertCreated();

        $med = Product::withoutTenancy()->where('name', 'Alprazolam 0.5mg')->firstOrFail();

        $this->assertSame('Schedule X', $med->drug_schedule);
        $this->assertSame($group->id, $med->tax_group_id);
        $this->assertSame('Kitchen', $med->kitchen_station);
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    private function shop(string $type): Tenant
    {
        return Tenant::factory()->create([
            'setup_completed' => true,
            'business_type' => $type,
            'features' => BusinessTypes::defaultFeatures($type),
        ]);
    }

    private function upload(Tenant $shop, string $csv)
    {
        $owner = User::factory()->shopOwner($shop)->create();
        $token = $owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        // Heredocs are indented for readability; the parser wants flush lines.
        $flat = implode("\n", array_map('trim', explode("\n", trim($csv))));

        return $this->withToken($token)->post('/api/v1/products/import', [
            'file' => UploadedFile::fake()->createWithContent('products.csv', $flat),
        ], ['Accept' => 'application/json']);
    }
}
