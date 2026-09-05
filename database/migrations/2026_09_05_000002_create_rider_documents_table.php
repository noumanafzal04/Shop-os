<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A rider's identity documents.
 *
 * These are NOT product photos. A CNIC scan and a driving licence go on the
 * PRIVATE disk and are served through an authenticated endpoint that checks
 * the reader is either the rider themselves or platform staff — never on the
 * `public` disk, whose whole point is a guessable URL that needs no token.
 *
 * The path is the only copy; a rejected document is replaced, not accumulated,
 * so an applicant who photographed their thumb can fix it without a second row
 * competing with the first.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('rider_documents', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('rider_profile_id')->constrained('rider_profiles')->cascadeOnDelete();

            // cnic_front | cnic_back | licence | vehicle_registration | selfie
            $table->string('type');
            $table->string('path');
            $table->string('original_name')->nullable();
            $table->unsignedInteger('size_bytes')->default(0);

            // pending → approved | rejected. Reviewed per document, because
            // "your application was rejected" tells an applicant nothing about
            // WHICH photograph to retake.
            $table->string('status')->default('pending')->index();
            $table->string('review_note', 500)->nullable();

            $table->timestamps();

            // One current document per type. Re-uploading replaces.
            $table->unique(['rider_profile_id', 'type']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rider_documents');
    }
};
