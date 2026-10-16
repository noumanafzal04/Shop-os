<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * ONE CODE HAS ONE OWNER — AN ITEM'S OWN CODE INCLUDED.
 *
 * Codex QA 2026-10-16 (BUG-71): "QA Lawn Suit" size S carried 8962026101601;
 * a new item was created with the same code and saved. The till's scan
 * happened to pick the size, but the catalogue held two owners for one code.
 * Sizes, extra codes and packs were already checked against everything; the
 * item's own code was checked against other items' own codes only.
 */
class OneCodeHasOneOwnerTest extends TestCase
{
    use RefreshDatabase;

    private const SIZE_S = '8962026101601';

    private const EXTRA = '8962026101700';

    private const CARTON = '8962026101800';

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->shop = Tenant::factory()->create([
            'setup_completed' => true, 'business_type' => 'retail',
            'features' => BusinessTypes::defaultFeatures('retail'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();

        $this->make([
            'name' => 'Lawn suit', 'price' => 2500,
            'variants' => [['name' => 'S', 'price' => 2500, 'barcode' => self::SIZE_S], ['name' => 'M', 'price' => 2500]],
        ])->assertCreated();
        $this->make(['name' => 'Biscuits', 'price' => 50, 'barcodes' => [self::EXTRA],
            'units' => [['name' => 'Carton', 'factor' => 24, 'price' => 1100, 'barcode' => self::CARTON]],
        ])->assertCreated();
    }

    private function make(array $item): TestResponse
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token)->postJson('/api/v1/products', [
            'type' => 'product', 'item_type' => 'physical_product', 'track_inventory' => false, ...$item,
        ]);
    }

    public function test_a_new_item_cannot_take_a_code_already_on_a_size_an_extra_or_a_pack(): void
    {
        foreach (['a size' => self::SIZE_S, 'an extra code' => self::EXTRA, 'a pack' => self::CARTON] as $where => $code) {
            $this->make(['name' => "Probe {$where}", 'price' => 990, 'barcode' => $code])
                ->assertStatus(422)
                ->assertJsonPath('meta.error_code', 'BARCODE_TAKEN');

            $this->assertFalse(
                Product::withoutTenancy()->where('name', "Probe {$where}")->exists(),
                "an item was saved with the code already on {$where}",
            );
        }
    }

    public function test_an_edit_cannot_move_an_item_onto_a_sizes_code_but_a_code_left_alone_is_not_asked_about(): void
    {
        $id = $this->make(['name' => 'Dupatta', 'price' => 900, 'barcode' => '8962026109999'])->assertCreated()->json('data.id');
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        $this->withToken($token)->putJson("/api/v1/products/{$id}", ['barcode' => self::SIZE_S])
            ->assertStatus(422)->assertJsonPath('meta.error_code', 'BARCODE_TAKEN');
        $this->assertSame('8962026109999', Product::withoutTenancy()->find($id)->barcode, 'the refused code was kept');

        // A code an item already holds is not re-judged by an unrelated edit.
        $this->withToken($token)->putJson("/api/v1/products/{$id}", ['name' => 'Chiffon dupatta', 'barcode' => '8962026109999'])->assertOk();
    }

    public function test_a_free_code_is_taken(): void
    {
        $this->make(['name' => 'Shawl', 'price' => 1500, 'barcode' => '8962026105555'])->assertCreated()
            ->assertJsonPath('data.barcode', '8962026105555');
    }
}
