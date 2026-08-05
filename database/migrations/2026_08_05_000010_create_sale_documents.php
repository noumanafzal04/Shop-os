<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The two promises a retailer makes BEFORE a sale exists.
 *
 * A furniture, electronics or hardware shop doesn't just ring items and take
 * money. Two things happen first, constantly, and neither had anywhere to live:
 *
 *   "Estimate bana do"   — a QUOTATION. A price, in writing, held until a date.
 *                          No money changes hands, nothing leaves the shelf.
 *                          The customer walks out with paper and may never
 *                          return; if they do, the price they were quoted is
 *                          the price they pay. That hold is the whole product.
 *
 *   "Advance rakh do"    — a LAYAWAY. Money down, goods set aside with a name
 *                          on them, balance paid over weeks, collected when
 *                          settled. Here stock DOES move and money IS received.
 *
 * They are one table because they are one document at two levels of
 * commitment: a quotation becomes a layaway the moment the customer puts money
 * on it, and both end the same way — converted into a Sale. Splitting them
 * would mean writing the conversion, the numbering, the expiry and the line
 * snapshots twice, and then watching the two copies drift.
 *
 * ── The three rules that keep the books honest ───────────────────────────
 *
 * 1. A DEPOSIT IS NOT REVENUE. It is the shop holding someone else's money
 *    against goods not yet handed over. So a layaway is never a sale, appears
 *    in no sales report, and earns no loyalty. Revenue is recognised once, at
 *    conversion, for the full amount — and the deposit is then tendered
 *    against that sale as its own method, so today's drawer expects only the
 *    balance and not the money that arrived last month.
 *
 * 2. A DEPOSIT IS STILL CASH IN A DRAWER. The rupees are physically in the
 *    till the moment they are handed over, so each receipt writes a
 *    `deposit_in` cash movement against the shift. Without it every advance
 *    would be reported as a drawer overage, and the variance number — the
 *    entire point of counting a drawer — becomes noise.
 *
 * 3. A LAYAWAY OWNS ITS STOCK. The fridge is off the floor with a name on it,
 *    so stock leaves at deposit time through the normal audited path
 *    (reference_type 'layaway') and the conversion must not take it twice.
 *    Cancelling puts it back. A quotation reserves nothing — it is an offer,
 *    not a claim, and reserving stock against every estimate a shop writes
 *    would empty the shelf on paper by lunchtime.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sale_documents', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->foreignUuid('register_id')->nullable()->constrained('registers')->nullOnDelete();

            // quotation | layaway
            $table->string('kind', 20);
            // QUO-000001 / LAY-000001 — gap-free per tenant per kind.
            $table->string('number');
            // open | converted | cancelled
            // Expiry is DERIVED from expires_at, never stored: a quote that
            // lapsed on Sunday must not depend on a cron having run.
            $table->string('status', 20)->default('open');

            // The customer. Optional on a quotation (a walk-in asking a price
            // has no reason to give a phone number), REQUIRED on a layaway —
            // goods held for nobody can never be collected or chased.
            $table->foreignUuid('customer_id')->nullable()->constrained('customers')->nullOnDelete();
            $table->string('customer_name')->nullable();
            $table->string('customer_phone')->nullable();

            // Priced ONCE, server-side, and then frozen. The freeze is the
            // product: re-pricing at conversion would make the quotation a lie
            // and the layaway a moving target the customer can't save towards.
            $table->decimal('subtotal', 12, 2)->default(0);
            $table->decimal('discount', 12, 2)->default(0);
            $table->decimal('tax', 12, 2)->default(0);
            $table->boolean('tax_inclusive')->default(false);
            $table->decimal('total', 12, 2)->default(0);

            // Running totals of the money side. deposit_paid is the sum of the
            // payment rows, denormalised so a balance never needs a subquery on
            // a list of 200 layaways; refunded/forfeited split what happened to
            // it if the deal fell through.
            $table->decimal('deposit_paid', 12, 2)->default(0);
            $table->decimal('refunded_amount', 12, 2)->default(0);
            $table->decimal('forfeited_amount', 12, 2)->default(0);

            // Quote: valid until. Layaway: collect by. Nullable = open-ended,
            // which a shop is entitled to offer.
            $table->date('expires_at')->nullable();

            // Whether stock has actually been moved out for this document, so
            // cancel and convert can never guess. Set at creation and cleared
            // on cancel — the one flag both paths read.
            $table->boolean('stock_reserved')->default(false);

            $table->text('terms')->nullable();
            $table->text('notes')->nullable();

            // The sale this became. Set once, at conversion.
            $table->foreignUuid('sale_id')->nullable()->constrained('sales')->nullOnDelete();
            $table->timestamp('converted_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->string('cancel_reason')->nullable();

            // A double-tapped "Take advance" would otherwise pull the goods off
            // the shelf twice and take the customer's money twice. A duplicate
            // quotation is merely untidy; a duplicate layaway is theft by
            // accident, so both replay the original.
            $table->string('idempotency_key')->nullable()->unique();

            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['tenant_id', 'number']);
            $table->index(['tenant_id', 'kind', 'status']);
            $table->index(['tenant_id', 'customer_id']);
            // The overdue sweep: "layaways past their collect-by date".
            $table->index(['tenant_id', 'status', 'expires_at']);
        });

        Schema::create('sale_document_items', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('sale_document_id')->constrained('sale_documents')->cascadeOnDelete();
            // Same snapshot discipline as sale_items: deleting a product must
            // never corrupt a document someone is holding paper for.
            $table->foreignUuid('product_id')->nullable()->constrained('products')->nullOnDelete();
            $table->foreignUuid('variant_id')->nullable()->constrained('product_variants')->nullOnDelete();
            $table->foreignUuid('unit_id')->nullable()->constrained('product_units')->nullOnDelete();
            $table->string('product_name');
            $table->string('variant_name')->nullable();
            $table->string('unit_name')->nullable();
            $table->decimal('unit_factor', 12, 3)->default(1);
            $table->string('sku')->nullable();
            $table->string('item_type');
            $table->decimal('quantity', 12, 3);
            $table->decimal('unit_price', 12, 2);
            $table->decimal('line_discount', 12, 2)->default(0);
            $table->decimal('line_total', 12, 2);
            $table->decimal('tax_rate', 5, 2)->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'sale_document_id']);
            $table->index(['tenant_id', 'product_id']);
        });

        // Append-only, like sale_payments: every instalment the customer ever
        // handed over, each tied to the shift whose drawer it landed in.
        Schema::create('sale_document_payments', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('sale_document_id')->constrained('sale_documents')->cascadeOnDelete();
            $table->foreignUuid('cash_session_id')->nullable()->constrained('cash_sessions')->nullOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->foreignUuid('register_id')->nullable()->constrained('registers')->nullOnDelete();
            $table->foreignUuid('user_id')->nullable()->constrained('users')->nullOnDelete();
            // cash | card | bank_transfer | other. Deliberately NOT credit:
            // putting an advance on the khata would mean the shop holding goods
            // against money it has also lent.
            $table->string('method', 20)->default('cash');
            $table->decimal('amount', 12, 2);
            $table->string('reference')->nullable();
            $table->string('note')->nullable();
            $table->timestamp('paid_at');
            $table->timestamps();

            $table->index(['tenant_id', 'sale_document_id']);
            $table->index(['tenant_id', 'paid_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sale_document_payments');
        Schema::dropIfExists('sale_document_items');
        Schema::dropIfExists('sale_documents');
    }
};
