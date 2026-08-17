<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Where the stock went when it left without being sold.
 *
 * ── The medical store's actual loss ─────────────────────────────────────
 *
 * A pharmacy's money does not mostly leak at the counter. It expires on the
 * shelf. And the loss is avoidable, because distributors here take medicine
 * back for credit — near-expiry, damaged, or under recall — inside a window
 * that closes months before the printed date.
 *
 * The platform already computed the warning perfectly: batches, FEFO, an
 * expiry fence that refuses to dispense past the date, a dashboard count. And
 * then a pharmacist could act on none of it in a way the books could see.
 *
 * `BatchController::destroy` removed a batch and wrote ONE movement whose
 * reason was the generated string "Batch X removed/expired". That string covers
 * three completely different events:
 *
 *   - written off  — expired, in the bin. A real loss.
 *   - returned     — sent back to the distributor. NOT a loss; money owed back.
 *   - a mistake    — the batch was keyed wrong. Not an event at all.
 *
 * And the batch row was hard-deleted, taking its cost with it. So afterwards
 * "what did expiry cost me this year" and "what has Sunny Traders not credited
 * me for" were both unanswerable — from ingredients that all existed one moment
 * earlier.
 *
 * ── Why a row of its own, rather than a reason string ───────────────────
 *
 * Because a claim is chased. A returned lot has a supplier, a value, and an
 * open question — did the credit ever arrive? — that stays open for weeks. None
 * of that fits in a movement's `reason`, and a free-text reason cannot be
 * totalled, which is the whole point of recording it.
 *
 * The movement still happens and is still the only thing that moves stock. This
 * sits BESIDE it and explains it.
 *
 * ── The snapshots are deliberate ────────────────────────────────────────
 *
 * `batch_number`, `expiry_date` and `unit_cost` are copied here rather than
 * referenced. The batch row is gone by the time anybody reads this, which is
 * exactly why the figures had disappeared before.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('stock_disposals', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->string('number');

            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->foreignUuid('variant_id')->nullable()->constrained('product_variants')->nullOnDelete();
            // Snapshots. The batch row is deleted by the time this is read —
            // that disappearance is the defect this table exists to fix.
            $table->string('product_name');
            $table->string('batch_number')->nullable();
            $table->date('expiry_date')->nullable();

            $table->decimal('quantity', 12, 3);
            $table->decimal('unit_cost', 12, 2)->nullable();
            // What the shop paid for what it is throwing away or sending back.
            // Null where the lot never carried a cost — reported as unknown
            // rather than as zero, because zero is a claim and unknown is not.
            $table->decimal('total_cost', 12, 2)->nullable();

            // written_off | returned_to_supplier. The whole reason for the row:
            // one is a loss, the other is money owed back, and they must never
            // be added together.
            $table->string('disposition');
            // expired | damaged | recall | other — WHY, which is a different
            // question from WHERE IT WENT. Expired stock can be written off or
            // returned; damaged stock likewise.
            $table->string('reason');
            $table->text('notes')->nullable();

            // Only for a return. The claim is against a party.
            $table->foreignUuid('supplier_id')->nullable()->constrained('suppliers')->nullOnDelete();
            $table->decimal('credit_expected', 12, 2)->nullable();
            // Settled separately and usually later — a distributor credits on
            // their own schedule, and the gap between these two IS the thing a
            // pharmacist is chasing.
            $table->decimal('credit_received', 12, 2)->nullable();
            $table->date('credit_received_at')->nullable();
            $table->string('credit_reference')->nullable();

            // The movement that actually moved the stock. This row explains it;
            // it does not replace it.
            $table->foreignUuid('stock_movement_id')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->uuid('updated_by')->nullable();
            $table->timestamp('disposed_at');
            $table->timestamps();
            // BaseModel soft-deletes. A disposal is evidence — the whole point
            // is that removing stock stopped destroying its own record — so it
            // is retired, never erased.
            $table->softDeletes();

            $table->unique(['tenant_id', 'number']);
            // "What did expiry cost me this year" — a date-ranged sweep.
            $table->index(['tenant_id', 'disposed_at']);
            // "What has this distributor still not credited me for" — the query
            // that recovers actual money.
            $table->index(['tenant_id', 'supplier_id', 'credit_received_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stock_disposals');
    }
};
