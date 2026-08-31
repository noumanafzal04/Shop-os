<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\City;
use App\Models\Customer;
use App\Models\Product;
use App\Models\Register;
use App\Models\Tenant;
use App\Models\User;
use App\Support\BusinessTypes;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * EVERY PATH THAT MOVES MONEY, AND THE BALANCE IT CLAIMS TO MOVE.
 *
 * Written after the Suppliers Pay button, which filed a payment, took the cash
 * out of the drawer, and applied it to no order at all. The balance did not
 * move; the shopkeeper paid again.
 *
 * ── WHY THE OBVIOUS DIAGNOSIS WAS WRONG ──────────────────────────────
 *
 * The first reading was "an untested branch": every payment test sent
 * `purchase_order_id`, so the door the screen uses — amount and method alone —
 * was never opened. A scanner was written to find optional fields that every
 * test supplies (`scripts/untested-absence.py`, which found twenty-one others
 * and is worth keeping).
 *
 * It would NOT have found this one. `CashMovementTest` had been posting a
 * payment with no order named since August. The branch was covered. What that
 * test asserted was the DRAWER — it checked the cash out and never once looked
 * at what the supplier was owed.
 *
 * So the real shape of the fault is not an unwalked path. It is:
 *
 *     a path somebody walked, looking at the wrong thing on the other side.
 *
 * Coverage cannot see that. Only an OUTCOME can:
 *
 *     if a money path succeeds, the balance it names moves by exactly the
 *     amount — and if it is refused, nothing moves at all.
 *
 * That is what this file asserts, for every account and every direction. It
 * fails the moment a payment stops landing anywhere, whatever door it came in
 * through and whatever else the test suite happens to be looking at.
 */
class MoneyMatrixTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $shop;

    private User $owner;

    private Product $product;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware(ThrottleRequests::class);

        City::query()->create(['name' => 'Karachi', 'is_active' => true]);
        $this->shop = Tenant::factory()->provisioned()->create([
            'setup_completed' => true,
            'business_type' => 'mart',
            'features' => BusinessTypes::defaultFeatures('mart'),
        ]);
        $this->owner = User::factory()->shopOwner($this->shop)->create();
        $this->product = Product::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'type' => 'product', 'item_type' => 'physical_product',
            'name' => 'Rice 5kg', 'price' => 1000, 'cost' => 800,
            'stock_quantity' => 500, 'track_inventory' => true,
        ]);
    }

    private function as(): static
    {
        $token = $this->owner->createToken('t', ['access'])->plainTextToken;
        $this->app['auth']->forgetGuards();

        return $this->withToken($token);
    }

    // ── The two ledgers ─────────────────────────────────────────────

    private function supplier(): string
    {
        return $this->as()->postJson('/api/v1/suppliers', ['name' => 'Money Traders'])
            ->assertCreated()->json('data.id');
    }

    private function owedToSupplier(string $id): float
    {
        return (float) $this->as()->getJson("/api/v1/suppliers/{$id}")->assertOk()->json('data.outstanding');
    }

    private int $customerSeq = 0;

    private function customer(): Customer
    {
        // A phone is unique per shop, and the matrix builds one customer per
        // case: a fixed number makes the SECOND case die on a constraint and
        // read as a product fault.
        $this->customerSeq++;

        /** @var Customer $c */
        $c = Customer::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'name' => "Khata Customer {$this->customerSeq}",
            'phone' => '0300123456'.$this->customerSeq,
            'credit_limit' => 100000, 'credit_balance' => 0,
        ]);

        return $c;
    }

    private function owedByCustomer(Customer $c): float
    {
        return (float) $c->fresh()->credit_balance;
    }

    private function placedOrder(string $supplierId, float $total): array
    {
        return $this->as()->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $supplierId, 'order_date' => now()->toDateString(), 'status' => 'ordered',
            'items' => [['product_id' => $this->product->id, 'quantity' => 1, 'unit_cost' => $total]],
        ])->assertCreated()->json('data');
    }

    private bool $tillOpen = false;

    private function openTill(): void
    {
        if ($this->tillOpen) {
            return;
        }
        $this->tillOpen = true;

        $main = Branch::withoutTenancy()
            ->where('tenant_id', $this->shop->id)->where('is_default', true)->firstOrFail();
        $lane = Register::withoutTenancy()->create([
            'tenant_id' => $this->shop->id, 'branch_id' => $main->id, 'name' => 'Lane 1', 'is_active' => true,
        ]);
        $this->as()->postJson('/api/v1/pos/session/open', [
            'opening_float' => 50000, 'register_id' => $lane->id,
        ])->assertCreated();
    }

    // ── THE MATRIX ──────────────────────────────────────────────────
    //
    // Each case: set the account up, read the balance, run the path, read it
    // again. The path says what it should have moved. Nothing here inspects
    // HOW the money was applied — only that the account a shopkeeper reads
    // agrees with what they were told just happened.

    /** @return array<string, array{setup: callable, run: callable, read: callable, delta: float}> */
    private function cases(): array
    {
        return [
            // The bug, in the exact shape the screen produces it: an amount and
            // a method, no order named.
            'supplier · paid on account' => function (): array {
                $s = $this->supplier();
                $this->placedOrder($s, 20000);

                return [
                    'before' => $this->owedToSupplier($s),
                    'run' => fn (): TestResponse => $this->as()->postJson("/api/v1/suppliers/{$s}/payments", [
                        'amount' => 5000, 'method' => 'cash',
                    ]),
                    'after' => fn (): float => $this->owedToSupplier($s),
                    'delta' => -5000.0,
                ];
            },

            'supplier · paid against one order' => function (): array {
                $s = $this->supplier();
                $po = $this->placedOrder($s, 20000);

                return [
                    'before' => $this->owedToSupplier($s),
                    'run' => fn (): TestResponse => $this->as()->postJson("/api/v1/suppliers/{$s}/payments", [
                        'amount' => 5000, 'method' => 'cash', 'purchase_order_id' => $po['id'],
                    ]),
                    'after' => fn (): float => $this->owedToSupplier($s),
                    'delta' => -5000.0,
                ];
            },

            'supplier · a new order is owed' => function (): array {
                $s = $this->supplier();

                return [
                    'before' => $this->owedToSupplier($s),
                    'run' => fn (): TestResponse => $this->as()->postJson('/api/v1/purchase-orders', [
                        'supplier_id' => $s, 'order_date' => now()->toDateString(), 'status' => 'ordered',
                        'items' => [['product_id' => $this->product->id, 'quantity' => 1, 'unit_cost' => 7500]],
                    ]),
                    'after' => fn (): float => $this->owedToSupplier($s),
                    'delta' => 7500.0,
                ];
            },

            'customer · sold on credit' => function (): array {
                $c = $this->customer();
                $this->openTill();

                return [
                    'before' => $this->owedByCustomer($c),
                    'run' => fn (): TestResponse => $this->as()->postJson('/api/v1/sales', [
                        'channel' => 'walk_in', 'customer_phone' => $c->phone,
                        'payment_method' => 'credit', 'amount_paid' => 3000,
                        'items' => [['product_id' => $this->product->id, 'quantity' => 3]],
                    ]),
                    'after' => fn (): float => $this->owedByCustomer($c),
                    'delta' => 3000.0,
                ];
            },

            'customer · repaid the khata' => function (): array {
                $c = $this->customer();
                $this->openTill();
                $this->as()->postJson('/api/v1/sales', [
                    'channel' => 'walk_in', 'customer_phone' => $c->phone,
                    'payment_method' => 'credit', 'amount_paid' => 3000,
                    'items' => [['product_id' => $this->product->id, 'quantity' => 3]],
                ])->assertCreated();

                return [
                    'before' => $this->owedByCustomer($c),
                    'run' => fn (): TestResponse => $this->as()->postJson("/api/v1/customers/{$c->id}/payments", [
                        'amount' => 1200, 'method' => 'cash',
                    ]),
                    'after' => fn (): float => $this->owedByCustomer($c),
                    'delta' => -1200.0,
                ];
            },
        ];
    }

    public function test_a_money_path_that_succeeds_moves_the_balance_it_names(): void
    {
        $wrong = [];
        $ran = 0;

        foreach ($this->cases() as $name => $build) {
            $case = $build();
            $before = $case['before'];
            $res = ($case['run'])();
            $after = ($case['after'])();
            $moved = round($after - $before, 2);
            $ran++;

            if ($res->status() >= 400) {
                // A refusal is allowed — but it must not have moved anything,
                // and it must say why.
                if ($moved != 0.0) {
                    $wrong[] = "{$name}: refused ({$res->status()}) but the balance moved by {$moved}";
                }
                $wrong[] = "{$name}: refused ({$res->status()}) — ".json_encode($res->json('message'));

                continue;
            }

            if ($moved != $case['delta']) {
                $wrong[] = "{$name}: answered {$res->status()}, balance moved {$moved}, expected {$case['delta']}";
            }
        }

        // The denominator. Cases that silently stopped being built would make
        // every assertion above pass against nothing.
        $this->assertGreaterThanOrEqual(5, $ran, 'the money matrix shrank');
        $this->assertSame([], $wrong, "\n".implode("\n", $wrong)."\n");
    }
}
