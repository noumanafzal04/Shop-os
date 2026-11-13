#!/bin/sh
# SERVE THE BACKEND TO A PHONE ON THIS WI-FI — for a "lan" test build of the app.
#
# Finds this computer's address on whatever Wi-Fi it is on right now, so a new
# network or a restart needs nothing edited: run this again and the app on the
# phone finds the server by itself (or type the address printed below).
#
# Port 8002 — not 8000 (the computer's own dev server, which listens only to
# itself) and not 8001. APP_URL is set to the Wi-Fi address so picture links
# point somewhere the phone can reach. Ctrl+C stops it.
set -e
PORT="${PORT:-8002}"
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')"
if [ -z "$IP" ]; then
  echo "No Wi-Fi address found — is this computer on a Wi-Fi network?" >&2
  exit 1
fi
# From public/, as `php artisan serve` does: Laravel's router file finds the
# app by the folder it is started in.
cd "$(dirname "$0")/../public"
echo ""
echo "  Backend for the phone:  $IP:$PORT"
echo "  Open the test app on the same Wi-Fi; it finds this by itself."
echo "  If it asks, type:       $IP:$PORT"
echo ""
APP_URL="http://$IP:$PORT" PHP_CLI_SERVER_WORKERS="${WORKERS:-4}" \
  exec php -S "0.0.0.0:$PORT" ../vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php
