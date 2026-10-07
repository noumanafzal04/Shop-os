<?php

namespace App\Actions\SaleDocument;

use App\Exceptions\DomainException;
use App\Models\SaleDocument;
use App\Models\SaleDocumentItem;
use App\Support\BranchContext;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * PARTS AND LABOUR GO ON AS YOU WORK.
 *
 * The workshop board said so, the book-in sheet said so, and the job card's
 * own comments said a job "accumulates lines over hours or days". Nothing did
 * it: a job card was written with the one line it was booked in with and
 * could never take another. A car booked in for a Rs 1,500 diagnostic hour,
 * given new brake pads and two hours' labour, could only be billed at
 * Rs 1,500 — and a laundry's eight shirts the same. The rest of the work
 * either went on a separate till sale, with no car and no job behind it, or
 * was not charged at all.
 *
 * A job card now takes a line, changes a quantity, and drops a line, while it
 * is open. Every line is priced by `DocumentPricing` — the same code that
 * priced the booking — and the job's totals are worked out again each time,
 * because what is billed is the job card exactly as it stands.
 *
 * Only a JOB CARD. A quotation is a price somebody was handed on paper and a
 * layaway is goods somebody has paid towards; changing either after the fact
 * is changing a promise. A job is the one document that is unfinished by
 * design.
 */
class ChangeJobCardAction
{
    public function __construct(
        private readonly TenantContext $context,
        private readonly BranchContext $branchContext,
    ) {}

