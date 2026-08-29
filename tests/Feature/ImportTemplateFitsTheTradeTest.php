<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\ProductCsv;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * THE TEMPLATE A SHOP IS GIVEN MUST BE ONE IT CAN USE.
 *
 * One template went to every trade — thirty-two columns and six worked rows,
 * a sugar, a Panadol, a karahi, a phone, a service — while the importer
 * refuses an item type the trade may not catalog. Two lists, and they
 * disagreed. Proven against the live panel before any of this was written: a
 * restaurant downloaded the template and uploaded it back UNCHANGED and got
 *
 *     Imported 4 new, 2 failed.
 *       row 3 -> Item type "medicine" isn't available for this business type.
 *       row 7 -> Item type "service" isn't available for this business type.
 *
 * Both halves of that are bugs. We handed out a file we then refused, and the
 * four rows that DID succeed put Loose Sugar and a Galaxy A16 into a
 * restaurant's catalog.
 */
class ImportTemplateFitsTheTradeTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'setup_completed' => true,
            'city_id' => $city->id,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function templateFor(string $businessType): string
    {
        // The features move WITH the type. A shop that changed trade and kept
        // the old feature map is not a shop, it is a fixture artefact — and
        // `itemTypesFor` reads the features, so it would answer for the wrong
        // one and this whole test would be measuring nothing.
        $this->shop->update([
            'business_type' => $businessType,
            'features' => BusinessTypes::defaultFeatures($businessType),
        ]);

        $res = $this->actingAsUser($this->owner)->get('/api/v1/products/import/template');
        $res->assertOk();

        return ltrim($res->streamedContent(), "\xEF\xBB\xBF");
    }

    /** @return array<string, mixed> */
    private function importBack(string $csv): array
    {
        return $this->actingAsUser($this->owner)->post('/api/v1/products/import', [
            'file' => UploadedFile::fake()->createWithContent('catalog.csv', $csv),
        ], ['Accept' => 'application/json'])->assertOk()->json('data');
    }

    public function test_a_shop_can_upload_its_own_template_unchanged(): void
    {
        // THE BUG, as the shop met it. Not "does the template parse" — does the
        // file we hand a restaurant survive being handed straight back.
        foreach (['food', 'mart', 'pharmacy', 'retail'] as $trade) {
            $result = $this->importBack($this->templateFor($trade));

            $this->assertSame(
                0,
                $result['failed'],
                "a {$trade} shop's own template was refused by the importer: ".json_encode($result['errors']),
            );
            // …and it really did contain rows. A template that narrowed itself
            // to nothing passes the line above without meaning anything.
            $this->assertGreaterThan(0, $result['total'], "the {$trade} template had no rows at all");
        }
    }

    public function test_a_restaurant_is_not_offered_a_chemists_columns(): void
    {
        $header = explode("\n", trim($this->templateFor('food')))[0];

        foreach (['Dosage Form', 'Drug Schedule', 'Strength', 'Warranty Months'] as $notMine) {
            $this->assertStringNotContainsString($notMine, $header, "a restaurant was offered {$notMine}");
        }
        // The denominator: it still has the columns it DOES need.
        $this->assertStringContainsString('Kitchen Station', $header);
        $this->assertStringContainsString('Price', $header);
    }

    public function test_a_chemist_keeps_the_columns_only_a_chemist_has(): void
    {
        $header = explode("\n", trim($this->templateFor('pharmacy')))[0];

        $this->assertStringContainsString('Dosage Form', $header);
        $this->assertStringContainsString('Requires Prescription', $header);
        $this->assertStringNotContainsString('Kitchen Station', $header);
    }

    public function test_the_sample_rows_say_they_are_samples(): void
    {
        // They import cleanly, which means they DO become products. Somebody
        // uploading the template as it stands has to be able to see instantly
        // which rows are ours — the old ones were "Loose Sugar" and "Galaxy
        // A16", indistinguishable from real stock.
        $this->importBack($this->templateFor('mart'));

        $names = Product::withoutTenancy()->where('tenant_id', $this->shop->id)->pluck('name');
        $this->assertNotEmpty($names);
        foreach ($names as $name) {
            $this->assertStringContainsString('EXAMPLE', $name, "sample row \"{$name}\" does not say it is one");
        }
    }

    public function test_every_template_column_is_one_the_importer_reads(): void
    {
        // A column offered and then silently dropped is worse than one missing:
        // the merchant fills it in and the data never arrives.
        foreach (['food', 'mart', 'pharmacy', 'retail', 'services', 'automotive'] as $trade) {
            $header = str_getcsv(explode("\n", trim($this->templateFor($trade)))[0]);

            foreach ($header as $column) {
                $this->assertContains(
                    ProductCsv::normalise((string) $column),
                    array_keys(ProductCsv::HEADERS),
                    "a {$trade} template offers \"{$column}\", which maps to no known field",
                );
            }
        }
    }
}
