<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * WHO SAID YES TO MONEY GOING BACK.
 *
 * The owner (2026-10-14, B01): a refund leaves the cashier's own drawer, and a
 * supervisor approves it with their PIN. The return keeps who approved and
 * when; the audit trail keeps the rest (amount, cashier, drawer).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sale_returns', function (Blueprint $table): void {
            $table->uuid('approved_by')->nullable()->after('cash_session_id');
            $table->timestamp('approved_at')->nullable()->after('approved_by');
        });
    }

    public function down(): void
    {
        Schema::table('sale_returns', function (Blueprint $table): void {
            $table->dropColumn(['approved_by', 'approved_at']);
        });
    }
};
