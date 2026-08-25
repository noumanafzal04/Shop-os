<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Controller;
use App\Models\Enquiry;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Landing-page enquiries, for whoever answers them.
 *
 * Oldest first within a status, for the reason the shop-request list is: a
 * queue sorted by anything else lets the awkward one sink to the bottom and
 * stay there. Walkthroughs and questions can be read apart, because a question
 * wants answering today and a walkthrough wants half an hour next week.
 */
class EnquiryController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $status = $request->query('status', 'open');
        $kind = $request->query('kind');

        abort_unless(
            $status === 'open' || $status === 'all' || in_array($status, Enquiry::STATUSES, true),
            422,
            'Unknown status filter.',
        );

        $rows = Enquiry::query()
            ->with('handler:id,name')
            // 'all' is the only way to see closed rows beside open ones, and
            // it is spelled out rather than being whatever falls through: a
            // filter that silently returns EVERYTHING when it does not
            // recognise its own argument is a filter you cannot trust.
            ->when($status === 'open', fn ($q) => $q->open())
            ->when(in_array($status, Enquiry::STATUSES, true), fn ($q) => $q->where('status', $status))
            ->when(in_array($kind, Enquiry::KINDS, true), fn ($q) => $q->where('kind', $kind))
            ->orderBy('created_at')
            ->paginate(25);

        return ApiResponse::paginated($rows);
    }

    public function update(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'status' => ['required', Rule::in(Enquiry::STATUSES)],
            'handling_note' => ['nullable', 'string', 'max:2000'],
        ]);

        $enquiry = Enquiry::query()->findOrFail($id);

        $enquiry->forceFill([
            'status' => $data['status'],
            'handling_note' => $data['handling_note'] ?? $enquiry->handling_note,
            // WHO answered and WHEN, recorded on every move rather than only
            // on the last one — "contacted" with nobody's name against it is a
            // row the next person cannot pick up.
            'handled_by' => $request->user()->id,
            'handled_at' => now(),
        ])->save();

        return ApiResponse::ok($enquiry->fresh()->load('handler:id,name'), 'Saved.');
    }
}
