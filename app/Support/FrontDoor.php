<?php

namespace App\Support;

/**
 * Where the panel is.
 *
 * The API and the panel are two addresses, and the API was never told the
 * other one: nothing it did needed it. Somebody typing the API's address into
 * a browser does — see `routes/web.php`.
 */
final class FrontDoor
{
    /** The panel's address, when this install was told it or can tell. */
    public static function panel(): ?string
    {
        $said = trim((string) config('app.panel_url'));
        if ($said !== '') {
            return rtrim($said, '/');
        }

        // CORS already names it: the origin a browser may call this API from
        // IS the panel's. A live box has to set that anyway, and should not
        // have to type the same address twice.
        foreach ((array) config('cors.allowed_origins', []) as $origin) {
            if (is_string($origin) && str_starts_with($origin, 'http')) {
                return rtrim($origin, '/');
            }
        }

        return null;
    }

    /** The panel, for a visitor standing at `$host` — null when that IS the panel. */
    public static function panelFrom(string $host): ?string
    {
        $panel = self::panel();

        return $panel !== null && parse_url($panel, PHP_URL_HOST) !== $host ? $panel : null;
    }
}
