<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Pos\CloseBusinessDayAction;
use App\Actions\Pos\ReopenBusinessDayAction;
use App\Http\Controllers\Controller;
use App\Models\BankDeposit;
use App\Models\BusinessDay;
use App\Models\CashSession;
use App\Models\CustomerLedgerEntry;
use App\Support\ApiResponse;
use App\Support\AwayFromDrawers;
use App\Support\BranchContext;
use App\Support\DrawerMath;
use App\Support\KhataCollected;
use App\Support\Permissions;
use App\Support\Retention;
use App\Support\ShopDay;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * The trading day, and what left for the bank.
 *
 * A shift answers "did this cashier's drawer balance". Neither it nor any
 * number of them answers the question an owner actually asks at 10pm — "what
 * did the shop take today, and how much of it is going to the bank" — because
 * that spans three drawers plus the safe.
 */
class BusinessDayController extends Controller
{
    public function __construct(private readonly BranchContext $branch) {}

    /** The day currently trading, with its shifts as they stand right now. */
    public function current(Request $request): JsonResponse
    {
        /**
         * WHICH COUNTER IS THIS SCREEN ABOUT?
         *
         * `BranchContext` answers two different questions and this used to
         * ask the wrong one. `id()` is the branch being OPERATED, and it is
         * never null for an owner — `ResolveBranch` pins them to Main when no
         * header is sent. `scopeId()` is the branch being LOOKED AT, and it
         * is null precisely when the owner has chosen "All branches", which
         * is what the panel's switcher sends: nothing at all.
         *
         * So a chain whose Main had already closed and whose other two shops
         * were mid-afternoon opened Day & Banking and was told the day had
         * not started. Nothing on the screen named a branch, so the only
         * reading available to the owner was "nobody has opened the till" —
         * on a day with money in three drawers.
         *
         * A branch that was CHOSEN still answers only for itself: an owner
         * looking at Main whose Main is closed is correctly told so, and
         * showing them another branch's drawer would be worse than nothing.
         */
        $open = $this->branch->scopesAll()
            ? BusinessDay::openAcrossTheShop()
            : collect(array_filter([BusinessDay::openFor($this->branch->id())]));

        /** @var BusinessDay|null $day */
        $day = $open->first()?->load(['openedBy:id,name', 'branch:id,name']);

        if ($day === null) {
            // Nothing open — and if that is because today's was closed off,
            // say so, and say whether it can be opened again. "No day open"
            // alone reads as "nobody has started yet", which at two in the
            // afternoon after a mis-pressed close is the opposite of the truth.
            return ApiResponse::ok(null, 'No day open', $this->closedToday($request));
        }

        // AN OLDER DAY STILL OPEN DOES NOT HIDE TODAY'S CLOSE. Codex QA
        // 2026-10-16 (BUG-70): the 13th and 15th were never signed off, so
        // this answered with the 15th as "the day" and never looked further —
        // today's closed day, and its way back, were on no screen at all.
        $meta = $day->trading_date->toDateString() < ShopDay::today($request->user()?->tenant)
            ? $this->closedToday($request)
            : [];

        // Named, because "a day" means nothing across three shops. The row
        // already carries its branch; this says how many OTHERS are trading,
        // so an owner reading one counter's figures knows there are more.
        $alsoTrading = $open
            ->reject(fn (BusinessDay $d) => $d->is($day))
            ->map(fn (BusinessDay $d) => ['id' => $d->branch_id, 'name' => $d->branch?->name])
            ->values();

        $sessions = CashSession::query()
            ->with(['user:id,name', 'register:id,name'])
            ->where('business_day_id', $day->id)
            ->orderBy('opened_at')
            ->get();

        // A shift's figures are frozen at close, so a drawer that has been
        // selling all afternoon carries a zero in every column until someone
        // counts it. Reading the columns alone would show the owner a shop that
        // has taken nothing — at exactly the hour they check. So the open ones
        // are computed live, from the same DrawerMath the X-read uses.
        $rows = $sessions->map(function (CashSession $session): array {
            $data = $session->toArray();

            if ($session->isOpen()) {
                $drawer = DrawerMath::for($session);
                $data['live'] = [
                    'sales_count' => $drawer['sales_count'],
                    'sales_total' => $drawer['sales_total'],
                    'cash_sales' => $drawer['cash_sales'],
                    'expected_cash' => $drawer['expected_cash'],
                ];
            }

            return $data;
        });

        // Frozen where a shift is closed, live where it isn't.
        $sum = fn (string $key) => round((float) $rows->sum(
            fn (array $r) => (float) ($r['live'][$key] ?? $r[$key] ?? 0),
        ), 2);

        $banked = round((float) BankDeposit::query()->where('business_day_id', $day->id)->sum('amount'), 2);
        $cashSales = $sum('cash_sales');
        $held = round((float) $rows->sum(fn (array $r) => (float) (isset($r['live'])
            ? $r['live']['expected_cash']
            : ($r['counted_cash'] ?? $r['expected_cash'] ?? 0))), 2);
        // Sold today with no drawer — in "Rung up", never in the drawers (B14).
        $away = AwayFromDrawers::of($day);

        return ApiResponse::ok([
            'day' => $day,
            // Empty on a single-site shop and on a chosen branch — the screen
            // only has something extra to say in the HQ view.
            'also_trading' => $alsoTrading,
            'sessions' => $rows,
            // A live roll-up so the owner can watch the day build. Deliberately
            // NOT written to the row until close — a running total that gets
            // frozen halfway is worse than none.
            'running' => [
                'shifts' => $sessions->count(),
                'open_shifts' => $sessions->where('status', 'open')->count(),
                'sales_count' => (int) $rows->sum(fn (array $r) => (int) ($r['live']['sales_count'] ?? $r['sales_count'] ?? 0)) + $away['sales_count'],
                'sales_total' => round($sum('sales_total') + $away['sales_total'], 2),
                // …of which no drawer took: orders paid on the doorstep, sales
                // with no shift open. Said, so "Rung up" is not read as drawers.
                'away_from_drawers' => $away,
                'cash_sales' => $cashSales,
                // What every drawer in the shop should be holding right now.
                'expected_cash' => $sum('expected_cash'),
                // Counting and variance only exist once a drawer has been
                // counted, so these stay closed-shifts-only. A running variance
                // would be an accusation against a cashier still working.
                'counted_cash' => round((float) $sessions->sum(fn ($s) => (float) $s->counted_cash), 2),
                'variance' => round((float) $sessions->sum(fn ($s) => (float) $s->variance), 2),
            ],
            'banked' => $banked,
            // What is still in the shop: the cash the drawers hold — counted
            // where a shift is closed, expected where it is still trading —
            // less what went to the bank. It was cash SALES less banked, and a
            // drawer banked whole (its khata, its other income, its float) read
            // −10,982.67 beside "In the drawers 18,982.67" (retail #11).
            'unbanked' => round($held - $banked, 2),
            'deposits' => BankDeposit::query()
                ->with('depositedBy:id,name')
                ->where('business_day_id', $day->id)
                ->orderByDesc('deposited_at')
                ->get(),
            'collections' => $this->collections($request, $day),
        ], 'OK', $meta);
    }

