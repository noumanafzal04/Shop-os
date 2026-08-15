<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Models\BranchStock;
use App\Models\Sale;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * What happened while the shop was offline.
 *
 * ── One screen, one question ────────────────────────────────────────────
 *
 * The morning after a power cut, an owner has exactly one question and it is
 * not a technical one: *what did I miss, and is anything wrong?* Today they
 * would have to work that out by comparing yesterday's takings against a till
 * they cannot read. Everything here exists to answer it in a glance:
 *
 *   • what came in late, how much of it, and from which till
 *   • what broke a rule and needs a decision  (`offline_violations`)
 *   • what was rung past the shop's window    (`beyond_offline_window`)
 *   • what landed against a day already signed off (`after_day_close`)
 *   • what went NEGATIVE on the shelf          — the recount list
 *
 * ── Why "after the day was closed" is reported and not fixed ────────────
 *
 * Tuesday's drawers were counted, the day was closed, the cash went to the
 * bank. On Wednesday morning Tuesday's sales arrive. Recomputing Tuesday would
 * change a variance somebody had already accepted and signed for — a day
 * signed off in March has to read the same in September. So the books hold
 * still and the shortfall is named instead, in rupees, because an adjustment
 * is written from a figure and not from a count.
 *
 * ── Why oversell is a shelf query and not a sales query ─────────────────
 *
 * Two tills offline can each sell the last carton, and both are telling the
 * truth — the goods left the shop twice. No sale is wrong, so no sale can be
 * found by looking for the mistake. What is wrong is the SHELF, and the shelf
 * says so plainly: a negative quantity is stock that left without being there.
 *
 * That is why this reads `branch_stock` rather than trying to reconstruct a
 * conflict from the sales that caused it.
 */
class OfflineReportController extends Controller
{
    /** A morning's reading, not an audit trail. */
    private const RECENT = 100;

    /**
     * How far a till's clock may be out before it is worth naming.
     *
     * Two minutes, not two seconds. Every tablet drifts a little and a screen
     * that reports each one is a screen nobody reads twice — while a clock two
     * minutes out cannot move a sale across a trading day, a shift boundary or
     * a day close, which are the only things `sold_at` decides.
     */
    private const DRIFT_SECONDS = 120;

    public function index(Request $request): JsonResponse
    {
        $from = $request->filled('from')
            ? Carbon::parse($request->string('from')->toString())->startOfDay()
            // A fortnight, because the question is asked the morning after and
            // sometimes the Monday after that.
            : now()->subDays(14)->startOfDay();

        $late = Sale::query()
            ->whereNotNull('synced_at')
            ->where('sold_at', '>=', $from);

        return ApiResponse::ok([
            'from' => $from->toIso8601String(),
            'summary' => [
                'sales' => (clone $late)->count(),
                'total' => (float) (clone $late)->sum('total'),
                // The two that need a person to look at them.
                'flagged' => (clone $late)->whereNotNull('offline_violations')->count(),
                'beyond_window' => (clone $late)->where('beyond_offline_window', true)->count(),
                // Landed against a day the owner had already counted, closed
                // and banked. The books cannot move — a signed-off day must
                // read the same in September — so the VALUE is what matters
                // here, not the count: it is the exact figure by which that
                // day's recorded takings now fall short of its sales, and the
                // only number an adjustment can be written from.
                'after_close' => (clone $late)->where('after_day_close', true)->count(),
                'after_close_total' => (float) (clone $late)->where('after_day_close', true)->sum('total'),
                // Sales whose till had the wrong time. The moment was corrected
                // before it was filed, so no figure here is wrong — but a
                // correction nobody sees is a tablet that goes on being three
                // days out every morning for ever.
                'clock_off' => (clone $late)
                    ->whereNotNull('clock_skew_seconds')
                    ->whereRaw('abs(clock_skew_seconds) > ?', [self::DRIFT_SECONDS])
                    ->count(),
                // A shop trading through a cut wants to know how long the gap
                // was, and the arrival times are the only record of it.
                'oldest' => (clone $late)->min('sold_at'),
                'newest' => (clone $late)->max('sold_at'),
            ],
            'sales' => (clone $late)
                ->with(['device:id,name', 'register:id,name'])
                // Flagged first: the whole reason for opening this screen is
                // the handful that need a decision, and they must not be on
                // page three behind ninety that were fine.
                ->orderByRaw('offline_violations is null')
                ->orderByDesc('sold_at')
                ->limit(self::RECENT)
                ->get()
                ->map(fn (Sale $s): array => [
                    'id' => $s->id,
                    'invoice_number' => $s->invoice_number,
                    // The slip the customer is holding. Searchable, and the
                    // only reference they have.
                    'offline_number' => $s->offline_number,
                    'sold_at' => $s->sold_at?->toIso8601String(),
                    'synced_at' => $s->synced_at?->toIso8601String(),
                    // How long it sat on the till. The number that says whether
                    // this was a two-hour cut or a fortnight nobody noticed.
                    'held_hours' => $s->sold_at && $s->synced_at
                        ? (int) floor($s->sold_at->diffInHours($s->synced_at))
                        : null,
                    'total' => (float) $s->total,
                    'till' => $s->device?->name,
                    'register' => $s->register?->name,
                    'violations' => $s->offline_violations ?? [],
                    'beyond_window' => (bool) $s->beyond_offline_window,
                    'after_close' => (bool) $s->after_day_close,
                ])
                ->values(),
            'oversold' => $this->oversold(),
            'clocks' => $this->clocks($from),
        ]);
    }

