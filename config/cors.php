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

    'allowed_origins' => ['*'],

    'allowed_origins_patterns' => [],

    'allowed_headers' => ['*'],

    'exposed_headers' => ['X-Receipt-Print-Id', 'X-Receipt-Kind'],

    'max_age' => 0,

    'supports_credentials' => false,

];
