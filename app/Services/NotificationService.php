<?php

namespace App\Services;

use App\Enums\UserRole;
use App\Jobs\SendChannelNotification;
use App\Models\AppNotification;
use App\Models\Tenant;
use App\Models\User;
use App\Support\DeepLinks;
use Illuminate\Database\QueryException;
use Illuminate\Support\Collection;

/**
 * Single entry-point for notifying anyone about anything.
 *
 * Dedupe: pass a dedupe_key for events that may fire repeatedly (retries,
 * repeated threshold crossings) — the same key never notifies twice.
 * External channels (push/sms/email) are queued with retry/backoff and
 * dispatched only after the surrounding DB transaction commits.
 */
class NotificationService
{
    public const CHANNELS = ['push']; // sms/email opt-in per type later

    public function notify(
        User $user,
        string $type,
        string $title,
        string $body,
        array $data = [],
        ?string $dedupeKey = null,
    ): ?AppNotification {
        if ($dedupeKey !== null) {
            $exists = AppNotification::query()
                ->where('user_id', $user->id)
                ->where('dedupe_key', $dedupeKey)
                ->exists();

            if ($exists) {
                return null; // already told them — retries never double-notify
            }
        }

        // Attach a deep-link route (unless the caller set one) so a push-tap
        // lands on the right screen.
        $data['link'] ??= DeepLinks::routeFor($type, $data);

        try {
            $notification = AppNotification::query()->create([
                'user_id' => $user->id,
                'tenant_id' => $user->tenant_id,
                'type' => $type,
                'title' => $title,
                'body' => $body,
                'data' => $data,
                'dedupe_key' => $dedupeKey,
            ]);
        } catch (QueryException $e) {
            // Concurrent duplicate hit the unique(user_id, dedupe_key) index.
            return null;
        }

        foreach (self::CHANNELS as $channel) {
            SendChannelNotification::dispatch($notification->id, $channel)->afterCommit();
        }

        return $notification;
    }

    /**
     * EVERYONE WHO CAN ACT ON IT — which is not the same as everyone who owns
     * the shop.
     *
     * Every operational notification this system sends went to owners and to
     * nobody else. A shop's stock keeper was never told a shelf had run down; a
     * cashier standing at the counter was never told an order had come in. The
     * bell renders for every signed-in role and `/notifications` sits behind no
     * role gate, so there was a bell in front of them the whole time and
     * nothing that could ever be put in it.
     *
     * ── Why permission, and not role ────────────────────────────────────
     *
     * Because there are no job roles here. Cashier, waiter, stock keeper and
     * kitchen are permission SETS a shop assembles, and adding a `notify the
     * cashier` would be reintroducing exactly the concept this codebase spent a
     * release removing.
     *
     * It also settles the question that was raised and deliberately left open —
     * *should a cashier hear about low stock?* **The permission IS the
     * setting.** A shop that does not want its counter staff chasing stock does
     * not give them `inventory.manage`; a shop that does has said, in the only
     * place the system can hear it, that those are the people who deal with it.
     * A separate switch would be a second answer to a question already
     * answered, and the two would drift.
     *
     * Owners hold every permission implicitly, so they keep receiving
     * everything they received before. Nothing is taken away from anybody.
     *
     * ── `$atBranch` ─────────────────────────────────────────────────────
     *
     * For events that belong to one shop in a chain. An order is filled by the
     * nearest branch holding the basket, and telling five branches about an
     * order one of them is packing is how a shop learns to ignore the bell.
     *
     * Staff with NO branch recorded are included rather than excluded. An
     * over-notification makes somebody ask a question; an under-notification
     * makes nobody ask anything, and rows written before staff carried a branch
     * would otherwise go quiet without a word.
     */
    public function notifyWhoCanAct(
        Tenant|string $tenant,
        string $permission,
        string $type,
        string $title,
        string $body,
        array $data = [],
        ?string $dedupeKey = null,
        ?string $atBranch = null,
    ): Collection {
        $tenantId = $tenant instanceof Tenant ? $tenant->id : $tenant;

        return User::query()
            ->where('tenant_id', $tenantId)
            // Customers of the shop are not staff of it, and `hasPermission`
            // would refuse them anyway — this keeps a marketplace tenant's
            // customer list out of the query in the first place.
            ->whereIn('role', [UserRole::ShopOwner, UserRole::Staff])
            ->get()
            ->filter(fn (User $u): bool => $u->hasPermission($permission))
            ->filter(fn (User $u): bool => $atBranch === null
                || $u->role === UserRole::ShopOwner
                || $u->branch_id === null
                || $u->branch_id === $atBranch)
            ->values()
            ->map(fn (User $u) => $this->notify(
                $u, $type, $title, $body, $data,
                // Suffixed per recipient, and NOT because dedupe needs it —
                // `app_notifications` is unique on (user_id, dedupe_key), so
                // two people already get their own rows for one shared key.
                // Mutation proved that: removing this suffix changed nothing.
                //
                // It stays for continuity. Every row written so far carries the
                // suffixed form, and dropping it would make one already-sent
                // alert look new and fire a second time on the day it shipped.
                $dedupeKey !== null ? "{$dedupeKey}:{$u->id}" : null,
            ));
    }
}
