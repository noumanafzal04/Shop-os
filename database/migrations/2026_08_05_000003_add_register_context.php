<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Wires the register (till / lane) through everything that happens AT a lane:
 *
 *  - cash_sessions.register_id   a shift is now cashier × terminal, so two
 *                               lanes can be open at once and each drawer
 *                               reconciles on its own.
 *  - cash_sessions.closed_by     who ended the shift — a manager force-closing
 *                               a lane a cashier walked away from is not the
 *                               same event as the cashier closing their own.
 *  - sales.register_id           which lane rang the sale (per-lane X reports),
 *                               stamped server-side from the shift.
 *  - held_sales.register/branch  a parked ticket belongs to the SITE, so lane 3
 *                               can pick up what lane 1 suspended.
 *  - hardware_devices.register_id  the actual fix: a printer/drawer bound to a
 *                               lane. Null = shop-wide (shared), which is the
 *                               pre-existing behaviour for every current row.
 *  - plans.max_registers         lanes are a natural billing axis for a mart.
 *
 * Every column is nullable, so a shop that never creates a register keeps
 * working exactly as it does today.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cash_sessions', function (Blueprint $table): void {
            $table->foreignUuid('register_id')->nullable()->after('branch_id')
                ->constrained('registers')->nullOnDelete();
            $table->uuid('closed_by')->nullable()->after('closed_at');
            // The hot query: "is this lane free?" — one open session per lane.
            $table->index(['tenant_id', 'register_id', 'status']);
        });

        Schema::table('sales', function (Blueprint $table): void {
            // Plain uuid (no FK), matching cash_session_id: deleting a lane must
            // never cascade into sales history.
            $table->uuid('register_id')->nullable()->after('branch_id')->index();
        });

        Schema::table('held_sales', function (Blueprint $table): void {
            $table->foreignUuid('branch_id')->nullable()->after('tenant_id')
                ->constrained('branches')->nullOnDelete();
            $table->foreignUuid('register_id')->nullable()->after('branch_id')
                ->constrained('registers')->nullOnDelete();
            $table->index(['tenant_id', 'branch_id']);
        });

        Schema::table('hardware_devices', function (Blueprint $table): void {
            $table->foreignUuid('register_id')->nullable()->after('tenant_id')
                ->constrained('registers')->nullOnDelete();
            $table->index(['tenant_id', 'register_id', 'type']);
        });

        Schema::table('plans', function (Blueprint $table): void {
            $table->unsignedSmallInteger('max_registers')->nullable()->after('max_branches');
        });
    }

    public function down(): void
    {
        Schema::table('plans', function (Blueprint $table): void {
            $table->dropColumn('max_registers');
        });
        Schema::table('hardware_devices', function (Blueprint $table): void {
            $table->dropIndex(['tenant_id', 'register_id', 'type']);
            $table->dropConstrainedForeignId('register_id');
        });
        Schema::table('held_sales', function (Blueprint $table): void {
            $table->dropIndex(['tenant_id', 'branch_id']);
            $table->dropConstrainedForeignId('register_id');
            $table->dropConstrainedForeignId('branch_id');
        });
        Schema::table('sales', function (Blueprint $table): void {
            $table->dropIndex(['register_id']);
            $table->dropColumn('register_id');
        });
        Schema::table('cash_sessions', function (Blueprint $table): void {
            $table->dropIndex(['tenant_id', 'register_id', 'status']);
            $table->dropColumn('closed_by');
            $table->dropConstrainedForeignId('register_id');
        });
    }
};
