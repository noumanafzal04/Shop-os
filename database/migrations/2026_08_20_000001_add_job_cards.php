<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The car is in the bay and there is no bill yet.
 *
 * ── The missing middle ──────────────────────────────────────────────────
 *
 * A workshop already had both ENDS: `CustomerVehicle` is the car's own record,
 * and a quotation converts into a Sale, which is estimate → invoice. What had
 * nowhere to live is the several hours or days between them — the car up on the
 * ramp, parts being fitted and labour accumulating, nothing billed, and the
 * customer ringing to ask if it is ready.
 *
 * That state is the whole of a workshop's day, and it was the one thing an
 * automotive shop could not record.
 *
 * ── Why this is a KIND of document and not a new table ──────────────────
 *
 * A job card accumulates priced lines, takes an advance, and turns into a sale
 * when the customer collects. That is exactly what `sale_documents` already
 * does for a quotation and a layaway — numbering, line storage, deposits,
 * cancellation, and `ConvertSaleDocumentAction`, which is the piece nobody
 * should write twice. A parallel `job_cards` table would have re-implemented
 * all of it and drifted from it within a year.
 *
 * So: a third `kind`, four columns, and one new idea.
 *
 * ── The one new idea: work_status is NOT document status ────────────────
 *
 * `status` already answers "is this document still live" — open, converted,
 * cancelled. A workshop needs a different question answered on the same row:
 * *where is this car right now?* Received, being worked on, ready for
 * collection.
 *
 * They are genuinely independent. A job card that is `ready` is still `open`
 * until somebody pays. Folding them into one column would mean either losing
 * the bay board or inventing statuses like `open_ready`, and the second one is
 * how a status column becomes unreadable.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sale_documents', function (Blueprint $table): void {
            // WHICH CAR. The reason a workshop's records are worth anything: a
            // year later somebody asks what was done to this registration, and
            // without this the answer is a customer name and a guess.
            $table->foreignUuid('vehicle_id')->nullable()
                ->constrained('customer_vehicles')->nullOnDelete();

            // The reading when it came IN. Not the same as the sale's odometer,
            // which is taken when it goes out — a car in the bay for a week
            // with a road test in the middle has two different numbers, and a
            // service interval is counted from the one on the invoice.
            $table->integer('odometer_in')->nullable();

            // WHAT THE CUSTOMER SAID IS WRONG, in their words. The single most
            // important field on a paper job card and the one most likely to be
            // dropped in software: "noise from front left when braking" is what
            // the mechanic reads before touching anything, and it is not a line
            // item, a product, or a note on the invoice.
            $table->text('complaint')->nullable();

            // When the customer was told to come back. A workshop's whole
            // relationship with its customers runs on this one promise.
            $table->timestamp('promised_at')->nullable();

            // Where the car is, as against where the paperwork is. See above.
            $table->string('work_status', 20)->nullable();

            // The bay board: "what is in the shop today", ordered by promise.
            $table->index(['tenant_id', 'work_status']);
        });
    }

    public function down(): void
    {
        Schema::table('sale_documents', function (Blueprint $table): void {
            $table->dropIndex(['tenant_id', 'work_status']);
            $table->dropConstrainedForeignId('vehicle_id');
            $table->dropColumn(['odometer_in', 'complaint', 'promised_at', 'work_status']);
        });
    }
};
