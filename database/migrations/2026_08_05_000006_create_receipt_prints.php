<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Every receipt that leaves the counter, logged.
 *
 * Three jobs, only one of which is bookkeeping:
 *   1. A reprint is a known counter fraud — print a second copy, hand it back
 *      with the goods, and the same receipt supports a later "return". The
 *      control is not a gate (customers legitimately lose receipts); it is
 *      that copy #2 says REPRINT on its face and copy #2 is COUNTABLE per
 *      cashier. That is what this table makes possible.
 *   2. Printer-down recovery. A web POS prints through the browser, so the
 *      till never truly knows a receipt landed — the client reports the
 *      outcome here, and a failed row becomes a job in the reprint tray
 *      instead of a customer standing at the counter with nothing.
 *   3. Gift copies. Same sale, prices suppressed — needs to be distinguishable
 *      from a real receipt after the fact.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('receipt_prints', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');
            $table->foreignUuid('sale_id')->constrained('sales')->cascadeOnDelete();
            // Where it was printed. Plain uuids: a lane can be retired and a
            // branch reorganised without taking the audit trail with it.
            $table->uuid('branch_id')->nullable();
            $table->uuid('register_id')->nullable();
            $table->uuid('device_id')->nullable();
            $table->uuid('user_id')->nullable();

            // original | reprint | gift
            $table->string('kind')->default('original');
            // 1 for the first receipt off this sale, 2.. for every copy after.
            $table->unsignedSmallInteger('copy_no')->default(1);
            // queued | printed | failed — a web POS can only ever report what
            // the browser told it, so "printed" means "the print job was
            // handed off", never "paper came out".
            $table->string('status')->default('printed');
            // browser | serial | usb | bluetooth | lan | wifi | native
            $table->string('transport')->nullable();
            $table->string('error')->nullable();
            // Why a copy was run — free text, shown next to the count.
            $table->string('reason')->nullable();
            $table->timestamp('printed_at');
            $table->timestamps();

            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->index(['tenant_id', 'sale_id']);
            // The reprint report: who ran copies, and the recovery tray.
            $table->index(['tenant_id', 'user_id', 'kind']);
            $table->index(['tenant_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('receipt_prints');
    }
};
