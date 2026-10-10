<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\PlatformSetting;
use App\Models\User;
use App\Support\PlatformSettings;
use Database\Seeders\PlanSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * WHAT THE PLATFORM IS SET TO IS IN THE TRAIL.
 *
 * The add-on price list on a development database went from one price to
 * none in half an hour and nothing could say who had emptied it, or when. A
 * shop's every module switch is recorded; the list that decides what every
 * shop is billed for a module was not — nor the commission rate, nor whether
 * commission is charged at all.
 *
 * ── What each test is guarding ─────────────────────────────────────────
 *
 *   a price set, changed and taken off are each a row, with the map before
 *     and after, and the person who did it
 *   a save that changed nothing is not a row
 *   the commission settings are rows, one for each that moved
 *   handing a setting back to its default is a row — a delete written as a
 *     query filed nothing
 *   the row does not name its own author twice
 */
class PlatformSettingsAreInTheTrailTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->seed(PlanSeeder::class);
        $this->admin = User::factory()->superAdmin()->create(['name' => 'Owner Of The Platform']);
    }

    private function asAdmin(): static
    {
        $token = $this->admin->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    /** @return array<int, array<string, mixed>> */
    private function trail(): array
    {
        return $this->asAdmin()->getJson('/api/v1/admin/audit-logs?type=PlatformSetting')->assertOk()->json('data');
    }

    public function test_pricing_an_add_on_is_a_row_with_who_did_it(): void
    {
        $this->asAdmin()->putJson('/api/v1/admin/modules/prices', ['changes' => ['products' => 25000]])->assertOk();

        $rows = $this->trail();
        $this->assertCount(1, $rows);
        $this->assertSame('PlatformSetting', $rows[0]['entity']);
        // Which setting: the row's own id is its name.
        $this->assertSame('module_addon_prices', $rows[0]['entity_id']);
        $this->assertSame('created', $rows[0]['event']);
        $this->assertSame('Owner Of The Platform', $rows[0]['actor']['name']);
        $this->assertEquals(['products' => 25000], $rows[0]['new_values']['value']);
        // The platform's, not a shop's.
        $this->assertNull($rows[0]['tenant_id']);
    }

    public function test_a_price_changed_and_one_taken_off_are_each_a_row_with_before_and_after(): void
    {
        $prices = fn (array $changes) => $this->asAdmin()->putJson('/api/v1/admin/modules/prices', ['changes' => $changes])->assertOk();
        // A minute apart: the trail is newest first, and three writes inside
        // one second have no "first" to be newest of.
        $prices(['products' => 25000]);
        $this->travel(1)->minutes();
        $prices(['bank_offers' => 350]);
        $this->travel(1)->minutes();
        $prices(['products' => null]);

        // Newest first.
        $rows = $this->trail();
        $this->assertCount(3, $rows);

        $this->assertSame('updated', $rows[0]['event']);
        $this->assertEquals(['products' => 25000, 'bank_offers' => 350], $rows[0]['old_values']['value']);
        $this->assertEquals(['bank_offers' => 350], $rows[0]['new_values']['value']);

        $this->assertSame('updated', $rows[1]['event']);
        $this->assertEquals(['products' => 25000], $rows[1]['old_values']['value']);
        $this->assertEquals(['products' => 25000, 'bank_offers' => 350], $rows[1]['new_values']['value']);
        // A map on both sides of the arrow — not a map and its own JSON text.
        $this->assertIsArray($rows[1]['new_values']['value']);
    }

    public function test_a_save_that_changed_nothing_is_not_a_row(): void
    {
        $this->asAdmin()->putJson('/api/v1/admin/modules/prices', ['changes' => ['products' => 25000]])->assertOk();
        $this->asAdmin()->putJson('/api/v1/admin/modules/prices', ['changes' => ['products' => 25000]])->assertOk();
        $this->asAdmin()->putJson('/api/v1/admin/modules/prices', ['changes' => []])->assertOk();

        $this->assertCount(1, $this->trail());
    }

    public function test_the_commission_settings_are_rows_one_for_each_that_moved(): void
    {
        $this->asAdmin()->putJson('/api/v1/admin/commission/settings', ['commission_enabled' => true, 'commission_rate' => 3.5])->assertOk();
        $this->travel(1)->minutes();
        $this->asAdmin()->putJson('/api/v1/admin/commission/settings', ['commission_rate' => 5])->assertOk();

        $rows = $this->trail();
        $this->assertCount(3, $rows);

        // The newest: the rate, moved.
        $this->assertSame('commission_rate', $rows[0]['entity_id']);
        $this->assertSame('updated', $rows[0]['event']);
        $this->assertEquals(3.5, $rows[0]['old_values']['value']);
        $this->assertEquals(5, $rows[0]['new_values']['value']);
        // A number on both sides of the arrow, not a number and the text of one.
        $this->assertIsNotString($rows[0]['new_values']['value']);

        // Before it, the two that were set together — one row each.
        $first = [$rows[1]['entity_id'] => $rows[1], $rows[2]['entity_id'] => $rows[2]];
        $this->assertSame(['commission_enabled', 'commission_rate'], collect(array_keys($first))->sort()->values()->all());
        $this->assertSame('created', $first['commission_enabled']['event']);
        $this->assertTrue($first['commission_enabled']['new_values']['value']);
        $this->assertEquals(3.5, $first['commission_rate']['new_values']['value']);
    }

    public function test_handing_a_setting_back_to_its_default_is_a_row(): void
    {
        $this->actingAs($this->admin);
        PlatformSettings::put(['console_theme_sidebar' => 'dark'], $this->admin->id);
        PlatformSettings::forget(['console_theme_sidebar']);

        $rows = AuditLog::query()->where('auditable_type', PlatformSetting::class)->orderBy('created_at')->orderBy('id')->get();
        $this->assertSame(['created', 'deleted'], $rows->pluck('event')->all());
        // The word itself, on both rows — not the word inside its JSON quotation marks.
        $this->assertSame('dark', $rows[0]->new_values['value']);
        $this->assertSame('dark', $rows[1]->old_values['value']);
        $this->assertSame($this->admin->id, $rows[1]->user_id);
        // And it is the default again.
        $this->assertSame('primary', PlatformSettings::get('console_theme_sidebar'));
    }

    public function test_the_row_does_not_name_its_author_twice(): void
    {
        $this->asAdmin()->putJson('/api/v1/admin/modules/prices', ['changes' => ['products' => 25000]])->assertOk();
        $this->asAdmin()->putJson('/api/v1/admin/modules/prices', ['changes' => ['products' => 26000]])->assertOk();

        foreach (AuditLog::query()->where('auditable_type', PlatformSetting::class)->get() as $row) {
            $this->assertArrayNotHasKey('updated_by', $row->new_values ?? []);
            $this->assertArrayNotHasKey('updated_by', $row->old_values ?? []);
        }
    }

    public function test_the_trail_offers_platform_settings_as_something_to_filter_by(): void
    {
        $this->asAdmin()->putJson('/api/v1/admin/modules/prices', ['changes' => ['products' => 25000]])->assertOk();

        $entities = $this->asAdmin()->getJson('/api/v1/admin/audit-logs')->assertOk()->json('meta.entities');
        $offered = collect($entities)->firstWhere('value', 'PlatformSetting');
        $this->assertNotNull($offered, 'the trail holds platform settings and does not offer them as something to filter by');
        // In words, as the screen's menu will show it.
        $this->assertSame('Platform Setting', $offered['label']);
    }
}
