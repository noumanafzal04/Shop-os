<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Sale\CreateSaleAction;
use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Pos\SyncRequest;
use App\Models\CashSession;
use App\Models\PosDevice;
use App\Models\Product;
use App\Models\Sale;
use App\Models\User;
use App\Support\ApiResponse;
use App\Support\OfflinePolicy;
use App\Support\PlanLimits;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Throwable;

/**
 * Where sales rung with no server arrive.
 *
 * ── The endpoint's job is NOT to approve ────────────────────────────────
 *
 * The money already crossed the counter. Nothing here can un-ring a sale, so
 * this does not decide whether it should have happened — it records what DID
 * happen and reports what differs. Everything below follows from that:
 *
 *   • Out of stock does not refuse. It sells to negative and the oversell is
 *     listed for the owner. Refusing would delete the record of goods that have
 *     already left the shop.
 *   • Past the offline window does not refuse. It is marked.
 *   • A policy violation does not refuse, and is never CORRECTED. Rewriting a
 *     credit sale into a cash one would leave a shop believing it had been
 *     paid, which is worse than any refusal. It is flagged for review.
 *
 * ── Per operation, never per batch ──────────────────────────────────────
 *
 * One bad operation in fifty must not cost the other forty-nine. Each runs in
 * its own transaction and reports its own result, so a till can retire exactly
 * what landed and retry exactly what did not — the difference between a shop
 * losing one sale and a shop losing a day.
 *
 * ── Replay ──────────────────────────────────────────────────────────────
 *
 * `op` is the idempotency key, minted on the device when the cashier hit
 * Complete. A lost acknowledgement means the till sends it again, and it must
 * get the SAME sale back rather than a second one — the shop would otherwise
 * bank the same money twice for the price of one dropped packet.
 */
