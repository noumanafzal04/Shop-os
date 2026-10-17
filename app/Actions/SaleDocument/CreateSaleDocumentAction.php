<?php

namespace App\Actions\SaleDocument;

use App\Enums\ItemType;
use App\Exceptions\DomainException;
use App\Models\Customer;
use App\Models\CustomerVehicle;
use App\Models\Product;
use App\Models\SaleDocument;
use App\Services\InventoryService;
use App\Support\BranchContext;
use App\Support\Currencies;
use App\Support\DocumentCounter;
use App\Support\Permissions;
use App\Support\RegisterContext;
use App\Support\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * Writes a quotation or a layaway in one transaction: price the lines → number
 * the document → (layaway) pull the stock and take the advance.
 *
 * ── What this deliberately does NOT do ──────────────────────────────────
 *
 * No promotions, no coupons, no loyalty. Those are all time-boxed — "this
 * weekend only", "first 100 customers", "points expire in 90 days" — and a
 * quotation is a price held for thirty days. Baking a weekend promo into a
 * month-long hold would either cost the shop money it never agreed to give, or
 * force the customer to argue about a price that is printed on paper in their
 * hand. Neither is acceptable, so the answer is simpler: a document is priced
 * off the shop's own price list, and if a better promotion is running when the
 * customer comes back, the cashier can always ring a fresh sale instead.
 *
 * What DOES carry across from the sale path, because these aren't promotions
 * but the shop's standing prices: the price level (retail/wholesale), the
 * customer group's level, per-branch price overrides, pack units, and the
 * discount ceiling — a quote is exactly where a cashier would hand out an
 * over-generous discount, since nobody is watching a piece of paper.
 */
class CreateSaleDocumentAction
{
    public function __construct(
        private readonly InventoryService $inventory,
        private readonly TenantContext $context,
        private readonly BranchContext $branchContext,
        private readonly RegisterContext $registerContext,
    ) {}

    public function execute(array $data): SaleDocument
    {
        // Replay path — the retry gets the ORIGINAL document back, so a
        // double-tapped advance never takes the money or the goods twice.
        if (! empty($data['idempotency_key'])) {
            $existing = SaleDocument::query()
                ->where('idempotency_key', $data['idempotency_key'])
                ->first();

            if ($existing !== null) {
                return $existing->load(['items', 'payments']);
            }
        }

        try {
            return DB::transaction(fn () => $this->build($data));
        } catch (QueryException $e) {
            // Lost the race on the unique idempotency key — the winner's
            // document is the answer.
            if ($e->getCode() === '23000' && ! empty($data['idempotency_key'])) {
                $existing = SaleDocument::query()
                    ->where('idempotency_key', $data['idempotency_key'])
                    ->first();

                if ($existing !== null) {
                    return $existing->load(['items', 'payments']);
                }
            }

            throw $e;
        }
    }

