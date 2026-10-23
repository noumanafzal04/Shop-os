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
            $cashPrice = $this->cashPrice($sale, $advance, $method, onKhata: true);
            ['markup' => $markup, 'total' => $total, 'financed' => $financed, 'split' => $split]
                = $this->terms($cashPrice, $markupPercent, $advance, $months);

            // The figure read out to the customer is the figure written. The
            // sheet shows the server's plan (worth()) and sends its bill; a
            // price that moved in between is refused in words, not written
            // at a figure nobody was told (money pass 2026-10-16, $8).
            if (isset($data['expected_total']) && abs((float) $data['expected_total'] - $total) > 0.004) {
                throw DomainException::conflict(
                    'The price has changed — on installments this now comes to '
                        .number_format($total, 2).', not '.number_format((float) $data['expected_total'], 2)
                        .'. Check the figures with the customer and start again.',
                    'PLAN_PRICE_CHANGED',
                );
            }

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
                    // The business day the sale is on — not the wall date. At
                    // 1 am the fridge was sold on yesterday's books and its
                    // markup filed under today's, so neither day added up.
                    'income_date' => ShopDay::today(),
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

    /**
     * WHAT THE PLAN WILL BE — asked before it is started.
     *
     * The sheet worked the plan out itself, from shelf prices before tax: it
     * read out "Rs 500 now + 2 × 1,190 + 1,188.50 = 4,068.50" and the plan
     * was written at 4,760.25 and 1,421 a month (money pass 2026-10-16, $8).
     * Now it asks here — the same cash price, the same charge, the same
     * schedule as execute() — and nothing is written: the sale path stops
     * before it writes when it is only asked (quote_only), and the test holds
     * it to that — no sale, no plan, no customer.
     *
     * @param  array{customer_phone?: ?string, items: array<int, array<string, mixed>>, markup_percent?: float|int|string|null,
     *   advance?: ?array{amount?: float|int|string, method?: ?string}, months: int}  $data
     * @return array{cash_price: float, markup_percent: float, markup: float, total: float, advance: float, financed: float, months: int, monthly: float, last_month: float}
     */
    public function worth(array $data): array
    {
        $advance = round((float) ($data['advance']['amount'] ?? 0), 2);
        $months = (int) $data['months'];
        $markupPercent = round((float) ($data['markup_percent'] ?? 0), 2);
        $sale = [
            'channel' => SaleChannel::WalkIn->value,
            'items' => array_map(fn (array $i) => array_intersect_key($i, array_flip(['product_id', 'variant_id', 'product_unit_id', 'quantity'])), $data['items']),
            'customer_phone' => $data['customer_phone'] ?? null,
        ];

        $onKhata = filled($data['customer_phone'] ?? null);
        $cashPrice = $this->cashPrice($sale, $advance, $data['advance']['method'] ?? 'cash', $onKhata);

        ['markup' => $markup, 'total' => $total, 'financed' => $financed, 'split' => $split]
            = $this->terms($cashPrice, $markupPercent, $advance, $months);

        return [
            'cash_price' => $cashPrice,
            'markup_percent' => $markupPercent,
            'markup' => $markup,
            'total' => $total,
            'advance' => $advance,
            'financed' => $financed,
            'months' => $months,
            'monthly' => (float) $split['monthly'],
            'last_month' => (float) $split['last'],
        ];
    }

    /**
     * The goods at their cash price, asked of the sale path itself. The rest
     * goes on the khata; before a phone is typed there is no khata to put it
     * on, so the question is asked with a card — no rounding either way.
     *
     * @param  array<string, mixed>  $sale
     */
    private function cashPrice(array $sale, float $advance, string $method, bool $onKhata): float
    {
        try {
            $this->createSale->execute($sale + [
                'quote_only' => true,
                'payments' => array_values(array_filter([
                    $advance > 0 ? ['method' => $method, 'amount' => $advance] : null,
                    ['method' => $onKhata ? PaymentMethod::Credit->value : PaymentMethod::Card->value, 'amount' => 0.01],
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

        return $cashPrice;
    }

    /**
     * The charge, the bill, what is financed and the schedule — one rule for
     * starting a plan and for saying what it will be.
     *
     * @return array{markup: float, total: float, financed: float, split: array{monthly: float|int, last: float|int}}
     */
    private function terms(float $cashPrice, float $markupPercent, float $advance, int $months): array
    {
        $markup = round($cashPrice * $markupPercent / 100, 0);
        $total = round($cashPrice + $markup, 2);
        $financed = round($total - $advance, 2);

        return [
            'markup' => $markup,
            'total' => $total,
            'financed' => $financed,
            'split' => InstallmentSchedule::split($financed, $months),
        ];
    }
}
