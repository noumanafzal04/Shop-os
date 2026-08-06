<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Http\Requests\Branch\StoreBranchRequest;
use App\Http\Requests\Branch\UpdateBranchRequest;
use App\Models\Branch;
use App\Support\ApiResponse;
use App\Support\PlanLimits;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;

class BranchController extends Controller
{
    /** All of the tenant's branches — default (Main) first, then by name. */
    public function index(): JsonResponse
    {
        $branches = Branch::query()
            ->with('city:id,name')
            ->orderByDesc('is_default')
            ->orderBy('name')
            ->get();

        return ApiResponse::ok($branches);
    }

    /** Add a branch — gated by the branches assigned to this shop (Main counts as one). */
    public function store(StoreBranchRequest $request, TenantContext $context): JsonResponse
    {
        PlanLimits::assert($context->get(), 'branches');

        $branch = Branch::query()->create($request->validated() + ['is_default' => false]);

        return ApiResponse::created($branch->load('city:id,name'), 'Branch added');
    }

    public function update(UpdateBranchRequest $request, string $id): JsonResponse
    {
        /** @var Branch $branch */
        $branch = Branch::query()->findOrFail($id);
        $branch->update($request->validated());

        return ApiResponse::ok($branch->load('city:id,name'), 'Branch updated');
    }

    /**
     * Delete a branch. The default Main branch can never be removed — the
     * tenant must always keep at least one location.
     */
    public function destroy(string $id): JsonResponse
    {
        /** @var Branch $branch */
        $branch = Branch::query()->findOrFail($id);

        if ($branch->is_default) {
            throw DomainException::conflict(
                'The main branch cannot be deleted — every business keeps at least one location.',
                'BRANCH_IS_DEFAULT',
            );
        }

        $branch->delete();

        return ApiResponse::noContent('Branch deleted');
    }
}
