<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A DEMO SHOP, AND THE HOUR IT STOPS BEING ONE.
 *
 * The landing page hands a visitor a working shop of their own rather than a
 * shared sandbox — a shared one is renamed to nonsense inside a day, and two
 * visitors ringing sales at once make each other's figures meaningless.
 *
 * Which means real tenant rows created by strangers, on the same database as
 * real shops. Two columns keep that honest:
 *
 *   is_demo          — never a real shop. It is kept OUT of the marketplace, so
 *                      no customer can order from it, and out of every figure
 *                      an owner or the platform reads.
 *   demo_expires_at  — when it clears itself away. Absolute, from creation, so
 *                      the banner can print a real time: "ends 4:20pm
 *                      tomorrow" is a sentence; "expires soon" is not.
 *
 * Both nullable/false for every existing shop, which is what they are.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tenants', function (Blueprint $table): void {
            $table->boolean('is_demo')->default(false)->after('slug');
            $table->timestamp('demo_expires_at')->nullable()->after('is_demo');
            // The prune job asks exactly one question, once an hour.
            $table->index(['is_demo', 'demo_expires_at'], 'tenants_demo_sweep_index');
        });
    }

    public function down(): void
    {
        Schema::table('tenants', function (Blueprint $table): void {
            // Index first: sqlite refuses to drop a column an index still
            // names, and this repo has been bitten by that once already.
            $table->dropIndex('tenants_demo_sweep_index');
            $table->dropColumn(['is_demo', 'demo_expires_at']);
        });
    }
};
