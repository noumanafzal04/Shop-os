<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Models\Customer;
use App\Models\CustomerVehicle;
use App\Models\Sale;
use App\Support\ApiResponse;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * The vehicles a shop works on.
 *
 * A customer is remembered by phone number, which is right for a grocery and
 * wrong here. What the counter needs when someone walks in is "what does this
 * car take?" and "what did we fit last time?" — and a tyre shop answers both
 * with a registration plate, not a person.
 *
 * The history endpoint is the point of the whole thing: a warranty claim, a due
 * alignment, and the tyre size nobody has to measure again.
 */
class VehicleController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $vehicles = CustomerVehicle::query()
            ->with('customer:id,name,phone')
            ->when($request->query('search'), function ($q, $search): void {
                // Plates are typed a dozen ways. Search the normalised form as
                // well as the raw one, so "lea 1234" finds LEA-1234.
                $normalised = CustomerVehicle::normalizeRegistration($search);
                $q->where(function ($q) use ($search, $normalised): void {
                    $q->where('registration', 'like', "%{$normalised}%")
                        ->orWhere('registration', 'like', "%{$search}%")
                        ->orWhere('make', 'like', "%{$search}%")
                        ->orWhere('model', 'like', "%{$search}%");
                });
            })
            ->when($request->query('customer_id'), fn ($q, $id) => $q->where('customer_id', $id))
            ->when(! $request->boolean('with_inactive'), fn ($q) => $q->where('is_active', true))
            ->orderByDesc('updated_at')
            ->paginate(min((int) $request->query('per_page', 25), 100));

        return ApiResponse::paginated($vehicles);
    }

    public function store(Request $request): JsonResponse
    {
        // Already normalised by validated(): one plate, one spelling, one car.
        $vehicle = CustomerVehicle::query()->create($this->validated($request));

        return ApiResponse::created($vehicle->load('customer:id,name,phone'), 'Vehicle added');
    }

    public function show(string $id): JsonResponse
    {
        return ApiResponse::ok(
            CustomerVehicle::query()->with('customer:id,name,phone')->findOrFail($id),
        );
    }

    public function update(Request $request, string $id): JsonResponse
    {
        /** @var CustomerVehicle $vehicle */
        $vehicle = CustomerVehicle::query()->findOrFail($id);

        $vehicle->update($this->validated($request, $id));

        return ApiResponse::ok($vehicle->fresh()->load('customer:id,name,phone'), 'Vehicle updated');
    }

    public function destroy(string $id): JsonResponse
    {
        CustomerVehicle::query()->findOrFail($id)->delete();

        return ApiResponse::noContent('Vehicle removed');
    }

    /**
     * Everything this vehicle has ever had done to it.
     *
     * The screen a counter opens while the customer is still talking: what was
     * fitted, when, at what odometer reading, and for how much. It is what a
     * warranty claim hangs off and what lets the shop say "your alignment was
     * 11,000 km ago" instead of guessing.
     */
    public function history(string $id): JsonResponse
    {
        /** @var CustomerVehicle $vehicle */
        $vehicle = CustomerVehicle::query()->with('customer:id,name,phone')->findOrFail($id);

        $sales = Sale::query()
            ->with(['items:id,sale_id,product_name,variant_name,quantity,line_total'])
            ->where('vehicle_id', $vehicle->id)
            ->orderByDesc('sold_at')
            ->limit(50)
            ->get(['id', 'invoice_number', 'status', 'total', 'odometer', 'sold_at']);

        return ApiResponse::ok([
            'vehicle' => $vehicle,
            'visits' => $sales,
            // A running total the owner actually asks for: what has this
            // vehicle been worth to the shop.
            'lifetime_value' => round((float) $sales->where('status', '!=', 'cancelled')->sum('total'), 2),
            'last_visit' => $sales->first()?->sold_at?->toIso8601String(),
        ]);
    }

    /** @return array<string, mixed> */
    private function validated(Request $request, ?string $ignoreId = null): array
    {
        $required = $ignoreId === null ? 'required' : 'sometimes';

        // Normalise BEFORE the uniqueness rule reads it. Checking the raw text
        // lets "lea 1234" past a rule that already holds LEA1234, and the
        // collision then surfaces as a 500 from the index instead of a field
        // error the counter can act on.
        if ($request->filled('registration')) {
            $request->merge([
                'registration' => CustomerVehicle::normalizeRegistration((string) $request->input('registration')),
            ]);
        }

        return $request->validate([
            'registration' => [
                $required, 'string', 'max:32',
                Rule::unique('customer_vehicles', 'registration')
                    ->where('tenant_id', app(TenantContext::class)->id())
                    ->whereNull('deleted_at')
                    ->ignore($ignoreId),
            ],
            'customer_id' => ['nullable', 'uuid', Rule::exists('customers', 'id')],
            'make' => ['nullable', 'string', 'max:60'],
            'model' => ['nullable', 'string', 'max:60'],
            'year' => ['nullable', 'integer', 'min:1900', 'max:'.(now()->year + 1)],
            'colour' => ['nullable', 'string', 'max:40'],
            'tyre_size' => ['nullable', 'string', 'max:40'],
            'engine_no' => ['nullable', 'string', 'max:40'],
            'chassis_no' => ['nullable', 'string', 'max:40'],
            'odometer' => ['nullable', 'integer', 'min:0', 'max:9999999'],
            'notes' => ['nullable', 'string', 'max:1000'],
            'is_active' => ['sometimes', 'boolean'],
        ], [
            'registration.unique' => 'This registration is already on file.',
        ]);
    }

    /** Attach (or create) the customer this vehicle belongs to, by phone. */
    public function linkCustomer(Request $request, string $id): JsonResponse
    {
        /** @var CustomerVehicle $vehicle */
        $vehicle = CustomerVehicle::query()->findOrFail($id);

        $data = $request->validate(['phone' => ['required', 'string', 'max:32'], 'name' => ['nullable', 'string', 'max:120']]);

        $customer = Customer::capture(
            app(TenantContext::class)->id(),
            $data['phone'],
            $data['name'] ?? null,
        );

        $vehicle->update(['customer_id' => $customer?->id]);

        return ApiResponse::ok($vehicle->fresh()->load('customer:id,name,phone'), 'Owner linked');
    }
}
