<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Re-hiring somebody you removed.
 *
 * The validation has always said a removed person's email is free again —
 * `Rule::unique('users', 'email')->whereNull('deleted_at')` — and the DATABASE
 * has always disagreed, with a plain unique index that counts trashed rows.
 *
 * So the app accepted the form, the insert hit a 1062, and the shop got a raw
 * SQLSTATE with the whole INSERT statement in it where a sentence belonged. A
 * seasonal hire coming back in October is an ordinary thing, and it was
 * impossible — not refused, CRASHED.
 *
 * Unique on `(email, deleted_at)` is what the rule already meant: MySQL treats
 * NULLs as distinct, so any number of removed people may hold an address and
 * exactly one live person may. Same for the phone, which had the identical pair
 * of contradicting rules.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique('users_email_unique');
            $table->dropUnique('users_phone_unique');
            $table->unique(['email', 'deleted_at']);
            $table->unique(['phone', 'deleted_at']);
        });
    }

    public function down(): void
    {
        // Going back can fail, and honestly: if two removed people share an
        // address, restoring the flat index has no correct answer. It refuses
        // rather than deleting somebody's record to make room.
        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique(['email', 'deleted_at']);
            $table->dropUnique(['phone', 'deleted_at']);
            $table->unique('email');
            $table->unique('phone');
        });
    }
};
