<?php

namespace App\Http\Controllers\Api\V1\Public;

use App\Http\Controllers\Controller;
use App\Models\Enquiry;
use App\Support\ApiResponse;
use App\Support\BusinessTypes;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * The landing page's other door: ask for a person.
 *
 * Unauthenticated and therefore throttled, but the risk here is nothing like
 * `/demo` — the worst a flood does is fill a list an admin can delete, rather
 * than build tenants. The limit exists so that list stays worth reading.
 *
 * WHAT IT WILL NOT DO IS PROMISE A TIME. `prefers_at` is stored as wanted and
 * the reply says a person will confirm it. See the migration for why.
 */
class EnquiryController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'kind' => ['required', Rule::in(Enquiry::KINDS)],
            'name' => ['required', 'string', 'max:120'],
            'email' => ['required', 'email', 'max:190'],
            'phone' => ['nullable', 'string', 'max:32'],
            'business_name' => ['nullable', 'string', 'max:190'],
            // Named against the real list, so a trade added next year is
            // offered here without anybody remembering to come back.
            'business_type' => ['nullable', Rule::in(BusinessTypes::codes())],
            'city' => ['nullable', 'string', 'max:120'],
            // A walkthrough in the past is somebody mistyping the year, and
            // storing it sends an admin to a slot that has already gone.
            'prefers_at' => ['nullable', 'date', 'after:now'],
            'message' => ['nullable', 'string', 'max:2000'],
        ]);

        $enquiry = Enquiry::query()->create([
            ...$data,
            'status' => Enquiry::NEW,
        ]);

        return ApiResponse::created(
            ['id' => $enquiry->id, 'kind' => $enquiry->kind],
            $enquiry->kind === Enquiry::WALKTHROUGH
                ? 'Thank you — we will write back to confirm a time.'
                : 'Thank you — we will get back to you.',
        );
    }
}
