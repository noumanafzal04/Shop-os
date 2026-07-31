<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Http\Requests\CustomerGroup\StoreCustomerGroupRequest;
use App\Models\CustomerGroup;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * Customer groups — tiered-pricing segments. Assigning a customer to a group
 * makes their sales price at the group's level and apply its members' discount.
 */
class CustomerGroupController extends Controller
{
    public function index(): JsonResponse
    {
        return ApiResponse::ok(
            CustomerGroup::query()->withCount('customers')->orderBy('name')->get(),
        );
    }

    public function store(StoreCustomerGroupRequest $request): JsonResponse
    {
        return ApiResponse::created(CustomerGroup::query()->create($request->validated()), 'Customer group created');
    }

    public function update(StoreCustomerGroupRequest $request, string $id): JsonResponse
    {
        $group = CustomerGroup::query()->findOrFail($id);
        $group->update($request->validated());

        return ApiResponse::ok($group, 'Customer group updated');
    }

    /**
     * Deleting a group nulls customer_group_id on its members (FK nullOnDelete),
     * so they fall back to retail pricing — never orphaned.
     */
    public function destroy(string $id): JsonResponse
    {
        CustomerGroup::query()->findOrFail($id)->delete();

        return ApiResponse::noContent('Customer group deleted');
    }
}
