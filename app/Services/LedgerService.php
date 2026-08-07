<?php

namespace App\Services;

use App\Enums\SaleStatus;
use Illuminate\Contracts\Database\Query\Builder as BuilderContract;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;

/**
 * The ledger: every movement of money, one row each, in the order it happened,
 * with the balance carried down the page.
 *
 * The Cashbook answers "what did each day come to" — one row per day, four
 * columns, a running balance. That is a summary, and for a shop it is the
 * right one. It is not a book. A books-only business (Finance Manager) lives
 * in the LINES: which bill, whose invoice number, paid how, against which
 * category. Handing them a day that says "Rs 41,200 out" and no way to open it
 * is handing them an answer they cannot check, and checking is the entire job.
 *
 * Four sources, one shape:
 *
 *   sale     money in   a completed sale (refunded ones still brought money in
 *                       — only a CANCELLED sale never happened)
 *   income   money in   a manual non-sales entry (rent, owner investment…)
 *   expense  money out  a bill
 *   refund   money out  money handed back
 *
 * Sales revenue is DERIVED here exactly as the Cashbook derives it, never
 * re-entered as income, so the two screens cannot disagree.
 *
 * Assembled as a database UNION rather than four collections merged in PHP:
 * a mart's year is six figures of sales rows, and the page the merchant asked
 * for should cost one query, not a hydration of everything before it.
 */
class LedgerService
{
    /** The four kinds of movement, and which way each one points. */
    public const TYPES = ['sale', 'income', 'expense', 'refund'];

    /**
     * A page of the ledger, plus what it opened at and what the filtered set
     * comes to.
     *
     * @return array{
     *   opening: float, closing: float,
     *   totals: array{in: float, out: float, net: float, count: int},
     *   entries: LengthAwarePaginator
     * }
     */
    public function page(
        string $tenantId,
        ?string $branchId,
        string $from,
        string $to,
        Request $request,
    ): array {
        $filtered = $this->filtered($tenantId, $branchId, $from, $to, $request);

        // What the book stood at the moment this period began — without it the
        // balance column is a running total of an arbitrary window, which is
        // not a balance.
        $opening = $this->openingBalance($tenantId, $branchId, $from, $request);

        $totals = $this->totals($filtered);

        $perPage = min((int) $request->query('per_page', 50), 200);
        $page = max(1, (int) $request->query('page', 1));

        $entries = (clone $filtered)
            ->orderBy('entry_date')
            ->orderBy('sort_at')
            ->orderBy('id')
            ->paginate($perPage, ['*'], 'page', $page);

        // Everything on earlier PAGES, so row one of page three continues from
        // where page two ended rather than restarting at the opening balance.
        $carried = $page > 1
            ? $this->netBefore($filtered, $entries->items()[0] ?? null)
            : 0.0;

        $running = round($opening + $carried, 2);

        $rows = [];
        foreach ($entries->items() as $row) {
            $in = round((float) $row->amount_in, 2);
            $out = round((float) $row->amount_out, 2);
            $running = round($running + $in - $out, 2);

            $rows[] = [
                'id' => $row->id,
                'type' => $row->type,
                'date' => $row->entry_date,
                'reference' => $row->reference,
                'description' => $row->description,
                'category' => $row->category,
                'category_id' => $row->category_id,
                'method' => $row->method,
                'in' => $in,
                'out' => $out,
                'balance' => $running,
            ];
        }

        $entries->setCollection(collect($rows));

        return [
            'opening' => $opening,
            'closing' => round($opening + $totals['net'], 2),
            'totals' => $totals,
            'entries' => $entries,
        ];
    }

    /**
     * Every filtered row, for the CSV. No pagination: an export of page one is
     * not an export.
     *
     * @return list<array<int, mixed>>
     */
    public function rows(
        string $tenantId,
        ?string $branchId,
        string $from,
        string $to,
        Request $request,
    ): array {
        $running = $this->openingBalance($tenantId, $branchId, $from, $request);

        return $this->filtered($tenantId, $branchId, $from, $to, $request)
            ->orderBy('entry_date')
            ->orderBy('sort_at')
            ->orderBy('id')
            ->get()
            ->map(function ($row) use (&$running): array {
                $in = round((float) $row->amount_in, 2);
                $out = round((float) $row->amount_out, 2);
                $running = round($running + $in - $out, 2);

                return [
                    $row->entry_date,
                    $row->type,
                    $row->reference,
                    $row->description,
                    $row->category,
                    $row->method,
                    $in ?: '',
                    $out ?: '',
                    $running,
                ];
            })
            ->all();
    }

