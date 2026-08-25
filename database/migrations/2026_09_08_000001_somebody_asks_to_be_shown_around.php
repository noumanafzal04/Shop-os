<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * SOMEBODY WHO WANTS A PERSON, NOT A DEMO.
 *
 * The landing page already hands out a working shop in one tap, and for a lot
 * of visitors that is the right answer. It is the wrong answer for two others:
 * the shopkeeper who will not click anything until a human has walked them
 * through it, and the one who has a single question standing between them and
 * buying. Both of those left the page with nowhere to go.
 *
 * ── Why this is not a calendar ─────────────────────────────────────────
 *
 * `prefers_at` is when they would LIKE to be shown around. Nothing is booked
 * by writing this row — no slot is held, nobody's diary is touched. A form
 * that says "your demo is confirmed for Tuesday 4pm" while no such thing
 * exists is worse than no form: the first promise this product makes to a
 * stranger would be one it cannot keep. So the field is a preference, the
 * reply says it will be confirmed, and a person confirms it.
 *
 * ── Why the shop details are free text ─────────────────────────────────
 *
 * `city` is a string and not a foreign key to `cities`, and `business_name`
 * is not checked against anything. This is a lead, not a tenant: the person
 * filling it in has no account, may type "Karachi (Gulshan)", and must not be
 * refused for it. When they become a shop, setup asks these questions
 * properly, against the real lists.
 *
 * ── Why `kind` ─────────────────────────────────────────────────────────
 *
 * A question wants an answer today; a walkthrough wants half an hour in
 * somebody's week. Sorting them into one queue means the quick ones sit behind
 * the slow ones, which is how a same-day question takes four days.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('enquiries', function (Blueprint $table): void {
            $table->uuid('id')->primary();

            // walkthrough = show me around · question = answer this and I will decide
            $table->string('kind')->default('walkthrough');

            $table->string('name');
            $table->string('email');
            $table->string('phone')->nullable();
            $table->string('business_name')->nullable();
            $table->string('business_type')->nullable();
            $table->string('city')->nullable();

            // WANTED, not booked. See the note above.
            $table->timestamp('prefers_at')->nullable();
            $table->text('message')->nullable();

            $table->string('status')->default('new'); // new|contacted|closed
            $table->foreignUuid('handled_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('handled_at')->nullable();
            $table->text('handling_note')->nullable();

            $table->timestamps();

            // The list is worked oldest-first within a status, the same way
            // shop requests are, so nothing rots quietly at the bottom.
            $table->index(['status', 'created_at']);
            $table->index('kind');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('enquiries');
    }
};
