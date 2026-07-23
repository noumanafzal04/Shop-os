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
        $roles = match ($audience) {
            'customers' => [UserRole::Customer],
            'all' => [UserRole::ShopOwner, UserRole::Customer],
            default => [UserRole::ShopOwner], // tenants
        };

        return User::query()->whereIn('role', $roles);
    }
}
