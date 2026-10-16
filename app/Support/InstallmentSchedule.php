<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use DateTimeInterface;

/**
 * AN INSTALLMENT PLAN, MONTH BY MONTH — WORKED OUT, NEVER STORED (F1).
 *
 * The rules, each with a test:
 *
 *   monthly   what is financed ÷ months, rounded UP to a whole rupee; the
 *             LAST month takes what is left, so advance + every month = the
 *             bill exactly. (When whole rupees cannot fit — 10 over 7 months —
 *             the split is to the paisa instead.)
 *   due dates the first due date, then the same day each month; a 31st is the
 *             last day of a shorter month, and goes back to the 31st after it.
 *   paid      fills the OLDEST month first, so a part payment leaves that
 *             month part-paid.
 *   late      a month whose date has passed and is not fully paid — "late 2
 *             months · 9,000".
 *   due now   what is late, plus the next month's when it falls due within
 *             a week (SOON_DAYS): what a customer at the counter is asked for.
 *             A month weeks away is not asked for — a customer who paid
 *             ahead is up to date, and "to collect" says nothing to collect.
 *   left      the bill − the advance − everything paid.
 */
final class InstallmentSchedule
{
    /** A month is "due" — asked for at the counter — this many days before its date. */
    public const SOON_DAYS = 7;

    /** @return array{monthly: float, last: float} */
    public static function split(float $financed, int $months): array
    {
        $financed = round($financed, 2);
        $monthly = ceil($financed / $months);
        if ($months > 1 && $monthly * ($months - 1) >= $financed) {
            $monthly = floor($financed * 100 / $months) / 100;
        }

        return ['monthly' => (float) $monthly, 'last' => round($financed - $monthly * ($months - 1), 2)];
    }

    /** The date month `$n` (1 = the first) falls due. */
    public static function dueOn(string|DateTimeInterface $first, int $n): CarbonImmutable
    {
        return CarbonImmutable::parse($first)->startOfDay()->addMonthsNoOverflow($n - 1);
    }

    /**
     * Where a plan stands on `$today` (the shop's calendar date), given what has
     * been paid against it.
     *
     * @return array{
     *   rows: list<array{n: int, due_on: string, amount: float, paid: float, state: string}>,
     *   paid: float, left: float, late: float, late_months: int, due_now: float,
     *   next_due_on: ?string, months_paid: int
     * }
     */
    public static function standing(string|DateTimeInterface $first, int $months, float $monthly, float $last, float $paid, string $today): array
    {
        $remaining = round($paid, 2);
        $rows = [];
        $late = 0.0;
        $lateMonths = 0;
        $next = null;
        $dueNow = 0.0;
        $monthsPaid = 0;
        $sawDue = false;
        $financed = round($monthly * ($months - 1) + $last, 2);
        $soon = CarbonImmutable::parse($today)->addDays(self::SOON_DAYS)->toDateString();

        for ($n = 1; $n <= $months; $n++) {
            $amount = $n === $months ? $last : $monthly;
            $covered = round(min($amount, max(0.0, $remaining)), 2);
            $remaining = round($remaining - $covered, 2);
            $due = self::dueOn($first, $n)->toDateString();
            $short = round($amount - $covered, 2);

            if ($short <= 0.0) {
                $state = 'paid';
                $monthsPaid++;
            } else {
                // The oldest month not fully paid — late or not, it is next.
                $next ??= $due;
                if ($due < $today) {
                    $state = 'late';
                    $late += $short;
                    $lateMonths++;
                    $dueNow += $short;
                } elseif (! $sawDue && $due <= $soon) {
                    // The next month, falling due within the week.
                    $state = 'due';
                    $sawDue = true;
                    $dueNow += $short;
                } else {
                    $state = 'upcoming';
                }
            }

            $rows[] = ['n' => $n, 'due_on' => $due, 'amount' => $amount, 'paid' => $covered, 'state' => $state];
        }

        return [
            'rows' => $rows,
            'paid' => round($paid, 2),
            'left' => round(max(0.0, $financed - $paid), 2),
            'late' => round($late, 2),
            'late_months' => $lateMonths,
            'due_now' => round($dueNow, 2),
            'next_due_on' => $next,
            'months_paid' => $monthsPaid,
        ];
    }
}
