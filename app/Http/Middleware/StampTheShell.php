<?php

namespace App\Http\Middleware;

use App\Models\Tenant;
use App\Models\User;
use App\Support\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * EVERY ANSWER SAYS WHETHER THE SHELL'S ANSWERS STILL STAND.
 *
 * The panel keeps a handful of answers on the device so that opening a screen
 * does not ask for them again: who am I and what does my shop have, the
 * shop's settings, its branches. That is right for as long as nothing has
 * changed — and it has no way to know when something has, if the change was
 * made somewhere else. An admin switches Delivery on for a shop and says
 * "refresh the page"; the owner refreshes, and the page opens from what the
 * device kept five minutes ago.
 *
 * So every authenticated answer carries a short stamp of what those kept
 * answers are made from. A device compares it with the one it last saw; when
 * they differ it asks for the kept answers again, and not otherwise. A change
 * made anywhere reaches a device with the very next thing it asks — which a
 * reload always does — and costs nothing when nothing changed.
 *
 * ── What it is made of, and why it asks the database nothing ────────────
 *
 * Two timestamps, both on rows this request has already read:
 *
 *   the shop's row     modules, limits, settings, plan, status, name, logo —
 *                      every one a column on it. A branch is not, and its
 *                      plan's own terms are not, so both TOUCH the shop when
 *                      they change (`Branch::$touches`, `Plan::booted`).
 *   the person's row   name, permissions, the branch they are pinned to.
 *
 * It is read AFTER the request has run, from the models the request used, so
 * it is a header and never a query. A request that had no reason to load the
 * shop carries no stamp at all rather than fetch one: a missing stamp tells a
 * device nothing, and it goes on trusting what it has.
 *
 * ── What it is not ──────────────────────────────────────────────────────
 *
 * It is not a version of the shop's DATA. A sale, a product, a customer move
 * nothing here — those are asked for by the screens that show them. It says
 * one thing: the few answers a device keeps for the shell are, or are not,
 * still the ones it would get.
 *
 * Two changes inside one second share a stamp, because the timestamps are
 * whole seconds. A device that heard the first and missed the second is put
 * right when its kept answers reach the end of the time they are trusted for
 * — minutes, as before this existed.
 */
class StampTheShell
{
    public const HEADER = 'X-Shell-Stamp';

    public function __construct(private readonly TenantContext $context) {}

    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        $user = $request->user();
        if (! $user instanceof User) {
            return $response;
        }

        $stamp = self::of($user, $this->shopOf($user));
        if ($stamp !== null) {
            $response->headers->set(self::HEADER, $stamp);
        }

        return $response;
    }

    /**
     * The stamp for one person, given the shop row if this request has it.
     *
     * Null when the person belongs to a shop and the request never loaded it:
     * half a stamp would differ from the whole one on the next request, and a
     * device would read that as a change every time the two alternated.
     */
    public static function of(User $user, ?Tenant $shop): ?string
    {
        if ($user->tenant_id !== null && $shop === null) {
            return null;
        }

        return substr(md5(implode('|', [
            $user->getKey(),
            $user->updated_at?->getTimestamp(),
            $shop?->getKey(),
            $shop?->updated_at?->getTimestamp(),
        ])), 0, 16);
    }

    /** The shop row this request already holds for this person — never fetched for the stamp. */
    private function shopOf(User $user): ?Tenant
    {
        if ($user->tenant_id === null) {
            return null;
        }

        // The context outlives a request in a long-running worker and in a
        // test that makes two calls, so it is believed only when it is THIS
        // person's shop.
        $held = $this->context->get();
        if ($held !== null && $held->getKey() === $user->tenant_id) {
            return $held;
        }

        return $user->relationLoaded('tenant') ? $user->tenant : null;
    }
}
