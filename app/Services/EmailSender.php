<?php

namespace App\Services;

use Illuminate\Support\Facades\Mail;

/**
 * Thin wrapper over Laravel Mail. Uses whatever mailer is configured:
 * the `log` driver in local dev (writes to the log), real SMTP/SES in
 * production via MAIL_* env — no code change needed to go live.
 */
class EmailSender
{
    public function send(string $to, string $subject, string $body): void
    {
        Mail::raw($body, function ($message) use ($to, $subject): void {
            $message->to($to)->subject($subject);
        });
    }
}
