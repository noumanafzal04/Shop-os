<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;

/**
 * Is anything built, tested, and unreachable?
 *
 * ── The oldest shape in this codebase ───────────────────────────────────
 *
 * "A capability is not shipped until something a person touches can reach it"
 * has been written down here eleven times, each time after somebody found it by
 * hand. The panel now has this rule; this is the server's half, and it found
 * one on its first run.
 *
 * `OfflinePolicy::refusalFor` — the sentence explaining why a medicine or a
 * serial-tracked handset may not be sold with no line — was written, tested,
 * and called by nothing. The sync endpoint enforced the four SALE-level offline
 * rules and never the ITEM one, so a chemist's tablet could send up a week of
 * medicine sales and every one of them landed recorded as clean. The report
 * that exists to show an owner what broke a rule had nothing to show.
 *
 * ── What this checks ────────────────────────────────────────────────────
 *
 * A public method whose only callers live in `tests/`. Tests prove a thing
 * works. They do not prove anybody can get to it.
 *
 * ── The PHP-specific trap ───────────────────────────────────────────────
 *
 * The first version of this stripped string literals along with comments, and
 * reported nineteen findings of which fourteen were noise: **in Laravel a route
 * names its method as a string** — `[PurchaseOrderController::class, 'receive']`
 * — so stripping strings deletes exactly the wiring this is looking for.
 * Comments come out; strings stay in.
 *
 * An audit that produces findings is a thing to verify, not to believe.
 *
 * ── What this rule cannot see ───────────────────────────────────────────
 *
 * Both of these were found by mutating something and watching this stay green,
 * and they are written down because a rule that overstates its reach is worse
 * than one that states its limits.
 *
 *   • PRIVATE methods are not checked. A controller's private helpers are
 *     ordinary structure, and a private method nobody calls is dead code —
 *     a different problem with different tools.
 *   • A method whose name is also a common word self-exempts, because "used
 *     inside its own file" is counted by name. `for`, `all`, `get` will each
 *     match a keyword or a variable somewhere in their own file and pass.
 *     Narrow names are checked; broad ones are on trust.
 */
class ReachableTest extends TestCase
{
    /**
     * Methods the framework calls by convention, never by name from our code.
     *
     * Listed rather than pattern-matched so that adding one is a decision
     * somebody writes down. A controller's `store`/`index`/`show` are
     * deliberately NOT here: those are named as strings by the route files,
     * which this reads — so a controller method with no route still shows up,
     * and that is a finding worth having.
     */
    private const FRAMEWORK = [
        'boot', 'register', 'handle', 'rules', 'authorize', 'messages', 'attributes',
        'casts', 'toArray', 'up', 'down', 'run', 'definition', 'render', 'report',
        'via', 'toMail', 'toDatabase', 'broadcastOn', 'failed', 'middleware',
        'schedule', 'withValidator', 'prepareForValidation', 'passedValidation',
    ];

    /**
     * Public methods whose only caller is a test, legitimately, with why.
     *
     * Keyed `path::method`. Every one of these is introspection over a map or a
     * constant so a test can check it from both directions; none is a
     * capability a shop is waiting for.
     */
    private const TEST_ONLY = [
        'app/Support/ProductCsv.php::fields' => 'header-to-field parity, so the CSV round trip is asserted rather than assumed',
        'app/Support/StaffPresets.php::permissionsFor' => 'reads one preset out of the map; a preset ticks boxes and is forgotten, so nothing stores it',
        'app/Support/PlanLimits.php::assignedKeys' => 'registry introspection — pins which limits an admin assigns',
        'app/Support/PlanLimits.php::billedKeys' => 'registry introspection — pins which limits a plan sells',
        // A PHP mirror of a rule that lives in SQL in three controllers, kept
        // as the test's second opinion on the variant-sum half of it. Its own
        // docblock now says it is branch-blind, because that is the trap: it
        // would answer for the whole shop where the inventory screen answers
        // for one branch.
        'app/Models/Product.php::isLowStock' => "the test's second opinion on the variant-sum rule",
    ];

    /**
     * Designed, correct, and not surfaced yet — with the thing that would
     * surface it.
     *
     * A separate list from the one above on purpose. Those are test
     * introspection and always will be. These are unshipped capability, and the
     * moment this list grows past a handful it is telling you the product is
     * accumulating work nobody can use.
     */
    private const NOT_SURFACED_YET = [];

