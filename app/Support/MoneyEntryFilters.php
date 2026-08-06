<?php

namespace App\Support;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

/**
 * The filter shape shared by expenses, income and the ledger.
 *
 * A books-only business lives in these lists — it is the whole product for a
 * Finance Manager tenant — and "search by description, pick one category" is
 * not enough to answer the questions people actually bring to their books:
 * what did we spend on rent between March and June, what went out in cash
 * over Rs 50,000, show me utilities AND fuel together.
 *
 * Writing the filters once means the two lists and the ledger cannot drift
 * into supporting different questions, and an export can reuse the very query
 * the merchant is looking at rather than approximating it.
 *
 * Every filter is optional and absent means "no restriction" — never a
 * silently applied default, which is how a total ends up disagreeing with the
 * rows above it.
 */
class MoneyEntryFilters
{
    /** Sortable columns, mapped so a caller can never inject a column name. */
    private const SORTS = ['date', 'amount', 'created'];

    /**
     * @param  Builder<covariant \Illuminate\Database\Eloquent\Model>  $query
     * @param  string  $dateColumn  expense_date | income_date
     * @param  string  $categoryColumn  expense_category_id | income_category_id
     */
    public static function apply(
        Builder $query,
        Request $request,
        string $dateColumn,
        string $categoryColumn,
    ): Builder {
        $table = $query->getModel()->getTable();

        // Free text reaches everything a person would have typed when they
        // recorded it — the description, the bill number, and the note they
        // left themselves. Description-only search means a merchant hunting an
        // invoice number finds nothing and concludes the entry is missing.
        if (($search = trim((string) $request->query('search'))) !== '') {
            $query->where(function (Builder $q) use ($search, $table): void {
                $like = '%'.$search.'%';
                $q->where("{$table}.description", 'like', $like)
                    ->orWhere("{$table}.reference", 'like', $like)
                    ->orWhere("{$table}.notes", 'like', $like);
            });
        }

        // Categories and methods take a list: "utilities and fuel" is one
        // question, not two searches a person has to add up in their head.
        if (($categories = self::list($request, 'category_id')) !== []) {
            $query->whereIn("{$table}.{$categoryColumn}", $categories);
        }

        if (($methods = self::list($request, 'payment_method')) !== []) {
            $query->whereIn("{$table}.payment_method", $methods);
        }

        if (($from = $request->query('from')) !== null) {
            $query->whereDate("{$table}.{$dateColumn}", '>=', $from);
        }

        if (($to = $request->query('to')) !== null) {
            $query->whereDate("{$table}.{$dateColumn}", '<=', $to);
        }

        // "Anything big" is the question behind most reviews of a cash book.
        if (is_numeric($min = $request->query('min_amount'))) {
            $query->where("{$table}.amount", '>=', (float) $min);
        }

        if (is_numeric($max = $request->query('max_amount'))) {
            $query->where("{$table}.amount", '<=', (float) $max);
        }

        return self::sort($query, $request, $dateColumn, $table);
    }

    /**
     * Totals for the filtered set — what the rows on screen add up to, not
     * what the whole book adds up to. A page of 15 rows out of 400 with a
     * grand total underneath is a number nobody can reconcile.
     *
     * @param  Builder<covariant \Illuminate\Database\Eloquent\Model>  $query
     * @return array{count: int, total: float}
     */
    public static function totals(Builder $query): array
    {
        $scoped = (clone $query)->getQuery();
        $scoped->orders = null;

        return [
            'count' => (int) (clone $scoped)->count(),
            'total' => round((float) (clone $scoped)->sum('amount'), 2),
        ];
    }

    /**
     * A repeatable filter, sent either as `key=a&key=b` or `key=a,b`. Both
     * shapes reach the same place so neither a form nor a hand-written URL is
     * the "wrong" way to ask.
     *
     * @return list<string>
     */
    private static function list(Request $request, string $key): array
    {
        $raw = $request->query($key);

        if ($raw === null || $raw === '') {
            return [];
        }

        $values = is_array($raw) ? $raw : explode(',', (string) $raw);

        return array_values(array_filter(array_map(
            fn ($v): string => trim((string) $v),
            $values,
        ), fn (string $v): bool => $v !== ''));
    }

    /**
     * @param  Builder<covariant \Illuminate\Database\Eloquent\Model>  $query
     * @return Builder<covariant \Illuminate\Database\Eloquent\Model>
     */
    private static function sort(Builder $query, Request $request, string $dateColumn, string $table): Builder
    {
        $sort = (string) $request->query('sort', 'date');
        $sort = in_array($sort, self::SORTS, true) ? $sort : 'date';
        $direction = strtolower((string) $request->query('dir', 'desc')) === 'asc' ? 'asc' : 'desc';

        $column = match ($sort) {
            'amount' => "{$table}.amount",
            'created' => "{$table}.created_at",
            default => "{$table}.{$dateColumn}",
        };

        $query->orderBy($column, $direction);

        // Same-day entries need a stable second key or paging repeats and
        // skips rows between requests.
        if ($sort !== 'created') {
            $query->orderByDesc("{$table}.created_at");
        }

        return $query;
    }
}
