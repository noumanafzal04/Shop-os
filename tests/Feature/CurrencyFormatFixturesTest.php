<?php

namespace Tests\Feature;

use App\Support\Currencies;
use Tests\TestCase;

/**
 * THE PANEL WRITES AN AMOUNT THE WAY THE SERVER DOES.
 *
 * A receipt is written here, in PHP; the till, the dashboard and every table
 * write the same figure in the browser. Two implementations of "how is 1234567
 * rupees written in India" will drift, and the first anybody hears of it is a
 * screen saying ₹1,234,567 beside a receipt saying ₹12,34,567.
 *
 * So the strings are made HERE, by the one list, and written to a file the
 * panel's own tests read (`common/format/currency.test.ts`). Same arrangement
 * as the till's bill and the offline pricing engine, for the same reason.
 *
 * To regenerate after a deliberate change:
 *
 *     SHOPOS_WRITE_FIXTURES=1 php artisan test --filter=CurrencyFormatFixturesTest
 *     cp tests/fixtures/currency-format.json ../panel/src/common/format/fixtures/
 */
class CurrencyFormatFixturesTest extends TestCase
{
    /** Amounts chosen for where the rules bite: wholes, fractions, lakhs, crores, below zero. */
    private const AMOUNTS = [
        0, 1, 12.3, 99.99, 999.5, 1000, 4000, 4000.0000001, 12345, 100000, 123456, 1234567, 1234567.5,
        2350196.5, 12345678901.25, -5, -500, -1500.75, 0.004, 0.006, 0.5, 682.5, 1438.5,
    ];

    public function test_every_currency_writes_these_amounts_as_the_fixture_says(): void
    {
        $fixtures = [
            'default' => Currencies::DEFAULT,
            'currencies' => Currencies::options(),
            'cases' => [],
        ];

        foreach (Currencies::codes() as $code) {
            foreach (self::AMOUNTS as $amount) {
                $fixtures['cases'][] = [
                    'code' => $code,
                    'amount' => $amount,
                    'screen' => Currencies::format($amount, $code),
                    'paper' => Currencies::paper($amount, $code),
                    'number' => Currencies::number($amount, $code),
                ];
            }
        }

        $path = base_path('tests/fixtures/currency-format.json');

        if (env('SHOPOS_WRITE_FIXTURES') === '1') {
            file_put_contents($path, json_encode($fixtures, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)."\n");
        }

        $this->assertFileExists($path, 'Run with SHOPOS_WRITE_FIXTURES=1 to create the fixtures.');
        $this->assertSame(
            json_decode((string) file_get_contents($path), true),
            json_decode((string) json_encode($fixtures), true),
            "The server no longer writes money the way the fixtures say.\n\n"
            ."If that is deliberate, regenerate them and hand the panel its copy:\n\n"
            ."    SHOPOS_WRITE_FIXTURES=1 php artisan test --filter=CurrencyFormatFixturesTest\n"
            ."    cp tests/fixtures/currency-format.json ../panel/src/common/format/fixtures/\n",
        );
    }

    public function test_the_panels_copy_is_the_servers(): void
    {
        $ours = base_path('tests/fixtures/currency-format.json');
        $theirs = base_path('../panel/src/common/format/fixtures/currency-format.json');

        if (! is_file($theirs)) {
            $this->markTestSkipped('The panel is not checked out beside the backend here.');
        }

        $this->assertSame(
            (string) file_get_contents($ours),
            (string) file_get_contents($theirs),
            'The panel is testing its money against an old copy. cp tests/fixtures/currency-format.json ../panel/src/common/format/fixtures/',
        );
    }

    /**
     * NO FILE WRITES A RUPEE MARK FOR ITSELF.
     *
     * Eleven places glued "Rs" to `number_format()` or fell back to it when a
     * setting was missing. Each was right for a shop in Lahore and wrong for
     * every other shop — and a twelfth would be written the same way, by
     * copying one of the eleven. An amount is written by Currencies, through
     * `Tenant::money()`; a file that needs the mark asks for it.
     */
    public function test_no_php_file_writes_a_currency_mark_of_its_own(): void
    {
        $offences = [];
        $scanned = 0;

        foreach (['app', 'resources/views', 'routes'] as $dir) {
            $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(base_path($dir)));
            foreach ($files as $file) {
                if ($file->getExtension() !== 'php') {
                    continue;
                }
                $rel = str_replace(base_path().'/', '', $file->getPathname());
                // The list itself is the one place a mark is written down.
                if ($rel === 'app/Support/Currencies.php') {
                    continue;
                }
                // Made-up shops for a demo are DATA: a packet really is called
                // "Slanty Rs 30", and an offer really is named "Rs 150 off".
                if (str_starts_with($rel, 'app/Console/Commands/DemoShops/') || $rel === 'app/Console/Commands/SeedLoadTestShops.php') {
                    continue;
                }
                $scanned++;

                foreach (explode("\n", (string) file_get_contents($file->getPathname())) as $i => $line) {
                    $trimmed = ltrim($line);
                    // Prose about money is not money: comments say "Rs 5,000" to explain a rule.
                    if (str_starts_with($trimmed, '*') || str_starts_with($trimmed, '//') || str_starts_with($trimmed, '/*') || str_starts_with($trimmed, '{{--')) {
                        continue;
                    }
                    // Code only: a trailing comment may say "Rs" too.
                    $code = preg_replace('~\s//.*$~', '', $line) ?? $line;

                    // A quoted mark, a string that opens with one, one glued to a
                    // variable, or one fallen back to. Not a bare "$": in PHP
                    // that is as often a spreadsheet's "$A$2" as it is a dollar.
                    if (preg_match('/([\'"])(Rs|PKR|₨|₹)\s?\1|[\'"]Rs\s|Rs\s?\{\$|\?\?\s*[\'"]Rs[\'"]/u', $code) === 1) {
                        $offences[] = "  {$rel}:".($i + 1).'  '.trim($line);
                    }
                }
            }
        }

        $this->assertGreaterThan(300, $scanned, 'the scan found almost no PHP to read');
        $this->assertSame('', implode("\n", $offences), "These write a currency mark themselves — use Tenant::money() or App\\Support\\Currencies:\n");
    }
}
