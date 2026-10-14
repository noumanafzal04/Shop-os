<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * WHO TOOK FOOD OFF A TAB.
 *
 * A void after the kitchen has the order is a supervisor's decision (tester
 * pass 2, B40: a waiter voided a served juice and cancelled the whole tab).
 * The reason was kept; the person was not.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('restaurant_ticket_items', function (Blueprint $table): void {
            $table->uuid('voided_by')->nullable()->after('void_reason');
        });
    }

    public function down(): void
    {
        Schema::table('restaurant_ticket_items', function (Blueprint $table): void {
            $table->dropColumn('voided_by');
        });
    }
};
