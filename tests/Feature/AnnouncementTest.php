<?php

namespace Tests\Feature;

use App\Models\Announcement;
use App\Models\AppNotification;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class AnnouncementTest extends TestCase
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

    public function test_admin_creates_a_draft_announcement(): void
    {
        $data = $this->asAdmin()->postJson('/api/v1/admin/announcements', [
            'title' => 'New feature', 'body' => 'POS now supports split payments.', 'audience' => 'tenants',
        ])->assertCreated()->json('data');

        $this->assertSame('New feature', $data['title']);
        $this->assertFalse($data['is_published']);
        $this->assertSame(0, $data['recipients_count']);
    }

    public function test_send_fans_out_to_the_chosen_audience(): void
    {
        Queue::fake();

        $shop = Tenant::factory()->create();
        $owner = User::factory()->shopOwner($shop)->create();
        $customer = User::factory()->create(); // customer role by default

        $announcement = Announcement::query()->create([
            'title' => 'Hello owners', 'body' => 'Read this.', 'audience' => 'tenants',
        ]);

        $this->asAdmin()->postJson("/api/v1/admin/announcements/{$announcement->id}/send")
            ->assertOk()
            ->assertJsonPath('data.is_published', true);

        // Only the shop owner got it — not the customer.
        $this->assertDatabaseHas('app_notifications', ['user_id' => $owner->id, 'type' => 'announcement']);
        $this->assertDatabaseMissing('app_notifications', ['user_id' => $customer->id, 'type' => 'announcement']);
        $this->assertSame(1, $announcement->fresh()->recipients_count);
    }

    public function test_resend_is_idempotent(): void
    {
        Queue::fake();
        $shop = Tenant::factory()->create();
        User::factory()->shopOwner($shop)->create();

        $announcement = Announcement::query()->create([
            'title' => 'Once', 'body' => 'Only once.', 'audience' => 'tenants',
        ]);

        $this->asAdmin()->postJson("/api/v1/admin/announcements/{$announcement->id}/send")->assertOk();
        $this->asAdmin()->postJson("/api/v1/admin/announcements/{$announcement->id}/send")->assertOk();

        $this->assertSame(1, AppNotification::query()->where('type', 'announcement')->count());
    }

    /**
     * "Everyone" reaches the cashier, because the cashier is somebody.
     *
     * The message this exists for is the one about the till: maintenance, an
     * outage, a change to how a sale is rung. It is addressed to the person
     * holding the tablet, and that person is the one role the fan-out used to
     * skip.
     */
    public function test_everyone_reaches_staff_and_not_only_owners(): void
    {
        Queue::fake();

        $shop = Tenant::factory()->create();
        $owner = User::factory()->shopOwner($shop)->create();
        $cashier = User::factory()->tenantStaff($shop)->create();
        $customer = User::factory()->create();

        $announcement = Announcement::query()->create([
            'title' => 'Maintenance Sunday',
            'body' => 'The till will be offline from 2am.',
            'audience' => 'all',
        ]);

        $this->asAdmin()->postJson("/api/v1/admin/announcements/{$announcement->id}/send")->assertOk();

        foreach ([$owner, $cashier, $customer] as $person) {
            $this->assertDatabaseHas('app_notifications', [
                'user_id' => $person->id,
                'type' => 'announcement',
            ]);
        }

        // Three people, three notifications — the count the admin is shown has
        // to agree with the fan-out, or "Everyone" is still not everyone.
        $this->assertSame(3, $announcement->fresh()->recipients_count);
    }

    /**
     * And "Shop owners" still means only the owners.
     *
     * This test exists to protect a DECISION rather than to catch a mistake.
     * Widening `all` was the fix; widening `tenants` alongside it would have
     * quietly removed the admin's only way to write to owners without writing
     * to every cashier in the country. If somebody later "makes the audiences
     * consistent", this is the check that asks them to mean it.
     */
    public function test_shop_owners_audience_deliberately_excludes_staff(): void
    {
        Queue::fake();

        $shop = Tenant::factory()->create();
        $owner = User::factory()->shopOwner($shop)->create();
        $cashier = User::factory()->tenantStaff($shop)->create();

        $announcement = Announcement::query()->create([
            'title' => 'Your invoice', 'body' => 'Due Friday.', 'audience' => 'tenants',
        ]);

        $this->asAdmin()->postJson("/api/v1/admin/announcements/{$announcement->id}/send")->assertOk();

        $this->assertDatabaseHas('app_notifications', ['user_id' => $owner->id, 'type' => 'announcement']);
        $this->assertDatabaseMissing('app_notifications', ['user_id' => $cashier->id, 'type' => 'announcement']);
    }

    public function test_non_admin_cannot_manage_announcements(): void
    {
        $shop = Tenant::factory()->create();
        $owner = User::factory()->shopOwner($shop)->create();
        $this->app['auth']->forgetGuards();
        $this->actingAs($owner)->getJson('/api/v1/admin/announcements')->assertForbidden();
    }
}
