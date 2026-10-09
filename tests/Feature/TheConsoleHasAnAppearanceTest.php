<?php

namespace Tests\Feature;

use App\Models\PlatformSetting;
use App\Models\Tenant;
use App\Models\User;
use App\Support\Permissions;
use App\Support\PlatformSettings;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * THE CONSOLE HAS AN APPEARANCE, and it can be changed.
 *
 * A shop could always choose its own colour and what its menu is painted in.
 * The platform console could not: it was drawn from a fallback, and whoever
 * ran the platform could dress every shop on it and not their own screen.
 *
 * It is the PLATFORM's look — one, saved once, worn by everybody on the
 * console. So:
 *
 *   untouched, it is the house look: no colour chosen, the menu in the brand
 *   everybody on the console can read it; only a super admin can change it
 *   a colour is six hex digits or nothing, and nothing means "the house's"
 *   whoever sets a commission rate has not thereby been handed the paintbrush
 */
final class TheConsoleHasAnAppearanceTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        $this->admin = User::factory()->superAdmin()->create();
    }

    public function test_nobody_having_chosen_it_is_the_house_look(): void
    {
        $this->assertSame([
            // Null, not today's house colour: a rebrand reaches every
            // console that never chose.
            'console_theme_primary' => null,
            'console_theme_tint' => 'subtle',
            // The menu in the brand colour, as every shop's is by default.
            'console_theme_sidebar' => 'primary',
        ], $this->as($this->admin)->getJson('/api/v1/admin/appearance')->assertOk()->json('data'));
        $this->assertSame(0, PlatformSetting::query()->count(), 'reading the look wrote something');
    }

    public function test_a_super_admin_changes_it_for_everybody_on_the_console(): void
    {
        $this->as($this->admin)->putJson('/api/v1/admin/appearance', [
            'console_theme_primary' => '#12B76A',
            'console_theme_tint' => 'strong',
            'console_theme_sidebar' => 'dark',
        ])->assertOk()
            // The same colour is the same string wherever it is compared.
            ->assertJsonPath('data.console_theme_primary', '#12b76a')
            ->assertJsonPath('data.console_theme_tint', 'strong')
            ->assertJsonPath('data.console_theme_sidebar', 'dark');

        // Somebody else on the console — who may only schedule banners — is
        // shown the same console.
        $staff = User::factory()->adminStaff([Permissions::BANNERS_MANAGE])->create();
        $this->as($staff)->getJson('/api/v1/admin/appearance')->assertOk()
            ->assertJsonPath('data.console_theme_primary', '#12b76a')
            ->assertJsonPath('data.console_theme_sidebar', 'dark');

        // Who changed the platform's look, on every part of it.
        foreach (['console_theme_primary', 'console_theme_tint', 'console_theme_sidebar'] as $key) {
            $this->assertSame($this->admin->id, PlatformSetting::query()->where('key', $key)->value('updated_by'), "{$key} does not say who set it");
        }
    }

    public function test_it_can_be_handed_back_to_the_house_colour(): void
    {
        // Something else the platform has decided, which this must not touch.
        PlatformSettings::put(['commission_rate' => 5], $this->admin->id);
        $look = ['console_theme_primary' => '#7a5af8', 'console_theme_tint' => 'strong', 'console_theme_sidebar' => 'dark'];
        $this->as($this->admin)->putJson('/api/v1/admin/appearance', $look)->assertOk();

        // The COLOUR handed back, with a tint and a menu still chosen.
        $this->as($this->admin)->putJson('/api/v1/admin/appearance', [
            'console_theme_primary' => null, 'console_theme_tint' => 'none', 'console_theme_sidebar' => 'light',
        ])->assertOk()->assertJsonPath('data.console_theme_primary', null);

        $this->assertSame(
            ['console_theme_primary' => null, 'console_theme_tint' => 'none', 'console_theme_sidebar' => 'light'],
            $this->as($this->admin)->getJson('/api/v1/admin/appearance')->json('data'),
        );
        // Handed back by taking the choice away, not by storing the house
        // colour as though somebody had picked it…
        $this->assertSame(0, PlatformSetting::query()->where('key', 'console_theme_primary')->count());
        // …and taking away THAT choice, not every setting the platform has.
        $this->assertEquals(5, PlatformSettings::get('commission_rate'));
    }

    public function test_a_setting_handed_back_is_gone_at_once(): void
    {
        PlatformSettings::put(['console_theme_primary' => '#7a5af8'], $this->admin->id);
        // Read once, so it is being held in memory as well as in the table.
        $this->assertSame('#7a5af8', PlatformSettings::get('console_theme_primary'));

        PlatformSettings::forget(['console_theme_primary']);

        $this->assertNull(PlatformSettings::get('console_theme_primary'), 'the old colour was still being answered from memory');

        // And a name that is not a setting takes nothing with it.
        PlatformSettings::put(['commission_rate' => 5], $this->admin->id);
        PlatformSettings::forget(['not_a_setting']);
        $this->assertEquals(5, PlatformSettings::get('commission_rate'));
    }

    public function test_only_a_super_admin_holds_the_paintbrush(): void
    {
        $look = ['console_theme_primary' => '#7a5af8', 'console_theme_tint' => 'subtle', 'console_theme_sidebar' => 'light'];

        // Every platform permission there is, and still not this.
        $everything = User::factory()->adminStaff(Permissions::platform())->create();
        $this->as($everything)->putJson('/api/v1/admin/appearance', $look)->assertForbidden();

        // A shop's owner is not on the console at all — to read it or to change it.
        $owner = User::factory()->shopOwner(Tenant::factory()->create())->create();
        $this->as($owner)->getJson('/api/v1/admin/appearance')->assertForbidden();
        $this->as($owner)->putJson('/api/v1/admin/appearance', $look)->assertForbidden();

        $this->assertNull(PlatformSettings::get('console_theme_primary'));
        $this->assertSame('primary', PlatformSettings::get('console_theme_sidebar'));
    }

    public function test_a_look_that_is_not_one_is_refused_whole(): void
    {
        $good = ['console_theme_primary' => '#7a5af8', 'console_theme_tint' => 'subtle', 'console_theme_sidebar' => 'light'];

        foreach ([
            'console_theme_primary' => ['7a5af8', '#7a5', 'purple', '#7a5af8ff', 'url(x)'],
            'console_theme_tint' => ['loud', '', null],
            'console_theme_sidebar' => ['left', '', null],
        ] as $field => $bad) {
            foreach ($bad as $value) {
                $this->as($this->admin)->putJson('/api/v1/admin/appearance', [...$good, $field => $value])
                    ->assertStatus(422)->assertJsonStructure(['errors' => [$field]]);
            }
        }

        // A colour has to be SAID, even when what is said is "none".
        $this->as($this->admin)->putJson('/api/v1/admin/appearance', ['console_theme_tint' => 'subtle', 'console_theme_sidebar' => 'light'])
            ->assertStatus(422)->assertJsonStructure(['errors' => ['console_theme_primary']]);

        $this->assertSame(0, PlatformSetting::query()->count(), 'a refused look was partly saved');
    }

    public function test_setting_a_commission_rate_does_not_hand_over_the_paintbrush(): void
    {
        // The commission screen saves platform settings too, and whoever may
        // set that rate must not be able to repaint the console through it.
        $setter = User::factory()->adminStaff([Permissions::COMMISSION_MANAGE])->create();

        $this->as($setter)->putJson('/api/v1/admin/commission/settings', [
            'commission_rate' => 5,
            'console_theme_primary' => '#d92d20',
            'console_theme_sidebar' => 'dark',
        ])->assertOk();

        $this->assertEquals(5, PlatformSettings::get('commission_rate'));
        $this->assertNull(PlatformSettings::get('console_theme_primary'));
        $this->assertSame('primary', PlatformSettings::get('console_theme_sidebar'));
    }

    private function as(User $user): static
    {
        $this->defaultHeaders = [];
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
