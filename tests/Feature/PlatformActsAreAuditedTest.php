<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Banner;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * THE PLATFORM'S OWN ACTS LEAVE A TRAIL (admin #AD7).
 *
 * Across a 135,574-row log there was not one row for a plan, a banner or an
 * announcement: the three acts that change what every shop pays and what
 * every customer sees, and nothing said who did them. An announcement has no
 * unsend.
 */
class PlatformActsAreAuditedTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->admin = User::factory()->superAdmin()->create();
    }

    private function asAdmin(): static
    {
        $this->app['auth']->forgetGuards();

        return $this->actingAs($this->admin);
    }

    /** One second apart or not, the two rows of one test may share a timestamp — read by event. */
    private function rowOf(array $rows, string $event): array
    {
        $found = array_values(array_filter($rows, fn (array $row) => $row['event'] === $event));
        $this->assertCount(1, $found, "one {$event} row");

        return $found[0];
    }

    /** @return array<int, array<string, mixed>> */
    private function trail(string $entity): array
    {
        return array_values(array_filter(
            $this->asAdmin()->getJson('/api/v1/admin/audit-logs?per_page=100')->assertOk()->json('data'),
            fn (array $row) => $row['entity'] === $entity,
        ));
    }

    public function test_a_plan_made_and_repriced_is_in_the_log_with_who_did_it(): void
    {
        $id = $this->asAdmin()->postJson('/api/v1/admin/plans', [
            'name' => 'QA Lite', 'code' => 'qa-lite', 'price' => 999,
            'billing_period_months' => 1, 'grace_period_days' => 7,
        ])->assertCreated()->json('data.id');
        $this->asAdmin()->putJson("/api/v1/admin/plans/{$id}", ['price' => 1299])->assertOk();

        $rows = $this->trail('Plan');
        $this->assertCount(2, $rows);
        $this->rowOf($rows, 'created');
        $repriced = $this->rowOf($rows, 'updated');
        $this->assertSame($this->admin->id, $repriced['actor']['id']);
        $this->assertEquals(999, $repriced['old_values']['price']);
        $this->assertEquals(1299, $repriced['new_values']['price']);
    }

    public function test_an_announcement_written_and_sent_is_in_the_log(): void
    {
        Queue::fake();
        $id = $this->asAdmin()->postJson('/api/v1/admin/announcements', [
            'title' => 'Eid timings', 'body' => 'Open till 2 am.', 'audience' => 'tenants',
        ])->assertCreated()->json('data.id');
        $this->asAdmin()->postJson("/api/v1/admin/announcements/{$id}/send")->assertOk();

        $rows = $this->trail('Announcement');
        $this->assertCount(2, $rows);
        $this->rowOf($rows, 'created');
        $sent = $this->rowOf($rows, 'updated');
        $this->assertTrue($sent['new_values']['is_published']);
        $this->assertSame($this->admin->id, $sent['actor']['id']);
    }

    public function test_a_banner_is_in_the_platform_log_not_the_advertisers_own(): void
    {
        Storage::fake('public');
        $shop = Tenant::factory()->create();

        $this->asAdmin()->post('/api/v1/admin/banners', [
            'image' => UploadedFile::fake()->image('promo.jpg', 1200, 600),
            'title' => 'Eid Sale', 'target_type' => 'shop', 'tenant_id' => $shop->id, 'amount' => 5000,
        ])->assertCreated();

        $this->assertCount(1, $this->trail('Banner'));
        $this->assertNull(AuditLog::query()->where('auditable_type', Banner::class)->value('tenant_id'));
    }

    public function test_customers_seeing_and_tapping_a_banner_file_nothing(): void
    {
        $banner = Banner::withoutEvents(fn () => Banner::query()->create([
            'image_path' => 'banners/a.jpg', 'target_type' => 'none', 'placement' => 'home', 'is_active' => true,
        ]));

        $banner->increment('click_count');
        $banner->increment('impression_count');

        $this->assertSame(0, AuditLog::query()->where('auditable_type', Banner::class)->count());
    }
}
