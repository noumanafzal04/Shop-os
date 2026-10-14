<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A MONEY FORM PRESSED TWICE IS RECORDED ONCE.
 *
 * Tester pass 1 (B07): a double-click on Record recorded a khata payment, a
 * supplier payment and an expense twice — two POSTs left before the button
 * disabled. Sales, returns and receipts carried a key of their own; these did
 * not. One table for every such form: the first answer is kept against the
 * person and their key, and the same key is given that answer again.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('answered_requests', function (Blueprint $table): void {
            $table->id();
            $table->uuid('tenant_id')->nullable();
            $table->uuid('user_id');
            $table->string('key', 100);
            $table->string('route', 255);
            $table->unsignedSmallInteger('status')->nullable();
            $table->longText('body')->nullable();
            $table->timestamps();

            $table->unique(['user_id', 'key']);
            $table->index('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('answered_requests');
    }
};
