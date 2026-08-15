<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Http\Requests\Bank\StoreBankOfferRequest;
use App\Http\Requests\Bank\StoreBankRequest;
use App\Models\Bank;
use App\Models\BankCardOffer;
use App\Services\BankOfferService;
use App\Support\ApiResponse;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Banks, their card offers, and the quote a till asks for.
 *
 * ── Three audiences, three shapes ───────────────────────────────────────
 *
 * `index` is the office: every bank with every offer, live or not, because
 * somebody is editing them.
 *
 * `live` is the counter: only banks with something actually running THIS
 * MOMENT, because a dropdown of eleven banks where two have deals is a dropdown
 * a cashier stops reading by Tuesday.
 *
 * `quote` is the money question, and the reason it exists at all is the
 * standing rule in this codebase: the till never computes a figure it then
 * sends back. It asks, shows what it is told, and the sale recomputes the same
 * number from the same offer. A quote that disagreed with the sale would be a
 * bug the customer discovers at the counter — so the two share one service and
 * neither has arithmetic of its own.
 */
class BankController extends Controller
{
    public function __construct(private readonly TenantContext $tenant) {}

    // ── The office ──────────────────────────────────────────────────

    public function index(): JsonResponse
    {
        return ApiResponse::ok(
            Bank::query()->with('offers')->orderBy('name')->get(),
        );
    }

    public function store(StoreBankRequest $request): JsonResponse
    {
        return ApiResponse::created(Bank::create($request->validated()), 'Bank added');
    }

    public function update(StoreBankRequest $request, string $bank): JsonResponse
    {
        $row = Bank::query()->findOrFail($bank);
        $row->fill($request->validated())->save();

        return ApiResponse::ok($row->fresh('offers'), 'Bank updated');
    }

    public function destroy(string $bank): JsonResponse
    {
        // Soft-deleted: sales already point here and the claim report reads
        // back months. Removing the row would orphan the money.
        Bank::query()->findOrFail($bank)->delete();

        return ApiResponse::noContent('Bank removed');
    }

    public function storeOffer(StoreBankOfferRequest $request): JsonResponse
    {
        return ApiResponse::created(
            BankCardOffer::create($request->validated())->load('bank:id,name,short_code'),
            'Offer added',
        );
    }

    public function updateOffer(StoreBankOfferRequest $request, string $offer): JsonResponse
    {
        $row = BankCardOffer::query()->findOrFail($offer);
        $row->fill($request->validated())->save();

        return ApiResponse::ok($row->fresh('bank'), 'Offer updated');
    }

    public function destroyOffer(string $offer): JsonResponse
    {
        BankCardOffer::query()->findOrFail($offer)->delete();

        return ApiResponse::noContent('Offer removed');
    }

    // ── The counter ─────────────────────────────────────────────────

    /**
     * Banks worth showing a cashier right now.
     *
     * Filtered to what is LIVE at this moment, in the shop's own timezone, so
     * an evening offer does not appear at two in the afternoon and a campaign
     * that ended in March does not appear at all.
     */
    public function live(BankOfferService $offers): JsonResponse
    {
        $now = now()->setTimezone($this->tenant->get()?->timezone ?: config('app.timezone'));

        $rows = Bank::query()->live()->with('offers')->orderBy('name')->get()
            ->map(function (Bank $bank) use ($offers, $now): ?array {
                $running = $bank->offers
                    ->where('is_active', true)
                    ->filter(fn (BankCardOffer $o): bool => $offers->liveNow($o, $now))
                    ->values();

                if ($running->isEmpty()) {
                    return null;
                }

                return [
                    'id' => $bank->id,
                    'name' => $bank->name,
                    'short_code' => $bank->short_code,
                    // What the cashier can read out to the customer. Not the
                    // figure — that depends on the cart and comes from `quote`.
                    'offers' => $running->map(fn (BankCardOffer $o): array => [
                        'id' => $o->id,
                        'label' => $o->label,
                        'type' => $o->type,
                        'value' => (float) $o->value,
                        'min_spend' => $o->min_spend === null ? null : (float) $o->min_spend,
                        'max_discount' => $o->max_discount === null ? null : (float) $o->max_discount,
                        'card_types' => $o->card_types ?? [],
                    ])->all(),
                ];
            })
            ->filter()
            ->values();

        return ApiResponse::ok($rows);
    }

    /**
     * What this bank takes off this card amount, right now.
     *
     * Display only. Nothing is written and nothing is reserved — the sale asks
     * the same service the same question and uses its own answer, so a cashier
     * who sits on the screen for ten minutes past the end of a happy hour gets
     * the honest figure at Complete rather than the one they were shown.
     */
    public function quote(Request $request, BankOfferService $offers): JsonResponse
    {
        $data = $request->validate([
            'bank_id' => ['required', 'uuid'],
            // The share of the bill going on the card, BEFORE the bank's help.
            'card_amount' => ['required', 'numeric', 'min:0'],
            'card_type' => ['nullable', 'in:credit,debit'],
        ]);

        // Scoped by the tenant's own bank list rather than trusted from the
        // request: a quote for another shop's offer would leak what deals that
        // shop has signed, which is commercially theirs.
        $bank = Bank::query()->live()->find($data['bank_id']);

        $best = $bank === null ? null : $offers->best(
            $bank->id,
            (float) $data['card_amount'],
            now()->setTimezone($this->tenant->get()?->timezone ?: config('app.timezone')),
            $data['card_type'] ?? null,
        );

        return ApiResponse::ok([
            'offer_id' => $best['offer']->id ?? null,
            'label' => $best['offer']->label ?? null,
            'discount' => round($best['discount'] ?? 0, 2),
            // What the customer will actually tap. Worked out here so the
            // screen never does money arithmetic of its own.
            'card_payable' => round((float) $data['card_amount'] - ($best['discount'] ?? 0), 2),
        ]);
    }
}
