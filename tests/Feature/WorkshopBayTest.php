<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Product;
use App\Models\SaleDocument;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * A workshop's morning question, which no other trade asks.
 *
 * The dashboard already carried a deliberate per-trade panel — "what THIS trade
 * needs and nobody else does" — with exactly two implementations: the dining
 * floor for food and the dispensing count for a pharmacy. **Automotive had
 * none**, while the bay board and every figure behind it had shipped two days
 * earlier.
 *
 * So a workshop owner opened the app and was shown low stock — true, and not
 * what anybody runs a workshop on.
 *
 * The figure that makes this worth a panel rather than a shortcut is READY:
 * a job marked ready is finished work, and if the document is still open,
 * nobody has charged for it. A car collected without the card being converted
 * is work the shop will never be paid for, and that number existed nowhere.
 */
class WorkshopBayTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $workshop;

    private User $owner;

    private Product $labour;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Rawalpindi', 'is_active' => true]);
        $this->workshop = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'automotive', 'features' => BusinessTypes::defaultFeatures('automotive'),
        ]);
        $this->owner = User::factory()->shopOwner($this->workshop)->create();

        $this->labour = Product::withoutTenancy()->create([
            'tenant_id' => $this->workshop->id, 'type' => 'service', 'item_type' => 'service',
            'name' => 'Diagnostic hour', 'price' => 2000, 'track_inventory' => false,
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withHeader('Authorization', "Bearer {$token}");
    }

    /** Book a car in, then move it to a stage. */
    private function bookIn(string $stage, float $price, ?string $promisedAt = null): array
    {
        Product::withoutTenancy()->whereKey($this->labour->id)->update(['price' => $price]);

        $doc = $this->actingAsUser($this->owner)->postJson('/api/v1/sale-documents', [
            'kind' => 'job_card',
            'complaint' => 'Noise from the front left',
            'promised_at' => $promisedAt,
            'items' => [['product_id' => $this->labour->id, 'quantity' => 1]],
        ])->assertCreated()->json('data');

        if ($stage !== SaleDocument::WORK_RECEIVED) {
            $this->actingAsUser($this->owner)
                ->postJson("/api/v1/sale-documents/{$doc['id']}/work-status", ['work_status' => $stage])
                ->assertOk();
        }

        return $doc;
    }

    private function bay(): ?array
    {
        return $this->actingAsUser($this->owner)
            ->getJson('/api/v1/dashboard')->assertOk()->json('data.bay');
    }

    public function test_a_workshop_is_shown_what_is_in_its_bay(): void
    {
        $this->bookIn(SaleDocument::WORK_RECEIVED, 3000);
        $this->bookIn(SaleDocument::WORK_IN_PROGRESS, 5000);

        $bay = $this->bay();

        $this->assertSame(1, $bay['received']['cars']);
        $this->assertSame(1, $bay['in_progress']['cars']);
        $this->assertEquals(3000, $bay['received']['value']);
    }

    public function test_ready_is_work_that_is_finished_and_not_yet_charged_for(): void
    {
        // The figure the panel exists for. A car collected without the card
        // being converted is work the shop will never be paid for.
        $this->bookIn(SaleDocument::WORK_READY, 12000);
        $this->bookIn(SaleDocument::WORK_READY, 8000);

        $bay = $this->bay();

        $this->assertSame(2, $bay['ready']['cars']);
        $this->assertEquals(20000, $bay['ready']['value']);
    }

    public function test_a_billed_job_leaves_the_bay(): void
    {
        // `work_status` says where the CAR is; `status` says whether the
        // paperwork is live. A converted card is an invoice — counting it as
        // outstanding would report last month's work as unbilled forever.
        $doc = $this->bookIn(SaleDocument::WORK_READY, 12000);

        $this->actingAsUser($this->owner)
            ->postJson("/api/v1/sale-documents/{$doc['id']}/convert", [
                'payment_method' => 'cash', 'amount_paid' => 12000,
            ])->assertCreated();

        $bay = $this->bay();

        $this->assertSame(0, $bay['ready']['cars']);
        $this->assertEquals(0, $bay['ready']['value']);
    }

    public function test_a_car_promised_and_not_delivered_is_counted_at_every_stage(): void
    {
        // A car promised for Tuesday is late whether it is on the ramp or
        // sitting ready for collection.
        $this->bookIn(SaleDocument::WORK_IN_PROGRESS, 4000, now()->subDay()->toIso8601String());
        $this->bookIn(SaleDocument::WORK_READY, 4000, now()->subDays(3)->toIso8601String());
        $this->bookIn(SaleDocument::WORK_RECEIVED, 4000, now()->addDay()->toIso8601String());

        $this->assertSame(2, $this->bay()['overdue']);
    }

    public function test_a_car_nobody_promised_is_never_overdue(): void
    {
        $this->bookIn(SaleDocument::WORK_IN_PROGRESS, 4000);

        $this->assertSame(0, $this->bay()['overdue']);
    }

    public function test_every_other_trade_gets_no_bay_panel_at_all(): void
    {
        // Absent, never empty — the rule every block on this dashboard follows.
        // A grocer shown an empty workshop board would read it as a fault.
        $mart = Tenant::factory()->create([
            'setup_completed' => true, 'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $grocer = User::factory()->shopOwner($mart)->create();

        $this->assertNull(
            $this->actingAsUser($grocer)->getJson('/api/v1/dashboard')->assertOk()->json('data.bay'),
        );
    }
}
