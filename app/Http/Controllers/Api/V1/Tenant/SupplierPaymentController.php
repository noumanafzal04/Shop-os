<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Actions\Purchase\RecordSupplierPaymentAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Purchase\StoreSupplierPaymentRequest;
use App\Models\CashMovement;
use App\Models\Supplier;
use App\Support\BooksDrawer;
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

        // Paid from the till beyond what the drawer held (#AZ14): said now,
        // not on the close sheet hours later.
        $warning = BooksDrawer::overdrawnWarning(
            CashMovement::query()->where('source_type', 'supplier_payment')->where('source_id', $payment->id)->first(),
        );

        return response()->json([
            'success' => true,
            'message' => 'Payment recorded',
            'data' => $payment->load('purchaseOrder:id,po_number'),
            'errors' => (object) [],
            'meta' => (object) array_filter(['warnings' => array_values(array_filter([$warning]))]),
        ], 201);
    }
}
