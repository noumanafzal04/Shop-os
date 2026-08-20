<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Coupon;
use App\Models\Customer;
use App\Models\CustomerGroup;
use App\Models\TaxGroup;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/**
 * Who changed what, and whether the shop can find out.
 *
 * ── The shape of the hole ───────────────────────────────────────────────
 *
 * The trail recorded who may DO things — a permission granted, a person
 * suspended, the shop's own settings — and said nothing about what those
 * things are WORTH. Eight sensitive actions driven through the API left three
 * records between them:
 *
 *   the discount ceiling on a cashier's discretion    recorded
 *   a staff permission                                 recorded
 *   a customer's credit limit, 5,000 → 90,000          NOTHING
 *   a tax rate, which re-rates every product on it     NOTHING
 *   a customer group's discount, every member at once  NOTHING
 *   a coupon, which is money off every bill quoting it NOTHING
 *
 * Every line in the second half is a money authority, and the first half is
 * proof the shop already believed those were worth recording.
 *
 * ── And nobody in the shop could read it ────────────────────────────────
 *
 * The only way into the trail was `/admin/audit-logs`, behind super_admin. An
 * owner saw eight rows on their dashboard and could ask nothing of them.
 */
class AuditTrailTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        $this->shop = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
    }

    // ── what is worth recording ──────────────────────────────────────

    public function test_raising_a_credit_limit_is_recorded(): void
    {
        // The same class of act as granting a permission: it decides how much
        // this person may walk out with unpaid.
        $customer = $this->customer(['credit_limit' => 5000]);

        $this->login()->patchJson("/api/v1/customers/{$customer->id}", [
            'credit_limit' => 90000,
        ])->assertOk();

        $row = $this->lastFor(Customer::class);

        $this->assertNotNull($row, 'raising a credit limit left no record');
        $this->assertSame('updated', $row->event);
        $this->assertSame($this->owner->id, $row->user_id);
        $this->assertSame('5000.00', (string) $row->old_values['credit_limit']);
        $this->assertSame(90000, $row->new_values['credit_limit']);
    }

    public function test_a_customer_given_credit_on_the_first_day_is_recorded_too(): void
    {
        // Otherwise the limit is set at creation and the log has nothing —
        // which is the same authority granted by a different door.
        $this->login()->postJson('/api/v1/customers', [
            'name' => 'Big Account', 'phone' => '03001234567', 'credit_limit' => 250000,
        ])->assertCreated();

        $row = $this->lastFor(Customer::class);

        $this->assertNotNull($row, 'a credit limit given at creation left no record');
        $this->assertSame('created', $row->event);
        $this->assertSame(250000, $row->new_values['credit_limit']);
    }

    public function test_a_walk_in_customer_is_not_an_event(): void
    {
        // A shop keys hundreds of these. A trail that records every one of them
        // is a trail nobody reads to the bottom of, and the credit-limit line
        // is what this model is audited FOR.
        $this->login()->postJson('/api/v1/customers', [
            'name' => 'Passing Trade', 'phone' => '03007654321',
        ])->assertCreated();

        $this->assertNull($this->lastFor(Customer::class));
    }

    public function test_correcting_a_phone_number_is_not_an_event(): void
    {
        $customer = $this->customer(['credit_limit' => 5000]);
        AuditLog::query()->delete();

        $this->login()->patchJson("/api/v1/customers/{$customer->id}", [
            'phone' => '03009999999',
        ])->assertOk();

        $this->assertNull($this->lastFor(Customer::class),
            'an update touching none of the watched fields should write nothing');
    }

    public function test_changing_a_tax_rate_is_recorded(): void
    {
        // The model's own docblock: "edit the rate once and every product on it
        // re-rates". The difference is money owed to FBR.
        $group = TaxGroup::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Standard', 'rate' => 17, 'is_active' => true,
        ]);
        AuditLog::query()->delete();

        $this->login()->putJson("/api/v1/tax-groups/{$group->id}", [
            'name' => 'Standard', 'rate' => 5,
        ])->assertOk();

        $row = $this->lastFor(TaxGroup::class);

        $this->assertNotNull($row, 'a tax rate changed with nobody named');
        $this->assertSame('17.00', (string) $row->old_values['rate']);
    }

    public function test_changing_a_group_discount_is_recorded(): void
    {
        // One edit, every member's price.
        $group = CustomerGroup::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Wholesale',
            'discount_percent' => 5, 'is_active' => true,
        ]);
        AuditLog::query()->delete();

        $this->login()->putJson("/api/v1/customer-groups/{$group->id}", [
            'name' => 'Wholesale', 'discount_percent' => 40,
        ])->assertOk();

        $row = $this->lastFor(CustomerGroup::class);

        $this->assertNotNull($row, 'every member repriced with nobody named');
        $this->assertSame('5.00', (string) $row->old_values['discount_percent']);
    }

    public function test_making_a_coupon_is_recorded(): void
    {
        // A coupon sits deliberately OUTSIDE the discount ceiling — the ceiling
        // caps what a cashier decides on the spot — so the ceiling's own trail
        // says nothing about it.
        $this->login()->postJson('/api/v1/coupons', [
            'code' => 'HALFOFF', 'type' => 'percent', 'value' => 50,
        ])->assertCreated();

        $row = $this->lastFor(Coupon::class);

        $this->assertNotNull($row, 'a 50% coupon made with nobody named');
        $this->assertSame('created', $row->event);
        $this->assertSame($this->owner->id, $row->user_id);
    }

    public function test_a_password_change_still_says_that_it_happened(): void
    {
        // With no values beside it — `password` is never written to the log —
        // but the ROW is the signal, and the allowlist must not swallow it.
        // Every audited model without an allowlist keeps this behaviour.
        $this->owner->forceFill(['password' => bcrypt('a-new-one')])->save();

        $row = AuditLog::query()->where('auditable_type', User::class)
            ->orderByDesc('created_at')->orderByDesc('id')->first();

        $this->assertNotNull($row, 'a password change left no trace at all');
        $this->assertSame('updated', $row->event);
        $this->assertSame([], $row->new_values);
    }

    // ── who may read it ──────────────────────────────────────────────

    public function test_the_shop_can_read_its_own_trail(): void
    {
        // Driven through the API, because the actor is the point: a row with
        // nobody's name on it answers nothing, and a model created in a test
        // with no signed-in user writes exactly that.
        $this->login()->postJson('/api/v1/customers', [
            'name' => 'Big Account', 'phone' => '03001234567', 'credit_limit' => 250000,
        ])->assertCreated();

        $rows = $this->login()->getJson('/api/v1/audit-logs?type=Customer')->assertOk()->json('data');

        $this->assertNotEmpty($rows);
        $this->assertSame('Customer', $rows[0]['entity']);
        $this->assertSame($this->owner->name, $rows[0]['actor']['name']);
    }

    public function test_one_shop_never_sees_another_shop_trail(): void
    {
        // The worst possible bug in this particular table: AuditLog carries a
        // tenant_id but is NOT tenant-scoped as a model, because the platform
        // reads across every shop.
        $other = Tenant::factory()->provisioned()->create(['setup_completed' => true]);
        $this->creditedCustomer($other, 77777);
        $this->creditedCustomer($this->shop, 1000);

        // The other shop's rows must EXIST, or this proves nothing: an empty
        // table is excluded from every query ever written.
        $theirs = AuditLog::query()->where('tenant_id', $other->id)->pluck('id');
        $this->assertNotEmpty($theirs, 'the other shop left no trail to be leaked');

        $rows = $this->login()->getJson('/api/v1/audit-logs?per_page=100')->assertOk()->json('data');

        $this->assertNotEmpty($rows);
        foreach ($rows as $row) {
            $this->assertNotContains($row['id'], $theirs,
                'a shop was shown another shop\'s audit row');
        }
    }

    public function test_a_cashier_cannot_read_the_trail(): void
    {
        $cashier = User::factory()->tenantStaff($this->shop, ['sales.manage', 'customers.manage'])->create();

        $this->login($cashier)->getJson('/api/v1/audit-logs')->assertForbidden();
    }

    public function test_whoever_looks_at_how_the_shop_performed_may_look_at_this(): void
    {
        // Same marker as SUPERVISES_TILLS and READS_COST. A read must not be
        // gated on a single manage permission — see the `*.manage` bug class.
        $accountant = User::factory()->tenantStaff($this->shop, ['reports.view'])->create();

        $this->login($accountant)->getJson('/api/v1/audit-logs')->assertOk();
    }

    public function test_the_trail_can_be_asked_a_question(): void
    {
        $this->creditedCustomer($this->shop, 1000);
        $this->login()->postJson('/api/v1/coupons', [
            'code' => 'ASKME', 'type' => 'percent', 'value' => 10,
        ])->assertCreated();

        $rows = $this->login()->getJson('/api/v1/audit-logs?type=Coupon')->assertOk()->json('data');

        $this->assertCount(1, $rows);
        $this->assertSame('Coupon', $rows[0]['entity']);
    }

    // ── helpers ──────────────────────────────────────────────────────

    /** A customer given credit — which IS an audit event, and stays in the trail. */
    private function creditedCustomer(Tenant $shop, float $limit): Customer
    {
        return Customer::withoutTenancy()->create([
            'tenant_id' => $shop->id, 'name' => 'Regular', 'phone' => '0300'.random_int(1000000, 9999999),
            'credit_limit' => $limit,
        ]);
    }

    /** The same, with the trail wiped after — so the NEXT action is the only row. */
    private function customer(array $attrs): Customer
    {
        $customer = Customer::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => 'Regular', 'phone' => '03001112222',
        ] + $attrs);
        AuditLog::query()->delete();

        return $customer;
    }

    private function lastFor(string $type): ?AuditLog
    {
        return AuditLog::query()->where('auditable_type', $type)
            ->orderByDesc('created_at')->orderByDesc('id')->first();
    }

    private function login(?User $user = null): static
    {
        $token = ($user ?? $this->owner)->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }
}
