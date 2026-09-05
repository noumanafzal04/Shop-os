<?php

namespace App\Services;

use App\Models\DeviceToken;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * A push, to every device a user has registered.
 *
 * ── Why this was rewritten ───────────────────────────────────────────
 *
 * It spoke the LEGACY FCM API — `POST /fcm/send` with an
 * `Authorization: key=…` server key. Google turned that endpoint off in July
 * 2024. The code carried a note saying "swap for HTTP v1/OAuth in production",
 * and a note is not a swap: every push this product sent after that date was a
 * request to a dead URL, failing silently behind a queued job nobody watched.
 *
 * ── HTTP v1, and what it costs ───────────────────────────────────────
 *
 * v1 authenticates with an OAuth2 access token minted from a SERVICE ACCOUNT
 * rather than a static key, which is the whole reason the old one had to go:
 * a leaked server key could send as you forever, and an access token dies in
 * an hour.
 *
 * Getting one means signing a JWT with the service account's private key and
 * exchanging it at Google's token endpoint. That is two extra network calls per
 * push if done naively, so the token is CACHED for slightly less than its own
 * lifetime — the margin matters, because a token that expires in flight is a
 * 401 on a notification nobody sees fail.
 *
 * v1 also sends to ONE token per request. There is no `registration_ids` array
 * any more. A user with three devices is three calls, and a dead token is
 * reported per call rather than positionally in a results array.
 *
 * ── Without credentials ──────────────────────────────────────────────
 *
 * No service account configured → dev log mode, exactly as before. That is not
 * a fallback to the legacy API: there is nothing to fall back to.
 */
class FcmSender
{
    private const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

    private const TOKEN_URL = 'https://oauth2.googleapis.com/token';

    /**
     * Google issues access tokens with a one-hour life. Cached for fifty-five
     * minutes: a token that expires between being read from the cache and
     * arriving at Google is a 401 on a push, and the five minutes are cheaper
     * than the retry.
     */
    private const TOKEN_CACHE_SECONDS = 3300;

    private const TOKEN_CACHE_KEY = 'fcm.v1.access_token';

    public function sendToUser(string $userId, string $title, string $body, array $data = []): void
    {
        $tokens = DeviceToken::query()->where('user_id', $userId)->pluck('token')->all();
        if ($tokens === []) {
            return; // no devices — the in-app copy is already stored
        }

        // FCM `data` values must be strings, so the payload is flattened.
        $stringData = collect($data)
            ->map(fn ($v) => is_scalar($v) || $v === null ? (string) $v : json_encode($v))
            ->all();

        $credentials = $this->credentials();

        if ($credentials === null) {
            Log::info('notification.push (dev — no FCM service account)', [
                'devices' => count($tokens), 'title' => $title, 'link' => $data['link'] ?? null,
            ]);

            return;
        }

        $accessToken = $this->accessToken($credentials);
        if ($accessToken === null) {
            // Already logged. A push that cannot be authorised is not a reason
            // to fail the job that raised it — the in-app notification stands.
            return;
        }

        $endpoint = sprintf(
            'https://fcm.googleapis.com/v1/projects/%s/messages:send',
            $credentials['project_id'],
        );

        foreach ($tokens as $token) {
            $response = Http::withToken($accessToken)
                ->post($endpoint, [
                    'message' => [
                        'token' => $token,
                        'notification' => ['title' => $title, 'body' => $body],
                        'data' => $stringData,
                        // Android needs the channel named here or the
                        // notification arrives silent on 8.0 and later.
                        'android' => [
                            'priority' => 'high',
                            'notification' => ['channel_id' => config('services.fcm.channel', 'default')],
                        ],
                        'apns' => [
                            'payload' => ['aps' => ['sound' => 'default']],
                        ],
                    ],
                ]);

            $this->pruneIfDead($token, $response->status(), $response->json() ?? []);
        }
    }