    /** @return list<string> */
    private function phpFiles(string $dir): array
    {
        if (! is_dir($dir)) {
            return [];
        }

        $out = [];
        foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir)) as $file) {
            if ($file->isFile() && $file->getExtension() === 'php') {
                $out[] = $file->getPathname();
            }
        }

        return $out;
    }

    /**
     * Comments out, strings IN.
     *
     * Both halves matter. A docblock that MENTIONS a method is not a caller, so
     * leaving comments in means the last real call can be deleted and this
     * check stays green — a rule a leftover sentence can satisfy is not a rule.
     * And strings stay because a Laravel route is a string; see the class
     * docblock for what removing them cost.
     */
    private function strip(string $source): string
    {
        $out = '';

        foreach (token_get_all($source) as $token) {
            if (is_array($token)) {
                if ($token[0] === T_COMMENT || $token[0] === T_DOC_COMMENT) {
                    continue;
                }
                $out .= $token[1];
            } else {
                $out .= $token;
            }
        }

        return $out;
    }

    private function occurrences(string $code, string $name): int
    {
        return preg_match_all('/\b'.preg_quote($name, '/').'\b/', $code);
    }

    /** @return list<string> */
    private function unreachable(): array
    {
        $root = dirname(__DIR__, 2);

        $app = $this->phpFiles("{$root}/app");
        $tests = $this->phpFiles("{$root}/tests");
        // Routes, migrations, seeders and config are all places our own code
        // reaches for a method by name. A command that only ever runs from the
        // scheduler is reached; so is a controller action named by a route.
        $wiring = array_merge(
            $this->phpFiles("{$root}/routes"),
            $this->phpFiles("{$root}/database"),
            $this->phpFiles("{$root}/config"),
            $this->phpFiles("{$root}/bootstrap"),
        );

        // Stripped once per file rather than once per lookup: the panel's
        // version of this rule timed out doing it the other way round, and the
        // expensive part being cheap is the difference between a rule that runs
        // on every commit and one somebody switches off.
        $code = [];
        foreach (array_merge($app, $tests, $wiring) as $file) {
            $code[$file] = $this->strip((string) file_get_contents($file));
        }

        $found = [];

        foreach ($app as $file) {
            $source = $code[$file];
            $where = str_replace("{$root}/", '', $file);

            preg_match_all(
                '/^\s*(?:final\s+|abstract\s+|static\s+)*public\s+(?:static\s+)?function\s+(\w+)/m',
                $source,
                $matches,
            );

            foreach (array_unique($matches[1]) as $name) {
                if (str_starts_with($name, '__') || in_array($name, self::FRAMEWORK, true)) {
                    continue;
                }
                // Used inside its own file counts as reached.
                if ($this->occurrences($source, $name) > 1) {
                    continue;
                }
                if (isset(self::TEST_ONLY["{$where}::{$name}"]) || isset(self::NOT_SURFACED_YET["{$where}::{$name}"])) {
                    continue;
                }

                $fromApp = 0;
                $fromTests = 0;
                foreach ($code as $other => $otherCode) {
                    if ($other === $file || $this->occurrences($otherCode, $name) === 0) {
                        continue;
                    }
                    if (str_starts_with($other, "{$root}/tests")) {
                        $fromTests++;
                    } else {
                        $fromApp++;
                    }
                }

                // Untested AND unused is dead code, which is a different
                // problem and not this rule's business. What this catches is
                // the thing that LOOKS shipped: proved to work, reachable by
                // nobody.
                if ($fromApp === 0 && $fromTests > 0) {
                    $found[] = "{$where}::{$name}";
                }
            }
        }

        sort($found);

        return $found;
    }

    public function test_it_reads_the_whole_application_so_a_silent_zero_cannot_pass_as_a_clean_sweep(): void
    {
        $this->assertGreaterThan(300, count($this->phpFiles(dirname(__DIR__, 2).'/app')));
    }

    public function test_a_docblock_mentioning_a_method_is_not_a_caller(): void
    {
        $stripped = $this->strip("<?php\n/** calls doThing() */\n// doThing\n\$x = 1;\n");

        $this->assertSame(0, $this->occurrences($stripped, 'doThing'));
    }

    public function test_a_route_naming_its_action_as_a_string_is_a_caller(): void
    {
        // The bug that made the first run of this report fourteen false
        // findings. If this ever goes back to zero, every routed controller
        // method in the application becomes a finding.
        $stripped = $this->strip("<?php\nRoute::post('x', [Foo::class, 'receive']);\n");

        $this->assertSame(1, $this->occurrences($stripped, 'receive'));
    }

    public function test_nothing_is_built_tested_and_reachable_by_nobody(): void
    {
        $this->assertSame([], $this->unreachable());
    }
}
