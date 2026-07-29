<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Models\SaleItemSerial;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Warranty desk — look up a serial / IMEI to see what was sold, when, to whom,
 * and whether it is still under warranty. The counter uses this to settle a
 * walk-in warranty claim from just the number on the device.
 */
class WarrantyController extends Controller
{
    public function lookup(Request $request): JsonResponse
    {
        $data = $request->validate([
            'serial' => ['required', 'string', 'max:120'],
        ]);

        $serial = trim($data['serial']);

        // Most recent sale of this serial wins (a serial can recur across time
        // once an earlier sale was cancelled/refunded and the unit resold).
        $record = SaleItemSerial::query()
            ->where('serial', $serial)
            ->with(['sale:id,invoice_number,status,sold_at,customer_name,customer_phone,total'])
            ->latest('sold_at')
            ->first();

        if ($record === null) {
            return ApiResponse::error(
                "No sale found for serial \"{$serial}\".",
                404,
                code: 'SERIAL_NOT_FOUND',
            );
        }

        $expires = $record->warranty_expires_at;
        $underWarranty = $record->isUnderWarranty();

        return ApiResponse::ok([
            'serial' => $record->serial,
            'product_name' => $record->product_name,
            'sold_at' => $record->sold_at?->toIso8601String(),
            'warranty_months' => $record->warranty_months,
            'warranty_expires_at' => $expires?->toDateString(),
            'under_warranty' => $underWarranty,
            // Whole days left (0 when expired or no warranty) — the counter reads
            // this to tell the customer at a glance.
            'days_left' => $underWarranty ? now()->startOfDay()->diffInDays($expires->endOfDay()) : 0,
            'sale' => $record->sale === null ? null : [
                'id' => $record->sale->id,
                'invoice_number' => $record->sale->invoice_number,
                'status' => $record->sale->status,
                'customer_name' => $record->sale->customer_name,
                'customer_phone' => $record->sale->customer_phone,
                'total' => $record->sale->total,
            ],
        ]);
    }
}
