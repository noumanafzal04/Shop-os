<?php

namespace App\Http\Controllers\Api\V1\Customer;

use App\Http\Controllers\Controller;
use App\Models\CustomerAddress;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * The customer's saved delivery locations. The default one pre-fills
 * checkout; setting a new default clears the previous one atomically.
 */
class AddressController extends Controller
{
    private const RULES = [
        'label' => ['sometimes', 'string', 'max:40'],
        'address' => ['required', 'string', 'max:500'],
        'latitude' => ['nullable', 'numeric', 'between:-90,90'],
        'longitude' => ['nullable', 'numeric', 'between:-180,180'],
        'city_id' => ['nullable', 'uuid', 'exists:cities,id'],
        'is_default' => ['sometimes', 'boolean'],
    ];

    public function index(Request $request): JsonResponse
    {
        return ApiResponse::ok(
            CustomerAddress::query()
                ->where('user_id', $request->user()->id)
                ->with('city:id,name')
                ->orderByDesc('is_default')
                ->orderByDesc('updated_at')
                ->get(),
        );
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate(self::RULES);

        $address = DB::transaction(function () use ($request, $data): CustomerAddress {
            $isFirst = ! CustomerAddress::query()->where('user_id', $request->user()->id)->exists();
            if (! empty($data['is_default'])) {
                $this->clearDefault($request->user()->id);
            }

            return CustomerAddress::query()->create($data + [
                'user_id' => $request->user()->id,
                // The first saved address becomes the default automatically.
                'is_default' => ! empty($data['is_default']) || $isFirst,
            ]);
        });

        return ApiResponse::created($address->load('city:id,name'), 'Address saved');
    }

    public function update(Request $request, string $id): JsonResponse
    {
        /** @var CustomerAddress $address */
        $address = CustomerAddress::query()
            ->where('user_id', $request->user()->id)
            ->findOrFail($id);

        $rules = self::RULES;
        $rules['address'] = ['sometimes', 'string', 'max:500'];
        $data = $request->validate($rules);

        DB::transaction(function () use ($request, $address, $data): void {
            if (! empty($data['is_default'])) {
                $this->clearDefault($request->user()->id);
            }
            $address->update($data);
        });

        return ApiResponse::ok($address->fresh()->load('city:id,name'), 'Address updated');
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        /** @var CustomerAddress $address */
        $address = CustomerAddress::query()
            ->where('user_id', $request->user()->id)
            ->findOrFail($id);

        $wasDefault = $address->is_default;
        $address->delete();

        // Keep exactly one default when any address remains.
        if ($wasDefault) {
            CustomerAddress::query()
                ->where('user_id', $request->user()->id)
                ->orderByDesc('updated_at')
                ->first()
                ?->update(['is_default' => true]);
        }

        return ApiResponse::noContent('Address removed');
    }

    private function clearDefault(string $userId): void
    {
        CustomerAddress::query()->where('user_id', $userId)->update(['is_default' => false]);
    }
}