    private function build(array $data): SaleDocument
    {
        $tenant = $this->context->get();
        $tenantId = $this->context->id();
        $branchId = $this->branchContext->id();
        $kind = $data['kind'];
        $isJobCard = $kind === SaleDocument::KIND_JOB_CARD;
        $isLayaway = $kind === SaleDocument::KIND_LAYAWAY;

        // ── The customer ────────────────────────────────────────────
        // A quotation may be anonymous — someone asking a price owes the shop
        // no phone number. A layaway may not: goods held for nobody can never
        // be collected, chased, or handed back if the deal falls through.
        $customer = null;
        if (! empty($data['customer_phone'])) {
            $customer = Customer::capture($tenantId, $data['customer_phone'], $data['customer_name'] ?? null);
        } elseif (! empty($data['customer_id'])) {
            $customer = Customer::query()->whereKey($data['customer_id'])->first();
        }

        if ($isLayaway && $customer === null) {
            throw DomainException::unprocessable(
                "Goods held on advance need a customer — add the buyer's phone number.",
                'LAYAWAY_REQUIRES_CUSTOMER',
            );
        }

        [
            'lines' => $lines, 'subtotal' => $subtotal, 'discount' => $discount,
            'tax' => $tax, 'tax_inclusive' => $taxInclusive, 'total' => $total,
        ] = $this->priced($data, $customer);

        // ── The deposit rules ───────────────────────────────────────
        // A token advance isn't a commitment: the shop takes Rs 100, pulls a
        // Rs 90,000 fridge off the floor for six weeks, and the customer walks
        // away. The minimum is the shop's own number and it is enforced HERE,
        // where the stock is about to move, not in a form the client controls.
        $deposit = 0.0;
        if ($isLayaway) {
            $deposit = round((float) ($data['deposit']['amount'] ?? 0), 2);
            [$minPct, $minimum] = $this->depositFloor($total);

            if ($minPct > 0 && $deposit + 0.001 < $minimum) {
                throw DomainException::unprocessable(
                    "This shop asks for at least {$minPct}% down — ".Currencies::format($minimum, $tenant?->currency(), 2).'.',
                    'DEPOSIT_BELOW_MINIMUM',
                );
            }

            if ($deposit > $total + 0.001) {
                throw DomainException::unprocessable(
                    'The advance is more than the goods are worth.',
                    'DEPOSIT_EXCEEDS_TOTAL',
                );
            }
        }

        // ── The document ────────────────────────────────────────────
        $number = DocumentCounter::formatted(
            $tenantId,
            "sale_document_{$kind}",
            SaleDocument::PREFIXES[$kind],
        );

        /**
         * Three kinds, and this was a two-way ternary.
         *
         * `$isLayaway ? layaway_days : quotation_valid_days` reads as if there
         * were only two sorts of document, so a JOB CARD fell into the else and
         * took the QUOTATION's window — 15 days by default, from a setting
         * described to the shop as "how long a quoted price is honoured".
         *
         * What that did to a workshop: a car booked into the bay was stamped
         * with an expiry it was never given, and on day 16 it started printing
         * "Expired on", appearing in the shop's lapsed-document chase list, and
         * counting towards the `overdue` figure on the counter's own summary. A
         * car in for a gearbox rebuild is not a stale price.
         *
         * A job card has no clock of its own, so it gets none. Deliberately not
         * a new `job_card_days` setting: nobody asked for a job to expire, and
         * the honest default for a window nobody defined is no window. A shop
         * that wants a date can still pass `expires_at` explicitly — an answer
         * somebody gave beats one this code invented.
         *
         * The one thing this does NOT change is whether the job can be billed.
         * That guard was already right: ConvertSaleDocumentAction only refuses a
         * lapsed QUOTATION, so an "expired" job card always converted. The
         * damage was to what the shop was told, not to what it could do.
         */
        $defaultDays = match ($kind) {
            SaleDocument::KIND_LAYAWAY => (int) ($tenant?->setting('layaway_days', 30) ?? 30),
            SaleDocument::KIND_QUOTATION => (int) ($tenant?->setting('quotation_valid_days', 15) ?? 15),
            default => 0,
        };

        $expiresAt = array_key_exists('expires_at', $data) && $data['expires_at'] !== null
            ? $data['expires_at']
            : ($defaultDays > 0 ? now()->addDays($defaultDays)->toDateString() : null);

        /** @var SaleDocument $document */
        $document = SaleDocument::query()->create([
            'kind' => $kind,
            'number' => $number,
            'status' => SaleDocument::STATUS_OPEN,
            'branch_id' => $branchId,
            'register_id' => $this->registerContext->id(),
            'customer_id' => $customer?->id,
            // The name typed for THIS paper wins — the record on file is not
            // renamed by it (Q11), so the paper keeps its own copy. Else the
            // name somebody gave before; never the placeholder.
            'customer_name' => filled($data['customer_name'] ?? null) ? trim((string) $data['customer_name']) : $customer?->knownName(),
            'customer_phone' => $customer?->phone ?? ($data['customer_phone'] ?? null),
            'subtotal' => $subtotal,
            'discount' => $discount,
            'tax' => $tax,
            'tax_inclusive' => $taxInclusive,
            'total' => $total,
            // Written explicitly rather than left to the column defaults, so
            // the row handed straight back to the till is complete — a client
            // reading `balance` off a freshly created quotation shouldn't have
            // to know which fields Eloquent bothered to hydrate.
            'deposit_paid' => 0,
            'refunded_amount' => 0,
            'forfeited_amount' => 0,
            'expires_at' => $expiresAt,
            // ── Job card only ───────────────────────────────────────
            //
            // Null on every quotation and layaway, which is most documents.
            // A job card carries the car and the customer's own account of
            // what is wrong with it — the field a mechanic reads first, and
            // the one most likely to be quietly dropped in software because it
            // is not a line item, a product or a note on the invoice.
            'vehicle_id' => $isJobCard ? ($data['vehicle_id'] ?? null) : null,
            'odometer_in' => $isJobCard ? ($data['odometer_in'] ?? null) : null,
            'complaint' => $isJobCard ? ($data['complaint'] ?? null) : null,
            'promised_at' => $isJobCard ? ($data['promised_at'] ?? null) : null,
            // A car that has just arrived is in the bay, not being worked on.
            // Defaulting to `received` rather than requiring it means nobody
            // has to answer a question at the moment they are holding keys.
            'work_status' => $isJobCard
                ? ($data['work_status'] ?? SaleDocument::WORK_RECEIVED)
                : null,
            // A quotation reserves nothing; a layaway owns its goods.
            'stock_reserved' => $isLayaway,
            // The shop's QUOTATION terms ("prices held for 15 days…") are about
            // a quoted price. A job card has none, and printed them anyway.
            'terms' => $data['terms'] ?? ($isJobCard ? null : $tenant?->setting('quotation_terms')),
            'notes' => $data['notes'] ?? null,
            'idempotency_key' => $data['idempotency_key'] ?? null,
        ]);

        // The car booked in for this customer is theirs, if nobody had said whose it was.
        if ($isJobCard && $customer !== null && ! empty($data['vehicle_id'])) {
            CustomerVehicle::query()->whereKey($data['vehicle_id'])->first()?->adoptOwner($customer->id);
        }

        foreach ($lines as $line) {
            $document->items()->create([
                'tenant_id' => $tenantId,
                'product_id' => $line['product']->id,
                'variant_id' => $line['variant']?->id,
                'unit_id' => $line['unit']?->id,
                'product_name' => $line['product']->name,
                'variant_name' => $line['variant']?->name,
                'unit_name' => $line['unit']?->name,
                'unit_factor' => $line['factor'],
                'sku' => $line['variant']?->sku ?? $line['product']->sku,
                'item_type' => $line['product']->type->value,
                'quantity' => $line['quantity'],
                'unit_price' => $line['unit_price'],
                'line_discount' => $line['line_discount'],
                'line_total' => $line['line_total'],
                'tax_rate' => $line['tax_rate'],
            ]);
        }

        // ── Pull the goods (layaway only) ───────────────────────────
        // Through the audited path, exactly like a sale, so the units are
        // accounted for in stock_movements and a shortfall fails the whole
        // document rather than promising a customer something that isn't there.
        // A combo or recipe item is refused rather than exploded: holding "one
        // deal" for six weeks means holding its components, and letting the
        // components be sold out from under it would turn a paid-for promise
        // into an argument at collection.
        if ($isLayaway) {
            foreach ($lines as $line) {
                /** @var Product $product */
                $product = $line['product'];

                if ($product->isCombo() || $product->hasRecipe()) {
                    throw DomainException::unprocessable(
                        "\"{$product->name}\" is made up of other items — it can't be held on advance.",
                        'ITEM_NOT_HOLDABLE',
                    );
                }

                if ($product->type !== ItemType::Product || ! $product->track_inventory) {
                    continue; // a service or an untracked item holds no stock
                }

                $this->inventory->adjust([
                    'product_id' => $product->id,
                    'variant_id' => $line['variant']?->id,
                    'type' => 'out',
                    'quantity' => round($line['quantity'] * $line['factor'], 3),
                    'reason' => "Held on advance {$number}",
                    'reference_type' => 'layaway',
                    'reference_id' => $document->id,
                    'branch_id' => $branchId,
                ]);
            }

            if ($deposit > 0) {
                app(RecordDepositAction::class)->execute($document, [
                    'amount' => $deposit,
                    'method' => $data['deposit']['method'] ?? 'cash',
                    'reference' => $data['deposit']['reference'] ?? null,
                    'note' => $data['deposit']['note'] ?? null,
                ]);
                $document->refresh();
            }
        }

        return $document->load(['items', 'payments']);
    }

