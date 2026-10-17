<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Sale\CancelSaleAction;
use App\Actions\Sale\CreateSaleAction;
use App\Actions\Sale\ProcessExchangeAction;
use App\Actions\Sale\ProcessSaleReturnAction;
use App\Enums\SaleStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\Sale\StoreExchangeRequest;
use App\Http\Requests\Sale\StoreSaleRequest;
use App\Http\Requests\Sale\StoreSaleReturnRequest;
use App\Models\BankCardOffer;
use App\Models\Customer;
use App\Models\Sale;
use App\Models\User;
use App\Support\ApiResponse;
use App\Support\BooksDrawer;
use App\Support\BranchContext;
use App\Support\CsvExport;
use App\Support\DrawerMath;
use App\Support\Retention;
use App\Support\ShopDay;
use App\Support\ShopTime;
use App\Support\StillItsDay;
use App\Support\SupervisorApproval;
use App\Support\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

class SaleController extends Controller
{
    public function index(Request $request, BranchContext $branch): JsonResponse
    {
        $sales = $this->filtered($request, $branch)
            ->orderByDesc('sold_at')
            ->stably()->paginate(min((int) $request->query('per_page', 15), 100));

        // What the plan keeps online, said on every read and not only on the
        // one that hits the wall. A shopkeeper who scrolls to the bottom of
        // 24 months and finds nothing older must be told why, or the only
        // available reading is that the records were lost.
        return ApiResponse::paginated($sales, meta: array_filter([
            'retention' => Retention::notice($request->query('from')),
        ]));
    }

    /**
     * Export the sales ledger to CSV — honours the same search / status /
     * channel / date-range filters as index(), so "export this month's card
     * sales" is just the current filter plus a download.
     */
    public function export(Request $request, BranchContext $branch): StreamedResponse
    {
        $header = ['invoice_number', 'offline_number', 'sold_at', 'branch', 'channel', 'status', 'customer_name', 'customer_phone', 'order_type', 'table_no', 'items', 'subtotal', 'discount', 'tax', 'total', 'payment_method', 'amount_paid', 'change_due', 'notes'];

        $rows = $this->filtered($request, $branch)
            ->orderByDesc('sold_at')
            ->get()
            ->map(fn (Sale $s) => [
                $s->invoice_number,
                // Blank on almost every row. Present on the ones a shop most
                // needs to reconcile by hand — a day's takings that arrived
                // late, against the slips that were printed at the time.
                $s->offline_number,
                // By the shop's clock. This column was UTC: the file an
                // accountant is handed said a sale rung at 12:47 was at 07:47,
                // and filed an after-midnight sale under the day before.
                ShopTime::show($s->sold_at, 'Y-m-d H:i:s'),
                $s->branch?->name,
                $s->channel?->value,
                $s->status?->value,
                $s->customer_name,
                $s->customer_phone,
                $s->order_type,
                $s->table_no,
                $s->items_count,
                $s->subtotal,
                $s->discount,
                $s->tax,
                $s->total,
                $s->payment_method?->value,
                $s->amount_paid,
                $s->change_due,
                $s->notes,
            ])
            ->all();

        return CsvExport::stream('sales-'.ShopTime::show(now(), 'Y-m-d').'.csv', $header, $rows);
    }

    /**
     * What a sale would come to, before it is rung — the figures a screen shows
     * beside its button. The same request as the sale itself, so it is refused
     * for the same reasons and by the same rules; nothing is written.
     */
    public function worth(StoreSaleRequest $request, CreateSaleAction $action): JsonResponse
    {
        $worth = $action->worth($request->validated());

        return ApiResponse::ok([
            'subtotal' => (float) $worth['subtotal'],
            'discount' => (float) $worth['discount'],
            'tax' => (float) $worth['tax'],
            // The bill: what the invoice will say.
            'total' => (float) $worth['total'],
            'tip' => (float) $worth['tip'],
            'rounding' => (float) $worth['rounding'],
            // What has to cross the counter: the bill, the tip, and the coin.
            'due' => (float) $worth['amount_due'],
            // The same, as a till holds it — sent back as `expected_payable`
            // so a price that moved between asking and ringing is refused in
            // words instead of charged in silence.
            'payable' => (float) $worth['payable'],
        ]);
    }

