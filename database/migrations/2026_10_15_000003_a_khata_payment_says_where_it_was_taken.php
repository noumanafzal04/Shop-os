<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * WHERE A KHATA PAYMENT WAS TAKEN.
 *
 * A payment against a customer's khata by transfer, card or wallet reached no
 * report and not Day & banking (L14, the owner 2026-10-15) — only the cash ones
 * did, through the drawer. To put a day's collections on that day's screen, a
 * payment has to say which counter took it: a chain's Day & banking is one
 * branch's day. Older rows have none and are counted only across the whole
 * shop, never against a branch they cannot be shown to belong to.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customer_ledger_entries', function (Blueprint $table): void {
            $table->uuid('branch_id')->nullable()->after('customer_id');
            // The day's and the period's collections: payments, by date.
            $table->index(['tenant_id', 'type', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::table('customer_ledger_entries', function (Blueprint $table): void {
            $table->dropIndex(['tenant_id', 'type', 'created_at']);
            $table->dropColumn('branch_id');
        });
    }
};
