<?php

namespace Tests\Feature;

use App\Support\DateFormats;
use Tests\TestCase;

/**
 * THE PANEL WRITES A DATE THE WAY THE SERVER DOES.
 *
 * A receipt's date is written here, in PHP; the sales list, the date field and
 * every table write the same day in the browser. Two implementations of "how
 * does this shop write the twelfth of October" will drift, and the first
 * anybody hears of it is a screen saying 12/10 beside a paper saying 10/12 —
 * two months apart.
 *
 * So the strings are made HERE, by the one list, and written to a file the
 * panel's own tests read (`common/format/date.test.ts`). The same arrangement
 * as money (CurrencyFormatFixturesTest), for the same reason.
 *
 * To regenerate after a deliberate change:
 *
 *     SHOPOS_WRITE_FIXTURES=1 php artisan test --filter=DateFormatFixturesTest
 *     cp tests/fixtures/date-format.json ../panel/src/common/format/fixtures/
 */
class DateFormatFixturesTest extends TestCase
{
    /** Days chosen for where two formats part company: single digits, a day that could be a month, the year's edges, a leap day. */
    private const DAYS = [
        '2026-10-12', '2026-10-05', '2026-01-01', '2026-12-31', '2026-03-04', '2026-04-03',
        '2026-11-11', '2024-02-29', '2027-07-09', '1999-09-30', '2026-02-13',
    ];

    public function test_every_format_writes_these_days_as_the_fixture_says(): void
    {
        $fixtures = [
            'default' => DateFormats::DEFAULT,
            'formats' => DateFormats::options(),
            'cases' => [],
        ];

        foreach (DateFormats::codes() as $code) {
            foreach (self::DAYS as $day) {
                $fixtures['cases'][] = [
                    'code' => $code,
                    'day' => $day,
                    'long' => DateFormats::day($day, $code),
                    'short' => DateFormats::day($day, $code, withYear: false),
                ];
            }
        }

        $path = base_path('tests/fixtures/date-format.json');

        if (env('SHOPOS_WRITE_FIXTURES') === '1') {
            file_put_contents($path, json_encode($fixtures, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)."\n");
        }

        $this->assertFileExists($path, 'Run with SHOPOS_WRITE_FIXTURES=1 to create the fixtures.');
        $this->assertSame(
            json_decode((string) file_get_contents($path), true),
            json_decode((string) json_encode($fixtures), true),
            "The server no longer writes dates the way the fixtures say.\n\n"
            ."If that is deliberate, regenerate them and hand the panel its copy:\n\n"
            ."    SHOPOS_WRITE_FIXTURES=1 php artisan test --filter=DateFormatFixturesTest\n"
            ."    cp tests/fixtures/date-format.json ../panel/src/common/format/fixtures/\n",
        );
    }

    public function test_the_panels_copy_is_the_servers(): void
    {
        $ours = base_path('tests/fixtures/date-format.json');
        $theirs = base_path('../panel/src/common/format/fixtures/date-format.json');

        if (! is_file($theirs)) {
            $this->markTestSkipped('The panel is not checked out beside the backend here.');
        }

        $this->assertSame(
            (string) file_get_contents($ours),
            (string) file_get_contents($theirs),
            'The panel is testing its dates against an old copy. cp tests/fixtures/date-format.json ../panel/src/common/format/fixtures/',
        );
    }

    public function test_the_default_is_the_one_that_cannot_be_misread_and_an_unknown_code_falls_back_to_it(): void
    {
        $this->assertSame('12 Oct 2026', DateFormats::day('2026-10-12', DateFormats::DEFAULT));
        $this->assertSame(DateFormats::DEFAULT, DateFormats::code('whatever'));
        $this->assertSame(DateFormats::DEFAULT, DateFormats::code(null));
        // A day that is not there is written as nothing, not as today.
        $this->assertSame('', DateFormats::day(null, 'dmy'));
        $this->assertSame('', DateFormats::day('', 'dmy'));
    }

    public function test_a_papers_own_format_keeps_its_clock_and_takes_the_shops_date(): void
    {
        // The default writes the day as it is said — "5 Oct 2026", on the paper
        // as on the screen — and leaves the clock beside it alone.
        $this->assertSame('j M Y · h:i A', DateFormats::localise('d M Y · h:i A', DateFormats::DEFAULT));
        $this->assertSame('j M Y, H:i', DateFormats::localise('d M Y, H:i', DateFormats::DEFAULT));
        $this->assertSame('j M, H:i', DateFormats::localise('d M, H:i', DateFormats::DEFAULT));
        foreach (['Y-m-d H:i:s', 'D, M j g:i A', 'H:i'] as $notADateOfOurs) {
            $this->assertSame($notADateOfOurs, DateFormats::localise($notADateOfOurs, DateFormats::DEFAULT));
        }

        $this->assertSame('m/d/Y · h:i A', DateFormats::localise('d M Y · h:i A', 'mdy'));
        $this->assertSame('d/m/Y, H:i', DateFormats::localise('d M Y, H:i', 'dmy'));
        $this->assertSame('Y-m-d, g:i A', DateFormats::localise('j M Y, g:i A', 'ymd'));
        // Where the paper leaves the year off, so does the shop's date.
        $this->assertSame('d/m, H:i', DateFormats::localise('d M, H:i', 'dmy'));
        $this->assertSame('m/d, H:i', DateFormats::localise('d M, H:i', 'mdy'));
        // A machine's date, a bare clock and a weekday line are nobody's to change.
        $this->assertSame('Y-m-d H:i:s', DateFormats::localise('Y-m-d H:i:s', 'mdy'));
        $this->assertSame('H:i', DateFormats::localise('H:i', 'dmy'));
        $this->assertSame('D, M j g:i A', DateFormats::localise('D, M j g:i A', 'dmy'));
    }
}
