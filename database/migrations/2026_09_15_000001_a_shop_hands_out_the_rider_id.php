<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * THE SHOP HANDS OUT THE ID, instead of asking for one.
 *
 * ── The flow that was ───────────────────────────────────────────────────
 *
 * A shop wanting its rider on the app had to wait for the rider to install it,
 * sign up, apply, be approved by platform staff, find `RDR-000123` on their own
 * screen, read it out — and only then could the shop type it in. Every step
 * belongs to somebody who is not the shop, and the shop is the one who wants
 * the outcome. Most never got past step one.
 *
 * ── The flow that is ────────────────────────────────────────────────────
 *
 * The shop adds a rider the way it already does — a name and a phone — and the
 * id is minted there and then. The shop writes it down and gives it to their
 * rider, who installs the app and CLAIMS it. Same code, opposite direction.
 *
 * ── What that costs the schema ──────────────────────────────────────────
 *
 * `user_id` had to become nullable, which is the whole change. A minted id is a
 * rider profile with nobody behind it yet, and until somebody claims it there
 * is no account to point at. The unique index stays: MySQL and SQLite both
 * allow many NULLs in one, so any number of ids may sit unclaimed while no two
 * accounts can ever share one.
 *
 * ── And the hole it would have opened ───────────────────────────────────
 *
 * A shop-minted rider is `approved` so they can carry that shop's orders — the
 * shop knows them and is vouching for them, which is exactly what the platform
 * approval is FOR when nobody knows them.
 *
 * But `setPlatform()` only ever asked `status->canRide()`. So a shop could mint
 * an id for anyone, and that person could flip themselves into the CartZe pool
 * and start carrying strangers' goods and strangers' cash — with no CNIC, no
 * licence and no member of staff having looked at them once. `vouched_by_tenant_id`
 * is what closes it: an approval with a shop's name on it and no `approved_by`
 * is a shop's word, good for that shop and for nothing else.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('rider_profiles', function (Blueprint $table): void {
            // WHICH SHOP MINTED THIS ID, and therefore whose word the approval
            // is. Null for every rider who applied for themselves, which is
            // every row that exists today.
            $table->foreignUuid('vouched_by_tenant_id')->nullable()->after('is_platform')
                ->constrained('tenants')->nullOnDelete();

            // WHEN SOMEBODY PICKED IT UP. Null while the id is still a piece of
            // paper in a shop's hand. Kept beside `applied_at` and `approved_at`
            // because it is the same kind of fact: a step in becoming a rider,
            // with a time on it.
            $table->timestamp('claimed_at')->nullable()->after('approved_by');

            $table->index('vouched_by_tenant_id');
        });

        // THE CHANGE ITSELF. Laravel 11 dropped the Doctrine DBAL dependency and
        // implements `change()` natively, SQLite included (it rebuilds the
        // table). So one statement covers MySQL in production and the in-memory
        // SQLite every test runs on — which matters more than the tidiness: a
        // driver-conditional ALTER here would have left `user_id` NOT NULL in
        // every test, and the first unclaimed id would have failed on a
        // constraint no test could see coming.
        Schema::table('rider_profiles', function (Blueprint $table): void {
            $table->uuid('user_id')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('rider_profiles', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('vouched_by_tenant_id');
            $table->dropColumn('claimed_at');
        });

        Schema::table('rider_profiles', function (Blueprint $table): void {
            $table->uuid('user_id')->nullable(false)->change();
        });
    }
};
