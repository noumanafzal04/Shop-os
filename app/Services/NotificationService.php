<?php

namespace App\Services;

use App\Enums\UserRole;
use App\Jobs\SendChannelNotification;
use App\Models\AppNotification;
use App\Models\Tenant;
use App\Models\User;
use App\Support\DeepLinks;
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
        } catch (\Illuminate\Database\QueryException $e) {
            // Concurrent duplicate hit the unique(user_id, dedupe_key) index.
            return null;
        }

        foreach (self::CHANNELS as $channel) {
            SendChannelNotification::dispatch($notification->id, $channel)->afterCommit();
        }

        return $notification;
    }

    /**
     * Notify every owner of a tenant (multi-owner safe).
     */
    public function notifyTenantOwners(
        Tenant|string $tenant,
        string $type,
        string $title,
        string $body,
        array $data = [],
        ?string $dedupeKey = null,
    ): Collection {
        $tenantId = $tenant instanceof Tenant ? $tenant->id : $tenant;

        return User::query()
            ->where('tenant_id', $tenantId)
            ->where('role', UserRole::ShopOwner)
            ->get()
            ->map(fn (User $owner) => $this->notify(
                $owner, $type, $title, $body, $data,
                $dedupeKey !== null ? "{$dedupeKey}:{$owner->id}" : null,
            ));
    }
}