    /**
     * Put a part or a piece of labour on the job. The same item again joins
     * its line — "two more litres of oil" is one line of three, not two lines.
     *
     * @param  array{product_id: string, variant_id?: ?string, product_unit_id?: ?string, quantity: float|int|string}  $item
     */
    public function add(SaleDocument $document, array $item): SaleDocument
    {
        return $this->change($document, function (SaleDocument $job, array $pricing) use ($item): void {
            $same = $job->items->first(fn (SaleDocumentItem $line) => $line->product_id === $item['product_id']
                && $line->variant_id === ($item['variant_id'] ?? null)
                && $line->unit_id === (($item['variant_id'] ?? null) === null ? ($item['product_unit_id'] ?? null) : null)
                && (float) $line->line_discount === 0.0);

            if ($same !== null) {
                $this->reprice($same, (float) $same->quantity + (float) $item['quantity'], $pricing);

                return;
            }

            $line = DocumentPricing::line([
                'product_id' => $item['product_id'],
                'variant_id' => $item['variant_id'] ?? null,
                'product_unit_id' => $item['product_unit_id'] ?? null,
                'quantity' => $item['quantity'],
            ], ...$pricing);

            $job->items()->create([
                'tenant_id' => $job->tenant_id,
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
        });
    }

    /** A different quantity on one line — priced again at that quantity, as a till would. */
    public function quantity(SaleDocument $document, string $itemId, float $quantity): SaleDocument
    {
        return $this->change($document, function (SaleDocument $job, array $pricing) use ($itemId, $quantity): void {
            $this->reprice($this->lineOf($job, $itemId), $quantity, $pricing);
        });
    }

    /** Take a line off the job. Not the last one: a job with nothing on it is a job to cancel. */
    public function remove(SaleDocument $document, string $itemId): SaleDocument
    {
        return $this->change($document, function (SaleDocument $job) use ($itemId): void {
            $line = $this->lineOf($job, $itemId);

            if ($job->items->count() <= 1) {
                throw DomainException::unprocessable(
                    'A job has to have something on it — cancel the job instead.',
                    'JOB_CARD_EMPTY',
                );
            }

            $line->delete();
        });
    }

    /**
     * Lock the job, make the change, and work its totals out again.
     *
     * @param  callable(SaleDocument, array{0: ?string, 1: string, 2: float}): void  $change
     */
    private function change(SaleDocument $document, callable $change): SaleDocument
    {
        return DB::transaction(function () use ($document, $change): SaleDocument {
            /** @var SaleDocument $job */
            $job = SaleDocument::query()->whereKey($document->id)->lockForUpdate()->firstOrFail();

            if (! $job->isJobCard()) {
                throw DomainException::unprocessable(
                    'Only a job card takes lines after it is written — a quotation or an advance is a price already given.',
                    'NOT_A_JOB_CARD',
                );
            }

            if ($job->status !== SaleDocument::STATUS_OPEN) {
                throw DomainException::conflict(
                    $job->status === SaleDocument::STATUS_CONVERTED
                        ? 'This job has been billed — nothing more can go on it.'
                        : 'This job was cancelled.',
                    'JOB_NOT_OPEN',
                );
            }

            $job->load(['items', 'customer.group']);
            $change($job, $this->pricingFor($job));
            $job->load('items');

            $this->retotal($job);

            return $job->fresh(['items', 'payments']);
        });
    }

    /**
     * What a line on THIS job is priced against: the branch it is in, its
     * customer's price level, the shop's default tax.
     *
     * @return array{0: ?string, 1: string, 2: float}
     */
    private function pricingFor(SaleDocument $job): array
    {
        $tenant = $this->context->get();
        $level = $job->customer?->group?->price_level === 'wholesale' ? 'wholesale' : 'retail';

        return [
            $job->branch_id ?? $this->branchContext->id(),
            $level,
            (float) ($tenant?->setting('default_tax_rate', 0) ?? 0),
        ];
    }

    private function lineOf(SaleDocument $job, string $itemId): SaleDocumentItem
    {
        $line = $job->items->firstWhere('id', $itemId);

        if ($line === null) {
            throw DomainException::unprocessable('That line is not on this job.', 'JOB_LINE_NOT_FOUND');
        }

        return $line;
    }

    /**
     * @param  array{0: ?string, 1: string, 2: float}  $pricing
     */
    private function reprice(SaleDocumentItem $line, float $quantity, array $pricing): void
    {
        $priced = DocumentPricing::line([
            'product_id' => $line->product_id,
            'variant_id' => $line->variant_id,
            'product_unit_id' => $line->unit_id,
            'quantity' => $quantity,
            // A discount given on this line stays the same number of rupees.
            'line_discount' => (float) $line->line_discount,
        ], ...$pricing);

        $line->forceFill([
            'quantity' => $priced['quantity'],
            'unit_price' => $priced['unit_price'],
            'line_discount' => $priced['line_discount'],
            'line_total' => $priced['line_total'],
            'tax_rate' => $priced['tax_rate'],
        ])->save();
    }

    /**
     * The job's totals, from its lines.
     *
     * The discount on a job is two things added together when it was booked:
     * any rupees knocked off by hand, and the customer's members' discount —
     * a percentage of what the job came to after that. The rupees stay the
     * same rupees; the percentage is taken again of whatever the job comes to
     * NOW, or a member's job that grew from Rs 1,500 to Rs 9,000 would carry
     * the discount on Rs 1,500.
     */
    private function retotal(SaleDocument $job): void
    {
        $subtotal = round((float) $job->items->sum(fn (SaleDocumentItem $line) => (float) $line->line_total), 2);
        $pct = min(100.0, max(0.0, (float) ($job->customer?->group?->discount_percent ?? 0))) / 100;

        $before = (float) $job->subtotal;
        $given = (float) $job->discount;
        $byHand = $pct > 0 && $pct < 1 ? round(($given - $pct * $before) / (1 - $pct), 2) : $given;
        $byHand = min(max(0.0, $pct >= 1 ? 0.0 : $byHand), $subtotal);

        $discount = $pct >= 1
            ? $subtotal
            : round($byHand + round(max(0.0, $subtotal - $byHand) * $pct, 2), 2);

        $inclusive = (bool) $job->tax_inclusive;
        $tax = DocumentPricing::tax(
            $job->items->map(fn (SaleDocumentItem $line) => ['line_total' => $line->line_total, 'tax_rate' => $line->tax_rate]),
            $subtotal,
            $discount,
            $inclusive,
        );
        $total = $inclusive ? round($subtotal - $discount, 2) : round($subtotal - $discount + $tax, 2);

        if ($total + 0.001 < (float) $job->deposit_paid) {
            $sym = $this->context->get()?->currencySymbol() ?? 'Rs';
            throw DomainException::unprocessable(
                "The job would come to less than the {$sym} ".number_format((float) $job->deposit_paid, 2).' already paid on it.',
                'JOB_BELOW_ADVANCE',
            );
        }

        $job->forceFill([
            'subtotal' => $subtotal,
            'discount' => $discount,
            'tax' => $tax,
            'total' => $total,
        ])->save();
    }
}
