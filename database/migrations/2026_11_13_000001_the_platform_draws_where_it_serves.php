<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * THE PLATFORM DRAWS WHERE IT SERVES.
 *
 * The admin decides, city by city, up to where a shop may trade online and
 * where an order may be delivered: a circle (a centre and a radius in metres)
 * or a polygon (the corners clicked on a map). One set of zones answers both
 * questions.
 *
 * While no zone is active nothing is fenced — every shop that was listed
 * before stays listed, so launching with zones not yet drawn changes nothing.
 *
 * `tenants.in_service_zone` is the answer for a shop's own pin, kept up to
 * date when a zone changes or the shop moves, so the marketplace filters on a
 * column instead of testing every shop against every polygon on every page.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('service_zones', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('name', 120);
            $table->foreignUuid('city_id')->nullable()->constrained('cities')->nullOnDelete();
            $table->string('kind', 16); // circle | polygon
            $table->decimal('center_lat', 10, 7)->nullable();
            $table->decimal('center_lng', 10, 7)->nullable();
            $table->unsignedInteger('radius_m')->nullable();
            $table->json('points')->nullable(); // [[lat, lng], …] for a polygon
            $table->boolean('is_active')->default(true)->index();
            $table->foreignUuid('created_by')->nullable();
            $table->foreignUuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();
        });

        Schema::table('tenants', function (Blueprint $table): void {
            $table->boolean('in_service_zone')->default(true)->after('longitude')->index();
        });
    }

    public function down(): void
    {
        Schema::table('tenants', function (Blueprint $table): void {
            $table->dropIndex(['in_service_zone']);
            $table->dropColumn('in_service_zone');
        });
        Schema::dropIfExists('service_zones');
    }
};
