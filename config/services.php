<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    // Push notifications. Empty key → dev log mode (no external calls).
    /**
     * Push, over FCM HTTP v1.
     *
     * `FCM_SERVER_KEY` is GONE and not deprecated-but-working: Google switched
     * the legacy endpoint off in July 2024, so a server key authenticates
     * nothing. v1 wants a SERVICE ACCOUNT.
     *
     * `credentials` accepts three shapes, in this order:
     *   an absolute path to the service-account JSON,
     *   a path inside the private disk (storage/app/private/…),
     *   or the JSON itself, for a container platform with nowhere to mount it.
     *
     * Empty → dev log mode. The file is a CREDENTIAL: it never belongs in the
     * repository, and the private disk is the right home for it because
     * nothing serves that directory.
     */
    'fcm' => [
        'credentials' => env('FCM_CREDENTIALS'),
        // The Android notification channel a push arrives on. Named here
        // because Android 8 and later drop a notification whose channel it
        // does not recognise, silently.
        'channel' => env('FCM_CHANNEL', 'default'),
    ],

    // SMS gateway (OTP + alerts). Empty → dev log mode.
    'sms' => [
        'key' => env('SMS_API_KEY'),
        'endpoint' => env('SMS_ENDPOINT'),
        'from' => env('SMS_FROM', 'CartZe'),
    ],

];
