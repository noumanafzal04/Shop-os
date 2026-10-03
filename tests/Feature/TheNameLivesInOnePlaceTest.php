<?php

namespace Tests\Feature;

use Tests\TestCase;

/**
 * THE PRODUCT'S NAME IS WRITTEN ONCE — `APP_NAME`.
 *
 * ── What this is the fix for ─────────────────────────────────────────
 *
 * The product was renamed and arrived half-done. The panel's page titles said
 * one name while its landing page, its Help Centre and its sign-in screen
 * said another; the two phone apps said the old one; and the API greeted a
 * new shop, sent every OTP and told every rider why they were blocked using a
 * literal nobody would think to grep for.
 *
 * Laravel already has the one place: `config('app.name')`, from `APP_NAME`.
 * Nothing here had been using it.
 *
 * ── Why the OLD name is checked as well as the new ───────────────────
 *
 * A guard that only knows the CURRENT name disarms itself on the next rename:
 * `APP_NAME` moves on, the previous spelling stops being forbidden, and every
 * stale copy of it passes — on exactly the day they start mattering. So past
 * names are listed and stay listed.
 */
class TheNameLivesInOnePlaceTest extends TestCase
{
    /**
     * Names that may not appear in a string PHP hands to a person.
     *
     * The current one is read from config rather than typed, so this file is
     * not itself a second place the name is written.
     */
    private function names(): array
    {
        return array_values(array_unique([config('app.name'), 'CartZe', 'ShopOS']));
    }

    /**
     * Lines that carry an IDENTIFIER rather than a label.
     *
     * The distinction is the whole reason a rename is safe. A sender id is
     * registered with a telco; renaming it does not re-register it, it just
     * stops the message arriving. See `config/services.php`.
     */
    private const IDENTIFIERS = [
        // The SMS sender id, registered with the telco — see config/services.
        "env('SMS_FROM'",
        // Artisan command names. `shopos:prune-demos` is in the SCHEDULER and
        // may be in a server's crontab; renaming it stops a job running and
        // nothing reports that it stopped.
        'shopos:',
        // Email addresses and hosts. A mailbox does not move house because a
        // product was renamed, and a seeded login that changed spelling is a
        // seeded login nobody can use.
        '@shopos.test',
        'cartze.shop',
    ];

    public function test_no_php_file_puts_the_product_name_in_a_string(): void
    {
        $offences = [];
        $scanned = 0;

        foreach (['app', 'config', 'routes', 'database/seeders'] as $dir) {
            $root = base_path($dir);
            if (! is_dir($root)) {
                continue;
            }

            $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root));
            foreach ($files as $file) {
                if ($file->getExtension() !== 'php') {
                    continue;
                }
                $scanned++;

                $rel = str_replace(base_path().'/', '', $file->getPathname());
                foreach (explode("\n", (string) file_get_contents($file->getPathname())) as $i => $line) {
                    $trimmed = ltrim($line);

                    // A COMMENT is prose about the product, not something a
                    // person is shown. The rule is about what gets rendered.
                    if (str_starts_with($trimmed, '*') || str_starts_with($trimmed, '//') || str_starts_with($trimmed, '/*')) {
                        continue;
                    }
                    foreach (self::IDENTIFIERS as $ok) {
                        if (str_contains($line, $ok)) {
                            continue 2;
                        }
                    }
                    foreach ($this->names() as $name) {
                        if (stripos($line, (string) $name) !== false) {
                            $offences[] = "  {$rel}:".($i + 1).'  '.trim($line);

                            continue 2;
                        }
                    }
                }
            }
        }

        // Without this a walk that matched nothing would report a clean sweep
        // — the same shape as asserting a response is "not empty".
        $this->assertGreaterThan(200, $scanned, 'the scan found almost no PHP to read');
        $this->assertSame('', implode("\n", $offences));
    }

    public function test_the_copy_a_person_reads_comes_from_the_config(): void
    {
        /**
         * The other half, and the half a scan cannot see: a file could avoid
         * the literal by building the string some other way and still never
         * reach the config. These are the four places the name is actually
         * shown to somebody.
         */
        $this->assertStringContainsString(
            "config('app.name')",
            (string) file_get_contents(app_path('Services/OtpService.php')),
            'the OTP a person receives must name the product from the config',
        );
        $this->assertStringContainsString(
            "config('app.name')",
            (string) file_get_contents(app_path('Http/Controllers/Api/V1/Auth/RegisterController.php')),
            'the welcome a new shop sees must name the product from the config',
        );
        $this->assertStringContainsString(
            "config('app.name')",
            (string) file_get_contents(app_path('Services/RiderService.php')),
            'the reason a rider is blocked must name the product from the config',
        );
    }

    public function test_an_address_does_not_follow_a_rename(): void
    {
        /**
         * The rule that costs real data if it is got wrong. A key something is
         * STORED under, or an id somebody else has registered, is not
         * branding — renaming it points at nothing and nothing says so.
         */
        $this->assertSame('CartZe', config('services.sms.from'), 'the SMS sender id is registered with the telco, not with us');
    }
}
