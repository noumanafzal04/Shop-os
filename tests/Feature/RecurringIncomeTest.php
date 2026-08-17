<?php

namespace Tests\Feature;

use App\Models\City;
use App\Models\Income;
use App\Models\IncomeCategory;
use App\Models\RecurringIncome;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Money that comes round again, on the side that was left out.
 *
 * ── Why only half of this existed ───────────────────────────────────────
 *
 * The expense manager's second pass gave rent, salaries and the internet bill
 * a template that falls due. Income got the same table, the same categories,
 * the same drawer link and the same branch scope — and no template at all.
 *
 * A shop's recurring income is not exotic: the flat upstairs let to a tenant,
 * the shutter rented to the phone-repair man, a monthly supply contract with
 * the school down the road. Every one arrives on the same day each month and
 * had to be typed from scratch, while the electricity bill three fields away
 * offered itself.
 *
 * ── The two rules worth testing hardest ─────────────────────────────────
 *
 * That it **falls due rather than posting itself** — income that appears
 * because a clock ticked is income nobody checked against a payment, and rent
 * is exactly the thing that goes unpaid quietly.
 *
 * And that the schedule **advances from the DUE date, not from today** — so a
 * template left alone for three months catches up one period at a time instead
 * of erasing two of them.
 */
class RecurringIncomeTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private IncomeCategory $rent;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $city = City::query()->create(['name' => 'Faisalabad', 'is_active' => true]);
        $this->shop = Tenant::factory()->create([
            'setup_completed' => true, 'city_id' => $city->id,
            'business_type' => 'mart', 'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();

        $this->rent = IncomeCategory::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Rent received',
        ]);
    }

    private function actingAsUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withHeader('Authorization', "Bearer {$token}");
    }

    private function template(array $over = []): RecurringIncome
    {
        $res = $this->actingAsUser($this->owner)->postJson('/api/v1/incomes/recurring', array_merge([
            'income_category_id' => $this->rent->id,
            'description' => 'Flat upstairs — rent',
            'amount' => 25000,
            'frequency' => 'monthly',
            'next_due_on' => now()->subDay()->toDateString(),
        ], $over))->assertCreated();

        return RecurringIncome::query()->findOrFail($res->json('data.id'));
    }

    private function fileIt(RecurringIncome $t, array $overrides = []): TestResponse
    {
        return $this->actingAsUser($this->owner)
            ->postJson("/api/v1/incomes/recurring/{$t->id}/post", $overrides);
    }

    public function test_nothing_posts_itself(): void
    {
        // THE rule. Income in the books because a clock ticked is income
        // nobody checked against a payment — and rent is exactly the thing
        // that goes unpaid quietly.
        $this->template();

        $this->artisan('schedule:run');

        $this->assertSame(0, Income::withoutTenancy()->count());
    }

    public function test_a_due_template_is_listed_and_counted(): void
    {
        $this->template();

        $res = $this->actingAsUser($this->owner)->getJson('/api/v1/incomes/recurring?due=1')->assertOk();

        $this->assertCount(1, $res->json('data'));
        $this->assertSame(1, $res->json('meta.due_count'));
        $this->assertTrue($res->json('data.0.is_due'));
    }

    public function test_posting_files_a_real_income(): void
    {
        $t = $this->template();

        $this->fileIt($t)->assertCreated();

        $income = Income::withoutTenancy()->firstOrFail();
        $this->assertEquals(25000, $income->amount);
        $this->assertSame('Flat upstairs — rent', $income->description);
        $this->assertSame($t->id, $income->recurring_income_id);
    }

    public function test_the_amount_can_be_corrected_at_the_moment_of_posting(): void
    {
        // A tenant who pays short HAS paid short. Forcing the agreed figure
        // files a receipt for money nobody received — which matters more on
        // this side of the page than on the expense side.
        $t = $this->template();

        $this->fileIt($t, ['amount' => 20000])->assertCreated();

        $this->assertEquals(20000, Income::withoutTenancy()->firstOrFail()->amount);
    }

    public function test_the_schedule_advances_from_the_due_date_not_from_today(): void
    {
        // Rent collected four days late must not drag every future month four
        // days later with it.
        $due = now()->subDays(4)->startOfDay();
        $t = $this->template(['next_due_on' => $due->toDateString()]);

        $this->fileIt($t)->assertCreated();

        $this->assertSame(
            $due->copy()->addMonthNoOverflow()->toDateString(),
            $t->fresh()->next_due_on->toDateString(),
        );
    }

    public function test_a_template_left_alone_for_months_catches_up_one_at_a_time(): void
    {
        // Each of those months genuinely had rent owing. Jumping to the next
        // future date would erase two of them.
        $due = now()->subMonths(3)->startOfDay();
        $t = $this->template(['next_due_on' => $due->toDateString()]);

        $this->fileIt($t)->assertCreated();

        $this->assertSame(
            $due->copy()->addMonthNoOverflow()->toDateString(),
            $t->fresh()->next_due_on->toDateString(),
        );
        $this->assertTrue($t->fresh()->isDue(), 'Still owed for the months behind it.');
    }

    public function test_it_files_against_the_month_it_was_owed_for(): void
    {
        // Not today. A March rent posted in June belongs to March, or every
        // report that reads by date is wrong about both months.
        $due = now()->subMonths(2)->startOfDay();
        $t = $this->template(['next_due_on' => $due->toDateString()]);

        $this->fileIt($t)->assertCreated();

        $this->assertSame(
            $due->toDateString(),
            Income::withoutTenancy()->firstOrFail()->income_date->toDateString(),
        );
    }

    public function test_something_not_yet_due_is_refused(): void
    {
        // Posting early would advance the schedule past a period that has not
        // happened, quietly skipping it.
        $t = $this->template(['next_due_on' => now()->addWeek()->toDateString()]);

        $this->fileIt($t)
            ->assertStatus(422)
            ->assertJsonPath('meta.error_code', 'RECURRING_NOT_DUE');

        $this->assertSame(0, Income::withoutTenancy()->count());
    }

    public function test_a_paused_template_files_nothing(): void
    {
        $t = $this->template();
        $this->actingAsUser($this->owner)
            ->putJson("/api/v1/incomes/recurring/{$t->id}", ['is_active' => false])
            ->assertOk();

        $this->fileIt($t)->assertStatus(409)->assertJsonPath('meta.error_code', 'RECURRING_PAUSED');
    }

    public function test_every_frequency_lands_where_it_should(): void
    {
        $due = now()->subDay()->startOfDay();

        foreach ([
            'weekly' => $due->copy()->addWeek(),
            'monthly' => $due->copy()->addMonthNoOverflow(),
            'quarterly' => $due->copy()->addMonthsNoOverflow(3),
            'yearly' => $due->copy()->addYearNoOverflow(),
        ] as $frequency => $expected) {
            $t = $this->template(['frequency' => $frequency, 'next_due_on' => $due->toDateString()]);

            $this->fileIt($t)->assertCreated();

            $this->assertSame(
                $expected->toDateString(),
                $t->fresh()->next_due_on->toDateString(),
                "{$frequency} advanced to the wrong date",
            );
        }
    }

    public function test_a_cashier_cannot_file_the_shop_s_income(): void
    {
        $cashier = User::factory()->tenantStaff($this->shop, ['sales.manage'])->create();
        $t = $this->template();

        $this->actingAsUser($cashier)
            ->postJson("/api/v1/incomes/recurring/{$t->id}/post")
            ->assertForbidden();
    }

    public function test_one_shop_never_sees_another_shop_s_templates(): void
    {
        $this->template();

        $other = Tenant::factory()->create([
            'setup_completed' => true, 'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $stranger = User::factory()->shopOwner($other)->create();

        $this->assertCount(
            0,
            $this->actingAsUser($stranger)->getJson('/api/v1/incomes/recurring')->assertOk()->json('data'),
        );
    }
}
