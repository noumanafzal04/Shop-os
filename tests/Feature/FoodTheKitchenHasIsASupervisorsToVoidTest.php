<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\DiningTable;
use App\Models\Product;
use App\Models\RestaurantTicket;
use App\Models\RestaurantTicketItem;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\StaffPresets;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * FOOD THE KITCHEN HAS IS A SUPERVISOR'S TO TAKE OFF THE BILL.
 *
 * Tester pass 2 (B40), Johar Café: the waiter (sales.manage, no sales.void)
 * put an orange juice on his tab, sent it, it was made and served — and then
 * voided it, and then cancelled the whole tab. Both answered 200; nothing was
 * paid and nobody approved. A line still unsent stays the waiter's to remove.
 */
class FoodTheKitchenHasIsASupervisorsToVoidTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $waiter;

    private User $supervisor;

    private Product $juice;

    private DiningTable $table;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->firstOrCreate(['name' => 'Lahore'], ['is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id, 'business_type' => 'restaurant',
            'features' => BusinessTypes::defaultFeatures('restaurant'), 'timezone' => 'UTC',
        ]);
        User::factory()->shopOwner($this->shop)->create();
        $this->waiter = $this->preset('waiter');
        $this->supervisor = $this->preset('shift_supervisor');
        $this->juice = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'food_item',
            'name' => 'Orange Juice', 'price' => 420, 'track_inventory' => false, 'is_active' => true,
        ]);
        $this->table = DiningTable::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'T4', 'area' => 'Hall', 'seats' => 4,
        ]);
    }

    private function preset(string $code): User
    {
        return User::factory()->create([
            'tenant_id' => $this->shop->id, 'role' => 'staff',
            'permissions' => collect(StaffPresets::all())->firstWhere('code', $code)['permissions'],
        ]);
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** The waiter's own tab with one juice on it — sent to the kitchen when $fire. */
    private function tab(bool $fire): array
    {
        $tab = $this->as($this->waiter)->postJson('/api/v1/restaurant/tickets', [
            'order_type' => 'dine_in', 'dining_table_id' => $this->table->id, 'guest_count' => 2,
        ])->assertCreated()->json('data');
        $this->as($this->waiter)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/items", [
            'items' => [['product_id' => $this->juice->id, 'quantity' => 1]],
        ])->assertSuccessful();
        if ($fire) {
            $this->as($this->waiter)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/fire", [])->assertSuccessful();
        }

        return $tab;
    }

    private function line(array $tab): RestaurantTicketItem
    {
        return RestaurantTicketItem::withoutTenancy()->where('ticket_id', $tab['id'])->sole();
    }

    public function test_a_waiter_cannot_void_food_the_kitchen_has(): void
    {
        $tab = $this->tab(fire: true);
        $line = $this->line($tab);

        $this->as($this->waiter)->deleteJson("/api/v1/restaurant/tickets/{$tab['id']}/items/{$line->id}", ['reason' => 'customer left'])
            ->assertForbidden()->assertJsonPath('meta.error_code', 'VOID_NEEDS_SUPERVISOR');
        $this->assertNull($line->fresh()->voided_at, 'the juice came off the bill anyway');

        $this->as($this->waiter)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/cancel", ['reason' => 'left'])
            ->assertForbidden()->assertJsonPath('meta.error_code', 'VOID_NEEDS_SUPERVISOR');
        $this->assertSame('open', RestaurantTicket::withoutTenancy()->find($tab['id'])->status->value, 'the tab was cancelled anyway');
    }

    public function test_a_supervisor_can_and_is_named(): void
    {
        $tab = $this->tab(fire: true);
        $line = $this->line($tab);

        $this->as($this->supervisor)->deleteJson("/api/v1/restaurant/tickets/{$tab['id']}/items/{$line->id}", ['reason' => 'spilled'])
            ->assertOk();
        $this->assertNotNull($line->fresh()->voided_at);
        $this->assertSame($this->supervisor->id, $line->fresh()->voided_by, 'nobody knows who took it off the bill');
    }

    public function test_a_line_never_sent_is_still_the_waiters_to_remove(): void
    {
        $tab = $this->tab(fire: false);
        $line = $this->line($tab);

        $this->as($this->waiter)->deleteJson("/api/v1/restaurant/tickets/{$tab['id']}/items/{$line->id}")->assertOk();
        $this->assertSame($this->waiter->id, $line->fresh()->voided_by);

        // Nothing on it ever reached the kitchen, so the whole tab is theirs to drop.
        $this->as($this->waiter)->postJson("/api/v1/restaurant/tickets/{$tab['id']}/cancel", ['reason' => 'changed mind'])->assertOk();
    }
}
