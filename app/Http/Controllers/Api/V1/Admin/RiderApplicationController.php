<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Enums\RiderStatus;
use App\Http\Controllers\Controller;
use App\Models\RiderDocument;
use App\Models\RiderProfile;
use App\Services\RiderService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Platform staff reviewing rider applications.
 *
 * The queue defaults to `pending` because that is the only list with work in
 * it; the others are there so a decision can be looked up afterwards, and so a
 * suspension can be lifted.
 */
class RiderApplicationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'status' => ['nullable', Rule::enum(RiderStatus::class)],
            'search' => ['nullable', 'string', 'max:100'],
        ]);

        $riders = RiderProfile::query()
            ->with(['user:id,name,phone,email', 'city:id,name', 'documents'])
            ->when(
                $request->filled('status'),
                fn ($q) => $q->where('status', $request->string('status')->value()),
                // The queue, not the archive: an unfiltered list of every rider
                // who ever applied buries the four people waiting.
                fn ($q) => $q->where('status', RiderStatus::Pending->value),
            )
            ->when($request->filled('search'), function ($q) use ($request): void {
                $term = '%'.$request->string('search')->value().'%';
                $q->where(fn ($w) => $w
                    ->where('rider_code', 'like', $term)
                    ->orWhereHas('user', fn ($u) => $u->where('name', 'like', $term)->orWhere('phone', 'like', $term)));
            })
            ->orderByRaw('applied_at is null, applied_at asc')
            ->paginate(20);

        $riders->through(fn (RiderProfile $p) => $this->serialize($p));

        return ApiResponse::paginated($riders);
    }

    public function show(string $id): JsonResponse
    {
        $profile = RiderProfile::query()
            ->with(['user:id,name,phone,email', 'city:id,name', 'documents'])
            ->findOrFail($id);

        return ApiResponse::ok($this->serialize($profile, full: true));
    }

    public function review(Request $request, string $id, RiderService $riders): JsonResponse
    {
        $data = $request->validate([
            'verdict' => ['required', Rule::in(['approve', 'reject', 'suspend', 'reinstate'])],
            // A rejection with no reason is a dead end the applicant cannot
            // fix, so it is required for every verdict except approval.
            'note' => ['required_unless:verdict,approve', 'nullable', 'string', 'max:500'],
        ]);

        $profile = RiderProfile::query()->with('user')->findOrFail($id);
        $profile = $riders->review($profile, $data['verdict'], $data['note'] ?? null, $request->user());

        return ApiResponse::ok(
            $this->serialize($profile->load('user:id,name,phone,email', 'city:id,name', 'documents'), full: true),
            'Rider '.$profile->status->label(),
        );
    }

    /** Mark one document, so a rejection can name the photograph to retake. */
    public function reviewDocument(Request $request, string $id, string $documentId): JsonResponse
    {
        $data = $request->validate([
            'status' => ['required', Rule::in(['approved', 'rejected', 'pending'])],
            'note' => ['required_if:status,rejected', 'nullable', 'string', 'max:500'],
        ]);

        $profile = RiderProfile::query()->findOrFail($id);
        /** @var RiderDocument $doc */
        $doc = $profile->documents()->findOrFail($documentId);
        $doc->forceFill(['status' => $data['status'], 'review_note' => $data['note'] ?? null])->save();

        return ApiResponse::ok($this->serialize($profile->load('user:id,name,phone,email', 'city:id,name', 'documents'), full: true), 'Document reviewed');
    }

    /**
     * The document itself.
     *
     * Private disk, streamed behind this route's `role:super_admin,admin_staff`
     * gate. Uploading a CNIC to the public disk would have given it a URL that
     * needs no token at all, which is why these never go there.
     */
    public function document(string $id, string $documentId): StreamedResponse
    {
        $profile = RiderProfile::query()->findOrFail($id);
        /** @var RiderDocument $doc */
        $doc = $profile->documents()->findOrFail($documentId);

        abort_unless(Storage::disk('local')->exists($doc->path), 404);

        return Storage::disk('local')->response($doc->path);
    }

    /**
     * @param  bool  $full  the CNIC number is shown ONLY on the single-rider
     *                      screen, where somebody is deliberately looking at
     *                      one person — never down a list of forty.
     */
    private function serialize(RiderProfile $p, bool $full = false): array
    {
        return [
            'id' => $p->id,
            'rider_code' => $p->rider_code,
            'status' => $p->status->value,
            'status_label' => $p->status->label(),
            'name' => $p->user?->name,
            'phone' => $p->user?->phone,
            'email' => $p->user?->email,
            'vehicle_type' => $p->vehicle_type,
            'vehicle_registration' => $p->vehicle_registration,
            'cnic' => $full ? $p->cnic : ($p->cnic !== null ? '•••• '.substr($p->cnic, -4) : null),
            'is_platform' => $p->is_platform,
            'city' => $p->city?->name,
            'is_online' => $p->is_online,
            'last_seen_at' => $p->last_seen_at?->toIso8601String(),
            'applied_at' => $p->applied_at?->toIso8601String(),
            'approved_at' => $p->approved_at?->toIso8601String(),
            'review_note' => $p->review_note,
            'missing_documents' => $p->missingDocuments(),
            'documents' => $p->documents->map(fn (RiderDocument $d) => [
                'id' => $d->id,
                'type' => $d->type->value,
                'label' => $d->type->label(),
                'status' => $d->status,
                'review_note' => $d->review_note,
                'size_bytes' => $d->size_bytes,
                'uploaded_at' => $d->created_at?->toIso8601String(),
            ])->values()->all(),
        ];
    }
}
