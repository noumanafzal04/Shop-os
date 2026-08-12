<?php

namespace Tests\Feature;

use App\Models\DiningTable;
use App\Models\RestaurantTicket;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;
use App\Support\StaffPresets;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Handing a table over at shift change.
 *
 * The refusal a waiter gets on someone else's tab reads "Ask them or a
 * supervisor to hand the table over." The endpoint behind that sentence has
 * existed since the floor shipped, and nothing in the product ever called it:
 * no hook, no screen, no button. A shift change with open tabs had exactly one
 * resolution — give somebody `tables.serve_any` permanently, which is the
 * blunt instrument the permission was written to avoid.
 *
 * The missing half was not the button. It was that naming the new waiter means
 * choosing from a list, and the staff directory is gated on `staff.manage` —
 * hiring and firing — which a waiter neither has nor should get.
 */
class TableHandoverTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private User $ali;

    private User $sana;

    private RestaurantTicket $tab;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);

        $this->tenant = Tenant::factory()->provisioned()->create([
            'business_type' => 'restaurant',
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create(['name' => 'Owner']);

        $waiter = StaffPresets::permissionsFor('waiter');
        $this->ali = User::factory()->tenantStaff($this->tenant, $waiter)->create(['name' => 'Ali']);
        $this->sana = User::factory()->tenantStaff($this->tenant, $waiter)->create(['name' => 'Sana']);

        $table = DiningTable::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'T1', 'is_active' => true,
        ]);

        $this->tab = RestaurantTicket::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'ticket_number' => 'TAB-00001',
            'dining_table_id' => $table->id, 'status' => 'open',
            'waiter_id' => $this->ali->id, 'opened_at' => now(),
        ]);
    }

    private function login(User $user): static
    {
        $this->defaultHeaders = [];
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    // ── The list you choose from ────────────────────────────────────

    public function test_a_waiter_can_see_who_they_may_hand_a_table_to(): void
    {
        $response = $this->login($this->ali)->getJson('/api/v1/restaurant/servers');

        $response->assertOk();
        $names = collect($response->json('data'))->pluck('name');

        $this->assertContains('Sana', $names);
        $this->assertContains('Owner', $names, 'the owner works the floor too and holds everything by role');
    }

    public function test_the_list_carries_names_and_nothing_else(): void
    {
        // The whole justification for this endpoint existing outside the staff
        // directory is that it discloses the minimum. If it ever grows a phone
        // number or a permission array, it has become the directory — which is
        // gated on staff.manage precisely because a waiter should not have it.
        $row = $this->login($this->ali)->getJson('/api/v1/restaurant/servers')
            ->assertOk()->json('data.0');

        $this->assertSame(['id', 'name'], array_keys($row));
    }

    public function test_it_leaves_out_whoever_cannot_work_a_floor(): void
    {
        $cook = User::factory()->tenantStaff($this->tenant, [Permissions::KITCHEN_MANAGE])
            ->create(['name' => 'Cook']);

        $names = collect($this->login($this->ali)->getJson('/api/v1/restaurant/servers')
            ->assertOk()->json('data'))->pluck('name');

        $this->assertNotContains('Cook', $names, 'a kitchen hand cannot be handed a table');
        $this->assertNotNull($cook->id);
    }

    public function test_it_leaves_out_a_suspended_member_of_staff(): void
    {
        User::factory()->tenantStaff($this->tenant, StaffPresets::permissionsFor('waiter'))
            ->create(['name' => 'Gone', 'status' => 'suspended']);

        $names = collect($this->login($this->ali)->getJson('/api/v1/restaurant/servers')
            ->assertOk()->json('data'))->pluck('name');

        $this->assertNotContains('Gone', $names);
    }

    public function test_another_shops_staff_are_not_on_the_list(): void
    {
        $rival = Tenant::factory()->provisioned()->create();
        User::factory()->tenantStaff($rival, StaffPresets::permissionsFor('waiter'))
            ->create(['name' => 'Rival Waiter']);

        $names = collect($this->login($this->ali)->getJson('/api/v1/restaurant/servers')
            ->assertOk()->json('data'))->pluck('name');

        $this->assertNotContains('Rival Waiter', $names);
    }

    public function test_a_kitchen_hand_cannot_read_the_list_at_all(): void
    {
        $cook = User::factory()->tenantStaff($this->tenant, [Permissions::KITCHEN_MANAGE])->create();

        $this->login($cook)->getJson('/api/v1/restaurant/servers')->assertForbidden();
    }

    // ── The hand-over itself ────────────────────────────────────────

    public function test_a_waiter_can_give_their_own_table_away(): void
    {
        // The normal case, and the reason this is not gated on serve_any:
        // going off shift with three open tabs must not need a supervisor.
        $this->login($this->ali)
            ->postJson("/api/v1/restaurant/tickets/{$this->tab->id}/waiter", ['waiter_id' => $this->sana->id])
            ->assertOk();

        $this->assertSame($this->sana->id, $this->tab->fresh()->waiter_id);
    }

    public function test_a_waiter_cannot_take_someone_elses_table(): void
    {
        // Sana grabbing Ali's tab. Without this, the hand-over endpoint is the
        // way around every other rule on the floor.
        $this->login($this->sana)
            ->postJson("/api/v1/restaurant/tickets/{$this->tab->id}/waiter", ['waiter_id' => $this->sana->id])
            ->assertForbidden()
            ->assertJsonPath('meta.error_code', 'NOT_YOUR_TABLE');

        $this->assertSame($this->ali->id, $this->tab->fresh()->waiter_id);
    }

    public function test_a_supervisor_can_move_any_table(): void
    {
        $supervisor = User::factory()
            ->tenantStaff($this->tenant, StaffPresets::permissionsFor('shift_supervisor'))
            ->create();

        $this->login($supervisor)
            ->postJson("/api/v1/restaurant/tickets/{$this->tab->id}/waiter", ['waiter_id' => $this->sana->id])
            ->assertOk();

        $this->assertSame($this->sana->id, $this->tab->fresh()->waiter_id);
    }

    public function test_a_closed_tab_cannot_change_hands(): void
    {
        $this->tab->forceFill(['status' => 'closed', 'closed_at' => now()])->save();

        $this->login($this->ali)
            ->postJson("/api/v1/restaurant/tickets/{$this->tab->id}/waiter", ['waiter_id' => $this->sana->id])
            ->assertStatus(409)
            ->assertJsonPath('meta.error_code', 'TICKET_NOT_OPEN');
    }

    public function test_a_table_cannot_be_handed_to_another_shops_staff(): void
    {
        $rival = Tenant::factory()->provisioned()->create();
        $stranger = User::factory()->tenantStaff($rival, StaffPresets::permissionsFor('waiter'))->create();

        $this->login($this->ali)
            ->postJson("/api/v1/restaurant/tickets/{$this->tab->id}/waiter", ['waiter_id' => $stranger->id])
            ->assertStatus(422);

        $this->assertSame($this->ali->id, $this->tab->fresh()->waiter_id);
    }

    public function test_the_new_waiter_can_then_work_the_tab(): void
    {
        // The point of the whole feature: after the hand-over the tab is
        // genuinely Sana's, not merely relabelled.
        $this->login($this->ali)
            ->postJson("/api/v1/restaurant/tickets/{$this->tab->id}/waiter", ['waiter_id' => $this->sana->id])
            ->assertOk();

        $this->login($this->sana)
            ->getJson("/api/v1/restaurant/tickets/{$this->tab->id}")
            ->assertOk();

        // And Ali, who gave it away, is now the one who must ask.
        $this->login($this->ali)
            ->postJson("/api/v1/restaurant/tickets/{$this->tab->id}/waiter", ['waiter_id' => $this->ali->id])
            ->assertForbidden();
    }
}
