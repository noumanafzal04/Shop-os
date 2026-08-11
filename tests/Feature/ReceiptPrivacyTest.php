<?php

namespace Tests\Feature;

use App\Models\Expense;
use App\Models\ExpenseCategory;
use App\Models\Income;
use App\Models\IncomeCategory;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use App\Support\ReceiptFiles;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * A photo of a bill is not a product photo.
 *
 * Receipts went to the `public` disk, next to shop logos and product images.
 * Those belong there. A receipt is a supplier's name, an amount, an account
 * number and a letterhead, and `public` means the web server hands it to
 * anyone who asks — no token, no tenant check, nothing in the application even
 * seeing the request. The random filename was the entire access control.
 *
 * These tests are the ones that would have caught it: they ask whether a
 * stranger, and a rival shop, can read a business's bills.
 */
class ReceiptPrivacyTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private User $owner;

    private Expense $expense;

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware(ThrottleRequests::class);
        Storage::fake('local');
        Storage::fake('public');

        $this->tenant = Tenant::factory()->create([
            'features' => array_fill_keys(BusinessTypes::FEATURES, true),
            'setup_completed' => true,
        ]);
        $this->owner = User::factory()->shopOwner($this->tenant)->create();

        $category = ExpenseCategory::query()->create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Rent',
        ]);

        $this->expense = Expense::query()->create([
            'tenant_id' => $this->tenant->id,
            'expense_category_id' => $category->id,
            'description' => 'Shop rent',
            'amount' => 45000,
            'expense_date' => now()->toDateString(),
            'payment_method' => 'bank_transfer',
        ]);
    }

    private function asUser(User $user): static
    {
        $token = $user->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    private function attachReceipt(): string
    {
        $this->asUser($this->owner)
            ->post("/api/v1/expenses/{$this->expense->id}/attachment", [
                'file' => UploadedFile::fake()->image('bill.jpg'),
            ])
            ->assertOk();

        return $this->expense->fresh()->attachment_path;
    }

    // ── Where the bytes land ────────────────────────────────────────

    public function test_a_receipt_is_written_to_the_private_disk(): void
    {
        $path = $this->attachReceipt();

        Storage::disk('local')->assertExists($path);
        // The whole finding: not on the disk the web server serves.
        Storage::disk('public')->assertMissing($path);
    }

    public function test_the_api_never_hands_out_a_public_storage_url(): void
    {
        $this->attachReceipt();

        $response = $this->asUser($this->owner)
            ->getJson('/api/v1/expenses')
            ->assertOk();

        $url = $response->json('data.0.attachment_url');

        $this->assertSame("/expenses/{$this->expense->id}/attachment", $url);
        // `/storage/...` is the public path. If it ever reappears here, the
        // link is followable by anyone it is forwarded to.
        $this->assertStringNotContainsString('/storage/', (string) $url);
    }

    // ── Who may read it ─────────────────────────────────────────────

    public function test_a_stranger_cannot_read_a_shops_bills(): void
    {
        $this->attachReceipt();
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();

        $this->getJson("/api/v1/expenses/{$this->expense->id}/attachment")
            ->assertUnauthorized();
    }

    public function test_another_shop_cannot_read_this_shops_bills(): void
    {
        $this->attachReceipt();

        $rivalTenant = Tenant::factory()->create([
            'features' => array_fill_keys(BusinessTypes::FEATURES, true),
            'setup_completed' => true,
        ]);
        $rival = User::factory()->shopOwner($rivalTenant)->create();

        // 404, not 403: the row is invisible to them, which is also the right
        // answer to "does that expense id exist?"
        $this->asUser($rival)
            ->getJson("/api/v1/expenses/{$this->expense->id}/attachment")
            ->assertNotFound();
    }

    public function test_a_cashier_without_the_books_permission_cannot_read_it(): void
    {
        $this->attachReceipt();

        $cashier = User::factory()->tenantStaff($this->tenant, ['sales.manage'])->create();

        $this->asUser($cashier)
            ->getJson("/api/v1/expenses/{$this->expense->id}/attachment")
            ->assertForbidden();
    }

    public function test_the_owner_gets_the_file(): void
    {
        $this->attachReceipt();

        $this->asUser($this->owner)
            ->get("/api/v1/expenses/{$this->expense->id}/attachment")
            ->assertOk()
            ->assertHeader('content-disposition', 'inline; filename="'.basename($this->expense->fresh()->attachment_path).'"');
    }

    // ── Housekeeping ────────────────────────────────────────────────

    public function test_an_expense_with_no_receipt_says_so(): void
    {
        $this->asUser($this->owner)
            ->getJson("/api/v1/expenses/{$this->expense->id}/attachment")
            ->assertNotFound();
    }

    public function test_replacing_a_receipt_removes_the_old_file(): void
    {
        $first = $this->attachReceipt();

        $this->asUser($this->owner)
            ->post("/api/v1/expenses/{$this->expense->id}/attachment", [
                'file' => UploadedFile::fake()->image('corrected.jpg'),
            ])
            ->assertOk();

        Storage::disk('local')->assertMissing($first);
        Storage::disk('local')->assertExists($this->expense->fresh()->attachment_path);
    }

    public function test_detaching_removes_the_file_too(): void
    {
        $path = $this->attachReceipt();

        $this->asUser($this->owner)
            ->deleteJson("/api/v1/expenses/{$this->expense->id}/attachment")
            ->assertOk();

        Storage::disk('local')->assertMissing($path);
        $this->assertNull($this->expense->fresh()->attachment_path);
    }

    public function test_a_receipt_uploaded_before_this_change_is_still_readable(): void
    {
        // Rows written against the old code physically point at `public`.
        // Serving them keeps working; only new writes move.
        $legacy = "receipts/{$this->tenant->id}/old-bill.jpg";
        Storage::disk('public')->put($legacy, 'legacy bytes');
        $this->expense->forceFill(['attachment_path' => $legacy])->save();

        $this->assertSame('public', ReceiptFiles::diskFor($legacy));

        $this->asUser($this->owner)
            ->get("/api/v1/expenses/{$this->expense->id}/attachment")
            ->assertOk();
    }

    // ── The other side of the book ──────────────────────────────────

    public function test_income_receipts_follow_the_same_rule(): void
    {
        $category = IncomeCategory::query()->create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Owner investment',
        ]);

        $income = Income::query()->create([
            'tenant_id' => $this->tenant->id,
            'income_category_id' => $category->id,
            'description' => 'Capital injection',
            'amount' => 80000,
            'income_date' => now()->toDateString(),
            'payment_method' => 'bank_transfer',
        ]);

        $this->asUser($this->owner)
            ->post("/api/v1/incomes/{$income->id}/attachment", [
                'file' => UploadedFile::fake()->image('deposit.jpg'),
            ])
            ->assertOk();

        $path = $income->fresh()->attachment_path;
        Storage::disk('local')->assertExists($path);
        Storage::disk('public')->assertMissing($path);

        $this->app['auth']->forgetGuards();
        $this->flushHeaders();
        $this->getJson("/api/v1/incomes/{$income->id}/attachment")->assertUnauthorized();
    }
}
