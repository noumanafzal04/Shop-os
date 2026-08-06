<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Exceptions\DomainException;
use App\Http\Controllers\Controller;
use App\Models\SaleItemSerial;
use App\Models\WarrantyClaim;
use App\Support\ApiResponse;
use App\Support\BranchContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Warranty desk — look up a serial / IMEI to see what was sold, when, to whom,
 * and whether it is still under warranty. The counter uses this to settle a
 * walk-in warranty claim from just the number on the device.
 */
class WarrantyController extends Controller
{
    public function __construct(private readonly BranchContext $branch) {}

    public function lookup(Request $request): JsonResponse
    {
        $data = $request->validate([
            'serial' => ['required', 'string', 'max:120'],
        ]);

        $serial = trim($data['serial']);

        // Most recent sale of this serial wins (a serial can recur across time
        // once an earlier sale was cancelled/refunded and the unit resold).
        $record = SaleItemSerial::query()
            ->where('serial', $serial)
            ->with(['sale:id,invoice_number,status,sold_at,customer_name,customer_phone,total'])
            ->latest('sold_at')
            ->first();

        if ($record === null) {
            return ApiResponse::error(
                "No sale found for serial \"{$serial}\".",
                404,
                code: 'SERIAL_NOT_FOUND',
            );
        }

        $expires = $record->warranty_expires_at;
        $underWarranty = $record->isUnderWarranty();

        return ApiResponse::ok([
            'serial' => $record->serial,
            'product_name' => $record->product_name,
            'sold_at' => $record->sold_at?->toIso8601String(),
            'warranty_months' => $record->warranty_months,
            'warranty_expires_at' => $expires?->toDateString(),
            'under_warranty' => $underWarranty,
            // Whole days left (0 when expired or no warranty) — the counter reads
            // this to tell the customer at a glance.
            'days_left' => $underWarranty ? now()->startOfDay()->diffInDays($expires->endOfDay()) : 0,
            'sale' => $record->sale === null ? null : [
                'id' => $record->sale->id,
                'invoice_number' => $record->sale->invoice_number,
                'status' => $record->sale->status,
                'customer_name' => $record->sale->customer_name,
                'customer_phone' => $record->sale->customer_phone,
                'total' => $record->sale->total,
            ],
            // Has this unit been back before? A second failure on the same
            // serial is the single most useful thing a counter can know, and
            // "didn't we replace this already?" is not a filing system.
            'claims' => WarrantyClaim::query()
                ->where('serial', $serial)
                ->with('resolver:id,name')
                ->latest()
                ->get(),
        ]);
    }

    /**
     * What the shop is currently holding.
     *
     * Open claims first and by default, because that is the question a counter
     * actually asks — a customer walks in and asks about their phone, and the
     * only thing that matters is whether it is still here.
     */
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'status' => ['sometimes', 'in:open,resolved,all'],
            'search' => ['sometimes', 'nullable', 'string', 'max:120'],
        ]);
        $status = $data['status'] ?? 'open';
        $search = trim((string) ($data['search'] ?? ''));

        $claims = WarrantyClaim::query()
            ->with(['resolver:id,name', 'creator:id,name'])
            ->when($status === 'open', fn ($q) => $q->whereNull('resolution'))
            ->when($status === 'resolved', fn ($q) => $q->whereNotNull('resolution'))
            ->when($search !== '', fn ($q) => $q->where(fn ($w) => $w
                ->where('serial', 'like', "%{$search}%")
                ->orWhere('customer_phone', 'like', "%{$search}%")
                ->orWhere('customer_name', 'like', "%{$search}%")
                ->orWhere('product_name', 'like', "%{$search}%")))
            // Open claims by oldest first: the unit that has been here three
            // weeks is the one somebody is waiting on.
            ->orderByRaw('CASE WHEN resolution IS NULL THEN 0 ELSE 1 END')
            ->orderBy('created_at', $status === 'resolved' ? 'desc' : 'asc')
            ->paginate(min(100, (int) $request->query('per_page', 25)));

        return ApiResponse::paginated($claims);
    }

    /**
     * Take the unit in.
     *
     * Whether it was under warranty is decided HERE and snapshotted, never
     * recomputed: the window will have closed by the time a supplier replies,
     * and a decision made in good faith on the day must not read as a mistake
     * three weeks later.
     *
     * A claim can be opened on a serial the shop never sold — a customer with a
     * receipt from the other branch, or a unit that predates the system. The
     * desk records what it is holding either way; refusing would just mean the
     * shop keeps that phone with no record at all.
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'serial' => ['required', 'string', 'max:120'],
            'fault' => ['required', 'string', 'max:500'],
            'customer_name' => ['nullable', 'string', 'max:191'],
            'customer_phone' => ['nullable', 'string', 'max:32'],
        ]);

        $serial = trim($data['serial']);

        $record = SaleItemSerial::query()
            ->where('serial', $serial)
            ->latest('sold_at')
            ->first();

        if (WarrantyClaim::query()->where('serial', $serial)->whereNull('resolution')->exists()) {
            throw DomainException::conflict(
                'This unit is already booked in and still open — resolve that claim before taking it in again.',
                'CLAIM_ALREADY_OPEN',
            );
        }

        $claim = WarrantyClaim::query()->create([
            'branch_id' => $this->branch->id(),
            'sale_item_serial_id' => $record?->id,
            'serial' => $serial,
            'product_name' => $record?->product_name ?? 'Unknown item',
            'fault' => $data['fault'],
            // Fall back to whoever bought it, so the counter isn't retyping a
            // name that is already on the sale.
            'customer_name' => $data['customer_name'] ?? $record?->sale?->customer_name,
            'customer_phone' => $data['customer_phone'] ?? $record?->sale?->customer_phone,
            'was_under_warranty' => (bool) $record?->isUnderWarranty(),
            'warranty_expires_at' => $record?->warranty_expires_at,
            'created_by' => $request->user()->id,
        ]);

        // Refresh so the response carries every column, not only the ones the
        // insert named — `resolution` is null on a new claim and that null IS
        // the open state, so a caller that never sees the key cannot tell.
        return ApiResponse::created($claim->refresh()->load('creator:id,name'), 'Claim booked in');
    }

    /**
     * Say what happened to it.
     *
     * Once only. A claim that can be re-resolved is a claim whose history can
     * be rewritten after the customer has been told — and "we replaced it" is
     * exactly the sentence somebody will later need to prove.
     */
    public function resolve(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'resolution' => ['required', Rule::in(WarrantyClaim::RESOLUTIONS)],
            'note' => ['nullable', 'string', 'max:500'],
        ]);

        /** @var WarrantyClaim $claim */
        $claim = WarrantyClaim::query()->findOrFail($id);

        if (! $claim->isOpen()) {
            throw DomainException::conflict(
                'This claim was already closed as '.$claim->resolution.'.',
                'CLAIM_ALREADY_RESOLVED',
            );
        }

        $claim->forceFill([
            'resolution' => $data['resolution'],
            'resolution_note' => $data['note'] ?? null,
            'resolved_at' => now(),
            'resolved_by' => $request->user()->id,
        ])->save();

        return ApiResponse::ok($claim->load('resolver:id,name'), 'Claim closed');
    }
}