    /**
     * WHAT A DOCUMENT WILL BE WRITTEN AT — asked before it is written.
     *
     * The sheet that holds goods on advance worked its figure out itself, at
     * shelf prices and before tax, so it said "at least 20 % down — Rs 1,200"
     * and this refused 1,200 because the floor is on the TAX-INCLUSIVE total,
     * Rs 1,404 (money pass 2026-10-16, $7). It now asks here: the same pricing
     * as build(), the same floor, and nothing written — not even the customer,
     * who is looked up by the number and never created by a question.
     *
     * @return array{subtotal: float, discount: float, tax: float, tax_inclusive: bool, total: float, min_deposit_percent: float, minimum_deposit: float}
     */
    public function worth(array $data): array
    {
        $tenantId = (string) $this->context->id();
        $customer = ! empty($data['customer_phone'])
            ? Customer::byPhone($tenantId, $data['customer_phone'])
            : (! empty($data['customer_id']) ? Customer::query()->whereKey($data['customer_id'])->first() : null);

        $priced = $this->priced($data, $customer);
        [$minPct, $minimum] = $data['kind'] === SaleDocument::KIND_LAYAWAY ? $this->depositFloor($priced['total']) : [0.0, 0.0];

        return [
            'subtotal' => $priced['subtotal'],
            'discount' => $priced['discount'],
            'tax' => $priced['tax'],
            'tax_inclusive' => $priced['tax_inclusive'],
            'total' => $priced['total'],
            'min_deposit_percent' => $minPct,
            'minimum_deposit' => $minPct > 0 ? $minimum : 0.0,
        ];
    }

