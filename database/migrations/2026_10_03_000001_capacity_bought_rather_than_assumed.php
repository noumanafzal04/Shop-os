<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * EXTRA CAPACITY, AS A ROW RATHER THAN A NUMBER.
 *
 * A shop on Standard gets ten staff accounts and needs thirteen. Today an
 * admin writes 13 into `tenants.limits` and the shop has thirteen.
 *
 * That works, and it loses everything except the answer:
 *
 *   WHY is it thirteen?        The screen can say "assigned" and no more.
 *   WHO is paying for the      Nothing to invoice. Three extra users at
 *   three?                     Rs 400 each is Rs 1,200 a month that nobody
 *                              can bill because there is no line to bill.
 *   WHEN does it end?          "Five extra users until the end of Ramzan"
 *                              cannot be written down at all, so it is
 *                              granted for ever and quietly becomes the
 *                              deal.
 *   What did the plan give?    The baseline is still readable, but the
 *                              difference between 10 and 13 is an
 *                              arithmetic guess rather than a record.
 *
 * ── One table for both, because they are the same thing ─────────────────
 *
 * An ADD-ON is extra capacity with a price. A TEMPORARY GRANT is extra
 * capacity with an end date. A sales concession is extra capacity with
 * neither. They differ in two nullable columns and nothing else, and three
 * tables would have meant three places to read before answering "how many
 * staff may this shop have".
 *
 * ── What this does NOT change ───────────────────────────────────────────
 *
 * `tenants.limits` stays exactly as it is, and it stays the OUTRIGHT value:
 * for branches, staff and registers it is not an override of anything, it is
 * the size of the organisation as assigned. Entitlements are added ON TOP of
 * whatever that resolves to. Keeping the two separate is what lets an admin
 * read "assigned 10, plus 3 bought" rather than one number that means both.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tenant_entitlements', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();

            /**
             * Which ceiling this lifts — a key from `PlanLimits::REGISTRY`.
             *
             * A string and not an enum: the registry grows (storage, API
             * calls, whatever is metered next) and a migration per new
             * meter would be a migration nobody writes, so the capacity
             * would go back to being typed into `limits`.
             */
            $table->string('limit_key', 40);

            // How much MORE. Always positive — this table grants capacity and
            // never takes it away. Reducing a shop is a change to its
            // assigned limit, which is a different act with a different
            // conversation behind it.
            $table->unsignedInteger('quantity');

            /**
             * What it is billed at, per billing period. NULL means free —
             * a goodwill grant, or capacity bundled into a negotiated deal.
             *
             * Null is NOT zero. Zero is "we agreed it is free"; null is "no
             * price was ever set", and an invoice run has to treat those
             * differently or it quietly bills nothing and says nothing.
             */
            $table->decimal('unit_price', 12, 2)->nullable();

            // When it applies. Null end = for ever, which is what an ordinary
            // paid add-on is.
            $table->date('starts_on');
            $table->date('ends_on')->nullable();

            // WHY, in a person's words. The one thing `tenants.limits` could
            // never hold, and the first thing anybody asks six months later.
            $table->string('note', 255)->nullable();

            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            // The question asked on every usage read: what is live for this
            // shop, for this meter, today.
            $table->index(['tenant_id', 'limit_key', 'starts_on', 'ends_on'], 'entitlements_live_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tenant_entitlements');
    }
};
