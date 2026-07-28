<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Multi-branch, Phase 1 — the branches entity. A branch is a physical location
 * INSIDE a tenant (not a separate account). Every tenant always has exactly one
 * default "Main" branch (created silently), so a single-shop owner never sees
 * branch UI; "going multi-branch" is just raising the plan's max_branches.
 * Per-branch stock / sales / transfers land in later phases (branch_id columns
 * are added there, once each subsystem is wired).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('branches', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->string('name');                 // e.g. "Main", "Gulberg"
            $table->string('code', 32)->nullable(); // short label, e.g. "MAIN"
            $table->boolean('is_default')->default(false); // the silent Main branch
            $table->boolean('is_active')->default(true);
            $table->string('address')->nullable();
            $table->string('phone', 32)->nullable();
            $table->foreignUuid('city_id')->nullable()->constrained('cities')->nullOnDelete();
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'is_active']);
        });

        // Backfill: every EXISTING tenant gets a default "Main" branch, so the
        // invariant "a tenant always has ≥1 branch" holds retroactively. New
        // tenants get theirs from the Tenant::created hook.
        foreach (DB::table('tenants')->pluck('id') as $tenantId) {
            DB::table('branches')->insert([
                'id' => (string) Str::orderedUuid(),
                'tenant_id' => $tenantId,
                'name' => 'Main',
                'code' => 'MAIN',
                'is_default' => true,
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('branches');
    }
};
