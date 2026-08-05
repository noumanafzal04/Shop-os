<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Till PINs — a short credential for the counter, and only for the counter.
 *
 * A shared terminal is the weak point in every shop's audit trail: whoever
 * signed in this morning is who every sale, void and drawer count belongs to
 * for the rest of the day. Typing an email and password between customers is
 * not something a counter will ever do, so the practical fix is a 4–6 digit
 * PIN — but a PIN is far too weak to be a login.
 *
 * It is scoped so that weakness doesn't matter:
 *   - a PIN is only accepted at the POS switch endpoint, never at /auth/login;
 *   - that endpoint requires an already-authenticated session for the SAME
 *     tenant, so a PIN is unreachable from the open internet — it swaps who is
 *     at a till that is already trusted;
 *   - failures lock the PIN on its own counter, so hammering a cashier's PIN
 *     cannot lock the owner out of the web app.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->string('pin_hash')->nullable()->after('password');
            $table->timestamp('pin_set_at')->nullable()->after('pin_hash');
            // Deliberately separate from failed_login_attempts: a PIN attacker
            // at the counter must not be able to lock a password login.
            $table->unsignedTinyInteger('pin_failed_attempts')->default(0)->after('pin_set_at');
            $table->timestamp('pin_locked_until')->nullable()->after('pin_failed_attempts');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->dropColumn(['pin_hash', 'pin_set_at', 'pin_failed_attempts', 'pin_locked_until']);
        });
    }
};
