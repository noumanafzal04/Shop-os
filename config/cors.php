<?php

/*
|--------------------------------------------------------------------------
| Cross-Origin Resource Sharing (CORS)
|--------------------------------------------------------------------------
|
| The framework's defaults, published for one reason: exposed_headers. The
| panel is served from a different origin than the API, and a browser hides
| every response header a server does not explicitly expose — including the
| ones the receipt endpoint answers with. Without this the till could render
| a receipt but never learn which print row it was, so a failed print could
| not be reported against anything.
|
*/

return [

    'paths' => ['api/*', 'sanctum/csrf-cookie'],

    'allowed_methods' => ['*'],

    /*
     * Which sites the browser may call this API from.
     *
     * `*` is right for local work — the panel, the mobile bundler and a device
     * on the LAN all hit it from different origins. It is wrong for a live box,
     * where it invites any page on the internet to script requests against the
     * API from a logged-in merchant's browser. Set CORS_ALLOWED_ORIGINS to the
     * panel's own origin(s), comma-separated, before this takes real money —
     * `php artisan shopos:readiness` fails if it is still `*` in production.
     */
    'allowed_origins' => array_values(array_filter(array_map(
        'trim',
        explode(',', (string) env('CORS_ALLOWED_ORIGINS', '*')),
    ))) ?: ['*'],

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['*'],

    'exposed_headers' => ['X-Receipt-Print-Id', 'X-Receipt-Kind', 'X-Receipt-Paper'],

    'max_age' => 0,

    'supports_credentials' => false,

];
