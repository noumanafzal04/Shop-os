<?php

namespace App\Actions\Announcements;

use App\Enums\UserRole;
use App\Models\Announcement;
use App\Models\User;
use App\Services\NotificationService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Fan an announcement out to its audience: one notification per recipient,
 * pushed through the shared NotificationService (→ FCM). Chunked so a large
 * customer base doesn't load every user into memory at once. A per-recipient
 * dedupe key makes re-sending idempotent (a recipient is never told twice).
 */
class SendAnnouncement
{
    public function __construct(private readonly NotificationService $notifications) {}

    public function execute(Announcement $announcement): Announcement
    {
        $data = ['announcement_id' => $announcement->id];
        if ($announcement->link) {
            $data['link'] = $announcement->link;
        }
        if ($announcement->image_url) {
            $data['image_url'] = $announcement->image_url;
        }

        $count = 0;
        $this->recipients($announcement->audience)
            ->chunkById(500, function ($users) use ($announcement, $data, &$count): void {
                foreach ($users as $user) {
                    $sent = $this->notifications->notify(
                        $user,
                        'announcement',
                        $announcement->title,
                        $announcement->body,
                        $data,
                        "announcement:{$announcement->id}:{$user->id}",
                    );

                    if ($sent !== null) {
                        $count++;
                    }
                }
            });

        DB::transaction(function () use ($announcement, $count): void {
            $announcement->update([
                'is_published' => true,
                'published_at' => $announcement->published_at ?? now(),
                'recipients_count' => $announcement->recipients_count + $count,
            ]);
        });

        return $announcement->refresh();
    }

    /**
     * @return Builder<User>
     */
    private function recipients(string $audience): Builder
    {
        /**
         * "Everyone" has to mean everyone.
         *
         * `all` is labelled **"Everyone"** on the admin's own dropdown, and it
         * resolved to owners and customers — leaving out `Staff` entirely. So
         * "Scheduled maintenance Sunday 2am, the till will be offline" reached
         * every shop OWNER and not one of the cashiers who would be standing at
         * that till on Sunday. The people the message is actually about were the
         * only role it could not reach.
         *
         * Staff are addressable, which is what makes this a bug rather than a
         * missing feature: `/notifications` is behind no role gate, and the bell
         * renders for every signed-in role. There was a bell, and nothing could
         * ever be put in it.
         *
         * `tenants` is deliberately LEFT as owners-only. It is labelled "Shop
         * owners" (it used to say "All shops", which was the same class of lie
         * this fixes), and keeping it narrow is what preserves the admin's
         * ability to write to owners alone — billing, plan changes, anything a
         * cashier has no part in. Widening both would have fixed one label by
         * removing a capability.
         */
        $roles = match ($audience) {
            'customers' => [UserRole::Customer],
            'all' => [UserRole::ShopOwner, UserRole::Staff, UserRole::Customer],
            default => [UserRole::ShopOwner], // tenants — owners only, on purpose
        };

        return User::query()->whereIn('role', $roles);
    }
}
