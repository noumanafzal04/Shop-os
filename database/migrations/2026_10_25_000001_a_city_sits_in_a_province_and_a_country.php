<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Country → province → city, from the open countries-states-cities dataset.
 *
 * The app knew eight cities and nothing above them, and a shop in Sialkot
 * could not say where it was. Countries and provinces take the dataset's own
 * ids, so a country added later is the same import with its code. A city
 * keeps its UUID — four tables point at it — and carries the dataset's id as
 * `geo_id`, which is what the import matches on.
 *
 * Additive: nothing existing is renamed or removed, and every new column on
 * `cities` is nullable, so a city made the old way still works.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('countries', function (Blueprint $table): void {
            $table->unsignedInteger('id')->primary();
            $table->string('name');
            $table->char('iso2', 2)->unique();
            $table->char('iso3', 3)->nullable();
            $table->string('phone_code', 16)->nullable();
            $table->char('currency', 3)->nullable();
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();
            $table->boolean('is_active')->default(true)->index();
            $table->timestamps();
        });

        Schema::create('provinces', function (Blueprint $table): void {
            $table->unsignedInteger('id')->primary();
            $table->unsignedInteger('country_id');
            $table->string('name');
            // "province", "federal capital territory", "administered area".
            $table->string('type')->nullable();
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();
            $table->boolean('is_active')->default(true)->index();
            $table->timestamps();

            $table->foreign('country_id')->references('id')->on('countries')->cascadeOnDelete();
            $table->unique(['country_id', 'name']);
        });

        Schema::table('cities', function (Blueprint $table): void {
            $table->unsignedInteger('geo_id')->nullable()->unique()->after('id');
            $table->unsignedInteger('province_id')->nullable()->index()->after('geo_id');
            $table->unsignedInteger('country_id')->nullable()->index()->after('province_id');

            // Two real Nasirabads — one in Sindh, one in Balochistan. A name
            // is unique within its province, not across the country.
            $table->dropUnique(['name']);
            $table->unique(['province_id', 'name']);

            $table->foreign('province_id')->references('id')->on('provinces')->nullOnDelete();
            $table->foreign('country_id')->references('id')->on('countries')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('cities', function (Blueprint $table): void {
            $table->dropForeign(['province_id']);
            $table->dropForeign(['country_id']);
            $table->dropUnique(['province_id', 'name']);
            $table->unique('name');
            $table->dropColumn(['geo_id', 'province_id', 'country_id']);
        });

        Schema::dropIfExists('provinces');
        Schema::dropIfExists('countries');
    }
};
