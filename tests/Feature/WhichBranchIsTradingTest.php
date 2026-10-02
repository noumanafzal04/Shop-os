<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\BusinessDay;
use App\Models\City;
use App\Models\Product;
use App\Models\Register;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * "NO DAY OPEN YET" — SAID TO A SHOP THAT WAS TRADING.
 *
 * `BranchContext` answers two different questions and they are NOT
 * interchangeable:
 *
 *   id()       the branch being OPERATED. Never null for an owner —
 *              `ResolveBranch` pins them to Main when no header is sent.
 *   scopeId()  the branch being LOOKED AT. Null for an owner on "All
 *              branches", which means "every one of them".
 *
 * The panel's branch switcher sends `X-Branch-Id` for a chosen branch and
 * NOTHING AT ALL for All branches — so for the HQ view `ResolveBranch`
 * resolves Main for operations and sets `scopeAll`.
 *
 * `BusinessDayController::current()` asked `openFor($this->branch->id())`. On
 * All branches that is Main, so a chain whose Main had already closed and
 * whose other two shops were mid-afternoon was told its day had not started.
 * Nothing on the screen said which branch it was talking about, so the owner's
 * reading was "the till has not been opened" — on a day with money in three
 * drawers.
 *
 * ── Why a roll-up and not simply scopeId() ──────────────────────────────
 *
 * `openFor(null)` would look for a day whose `branch_id` IS NULL, which is no
 * day at all. "All branches" is not a branch; it is a question about several,
 * and the honest answer names them.
 */
class WhichBranchIsTradingTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Branch $main;

    private Branch $town;

    private Product $rice;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
            'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();

        $this->main = Branch::withoutTenancy()
            ->where('tenant_id', $this->shop->id)->where('is_default', true)->firstOrFail();

        $this->town = Branch::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Johar Town', 'code' => 'JT',
            'is_default' => false, 'is_active' => true, 'city_id' => $city->id,
        ]);

        $this->rice = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'name' => 'Rice Bag',
            'price' => 2000, 'cost' => 1500, 'track_inventory' => false, 'is_active' => true,
        ]);
    }

    /**
     * A SIGN-IN THAT ALSO FORGETS THE LAST REQUEST'S HEADERS.
     *
     * `withHeader()` sets a DEFAULT header on the test case, not a header on
     * one call — so an `X-Branch-Id` used to open a shift at Johar Town is
     * still attached to every later request in the same test. The first
     * version of this test therefore "proved" that All branches saw Johar
     * Town, while quietly asking as Johar Town.
     *
     * The whole subject here is what happens with NO header. Flushing is not
     * tidiness; it is the test.
     */
    private function as(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();

        return $this->withToken($token);
    }

    /** Open a day and a drawer at one branch, as that branch's own till would. */
    private function tradingAt(Branch $branch): void
    {
        $register = Register::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'branch_id' => $branch->id,
            'name' => 'Lane 1', 'code' => 'L1'.$branch->code, 'is_active' => true,
        ]);

        $this->as($this->owner)
            ->withHeader('X-Branch-Id', $branch->id)
            ->postJson('/api/v1/pos/session/open', ['register_id' => $register->id, 'opening_float' => 5000])
            ->assertCreated();
    }

    /**
     * THE FAULT, STATED PLAINLY.
     *
     * Johar Town is open. Main is not. The owner, looking at All branches, is
     * told the shop has not started trading.
     */
    public function test_all_branches_sees_a_branch_that_is_trading(): void
    {
        $this->tradingAt($this->town);

        $this->assertNull(
            BusinessDay::withoutTenancy()->where('branch_id', $this->main->id)->first(),
            'Main has no day — that is the whole premise of this test.',
        );

        // No X-Branch-Id: the panel sends none for "All branches".
        $body = $this->as($this->owner)->getJson('/api/v1/pos/day')->assertOk()->json();

        $this->assertNotNull(
            $body['data'],
            'A shop with an open drawer at Johar Town was told no day was open anywhere.',
        );
    }

    /** And it says WHICH branch, because "a day" is meaningless across three. */
    public function test_the_answer_names_the_branch_it_is_about(): void
    {
        $this->tradingAt($this->town);

        $body = $this->as($this->owner)->getJson('/api/v1/pos/day')->assertOk()->json('data');

        $this->assertSame('Johar Town', $body['day']['branch']['name'] ?? null);
    }

    /**
     * A CHOSEN BRANCH STILL ANSWERS FOR ITSELF.
     *
     * The HQ roll-up must not leak into the branch view: a manager who has
     * selected Main and whose own day is closed is correctly told so, and
     * showing them Johar Town's drawer would be worse than showing nothing.
     */
    public function test_a_chosen_branch_answers_only_for_itself(): void
    {
        $this->tradingAt($this->town);

        $this->as($this->owner)
            ->withHeader('X-Branch-Id', $this->main->id)
            ->getJson('/api/v1/pos/day')
            ->assertOk()
            ->assertJsonPath('data', null);
    }

    /**
     * STAFF ARE NOT HQ.
     *
     * `ResolveBranch` pins staff to their own branch with `scopeAll: false`,
     * and this must stay true: a cashier at Main seeing Johar Town's takings
     * is a different and worse bug than the one being fixed.
     */
    public function test_a_cashier_never_sees_another_branch_s_day(): void
    {
        $this->tradingAt($this->town);

        $cashier = User::factory()
            ->tenantStaff($this->shop, ['sales.manage'])
            ->create(['branch_id' => $this->main->id]);

        $this->as($cashier)->getJson('/api/v1/pos/day')->assertOk()->assertJsonPath('data', null);
    }

    /** With Main itself trading, nothing about the ordinary case changes. */
    public function test_the_ordinary_single_branch_answer_is_unchanged(): void
    {
        $this->tradingAt($this->main);

        $body = $this->as($this->owner)->getJson('/api/v1/pos/day')->assertOk()->json('data');

        $this->assertNotNull($body);
        $this->assertSame($this->main->id, $body['day']['branch_id']);
    }
}
