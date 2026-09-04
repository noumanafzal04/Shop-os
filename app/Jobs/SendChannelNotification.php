<?php

namespace App\Jobs;

use App\Models\AppNotification;
use App\Models\User;
use App\Services\EmailSender;
use App\Services\FcmSender;
use App\Services\SmsSender;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

/**
 * Delivers one notification over one external channel (push/sms/email).
 *
 * Edge cases:
 *  - provider outage  → 3 tries with growing backoff, then failed_jobs
 *                        (visible in Horizon later); the in-app copy is
 *                        already stored so nothing is lost
 *  - duplicate sends  → the parent notification is deduped BEFORE any job
 *                        is dispatched, so retries never double-notify
 *
 * Providers are stubs (log driver) — FCM / SMS gateway / SMTP slot in here
 * without touching any caller.
 */
class SendChannelNotification implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    /** @var int[] seconds: 10s, 1m, 5m */
    public array $backoff = [10, 60, 300];

    public function __construct(
        public readonly string $notificationId,
        public readonly string $channel, // push | sms | email
    ) {}

    public function handle(FcmSender $fcm, SmsSender $sms, EmailSender $email): void
    {
        $notification = AppNotification::query()->find($this->notificationId);

        if ($notification === null) {
            return; // deleted meanwhile — nothing to deliver
        }

        // Push → FCM (carries type + deep-link so a tap opens the right screen).
        if ($this->channel === 'push') {
            $fcm->sendToUser(
                $notification->user_id,
                $notification->title,
                $notification->body,
                array_merge(['type' => $notification->type], $notification->data ?? []),
            );

            return;
        }

        // SMS / Email → the recipient's phone / email (skip if they have none).
        $user = User::query()->find($notification->user_id);
        if ($user === null) {
            return;
        }

        if ($this->channel === 'sms' && $user->phone) {
            $sms->send($user->phone, "{$notification->title}: {$notification->body}");
        } elseif ($this->channel === 'email' && $user->email) {
            $email->send($user->email, $notification->title, $notification->body);
        } else {
            Log::info("notification.{$this->channel}.skipped", ['to' => $user->id]);
        }
    }
}
