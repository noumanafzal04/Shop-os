<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * THE RIDER IS A PERSON, NOT A SHOP'S ROW.
 *
 * `riders` already exists and stays exactly as it is: a tenant-scoped name and
 * phone with no login, which is how a shop that hands deliveries to its cousin
 * works today. Nothing about it changes here — a shop with no app-using riders
 * behaves tomorrow exactly as it does now.
 *
 * This table is the OTHER half: the person, platform-wide, outside tenancy.
 * One row per user who has applied to ride. `riders.rider_profile_id` (added in
 * the third migration of this set) is the nullable bridge between them:
 *
 *     null  = the phone-call rider that exists today
 *     set   = the same person, holding the app
 *
 * `orders.rider_id` keeps pointing at `riders` and stays the ONE answer to
 * "who is carrying this". A platform rider who accepts a job gets a `riders`
 * row created in that shop, so the panel's assignment screen, the customer's
 * tracking payload and every existing test keep reading one column.
 *
 * NOT `BelongsToTenant`, on purpose — like `AuditLog`. Every read of an order
 * by a rider therefore needs a hand-written fence, because the global scope
 * that protects everything else is not here to protect this. A platform rider
 * reading a stranger's address and phone is a worse leak than a dining table.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rider_profiles', function (Blueprint $table): void {
            $table->uuid('id')->primary();

            // ONE account, two hats. A rider signs in with the same customer
            // account they order food with — inDriver's model, and the reason
            // there is no separate rider app to install.
            $table->foreignUuid('user_id')->unique()->constrained('users')->cascadeOnDelete();

            // THE RIDER ID a human says out loud. The uuid is the key; this is
            // what a shop types to invite someone, what an admin searches, and
            // what a rider reads off their own screen when the shop asks.
            $table->string('rider_code', 16)->unique();

            // draft → pending → approved | rejected | suspended.
            // A customer never rides without a person having said yes.
            $table->string('status')->default('draft')->index();

            $table->string('vehicle_type')->default('bike'); // bike | cycle | car | van
            $table->string('vehicle_registration', 32)->nullable();

            // The national ID number, needed to verify a stranger who will hold
            // a customer's cash and stand at their door. It is theirs, it is
            // written once at application, and it is never in a marketplace or
            // customer-facing payload — see RiderProfile::$hidden and the
            // serializers, which allow-list rather than exclude.
            $table->string('cnic', 20)->nullable();

            // Which shops can see them. `self` riders are invited by one shop
            // and see only that shop's jobs; a platform rider is offered work
            // from any shop whose delivery_provider is `platform`.
            $table->boolean('is_platform')->default(false)->index();

            $table->foreignUuid('city_id')->nullable()->constrained('cities')->nullOnDelete();

            // ── Duty ──────────────────────────────────────────────────────
            // Online is a CHOICE the rider makes and can revoke; last_seen_at
            // is the machine's opinion of whether that choice is still true.
            // A rider whose phone died is "online" and unreachable, so every
            // read of availability asks BOTH.
            $table->boolean('is_online')->default(false)->index();
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();
            $table->timestamp('last_seen_at')->nullable();

            // ── The verdict ───────────────────────────────────────────────
            $table->timestamp('applied_at')->nullable();
            $table->timestamp('approved_at')->nullable();
            $table->foreignUuid('approved_by')->nullable()->constrained('users')->nullOnDelete();
            // Says why, to the rider, in words they can act on. A rejection
            // with no reason is a dead end the applicant cannot fix.
            $table->string('review_note', 500)->nullable();

            $table->timestamps();
            $table->softDeletes();

            $table->index(['status', 'is_online']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rider_profiles');
    }
};
