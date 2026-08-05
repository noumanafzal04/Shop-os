<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The cash-movement ledger — every rupee that enters or leaves a drawer for a
 * reason that ISN'T a sale.
 *
 * Why this is the foundation: a shift's expectation was hard-wired to
 * `opening_float + cash_sales`, with no third term. So every legitimate
 * mid-shift movement — the owner taking Rs 24,500 to the bank, petty cash for
 * a rickshaw, paying a supplier from the till, a khata repayment coming in —
 * was reported as a VARIANCE. On six lanes that's six fake shortages a day,
 * and a real theft becomes indistinguishable from a supervisor's uncounted
 * pickup. The variance number, the entire point of counting a drawer, was
 * noise.
 *
 * Design notes:
 *  - `direction` is stored, not derived, so the drawer sum is one query and a
 *    new type can't silently sum the wrong way. `none` exists for no_sale
 *    (opening the drawer is an event with no money).
 *  - `source_type`/`source_id` link back to whatever caused it (a supplier
 *    payment, a khata receipt, a voided sale) so one ledger explains the
 *    drawer without duplicating those records.
 *  - `approved_by` is nullable now and becomes meaningful with manager
 *    authority (next unit) — a pay-out over a threshold will need a second name.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('cash_movements', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->foreignUuid('register_id')->nullable()->constrained('registers')->nullOnDelete();
            // The shift whose drawer this hits. Required: a movement with no
            // drawer is exactly the untraceable cash this table exists to end.
            $table->foreignUuid('cash_session_id')->constrained('cash_sessions')->cascadeOnDelete();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();

            // paid_in | paid_out | drop | float_add | no_sale
            // | khata_in | supplier_out | expense_out | void_refund
            $table->string('type');
            // in | out | none
            $table->string('direction');
            $table->decimal('amount', 12, 2)->default(0);
            $table->string('reason')->nullable();
            $table->text('note')->nullable();
            // What caused it: sale | supplier_payment | customer_ledger_entry | expense
            $table->string('source_type')->nullable();
            $table->uuid('source_id')->nullable();
            $table->uuid('approved_by')->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'cash_session_id']);
            $table->index(['tenant_id', 'register_id', 'created_at']);
            $table->index(['source_type', 'source_id']);
        });

        // The shift carries its own movement totals once closed, so a Z-report
        // reprinted next year shows the same numbers even if a linked record
        // was since edited or deleted.
        Schema::table('cash_sessions', function (Blueprint $table): void {
            $table->decimal('cash_in', 12, 2)->default(0)->after('cash_sales');
            $table->decimal('cash_out', 12, 2)->default(0)->after('cash_in');
        });
    }

    public function down(): void
    {
        Schema::table('cash_sessions', function (Blueprint $table): void {
            $table->dropColumn(['cash_in', 'cash_out']);
        });
        Schema::dropIfExists('cash_movements');
    }
};
