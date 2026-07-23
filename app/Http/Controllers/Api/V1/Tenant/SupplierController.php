<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Http\Requests\Purchase\StoreSupplierRequest;
use App\Http\Requests\Purchase\UpdateSupplierRequest;
use App\Models\Supplier;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class SupplierController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $suppliers = Supplier::query()
            ->withOutstanding()
            ->when($request->query('search'), fn ($q, $s) => $q->where(function ($q) use ($s): void {
                $q->where('name', 'like', "%{$s}%")
                    ->orWhere('contact_person', 'like', "%{$s}%")
                    ->orWhere('phone', 'like', "%{$s}%");
            }))
            ->when($request->has('is_active'), fn ($q) => $q->where('is_active', $request->boolean('is_active')))
            ->orderBy('name')
            ->paginate(min((int) $request->query('per_page', 20), 100));

        return ApiResponse::paginated($suppliers);
    }

    public function store(StoreSupplierRequest $request): JsonResponse
    {
        $supplier = Supplier::query()->create($request->validated());

        return ApiResponse::created($supplier, 'Supplier added');
    }

    public function show(string $id): JsonResponse
    {
        $supplier = Supplier::query()->withOutstanding()->findOrFail($id);
        $supplier->setRelation('purchaseOrders', $supplier->purchaseOrders()
            ->latest('order_date')->limit(20)->get());
        $supplier->setRelation('payments', $supplier->payments()
            ->latest('paid_at')->limit(20)->get());

        return ApiResponse::ok($supplier);
    }

    public function update(UpdateSupplierRequest $request, string $id): JsonResponse
    {
        $supplier = Supplier::query()->findOrFail($id);
        $supplier->update($request->validated());

        return ApiResponse::ok($supplier, 'Supplier updated');
    }

    public function destroy(string $id): JsonResponse
    {
        Supplier::query()->findOrFail($id)->delete();

        return ApiResponse::noContent('Supplier deleted');
    }
}
