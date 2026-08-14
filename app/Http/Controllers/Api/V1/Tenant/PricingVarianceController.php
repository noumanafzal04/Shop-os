<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Models\PosDevice;
use App\Models\PricingVariance;
use App\Support\ApiResponse;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Where a till reports that it priced a cart differently from the server.
 *
 * While the POS still sells online, every completed sale is priced a second
 * time by the offline engine and the two answers compared. The customer pays
 * the server's price either way; only disagreements reach here.
 *
 * An empty table over a fortnight of real trading is what earns offline selling
 * its place. A single row is a bug caught for the price of a comparison rather
 * than the price of a wrong receipt.
 */
class PricingVarianceController extends Controller
{
    /** A till reporting more than this in one batch is malfunctioning. */
    private const MAX_BATCH = 100;

    public function __construct(private readonly TenantContext $tenant) {}

    /**
     * Receive a batch from a till.
     *
     * Idempotent on `(tenant, sale)`: a device that loses the acknowledgement
     * and re-sends its queue must not double-report the same cart, or the
     * count — the number this whole exercise turns on — would climb on its own.
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'device_id' => ['nullable', 'uuid'],
            'variances' => ['required', 'array', 'max:'.self::MAX_BATCH],
            'variances.*.sale_id' => ['required', 'uuid'],
            'variances.*.at' => ['required', 'date'],
            'variances.*.server' => ['required', 'array'],
            'variances.*.local' => ['required', 'array'],
            //  already refuses an empty array in Laravel, so no
            // min:1 — a redundant rule reads as the thing doing the work and
            // survives the removal of the rule that actually is.
            'variances.*.differences' => ['required', 'array'],
            'variances.*.cart' => ['required', 'array'],
        ]);

        $tenantId = $this->tenant->id();
        // A device id from another shop is simply ignored rather than refused:
        // the finding is still worth keeping, and losing it over a bad
        // attribution would be the wrong trade.
        $deviceId = isset($data['device_id'])
            && PosDevice::query()->whereKey($data['device_id'])->exists()
                ? $data['device_id']
                : null;

        $stored = 0;
        foreach ($data['variances'] as $variance) {
            PricingVariance::query()->updateOrCreate(
                ['tenant_id' => $tenantId, 'sale_id' => $variance['sale_id']],
                [
                    'device_id' => $deviceId,
                    'found_at' => $variance['at'],
                    'server_totals' => $variance['server'],
                    'local_totals' => $variance['local'],
                    'differences' => $variance['differences'],
                    'cart' => $variance['cart'],
                ],
            );
            $stored++;
        }

        return ApiResponse::ok(['stored' => $stored], 'Recorded');
    }

    /**
     * What the shop's tills have found.
     *
     * Newest first, and capped: this is read to answer "is the engine ready",
     * which is a question about whether the list is empty and what the newest
     * few look like — not a report anybody pages through.
     */
    public function index(): JsonResponse
    {
        $variances = PricingVariance::query()
            ->with('device:id,name')
            ->orderByDesc('found_at')
            ->limit(50)
            ->get();

        return ApiResponse::ok([
            'checks' => $this->checks(),
            'total' => PricingVariance::query()->count(),
            'variances' => $variances->map(fn (PricingVariance $v): array => [
                'id' => $v->id,
                'sale_id' => $v->sale_id,
                'found_at' => $v->found_at?->toIso8601String(),
                'device' => $v->device?->only(['id', 'name']),
                'server' => $v->server_totals,
                'local' => $v->local_totals,
                'differences' => $v->differences,
                'cart' => $v->cart,
            ]),
        ]);
    }

    /**
     * What the shop's tills have DONE — the denominator under that count.
     *
     * Zero disagreements is the answer we want and also the answer a shop gets
     * when no till has checked anything at all, which is the more dangerous of
     * the two and the quieter one. `checked` is what tells them apart, and
     * `reporting` is what stops one busy till speaking for four.
     *
     * Revoked tills are excluded. Their checks did happen, but the question
     * being asked is whether THIS shop's working fleet has been exercised, and
     * a signed-out tablet in a drawer cannot answer it.
     */
    private function checks(): array
    {
        $tills = PosDevice::query()->live()->get([
            'shadow_checked', 'shadow_matched', 'shadow_skipped', 'shadow_differed', 'shadow_since',
        ]);

        return [
            'checked' => (int) $tills->sum('shadow_checked'),
            'matched' => (int) $tills->sum('shadow_matched'),
            'skipped' => (int) $tills->sum('shadow_skipped'),
            'differed' => (int) $tills->sum('shadow_differed'),
            'tills' => $tills->count(),
            // A fleet's evidence is only as broad as the tills producing it.
            'reporting' => $tills->where('shadow_checked', '>', 0)->count(),
            // The NEWEST start, not the oldest. These totals are a mix — a till
            // wiped yesterday contributes a day beside another's three weeks —
            // and the only date every one of them has been counting since is
            // the latest reset. Taking the oldest would print "three weeks of
            // evidence" over a fleet where one till has a day of it, which is
            // the over-claim this whole number exists to prevent.
            'since' => $tills->whereNotNull('shadow_since')->max('shadow_since')?->toIso8601String(),
        ];
    }
}