    /**
     * THE LEDGER'S FILTERS, WRITTEN ONCE.
     *
     * The list and the CSV export had the same seven-line chain typed out
     * twice, under an export docblock that promised in as many words to
     * "honour the same filters as index()". Two copies of one rule is how that
     * promise gets quietly broken by whoever adds the eighth filter to only
     * one of them — and the export is the copy nobody would notice.
     *
     * `payment_method` and `served_by` are new here, and they are not new to
     * the product: the Help Centre has told shopkeepers this screen filters by
     * both since it was written. A help page describing a control that is not
     * there does not read as a missing feature. It reads as a control the
     * shopkeeper failed to find.
     */
    private function filtered(Request $request, BranchContext $branch): Builder
    {
        return Sale::query()
            ->withCount('items')
            ->with('branch:id,name')
            // Branch scope: a single branch (staff, or an owner focused on one)
            // sees only its sales; an owner's All-Branches view sees them all.
            ->when($branch->scopeId(), fn ($q, $b) => $q->where('branch_id', $b))
            // One definition, shared with global search — see
            // Sale::scopeMatchingSearch. It is what makes an offline slip
            // (`OFF-…`) findable at all.
            ->matchingSearch($request->query('search'))
            ->when($request->query('status'), fn ($q, $status) => $q->where('status', $status))
            ->when($request->query('channel'), fn ($q, $channel) => $q->where('channel', $channel))
            ->when($request->query('payment_method'), fn ($q, $method) => $q->where('payment_method', $method))
            ->when($request->query('served_by'), fn ($q, $seller) => $q->where('served_by', $seller))
            // The shop's own days at both ends — see ShopDay. A bare date
            // here meant midnight UTC, which in Pakistan is five in the
            // morning: the sales list and the day's report cut the same
            // night in two different places.
            ->when($request->query('from'), fn ($q, $from) => $q->where('sold_at', '>=', ShopDay::startOf($from)))
            // The plan's window. Archived, never deleted: raise the plan and
            // the same rows come back, because nothing removed them.
            ->tap(fn (Builder $q) => Retention::fence($q, 'sold_at'))
            // The whole of the day it names. Midnight would drop everything
            // rung during it, and "today" is the range this screen is opened
            // with.
            ->when($request->query('to'), fn ($q, $to) => $q->where('sold_at', '<=', ShopDay::endOf($to)));
    }

    public function store(StoreSaleRequest $request, CreateSaleAction $action, TenantContext $tenant): JsonResponse
    {
        $data = $request->validated();

        // `pos_require_shift` is enforced in CreateSaleAction, for every
        // counter sale and not only this door (BooksDrawer::mustBeOpenToday).
        $sale = $action->execute($data);

        // THE KITCHEN'S SLIP, named so the till can print it.
        //
        // A takeaway a kitchen has to make fires a docket on the server, after
        // the money is taken — so the till has no other way to learn it exists,
        // and a slip it cannot name is a slip it cannot print. Null for every
        // shop that is not a kitchen, and merged onto the payload rather than
        // set on the model: an attribute that is not a column makes the model
        // dirty and the next save() writes it.
        return ApiResponse::created(
            $sale->toArray() + ['kitchen_ticket' => $action->kitchenTicket, 'bank_offer' => $this->bankOfferOn($sale)],
            "Sale {$sale->invoice_number} completed",
        );
    }

    /**
     * WHICH BANK OFFER PAID PART OF IT (B28) — named on the till's "Sale
     * complete" sheet, which showed a total the customer did not pay and no
     * word of why. Null on every sale no bank paid towards.
     *
     * @return array{label: string, bank: string|null, discount: float}|null
     */
    private function bankOfferOn(Sale $sale): ?array
    {
        if ($sale->bank_card_offer_id === null || (float) $sale->bank_discount <= 0) {
            return null;
        }

        $offer = BankCardOffer::withTrashed()->with('bank:id,name,short_code')->find($sale->bank_card_offer_id);

        return $offer === null ? null : [
            'label' => $offer->label,
            'bank' => $offer->bank?->short_code ?: $offer->bank?->name,
            'discount' => (float) $sale->bank_discount,
        ];
    }

    /**
     * One sale by id, practice included — a trainee reprinting the receipt they
     * just rang is the point of the exercise. Fetching by id is not a report:
     * the row says `is_training` and the receipt says TRAINING across it, so
     * nothing can be mistaken for real. Only LISTS and TOTALS stay fenced.
     */
    public function show(Request $request, string $id): JsonResponse
    {
        $sale = Sale::withTraining()->with(['items', 'returns.items', 'serials', 'tradeIns', 'payments'])->findOrFail($id);

        return ApiResponse::ok([
            ...$sale->toArray(),
            // Whether it may still be voided, and what that would hand back —
            // asked before the sheet offers the button (Q18, B86).
            'void' => $sale->status === SaleStatus::Completed && ! $sale->is_training
                ? self::voiding($sale, $request->user())
                : null,
        ]);
    }

