<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A CANCELLED BOOKING SAYS HOW ITS MONEY WENT BACK (#AZ21).
 *
 * A shop that does not ask for shifts cancelled a layaway with no drawer open
 * and handed Rs 75 back in cash. The document kept `refunded_amount` and not
 * how it was paid, so nothing could tell that Rs 75 of notes had left the shop
 * — Day & banking now lists such cash beside the drawers, and needs to know it
 * was cash. Null for a document cancelled before this, or with nothing back.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sale_documents', function (Blueprint $table): void {
            $table->string('refund_method', 20)->nullable()->after('forfeited_amount');
        });
    }

    public function down(): void
    {
        Schema::table('sale_documents', function (Blueprint $table): void {
            $table->dropColumn('refund_method');
        });
    }
};
