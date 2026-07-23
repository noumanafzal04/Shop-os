<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Generic HTTP SMS adapter. Config-driven:
 *   - no gateway configured → dev log mode (no external call)
 *   - configured            → POST { to, message, from } to the gateway
 *
 * Deliberately provider-agnostic — swap the request shape here for Twilio /
 * a local aggregator without touching any caller.
 */
class SmsSender
{
    public function send(string $to, string $message): void
    {
        $endpoint = config('services.sms.endpoint');
        $key = config('services.sms.key');

        if (empty($endpoint) || empty($key)) {
            Log::info('sms (dev — no gateway)', ['to' => $to, 'message' => $message]);

            return;
        }

        Http::withToken($key)->post($endpoint, [
            'to' => $to,
            'from' => config('services.sms.from'),
            'message' => $message,
        ]);
    }
}