    /**
     * The lines priced off the shop's own list, the members' discount, the
     * tax and the total — one rule for writing a document and for asking
     * what it will come to.
     *
     * @return array{lines: list<array<string, mixed>>, subtotal: float, discount: float, tax: float, tax_inclusive: bool, total: float}
     */
    private function priced(array $data, ?Customer $customer): array
    {
        $customerGroup = $customer?->group;
        $groupPriceLevel = ($customerGroup?->price_level === 'wholesale') ? 'wholesale' : 'retail';

        $tenant = $this->context->get();
        $branchId = $this->branchContext->id();
        $defaultTaxRate = (float) ($tenant?->setting('default_tax_rate', 0) ?? 0);
        $taxInclusive = (bool) ($tenant?->setting('tax_inclusive', false));

        // ── Price the lines ─────────────────────────────────────────
        $lines = [];
        $subtotal = 0.0;
        $discretionaryLineDiscount = 0.0;

        foreach ($data['items'] as $item) {
            $line = DocumentPricing::line($item, $branchId, $groupPriceLevel, $defaultTaxRate);
            $discretionaryLineDiscount = round($discretionaryLineDiscount + $line['line_discount'], 2);
            $subtotal = round($subtotal + $line['line_total'], 2);
            $lines[] = $line;
        }

        // ── Totals ──────────────────────────────────────────────────
        $discount = round((float) ($data['discount'] ?? 0), 2);

        if ($discount > $subtotal) {
            throw DomainException::unprocessable('Discount cannot exceed the subtotal.', 'DISCOUNT_EXCEEDS_SUBTOTAL');
        }

        $this->assertWithinDiscountCeiling($discount + $discretionaryLineDiscount, $subtotal);

        // Members' discount from the customer's group — a standing price, not a
        // campaign, so it belongs on a quote the same way it belongs on a sale.
        if ($customerGroup !== null) {
            $groupPct = $customerGroup->discount_percent !== null ? (float) $customerGroup->discount_percent : 0.0;
            if ($groupPct > 0) {
                $groupDiscount = round(max(0.0, round($subtotal - $discount, 2)) * min($groupPct, 100) / 100, 2);
                $discount = round($discount + $groupDiscount, 2);
            }
        }

        $tax = DocumentPricing::tax($lines, $subtotal, $discount, $taxInclusive);
        $total = $taxInclusive
            ? round($subtotal - $discount, 2)
            : round($subtotal - $discount + $tax, 2);

        if ($total <= 0) {
            throw DomainException::unprocessable(
                'A document has to be worth something — add at least one item.',
                'DOCUMENT_EMPTY',
            );
        }

        return [
            'lines' => $lines, 'subtotal' => $subtotal, 'discount' => $discount,
            'tax' => $tax, 'tax_inclusive' => $taxInclusive, 'total' => $total,
        ];
    }

    /**
     * The least a layaway takes down: the shop's percent of the total.
     *
     * @return array{0: float, 1: float} the percent, and the amount
     */
    private function depositFloor(float $total): array
    {
        $minPct = (float) ($this->context->get()?->setting('layaway_min_deposit_percent', 20) ?? 20);

        return [$minPct, round($total * $minPct / 100, 2)];
    }

    private function assertWithinDiscountCeiling(float $discount, float $subtotal): void
    {
        if ($discount <= 0) {
            return;
        }

        $settings = $this->context->get();
        $maxPct = $settings?->setting('max_discount_percent');
        $maxAmt = $settings?->setting('max_discount_amount');

        if (($maxPct === null || $maxPct === '') && ($maxAmt === null || $maxAmt === '')) {
            return;
        }

        $user = auth()->user();
        if ($user === null || $user->hasPermission(Permissions::DISCOUNTS_OVERRIDE)) {
            return;
        }

        $pct = $subtotal > 0 ? round(($discount / $subtotal) * 100, 2) : 0.0;
        $money = static fn (float $n): string => Currencies::format($n, $settings?->currency(), 2);

        if ($maxPct !== null && $maxPct !== '' && $pct > (float) $maxPct + 0.001) {
            throw DomainException::forbidden(
                "This discount is {$pct}% — above the {$maxPct}% limit. A manager has to approve it.",
                'DISCOUNT_LIMIT_EXCEEDED',
            );
        }

        if ($maxAmt !== null && $maxAmt !== '' && $discount > (float) $maxAmt + 0.001) {
            throw DomainException::forbidden(
                'This discount is '.$money($discount)
                    .' — above the '.$money((float) $maxAmt)
                    .' limit. A manager has to approve it.',
                'DISCOUNT_LIMIT_EXCEEDED',
            );
        }
    }
}