    /**
     * Today's day at this counter, when it has been closed off — with whether
     * this person may open it again. Empty when there is none.
     *
     * @return array<string, mixed>
     */
    private function closedToday(Request $request): array
    {
        $closed = $this->branch->scopesAll()
            ? ReopenBusinessDayAction::candidateAnywhere($request->user())
            : ReopenBusinessDayAction::candidate($this->branch->id(), $request->user());

        return array_filter([
            'closed_today' => $closed === null ? null : [
                'id' => $closed->id,
                'trading_date' => $closed->trading_date->toDateString(),
                'closed_at' => $closed->closed_at?->toIso8601String(),
                'closed_by' => $closed->closedBy?->name,
                'branch' => $closed->branch?->name,
                'sales_total' => (float) $closed->sales_total,
                'can_reopen' => $request->user()->hasAnyPermission(Permissions::SUPERVISES_TILLS),
            ],
        ]);
    }

    /**
     * WHAT CAME IN AGAINST KHATA ON THIS DAY — not a sale, and not in the figures above.
     *
     * A transfer or a card against a customer's khata reached no screen but the
     * customer's own statement (L14). Cash ones are already inside "In the
     * drawers" (`khata_in`), so they are listed here and NOT added again.
     *
     * Customers' names and what they paid are khata, which is the customer
     * book's — sent to whoever keeps it, and to nobody else (null, not empty).
     */
    private function collections(Request $request, BusinessDay $day): ?array
    {
        if (! $request->user()->hasPermission(Permissions::CUSTOMERS_MANAGE)) {
            return null;
        }

        [$from, $to] = ShopDay::span($day->trading_date->toDateString(), $day->trading_date->toDateString(), ShopDay::shop($day->tenant_id));

        return KhataCollected::between($day->tenant_id, $day->branch_id, $from, $to) + [
            'entries' => KhataCollected::query($day->tenant_id, $day->branch_id, $from, $to)
                ->with(['customer:id,name,phone', 'takenBy:id,name'])
                ->orderByDesc('created_at')
                ->limit(50)
                ->get(['id', 'customer_id', 'amount', 'method', 'reference', 'created_by', 'created_at'])
                ->map(fn (CustomerLedgerEntry $e) => [
                    'id' => $e->id,
                    'amount' => round((float) $e->amount, 2),
                    'method' => $e->method,
                    'reference' => $e->reference,
                    'at' => $e->created_at?->toIso8601String(),
                    'customer' => $e->customer === null ? null : ['id' => $e->customer->id, 'name' => $e->customer->name, 'phone' => $e->customer->phone],
                    'taken_by' => $e->takenBy?->name,
                ])
                ->all(),
        ];
    }

