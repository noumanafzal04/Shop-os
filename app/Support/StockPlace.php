<?php

namespace App\Support;

use App\Exceptions\DomainException;
use App\Models\Branch;
use App\Models\User;

/**
 * WHERE A PERSON MAY MOVE STOCK.
 *
 * A staff member is pinned to the place they work at. `ResolveBranch` holds
 * them to it for everything that reads a header — but stock is also moved by
 * naming a place in the BODY: a delivery received "into the godown", a
 * transfer "from Gulberg". A body field that could name any place would let
 * the pin stop somebody reading another branch's shelf while leaving them
 * free to write to it.
 *
 * So every door that names a place asks here:
 *
 *   · the owner, and anyone holding `inventory.any_place`, may act anywhere;
 *   · everybody else may act at their own place and nowhere else.
 *
 * "Their own place" is the branch they are assigned to, and Main when they are
 * assigned to none — the same answer `ResolveBranch` gives.
 *
 * A request with nobody signed in is a seeder or a job, which has no place to
 * be pinned to and is trusted the way those paths always were.
 */
final class StockPlace
{
    public static function mayActAt(?User $user, string $branchId): bool
    {
        if ($user === null || $user->hasPermission(Permissions::INVENTORY_ANY_PLACE)) {
            return true;
        }

        return self::of($user) === $branchId;
    }

    /**
     * Refuse, naming both places — the one they asked for and the one they
     * are held to — because "not allowed" tells a stock keeper nothing about
     * what they could do instead.
     *
     * @param  string  $doing  what was being tried, e.g. "send stock from"
     */
    public static function mustActAt(?User $user, string $branchId, string $doing): void
    {
        if (self::mayActAt($user, $branchId)) {
            return;
        }

        $names = Branch::withoutTenancy()
            ->whereIn('id', array_filter([$branchId, self::of($user)]))
            ->pluck('name', 'id');
        $asked = $names[$branchId] ?? 'that place';
        $mine = $names[self::of($user)] ?? 'your own place';

        throw DomainException::forbidden(
            "You work at {$mine}, so you cannot {$doing} {$asked}. Ask the owner, or somebody who works there.",
            'NOT_YOUR_PLACE',
        );
    }

    /** The place a pinned person is held to. */
    public static function of(?User $user): ?string
    {
        if ($user === null) {
            return null;
        }

        return $user->branch_id ?? Branch::withoutTenancy()
            ->where('tenant_id', $user->tenant_id)
            ->where('is_default', true)
            ->value('id');
    }
}
