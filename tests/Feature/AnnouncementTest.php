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

    public function test_non_admin_cannot_manage_announcements(): void
    {
        $shop = Tenant::factory()->create();
        $owner = User::factory()->shopOwner($shop)->create();
        $this->app['auth']->forgetGuards();
        $this->actingAs($owner)->getJson('/api/v1/admin/announcements')->assertForbidden();
    }
}
