<?php

namespace App\Services;

use App\Models\DeviceToken;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Sends a push to every device a user has registered. Config-driven:
 *   - no FCM key   → dev log mode (no external call)
 *   - key present  → POST to FCM (legacy HTTP shown; swap for HTTP v1/OAuth
 *                    in production)
 *
 * FCM `data` values must be strings, so the payload is flattened. Tokens FCM
 * reports dead are pruned so they don't linger.
 */
class FcmSender
{
    public function sendToUser(string $userId, string $title, string $body, array $data = []): void
    {
        $tokens = DeviceToken::query()->where('user_id', $userId)->pluck('token')->all();
        if (empty($tokens)) {
            return; // no devices — the in-app copy is already stored
        }

        $stringData = collect($data)
            ->map(fn ($v) => is_scalar($v) || $v === null ? (string) $v : json_encode($v))
            ->all();

        $key = config('services.fcm.key');
        if (empty($key)) {
            Log::info('notification.push (dev — no FCM key)', [
                'devices' => count($tokens), 'title' => $title, 'link' => $data['link'] ?? null,
            ]);

            return;
        }

        $response = Http::withHeaders(['Authorization' => "key={$key}"])
            ->post(config('services.fcm.endpoint'), [
                'registration_ids' => $tokens,
                'notification' => ['title' => $title, 'body' => $body],
                'data' => $stringData,
            ]);

        $this->pruneInvalid($tokens, $response->json('results') ?? []);
    }

    /** Remove tokens FCM reports as no longer valid. */
    private function pruneInvalid(array $tokens, array $results): void
    {
        foreach ($results as $i => $result) {
            $error = $result['error'] ?? null;
            if (in_array($error, ['NotRegistered', 'InvalidRegistration'], true) && isset($tokens[$i])) {
                DeviceToken::query()->where('token', $tokens[$i])->delete();
            }
        }
    }
}
