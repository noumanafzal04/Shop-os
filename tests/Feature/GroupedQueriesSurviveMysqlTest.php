<?php

namespace Tests\Feature;

use App\Models\Tenant;
use Tests\TestCase;

/**
 * A QUERY THAT GROUPS MAY NOT SELECT AN UNAGGREGATED SUBSELECT.
 *
 * ── Why this test has to exist at all ───────────────────────────────────
 *
 * The suite runs on SQLite and production is MySQL, and they disagree about
 * exactly one thing that matters here: `only_full_group_by`. MySQL refuses a
 * query that groups while selecting a column — or a correlated subselect —
 * that is neither aggregated nor grouped. SQLite allows it and returns an
 * arbitrary row's value.
 *
 * So this class of bug is INVISIBLE to every other test in this repo. It is
 * green on the way out and a 500 on the first real request, and the report is
 * "could not load shops near you" with nothing in it to point at a GROUP BY.
 *
 * It has now happened twice in `MarketplaceController`:
 *
 *   1. the aisle's price range, `selectRaw` appended to `products.*` and a
 *      shop-rating subselect. Written up in that method's own comment.
 *   2. the home feed's trade counts, built on `$base()` — which carries
 *      `withAvg` and `withCount`, and each of those appends a subselect.
 *
 * The second one was written three functions below the comment describing the
 * first. A note in a file is not a guard.
 *
 * ── What this checks, and what it cannot ────────────────────────────────
 *
 * It reads the SQL rather than running it. Running it would prove nothing on
 * SQLite; the SQL is the same string MySQL will be handed, so the shape of it
 * is the honest thing to assert.
 *
 * It does not claim to find every grouped query in the app — it pins the two
 * that have already gone wrong, and gives the next one a place to be added.
 */
class GroupedQueriesSurviveMysqlTest extends TestCase
{
    /**
     * The code with its comments taken out.
     *
     * Needed because the comment beside the fixed query says "`$visible()`, NOT
     * `$base()`" — so an assertion that `$base()` is absent failed on the very
     * sentence explaining why it is absent. A guard that reads source has to
     * read the source and not the prose around it.
     */
    private function codeOnly(string $php): string
    {
        $lines = array_filter(
            explode("\n", $php),
            fn (string $l) => ! str_starts_with(ltrim($l), '//')
                && ! str_starts_with(ltrim($l), '*')
                && ! str_starts_with(ltrim($l), '/*'),
        );

        return implode("\n", $lines);
    }

    /**
     * A correlated subselect inside the SELECT list — what `withAvg` and
     * `withCount` add, and what MySQL will not group over.
     */
    private function hasSubselect(string $sql): bool
    {
        $select = substr($sql, 0, stripos($sql, ' from ') ?: strlen($sql));

        return str_contains($select, '(select');
    }

    /** The detector, against a query that genuinely has one. */
    public function test_it_recognises_a_subselect_when_it_sees_one(): void
    {
        $sql = Tenant::query()
            ->withCount(['reviews as reviews_count'])
            ->toSql();

        $this->assertTrue($this->hasSubselect($sql), 'the detector cannot see a withCount subselect');
    }

    public function test_it_does_not_cry_wolf_over_a_plain_select(): void
    {
        $this->assertFalse($this->hasSubselect(Tenant::query()->toSql()));
    }

    /**
     * THE ONE THAT BROKE LIVE — read from the controller, not rebuilt here.
     *
     * The first version of this test constructed its own query in the shape the
     * controller was supposed to use, and passed while the controller did the
     * opposite. That is the detector-with-its-own-blind-spot shape: a guard
     * that measures a copy of the subject cannot fail when the subject changes.
     * Restoring the live bug left it green, which is how it was caught.
     *
     * So it reads the source. A lint rule wearing a test's clothes, and the
     * honest limitation is stated: it proves the code says this, not that
     * MySQL accepted it. What makes that enough is that the SQL shape is the
     * only thing MySQL objects to, and the shape is decided by which builder
     * the group is hung off.
     */
    public function test_the_home_feeds_trade_counts_do_not_group_over_a_card(): void
    {
        $src = file_get_contents(
            base_path('app/Http/Controllers/Api/V1/Marketplace/MarketplaceController.php'),
        );

        /**
         * Anchored on `$counts = [];`, which appears once.
         *
         * The obvious anchor — the `groupBy` itself — matched the wrong query:
         * `browseFilters()` groups on the same column two hundred lines earlier
         * and does it correctly, so the test read that one and passed while the
         * home feed was broken. Two attempts at this window were wrong before
         * it pointed at the subject, which is the same lesson as the test it
         * replaced: a guard aimed slightly off measures nothing and says so in
         * green.
         */
        $at = strpos($src, '$counts = [];');
        $this->assertNotFalse($at, 'the trade-count query moved — find it before trusting this file');

        $query = $this->codeOnly(substr($src, $at, 700));
        $this->assertStringContainsString("groupBy('tenants.business_type')", $query);

        // Hung off the FENCE, which carries no subselect…
        $this->assertStringContainsString('$visible()', $query);
        // …and never off the card builder, whose withAvg/withCount do.
        $this->assertStringNotContainsString('$base()', $query);
        // `select`, which REPLACES, rather than `selectRaw`, which appends to
        // whatever the builder already selected.
        $this->assertStringNotContainsString('selectRaw', $query);
    }

    /**
     * And the builder it must not be hung off really does carry one.
     *
     * Without this, the assertion above passes on a `$base()` that has stopped
     * adding subselects — at which point it is guarding a rule that no longer
     * has a reason, and nobody would know.
     */
    public function test_the_card_builder_still_carries_the_subselects_that_make_this_a_rule(): void
    {
        $src = file_get_contents(
            base_path('app/Http/Controllers/Api/V1/Marketplace/MarketplaceController.php'),
        );

        $base = substr($src, strpos($src, '$base = fn ()') ?: 0, 500);

        $this->assertStringContainsString('withAvg', $base);
        $this->assertStringContainsString('withCount', $base);
    }

    /**
     * And the shape that must never come back: the same group over a builder
     * carrying a card's rating.
     *
     * Asserted as a POSITIVE — this is what the broken version looks like — so
     * the test above is measuring something real rather than passing because
     * the detector never fires.
     */
    public function test_the_broken_shape_is_exactly_what_it_looks_like(): void
    {
        $sql = Tenant::query()
            ->marketplaceVisible()
            ->withAvg(['reviews as rating_avg'], 'rating')
            ->selectRaw('tenants.business_type, COUNT(*) as shops_count')
            ->groupBy('tenants.business_type')
            ->toSql();

        // Green on SQLite, 500 on MySQL. This is the bug, held still.
        $this->assertTrue($this->hasSubselect($sql));
    }
}
