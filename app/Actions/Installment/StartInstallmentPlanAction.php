<?php

namespace App\Actions\Installment;

use App\Actions\Sale\CreateSaleAction;
use App\Enums\PaymentMethod;
use App\Enums\SaleChannel;
use App\Exceptions\DomainException;
use App\Exceptions\SaleQuoted;
use App\Models\Customer;
use App\Models\Income;
use App\Models\InstallmentPlan;
use App\Models\Sale;
use App\Support\BranchContext;
use App\Support\DocumentCounter;
use App\Support\InstallmentSchedule;
use App\Support\ShopDay;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * GOODS GO HOME ON INSTALLMENTS (F1).
 *
 * How a Pakistani shop sells "qiston pe", and what the owner asked for as
 * "market standard" (Q12–Q15):
 *
 *   1. The goods go out today, as one SALE at the cash price — counted in Sales
 *      and Reports today, the stock off the shelf today, the same as any
 *      credit sale. The price is the server's: the sale path is asked first
 *      (`quote_only`, SaleQuoted) and nothing is rung on a figure the screen
 *      worked out.
 *   2. The ADVANCE is that sale's payment; the rest is on the customer's
 *      khata ("credit"), which is why the customer needs a phone. A plan is
 *      approved on its own terms and is not held to the everyday khata limit
 *      (Q14) — `installment_plan` tells the sale so, and no request can.
 *   3. A MARKUP, when the shop charges one (Q13), is not hidden in the item's
 *      price: it is its own "Installment charge" on the same khata, against
 *      the same sale, and the shop's income for the day (`incomes`, so Reports
 *      counts it as Other income — the sale and its tax stay the cash price).
 *   4. The PLAN: months, the monthly amount, the first due date. The schedule
 *      is worked out from these (InstallmentSchedule), never typed in.
 */
class StartInstallmentPlanAction
{
    public function __construct(
        private readonly CreateSaleAction $createSale,
        private readonly TenantContext $context,
        private readonly BranchContext $branch,
    ) {}

    /**
     * @param  array{customer_name?: ?string, customer_phone: string, items: array<int, array<string, mixed>>,
     *   markup_percent?: float|int|string|null, advance?: ?array{amount?: float|int|string, method?: ?string, reference?: ?string},
     *   months: int, first_due_on: string, cash_session_id?: ?string, notes?: ?string, idempotency_key?: ?string}  $data
     */
    public function execute(array $data): InstallmentPlan
    {
        $advance = round((float) ($data['advance']['amount'] ?? 0), 2);
        $method = $data['advance']['method'] ?? 'cash';
        $months = (int) $data['months'];
        $markupPercent = round((float) ($data['markup_percent'] ?? 0), 2);

        $sale = [
            'channel' => SaleChannel::WalkIn->value,
            'items' => array_map(fn (array $i) => array_intersect_key($i, array_flip(['product_id', 'variant_id', 'product_unit_id', 'quantity'])), $data['items']),
            'customer_name' => $data['customer_name'] ?? null,
            'customer_phone' => $data['customer_phone'],
            'cash_session_id' => $data['cash_session_id'] ?? null,
        ];

        return DB::transaction(function () use ($data, $sale, $advance, $method, $months, $markupPercent): InstallmentPlan {
            // ── what the goods cost, asked of the sale path itself ──────
            try {
                $this->createSale->execute($sale + [
                    'quote_only' => true,
                    'payments' => array_values(array_filter([
                        $advance > 0 ? ['method' => $method, 'amount' => $advance] : null,
                        ['method' => PaymentMethod::Credit->value, 'amount' => 0.01],
                    ])),
                ]);
                throw new \LogicException('An installment sale was rung while it was only being priced.');
            } catch (SaleQuoted $asked) {
                $cashPrice = round((float) $asked->figures['amount_due'], 2);
            }

            if ($advance >= $cashPrice) {
                throw DomainException::unprocessable(
                    'The advance covers the whole price — there is nothing left to pay in installments. Ring it as a sale.',
                    'NOTHING_TO_FINANCE',
                );
            }

            $markup = round($cashPrice * $markupPercent / 100, 0);
            $total = round($cashPrice + $markup, 2);
            $financed = round($total - $advance, 2);
            $split = InstallmentSchedule::split($financed, $months);
            $tenantId = (string) $this->context->id();
            $number = DocumentCounter::formatted($tenantId, 'installment_plan', 'INS');

            // ── the sale: the advance now, the rest on the khata ────────
            /** @var Sale $rung */
            $rung = $this->createSale->execute($sale + [
                'payments' => array_values(array_filter([
                    $advance > 0 ? ['method' => $method, 'amount' => $advance, 'reference' => $data['advance']['reference'] ?? null] : null,
                    ['method' => PaymentMethod::Credit->value, 'amount' => round($cashPrice - $advance, 2)],
                ])),
                'notes' => trim("On installments · {$number}. ".($data['notes'] ?? '')),
                'idempotency_key' => $data['idempotency_key'] ?? null,
                'installment_plan' => true,
            ]);

            // The same press again (its key replayed the sale): the plan it made.
            $already = InstallmentPlan::query()->where('sale_id', $rung->id)->first();
            if ($already !== null) {
                return $already;
            }

            /** @var Customer $customer */
            $customer = Customer::query()->whereKey($rung->customer_id)->lockForUpdate()->firstOrFail();

            // ── the markup: its own charge, the shop's income ──────────
            if ($markup > 0) {
                $customer->chargeCredit($markup, $rung->id, "Installment charge · {$number}", heldToLimit: false);
                Income::query()->create([
                    'tenant_id' => $tenantId,
                    'branch_id' => $this->branch->id(),
                    'description' => "Installment charge · {$number}",
                    'payer' => $customer->name,
                    'amount' => $markup,
                    'payment_method' => 'other',
                    'reference' => $number,
                    'income_date' => ShopDay::calendarToday(),
                    'notes' => "{$markupPercent}% on a cash price of ".number_format($cashPrice, 2).' — charged on the customer\'s khata and collected with the installments.',
                ]);
            }

            $plan = InstallmentPlan::query()->create([
                'tenant_id' => $tenantId,
                'branch_id' => $this->branch->id(),
                'number' => $number,
                'customer_id' => $customer->id,
                'sale_id' => $rung->id,
                'customer_name' => $customer->name,
                'customer_phone' => $customer->phone,
                'cash_price' => $cashPrice,
                'markup_percent' => $markupPercent,
                'markup' => $markup,
                'total' => $total,
                'advance' => $advance,
                'financed' => $financed,
                'months' => $months,
                'monthly' => $split['monthly'],
                'last_month' => $split['last'],
                'first_due_on' => $data['first_due_on'],
                'status' => InstallmentPlan::STATUS_RUNNING,
                'notes' => $data['notes'] ?? null,
            ]);
            $plan->refreshStanding();

            return $plan;
        });
    }
}
