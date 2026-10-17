<?php

namespace Tests\Feature;

use App\Models\OfflineRefusal;
use App\Models\PosDevice;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * B49 (the tester, pass 4): a sale rung offline and then refused — an item
 * deleted or switched off since — left the money in the drawer against no
 * sale, and the only record of it sat on that one tablet. The red strip never
 * cleared, the sale could not be rung again, and the owner never heard.
 *
 * Now the refusal is kept on the server the moment it is made, listed in
 * Reports → Offline until settled, and settled from the till: rung again as a
 * named sale, or dealt with another way, with a note and a name.
 */
class ARefusedOfflineSaleIsKeptTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private User $cashier;

    private Product $gone;

    private Product $off;

    private Product $milk;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->travelTo('2026-10-17 12:00:00');

        $shop = Tenant::factory()->create([
            'setup_completed' => true, 'business_type' => 'mart', 'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($shop)->create();
        $this->cashier = User::factory()->tenantStaff($shop, ['sales.manage'])->create(['name' => 'Bilal']);
        $make = fn (string $name, int $price) => Product::query()->create([
            'tenant_id' => $shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => $name, 'price' => $price, 'stock_quantity' => 20, 'track_inventory' => true, 'is_active' => true,
        ]);
        $this->gone = $make('Old Shampoo', 1200);
        $this->off = $make('Seasonal Mango', 300);
        $this->milk = $make('Milkpak 1L', 100);
        // While the till was offline: one item deleted, one switched off.
        $this->gone->delete();
        $this->off->forceFill(['is_active' => false])->save();
    }

    public function test_a_refused_sale_is_kept_for_the_owner_and_listed_until_settled(): void
    {
        $op = (string) Str::uuid();
        $answer = $this->sync($op, $this->gone, 1200)->json('data.results.0');
        $this->assertSame('failed', $answer['status']);
        $this->assertFalse($answer['retryable']);

        $kept = OfflineRefusal::query()->where('op', $op)->sole();
        $this->assertSame('OFF-L1-AB-000007', $kept->offline_number);
        $this->assertEquals(1200, $kept->till_total, 'how much sits in the drawer with no sale');
        $this->assertSame($this->cashier->id, $kept->rung_by);
        $this->assertStringContainsString('deleted since it was rung', $kept->reason);
        $this->assertSame($this->gone->id, $kept->payload['items'][0]['product_id']);

        // The till asks again (a lost answer): still one record.
        $this->sync($op, $this->gone, 1200);
        $this->assertSame(1, OfflineRefusal::query()->count());

        $report = $this->as($this->owner)->getJson('/api/v1/reports/offline')->assertOk()->json('data');
        $this->assertSame(1, $report['summary']['refused_owed']);
        $this->assertEquals(1200, $report['summary']['refused_owed_total']);
        $this->assertSame('Bilal', $report['refused'][0]['rung_by']);
        $this->assertNull($report['refused'][0]['settled_as']);

        // The till that rang it is gone (broken, wiped): the owner settles it
        // from the report, by the id the report hands back.
        $this->as($this->owner)->postJson("/api/v1/pos/refused-sales/{$report['refused'][0]['op']}/settle", [
            'how' => 'dealt_with', 'note' => 'Counted into the day by hand',
        ])->assertOk();
        $this->assertSame(0, $this->as($this->owner)->getJson('/api/v1/reports/offline')->json('data.summary.refused_owed'));
    }

    public function test_it_is_settled_with_a_note_or_as_the_sale_that_rang_it_again(): void
    {
        $handedBack = (string) Str::uuid();
        $rungAgain = (string) Str::uuid();
        $another = (string) Str::uuid();
        foreach ([$handedBack, $rungAgain, $another] as $op) {
            $this->assertSame('failed', $this->sync($op, $this->off, 300)->json('data.results.0.status'));
        }

        // "Dealt with" says how, or it is not settled.
        $this->settle($handedBack, ['how' => 'dealt_with'])->assertStatus(422);
        $this->settle($handedBack, ['how' => 'dealt_with', 'note' => 'Money handed back to the customer'])->assertOk();

        // Rung again at the till as a real sale, which is named.
        $sale = $this->as($this->cashier)->postJson('/api/v1/sales', [
            'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => 300,
            'items' => [['product_id' => $this->milk->id, 'quantity' => 3]],
        ])->assertCreated()->json('data');
        $this->settle($rungAgain, ['how' => 'rung_again', 'sale_id' => $sale['id']])->assertOk()
            ->assertJsonPath('data.sale.invoice_number', $sale['invoice_number']);
        // A retry is the same answer; a different settlement is refused.
        $this->settle($rungAgain, ['how' => 'rung_again', 'sale_id' => $sale['id']])->assertOk();
        $this->settle($rungAgain, ['how' => 'dealt_with', 'note' => 'Changed my mind'])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'REFUSAL_SETTLED');
        // One sale stands for one refused sale.
        $this->settle($another, ['how' => 'rung_again', 'sale_id' => $sale['id']])
            ->assertStatus(409)->assertJsonPath('meta.error_code', 'SALE_ALREADY_SETTLES');

        $report = $this->as($this->owner)->getJson('/api/v1/reports/offline')->assertOk()->json('data');
        $this->assertSame(1, $report['summary']['refused_owed'], 'only the third is still owed');
        $rows = collect($report['refused'])->keyBy('settled_as');
        $this->assertSame('Money handed back to the customer', $rows['dealt_with']['settled_note']);
        $this->assertSame('Bilal', $rows['dealt_with']['settled_by']);
        $this->assertSame($sale['invoice_number'], $rows['rung_again']['invoice_number']);
    }

    public function test_one_the_shop_never_kept_is_written_from_the_tills_copy_when_settled(): void
    {
        $op = (string) Str::uuid();

        $this->settle($op, [
            'how' => 'dealt_with', 'note' => 'Rung by hand on the old book',
            'offline_number' => 'OFF-L1-AB-000003', 'till_total' => 450, 'reason' => 'An item had been deleted.',
            'sold_at' => '2026-10-15T14:00:00+05:00',
        ])->assertOk();

        $kept = OfflineRefusal::query()->where('op', $op)->sole();
        $this->assertSame('OFF-L1-AB-000003', $kept->offline_number);
        $this->assertEquals(450, $kept->till_total);
        $this->assertSame('dealt_with', $kept->settled_as);
    }

    public function test_a_note_written_with_no_line_keeps_the_name_of_who_wrote_it(): void
    {
        $byCashier = (string) Str::uuid();
        $byStranger = (string) Str::uuid();
        $this->sync($byCashier, $this->off, 300);
        $this->sync($byStranger, $this->off, 300);
        $stranger = User::factory()->shopOwner(Tenant::factory()->create())->create();

        // The owner's login reconnects and sends what Bilal wrote offline.
        $this->as($this->owner)->postJson("/api/v1/pos/refused-sales/{$byCashier}/settle", [
            'how' => 'dealt_with', 'note' => 'Money handed back', 'settled_by' => $this->cashier->id,
        ])->assertOk();
        // A name from another shop is not taken: the sender is.
        $this->as($this->owner)->postJson("/api/v1/pos/refused-sales/{$byStranger}/settle", [
            'how' => 'dealt_with', 'note' => 'Money handed back', 'settled_by' => $stranger->id,
        ])->assertOk();

        $this->assertSame($this->cashier->id, OfflineRefusal::query()->where('op', $byCashier)->value('settled_by'));
        $this->assertSame($this->owner->id, OfflineRefusal::query()->where('op', $byStranger)->value('settled_by'));
    }

    public function test_a_refused_slips_number_is_never_printed_again(): void
    {
        $device = PosDevice::query()->create([
            'id' => (string) Str::uuid(), 'tenant_id' => $this->owner->tenant_id, 'name' => 'Counter tablet', 'last_seen_at' => now(),
        ]);
        $this->sync((string) Str::uuid(), $this->gone, 1200, device: $device->id);

        // The till's data was cleared: it asks where its counter had got to.
        $this->as($this->cashier)->getJson("/api/v1/pos/bootstrap?device_id={$device->id}")
            ->assertOk()->assertJsonPath('data.offline_sequence', 7);
    }

    public function test_a_sale_accepted_after_all_is_no_longer_owed(): void
    {
        $op = (string) Str::uuid();
        $this->sync($op, $this->off, 300);
        $this->off->forceFill(['is_active' => true])->save();

        $answer = $this->sync($op, $this->off, 300)->json('data.results.0');

        $this->assertSame('applied', $answer['status']);
        $kept = OfflineRefusal::query()->where('op', $op)->sole();
        $this->assertSame('recorded', $kept->settled_as);
        $this->assertSame($answer['sale_id'], $kept->sale_id);
    }

    public function test_a_practice_sale_is_not_kept(): void
    {
        $this->sync((string) Str::uuid(), $this->gone, 1200, training: true);

        $this->assertSame(0, OfflineRefusal::query()->count(), 'nothing in a practice drawer is real money');
    }

    private function sync(string $op, Product $item, float $total, bool $training = false, ?string $device = null): TestResponse
    {
        return $this->as($this->cashier)->postJson('/api/v1/pos/sync', [
            'device_id' => $device,
            'operations' => [[
                'op' => $op,
                'at' => now()->subHour()->toIso8601String(),
                'offline_number' => 'OFF-L1-AB-000007',
                'training' => $training,
                'till_total' => $total,
                'sale' => [
                    'channel' => 'pos', 'payment_method' => 'cash', 'amount_paid' => $total,
                    'items' => [['product_id' => $item->id, 'quantity' => 1]],
                ],
            ]],
        ])->assertOk();
    }

    private function settle(string $op, array $body): TestResponse
    {
        return $this->as($this->cashier)->postJson("/api/v1/pos/refused-sales/{$op}/settle", $body);
    }

    private function as(User $user): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($user->createToken('t', ['access'])->plainTextToken);
    }
}
