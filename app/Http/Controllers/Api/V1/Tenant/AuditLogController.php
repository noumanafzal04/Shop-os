<?php

namespace App\Http\Controllers\Api\V1\Tenant;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Support\ApiResponse;
use App\Support\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The shop's own record of who changed what.
 *
 * ── Why this exists beside the admin one ────────────────────────────────
 *
 * The trail was written for the platform and not for the shop it is about.
 * `/admin/audit-logs` is behind `role:super_admin`, so the only thing an owner
 * could see of their own history was eight rows on the dashboard, with nothing
 * to search and no way to ask a question — while the Help Centre told them, in
 * as many words, that the log records who entered a figure and when.
 *
 * A record that nobody named in it can read is not accountability. It is a
 * promise about a filing cabinet in somebody else's office.
 *
 * ── What it will and will not answer ────────────────────────────────────
 *
 * It answers who changed the shop's RULES and its MONEY AUTHORITIES — a staff
 * permission, the discount ceiling, a customer's credit limit, a tax rate, a
 * customer group's discount, a coupon — plus sales, disposals, banking and the
 * trading day. It does NOT answer "who changed this product's price": a shop
 * that imports five thousand rows would bury the trail in one afternoon, and a
 * log nobody can read to the bottom of protects nobody. That gap is recorded
 * rather than papered over — see docs/decisions.
 */
class AuditLogController extends Controller
{
    public function __construct(private readonly TenantContext $context) {}

    public function index(Request $request): JsonResponse
    {
        $logs = AuditLog::query()
            // Explicit, not by global scope: AuditLog carries a tenant_id but
            // is not tenant-scoped as a model — the platform reads it across
            // every shop, and a read that FORGETS to say which shop it wants is
            // the worst possible bug in this particular table.
            ->where('tenant_id', $this->context->id())
            ->with('user:id,name,email')
            ->when($request->query('event'), fn ($q, $e) => $q->where('event', $e))
            ->when($request->query('type'), fn ($q, $t) => $q->where('auditable_type', 'like', "%{$t}%"))
            ->when($request->query('user_id'), fn ($q, $id) => $q->where('user_id', $id))
            ->when($request->query('from'), fn ($q, $d) => $q->whereDate('created_at', '>=', $d))
            ->when($request->query('to'), fn ($q, $d) => $q->whereDate('created_at', '<=', $d))
            // Rows can share a timestamp to the second; the id breaks the tie so
            // the list never reshuffles between pages.
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->paginate(min((int) $request->query('per_page', 25), 100))
            ->through(fn (AuditLog $log) => [
                'id' => $log->id,
                'event' => $log->event,
                'entity' => class_basename($log->auditable_type),
                'entity_id' => $log->auditable_id,
                'actor' => $log->user?->only(['id', 'name', 'email']),
                'old_values' => $log->old_values,
                'new_values' => $log->new_values,
                'ip_address' => $log->ip_address,
                'created_at' => $log->created_at?->toIso8601String(),
            ]);

        return ApiResponse::paginated($logs);
    }
}