    public function index(Request $request): JsonResponse
    {
        $days = BusinessDay::query()
            ->with(['branch:id,name', 'closedBy:id,name'])
            ->when($this->branch->scopeId(), fn ($q, $b) => $q->where('branch_id', $b))
            ->when($request->filled('from'), fn ($q) => $q->whereDate('trading_date', '>=', $request->date('from')))
            ->when($request->filled('to'), fn ($q) => $q->whereDate('trading_date', '<=', $request->date('to')))
            // Closed days are history. The day currently TRADING is not, and
            // `current()` above does not go through here — a shop whose plan
            // window had somehow swallowed today would otherwise be unable to
            // see its own open till.
            ->tap(fn (Builder $q) => Retention::fence($q, 'trading_date'))
            ->orderByDesc('trading_date')
            ->stably()->paginate(30);

        return ApiResponse::paginated($days, meta: array_filter([
            'retention' => Retention::notice($request->query('from')),
        ]));
    }

    public function show(string $id): JsonResponse
    {
        $day = BusinessDay::query()
            ->with([
                'branch:id,name', 'openedBy:id,name', 'closedBy:id,name',
                'sessions.user:id,name', 'sessions.register:id,name',
                'deposits.depositedBy:id,name',
            ])
            ->findOrFail($id);

        return ApiResponse::ok($day);
    }

    /**
     * Close off the day. Manager-only: it is the sign-off on every cashier's
     * variance, which is not a thing a cashier signs for themselves.
     */
    public function close(Request $request, string $id, CloseBusinessDayAction $action): JsonResponse
    {
        // The docblock above says manager-only and this line said owner-only:
        // SETTINGS_MANAGE is the permission to reconfigure the shop, and the
        // Manager preset deliberately withholds it. So the person hired to
        // close the shop could not close the day.
        abort_unless($request->user()->hasAnyPermission(Permissions::SUPERVISES_TILLS), 403);

        $data = $request->validate(['notes' => ['nullable', 'string', 'max:1000']]);

        /** @var BusinessDay $day */
        $day = BusinessDay::query()->findOrFail($id);

        $closed = $action->close($request->user(), $day, $data['notes'] ?? null);

        return ApiResponse::ok($closed, 'Day closed');
    }

