<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Tenant;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * WHO CHANGED WHAT, across the platform.
 *
 * ── Two things this could not be asked, and both were about finding one row ──
 *
 * A trail with no DATE RANGE cannot answer "what happened last Tuesday", which
 * is the only question anybody opens an audit log with. It had a page number.
 *
 * And the screen offered three entity types — Tenant, User, Sale — typed in by
 * hand into a dropdown. The trail records more than three, and a list of
 * guesses is worse than no list: the types it names look like the complete set,
 * so a change filed against anything else reads as a change that was never
 * recorded. The distinct types are now counted from the table itself, so the
 * filter cannot fall behind what the trail actually holds.
 */
class AuditLogController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $filtered = fn () => AuditLog::query()
            ->when($request->query('tenant_id'), fn ($q, $id) => $q->where('tenant_id', $id))
            ->when($request->query('event'), fn ($q, $e) => $q->where('event', $e))
            // Exact, not LIKE: "Customer" is not also CustomerGroup. See AuditLog::scopeAbout.
            ->when($request->query('type'), fn ($q, $t) => $q->about((string) $t))
            ->when($request->query('from'), fn ($q, $from) => $q->where('created_at', '>=', $from))
            // The whole of the day it names. Comparing against midnight would
            // drop everything that happened during it — and "today" is the
            // range this screen is opened with.
            ->when($request->query('to'), fn ($q, $to) => $q->where('created_at', '<=', $to.' 23:59:59'))
            ->when($request->query('search'), function ($q, $search): void {
                // By WHO, or by WHICH BUSINESS. It searched people only, on a
                // screen whose most common question is "what happened to
                // this shop" — and the shop's name was not on it to find.
                $shops = Tenant::query()->withoutGlobalScopes()
                    ->where('business_name', 'like', "%{$search}%")->pluck('id');

                $q->where(fn ($w) => $w
                    ->whereHas('user', fn ($u) => $u
                        ->where('name', 'like', "%{$search}%")
                        ->orWhere('email', 'like', "%{$search}%"))
                    ->orWhereIn('tenant_id', $shops)
                    ->orWhere(fn ($about) => $about->about('Tenant')->whereIn('auditable_id', $shops)));
            });

        $page = $filtered()
            ->with('user:id,name,email')
            ->orderByDesc('created_at')
            ->stably()->paginate(min((int) $request->query('per_page', 25), 100));

        /*
         * WHICH BUSINESS, on every row.
         *
         * The trail read "Super Admin updated Tenant — status: active →
         * suspended" and stopped. Across a platform of shops that is a record
         * that SOMETHING was suspended. The row knew which all along: it is
         * the row's own subject when the entity is a Tenant, and its
         * `tenant_id` for everything that happened inside one.
         *
         * One query for the page, and without scopes — a deleted shop still
         * has a name, and its deletion is the row most likely to be read.
         */
        $aboutShop = fn (AuditLog $log): ?string => class_basename((string) $log->auditable_type) === 'Tenant'
            ? $log->auditable_id
            : $log->tenant_id;
        $names = Tenant::query()->withoutGlobalScopes()
            ->whereIn('id', collect($page->items())->map($aboutShop)->filter()->unique()->values())
            ->pluck('business_name', 'id');

        $logs = $page
            ->through(fn (AuditLog $log) => [
                'id' => $log->id,
                'event' => $log->event,
                'entity' => class_basename($log->auditable_type),
                'entity_id' => $log->auditable_id,
                'actor' => $log->user?->only(['id', 'name', 'email']),
                'tenant_id' => $log->tenant_id,
                'business' => $names[$aboutShop($log)] ?? null,
                'old_values' => $log->old_values,
                'new_values' => $log->new_values,
                'ip_address' => $log->ip_address,
                'created_at' => $log->created_at?->toIso8601String(),
            ]);

        return ApiResponse::paginated($logs, meta: [
            // What the trail actually holds, so the filter cannot offer a type
            // nothing was ever filed under, nor miss one that was.
            'entities' => AuditLog::query()
                ->select('auditable_type')
                ->distinct()
                ->orderBy('auditable_type')
                ->pluck('auditable_type')
                ->filter()
                ->map(fn (string $type): array => [
                    'value' => class_basename($type),
                    'label' => Str::headline(class_basename($type)),
                ])
                ->unique('value')
                ->values(),
        ]);
    }
}
