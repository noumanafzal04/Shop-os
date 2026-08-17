<?php

namespace App\Actions\Inventory;

use App\Models\ProductBatch;
use App\Models\Tenant;
use App\Services\NotificationService;
use App\Support\ShopSettings;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * Telling a shop its stock is about to die, before it does.
 *
 * ── The gap this closes ─────────────────────────────────────────────────
 *
 * Every part of this already existed and none of it spoke first. The batches
 * carry expiry dates, the dashboard counts what is near, the pharmacy screen
 * lists it, Disposals records what was binned or sent back. **All of it is
 * pull-only** — a shop learns its stock is dying by going to look, which means
 * it learns on the day somebody happened to look.
 *
 * Expiry is the one loss in a shop that is completely silent. Nothing breaks,
 * no figure looks wrong, the stock sits on the shelf looking like stock. It
 * stops being money on a specific date and nobody is told.
 *
 * ── The real design question is how OFTEN to speak ──────────────────────
 *
 * A daily "you have 43 items expiring" is worse than saying nothing. It is the
 * same sentence every morning, so it stops being read inside a week, and then
 * the one day it says 44 nobody notices either.
 *
 * So this speaks **per batch, per stage, exactly once**:
 *
 *   1. **Approaching** — the lot crosses the shop's OWN window
 *      (`expiring_soon_days`: 90 for a pharmacy, 30 for everyone else, or
 *      whatever the shop set). "There is still time to sell or return this."
 *   2. **Expired** — it is past the date. "This cannot be sold; decide where
 *      it goes." Links to Disposals, which knows the difference between binned
 *      and returned-to-supplier.
 *
 * Two stages, not three, because the third one everybody wants — "return it to
 * the distributor now" — needs a number nobody has given us. Supplier return
 * terms are per-contract, and inventing 30 days would be a guess dressed as
 * advice. The shop's own window is a number the shop chose.
 *
 * The dedupe key is the batch plus the stage, so a lot tells you twice in its
 * life and never again. A pharmacy with two hundred lots does not get two
 * hundred alerts: lots cross a threshold on the days they cross it, a handful
 * at a time.
 *
 * ── What it does NOT do ─────────────────────────────────────────────────
 *
 * It does not remove, reserve, block or price anything. Expired stock is
 * already unsellable — `InventoryService` refuses to let an OUT dip into an
 * expired lot — so there is nothing to enforce here. This is the sentence that
 * arrives before somebody finds out at the counter.
 */
class NotifyExpiringStock
{
    /**
     * The most alerts one shop may be sent in one run.
     *
     * The first run against an existing shop is the awkward one: every lot
     * already inside the window crosses it at once, and a chemist who has
     * never seen this could wake up to eighty notifications. A cap makes that
     * first morning readable; the rest arrive tomorrow, and the day after,
     * because the dedupe means nothing is lost by waiting.
     */
    public const MAX_PER_TENANT_PER_RUN = 20;

    public function __construct(private readonly NotificationService $notifications) {}

    /**
     * @return array{approaching: int, expired: int}
     */
    public function run(?Carbon $today = null): array
    {
        $today = ($today ?? Carbon::today())->startOfDay();
        $sent = ['approaching' => 0, 'expired' => 0];

        Tenant::query()->each(function (Tenant $tenant) use ($today, &$sent): void {
            $window = ShopSettings::expiringSoonDays($tenant);
            $budget = self::MAX_PER_TENANT_PER_RUN;

            // Expired first, deliberately. If a run is capped, the lots that
            // are already dead matter more than the ones with weeks left.
            foreach ([
                'expired' => $this->lots($tenant, null, $today),
                'approaching' => $this->lots($tenant, $today, $today->copy()->addDays($window)),
            ] as $stage => $lots) {
                foreach ($lots as $batch) {
                    if ($budget <= 0) {
                        break;
                    }
                    if ($this->tell($tenant, $batch, $stage, $today, $window)) {
                        $budget--;
                        $sent[$stage]++;
                    }
                }
            }
        });

        return $sent;
    }

    /**
     * Lots holding stock whose expiry falls in a window.
     *
     * `$from === null` means everything already past. Quantity above zero
     * throughout: a lot that has been sold out or written off is not a loss
     * waiting to happen, and telling a shop about it would be telling it about
     * a problem it has already solved.
     *
     * @return Collection<int, ProductBatch>
     */
    private function lots(Tenant $tenant, ?Carbon $from, Carbon $to)
    {
        return ProductBatch::withoutTenancy()
            ->with('product:id,name')
            ->where('tenant_id', $tenant->id)
            ->where('quantity', '>', 0)
            ->whereNotNull('expiry_date')
            ->when($from !== null, fn ($q) => $q->whereDate('expiry_date', '>=', $from))
            ->whereDate('expiry_date', $from === null ? '<' : '<=', $to)
            ->orderBy('expiry_date')
            ->get();
    }

    /** @return bool whether anything was actually sent */
    private function tell(Tenant $tenant, ProductBatch $batch, string $stage, Carbon $today, int $window): bool
    {
        $name = $batch->product?->name ?? 'An item';
        $lot = $batch->batch_number !== null && $batch->batch_number !== ''
            ? " (batch {$batch->batch_number})"
            : '';
        $qty = rtrim(rtrim(number_format((float) $batch->quantity, 3, '.', ''), '0'), '.');
        $on = $batch->expiry_date->format('j M Y');

        [$title, $body] = $stage === 'expired'
            ? [
                'Expired stock on the shelf',
                "{$name}{$lot} — {$qty} left, expired {$on}. It cannot be sold. "
                .'Record where it goes in Disposals: binned is a loss, returned to the supplier is money owed to you.',
            ]
            : [
                'Stock nearing expiry',
                "{$name}{$lot} — {$qty} left, expires {$on}, inside your {$window}-day window. "
                .'Still time to sell it down or agree a return with the supplier.',
            ];

        // Batch + stage. A lot speaks twice in its life and never again, which
        // is what keeps this from becoming the notification nobody reads.
        $created = $this->notifications->notifyTenantOwners(
            $tenant->id,
            "stock.expiry.{$stage}",
            $title,
            $body,
            [
                'batch_id' => $batch->id,
                'product_id' => $batch->product_id,
                'expiry_date' => $batch->expiry_date->toDateString(),
                'days' => $today->diffInDays($batch->expiry_date, false),
            ],
            "expiry-{$stage}-{$batch->id}",
        );

        // notifyTenantOwners returns one row per owner; an already-deduped
        // batch comes back as nulls, and a shop with no owner at all comes back
        // empty. Neither spent the budget.
        return $created->filter()->isNotEmpty();
    }
}
