<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Pos\CloseBusinessDayAction;
use App\Http\Controllers\Controller;
use App\Models\BankDeposit;
use App\Models\BusinessDay;
use App\Models\CashSession;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use App\Support\DrawerMath;
use App\Support\Permissions;
use App\Support\Retention;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

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
            return ApiResponse::ok(null, 'No day open');
        }

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
                'sales_count' => (int) $rows->sum(fn (array $r) => (int) ($r['live']['sales_count'] ?? $r['sales_count'] ?? 0)),
                'sales_total' => $sum('sales_total'),
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
            // The day's takings that are still in the shop. Floats are excluded
            // — they were never today's money and they stay for tomorrow.
            'unbanked' => round($cashSales - $banked, 2),
            'deposits' => BankDeposit::query()
                ->with('depositedBy:id,name')
                ->where('business_day_id', $day->id)
                ->orderByDesc('deposited_at')
                ->get(),
        ]);
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
            ->paginate(30);

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

    // ── Banking ─────────────────────────────────────────────────────

    public function deposits(Request $request): JsonResponse
    {
        $deposits = BankDeposit::query()
            ->with(['depositedBy:id,name', 'branch:id,name', 'businessDay:id,trading_date'])
            ->when($this->branch->scopeId(), fn ($q, $b) => $q->where('branch_id', $b))
            ->when($request->filled('from'), fn ($q) => $q->whereDate('deposited_at', '>=', $request->date('from')))
            ->when($request->filled('to'), fn ($q) => $q->whereDate('deposited_at', '<=', $request->date('to')))
            ->tap(fn (Builder $q) => Retention::fence($q, 'deposited_at'))
            ->orderByDesc('deposited_at')
            ->paginate(30);

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
        $dayId = $data['business_day_id'] ?? BusinessDay::openFor($this->branch->id())?->id;

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

        return ApiResponse::created($deposit->load('depositedBy:id,name'), 'Deposit recorded');
    }
}
