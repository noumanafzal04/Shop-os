<?php

namespace Tests\Unit;

use App\Support\InstallmentSchedule;
use PHPUnit\Framework\TestCase;

/**
 * THE INSTALLMENT ARITHMETIC (F1) — "or in calculations sahi chal rhi ye b
 * dekhna" (the owner, 2026-10-15). Each rule the plan screen shows, pinned.
 */
class InstallmentScheduleTest extends TestCase
{
    public function test_the_months_add_up_to_what_is_financed_exactly(): void
    {
        $this->assertSame(['monthly' => 5000.0, 'last' => 5000.0], InstallmentSchedule::split(50000, 10));
        // Rounded UP to a whole rupee; the last month takes the rest.
        $this->assertSame(['monthly' => 3334.0, 'last' => 3332.0], InstallmentSchedule::split(10000, 3));
        // Whole rupees cannot fit 10 over 7 months — split to the paisa instead.
        $this->assertSame(['monthly' => 1.42, 'last' => 1.48], InstallmentSchedule::split(10, 7));

        foreach ([[50000, 10], [10000, 3], [44999.5, 12], [10, 7], [123457, 9]] as [$financed, $months]) {
            $s = InstallmentSchedule::split($financed, $months);
            $this->assertEqualsWithDelta($financed, $s['monthly'] * ($months - 1) + $s['last'], 0.001, "{$financed} over {$months}");
            $this->assertGreaterThan(0, $s['last']);
        }
    }

    public function test_a_31st_is_the_last_day_of_a_short_month_and_comes_back(): void
    {
        $this->assertSame('2027-01-31', InstallmentSchedule::dueOn('2027-01-31', 1)->toDateString());
        $this->assertSame('2027-02-28', InstallmentSchedule::dueOn('2027-01-31', 2)->toDateString());
        $this->assertSame('2027-03-31', InstallmentSchedule::dueOn('2027-01-31', 3)->toDateString());
        $this->assertSame('2026-12-15', InstallmentSchedule::dueOn('2026-11-15', 2)->toDateString());
    }

    public function test_paying_fills_the_oldest_month_and_says_what_is_late(): void
    {
        // 10 × 5,000 from 15 Nov; 12,000 paid; on 20 Feb.
        $s = InstallmentSchedule::standing('2026-11-15', 10, 5000, 5000, 12000, '2027-02-20');

        $this->assertSame(['paid', 'paid', 'late', 'late', 'upcoming', 'upcoming'], array_column(array_slice($s['rows'], 0, 6), 'state'));
        $this->assertSame(2000.0, $s['rows'][2]['paid'], 'a part payment sits on the oldest unpaid month');
        $this->assertSame(8000.0, $s['late']);
        $this->assertSame(2, $s['late_months']);
        $this->assertSame('2027-01-15', $s['next_due_on']);
        // Up to date = what is late; March's is weeks away and not asked for yet.
        $this->assertSame(8000.0, $s['due_now']);
        $this->assertSame(38000.0, $s['left']);
        $this->assertSame(2, $s['months_paid']);

        // Five days before 15 March, March's is due too.
        $week = InstallmentSchedule::standing('2026-11-15', 10, 5000, 5000, 12000, '2027-03-10');
        $this->assertSame(['late', 'late', 'due', 'upcoming'], array_column(array_slice($week['rows'], 2, 4), 'state'));
        $this->assertSame(13000.0, $week['due_now']);
        $this->assertSame('2027-01-15', $week['next_due_on']);
    }

    public function test_a_month_due_today_is_due_not_late_and_paying_ahead_moves_the_next_date(): void
    {
        $today = InstallmentSchedule::standing('2026-11-15', 10, 5000, 5000, 0, '2026-11-15');
        $this->assertSame('due', $today['rows'][0]['state']);
        $this->assertSame(0.0, $today['late']);

        // Paid three months ahead: the next date moves, and nothing is asked for.
        $ahead = InstallmentSchedule::standing('2026-11-15', 10, 5000, 5000, 15000, '2026-11-01');
        $this->assertSame('2027-02-15', $ahead['next_due_on']);
        $this->assertSame(0.0, $ahead['due_now'], 'a customer who paid ahead was asked for money');
        $this->assertSame('upcoming', $ahead['rows'][3]['state']);

        $done = InstallmentSchedule::standing('2026-11-15', 10, 5000, 5000, 50000, '2027-12-01');
        $this->assertNull($done['next_due_on']);
        $this->assertSame(0.0, $done['left']);
        $this->assertSame(10, $done['months_paid']);
    }
}
