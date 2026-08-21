<?php

namespace Tests\Feature;

use App\Actions\Inventory\NotifyExpiringStock;
use App\Models\AppNotification;
use App\Models\City;
use App\Models\Product;
use App\Models\ProductBatch;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use Tests\TestCase;

/**
 * Telling a shop its stock is about to die, before it does.
 *
 * ── Why this was missing for so long ────────────────────────────────────
 *
 * Every part of the answer was already built. Batches carry expiry dates, the
 * dashboard counts what is near, the pharmacy screen lists it, Disposals knows
 * the difference between binned and returned-to-supplier. **All of it
 * pull-only** — so a shop learned its stock was dying on the day somebody
 * happened to go and look.
 *
 * Expiry is the only loss in a shop that makes no noise at all. Nothing
 * breaks, no figure looks wrong, and the stock sits on the shelf looking
 * exactly like stock. It stops being money on a specific date and nobody is
 * told.
 *
 * ── The assertion that carries this feature ─────────────────────────────
 *
 * Not that it alerts — that is the easy half. That it alerts **once**.
 *
 * A daily "you have 43 items expiring" is worse than silence: it is the same
 * sentence every morning, so it stops being read within a week, and then the
 * morning it says 44 nobody notices that either. `test_a_lot_is_mentioned_once`
 * is the one that keeps this feature worth having.
 */
class ExpiringStockAlertTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $pharmacy;

    private User $owner;

    private Product $syrup;

    protected function setUp(): void
    {
        parent::setUp();

        $city = City::query()->create(['name' => 'Multan', 'is_active' => true]);
        $this->pharmacy = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'pharmacy', 'features' => BusinessTypes::defaultFeatures('pharmacy'),
        ]);
        $this->owner = User::factory()->shopOwner($this->pharmacy)->create();

        $this->syrup = Product::withoutTenancy()->create([
            'tenant_id' => $this->pharmacy->id, 'type' => 'product', 'item_type' => 'medicine',
            'name' => 'Cough syrup', 'price' => 250, 'track_inventory' => true,
        ]);
    }

    private function lot(string $number, int $daysToExpiry, float $qty = 10, ?Tenant $of = null, ?Product $for = null): ProductBatch
    {
        return ProductBatch::withoutTenancy()->create([
            'tenant_id' => ($of ?? $this->pharmacy)->id,
            'product_id' => ($for ?? $this->syrup)->id,
            'batch_number' => $number,
            'expiry_date' => now()->addDays($daysToExpiry)->toDateString(),
            'quantity' => $qty,
        ]);
    }

    private function sweep(): array
    {
        return app(NotifyExpiringStock::class)->run();
    }

    /** @return Collection<int, AppNotification> */
    private function alerts(?string $stage = null)
    {
        return AppNotification::query()
            ->where('user_id', $this->owner->id)
            ->when($stage !== null, fn ($q) => $q->where('type', "stock.expiry.{$stage}"))
            ->when($stage === null, fn ($q) => $q->where('type', 'like', 'stock.expiry.%'))
            ->get();
    }

    /**
     * The alert arrives KNOWING where it is sending the chemist.
     *
     * This class's own docblock has always said the expired alert "Links to
     * Disposals". It did not: `DeepLinks` tested `stock.low` for exact equality,
     * so both expiry types fell through to null and the whole point of the
     * alert — routing somebody to the screen that records where the stock went —
     * was the one thing it could not do. Tapping the push opened the app to
     * whatever screen it was already on.
     *
     * Asserted here, on the real sweep, rather than only against the mapping in
     * isolation: the link is stamped on the way through `NotificationService`,
     * and a mapping that is right while the plumbing drops it is no better.
     */
    public function test_an_alert_carries_the_screen_it_wants_opened(): void
    {
        $this->lot('B1', 40);
        $this->lot('B2', -5); // already past its date

        $this->sweep();

        $alerts = $this->alerts();
        $this->assertCount(2, $alerts, 'expected one approaching and one expired alert');

        foreach ($alerts as $alert) {
            $this->assertSame(
                'disposals',
                $alert->data['link'] ?? null,
                "the {$alert->type} alert was raised with nowhere to go",
            );
        }
    }

    public function test_a_lot_inside_the_window_is_reported(): void
    {
        $this->lot('B1', 40);

        $this->sweep();

        $this->assertCount(1, $this->alerts('approaching'));
    }

    public function test_a_lot_is_mentioned_once(): void
    {
        // THE assertion. A shop that hears the same sentence every morning
        // stops reading it, and then the morning it changes nobody notices.
        $this->lot('B1', 40);

        $this->sweep();
        $this->sweep();
        $this->sweep();

        $this->assertCount(1, $this->alerts('approaching'));
    }

    public function test_the_same_lot_speaks_again_when_it_actually_expires(): void
    {
        // Twice in its life, and they are different sentences: one says there
        // is still time to sell or return it, the other says it cannot be sold
        // and asks where it is going.
        $lot = $this->lot('B1', 40);
        $this->sweep();

        $lot->forceFill(['expiry_date' => now()->subDay()->toDateString()])->save();
        $this->sweep();

        $this->assertCount(1, $this->alerts('approaching'));
        $this->assertCount(1, $this->alerts('expired'));
    }

    public function test_a_lot_beyond_the_window_is_left_alone(): void
    {
        // A pharmacy's window is 90 days. Something a year out is not news,
        // and treating it as news is how the ninety-day alert gets ignored.
        $this->lot('B1', 400);

        $this->sweep();

        $this->assertCount(0, $this->alerts());
    }

    public function test_the_window_is_the_shop_s_own_and_not_a_constant(): void
    {
        // 90 for a chemist, 30 for everybody else. A grocer told about milk
        // ninety days out learns to ignore the alert entirely.
        $mart = Tenant::factory()->create([
            'setup_completed' => true, 'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $grocer = User::factory()->shopOwner($mart)->create();
        $milk = Product::withoutTenancy()->create([
            'tenant_id' => $mart->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Milk', 'price' => 200, 'track_inventory' => true,
        ]);
        $this->lot('M1', 60, 10, $mart, $milk);

        $this->sweep();

        // 60 days out: inside a chemist's 90, outside a grocer's 30.
        $this->assertSame(0, AppNotification::query()->where('user_id', $grocer->id)->count());
    }

    public function test_an_empty_lot_is_not_a_problem_waiting_to_happen(): void
    {
        // Sold out or already written off. Telling a shop about it would be
        // telling it about a problem it has already dealt with.
        $this->lot('B1', 10, 0);

        $this->sweep();

        $this->assertCount(0, $this->alerts());
    }

    public function test_a_lot_with_no_expiry_date_is_never_chased(): void
    {
        ProductBatch::withoutTenancy()->create([
            'tenant_id' => $this->pharmacy->id, 'product_id' => $this->syrup->id,
            'batch_number' => 'NOEXP', 'expiry_date' => null, 'quantity' => 5,
        ]);

        $this->sweep();

        $this->assertCount(0, $this->alerts());
    }

    public function test_the_expired_alert_says_where_the_stock_should_go(): void
    {
        // The two answers are opposite — binned is a loss, returned to the
        // supplier is money owed to the shop — and Disposals is the screen
        // that keeps them apart. An alert that only said "expired" would leave
        // the shop to guess.
        $this->lot('B1', -5);

        $this->sweep();

        $body = $this->alerts('expired')->first()->body;

        $this->assertStringContainsString('Disposals', $body);
        $this->assertStringContainsString('cannot be sold', $body);
    }

    public function test_one_shop_is_never_flooded_in_a_single_run(): void
    {
        // The first run against an existing chemist is the awkward one: every
        // lot already inside the window crosses it at once. Nothing is lost by
        // spreading it — the dedupe means tomorrow picks up the rest.
        for ($i = 0; $i < NotifyExpiringStock::MAX_PER_TENANT_PER_RUN + 5; $i++) {
            $this->lot("B{$i}", 40);
        }

        $this->sweep();

        $this->assertCount(NotifyExpiringStock::MAX_PER_TENANT_PER_RUN, $this->alerts());

        // …and the remainder arrive on the next run rather than being dropped.
        $this->sweep();

        $this->assertCount(NotifyExpiringStock::MAX_PER_TENANT_PER_RUN + 5, $this->alerts());
    }

    public function test_already_dead_stock_is_reported_before_stock_that_still_has_time(): void
    {
        // If a run is capped, the lots that can no longer be sold matter more
        // than the ones with weeks left on them.
        for ($i = 0; $i < NotifyExpiringStock::MAX_PER_TENANT_PER_RUN; $i++) {
            $this->lot("SOON{$i}", 40);
        }
        $this->lot('DEAD', -3);

        $this->sweep();

        $this->assertCount(1, $this->alerts('expired'));
    }

    public function test_one_shop_is_never_told_about_another_shop_s_stock(): void
    {
        $other = Tenant::factory()->create([
            'setup_completed' => true, 'business_type' => 'pharmacy',
            'features' => BusinessTypes::defaultFeatures('pharmacy'),
        ]);
        $stranger = User::factory()->shopOwner($other)->create();
        $this->lot('B1', 40);

        $this->sweep();

        $this->assertSame(0, AppNotification::query()->where('user_id', $stranger->id)->count());
    }
}
