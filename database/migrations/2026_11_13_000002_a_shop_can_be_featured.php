<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A SHOP CAN BE FEATURED — a paid place at the top of the app's home.
 *
 * The admin sets it when the shop has paid, with the day it ends; it ends on
 * its own. `featured_rank` orders the paid row (lower first). A shop outside
 * every service zone, closed to online orders or lapsed is never shown,
 * featured or not — featuring buys position, not visibility.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('tenants', function (Blueprint $table): void {
            $table->timestamp('featured_until')->nullable()->after('in_service_zone')->index();
            $table->unsignedSmallInteger('featured_rank')->default(100)->after('featured_until');
        });
    }

    public function down(): void
    {
        Schema::table('tenants', function (Blueprint $table): void {
            $table->dropIndex(['featured_until']);
            $table->dropColumn(['featured_until', 'featured_rank']);
        });
    }
};
