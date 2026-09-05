<?php

namespace App\Http\Controllers\Api\V1\Rider;

use App\Enums\RiderDocumentType;
use App\Exceptions\DomainException;
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
 * The rider's own account: apply, upload papers, go on duty.
 *
 * Everything here is `role:customer` — a rider IS a customer who was approved,
 * so nothing that branches on the role column changes. What separates them is
 * a `rider_profiles` row, not a different login.
 */
class RiderProfileController extends Controller
{
    /**
     * "Am I a rider?" — the one call the app makes at boot.
     *
     * Answers for everybody, including the vast majority who have never
     * applied: `profile: null` is a real answer, not a 404, because "no" is
     * what the account screen needs in order to offer the application.
     */
    public function show(Request $request): JsonResponse
    {
        $profile = $this->find($request);

        return ApiResponse::ok(['profile' => $profile === null ? null : $this->serialize($profile)]);
    }

    public function apply(Request $request, RiderService $riders): JsonResponse
    {
        $data = $request->validate([
            'vehicle_type' => ['required', Rule::in(['bike', 'cycle', 'car', 'van'])],
            'vehicle_registration' => ['nullable', 'string', 'max:32'],
            // 13 digits, with or without the dashes people type them with.
            'cnic' => ['required', 'string', 'regex:/^\d{5}-?\d{7}-?\d$/'],
            'city_id' => ['nullable', 'uuid', 'exists:cities,id'],
            'is_platform' => ['sometimes', 'boolean'],
        ], [
            'cnic.regex' => 'Enter your 13-digit CNIC number.',
        ]);

        $data['cnic'] = preg_replace('/\D/', '', $data['cnic']);

        $profile = $riders->apply($request->user(), $data);

        return ApiResponse::created($this->serialize($profile->load('documents')), 'Application started');
    }

    public function uploadDocument(Request $request, RiderService $riders): JsonResponse
    {
        $request->validate([
            'type' => ['required', Rule::enum(RiderDocumentType::class)],
            // 8MB: a phone camera photograph of a CNIC, not a scan of a book.
            'file' => ['required', 'file', 'mimes:jpg,jpeg,png,webp,pdf', 'max:8192'],
        ]);

        $profile = $this->mine($request);
        $doc = $riders->uploadDocument(
            $profile,
            RiderDocumentType::from($request->string('type')->value()),
            $request->file('file'),
        );

        return ApiResponse::ok(
            $this->serialize($profile->load('documents')),
            RiderDocumentType::from($doc->type->value)->label().' uploaded',
        );
    }

    public function submit(Request $request, RiderService $riders): JsonResponse
    {
        $profile = $riders->submit($this->mine($request));

        return ApiResponse::ok($this->serialize($profile->load('documents')), 'Application sent for review');
    }

    /**
     * Read one of their own documents back.
     *
     * The file is on the private disk. This is the only door to it for a
     * rider, and it opens only onto their own — platform staff use the admin
     * endpoint, which checks a different thing.
     */
    public function document(Request $request, string $id): StreamedResponse
    {
        $profile = $this->mine($request);

        /** @var RiderDocument $doc */
        $doc = $profile->documents()->findOrFail($id);

        abort_unless(Storage::disk('local')->exists($doc->path), 404);

        return Storage::disk('local')->response($doc->path);
    }

    public function setOnline(Request $request, RiderService $riders): JsonResponse
    {
        $data = $request->validate([
            'is_online' => ['required', 'boolean'],
            'latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180'],
        ]);

        $profile = $this->mine($request);

        // The fix comes FIRST. Going online with yesterday's position would put
        // this rider on a job board eight kilometres from where they are, for
        // as long as it takes the first ping to land.
        if ($data['is_online'] && isset($data['latitude'], $data['longitude'])) {
            $riders->ping($profile, (float) $data['latitude'], (float) $data['longitude']);
        }

        $profile = $riders->setOnline($profile, (bool) $data['is_online']);

        return ApiResponse::ok(
            $this->serialize($profile),
            $profile->is_online ? 'You are online' : 'You are offline',
        );
    }

    /** A heartbeat with a position on it. Called while the app is open. */
    public function ping(Request $request, RiderService $riders): JsonResponse
    {
        $data = $request->validate([
            'latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180'],
        ]);

        $profile = $riders->ping(
            $this->mine($request),
            isset($data['latitude']) ? (float) $data['latitude'] : null,
            isset($data['longitude']) ? (float) $data['longitude'] : null,
        );

        return ApiResponse::ok([
            'is_online' => $profile->is_online,
            'last_seen_at' => $profile->last_seen_at?->toIso8601String(),
        ]);
    }

    // ─────────────────────────────────────────────────────────────────────

    private function find(Request $request): ?RiderProfile
    {
        return RiderProfile::query()
            ->with('documents', 'city:id,name')
            ->where('user_id', $request->user()->id)
            ->first();
    }

    /** Their profile, or a refusal that names the missing step. */
    private function mine(Request $request): RiderProfile
    {
        $profile = $this->find($request);

        if ($profile === null) {
            throw DomainException::forbidden('You have not applied to ride yet.', 'RIDER_NO_PROFILE');
        }

        return $profile;
    }

    /** Allow-list. `cnic` is deliberately absent — see RiderProfile::$hidden. */
    private function serialize(RiderProfile $p): array
    {
        $p->loadMissing('documents');

        return [
            'id' => $p->id,
            'rider_code' => $p->rider_code,
            'status' => $p->status->value,
            'status_label' => $p->status->label(),
            'can_ride' => $p->status->canRide(),
            'can_submit' => $p->status->isEditable() && $p->missingDocuments() === [],
            'vehicle_type' => $p->vehicle_type,
            'vehicle_registration' => $p->vehicle_registration,
            // The last four digits only, so a rider can confirm we hold the
            // right number without the number itself travelling again.
            'cnic_last4' => $p->cnic !== null ? substr($p->cnic, -4) : null,
            'is_platform' => $p->is_platform,
            'city' => $p->city?->name,
            'is_online' => $p->is_online,
            'last_seen_at' => $p->last_seen_at?->toIso8601String(),
            'applied_at' => $p->applied_at?->toIso8601String(),
            'approved_at' => $p->approved_at?->toIso8601String(),
            'review_note' => $p->review_note,
            'missing_documents' => $p->missingDocuments(),
            'required_documents' => array_map(
                fn (RiderDocumentType $t) => ['type' => $t->value, 'label' => $t->label()],
                RiderDocumentType::requiredFor($p->vehicle_type),
            ),
            'documents' => $p->documents->map(fn (RiderDocument $d) => [
                'id' => $d->id,
                'type' => $d->type->value,
                'label' => $d->type->label(),
                'status' => $d->status,
                'review_note' => $d->review_note,
                'uploaded_at' => $d->created_at?->toIso8601String(),
            ])->values()->all(),
        ];
    }
}
