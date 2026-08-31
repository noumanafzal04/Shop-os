<?php

namespace Tests\Feature;

use App\Enums\SaleStatus;
use App\Support\Takings;
use Tests\TestCase;

/**
 * TWO WAYS OF ASKING THE SAME QUESTION, AGREEING BY ACCIDENT.
 *
 * "Which sales count as trading?" is asked all over this codebase, and after
 * `Takings` there are still two spellings of it:
 *
 *   Takings::COUNTED        completed · partially_refunded · refunded
 *   status != cancelled     used by the customer card, the dispensing
 *                           register, the waiter report and global search
 *
 * Today those select exactly the same rows — but only because `SaleStatus` has
 * exactly four cases. That is not a rule, it is an arithmetic coincidence. Add
 * a fifth — `parked`, `on_hold`, `pending_payment`, anything — and the two
 * spellings part company silently: the reports would exclude it and the
 * customer's card would count it, and nothing would fail.
 *
 * This codebase has met that exact failure before. "What is running low" was
 * asked in five places and answered two ways, and the two agreed until a
 * threshold moved. So the coincidence is written down here rather than trusted.
 *
 * ── What to do when this goes red ───────────────────────────────────────
 *
 * A new status has been added. Decide what it means for takings, put it in
 * `Takings::COUNTED` or deliberately leave it out — and then go through the
 * `!= cancelled` sites this test names and make each one say what it means.
 * They are the places that will have quietly changed behaviour.
 */
class WhichSalesCountTest extends TestCase
{
    public function test_not_cancelled_and_counted_still_mean_the_same_thing(): void
    {
        $counted = array_map(static fn (SaleStatus $s): string => $s->value, Takings::COUNTED);
        $notCancelled = array_values(array_filter(
            array_map(static fn (SaleStatus $s): string => $s->value, SaleStatus::cases()),
            static fn (string $v): bool => $v !== SaleStatus::Cancelled->value,
        ));

        sort($counted);
        sort($notCancelled);

        $this->assertSame(
            $notCancelled,
            $counted,
            "\nA sale status has been added or removed, so `Takings::COUNTED` and the "
            ."`status != cancelled` spelling no longer select the same rows.\n\n"
            .'Decide what the new status means for takings, then visit every place that '
            ."spells the question the other way:\n\n  "
            .implode("\n  ", $this->theOtherSpelling())
            ."\n\nEach of them is now answering a different question from the reports.\n",
        );
    }

    /**
     * The other spelling, found rather than listed.
     *
     * A hand-written list of files is out of date the week after it is written,
     * and this message is only useful at the moment somebody is standing in
     * front of a red test wondering where to look.
     *
     * @return array<int, string>
     */
    private function theOtherSpelling(): array
    {
        $found = [];
        $root = base_path('app');

        /** @var \SplFileInfo $file */
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root)) as $file) {
            if ($file->getExtension() !== 'php') {
                continue;
            }

            $src = (string) file_get_contents($file->getPathname());
            $hits = preg_match_all("/'!=',\s*SaleStatus::Cancelled/", $src);

            if ($hits > 0) {
                $found[] = str_replace(base_path().'/', '', $file->getPathname())." ({$hits})";
            }
        }

        sort($found);

        // The denominator. An empty list would make the message above read as
        // "nothing else asks this", which would be the opposite of true — and a
        // scanner that finds nothing is usually broken rather than lucky.
        $this->assertNotEmpty(
            $found,
            'the scan for the other spelling found nothing at all — it is looking in the wrong place, '
            .'not celebrating a codebase that has one copy of the rule',
        );

        return $found;
    }
}