    /** @return array{open: bool, why_not: ?string, cash_back: float, from_drawer: bool, drawer: ?string, drawer_holds: ?float} */
    private static function voiding(Sale $sale, User $user): array
    {
        $over = StillItsDay::overFor($sale);
        $cash = CancelSaleAction::cashBack($sale);
        $till = BooksDrawer::tillFor($user);

        return [
            'open' => $over === null,
            'why_not' => $over,
            'cash_back' => $cash,
            // Whether the notes must go back out of a counted drawer: only
            // when a drawer took them in (CancelSaleAction::drawerFor).
            'from_drawer' => $cash > 0 && $sale->cash_session_id !== null && BooksDrawer::hasTill($user),
            // Whose drawer that would be — see BooksDrawer::stateFor.
            'drawer' => BooksDrawer::stateFor($user),
            'drawer_holds' => $till !== null ? (float) DrawerMath::for($till)['expected_cash'] : null,
        ];
    }

    /** Full or partial return/refund — restocks through the inventory path. */
    public function processReturn(StoreSaleReturnRequest $request, string $id, ProcessSaleReturnAction $action): JsonResponse
    {
        $sale = Sale::query()->with('items')->findOrFail($id);
        $data = $request->validated();
        $actor = $request->user();
        // Somebody else's drawer, or a cashier who may not refund: a
        // supervisor's PIN first (B01). Nobody, for your own drawer with the
        // permission.
        $approver = SupervisorApproval::forRefund($actor, $data['cash_session_id'] ?? null, $data['approval'] ?? null);
        unset($data['approval']);
        $data['approved_by'] = $approver?->id;

        $return = $action->execute($sale, $data);
        if ($approver !== null) {
            SupervisorApproval::record($approver, $actor, $return->cash_session_id, $return, (float) $return->refund_total, "Refund {$return->return_number} against {$sale->invoice_number}");
        }

        // Cash handed back that no drawer counted: saved, and said — the same
        // warning an expense paid in cash with no shift open gets.
        $warning = in_array($return->refund_method, ['cash', 'split'], true) && $return->cash_session_id === null
            ? BooksDrawer::untouchedDrawerWarning($request->user(), BooksDrawer::isPractice($request->user()), 'Handed back in cash')
            : null;

        return response()->json([
            'success' => true,
            'message' => "Refund {$return->return_number} processed",
            'data' => $return,
            'errors' => (object) [],
            'meta' => (object) array_filter(['warnings' => array_values(array_filter([$warning]))]),
        ], 201);
    }

    /**
     * What handing these back is worth — asked BEFORE the press.
     *
     * Nothing is written. The figure is the one `processReturn` and `exchange`
     * pay out, from the method they pay it with, so a cashier is shown the
     * money that will actually leave the drawer: the price paid, less the
     * line's share of any discount, with the tax that was charged on it.
     */
    public function returnWorth(Request $request, string $id, ProcessSaleReturnAction $action): JsonResponse
    {
        $data = $request->validate([
            'items' => ['required', 'array', 'min:1', 'max:200'],
            'items.*.sale_item_id' => ['required', 'uuid', 'distinct'],
            'items.*.quantity' => ['required', 'numeric', 'min:0.001'],
        ]);

        $sale = Sale::query()->with('items')->findOrFail($id);
        $worth = $action->worth($sale, $data['items']);

        // On khata, what is still owed comes off the account before a rupee is
        // handed over — the return does exactly this (refund_credit). The sheet
        // said "goes back to the customer 4,990" for a sale nobody had paid.
        $offKhata = $sale->customer_id === null ? 0.0 : round(min(
            (float) $worth['refund_total'],
            (float) (Customer::query()->find($sale->customer_id)?->outstandingCreditForSale($sale->id) ?? 0),
        ), 2);

        return ApiResponse::ok([
            'refund_total' => $worth['refund_total'],
            'refund_tax' => $worth['refund_tax'],
            'tax_inclusive' => $worth['inclusive'],
            'off_khata' => $offKhata,
            'handed_back' => round((float) $worth['refund_total'] - $offKhata, 2),
            'back_by' => ProcessSaleReturnAction::backBy($sale),
            // Whose count cash handed back here would land in — see BooksDrawer::stateFor.
            'drawer' => BooksDrawer::stateFor($request->user()),
            // What that drawer holds now, so the sheet can say before the
            // press that a cash refund is more than it (money pass $6).
            'drawer_holds' => ($till = BooksDrawer::tillFor($request->user())) !== null
                ? DrawerMath::for($till)['expected_cash']
                : null,
            'lines' => array_map(static fn (array $line): array => [
                'sale_item_id' => $line['sale_item']->id,
                'quantity' => $line['quantity'],
                // What this line alone hands back: tax on top where the sale
                // added it on top, inside the figure where the sale had it inside.
                'amount' => $worth['inclusive'] ? $line['line_total'] : round($line['line_total'] + $line['line_tax'], 2),
            ], $worth['lines']),
        ]);
    }

