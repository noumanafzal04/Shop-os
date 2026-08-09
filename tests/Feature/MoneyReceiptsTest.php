<?php

namespace Tests\Feature;

use App\Models\Expense;
use App\Models\ExpenseCategory;
use App\Models\Income;
use App\Models\IncomeCategory;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * The paper behind the number.
 *
 * An entry without its receipt is an assertion; with it, it is a record — the
 * difference that decides an argument about someone else's spending.
 *
 * Expenses have had this since the module shipped. Income had the COLUMN and
 * nothing else: no endpoint wrote it, no accessor read it, so the side of the
 * book an owner is most likely to challenge — an "owner investment", a
 * "supplier refund" — was the side that could not be evidenced. That is the
 * quiet failure mode, because the schema looked complete.
 *
 * Neither path had a single test before this file, which is how it survived.
 */
class MoneyReceiptsTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private ExpenseCategory $rent;

    private IncomeCategory $investment;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);
        Storage::fake('public');

        $this->tenant = Tenant::factory()->provisioned()->create();
        $this->owner = User::factory()->shopOwner($this->tenant)->create();
        $this->rent = ExpenseCategory::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Rent',
        ]);
        $this->investment = IncomeCategory::withoutTenancy()->create([
            'tenant_id' => $this->tenant->id, 'name' => 'Owner Investment',
        ]);
    }

    private function login(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function anIncome(): string
    {
        return $this->login()->postJson('/api/v1/incomes', [
            'income_category_id' => $this->investment->id,
            'description' => 'Owner investment',
            'amount' => 80000,
            'income_date' => now()->toDateString(),
        ])->assertCreated()->json('data.id');
    }

    private function anExpense(): string
    {
        return $this->login()->postJson('/api/v1/expenses', [
            'expense_category_id' => $this->rent->id,
            'description' => 'Shop rent',
            'amount' => 45000,
            'expense_date' => now()->toDateString(),
        ])->assertCreated()->json('data.id');
    }

    // ── Income ──────────────────────────────────────────────────────────

    public function test_a_receipt_can_be_attached_to_income(): void
    {
        $id = $this->anIncome();

        $body = $this->login()->post("/api/v1/incomes/{$id}/attachment", [
            'file' => UploadedFile::fake()->image('slip.jpg'),
        ], ['Accept' => 'application/json'])->assertOk()->json('data');

        $path = Income::withoutTenancy()->findOrFail($id)->attachment_path;

        $this->assertNotNull($path, 'the column exists to be written');
        Storage::disk('public')->assertExists($path);
        $this->assertNotNull($body['attachment_url'], 'and to be read back');
    }

    public function test_income_carries_its_receipt_url_in_the_list(): void
    {
        // Written but unreadable is the same bug wearing a different hat.
        $id = $this->anIncome();
        $this->login()->post("/api/v1/incomes/{$id}/attachment", [
            'file' => UploadedFile::fake()->image('slip.jpg'),
        ], ['Accept' => 'application/json'])->assertOk();

        $rows = $this->login()->getJson('/api/v1/incomes')->assertOk()->json('data');

        $this->assertNotNull($rows[0]['attachment_url']);
    }

    public function test_income_with_no_receipt_reports_a_null_url_rather_than_a_broken_link(): void
    {
        $this->anIncome();

        $rows = $this->login()->getJson('/api/v1/incomes')->assertOk()->json('data');

        $this->assertNull($rows[0]['attachment_url']);
    }

    public function test_replacing_an_income_receipt_deletes_the_old_file(): void
    {
        // Otherwise every correction orphans a file on disk forever.
        $id = $this->anIncome();

        $this->login()->post("/api/v1/incomes/{$id}/attachment", [
            'file' => UploadedFile::fake()->image('first.jpg'),
        ], ['Accept' => 'application/json'])->assertOk();
        $first = Income::withoutTenancy()->findOrFail($id)->attachment_path;

        $this->login()->post("/api/v1/incomes/{$id}/attachment", [
            'file' => UploadedFile::fake()->image('second.jpg'),
        ], ['Accept' => 'application/json'])->assertOk();
        $second = Income::withoutTenancy()->findOrFail($id)->attachment_path;

        $this->assertNotSame($first, $second);
        Storage::disk('public')->assertMissing($first);
        Storage::disk('public')->assertExists($second);
    }

    public function test_an_income_receipt_can_be_removed(): void
    {
        $id = $this->anIncome();
        $this->login()->post("/api/v1/incomes/{$id}/attachment", [
            'file' => UploadedFile::fake()->image('slip.jpg'),
        ], ['Accept' => 'application/json'])->assertOk();
        $path = Income::withoutTenancy()->findOrFail($id)->attachment_path;

        $this->login()->deleteJson("/api/v1/incomes/{$id}/attachment")->assertOk();

        $this->assertNull(Income::withoutTenancy()->findOrFail($id)->attachment_path);
        Storage::disk('public')->assertMissing($path);
    }

    public function test_an_executable_masquerading_as_a_receipt_is_refused(): void
    {
        $id = $this->anIncome();

        $this->login()->post("/api/v1/incomes/{$id}/attachment", [
            'file' => UploadedFile::fake()->create('payload.php', 8),
        ], ['Accept' => 'application/json'])->assertStatus(422);

        $this->assertNull(Income::withoutTenancy()->findOrFail($id)->attachment_path);
    }

    // ── Expense (the path that already existed, still untested) ──────────

    public function test_a_receipt_can_be_attached_to_an_expense(): void
    {
        $id = $this->anExpense();

        $this->login()->post("/api/v1/expenses/{$id}/attachment", [
            'file' => UploadedFile::fake()->image('bill.jpg'),
        ], ['Accept' => 'application/json'])->assertOk();

        $path = Expense::withoutTenancy()->findOrFail($id)->attachment_path;

        $this->assertNotNull($path);
        Storage::disk('public')->assertExists($path);
    }

    public function test_an_expense_receipt_can_be_removed(): void
    {
        $id = $this->anExpense();
        $this->login()->post("/api/v1/expenses/{$id}/attachment", [
            'file' => UploadedFile::fake()->image('bill.jpg'),
        ], ['Accept' => 'application/json'])->assertOk();

        $this->login()->deleteJson("/api/v1/expenses/{$id}/attachment")->assertOk();

        $this->assertNull(Expense::withoutTenancy()->findOrFail($id)->attachment_path);
    }
}
