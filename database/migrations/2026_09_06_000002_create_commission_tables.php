<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * WHAT THE PLATFORM EARNS.
 *
 * A shop pays two different things and they must never be confused:
 *
 *   the PLAN        a monthly subscription for the software — `plans`,
 *                   `AssignPlanAction`, the billing ledger that already exists
 *   the COMMISSION  a share of what the marketplace actually sold for them,
 *                   which is this
 *
 * ── Why the rate is stored on every charge ───────────────────────────
 *
 * `commission_charges.rate_percent` is written at the moment the order
 * completes and never read from settings again. Change the platform rate
 * tomorrow and last month's invoice must not move: it was raised against a
 * number both sides agreed to at the time, and a bill that silently re-prices
 * itself is a bill nobody can check.
 *
 * Same reason `base_amount` is stored rather than re-derived from the order:
 * a refund, an edited line, a corrected discount would all quietly rewrite
 * history through a join.
 *
 * ── Which sales it applies to ────────────────────────────────────────
 *
 * ONLINE orders only — `orders.channel = 'online'`. A walk-in at the till and
 * a phone order the shop took itself are sales the platform had no part in,
 * and charging for those would be charging for the software, which is what the
 * plan is already for.
 */
return new class extends Migration
{
    public function up(): void
    {
        // A shop's own rate, when it has been negotiated one. Null — the
        // normal case — means the platform default applies, so raising or
        // lowering that default moves everybody who never bargained.
        Schema::table('tenants', function (Blueprint $table): void {
            $table->decimal('commission_rate', 5, 2)->nullable()->after('status');
        });

        Schema::create('commission_invoices', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->string('number', 32);

            $table->date('period_start');
            $table->date('period_end');
            $table->unsignedInteger('orders_count')->default(0);
            $table->decimal('base_total', 14, 2)->default(0);
            $table->decimal('amount', 14, 2)->default(0);

            // unpaid → paid, or void. `void` rather than a delete: an invoice
            // that was sent and then withdrawn is a thing that happened, and a
            // shop that has seen a number is owed an explanation of where it
            // went.
            $table->string('status')->default('unpaid')->index();
            $table->timestamp('paid_at')->nullable();
            $table->foreignUuid('paid_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('note', 500)->nullable();

            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'number']);
            $table->index(['tenant_id', 'status']);
        });

        Schema::create('commission_charges', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            // ONE CHARGE PER ORDER, FOR EVER. The unique index is the whole
            // guard: completing an order is retried by queues and by people,
            // and a shop billed twice for one sale loses trust that a refund
            // does not buy back.
            $table->foreignUuid('order_id')->unique()->constrained('orders')->cascadeOnDelete();

            $table->decimal('rate_percent', 5, 2);
            $table->decimal('base_amount', 12, 2);
            $table->decimal('amount', 12, 2);

            $table->foreignUuid('invoice_id')->nullable()->constrained('commission_invoices')->nullOnDelete();

            // Waived, with a reason. A charge dropped without one is an
            // argument nobody can settle six months later.
            $table->timestamp('waived_at')->nullable();
            $table->string('waive_reason', 500)->nullable();
            $table->foreignUuid('waived_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();

            // "What does this shop still owe" is this index.
            $table->index(['tenant_id', 'invoice_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('commission_charges');
        Schema::dropIfExists('commission_invoices');
        Schema::table('tenants', function (Blueprint $table): void {
            $table->dropColumn('commission_rate');
        });
    }
};
