<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Shift reporting, second pass — how a drawer is actually counted out.
 *
 * The first pass reconciled a shift against one typed number: counted_cash.
 * Everything below exists because that single number is where cash control
 * quietly fails.
 *
 * ── Counting by denomination ────────────────────────────────────────
 * A cashier typing a total has already done the arithmetic in their head, and
 * the drawer's real composition is gone forever. Counting 3×5000, 12×1000,
 * 8×500 … derives the total instead of trusting it, and leaves a record the
 * next person can re-check. It also catches the honest error the total never
 * does: a note miscounted as a different note.
 *
 * ── Blind close ─────────────────────────────────────────────────────
 * If the till tells you it expects 47,320 before you count, the count comes
 * out at 47,320. Not always dishonestly — a human who knows the answer stops
 * counting when they reach it. Blind close withholds the expected figure until
 * the count is submitted, which is the entire mechanism that makes a variance
 * mean anything. Off by default: in a one-person shop the owner IS the
 * cashier, and hiding their own number from them is theatre.
 *
 * ── Declared tenders ────────────────────────────────────────────────
 * Cash is not the only thing that goes missing. A card terminal's batch total
 * has to agree with what the POS thinks it took, and the moment to catch a
 * mis-keyed card sale is at close, not at month end.
 *
 * ── The trading day ─────────────────────────────────────────────────
 * A shift is one person at one drawer. A shop's day is three of them plus the
 * safe, and the question an owner actually asks — "how much did we take, and
 * how much went to the bank?" — cannot be answered by any single shift. The
 * business day rolls them up and banking records what physically left.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('business_days', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->date('trading_date');
            $table->string('status', 20)->default('open');  // open | closed
            $table->foreignUuid('opened_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('closed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('opened_at');
            $table->timestamp('closed_at')->nullable();

            // Frozen at close, summed from the day's shifts. Never recomputed:
            // a day signed off in March must read the same in September.
            $table->unsignedInteger('shifts_count')->default(0);
            $table->decimal('opening_float', 12, 2)->default(0);
            $table->decimal('cash_sales', 12, 2)->default(0);
            $table->decimal('cash_in', 12, 2)->default(0);
            $table->decimal('cash_out', 12, 2)->default(0);
            $table->decimal('expected_cash', 12, 2)->default(0);
            $table->decimal('counted_cash', 12, 2)->default(0);
            $table->decimal('variance', 12, 2)->default(0);
            $table->unsignedInteger('sales_count')->default(0);
            $table->decimal('sales_total', 12, 2)->default(0);
            $table->decimal('banked_amount', 12, 2)->default(0);
            $table->json('tender_mix')->nullable();

            $table->text('notes')->nullable();
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();

            // One trading day per branch per date. Two would each claim the
            // same shifts and neither would balance.
            $table->unique(['tenant_id', 'branch_id', 'trading_date'], 'business_days_unique');
            $table->index(['tenant_id', 'status']);
        });

        Schema::create('bank_deposits', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->foreignUuid('business_day_id')->nullable()->constrained('business_days')->nullOnDelete();
            $table->decimal('amount', 12, 2);
            $table->string('bank_name')->nullable();
            $table->string('account_label')->nullable();
            $table->string('slip_number')->nullable();   // the deposit slip, for the audit trail
            $table->timestamp('deposited_at');
            $table->foreignUuid('deposited_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('notes')->nullable();
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'deposited_at']);
        });

        Schema::table('cash_sessions', function (Blueprint $table): void {
            // {"5000": 3, "1000": 12, …}. The total is DERIVED from this when
            // present — a count and a total that disagree is a count nobody did.
            $table->json('opening_denominations')->nullable()->after('opening_float');
            $table->json('closing_denominations')->nullable()->after('counted_cash');
            // What the cashier says the card terminal and the rest took.
            $table->json('declared_tenders')->nullable()->after('closing_denominations');
            // declared − expected, per method, frozen at close.
            $table->json('tender_variances')->nullable()->after('declared_tenders');
            // Whether THIS shift was counted blind. Stored rather than read
            // from settings at report time, so turning the setting off next
            // month doesn't rewrite how last month's counts were taken.
            $table->boolean('blind_close')->default(false)->after('tender_variances');
            $table->foreignUuid('business_day_id')->nullable()->after('branch_id')
                ->constrained('business_days')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('cash_sessions', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('business_day_id');
            $table->dropColumn([
                'opening_denominations', 'closing_denominations',
                'declared_tenders', 'tender_variances', 'blind_close',
            ]);
        });

        Schema::dropIfExists('bank_deposits');
        Schema::dropIfExists('business_days');
    }
};
