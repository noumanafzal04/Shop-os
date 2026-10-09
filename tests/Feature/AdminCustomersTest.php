<?php

namespace Tests\Feature;

use App\Enums\UserRole;
use App\Enums\UserStatus;
use App\Models\Order;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * A CUSTOMER THE PLATFORM MADE CAN BE FOUND AGAIN.
 *
 * Reported as "customers are being created on the admin side and they do not
 * show". There was nothing to show them: the screen was one form and the API
 * was one `POST`. An account made for somebody on the phone could not be
 * checked, corrected, or switched off — or even confirmed to exist.
 *
 * What is held here is the list a person looks for that account in, what it
 * says about them, and the three things staff then do to an account.
 */
class AdminCustomersTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->admin = User::factory()->superAdmin()->create();
    }

    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function customer(array $with = []): User
    {
        return User::factory()->create($with + ['role' => UserRole::Customer]);
    }

    private function order(User $customer, Tenant $shop, float $total, string $status = 'completed', ?string $at = null): Order
    {
        static $n = 0;
        $n++;

        return Order::withoutTenancy()->create([
            'tenant_id' => $shop->id,
            'customer_id' => $customer->id,
            'order_number' => 'ORD-'.str_pad((string) $n, 6, '0', STR_PAD_LEFT),
            'status' => $status,
            'fulfillment_type' => 'pickup',
            'payment_method' => 'cod',
            'customer_name' => $customer->name,
            'subtotal' => $total,
            'total' => $total,
            'placed_at' => $at ?? now(),
        ]);
    }

    // ── made, and then found ──────────────────────────────────────────

    public function test_an_account_just_made_is_on_the_list(): void
    {
        $made = $this->as($this->admin)->postJson('/api/v1/admin/customers', [
            'name' => 'Farhan Ali', 'phone' => '03001234567', 'password' => 'password123',
        ])->assertCreated()->json('data');

        $rows = $this->as($this->admin)->getJson('/api/v1/admin/customers')->assertOk()->json('data');

        $this->assertSame([$made['id']], array_column($rows, 'id'));
        $this->assertSame('Farhan Ali', $rows[0]['name']);
        $this->assertSame('03001234567', $rows[0]['phone']);
        $this->assertSame('active', $rows[0]['status']);
        $this->assertSame(0, $rows[0]['orders_count']);
    }

    public function test_the_list_is_customers_and_nobody_else(): void
    {
        $shop = Tenant::factory()->create();
        $customer = $this->customer(['name' => 'A Customer']);
        User::factory()->shopOwner($shop)->create(['name' => 'A Shop Owner']);
        User::factory()->tenantStaff($shop)->create(['name' => 'A Cashier']);

        $names = array_column($this->as($this->admin)->getJson('/api/v1/admin/customers')->json('data'), 'name');

        $this->assertSame(['A Customer'], $names);
        // …and the same fence on every door that takes an id.
        $owner = User::query()->where('name', 'A Shop Owner')->firstOrFail();
        $this->as($this->admin)->getJson("/api/v1/admin/customers/{$owner->id}")->assertNotFound();
        $this->as($this->admin)->postJson("/api/v1/admin/customers/{$owner->id}/suspend")->assertNotFound();
        $this->as($this->admin)->postJson("/api/v1/admin/customers/{$owner->id}/password", ['password' => 'password123'])->assertNotFound();
        $this->assertSame(UserStatus::Active, $owner->fresh()->status);
        $this->assertNotNull($customer->fresh());
    }

    public function test_somebody_is_found_by_name_phone_or_email(): void
    {
        $this->customer(['name' => 'Hira Saleem', 'phone' => '03111111111', 'email' => 'hira@example.com']);
        $this->customer(['name' => 'Omar Farooq', 'phone' => '03222222222', 'email' => 'omar@example.com']);

        $found = fn (string $q) => array_column(
            $this->as($this->admin)->getJson('/api/v1/admin/customers?search='.urlencode($q))->json('data'),
            'name',
        );

        $this->assertSame(['Hira Saleem'], $found('hira'));
        $this->assertSame(['Omar Farooq'], $found('0322'));
        $this->assertSame(['Omar Farooq'], $found('omar@'));
        $this->assertSame([], $found('nobody'));
    }

    // ── what it says about them ───────────────────────────────────────

    public function test_orders_are_counted_across_every_shop_and_only_finished_ones_are_money(): void
    {
        $karahi = Tenant::factory()->create(['business_name' => 'Karahi House']);
        $mart = Tenant::factory()->create(['business_name' => 'Al-Madina']);
        $regular = $this->customer(['name' => 'A Regular']);
        $stranger = $this->customer(['name' => 'Never Ordered']);

        $this->order($regular, $karahi, 1500, 'completed', now()->subDays(3)->toDateTimeString());
        $this->order($regular, $mart, 800, 'completed', now()->subDay()->toDateTimeString());
        // Asked for, and never delivered: an order, and not a rupee.
        $this->order($regular, $mart, 9999, 'cancelled', now()->subDays(2)->toDateTimeString());

        $rows = collect($this->as($this->admin)->getJson('/api/v1/admin/customers')->json('data'))->keyBy('name');

        $this->assertSame(3, $rows['A Regular']['orders_count']);
        $this->assertSame(2300.0, (float) $rows['A Regular']['spent']);
        $this->assertNotNull($rows['A Regular']['last_order_at']);
        $this->assertSame(0, $rows['Never Ordered']['orders_count']);
        $this->assertSame(0.0, (float) $rows['Never Ordered']['spent']);
        $this->assertNull($rows['Never Ordered']['last_order_at']);

        // The filter asks the same question the column answers.
        $names = fn (string $q) => array_column($this->as($this->admin)->getJson("/api/v1/admin/customers?{$q}")->json('data'), 'name');
        $this->assertSame(['A Regular'], $names('ordered=yes'));
        $this->assertSame(['Never Ordered'], $names('ordered=never'));
        $this->assertSame('A Regular', $names('sort=spent')[0]);

        // And one person's page names the shops.
        $detail = $this->as($this->admin)->getJson("/api/v1/admin/customers/{$regular->id}")->assertOk()->json('data');
        $this->assertSame(3, $detail['orders_count']);
        $this->assertSame(['Al-Madina', 'Al-Madina', 'Karahi House'], array_column($detail['recent_orders'], 'shop'));
        $this->assertSame($stranger->id, $this->as($this->admin)->getJson("/api/v1/admin/customers/{$stranger->id}")->json('data.id'));
    }

    public function test_the_figures_above_the_list_are_counted_and_not_read_off_a_page(): void
    {
        $shop = Tenant::factory()->create();
        foreach (range(1, 18) as $i) {
            $this->customer(['name' => "Customer {$i}", 'created_at' => now()->subMonths(2)]);
        }
        $new = $this->customer(['name' => 'Joined Today']);
        $off = $this->customer(['name' => 'Switched Off', 'status' => UserStatus::Suspended]);
        $this->order($new, $shop, 500);

        $summary = $this->as($this->admin)->getJson('/api/v1/admin/customers/summary')->assertOk()->json('data');

        $this->assertSame(20, $summary['total']);
        $this->assertSame(19, $summary['active']);
        $this->assertSame(1, $summary['suspended']);
        $this->assertSame(2, $summary['new_this_month']);
        $this->assertSame(1, $summary['have_ordered']);

        // Page two is reachable, and holds who page one did not.
        $one = $this->as($this->admin)->getJson('/api/v1/admin/customers?per_page=15')->json();
        $two = $this->as($this->admin)->getJson('/api/v1/admin/customers?per_page=15&page=2')->json();
        $this->assertSame(20, $one['meta']['pagination']['total']);
        $this->assertCount(15, $one['data']);
        $this->assertCount(5, $two['data']);
        $this->assertSame([], array_intersect(array_column($one['data'], 'id'), array_column($two['data'], 'id')));

        $this->assertSame(['Switched Off'], array_column($this->as($this->admin)->getJson('/api/v1/admin/customers?status=suspended')->json('data'), 'name'));
        $this->assertNotNull($off);
    }

    // ── what staff then do ────────────────────────────────────────────

    public function test_a_suspended_customer_cannot_sign_in_and_is_signed_out_and_can_be_let_back(): void
    {
        $customer = $this->customer(['phone' => '03009990000', 'password' => 'password123']);
        $session = $customer->createToken('phone', ['access'])->plainTextToken;

        $this->as($this->admin)->postJson("/api/v1/admin/customers/{$customer->id}/suspend")
            ->assertOk()->assertJsonPath('data.status', 'suspended');

        $this->assertSame(0, $customer->tokens()->count(), 'the session they already had is still good');
        $this->app['auth']->forgetGuards();
        $this->withToken($session)->getJson('/api/v1/auth/me')->assertUnauthorized();
        $this->postJson('/api/v1/auth/login', ['identifier' => '03009990000', 'password' => 'password123'])->assertStatus(403);

        $this->as($this->admin)->postJson("/api/v1/admin/customers/{$customer->id}/activate")
            ->assertOk()->assertJsonPath('data.status', 'active');
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/v1/auth/login', ['identifier' => '03009990000', 'password' => 'password123'])->assertOk();
    }

    public function test_a_new_password_works_the_old_one_does_not_and_old_sessions_end(): void
    {
        $customer = $this->customer(['phone' => '03007770000', 'password' => 'the-old-one']);
        $customer->createToken('phone', ['access']);

        $this->as($this->admin)->postJson("/api/v1/admin/customers/{$customer->id}/password", ['password' => 'short'])
            ->assertStatus(422);
        $this->as($this->admin)->postJson("/api/v1/admin/customers/{$customer->id}/password", ['password' => 'a-new-password'])
            ->assertOk();

        $this->assertSame(0, $customer->tokens()->count());
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/v1/auth/login', ['identifier' => '03007770000', 'password' => 'the-old-one'])->assertStatus(401);
        $this->postJson('/api/v1/auth/login', ['identifier' => '03007770000', 'password' => 'a-new-password'])->assertOk();
    }

    public function test_a_customer_can_be_corrected_but_not_left_with_nothing_to_sign_in_with(): void
    {
        $customer = $this->customer(['name' => 'Farhn Ali', 'phone' => '03005550000', 'email' => null]);
        $other = $this->customer(['phone' => '03006660000']);

        $this->as($this->admin)->patchJson("/api/v1/admin/customers/{$customer->id}", ['name' => 'Farhan Ali', 'email' => 'farhan@example.com'])
            ->assertOk()->assertJsonPath('data.name', 'Farhan Ali')->assertJsonPath('data.email', 'farhan@example.com');

        // Somebody else's number is somebody else's.
        $this->as($this->admin)->patchJson("/api/v1/admin/customers/{$customer->id}", ['phone' => $other->phone])->assertStatus(422);
        // Their own number, sent back unchanged, is not a clash with itself.
        $this->as($this->admin)->patchJson("/api/v1/admin/customers/{$customer->id}", ['phone' => '03005550000'])->assertOk();

        // Both cleared: an account nobody can open again.
        $this->as($this->admin)->patchJson("/api/v1/admin/customers/{$customer->id}", ['phone' => null, 'email' => null])->assertStatus(422);
        $this->assertSame('03005550000', $customer->fresh()->phone);
    }

    public function test_an_account_made_by_mistake_can_be_removed_and_its_number_is_free_again(): void
    {
        $wrong = $this->customer(['name' => 'Wrong Number', 'phone' => '03001110000']);
        $wrong->createToken('phone', ['access']);

        $this->as($this->admin)->deleteJson("/api/v1/admin/customers/{$wrong->id}")->assertOk();

        $this->assertNull(User::withTrashed()->find($wrong->id), 'the account is hidden, not gone — its number is still taken');
        $this->assertSame([], $this->as($this->admin)->getJson('/api/v1/admin/customers')->json('data'));
        // The account that was meant to be made can be.
        $this->as($this->admin)->postJson('/api/v1/admin/customers', [
            'name' => 'Right Person', 'phone' => '03001110000', 'password' => 'password123',
        ])->assertCreated();
    }

    public function test_somebody_who_has_ordered_is_never_removed_because_the_orders_would_go_with_them(): void
    {
        $shop = Tenant::factory()->create();
        $regular = $this->customer(['name' => 'A Regular']);
        $order = $this->order($regular, $shop, 1200);

        $this->as($this->admin)->deleteJson("/api/v1/admin/customers/{$regular->id}")
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'CUSTOMER_HAS_ORDERS');

        $this->assertNotNull($regular->fresh());
        $this->assertNotNull(Order::withoutTenancy()->find($order->id), 'a shop lost an order because a customer was tidied away');

        // And a shop's owner is not a customer to be removed at all.
        $owner = User::factory()->shopOwner($shop)->create();
        $this->as($this->admin)->deleteJson("/api/v1/admin/customers/{$owner->id}")->assertNotFound();
        $this->assertNotNull($owner->fresh());
    }

    public function test_none_of_this_is_open_to_a_shop_or_to_a_customer(): void
    {
        $shop = Tenant::factory()->create();
        $owner = User::factory()->shopOwner($shop)->create();
        $customer = $this->customer();

        foreach ([$owner, $customer] as $who) {
            $this->as($who)->getJson('/api/v1/admin/customers')->assertForbidden();
            $this->as($who)->getJson('/api/v1/admin/customers/summary')->assertForbidden();
            $this->as($who)->postJson("/api/v1/admin/customers/{$customer->id}/suspend")->assertForbidden();
            $this->as($who)->deleteJson("/api/v1/admin/customers/{$customer->id}")->assertForbidden();
        }
        $this->assertNotNull($customer->fresh());
        $this->assertSame(UserStatus::Active, $customer->fresh()->status);
    }
}
