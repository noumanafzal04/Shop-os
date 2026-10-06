<?php

namespace App\Actions\Restaurant;

use App\Exceptions\DomainException;
use App\Models\Product;
use App\Models\ProductUnit;
use App\Models\ProductVariant;
use App\Models\RestaurantTicket;
use App\Models\RestaurantTicketItem;
use App\Support\DiscountCeiling;
use App\Support\SoldOut;
use App\Support\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * CHANGE A LINE THE KITCHEN HAS NOT SEEN YET.
 *
 * ── What a waiter could not do ───────────────────────────────────────
 *
 * A tab had two verbs: add a line, void a line. Every tap on a dish added one
 * line of one. So a table of six ordering eight naan was eight taps and eight
 * rows on the tab — and eight rows on the kitchen's docket, "1 Roghni Naan"
 * eight times over, for the cook to count. There was no way to say "make that
 * three", and no way at all to say "no green chilli": the note column has
 * been on the line since the day it was written and no screen ever filled it.
 *
 * ── The rule ─────────────────────────────────────────────────────────
 *
 * ONLY WHILE IT IS STILL PENDING. Once a line has been fired it is a thing a
 * cook is making, and changing the number on the tab would not change the
 * number in the pan — the docket is already printed. After that point the
 * honest verbs are the two the tab always had: add another line, or void.
 *
 * THE QUANTITY MOVES BY A STEP, NOT TO A NUMBER. `adjust: 1`, never
 * `quantity: 4`. A waiter taps a dish four times in a second on shop wifi;
 * four requests each saying "one more" all arrive at four, in any order. Four
 * requests saying "set it to N", computed from what each screen last saw,
 * arrive at two. The row is locked while it moves.
 *
 * DOWN TO NOTHING IS A VOID. A line stepped to zero is struck off the tab the
 * same way `voidItem` strikes one off, so there is one kind of removed line
 * and the running total already knows how to ignore it.
 *
 * Re-priced through `AddTicketItemsAction::priced` — the same arithmetic that
 * priced it when it was added — because a tiered price depends on how many.
 */
class UpdateTicketItemAction
{
    public function __construct(private readonly TenantContext $context) {}

    /** @param  array{adjust?: int|float, note?: string|null}  $data */
    public function execute(RestaurantTicket $ticket, RestaurantTicketItem $item, array $data): RestaurantTicket
    {
        if (! $ticket->isOpen()) {
            throw DomainException::conflict('This tab is closed.', 'TICKET_NOT_OPEN');
        }

        DB::transaction(function () use ($ticket, $item, $data): void {
            /** @var RestaurantTicketItem $line */
            $line = RestaurantTicketItem::query()->whereKey($item->id)->lockForUpdate()->firstOrFail();

            if ($line->isSettled()) {
                throw DomainException::conflict('That item is already paid.', 'ITEM_SETTLED');
            }
            if ($line->isVoid()) {
                throw DomainException::conflict('That item was removed from the tab.', 'ITEM_VOID');
            }
            if ($line->kot_status !== 'pending') {
                throw DomainException::conflict(
                    'That has already gone to the kitchen — add it again for more, or void it.',
                    'ITEM_ALREADY_SENT',
                );
            }

            if (array_key_exists('note', $data)) {
                $note = trim((string) ($data['note'] ?? ''));
                $line->note = $note === '' ? null : $note;
            }

            $step = (float) ($data['adjust'] ?? 0);
            if ($step !== 0.0) {
                $quantity = round((float) $line->quantity + $step, 3);

                if ($quantity <= 0) {
                    $line->forceFill([
                        'voided_at' => now(),
                        'kot_status' => 'void',
                        'void_reason' => 'Removed before it was sent',
                    ])->save();

                    return;
                }

                $this->reprice($ticket, $line, $quantity, increasing: $step > 0);
            }

            $line->save();

            if ($step !== 0.0) {
                // The same ceiling `add` holds the tab to, read across every
                // open line: more of a discounted dish gives more away.
                $open = $ticket->items()->whereNull('voided_at')->get();
                $gross = $open->sum(fn ($i) => round((float) $i->unit_price * (float) $i->quantity, 2));
                $given = round($gross - (float) $open->sum('line_total'), 2);

                DiscountCeiling::assert($this->context, $given, $gross);
            }
        });

        return $ticket->fresh(['table', 'items']);
    }

    private function reprice(RestaurantTicket $ticket, RestaurantTicketItem $line, float $quantity, bool $increasing): void
    {
        /** @var Product|null $product */
        $product = Product::query()->whereKey($line->product_id)->where('is_active', true)->first();
        if ($product === null) {
            throw DomainException::unprocessable('That item is no longer available.', 'PRODUCT_UNAVAILABLE');
        }

        $variant = $line->variant_id === null
            ? null
            : ProductVariant::query()->whereKey($line->variant_id)->where('product_id', $product->id)->first();
        if ($line->variant_id !== null && $variant === null) {
            throw DomainException::unprocessable('That option is no longer available.', 'VARIANT_UNAVAILABLE');
        }

        $unit = $line->product_unit_id === null
            ? null
            : ProductUnit::query()->whereKey($line->product_unit_id)->where('product_id', $product->id)->first();

        // MORE of something is more food, and the kitchen may have run out of
        // it since the first one went on the tab. Fewer is never refused: a
        // table changing its mind about a dish that is now off has to be able
        // to take it off.
        if ($increasing) {
            SoldOut::assertSellable($product, $variant, $ticket->branch_id);
        }

        if ($product->sold_by !== 'weight' && fmod($quantity, 1.0) !== 0.0) {
            throw DomainException::unprocessable(
                "\"{$product->name}\" is sold by unit — enter a whole quantity.",
                'FRACTIONAL_QTY_NOT_ALLOWED',
            );
        }

        $pct = (float) ($line->line_discount_pct ?? 0);
        $priced = AddTicketItemsAction::priced(
            $product, $variant, $unit,
            $line->price_level === 'wholesale' ? 'wholesale' : 'retail',
            $quantity,
            $line->modifier_option_ids ?? [],
            $pct,
            (float) $line->line_discount,
        );

        $line->forceFill([
            'quantity' => $quantity,
            'unit_price' => $priced['unit_price'],
            'modifiers' => $priced['modifiers'] ?: null,
            'line_discount' => $pct > 0 ? 0 : $priced['line_discount'],
            'line_total' => round($priced['gross'] - $priced['line_discount'], 2),
        ]);
    }
}