    /**
     * Open today's day again — the way back from a close pressed by mistake.
     *
     * The same people who may close it. See ReopenBusinessDayAction for the
     * three things it refuses, and why a reason is not optional.
     */
    public function reopen(Request $request, string $id, ReopenBusinessDayAction $action): JsonResponse
    {
        abort_unless($request->user()->hasAnyPermission(Permissions::SUPERVISES_TILLS), 403);

        $data = $request->validate(['reason' => ['required', 'string', 'min:3', 'max:255']]);

        /** @var BusinessDay $day */
        $day = BusinessDay::query()->findOrFail($id);

        return ApiResponse::ok($action->execute($request->user(), $day, $data['reason']), 'Day opened again');
    }

    // ── Banking ─────────────────────────────────────────────────────

    public function deposits(Request $request): JsonResponse
    {
        $deposits = BankDeposit::query()
            ->with(['depositedBy:id,name', 'branch:id,name', 'businessDay:id,trading_date'])
            ->when($this->branch->scopeId(), fn ($q, $b) => $q->where('branch_id', $b))
            ->tap(fn ($q) => ShopDay::between($q, 'deposited_at', $request->date('from'), $request->date('to')))
            ->tap(fn (Builder $q) => Retention::fence($q, 'deposited_at'))
            ->orderByDesc('deposited_at')
            ->stably()->paginate(30);

        return ApiResponse::paginated($deposits, meta: array_filter([
            'retention' => Retention::notice($request->query('from')),
        ]));
    }

    /**
     * Record cash taken to the bank.
     *
     * No drawer movement is written. By the time money reaches a bank it left
     * the till hours earlier as a safe drop, and posting it against a drawer
     * again would remove the same rupees twice — which would show up as a
     * phantom short on a shift that balanced perfectly.
     */
    public function storeDeposit(Request $request): JsonResponse
    {
        // Walking the takings to the bank is money handling, which the shop
        // already has a permission for. A till operator still cannot invent a
        // deposit: no selling preset holds expenses.manage.
        abort_unless($request->user()->hasPermission(Permissions::EXPENSES_MANAGE), 403);

        $data = $request->validate([
            'amount' => ['required', 'numeric', 'gt:0', 'max:99999999'],
            'bank_name' => ['nullable', 'string', 'max:120'],
            'account_label' => ['nullable', 'string', 'max:120'],
            // The deposit slip. Without it the record is a claim; with it, it's
            // provable against a statement weeks later.
            'slip_number' => ['nullable', 'string', 'max:64'],
            'deposited_at' => ['nullable', 'date'],
            'business_day_id' => ['nullable', 'uuid'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);

        // The same resolver the screen uses. This used to be its own query with
        // no ordering, so a shop with last night's day still open banked today's
        // takings against yesterday.
        // With none open, the day just closed off (B10 of the full re-test):
        // the deposit used to save against no day at all, and the day whose
        // takings it carried still said nothing was banked.
        $dayId = $data['business_day_id']
            ?? BusinessDay::openFor($this->branch->id())?->id
            ?? BusinessDay::lastClosedFor($this->branch->id())?->id;

        $deposit = DB::transaction(function () use ($data, $dayId, $request): BankDeposit {
            $deposit = BankDeposit::query()->create([
                'branch_id' => $this->branch->id(),
                'business_day_id' => $dayId,
                'amount' => round((float) $data['amount'], 2),
                'bank_name' => $data['bank_name'] ?? null,
                'account_label' => $data['account_label'] ?? null,
                'slip_number' => $data['slip_number'] ?? null,
                'deposited_at' => $data['deposited_at'] ?? now(),
                'deposited_by' => $request->user()->id,
                'notes' => $data['notes'] ?? null,
            ]);

            // A closed day keeps its figures on its own row, written at the
            // close — so a deposit after it is added there too. Reopening
            // re-reads them all from the deposits (CloseBusinessDayAction).
            BusinessDay::query()
                ->whereKey($dayId)
                ->where('status', BusinessDay::STATUS_CLOSED)
                ->increment('banked_amount', (float) $deposit->amount);

            return $deposit;
        });

        return ApiResponse::created($deposit->load('depositedBy:id,name'), 'Deposit recorded');
    }
}
