<?php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * A till PIN: 4–6 digits, and not one of the handful everybody picks.
 *
 * The blocklist is short on purpose. A PIN this size can only ever resist
 * *casual* guessing — the shop assistant watching over a shoulder, the cousin
 * who knows the birthday — so the job here is to stop the PINs that get
 * guessed on the first try, not to pretend a 4-digit secret is strong. The
 * real protection is that a PIN is useless anywhere but a till that is already
 * signed in (see the add_till_pins migration).
 */
class TillPin implements ValidationRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        $pin = (string) $value;

        if (! preg_match('/^\d{4,6}$/', $pin)) {
            $fail('The PIN must be 4 to 6 digits.');

            return;
        }

        // 0000, 1111 — the first thing anyone tries.
        if (preg_match('/^(\d)\1+$/', $pin)) {
            $fail('That PIN is too easy to guess. Avoid repeating the same digit.');

            return;
        }

        // 1234, 4321, 987654 — the second thing anyone tries.
        $ascending = true;
        $descending = true;
        for ($i = 1, $len = strlen($pin); $i < $len; $i++) {
            $step = (int) $pin[$i] - (int) $pin[$i - 1];
            $ascending = $ascending && $step === 1;
            $descending = $descending && $step === -1;
        }

        if ($ascending || $descending) {
            $fail('That PIN is too easy to guess. Avoid running sequences.');
        }
    }
}
