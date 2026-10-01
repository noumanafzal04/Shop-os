<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\City;
use App\Models\Tenant;
use App\Support\BusinessTypes;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A SECOND DEFAULT BRANCH IS A SILENT WRONG ANSWER.
 *
 * `Branch`'s own docblock states the rule — "every tenant has exactly one
 * is_default Main branch" — and nothing enforced it. A second row flagged
 * default was accepted without complaint, by the API, by a seeder, by anything.
 *
 * What it costs is not a tidy-data problem. Two places resolve "the default"
 * with the same shape:
 *
 *   Branch::writeTargetId()           ->where('is_default', true)->value('id')
 *   InventoryService::adjust()        ->where('is_default', true)->value('id')
 *
 * `value()` takes whichever row the database hands back first. So with two
 * defaults, stock lands on one branch and is read from the other: the shelf is
 * full and the till says zero, every sale is refused, and no error anywhere
 * names a branch. This was found by building a shop with three branches and
 * watching three hundred sales out of three hundred refuse.
 *
 * The rule is restored where it cannot be bypassed — on the model, so it holds
 * for the API, for a seeder, for a console command and for a future caller
 * nobody has written yet.
 */
class OneDefaultBranchTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    protected function setUp(): void
    {
        parent::setUp();

        $city = City::query()->create(['name' => 'Sialkot', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
    }

    public function test_provisioning_leaves_exactly_one_default(): void
    {
        // The denominator. Everything below is about keeping this true, so if
        // it were ever false to begin with the rest would be measuring nothing.
        $this->assertSame(1, $this->defaults()->count());
    }

    public function test_a_new_default_demotes_the_old_one(): void
    {
        $was = $this->defaults()->first();

        Branch::withoutTenancy()->create([
            'tenant_id' => $this->shop->id,
            'name' => 'Gulberg',
            'is_default' => true,
            'is_active' => true,
        ]);

        $this->assertSame(1, $this->defaults()->count());
        $this->assertSame('Gulberg', $this->defaults()->value('name'));
        $this->assertFalse((bool) $was->fresh()->is_default);
    }

    public function test_promoting_an_existing_branch_demotes_the_old_one(): void
    {
        $second = Branch::withoutTenancy()->create([
            'tenant_id' => $this->shop->id,
            'name' => 'Model Town',
            'is_default' => false,
            'is_active' => true,
        ]);

        $second->forceFill(['is_default' => true])->save();

        $this->assertSame(1, $this->defaults()->count());
        $this->assertSame('Model Town', $this->defaults()->value('name'));
    }

    public function test_another_shops_default_is_not_touched(): void
    {
        // The demotion must be fenced to the tenant, or opening a branch in one
        // shop would quietly unseat another shop's Main — a far worse bug than
        // the one being fixed.
        $other = Tenant::factory()->provisioned()->create([
            'setup_completed' => true, 'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $theirs = Branch::withoutTenancy()
            ->where('tenant_id', $other->id)->where('is_default', true)->firstOrFail();

        Branch::withoutTenancy()->create([
            'tenant_id' => $this->shop->id,
            'name' => 'Johar Town', 'is_default' => true, 'is_active' => true,
        ]);

        $this->assertTrue((bool) $theirs->fresh()->is_default);
        $this->assertSame(1, Branch::withoutTenancy()
            ->where('tenant_id', $other->id)->where('is_default', true)->count());
    }

    public function test_saving_the_default_again_does_not_unseat_itself(): void
    {
        // Renaming Main must not leave the shop with NO default — the mirror
        // image of the bug, and the one a careless fix introduces.
        $main = $this->defaults()->firstOrFail();

        $main->forceFill(['name' => 'Main — Ferozepur Road'])->save();

        $this->assertSame(1, $this->defaults()->count());
        $this->assertSame($main->id, $this->defaults()->value('id'));
    }

    private function defaults(): Builder
    {
        return Branch::withoutTenancy()
            ->where('tenant_id', $this->shop->id)
            ->where('is_default', true);
    }
}
