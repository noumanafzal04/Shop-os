<?php

/*
| The platform's own super admins — the people who run the platform itself.
|
| Read from .env and nowhere else: this repository is public, so an address
| or a password written in a file here is written for everybody. Set these on
| the server only, run `php artisan db:seed --class=SuperAdminSeeder --force`,
| then take the PASSWORD lines out of .env again and re-run `config:cache`.
|
| Each account is made ONCE. A seed never writes a password back onto an
| account that already exists, so a password changed after the first sign-in
| stays changed.
*/

return [
    'super_admins' => [
        [
            'name' => env('SUPER_ADMIN_NAME', 'Super Admin'),
            'email' => env('SUPER_ADMIN_EMAIL'),
            'password' => env('SUPER_ADMIN_PASSWORD'),
        ],
        [
            'name' => env('SUPER_ADMIN_2_NAME', 'Platform Admin'),
            'email' => env('SUPER_ADMIN_2_EMAIL'),
            'password' => env('SUPER_ADMIN_2_PASSWORD'),
        ],
    ],
];
