<?php

namespace Tests\Feature;

use App\Support\Permissions;
use Tests\TestCase;

/**
 * A permission nobody wrote a label for.
 *
 * This is the test that was missing when `tenants.reset_password` and
 * `billing.view` were added. Both reached the screen where an admin decides
 * who gets what, rendered by a humanising fallback as "Tenants Reset Password"
 * and "Billing View", with no explanation of either. Nothing looked broken —
 * which is exactly why nobody noticed that the most dangerous checkbox on the
 * platform, the one whose holder can sign in as any business and read every
 * rupee it has taken, was being offered with no warning at all.
 *
 * A permission screen where the boxes are not explained is a permission screen
 * where the wrong box gets ticked. So: add a permission without a label and
 * this fails, on the same commit, before it can reach anyone.
 */
class PermissionCatalogTest extends TestCase
{
    public function test_every_permission_the_platform_issues_has_a_label(): void
    {
        $missing = array_values(array_filter(
            Permissions::platform(),
            fn (string $p): bool => ! isset(Permissions::LABELS[$p]['label']),
        ));

        $this->assertSame([], $missing, 'platform permissions with no label: '.implode(', ', $missing));
    }

    public function test_every_permission_a_shop_issues_has_a_label(): void
    {
        $missing = array_values(array_filter(
            Permissions::tenant(),
            fn (string $p): bool => ! isset(Permissions::LABELS[$p]['label']),
        ));

        $this->assertSame([], $missing, 'tenant permissions with no label: '.implode(', ', $missing));
    }

    public function test_it_labels_nothing_the_product_does_not_issue(): void
    {
        // The other direction: a label left behind after a permission was
        // renamed or dropped is a row that can never render, and a lie about
        // what the product does.
        $issued = array_merge(Permissions::platform(), Permissions::tenant());
        $orphans = array_values(array_diff(array_keys(Permissions::LABELS), $issued));

        $this->assertSame([], $orphans, 'labels for permissions that do not exist: '.implode(', ', $orphans));
    }

    public function test_it_dresses_a_permission_for_the_screen(): void
    {
        $described = collect(Permissions::describe([Permissions::TENANTS_RESET_PASSWORD]))->firstOrFail();

        $this->assertSame(Permissions::TENANTS_RESET_PASSWORD, $described['key']);
        $this->assertSame("Reset a shop owner's password", $described['label']);
        // The dangerous one must never travel without its warning.
        $this->assertNotNull($described['hint']);
        $this->assertStringContainsString('sign in as that business', $described['hint']);
    }

    public function test_an_unlabelled_permission_still_renders_rather_than_vanishing(): void
    {
        // The fallback stays. A permission that slipped through must be
        // TICKABLE and ugly, not invisible — an invisible one cannot be
        // granted at all, which breaks the product for the shop rather than
        // merely embarrassing us. The tests above are what stop it shipping.
        $described = collect(Permissions::describe(['widgets.polish']))->firstOrFail();

        $this->assertSame('Widgets Polish', $described['label']);
        $this->assertNull($described['hint']);
    }

    public function test_hints_are_written_only_where_they_earn_their_place(): void
    {
        // A hint on every row is noise, and noise on this screen is how the
        // wrong box gets ticked. If this ever inverts, the screen has become a
        // wall of grey text nobody reads — including on the rows that matter.
        $withHints = array_filter(Permissions::LABELS, fn (array $l): bool => isset($l['hint']));

        $this->assertLessThan(
            count(Permissions::LABELS) / 2,
            count($withHints),
            'more than half the permissions carry a hint — the important ones no longer stand out',
        );
    }
}