    /**
     * Tills whose clock is wrong — one row each, not one per sale.
     *
     * The list above answers "what came in late". This answers a different
     * question with a different owner: which piece of hardware needs somebody
     * to walk over and set its time. Rolled up per device because that is the
     * unit of the fix — a tablet three days out produced forty sales and there
     * is still only one thing to do about it.
     *
     * Signed, and the worst by absolute size wins: a till running BEHIND files
     * sales into days that have been counted and banked, and one running AHEAD
     * files them into a day nobody has traded yet. Both are the same defect and
     * the shop needs to see which way round it is.
     */
    private function clocks(Carbon $from): array
    {
        return Sale::query()
            ->whereNotNull('synced_at')
            ->where('sold_at', '>=', $from)
            ->whereNotNull('pos_device_id')
            ->whereNotNull('clock_skew_seconds')
            ->whereRaw('abs(clock_skew_seconds) > ?', [self::DRIFT_SECONDS])
            ->with('device:id,name')
            ->get(['id', 'pos_device_id', 'clock_skew_seconds'])
            ->groupBy('pos_device_id')
            ->map(fn ($sales): array => [
                'till' => $sales->first()->device?->name,
                'sales' => $sales->count(),
                // Whole seconds, signed. Positive means the till was BEHIND.
                'skew_seconds' => (int) $sales
                    ->sortByDesc(fn (Sale $s): int => abs((int) $s->clock_skew_seconds))
                    ->first()->clock_skew_seconds,
            ])
            ->sortByDesc(fn (array $row): int => abs($row['skew_seconds']))
            ->values()
            ->all();
    }

    /**
     * Stock that went below zero — the recount list.
     *
     * Not "errors". Every sale behind these was legitimate; what they need is
     * somebody to walk to the shelf and count, which is a five-minute job that
     * nobody does unless a screen names the item.
     */
    private function oversold(): array
    {
        return BranchStock::query()
            ->where('quantity', '<', 0)
            ->with(['product:id,name,sku', 'branch:id,name'])
            ->orderBy('quantity')
            ->limit(self::RECENT)
            ->get()
            ->map(fn (BranchStock $s): array => [
                'product' => $s->product?->name,
                'sku' => $s->product?->sku,
                'branch' => $s->branch?->name,
                'quantity' => (float) $s->quantity,
            ])
            ->values()
            ->all();
    }
}
