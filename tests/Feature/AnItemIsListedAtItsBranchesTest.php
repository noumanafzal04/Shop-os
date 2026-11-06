<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Category;
use App\Models\City;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\Permissions;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * AN ITEM IS LISTED AT ITS BRANCHES (v2).
 *
 * The owner lists a product or a category at every branch ("All", the default)
 * or at the ones named; a member of staff pinned to one branch lists what they
 * make there and cannot change what is sold anywhere else. A shop with one
 * selling branch never meets any of this. Each case is asked of the screen a
 * person reads — the list at each branch — not of the table.
 */
class AnItemIsListedAtItsBranchesTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Branch $main;

    private Branch $town;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Lahore', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id, 'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'), 'timezone' => 'UTC',
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->main = Branch::withoutTenancy()->where('tenant_id', $this->shop->id)->where('is_default', true)->firstOrFail();
        $this->town = $this->branch('Johar Town', 'JT');
    }

    private function branch(string $name, string $code, string $kind = Branch::KIND_SHOP): Branch
    {
        return Branch::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => $name, 'code' => $code, 'kind' => $kind,
            'is_default' => false, 'is_active' => true,
        ]);
    }

    private function manager(Branch $at): User
    {
        return User::factory()->tenantStaff($this->shop, [Permissions::PRODUCTS_MANAGE, Permissions::SALES_MANAGE])
            ->create(['branch_id' => $at->id]);
    }

    /** Signed in as someone, looking at one branch (or, with null, the owner's "All branches"). */
    private function as(User $user, ?Branch $at = null): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();
        $this->withToken($token);
        if ($at !== null) {
            $this->withHeader('X-Branch-Id', $at->id);
        }

        return $this;
    }

    /** @return list<string> the product names this person sees at that branch */
    private function sees(User $user, ?Branch $at): array
    {
        return collect($this->as($user, $at)->getJson('/api/v1/products?per_page=100')->assertOk()->json('data'))
            ->pluck('name')->sort()->values()->all();
    }

    private function make(User $user, ?Branch $at, array $body, int $status = 201): ?string
    {
        $res = $this->as($user, $at)->postJson('/api/v1/products', ['item_type' => 'physical_product', 'price' => 100] + $body);
        $res->assertStatus($status);

        return $status === 201 ? (string) $res->json('data.id') : null;
    }

    // ── products ─────────────────────────────────────────────────────

    public function test_an_item_made_without_naming_branches_is_sold_everywhere(): void
    {
        $id = $this->make($this->owner, null, ['name' => 'Rice']);

        $this->assertTrue((bool) Product::query()->withoutGlobalScopes()->whereKey($id)->value('all_branches'));
        $this->assertSame(['Rice'], $this->sees($this->owner, $this->main));
        $this->assertSame(['Rice'], $this->sees($this->owner, $this->town));
    }

    public function test_an_item_for_one_branch_is_seen_there_and_in_the_owners_all_view_only(): void
    {
        $this->make($this->owner, null, ['name' => 'Town Biryani', 'all_branches' => false, 'branch_ids' => [$this->town->id]]);
        $this->make($this->owner, null, ['name' => 'Rice']);

        $this->assertSame(['Rice', 'Town Biryani'], $this->sees($this->owner, $this->town));
        $this->assertSame(['Rice'], $this->sees($this->owner, $this->main), 'a Johar Town item showed at Main');
        $this->assertSame(['Rice', 'Town Biryani'], $this->sees($this->owner, null), 'the owner\'s All view lost an item');
    }

    public function test_the_list_says_where_each_item_is_sold(): void
    {
        $this->make($this->owner, null, ['name' => 'Town Biryani', 'all_branches' => false, 'branch_ids' => [$this->town->id]]);

        $row = $this->as($this->owner, null)->getJson('/api/v1/products')->json('data.0');
        $this->assertFalse($row['all_branches']);
        $this->assertSame([$this->town->id], collect($row['places'])->pluck('id')->all());
    }

    public function test_naming_no_branch_and_not_all_is_refused_and_makes_nothing(): void
    {
        $this->make($this->owner, null, ['name' => 'Nowhere', 'all_branches' => false, 'branch_ids' => []], 422);
        $this->assertSame(0, Product::query()->withoutGlobalScopes()->where('name', 'Nowhere')->count(), 'a refused listing still made the item');
    }

    public function test_a_godown_or_another_shops_branch_is_never_a_listing(): void
    {
        $godown = $this->branch('Godown', 'GD', Branch::KIND_WAREHOUSE);
        $other = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $theirs = Branch::withoutTenancy()->where('tenant_id', $other->id)->firstOrFail();

        $this->make($this->owner, null, ['name' => 'X', 'all_branches' => false, 'branch_ids' => [$godown->id, $theirs->id]], 422);
        $id = $this->make($this->owner, null, ['name' => 'Y', 'all_branches' => false, 'branch_ids' => [$theirs->id, $this->town->id]]);
        $this->assertSame([$this->town->id], \DB::table('branch_product')->where('product_id', $id)->pluck('branch_id')->all());
    }

    public function test_a_godown_sees_every_item_because_it_holds_them_all(): void
    {
        $godown = $this->branch('Godown', 'GD', Branch::KIND_WAREHOUSE);
        $this->make($this->owner, null, ['name' => 'Town Only', 'all_branches' => false, 'branch_ids' => [$this->town->id]]);
        $this->make($this->owner, null, ['name' => 'Rice']);

        $this->assertSame(['Rice', 'Town Only'], $this->sees($this->owner, $godown));
    }

    public function test_a_branch_opened_later_gets_the_all_branch_items_and_not_the_others(): void
    {
        $this->make($this->owner, null, ['name' => 'Rice']);
        $this->make($this->owner, null, ['name' => 'Town Only', 'all_branches' => false, 'branch_ids' => [$this->town->id]]);
        $later = $this->branch('Model Town', 'MT');

        $this->assertSame(['Rice'], $this->sees($this->owner, $later));
    }

    public function test_the_owner_moves_an_item_from_all_to_one_branch_and_back(): void
    {
        $id = $this->make($this->owner, null, ['name' => 'Rice']);
        $this->as($this->owner)->putJson("/api/v1/products/{$id}", ['name' => 'Rice', 'price' => 100, 'all_branches' => false, 'branch_ids' => [$this->main->id]])->assertOk();
        $this->assertSame([], $this->sees($this->owner, $this->town));

        $this->as($this->owner)->putJson("/api/v1/products/{$id}", ['name' => 'Rice', 'price' => 100, 'all_branches' => true])->assertOk();
        $this->assertSame(['Rice'], $this->sees($this->owner, $this->town));
        $this->assertSame(0, \DB::table('branch_product')->where('product_id', $id)->count(), 'going back to All left the old branch rows behind');
    }

    public function test_an_edit_that_names_no_branches_leaves_the_listing_alone(): void
    {
        $id = $this->make($this->owner, null, ['name' => 'Town Only', 'all_branches' => false, 'branch_ids' => [$this->town->id]]);
        $this->as($this->owner)->putJson("/api/v1/products/{$id}", ['name' => 'Town Only 2', 'price' => 120])->assertOk();

        $this->assertSame(['Town Only 2'], $this->sees($this->owner, $this->town));
        $this->assertSame([], $this->sees($this->owner, $this->main), 'an edit that said nothing about branches listed it everywhere');
    }

    public function test_a_branch_manager_makes_items_for_their_own_branch_only(): void
    {
        $manager = $this->manager($this->town);
        $this->make($manager, null, ['name' => 'Manager Item']);

        $this->assertSame(['Manager Item'], $this->sees($manager, null));
        $this->assertSame([], $this->sees($this->owner, $this->main), 'a manager\'s item reached another branch');
    }

    public function test_a_branch_manager_cannot_list_at_all_or_at_another_branch(): void
    {
        $manager = $this->manager($this->town);

        $res = $this->as($manager)->postJson('/api/v1/products', ['item_type' => 'physical_product', 'price' => 100, 'name' => 'A', 'all_branches' => true]);
        $res->assertStatus(403)->assertJsonPath('meta.error_code', 'BRANCH_NOT_YOURS');
        $res = $this->as($manager)->postJson('/api/v1/products', ['item_type' => 'physical_product', 'price' => 100, 'name' => 'B', 'all_branches' => false, 'branch_ids' => [$this->main->id]]);
        $res->assertStatus(403);
        $this->assertSame(0, Product::query()->withoutGlobalScopes()->whereIn('name', ['A', 'B'])->count());
    }

    public function test_a_branch_manager_cannot_change_or_delete_an_item_sold_elsewhere_but_can_their_own(): void
    {
        $manager = $this->manager($this->town);
        $everywhere = $this->make($this->owner, null, ['name' => 'Rice']);
        $theirs = $this->make($manager, null, ['name' => 'Town Item']);

        $this->as($manager)->putJson("/api/v1/products/{$everywhere}", ['name' => 'Rice X', 'price' => 1])->assertStatus(403);
        $this->as($manager)->deleteJson("/api/v1/products/{$everywhere}")->assertStatus(403);
        $this->as($manager)->postJson("/api/v1/products/{$everywhere}/barcode")->assertStatus(403);
        $this->assertSame('Rice', Product::query()->withoutGlobalScopes()->whereKey($everywhere)->value('name'));

        $this->as($manager)->putJson("/api/v1/products/{$theirs}", ['name' => 'Town Item 2', 'price' => 150])->assertOk();
        $this->assertSame('Town Item 2', Product::query()->withoutGlobalScopes()->whereKey($theirs)->value('name'));
    }

    public function test_a_branch_manager_never_sees_another_branchs_item(): void
    {
        $manager = $this->manager($this->town);
        $this->make($this->owner, null, ['name' => 'Main Only', 'all_branches' => false, 'branch_ids' => [$this->main->id]]);

        // Pinned staff: the header cannot move them, and their list is their branch.
        $this->assertSame([], $this->sees($manager, $this->main));
    }

    public function test_a_shop_with_one_branch_works_exactly_as_before_for_staff(): void
    {
        $this->town->forceFill(['is_active' => false])->save();
        $staff = $this->manager($this->main);
        $everywhere = $this->make($this->owner, null, ['name' => 'Rice']);

        $id = $this->make($staff, null, ['name' => 'Staff Item']);
        $this->assertTrue((bool) Product::query()->withoutGlobalScopes()->whereKey($id)->value('all_branches'), 'a one-branch shop\'s staff item was locked to the branch');
        $this->as($staff)->putJson("/api/v1/products/{$everywhere}", ['name' => 'Rice 2', 'price' => 100])->assertOk();
    }

    // ── categories ───────────────────────────────────────────────────

    /** @return list<string> top-level and child names, flattened, at that branch */
    private function categoriesSeen(User $user, ?Branch $at): array
    {
        $tree = $this->as($user, $at)->getJson('/api/v1/categories')->assertOk()->json('data');
        $names = [];
        $walk = function (array $nodes) use (&$walk, &$names): void {
            foreach ($nodes as $n) {
                $names[] = $n['name'];
                $walk($n['children'] ?? []);
            }
        };
        $walk($tree);
        sort($names);

        return $names;
    }

    public function test_a_category_for_one_branch_shows_there_and_not_elsewhere(): void
    {
        $this->as($this->owner)->postJson('/api/v1/categories', ['name' => 'Bakery', 'all_branches' => false, 'branch_ids' => [$this->main->id]])->assertCreated();
        $this->as($this->owner)->postJson('/api/v1/categories', ['name' => 'Grocery'])->assertCreated();

        $this->assertSame(['Bakery', 'Grocery'], $this->categoriesSeen($this->owner, $this->main));
        $this->assertSame(['Grocery'], $this->categoriesSeen($this->owner, $this->town));
        $this->assertSame(['Bakery', 'Grocery'], $this->categoriesSeen($this->owner, null));
    }

    public function test_a_one_branch_category_holding_an_item_sold_everywhere_shows_where_that_item_sells(): void
    {
        $cat = $this->as($this->owner)->postJson('/api/v1/categories', ['name' => 'Bakery', 'all_branches' => false, 'branch_ids' => [$this->main->id]])->json('data.id');
        $this->make($this->owner, null, ['name' => 'Bread', 'category_id' => $cat]);

        $this->assertContains('Bakery', $this->categoriesSeen($this->owner, $this->town), 'an item sold at Johar Town had no shelf there');
    }

    public function test_a_branch_only_child_keeps_its_parent_on_the_path(): void
    {
        $parent = $this->as($this->owner)->postJson('/api/v1/categories', ['name' => 'Food'])->json('data.id');
        $this->as($this->owner)->postJson('/api/v1/categories', ['name' => 'Town Specials', 'parent_id' => $parent, 'all_branches' => false, 'branch_ids' => [$this->town->id]])->assertCreated();

        $this->assertSame(['Food', 'Town Specials'], $this->categoriesSeen($this->owner, $this->town));
        $this->assertSame(['Food'], $this->categoriesSeen($this->owner, $this->main));
    }

    public function test_a_parent_listed_elsewhere_still_stands_above_this_branchs_child(): void
    {
        $parent = $this->as($this->owner)->postJson('/api/v1/categories', ['name' => 'Main Food', 'all_branches' => false, 'branch_ids' => [$this->main->id]])->json('data.id');
        $this->as($this->owner)->postJson('/api/v1/categories', ['name' => 'Town Specials', 'parent_id' => $parent, 'all_branches' => false, 'branch_ids' => [$this->town->id]])->assertCreated();

        $this->assertSame(['Main Food', 'Town Specials'], $this->categoriesSeen($this->owner, $this->town), 'the child lost its path because the parent is listed at Main');
    }

    public function test_a_branch_manager_cannot_change_a_category_shown_everywhere(): void
    {
        $manager = $this->manager($this->town);
        $everywhere = $this->as($this->owner)->postJson('/api/v1/categories', ['name' => 'Grocery'])->json('data.id');

        $this->as($manager)->putJson("/api/v1/categories/{$everywhere}", ['name' => 'Mine'])->assertStatus(403);
        $this->as($manager)->deleteJson("/api/v1/categories/{$everywhere}")->assertStatus(403);
        $this->assertSame('Grocery', Category::query()->withoutGlobalScopes()->whereKey($everywhere)->value('name'));

        $own = $this->as($manager)->postJson('/api/v1/categories', ['name' => 'Town Shelf'])->assertCreated()->json('data.id');
        $this->assertSame([$this->town->id], \DB::table('branch_category')->where('category_id', $own)->pluck('branch_id')->all());
    }
}
