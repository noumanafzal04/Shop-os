<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Registers (tills / checkout lanes) — the missing dimension for a large mart.
 *
 * A shop already supports many CASHIERS; what it could not express is many
 * TERMINALS. Lane 3's printer, Lane 3's drawer and Lane 3's shift are all
 * distinct from Lane 1's, and a single tenant-wide "default printer" makes
 * every lane print to the same machine.
 *
 * A register belongs to a BRANCH (a mart's lanes live at one site). Null branch
 * = a single-site shop that never split into branches. Registers are optional:
 * a corner shop with one counter can ignore them entirely and the POS behaves
 * exactly as before.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('registers', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->string('name');                       // "Lane 1", "Counter A"
            $table->string('code', 20)->nullable();       // short label for receipts: "L1"
            $table->boolean('is_active')->default(true);
            $table->json('settings')->nullable();         // per-lane knobs, room to grow
            $table->uuid('created_by')->nullable();
            $table->uuid('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['tenant_id', 'branch_id']);
            // Names are unique per site among LIVE lanes — enforced in the
            // request rather than the schema, so retiring "Lane 2" and creating
            // a new "Lane 2" next year still works.
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('registers');
    }
};