    /**
     * The union, wrapped so the cross-cutting filters read the same column
     * names whichever source a row came from.
     */
    private function filtered(
        string $tenantId,
        ?string $branchId,
        string $from,
        string $to,
        Request $request,
    ): Builder {
        $union = $this->expenses($tenantId, $branchId, $from, $to)
            ->unionAll($this->incomes($tenantId, $branchId, $from, $to))
            ->unionAll($this->sales($tenantId, $branchId, $from, $to))
            ->unionAll($this->refunds($tenantId, $from, $to));

        $query = DB::query()->fromSub($union, 'ledger');

        // "Show me only what went out", "only the bills", "only the takings".
        $types = $this->list($request, 'type');
        if ($types !== []) {
            $query->whereIn('type', array_values(array_intersect($types, self::TYPES)));
        }

        if (($direction = $request->query('direction')) === 'in') {
            $query->where('amount_in', '>', 0);
        } elseif ($direction === 'out') {
            $query->where('amount_out', '>', 0);
        }

        if (($categories = $this->list($request, 'category_id')) !== []) {
            $query->whereIn('category_id', $categories);
        }

        if (($methods = $this->list($request, 'payment_method')) !== []) {
            $query->whereIn('method', $methods);
        }

        if (($search = trim((string) $request->query('search'))) !== '') {
            $like = '%'.$search.'%';
            $query->where(function (BuilderContract $q) use ($like): void {
                $q->where('description', 'like', $like)
                    ->orWhere('reference', 'like', $like)
                    ->orWhere('category', 'like', $like);
            });
        }

        // Amount is asked about without regard to direction: "anything over
        // fifty thousand" means either way.
        //
        // CAST is not decoration. A column of a UNION subquery carries no type
        // affinity, and PDO binds a PHP float as a STRING — so on SQLite
        // `amount_out >= 50000.0` compares a REAL against TEXT, and SQLite
        // sorts every number before every string, making it silently FALSE for
        // every row. Casting gives the expression numeric affinity, which
        // SQLite then applies to the parameter too. DECIMAL is the spelling
        // both it and MySQL accept.
        if (is_numeric($min = $request->query('min_amount'))) {
            $query->whereRaw(
                '(CAST(amount_in AS DECIMAL(18,2)) >= ? OR CAST(amount_out AS DECIMAL(18,2)) >= ?)',
                [(float) $min, (float) $min],
            );
        }

        if (is_numeric($max = $request->query('max_amount'))) {
            $query->whereRaw(
                '(CAST(amount_in AS DECIMAL(18,2)) + CAST(amount_out AS DECIMAL(18,2))) <= ?',
                [(float) $max],
            );
        }

        return $query;
    }

    /** @return array{in: float, out: float, net: float, count: int} */
    private function totals(Builder $filtered): array
    {
        $row = (clone $filtered)
            ->selectRaw('COUNT(*) as c, COALESCE(SUM(amount_in), 0) as i, COALESCE(SUM(amount_out), 0) as o')
            ->first();

        $in = round((float) ($row->i ?? 0), 2);
        $out = round((float) ($row->o ?? 0), 2);

        return [
            'in' => $in,
            'out' => $out,
            'net' => round($in - $out, 2),
            'count' => (int) ($row->c ?? 0),
        ];
    }

    /**
     * The net of every filtered row that sorts before this one — the "balance
     * brought forward" at the top of a page.
     */
    private function netBefore(Builder $filtered, ?object $first): float
    {
        if ($first === null) {
            return 0.0;
        }

        $row = (clone $filtered)
            ->where(function (BuilderContract $q) use ($first): void {
                $q->where('entry_date', '<', $first->entry_date)
                    ->orWhere(fn (BuilderContract $s) => $s
                        ->where('entry_date', $first->entry_date)
                        ->where('sort_at', '<', $first->sort_at))
                    ->orWhere(fn (BuilderContract $s) => $s
                        ->where('entry_date', $first->entry_date)
                        ->where('sort_at', $first->sort_at)
                        ->where('id', '<', $first->id));
            })
            ->selectRaw('COALESCE(SUM(amount_in), 0) as i, COALESCE(SUM(amount_out), 0) as o')
            ->first();

        return round((float) ($row->i ?? 0) - (float) ($row->o ?? 0), 2);
    }

    /**
     * Where the book stood before the period opened.
     *
     * Deliberately UNfiltered by type/category/search: an opening balance is
     * the state of the account, not of whatever slice the merchant is looking
     * at. Narrowing to "rent only" must not pretend the shop began the month
     * with nothing but rent.
     */
    private function openingBalance(string $tenantId, ?string $branchId, string $from, Request $request): float
    {
        if ($request->boolean('no_opening')) {
            return 0.0;
        }

        $before = DB::query()->fromSub(
            $this->expenses($tenantId, $branchId, null, null, $from)
                ->unionAll($this->incomes($tenantId, $branchId, null, null, $from))
                ->unionAll($this->sales($tenantId, $branchId, null, null, $from))
                ->unionAll($this->refunds($tenantId, null, null, $from)),
            'opening',
        )->selectRaw('COALESCE(SUM(amount_in), 0) as i, COALESCE(SUM(amount_out), 0) as o')->first();

        return round((float) ($before->i ?? 0) - (float) ($before->o ?? 0), 2);
    }

    // ── The four sources ────────────────────────────────────────────
    //
    // Each selects the same nine columns so the union lines up. `$strictlyBefore`
    // replaces the window when computing an opening balance.

