<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Purchase\RecordSupplierPaymentAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Purchase\StoreSupplierPaymentRequest;
use App\Models\Supplier;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;

class SupplierPaymentController extends Controller
{
    public function store(
        StoreSupplierPaymentRequest $request,
        string $supplierId,
        RecordSupplierPaymentAction $action,
    ): JsonResponse {
        /** @var Supplier $supplier */
        $supplier = Supplier::query()->findOrFail($supplierId);
        $payment = $action->execute($supplier, $request->validated());

        return ApiResponse::created($payment->load('purchaseOrder:id,po_number'), 'Payment recorded');
    }
}