    /**
     * The service account, or null.
     *
     * Read from a JSON file rather than a pile of env vars, because that is the
     * shape Google hands it over in and re-typing a PEM private key into an
     * `.env` is how newlines get mangled. The path is configured; the file
     * itself must NEVER be committed.
     */
    private function credentials(): ?array
    {
        $inline = config('services.fcm.credentials');

        $json = match (true) {
            // A raw JSON blob in the environment — what a container platform
            // with no file mount can offer.
            is_string($inline) && str_starts_with(trim($inline), '{') => $inline,
            is_string($inline) && $inline !== '' && is_file($inline) => file_get_contents($inline),
            is_string($inline) && $inline !== '' && Storage::disk('local')->exists($inline) => Storage::disk('local')->get($inline),
            default => null,
        };

        if ($json === null || $json === false) {
            return null;
        }

        $parsed = json_decode($json, true);

        if (! is_array($parsed) || ! isset($parsed['project_id'], $parsed['client_email'], $parsed['private_key'])) {
            Log::warning('fcm.credentials.invalid', [
                'reason' => 'service account JSON is missing project_id, client_email or private_key',
            ]);

            return null;
        }

        return $parsed;
    }

    /**
     * A bearer token for the Firebase Messaging scope.
     *
     * The JWT is assembled and signed by hand — `openssl_sign` with RS256 —
     * rather than pulling in Google's SDK for one grant. It is forty lines and
     * no dependency, and this is the only place in the product that needs it.
     */
    private function accessToken(array $credentials): ?string
    {
        $cached = Cache::get(self::TOKEN_CACHE_KEY);
        if (is_string($cached) && $cached !== '') {
            return $cached;
        }

        $now = time();
        $claims = [
            'iss' => $credentials['client_email'],
            'scope' => self::SCOPE,
            'aud' => self::TOKEN_URL,
            'iat' => $now,
            'exp' => $now + 3600,
        ];

        $signingInput = self::base64Url(json_encode(['alg' => 'RS256', 'typ' => 'JWT']))
            .'.'.self::base64Url(json_encode($claims));

        $signature = '';
        $key = openssl_pkey_get_private($credentials['private_key']);

        if ($key === false || ! openssl_sign($signingInput, $signature, $key, OPENSSL_ALGO_SHA256)) {
            Log::error('fcm.jwt.sign_failed', ['error' => openssl_error_string() ?: 'unknown']);

            return null;
        }

        $assertion = $signingInput.'.'.self::base64Url($signature);

        $response = Http::asForm()->post(self::TOKEN_URL, [
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion' => $assertion,
        ]);

        $token = $response->json('access_token');

        if (! $response->successful() || ! is_string($token)) {
            Log::error('fcm.token.failed', [
                'status' => $response->status(),
                'error' => $response->json('error_description') ?? $response->json('error'),
            ]);

            return null;
        }

        Cache::put(self::TOKEN_CACHE_KEY, $token, self::TOKEN_CACHE_SECONDS);

        return $token;
    }

    /**
     * Drop a token Google says is gone.
     *
     * v1 answers per request, so there is no results array to index into — and
     * that is an improvement: the old positional matching silently deleted the
     * WRONG token whenever the response array was shorter than the request's.
     *
     * Only these two mean "this device will never receive again". A 500 from
     * Google, a rate limit or a network blip must not cost somebody their
     * notifications, so everything else is left alone.
     */
    private function pruneIfDead(string $token, int $status, array $payload): void
    {
        $reason = $payload['error']['details'][0]['errorCode']
            ?? $payload['error']['status']
            ?? null;

        $gone = $status === 404
            || in_array($reason, ['UNREGISTERED', 'INVALID_ARGUMENT', 'NOT_FOUND'], true);

        if ($gone) {
            DeviceToken::query()->where('token', $token)->delete();

            return;
        }

        if ($status >= 400) {
            Log::warning('fcm.send.failed', [
                'status' => $status,
                'reason' => $reason ?? ($payload['error']['message'] ?? null),
            ]);
        }
    }

    private static function base64Url(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }
}