    private function expenses(string $tenantId, ?string $branchId, ?string $from, ?string $to, ?string $strictlyBefore = null): Builder
    {
        $q = DB::table('expenses')
            ->leftJoin('expense_categories', 'expenses.expense_category_id', '=', 'expense_categories.id')
            ->whereNull('expenses.deleted_at')
            ->where('expenses.tenant_id', $tenantId)
            ->when($branchId, fn ($q) => $q->where('expenses.branch_id', $branchId))
            ->selectRaw(
                "expenses.id as id, 'expense' as type, DATE(expenses.expense_date) as entry_date,"
                .' expenses.created_at as sort_at, expenses.reference as reference,'
                .' expenses.description as description, expense_categories.name as category,'
                .' expenses.expense_category_id as category_id, expenses.payment_method as method,'
                .' 0 as amount_in, expenses.amount as amount_out',
            );

        return $this->window($q, 'expenses.expense_date', $from, $to, $strictlyBefore);
    }

    private function incomes(string $tenantId, ?string $branchId, ?string $from, ?string $to, ?string $strictlyBefore = null): Builder
    {
        $q = DB::table('incomes')
            ->leftJoin('income_categories', 'incomes.income_category_id', '=', 'income_categories.id')
            ->whereNull('incomes.deleted_at')
            ->where('incomes.tenant_id', $tenantId)
            ->when($branchId, fn ($q) => $q->where('incomes.branch_id', $branchId))
            ->selectRaw(
                "incomes.id as id, 'income' as type, DATE(incomes.income_date) as entry_date,"
                .' incomes.created_at as sort_at, incomes.reference as reference,'
                .' incomes.description as description, income_categories.name as category,'
                .' incomes.income_category_id as category_id, incomes.payment_method as method,'
                .' incomes.amount as amount_in, 0 as amount_out',
            );

        return $this->window($q, 'incomes.income_date', $from, $to, $strictlyBefore);
    }

    private function sales(string $tenantId, ?string $branchId, ?string $from, ?string $to, ?string $strictlyBefore = null): Builder
    {
        // A refunded sale still brought its money in on the day; the refund is
        // its own row later. Only a CANCELLED sale never happened.
        $live = [SaleStatus::Completed->value, SaleStatus::PartiallyRefunded->value, SaleStatus::Refunded->value];

        $q = DB::table('sales')
            ->whereNull('sales.deleted_at')
            ->where('sales.tenant_id', $tenantId)
            // A query builder does not go through Eloquent, so the model's
            // not_training scope never runs here. This is the only raw read of
            // the sales table, and it has to fence practice out by hand.
            ->where('sales.is_training', false)
            ->whereIn('sales.status', $live)
            ->when($branchId, fn ($q) => $q->where('sales.branch_id', $branchId))
            ->selectRaw(
                "sales.id as id, 'sale' as type, DATE(sales.sold_at) as entry_date,"
                .' sales.sold_at as sort_at, sales.invoice_number as reference,'
                ."  COALESCE(sales.customer_name, 'Counter sale') as description, 'Sales' as category,"
                .' NULL as category_id, sales.payment_method as method,'
                .' sales.total as amount_in, 0 as amount_out',
            );

        return $this->window($q, 'sales.sold_at', $from, $to, $strictlyBefore, true);
    }

    private function refunds(string $tenantId, ?string $from, ?string $to, ?string $strictlyBefore = null): Builder
    {
        $q = DB::table('sale_returns')
            ->where('sale_returns.tenant_id', $tenantId)
            ->selectRaw(
                "sale_returns.id as id, 'refund' as type, DATE(sale_returns.returned_at) as entry_date,"
                .' sale_returns.returned_at as sort_at, sale_returns.return_number as reference,'
                ."  COALESCE(sale_returns.reason, 'Refund') as description, 'Refunds' as category,"
                .' NULL as category_id, sale_returns.refund_method as method,'
                .' 0 as amount_in, sale_returns.refund_total as amount_out',
            );

        return $this->window($q, 'sale_returns.returned_at', $from, $to, $strictlyBefore, true);
    }

    /**
     * Bound a source to the period — or, for an opening balance, to everything
     * strictly before it.
     */
    private function window(Builder $q, string $column, ?string $from, ?string $to, ?string $before, bool $isDateTime = false): Builder
    {
        if ($before !== null) {
            return $isDateTime
                ? $q->where($column, '<', $before.' 00:00:00')
                : $q->whereDate($column, '<', $before);
        }

        if ($from !== null) {
            $isDateTime ? $q->where($column, '>=', $from.' 00:00:00') : $q->whereDate($column, '>=', $from);
        }

        if ($to !== null) {
            $isDateTime ? $q->where($column, '<=', $to.' 23:59:59') : $q->whereDate($column, '<=', $to);
        }

        return $q;
    }

    /** @return list<string> */
    private function list(Request $request, string $key): array
    {
        $raw = $request->query($key);

        if ($raw === null || $raw === '') {
            return [];
        }

        $values = is_array($raw) ? $raw : explode(',', (string) $raw);

        return array_values(array_filter(
            array_map(fn ($v): string => trim((string) $v), $values),
            fn (string $v): bool => $v !== '',
        ));
    }
}
