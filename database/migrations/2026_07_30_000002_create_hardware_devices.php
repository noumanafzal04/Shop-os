<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Hardware registry — the shop's peripherals (receipt/label printers, barcode
 * scanners, cash drawer, customer display) as configuration. The POS talks to
 * an IPrinter/IScanner abstraction; a row here tells that layer WHAT to talk to
 * and HOW (connection transport), never a vendor SDK. `connection_type` is the
 * real axis for a browser/PWA POS: browser (print dialog), serial/usb/bluetooth
 * (Web Serial / WebUSB / Web Bluetooth ESC/POS), lan/wifi, or native (a Sunmi/
 * Android shell bridge).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('hardware_devices', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');
            // receipt_printer | label_printer | barcode_scanner | cash_drawer | customer_display
            $table->string('type');
            $table->string('name');
            $table->string('brand')->nullable();
            $table->string('model')->nullable();
            // browser | serial | usb | bluetooth | lan | wifi | native
            $table->string('connection_type')->default('browser');
            // IP:port, MAC, device id — transport-dependent, optional.
            $table->string('connection_value')->nullable();
            // The device the POS reaches for first, per type (one per type).
            $table->boolean('is_default')->default(false);
            $table->boolean('is_active')->default(true);
            // Transport/format knobs: {paper_size, copies, cut_paper, ...}.
            $table->json('settings')->nullable();
            $table->timestamps();

            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->index(['tenant_id', 'type']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('hardware_devices');
    }
};
