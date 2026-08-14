<?php

namespace App\Support;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Collection;

/**
 * Cursor paging over "what changed since", for anything a till holds.
 *
 * Pulled out of the controller because the till caches five different things —
 * products, categories, promotions, tax groups, customers — and every one of
 * them needs the same three properties. Written once, they are right once.
 *
 * ── The cursor is `updated_at|id`, and both halves are load-bearing ──────
 *
 * `timestamps()` stores ONE-SECOND resolution. A CSV import lands thousands of
 * rows on a single tick, so a cursor of time alone either replays that second
 * forever or steps over everything left in it. The id makes the ordering total.
 *
 * The moment is formatted with the MODEL's own date format rather than a
 * literal. A cursor carrying microseconds against a column that holds seconds
 * compares differently DEPENDING ON THE DRIVER — MySQL coerces both sides to
 * DATETIME and finds them equal, SQLite compares TEXT and finds the stored
 * value smaller, silently dropping every row in that second. Tests run on
 * SQLite and shops run on MySQL, which is precisely the shape of defect that
 * passes CI and fails in a shop.
 */
class PosDelta
{
    /**
     * One page of rows changed since `$cursor`, oldest first.
     *
     * The query must already carry `withTrashed()` where the model soft-deletes
     * — a removed row that never reaches the till stays sellable on it forever,
     * which is the whole reason tombstones exist.
     *
     * @return array{rows: Collection<int, Model>, cursor: ?string, has_more: bool}
     */
    public static function page(Builder $query, ?string $cursor, int $perPage): array
    {
        [$since, $sinceId] = self::decode($cursor);

        $rows = $query
            ->when($since !== null, fn (Builder $q) => $q->where(
                fn (Builder $w) => $w
                    ->where('updated_at', '>', $since)
                    ->orWhere(fn (Builder $tie) => $tie
                        ->where('updated_at', '=', $since)
                        ->where('id', '>', $sinceId)),
            ))
            ->orderBy('updated_at')
            ->orderBy('id')
            // One row past the page, purely to answer "is there more?" without
            // a second COUNT across the whole table.
            ->limit($perPage + 1)
            ->get();

        $hasMore = $rows->count() > $perPage;
        $rows = $rows->take($perPage);

        return [
            'rows' => $rows,
            // An empty page leaves the cursor exactly where it was: moving it
            // would be claiming progress that was not made.
            'cursor' => $rows->isEmpty() ? $cursor : self::encode($rows->last()),
            'has_more' => $hasMore,
        ];
    }

    /** The cursor that resumes immediately after this row. */
    public static function encode(Model $row): string
    {
        return $row->updated_at->format($row->getDateFormat()).'|'.$row->getKey();
    }

    /**
     * @return array{0: ?string, 1: ?string}
     */
    private static function decode(?string $cursor): array
    {
        if ($cursor === null || $cursor === '' || ! str_contains($cursor, '|')) {
            return [null, null];
        }

        [$at, $id] = explode('|', $cursor, 2);

        // A cursor is client-supplied. A malformed one has to read as "start
        // again from the beginning": a full resync is slow, where a crash is a
        // dead till.
        return strtotime($at) === false ? [null, null] : [$at, $id];
    }
}