    /**
     * Exchange: return items from this sale and buy replacements in one step.
     * The returned value is credited to the new sale; the customer pays only
     * the difference. Returns { return, sale, difference }.
     */
    public function exchange(StoreExchangeRequest $request, string $id, ProcessExchangeAction $action): JsonResponse
    {
        $sale = Sale::query()->with('items')->findOrFail($id);
        $data = $request->validated();
        $actor = $request->user();
        $approver = SupervisorApproval::forRefund($actor, $data['cash_session_id'] ?? null, $data['approval'] ?? null);
        unset($data['approval']);
        $data['approved_by'] = $approver?->id;

        $result = $action->execute($sale, $data);
        if ($approver !== null) {
            $return = $result['return'];
            SupervisorApproval::record($approver, $actor, $result['sale']->cash_session_id, $return, (float) $result['difference'], "Exchange {$return->return_number} → {$result['sale']->invoice_number} against {$sale->invoice_number}");
        }

        // Cash taken for a dearer swap, or handed back for a cheaper one, with
        // no drawer of the exchanger's own to count it: saved, and said — the
        // return's warning, which the exchange's answer lacked (tester pass 2).
        $new = $result['sale'];
        $cashMoved = (float) $new->change_due > 0 || $new->payments()->where('method', 'cash')->where('amount', '>', 0)->exists();
        $warning = $cashMoved && $new->cash_session_id === null
            ? BooksDrawer::untouchedDrawerWarning($request->user(), BooksDrawer::isPractice($request->user()), 'Cash for the exchange')
            : null;

        return response()->json([
            'success' => true,
            'message' => "Exchange completed — new sale {$new->invoice_number}",
            'data' => $result,
            'errors' => (object) [],
            'meta' => (object) array_filter(['warnings' => array_values(array_filter([$warning]))]),
        ], 201);
    }

    /**
     * Void a completed sale. Requires sales.void (see routes) and now a REASON
     * CODE from a fixed list.
     *
     * Free text alone was unreviewable: a manager scanning a week of voids could
     * not tell a mis-keyed item from a pattern, so the one control that catches
     * a ring-and-void — someone reading the void report — had nothing to read.
     * A fixed code makes voids countable per cashier; the note stays for detail.
     */
    /**
     * Void a sale rung in error — the same day, or not at all (Q18).
     *
     * A cashier may start it; somebody who may void approves it with their
     * PIN, as with a refund (SupervisorApproval). Cash goes back out of the
     * voider's own drawer, or the open drawer they name (CancelSaleAction).
     */
    public function cancel(Request $request, string $id, CancelSaleAction $action): JsonResponse
    {
        $data = $request->validate([
            'reason_code' => ['required', Rule::in(Sale::VOID_REASONS)],
            'reason' => ['nullable', 'string', 'max:255'],
            'cash_session_id' => ['nullable', 'uuid'],
            'approval' => ['nullable', 'array'],
            'approval.user_id' => ['required_with:approval', 'uuid'],
            'approval.pin' => ['required_with:approval', 'string', 'max:12'],
        ]);

        $sale = Sale::query()->with('items')->findOrFail($id);
        StillItsDay::refuseIfOver($sale);
        $actor = $request->user();
        $approver = SupervisorApproval::forVoid($actor, $data['cash_session_id'] ?? null, $data['approval'] ?? null);

        $label = Sale::VOID_REASON_LABELS[$data['reason_code']] ?? $data['reason_code'];
        $note = $data['reason'] ?? null;

        $sale = $action->execute(
            $sale,
            $note === null ? $label : "{$label} — {$note}",
            $data['reason_code'],
            $data['cash_session_id'] ?? null,
        );
        if ($approver !== null) {
            SupervisorApproval::record($approver, $actor, $data['cash_session_id'] ?? BooksDrawer::tillFor($actor)?->id, $sale, (float) $sale->total, "Void {$sale->invoice_number}");
        }

        return ApiResponse::ok($sale, 'Sale cancelled — stock restored');
    }

    // Receipts moved to ReceiptController: rendering one has to be logged
    // (original vs copy) and reported on, which is more than this controller
    // should carry.
}