class PosSyncController extends Controller
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly CreateSaleAction $createSale,
    ) {}

    public function store(SyncRequest $request): JsonResponse
    {
        $data = $request->validated();
        $device = $this->device($data['device_id'] ?? null);
        $windowDays = PlanLimits::limit($this->tenant->get(), 'offline_days');

        $itemRefusals = $this->itemRefusals($data['operations']);

        $results = [];
        foreach ($data['operations'] as $operation) {
            $results[] = $this->apply($operation, $device, $windowDays, $itemRefusals);
        }

        return ApiResponse::ok([
            'results' => $results,
            'accepted' => count(array_filter($results, fn (array $r): bool => $r['status'] !== 'failed')),
        ], 'Synced');
    }

    /**
     * One operation, in its own transaction.
     *
     * Never throws. A failure is a RESULT — the till needs to know which of its
     * fifty landed, and an exception here would tell it nothing about the other
     * forty-nine.
     */
    private function apply(array $operation, ?PosDevice $device, ?int $windowDays, array $itemRefusals = []): array
    {
        $sale = $operation['sale'];
        [$soldAt, $clientSoldAt] = $this->when($operation);

        // Already here? Then this is a retry after a lost acknowledgement, and
        // the till gets the original back. Checked before anything else: a
        // replay must cost a lookup, never a second attempt at the work.
        $existing = Sale::query()->where('idempotency_key', $operation['op'])->first();
        if ($existing !== null) {
            return $this->done('duplicate', $operation['op'], $existing);
        }

        $violations = OfflinePolicy::violations($sale, $itemRefusals);

        $trainingSplit = $this->trainingDisagreement($sale, $operation);
        if ($trainingSplit !== null) {
            $violations[] = $trainingSplit;
        }

        // ── A LABEL MUST NEVER COST A SALE ────────────────────────────────
        //
        // `offline_number` is unique per tenant, and rightly so: it is what a
        // customer's slip says and what a refund is looked up by. But the
        // number is MINTED ON THE TILL, from a counter that lives in IndexedDB
        // while the device id it is paired with lives in localStorage. Evict
        // one and not the other — which browsers do, and which this app already
        // warns about — and the counter restarts under the same device segment.
        // Every sale after that carries a slip the server already has.
        //
        // What happened then: the insert died on the unique index, was caught
        // as "something unexpected, retry later", and the till offered the same
        // number again every few minutes for ever. The money never arrived, and
        // the message said "It is still safe on the till." It was safe, and it
        // could not leave.
        //
        // The operation id is the idempotency key and it was checked above. If
        // THAT is new, this is a different sale, and refusing to record real
        // money because a label repeats is the wrong way round. So the sale is
        // recorded under a disambiguated label, and the collision is reported to
        // the shop rather than hidden: two customers are holding slips with the
        // same number printed on them, and somebody should know.
        $offlineNumber = $operation['offline_number'] ?? null;
        if ($offlineNumber !== null) {
            $free = $this->freeOfflineNumber($offlineNumber);

            if ($free !== $offlineNumber) {
                $violations[] = "The slip number {$offlineNumber} had already been recorded, so this sale was filed as {$free}. "
                    .'A till mints these itself, and this one restarted its counter — most likely its saved data was cleared. '
                    .'Two customers may be holding slips printed with the same number.';
                $offlineNumber = $free;
            }
        }

        try {
            $created = $this->createSale->execute($sale + [
                'idempotency_key' => $operation['op'],
                // The moment the money crossed the counter — which decides the
                // trading day, the shift and whose figures this lands in. Never
                // the moment it reached us.
                'sold_at' => $soldAt,
                // What the tablet itself believed, and by how much it was out.
                // Never a figure — only the evidence that a clock needs setting.
                'client_sold_at' => $clientSoldAt,
                'clock_skew_seconds' => (int) round($clientSoldAt->diffInSeconds($soldAt, false)),
                'offline_number' => $offlineNumber,
                // The counter out of that label, kept as a number so the next
                // catalog pull can tell this till where it had got to. A till
                // whose IndexedDB was cleared restarts at one otherwise, and
                // every slip it then mints is one the shop already has.
                'offline_seq' => $this->sequenceIn($operation['offline_number'] ?? null),
                'pos_device_id' => $device?->id,
                // WHERE this till stands, from the device's own registration —
                // never from the header this request happens to carry. See
                // `CreateSaleAction`: a tablet carried to another branch must
                // not carry its unsent sales, or its stock, with it.
                'offline_branch_id' => $device?->branch_id,
                // WHO rang it, which is not who is sending it. See `rungBy()`.
                'created_by' => $this->rungBy($operation),
                'beyond_offline_window' => $this->beyondWindow($soldAt, $operation, $windowDays),
                'offline_violations' => $violations === [] ? null : $violations,
                // Half of the practice test. The shift is the other half, and
                // this can only ever say NO — see the veto in CreateSaleAction.
                'offline_training' => (bool) ($operation['training'] ?? false),
                // Trusted about WHEN and WHICH DEVICE. Emphatically not
                // trusted about money: the server prices this cart itself,
                // exactly as it would have online. That is the whole point of
                // Phase 2 — the till's figure was only ever a receipt.
                'trusted_offline' => true,
                // Dead today, and deliberately kept. `SyncRequest` borrows a
                // rule set with no `unit_price`, so no price ever reaches here
                // and flipping this line changes nothing — a mutation proved
                // exactly that, staying green on its own.
                //
                // It is the SECOND of two layers, and it earns its place the
                // day somebody adds a `unit_price` rule to the shared sale
                // request for the online path and never thinks about this one.
                // Mutating both at once IS caught.
                'trusted_prices' => false,
            ]);

            return $this->done('applied', $operation['op'], $created, $violations);
        } catch (DomainException $e) {
            // Something the shop can act on — a product deleted since, a
            // discount over the ceiling, a customer removed. The sale stays in
            // the till's outbox marked for attention rather than retrying for
            // ever against an answer that will not change.
            return $this->failed($operation['op'], $e->getMessage(), $e->errorCode);
        } catch (Throwable $e) {
            // Anything else. Retryable, because it may be transient.
            report($e);

            return $this->failed($operation['op'], 'This sale could not be recorded. It is still safe on the till.', 'SYNC_FAILED', retryable: true);
        }
    }

    /**
     * The counter inside a slip number, or null if there isn't one.
     *
     * `OFF-<lane>-<device>-<000001>`. The lane is sanitised of dashes when the
     * till mints it, so the fourth segment is the counter — and it is read from
     * the number AS PRINTED, before any disambiguating suffix, because what is
     * wanted is how far the till's own counter had got.
     */
    private function sequenceIn(?string $printed): ?int
    {
        if ($printed === null) {
            return null;
        }

        $parts = explode('-', $printed);

        return isset($parts[3]) && ctype_digit($parts[3]) ? (int) $parts[3] : null;
    }

    /**
     * A slip number this tenant does not already have.
     *
     * Returns the number itself when it is free — the overwhelmingly normal
     * case, one indexed lookup. When it is taken, the PRINTED number is kept as
     * the stem and a marker appended, so a shop searching for what is on the
     * customer's slip still finds the sale: `Sale::search` matches
     * `offline_number` with a LIKE, and every disambiguated form starts with
     * the number that was printed.
     *
     * The ceiling is not a limit on how many collisions are tolerable — it is a
     * refusal to loop for ever. Past it, the operation id makes the label
     * unique, which is ugly and findable, and both are better than losing the
     * sale.
     */
    private function freeOfflineNumber(string $printed): string
    {
        if (! Sale::query()->where('offline_number', $printed)->exists()) {
            return $printed;
        }

        for ($n = 2; $n <= 20; $n++) {
            $candidate = "{$printed}-D{$n}";

            if (! Sale::query()->where('offline_number', $candidate)->exists()) {
                return $candidate;
            }
        }

        return "{$printed}-D".substr(str_replace('-', '', (string) Str::uuid()), 0, 8);
    }

    /**
     * When this actually happened, and what the tablet thought.
     *
     * ── Why a tablet's clock cannot simply be believed ──────────────────
     *
     * `sold_at` is not a display field. It decides the trading day, the shift,
     * the cashier's figures and whether the day it lands in had already been
     * counted and banked. And it arrives from a device that may have been
     * bought in a market, never set up, and left flat for a week — an Android
     * that loses its battery comes back believing it is the day it shipped.
     *
     * The till corrects itself first: it measures its own drift against
     * `server_time` on every catalog pull and stamps the corrected moment. This
     * is the second line, for the cases that correction cannot reach — a till
     * that has never pulled, a clock reset after the last pull, a build old
     * enough to predate the correction entirely.
     *
     * ── The two things the server knows for certain ─────────────────────
     *
     * It cannot know when the sale happened. It CAN know two moments it cannot
     * have happened outside of, and both come from numbers already on the wire:
     *
     *   • Not in the future. `now()` is the server's own clock and needs no
     *     argument. A sale filed forward lands in a day nobody has traded yet
     *     and would sit there, ahead of the books, until that day arrived.
     *   • Not before the till last reached us. `offline_since` is that moment,
     *     and every offline sale is by definition rung after it — while the
     *     till was still in contact, the sale would have gone online.
     *
     * So the claim is moved the SMALLEST distance that makes it possible, and
     * left exactly where it was when it already is. A genuinely old sale — the
     * forty-day outbox of P3-18 — sits inside those bounds and is not touched.
     *
     * @return array{0: Carbon, 1: Carbon} the corrected moment, and the raw one
     */
    private function when(array $operation): array
    {
        $claim = Carbon::parse($operation['at']);

        // The raw reading, before the till applied any drift of its own. Older
        // builds do not send it, and then the corrected stamp is all we have.
        $client = empty($operation['client_at'])
            ? $claim->copy()
            : Carbon::parse($operation['client_at']);

        $soldAt = $claim->copy();

        $floor = empty($operation['offline_since']) ? null : Carbon::parse($operation['offline_since']);
        if ($floor !== null && $soldAt->lt($floor)) {
            $soldAt = $floor->copy();
        }

        $ceiling = now();
        if ($soldAt->gt($ceiling)) {
            $soldAt = $ceiling->copy();
        }

        return [$soldAt, $client];
    }

    /**
     * The cashier who rang it — not the login that sent it.
     *
     * These are the same person online and routinely different here. A sale
     * rung by the morning cashier can be flushed by the evening one, by a
     * manager clearing a queue, or by whoever happens to open the till after a
     * week's outage. `created_by` defaults to the authenticated user, so
     * without this every synced sale would be credited to whoever reconnected
     * — one person's staff report carrying another's whole day.
     *
     * ── Why the till's word, and not the shift's ────────────────────────
     *
     * The obvious alternative is to read the shift's own user, which needs no
     * trust at all. It is also wrong exactly where it matters: under relief
     * cover the reliever rings and the drawer stays the cashier's, so the shift
     * names the person who was on their break. The till knows who was standing
     * at it, because that person was logged into it.
     *
     * ── What that trust is worth ────────────────────────────────────────
     *
     * It is the client naming a user, so it is checked: a real user of THIS
     * shop, and still active. Anything else falls back to the sender, who is at
     * least someone. The exposure is an attribution on a report, by a cashier
     * willing to hand-edit their own browser database — and `cash_session_id`,
     * already accepted from the same place, carries more weight than this does.
     */
    private function rungBy(array $operation): ?string
    {
        if (empty($operation['rung_by'])) {
            return auth()->id();
        }

        $user = User::query()
            ->where('tenant_id', $this->tenant->id())
            ->find($operation['rung_by']);

        return $user?->isActive() === true ? $user->id : auth()->id();
    }

    /**
     * The drawer and the till disagreeing about whether this was practice.
     *
     * They should never disagree. The till was standing at that shift when it
     * rang the sale, so it knew. A disagreement means either the shift was
     * changed after the fact, or the operation was — and both are worth an
     * owner's eye however innocent the cause.
     *
     * Either way the sale is recorded as REAL, which is what both sentences
     * below say out loud. Reporting a difference the shop cannot see the
     * consequence of is how a flag gets ignored.
     */
    private function trainingDisagreement(array $sale, array $operation): ?string
    {
        if (empty($sale['cash_session_id'])) {
            return null;
        }

        $drawer = (bool) CashSession::query()
            ->whereKey($sale['cash_session_id'])
            ->value('is_training');
        $till = (bool) ($operation['training'] ?? false);

        if ($drawer === $till) {
            return null;
        }

        return $drawer
            ? 'This sale names a practice shift, but the till that rang it was not in practice mode. It has been recorded as a real sale.'
            : 'The till called this a practice sale, but the shift it names is a real one. It has been recorded as a real sale.';
    }

    /**
     * Was this rung after the shop's allowed days had run out?
     *
     * The question is "how long had this till been away WHEN IT RANG THIS",
     * not "how old is this sale now" — so it is measured from the device's own
     * last contact, which the operation carries.
     *
     * A till that went dark on the 1st and rang this on the 2nd was one day
     * out, and stays one day out however long its outbox then sat waiting for
     * a line. Measuring from today instead would condemn every sale a long
     * outage produced, including the ones rung well inside the shop's rules,
     * and a report where everything is flagged is a report nobody reads.
     */
    private function beyondWindow(Carbon $soldAt, array $operation, ?int $windowDays): bool
    {
        if ($windowDays === null || empty($operation['offline_since'])) {
            return false;
        }

        return Carbon::parse($operation['offline_since'])->diffInDays($soldAt) > $windowDays;
    }

    /**
     * Which products in this batch were never sellable offline, by id.
     *
     * Asked ONCE for the whole request. A tablet that has been dark for a week
     * arrives with fifty sales, and the answer to "is this a medicine" does not
     * change between them — resolving it per sale would be fifty round trips
     * for one query's worth of truth.
     *
     * Tenant-scoped by the model, so an id belonging to another shop simply is
     * not found here. That is not this method's fence to hold: the sale itself
     * is refused downstream, and inventing a violation for a product that does
     * not exist would put the wrong sentence in the owner's report.
     *
     * @return array<string, string>
     */
    private function itemRefusals(array $operations): array
    {
        $ids = [];
        foreach ($operations as $operation) {
            foreach ($operation['sale']['items'] ?? [] as $item) {
                if (! empty($item['product_id'])) {
                    $ids[(string) $item['product_id']] = true;
                }
            }
        }

        if ($ids === []) {
            return [];
        }

        return OfflinePolicy::itemRefusals(
            Product::query()
                ->whereIn('id', array_keys($ids))
                ->get(['id', 'name', 'item_type', 'tracks_serial']),
        );
    }

    /** The device that rang these, when we know it. Never fatal. */
    private function device(?string $id): ?PosDevice
    {
        return $id === null ? null : PosDevice::query()->find($id);
    }

    private function done(string $status, string $op, Sale $sale, array $violations = []): array
    {
        return [
            'op' => $op,
            'status' => $status,
            'sale_id' => $sale->id,
            // The real number, so the till can reconcile the slip it printed.
            'invoice_number' => $sale->invoice_number,
            'offline_number' => $sale->offline_number,
            'violations' => $violations,
        ];
    }

    private function failed(string $op, string $message, ?string $code, bool $retryable = false): array
    {
        return [
            'op' => $op,
            'status' => 'failed',
            'sale_id' => null,
            'invoice_number' => null,
            'offline_number' => null,
            'message' => $message,
            'code' => $code,
            // Whether sending it again could ever give a different answer. A
            // till that retries a permanent failure for ever never empties its
            // queue and never tells anyone why.
            'retryable' => $retryable,
        ];
    }
}
